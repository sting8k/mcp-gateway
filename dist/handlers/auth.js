import { ERROR_CODES } from "../types.js";
import { getLogger } from "../logging.js";
const logger = getLogger();
export async function handleAuthStatus(input, registry, authManager) {
    const { package_id } = input;
    const packageConfig = registry.getPackage(package_id, { include_disabled: true });
    if (!packageConfig) {
        throw {
            code: ERROR_CODES.PACKAGE_NOT_FOUND,
            message: `Package not found: ${package_id}`,
            data: { package_id },
        };
    }
    if (packageConfig.disabled) {
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ state: "disabled" }, null, 2),
                },
            ],
            isError: false,
        };
    }
    // For stdio packages (local MCPs), authentication is handled via environment/files
    if (packageConfig.transport === "stdio") {
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ state: "authorized" }, null, 2),
                },
            ],
            isError: false,
        };
    }
    // For HTTP packages without auth config, no authentication needed
    if (packageConfig.transport === "http" && !packageConfig.auth) {
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ state: "authorized" }, null, 2),
                },
            ],
            isError: false,
        };
    }
    // For HTTP packages with auth config, check actual auth status
    try {
        // For OAuth packages, check if tokens exist and if we can connect
        if (packageConfig.oauth) {
            const client = await registry.getClient(package_id);
            const health = client.healthCheck ? await client.healthCheck() : "ok";
            if (health === "ok") {
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({ state: "authorized", connected: true }, null, 2),
                        },
                    ],
                    isError: false,
                };
            }
            else {
                // Health check failed - needs auth
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({ state: "unauthorized", connected: false }, null, 2),
                        },
                    ],
                    isError: false,
                };
            }
        }
        const result = await authManager.getAuthStatus(package_id);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
            isError: false,
        };
    }
    catch (error) {
        throw {
            code: ERROR_CODES.INTERNAL_ERROR,
            message: `Failed to get auth status: ${error instanceof Error ? error.message : String(error)}`,
            data: { package_id },
        };
    }
}
export async function handleAuthenticate(input, registry) {
    const { package_id, wait_for_completion = true } = input;
    logger.info("=== AUTHENTICATE START ===", {
        package_id,
        wait_for_completion,
        timestamp: new Date().toISOString(),
    });
    const pkg = registry.getPackage(package_id, { include_disabled: true });
    if (!pkg) {
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        package_id,
                        status: "error",
                        error: "Package not found",
                    }, null, 2),
                },
            ],
            isError: false,
        };
    }
    if (pkg.disabled) {
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        package_id,
                        status: "skipped",
                        message: "Package is disabled in configuration",
                    }, null, 2),
                },
            ],
            isError: false,
        };
    }
    // Check if it's a stdio package (no auth needed)
    if (pkg.transport === "stdio") {
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        package_id,
                        status: "success",
                        message: "stdio packages don't require authentication",
                    }, null, 2),
                },
            ],
            isError: false,
        };
    }
    try {
        // First check if already authenticated and connected
        logger.info("Checking if already authenticated", { package_id });
        const client = await registry.getClient(package_id);
        const health = client.healthCheck ? await client.healthCheck() : "ok";
        logger.info("Client health check", { package_id, health });
        if (health === "ok") {
            // Already connected, check if we can list tools
            try {
                logger.info("Testing tool access", { package_id });
                const tools = await client.listTools();
                logger.info("Tools accessible", { package_id, tool_count: tools.length });
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                package_id,
                                status: "already_authenticated",
                                message: "Package is already authenticated and connected",
                            }, null, 2),
                        },
                    ],
                    isError: false,
                };
            }
            catch (error) {
                logger.info("Tool access failed, need to authenticate", {
                    package_id,
                    error: error instanceof Error ? error.message : String(error),
                });
                // Fall through to re-authenticate
            }
        }
    }
    catch (error) {
        logger.info("Client not available or errored", {
            package_id,
            error: error instanceof Error ? error.message : String(error),
        });
        // Continue with auth
    }
    // Trigger OAuth explicitly for HTTP packages  
    try {
        // Start OAuth callback server first (only if waiting for completion)
        let callbackServer = null;
        if (wait_for_completion) {
            const { OAuthCallbackServer } = await import("../auth/callbackServer.js");
            callbackServer = new OAuthCallbackServer();
            try {
                await callbackServer.start();
                logger.info("OAuth callback server started", { package_id });
                // Give the server a moment to be fully ready
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            catch (error) {
                logger.error("Failed to start callback server", {
                    package_id,
                    error: error instanceof Error ? error.message : String(error)
                });
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                package_id,
                                status: "error",
                                message: "Failed to start OAuth callback server",
                                error: error instanceof Error ? error.message : String(error),
                            }, null, 2),
                        },
                    ],
                    isError: false,
                };
            }
        }
        // Clear existing client to force reconnection
        const clients = registry.clients;
        clients.delete(package_id);
        // Create a new HTTP client with OAuth enabled
        logger.info("Creating HTTP client with OAuth enabled", { package_id });
        const { HttpMcpClient } = await import("../clients/httpClient.js");
        const httpClient = new HttpMcpClient(package_id, pkg);
        // Trigger OAuth connection
        logger.info("Triggering OAuth connection", { package_id });
        // Try to connect with OAuth - this will open the browser
        const connectPromise = httpClient.connectWithOAuth();
        if (wait_for_completion && callbackServer) {
            // Wait for OAuth callback or timeout  
            logger.info("Waiting for OAuth callback", { package_id });
            try {
                // Start two promises:
                // 1. The OAuth connection attempt (will fail with redirect)
                // 2. Wait for the callback with the authorization code
                connectPromise.catch(err => {
                    // Expected to fail with redirect error
                    logger.debug("OAuth redirect initiated (expected)", {
                        package_id,
                        error: err instanceof Error ? err.message : String(err)
                    });
                });
                // Wait for the callback to receive the authorization code
                const callbackPromise = callbackServer.waitForCallback(60000);
                const authCode = await callbackPromise;
                logger.info("OAuth callback received", { package_id, has_code: !!authCode });
                // Use the SDK's finishAuth to complete the OAuth flow
                logger.info("Exchanging authorization code for tokens", { package_id });
                await httpClient.finishOAuth(authCode);
                // Now the client should be connected with OAuth tokens
                logger.info("OAuth flow completed, checking connection", { package_id });
                // Store the connected client
                clients.set(package_id, httpClient);
                // Check if it worked
                const health = httpClient.healthCheck ? await httpClient.healthCheck() : "ok";
                if (health === "ok") {
                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify({
                                    package_id,
                                    status: "authenticated",
                                    message: "Successfully authenticated",
                                }, null, 2),
                            },
                        ],
                        isError: false,
                    };
                }
                else {
                    throw new Error("Authentication succeeded but connection failed");
                }
            }
            catch (error) {
                logger.error("OAuth failed", {
                    package_id,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
            finally {
                if (callbackServer) {
                    try {
                        await callbackServer.stop();
                        logger.info("OAuth callback server stopped", { package_id });
                    }
                    catch (err) {
                        logger.debug("Error stopping callback server", {
                            package_id,
                            error: err instanceof Error ? err.message : String(err)
                        });
                    }
                }
            }
        }
        else {
            // Don't wait, just trigger and return
            connectPromise.catch(err => {
                logger.debug("OAuth connection error (expected)", {
                    package_id,
                    error: err instanceof Error ? err.message : String(err)
                });
            });
        }
        // Store the client even if not fully connected
        clients.set(package_id, httpClient);
        // Check current health
        const health = httpClient.healthCheck ? await httpClient.healthCheck() : "needs_auth";
        if (health === "ok") {
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            package_id,
                            status: "authenticated",
                            message: "Successfully authenticated",
                        }, null, 2),
                    },
                ],
                isError: false,
            };
        }
        else {
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            package_id,
                            status: "auth_required",
                            message: "Authentication required - check browser for OAuth prompt",
                        }, null, 2),
                    },
                ],
                isError: false,
            };
        }
    }
    catch (error) {
        logger.error("Authentication failed", {
            package_id,
            error: error instanceof Error ? error.message : String(error),
        });
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        package_id,
                        status: "error",
                        message: "Authentication failed",
                        error: error instanceof Error ? error.message : String(error),
                    }, null, 2),
                },
            ],
            isError: false,
        };
    }
}
export async function handleReconnectPackage(input, registry) {
    const { package_id } = input;
    logger.info("Attempting to reconnect package", { package_id });
    const packageConfig = registry.getPackage(package_id, { include_disabled: true });
    if (!packageConfig) {
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        package_id,
                        status: "error",
                        message: "Package not found",
                    }, null, 2),
                },
            ],
            isError: false,
        };
    }
    if (packageConfig.disabled) {
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        package_id,
                        status: "skipped",
                        message: "Package is disabled in configuration",
                    }, null, 2),
                },
            ],
            isError: false,
        };
    }
    try {
        // Clear any existing client
        const clients = registry.clients;
        clients.delete(package_id);
        // Clear transport pool for this package
        // const { TransportPool } = await import("./clients/transportPool.js");
        // const pool = TransportPool.getInstance();
        if (packageConfig.base_url) {
            // pool.clearTransport(package_id, pkg.base_url);
        }
        // Try to get a new client (will trigger reconnection)
        const client = await registry.getClient(package_id);
        const health = client.healthCheck ? await client.healthCheck() : "ok";
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        package_id,
                        status: health === "ok" ? "reconnected" : "failed",
                        health,
                    }, null, 2),
                },
            ],
            isError: false,
        };
    }
    catch (error) {
        logger.error("Failed to reconnect package", {
            package_id,
            error: error instanceof Error ? error.message : String(error),
        });
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        package_id,
                        status: "error",
                        error: error instanceof Error ? error.message : String(error),
                    }, null, 2),
                },
            ],
            isError: false,
        };
    }
}
export async function handleAuthenticateAll(input, registry) {
    const { skip_authenticated = true, wait_for_completion = true } = input;
    logger.info("Attempting to authenticate all packages", {
        skip_authenticated,
        wait_for_completion,
    });
    // Ensure callback server is running
    // const { SimpleOAuthProvider } = await import("./auth/simpleOAuthProvider.js");
    // await SimpleOAuthProvider.startGlobalCallbackServer();
    logger.info("OAuth callback server ready on port 5173");
    const packages = registry.getPackages({ safe_only: false, include_disabled: true });
    const results = [];
    for (const pkg of packages) {
        if (pkg.disabled) {
            results.push({
                package_id: pkg.id,
                name: pkg.name,
                status: "skipped",
                reason: "package disabled",
            });
            continue;
        }
        // Skip stdio packages
        if (pkg.transport === "stdio") {
            results.push({
                package_id: pkg.id,
                name: pkg.name,
                status: "skipped",
                reason: "stdio packages don't require authentication",
            });
            continue;
        }
        // Only process OAuth packages
        if (!pkg.oauth) {
            results.push({
                package_id: pkg.id,
                name: pkg.name,
                status: "skipped",
                reason: "not an OAuth package",
            });
            continue;
        }
        // Check if already authenticated
        if (skip_authenticated) {
            try {
                const client = await registry.getClient(pkg.id);
                const health = client.healthCheck ? await client.healthCheck() : "ok";
                if (health === "ok") {
                    try {
                        await client.listTools();
                        results.push({
                            package_id: pkg.id,
                            name: pkg.name,
                            status: "already_authenticated",
                            message: "Package is already authenticated and connected",
                        });
                        continue;
                    }
                    catch {
                        // Need to authenticate
                    }
                }
            }
            catch {
                // Need to authenticate
            }
        }
        // Authenticate this package
        logger.info("Authenticating package", {
            package_id: pkg.id,
            package_name: pkg.name,
        });
        const authResult = await handleAuthenticate({ package_id: pkg.id, wait_for_completion }, registry);
        // Parse the result
        try {
            const resultData = JSON.parse(authResult.content[0].text);
            results.push({
                package_id: pkg.id,
                name: pkg.name,
                ...resultData,
            });
        }
        catch {
            results.push({
                package_id: pkg.id,
                name: pkg.name,
                status: "error",
                message: "Failed to authenticate",
            });
        }
    }
    const summary = {
        total: results.length,
        skipped: results.filter(r => r.status === "skipped").length,
        already_authenticated: results.filter(r => r.status === "already_authenticated").length,
        authenticated: results.filter(r => r.status === "authenticated" || r.status === "reconnected").length,
        errors: results.filter(r => r.status === "error").length,
    };
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({ summary, results }, null, 2),
            },
        ],
        isError: false,
    };
}
