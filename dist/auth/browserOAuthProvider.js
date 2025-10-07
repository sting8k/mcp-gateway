import { spawn } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import { existsSync, mkdirSync } from "fs";
import { getLogger } from "../logging.js";
import { GlobalOAuthLock } from "./globalOAuthLock.js";
import express from "express";
const logger = getLogger();
/**
 * Browser-based OAuth provider that opens the user's browser for authentication
 * and handles the OAuth callback locally.
 */
export class BrowserOAuthProvider {
    packageId;
    _clientMetadata;
    _redirectUrl;
    tokenStoragePath;
    legacyTokenStoragePath;
    codeVerifierStorage = new Map();
    clientInfoStorage = new Map();
    redirectPort;
    openBrowser;
    callbackServer;
    authorizationCodePromise;
    // Singleton tracking for OAuth flows
    static activeFlows = new Map();
    static flowLocks = new Map();
    // Shared callback server for all OAuth providers
    static sharedCallbackServer;
    static callbackHandlers = new Map();
    constructor(options) {
        this.packageId = options.packageId;
        this.redirectPort = options.redirectPort || 5173;
        this._redirectUrl = `http://localhost:${this.redirectPort}/oauth/callback`;
        this.openBrowser = options.openBrowser !== false;
        // Default token storage path
        const baseDir = process.env.HOME || "";
        const legacyDir = path.join(baseDir, ".super-mcp", "oauth-tokens");
        const gatewayDir = path.join(baseDir, ".mcp-gateway", "oauth-tokens");
        if (!existsSync(gatewayDir)) {
            mkdirSync(gatewayDir, { recursive: true });
        }
        this.tokenStoragePath = options.tokenStoragePath || gatewayDir;
        if (existsSync(legacyDir)) {
            this.legacyTokenStoragePath = legacyDir;
        }
        // Default client metadata for dynamic registration
        this._clientMetadata = options.clientMetadata || {
            client_name: `MCP Gateway - ${this.packageId}`,
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            redirect_uris: [this._redirectUrl],
            token_endpoint_auth_method: "none", // Public client
            scope: "read write",
        };
    }
    get redirectUrl() {
        return this._redirectUrl;
    }
    get clientMetadata() {
        return this._clientMetadata;
    }
    async state() {
        // Generate a random state parameter for CSRF protection
        const bytes = new Uint8Array(32);
        crypto.getRandomValues(bytes);
        return Array.from(bytes)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }
    async clientInformation() {
        const key = `${this.packageId}_client`;
        return this.clientInfoStorage.get(key);
    }
    async saveClientInformation(clientInformation) {
        const key = `${this.packageId}_client`;
        this.clientInfoStorage.set(key, clientInformation);
        // Also persist to disk
        try {
            await fs.mkdir(this.tokenStoragePath, { recursive: true });
            const filePath = path.join(this.tokenStoragePath, `${this.packageId}_client.json`);
            await fs.writeFile(filePath, JSON.stringify(clientInformation, null, 2));
        }
        catch (error) {
            logger.warn("Failed to persist client information", {
                package_id: this.packageId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    async tokens() {
        const fileName = `${this.packageId}.json`;
        try {
            const filePath = path.join(this.tokenStoragePath, fileName);
            const data = await fs.readFile(filePath, "utf-8");
            const stored = JSON.parse(data);
            // Check if tokens are expired
            if (stored.expires_at && new Date(stored.expires_at) < new Date()) {
                logger.debug("OAuth tokens expired", { package_id: this.packageId });
                return undefined;
            }
            // Return just the OAuth tokens structure
            return {
                access_token: stored.access_token,
                token_type: stored.token_type,
                expires_in: stored.expires_in,
                refresh_token: stored.refresh_token,
                scope: stored.scope,
            };
        }
        catch (error) {
            if (this.legacyTokenStoragePath) {
                try {
                    const legacyPath = path.join(this.legacyTokenStoragePath, fileName);
                    const data = await fs.readFile(legacyPath, "utf-8");
                    await fs.mkdir(this.tokenStoragePath, { recursive: true });
                    await fs.writeFile(path.join(this.tokenStoragePath, fileName), data);
                    logger.debug("Migrated OAuth tokens from legacy storage", { package_id: this.packageId });
                    const stored = JSON.parse(data);
                    if (stored.expires_at && new Date(stored.expires_at) < new Date()) {
                        logger.debug("OAuth tokens expired", { package_id: this.packageId });
                        return undefined;
                    }
                    return {
                        access_token: stored.access_token,
                        token_type: stored.token_type,
                        expires_in: stored.expires_in,
                        refresh_token: stored.refresh_token,
                        scope: stored.scope,
                    };
                }
                catch {
                    // No saved tokens
                }
            }
            return undefined;
        }
    }
    async saveTokens(tokens) {
        try {
            await fs.mkdir(this.tokenStoragePath, { recursive: true });
            const filePath = path.join(this.tokenStoragePath, `${this.packageId}.json`);
            // Store with additional metadata
            const toStore = { ...tokens };
            // Calculate expiration time if not provided
            if (tokens.expires_in) {
                const expiresAt = new Date();
                expiresAt.setSeconds(expiresAt.getSeconds() + tokens.expires_in);
                toStore.expires_at = expiresAt.toISOString();
            }
            await fs.writeFile(filePath, JSON.stringify(toStore, null, 2));
            logger.debug("OAuth tokens saved", { package_id: this.packageId });
        }
        catch (error) {
            logger.error("Failed to save OAuth tokens", {
                package_id: this.packageId,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }
    async redirectToAuthorization(authorizationUrl) {
        const globalLock = GlobalOAuthLock.getInstance();
        // First check if there's an active flow globally
        if (globalLock.isFlowActive(this.packageId)) {
            logger.info("OAuth flow already active globally, waiting", {
                package_id: this.packageId,
            });
            await globalLock.waitForFlow(this.packageId);
            // After waiting, check if we have tokens now
            const tokens = await this.tokens();
            if (tokens) {
                logger.info("Tokens available after waiting, skipping OAuth", {
                    package_id: this.packageId,
                });
                return;
            }
        }
        // Try to acquire the global lock
        const canProceed = await globalLock.acquireLock(this.packageId);
        if (!canProceed) {
            logger.info("Cannot acquire OAuth lock, skipping", {
                package_id: this.packageId,
            });
            // Throw an error that will be caught by the transport
            throw new Error("OAuth flow already in progress");
        }
        // Create a promise for this flow
        const flowPromise = this.performAuthorizationFlow(authorizationUrl);
        // Register with global lock
        globalLock.registerFlow(this.packageId, flowPromise);
        return flowPromise;
    }
    async performAuthorizationFlow(authorizationUrl) {
        logger.info("Starting OAuth authorization flow", {
            package_id: this.packageId,
            auth_url: authorizationUrl.toString(),
        });
        // Start a local server to handle the callback
        await this.startCallbackServer();
        if (this.openBrowser) {
            // Open the browser to the authorization URL
            const platform = process.platform;
            const command = platform === "darwin" ? "open" :
                platform === "win32" ? "start" :
                    "xdg-open";
            spawn(command, [authorizationUrl.toString()], {
                detached: true,
                stdio: "ignore",
            }).unref();
            logger.info("Opened browser for OAuth authorization", {
                package_id: this.packageId,
            });
        }
        else {
            logger.info("OAuth authorization URL generated", {
                package_id: this.packageId,
                authorization_url: authorizationUrl.toString(),
            });
        }
        // Wait for the authorization code to be received
        try {
            const code = await this.waitForAuthorizationCode();
            logger.info("Authorization code received", {
                package_id: this.packageId,
            });
            // The code will be handled by the OAuth library
        }
        catch (error) {
            logger.error("Failed to get authorization code", {
                package_id: this.packageId,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }
    async saveCodeVerifier(codeVerifier) {
        const key = `${this.packageId}_verifier`;
        this.codeVerifierStorage.set(key, codeVerifier);
    }
    async codeVerifier() {
        const key = `${this.packageId}_verifier`;
        const verifier = this.codeVerifierStorage.get(key);
        if (!verifier) {
            throw new Error("No code verifier found");
        }
        return verifier;
    }
    async invalidateCredentials(scope) {
        logger.debug("Invalidating credentials", {
            package_id: this.packageId,
            scope,
        });
        if (scope === 'all' || scope === 'tokens') {
            try {
                const filePath = path.join(this.tokenStoragePath, `${this.packageId}.json`);
                await fs.unlink(filePath);
            }
            catch (error) {
                // Ignore if file doesn't exist
            }
        }
        if (scope === 'all' || scope === 'client') {
            const key = `${this.packageId}_client`;
            this.clientInfoStorage.delete(key);
            try {
                const filePath = path.join(this.tokenStoragePath, `${this.packageId}_client.json`);
                await fs.unlink(filePath);
            }
            catch (error) {
                // Ignore if file doesn't exist
            }
        }
        if (scope === 'all' || scope === 'verifier') {
            const key = `${this.packageId}_verifier`;
            this.codeVerifierStorage.delete(key);
        }
    }
    /**
     * Start or reuse a shared Express server to handle OAuth callbacks
     */
    async startCallbackServer() {
        // If shared server already exists, just register our handler
        if (BrowserOAuthProvider.sharedCallbackServer) {
            logger.debug("Reusing existing OAuth callback server", {
                package_id: this.packageId,
            });
            this.registerCallbackHandler();
            return;
        }
        // Create the shared server
        const app = express();
        // Handle OAuth callback for any package
        app.get("/oauth/callback", (req, res) => {
            const code = req.query.code;
            const state = req.query.state;
            const error = req.query.error;
            const errorDescription = req.query.error_description;
            // Find the right handler based on state or other criteria
            // For now, we'll call all active handlers (they should handle their own state)
            let handled = false;
            BrowserOAuthProvider.callbackHandlers.forEach((handler, packageId) => {
                if (!handled) {
                    logger.debug("Attempting to handle OAuth callback", {
                        package_id: packageId,
                        has_code: !!code,
                        has_error: !!error,
                    });
                    if (error) {
                        logger.error("OAuth authorization failed", {
                            package_id: packageId,
                            error,
                            error_description: errorDescription,
                        });
                        res.send(`
              <html>
                <body style="font-family: system-ui; padding: 40px; text-align: center;">
                  <h2>Authorization Failed</h2>
                  <p style="color: red;">${error}: ${errorDescription || 'Unknown error'}</p>
                  <p>You can close this window.</p>
                </body>
              </html>
            `);
                        handler("", error);
                        handled = true;
                    }
                    else if (code) {
                        logger.info("OAuth authorization code received", {
                            package_id: packageId,
                        });
                        res.send(`
              <html>
                <body style="font-family: system-ui; padding: 40px; text-align: center;">
                  <h2>Authorization Successful!</h2>
                  <p>You can close this window and return to Claude.</p>
                  <script>window.close();</script>
                </body>
              </html>
            `);
                        handler(code);
                        handled = true;
                    }
                }
            });
            if (!handled) {
                res.send(`
          <html>
            <body style="font-family: system-ui; padding: 40px; text-align: center;">
              <h2>Unexpected OAuth Callback</h2>
              <p>No handler registered for this callback.</p>
              <p>You can close this window.</p>
            </body>
          </html>
        `);
            }
        });
        return new Promise((resolve) => {
            BrowserOAuthProvider.sharedCallbackServer = app.listen(this.redirectPort, () => {
                logger.info("Shared OAuth callback server started", {
                    port: this.redirectPort,
                });
                this.registerCallbackHandler();
                resolve();
            });
        });
    }
    /**
     * Register this provider's callback handler
     */
    registerCallbackHandler() {
        BrowserOAuthProvider.callbackHandlers.set(this.packageId, (code, error) => {
            if (error) {
                if (this.authorizationCodePromise) {
                    this.authorizationCodePromise.reject(new Error(`OAuth error: ${error}`));
                    this.authorizationCodePromise = undefined;
                }
            }
            else if (code) {
                if (this.authorizationCodePromise) {
                    this.authorizationCodePromise.resolve(code);
                    this.authorizationCodePromise = undefined;
                }
            }
            // Clean up handler after use
            BrowserOAuthProvider.callbackHandlers.delete(this.packageId);
        });
    }
    /**
     * Stop the callback server (no-op for shared server)
     */
    stopCallbackServer() {
        // We don't stop the shared server, just clean up our handler
        BrowserOAuthProvider.callbackHandlers.delete(this.packageId);
        logger.debug("OAuth callback handler cleaned up", {
            package_id: this.packageId,
        });
    }
    /**
     * Wait for authorization code from callback
     */
    async waitForAuthorizationCode() {
        return new Promise((resolve, reject) => {
            this.authorizationCodePromise = { resolve, reject };
            // Set a timeout
            setTimeout(() => {
                if (this.authorizationCodePromise) {
                    reject(new Error("OAuth authorization timeout"));
                    this.authorizationCodePromise = undefined;
                    this.stopCallbackServer();
                }
            }, 5 * 60 * 1000); // 5 minutes timeout
        });
    }
}
