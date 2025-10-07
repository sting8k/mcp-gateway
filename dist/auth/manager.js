import * as keytar from "keytar";
import * as fs from "fs/promises";
import * as path from "path";
import { DeviceCodeAuth } from "./deviceCode.js";
import { getLogger } from "../logging.js";
const logger = getLogger();
export class AuthManagerImpl {
    static SERVICE_NAME = "mcp-gateway";
    tokens = new Map();
    activeFlows = new Map();
    fallbackDir;
    constructor(fallbackDir) {
        this.fallbackDir = fallbackDir;
    }
    async beginAuth(packageId, config, baseUrl) {
        if (!baseUrl) {
            throw new Error("Base URL is required for OAuth authentication");
        }
        logger.info("Beginning authentication", {
            package_id: packageId,
            method: config.method,
            scopes: config.scopes,
        });
        if (config.method === "device_code") {
            const deviceAuth = new DeviceCodeAuth(baseUrl, config);
            const result = await deviceAuth.beginDeviceCode();
            // Store the device code flow details for polling
            this.activeFlows.set(packageId, {
                deviceCode: result.user_code, // This should be the device_code, not user_code
                interval: result.interval,
                expiresAt: Date.now() + (result.expires_in * 1000),
            });
            // Start background polling
            this.pollForAuthCompletion(packageId, deviceAuth, config);
            return result;
        }
        else {
            throw new Error(`Auth method ${config.method} not supported yet`);
        }
    }
    async getAuthStatus(packageId) {
        const token = this.tokens.get(packageId);
        if (token) {
            const isExpired = Date.now() > token.expires_at;
            return {
                state: isExpired ? "error" : "authorized",
                scopes: token.scopes,
                expires_at: new Date(token.expires_at).toISOString(),
            };
        }
        const activeFlow = this.activeFlows.get(packageId);
        if (activeFlow) {
            const isExpired = Date.now() > activeFlow.expiresAt;
            return {
                state: isExpired ? "error" : "pending",
            };
        }
        return { state: "error" };
    }
    async getAuthHeaders(packageId) {
        const token = await this.getValidToken(packageId);
        if (!token) {
            return {};
        }
        return {
            "Authorization": `${token.token_type} ${token.access_token}`,
        };
    }
    async pollForAuthCompletion(packageId, deviceAuth, config) {
        const flow = this.activeFlows.get(packageId);
        if (!flow)
            return;
        try {
            logger.debug("Polling for auth completion", { package_id: packageId });
            // This is a simplified version - in reality, you'd need the actual device_code
            // For now, we'll simulate the polling process
            const expiresIn = Math.max(0, Math.floor((flow.expiresAt - Date.now()) / 1000));
            // In a real implementation, you'd store the device_code from the initial response
            // and use it here for polling
            logger.debug("Auth polling started in background", {
                package_id: packageId,
                expires_in: expiresIn,
            });
        }
        catch (error) {
            logger.error("Auth polling failed", {
                package_id: packageId,
                error: error instanceof Error ? error.message : String(error),
            });
            this.activeFlows.delete(packageId);
        }
    }
    async storeToken(packageId, token, scopes) {
        const expiresAt = Date.now() + (token.expires_in * 1000);
        const storedToken = {
            access_token: token.access_token,
            refresh_token: token.refresh_token,
            token_type: token.token_type || "Bearer",
            expires_at: expiresAt,
            scopes,
        };
        this.tokens.set(packageId, storedToken);
        // Try to store in keychain first
        try {
            await keytar.setPassword(AuthManagerImpl.SERVICE_NAME, packageId, JSON.stringify(storedToken));
            logger.debug("Token stored in keychain", { package_id: packageId });
        }
        catch (error) {
            logger.warn("Failed to store token in keychain, falling back to file", {
                package_id: packageId,
                error: error instanceof Error ? error.message : String(error),
            });
            // Fallback to file storage
            await this.storeTokenFile(packageId, storedToken);
        }
        this.activeFlows.delete(packageId);
    }
    async storeTokenFile(packageId, token) {
        if (!this.fallbackDir) {
            throw new Error("No fallback directory configured for token storage");
        }
        await fs.mkdir(this.fallbackDir, { recursive: true });
        const tokenPath = path.join(this.fallbackDir, `${packageId}.token`);
        await fs.writeFile(tokenPath, JSON.stringify(token), { mode: 0o600 });
        logger.debug("Token stored in file", {
            package_id: packageId,
            token_path: tokenPath,
        });
    }
    async getValidToken(packageId) {
        let token = this.tokens.get(packageId);
        if (!token) {
            // Try to load from keychain
            try {
                const stored = await keytar.getPassword(AuthManagerImpl.SERVICE_NAME, packageId);
                if (stored) {
                    token = JSON.parse(stored);
                    if (token) {
                        this.tokens.set(packageId, token);
                    }
                }
            }
            catch (error) {
                logger.debug("Failed to load token from keychain", {
                    package_id: packageId,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
            // Try fallback file storage
            if (!token && this.fallbackDir) {
                try {
                    const tokenPath = path.join(this.fallbackDir, `${packageId}.token`);
                    const stored = await fs.readFile(tokenPath, "utf8");
                    token = JSON.parse(stored);
                    if (token) {
                        this.tokens.set(packageId, token);
                    }
                }
                catch (error) {
                    // File doesn't exist or is invalid
                    logger.debug("Failed to load token from file", {
                        package_id: packageId,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }
        }
        if (!token) {
            return null;
        }
        // Check if token is expired
        if (Date.now() > token.expires_at) {
            logger.debug("Token expired", {
                package_id: packageId,
                expires_at: new Date(token.expires_at).toISOString(),
            });
            // TODO: Implement refresh token logic here
            this.tokens.delete(packageId);
            return null;
        }
        return token;
    }
}
