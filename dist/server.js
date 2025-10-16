import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { ERROR_CODES } from "./types.js";
import { PackageRegistry } from "./registry.js";
import { Catalog } from "./catalog.js";
import { getValidator } from "./validator.js";
import { getLogger } from "./logging.js";
import { handleGetHelp } from "./help/index.js";
import { GATEWAY_TOOLS } from "./schemas/index.js";
import { handleListToolPackages, handleListTools, handleUseTool, handleMultiUseTool, handleHealthCheckAll, handleAuthenticate, } from "./handlers/index.js";
import { setupStdioTransport, setupHttpTransport, setupSseTransport } from "./transports/index.js";
import { watch } from "node:fs";
import path from "node:path";
const logger = getLogger();
function createGatewayServer(context) {
    const server = new Server({
        name: "mcp-gateway",
        version: "0.1.0",
    }, {
        capabilities: {
            tools: {},
        },
    });
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        return { tools: GATEWAY_TOOLS };
    });
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        try {
            switch (name) {
                case "list_tool_packages":
                    return await handleListToolPackages(args, context.registry, context.catalog);
                case "list_tools":
                    return await handleListTools(args, context.catalog, context.validator);
                case "use_tool":
                    return await handleUseTool(args, context.registry, context.catalog, context.validator);
                case "multi_use_tool":
                    return await handleMultiUseTool(args, context);
                case "health_check_all":
                    return await handleHealthCheckAll(args, context.registry);
                case "authenticate":
                    return await handleAuthenticate(args, context.registry);
                case "get_help":
                    return await handleGetHelp(args, context.registry);
                default:
                    throw {
                        code: ERROR_CODES.INVALID_PARAMS,
                        message: `Unknown tool: ${name}`,
                    };
            }
        }
        catch (error) {
            logger.error("Tool execution failed", {
                tool_name: name,
                error: error instanceof Error ? error.message : String(error),
            });
            if (error && typeof error === "object" && "code" in error) {
                const errorCode = error.code;
                let helpfulMessage = error.message;
                switch (errorCode) {
                    case ERROR_CODES.PACKAGE_NOT_FOUND:
                        helpfulMessage += ". Run 'list_tool_packages()' to see available packages.";
                        break;
                    case ERROR_CODES.TOOL_NOT_FOUND:
                        helpfulMessage += ". Run 'list_tools(package_id: \"...\")' to see available tools.";
                        break;
                    case ERROR_CODES.ARG_VALIDATION_FAILED:
                        helpfulMessage += ". Use 'dry_run: true' to test arguments or 'get_help(error_code: -32003)' for detailed guidance.";
                        break;
                    case ERROR_CODES.AUTH_REQUIRED:
                        helpfulMessage += ". Run 'authenticate(package_id: \"...\")' to connect this package.";
                        break;
                    case ERROR_CODES.PACKAGE_UNAVAILABLE:
                        helpfulMessage += ". Run 'health_check_all()' to diagnose the issue.";
                        break;
                    case ERROR_CODES.DOWNSTREAM_ERROR:
                        helpfulMessage += ". Check 'get_help(error_code: -32007)' for troubleshooting steps.";
                        break;
                }
                throw {
                    ...error,
                    message: helpfulMessage,
                };
            }
            throw {
                code: ERROR_CODES.INTERNAL_ERROR,
                message: `${error instanceof Error ? error.message : String(error)}. Try 'get_help(topic: "error_handling")' for general troubleshooting.`,
                data: { tool_name: name },
            };
        }
    });
    return server;
}
export async function startServer(options) {
    const { configPath, configPaths, logLevel = "info", transport = "http", host = "127.0.0.1", port = 3001, silent = false } = options;
    const rawPaths = configPaths || (configPath ? [configPath] : ["mcp-gateway-config.json"]);
    const paths = rawPaths.map((cfgPath) => path.resolve(cfgPath));
    logger.setLevel(logLevel);
    logger.info("Starting MCP Gateway", {
        config_paths: paths,
        log_level: logLevel,
        transport,
        host,
        port,
    });
    const configWatchers = [];
    let reloadTimeout = null;
    let reloadInProgress = false;
    let reloadQueued = false;
    try {
        let registry = await PackageRegistry.fromConfigFiles(paths);
        let catalog = new Catalog(registry);
        const validator = getValidator();
        const context = {
            registry,
            catalog,
            validator,
        };
        startEagerConnections(context.registry, silent);
        const scheduleReload = () => {
            if (reloadTimeout) {
                clearTimeout(reloadTimeout);
            }
            reloadTimeout = setTimeout(() => {
                reloadTimeout = null;
                void reloadConfig();
            }, 300);
        };
        const reloadConfig = async () => {
            if (reloadInProgress) {
                reloadQueued = true;
                return;
            }
            reloadInProgress = true;
            let previousRegistry;
            try {
                logger.info("Reloading configuration", {
                    config_paths: paths,
                });
                const newRegistry = await PackageRegistry.fromConfigFiles(paths);
                const newCatalog = new Catalog(newRegistry);
                startEagerConnections(newRegistry, silent);
                previousRegistry = context.registry;
                const previousCatalog = context.catalog;
                context.registry = newRegistry;
                context.catalog = newCatalog;
                registry = newRegistry;
                catalog = newCatalog;
                if (previousRegistry && previousRegistry !== newRegistry) {
                    try {
                        await previousRegistry.closeAll();
                    }
                    catch (error) {
                        logger.debug("Failed to close previous registry", {
                            error: error instanceof Error ? error.message : String(error),
                        });
                    }
                }
                if (previousCatalog && previousCatalog !== newCatalog) {
                    previousCatalog.clear();
                }
                logger.info("Configuration reloaded successfully", {
                    package_count: context.registry.getPackages({ include_disabled: true }).length,
                });
            }
            catch (error) {
                logger.error("Failed to reload configuration", {
                    error: error instanceof Error ? error.message : String(error),
                });
            }
            finally {
                reloadInProgress = false;
                if (reloadQueued) {
                    reloadQueued = false;
                    scheduleReload();
                }
            }
        };
        for (const configPath of paths) {
            const dir = path.dirname(configPath);
            const fileName = path.basename(configPath);
            try {
                const watcher = watch(dir, { persistent: true }, (eventType, changed) => {
                    let changedName;
                    if (typeof changed === "string") {
                        changedName = changed;
                    }
                    else if (changed) {
                        changedName = changed.toString();
                    }
                    if (!changedName || path.basename(changedName) !== fileName) {
                        return;
                    }
                    logger.info("Detected configuration change", {
                        event: eventType,
                        config_path: configPath,
                    });
                    scheduleReload();
                });
                watcher.on("error", (error) => {
                    logger.warn("Configuration watcher error", {
                        config_path: configPath,
                        error: error instanceof Error ? error.message : String(error),
                    });
                });
                configWatchers.push(watcher);
            }
            catch (error) {
                logger.warn("Failed to watch configuration file", {
                    config_path: configPath,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
        if (transport === "stdio") {
            const server = createGatewayServer(context);
            await setupStdioTransport(server, {
                registry: context.registry,
                configWatchers,
            });
            return;
        }
        if (transport === "http") {
            const server = createGatewayServer(context);
            await setupHttpTransport(server, {
                registry: context.registry,
                configWatchers,
                host,
                port,
            });
            return;
        }
        await setupSseTransport({
            registry: context.registry,
            catalog: context.catalog,
            validator: context.validator,
            configWatchers,
            host,
            port,
            createGatewayServer,
        });
        return;
    }
    catch (error) {
        logger.fatal("Failed to start server", {
            error: error instanceof Error ? error.message : String(error),
        });
        throw error;
    }
}
async function connectConfiguredPackages(registry) {
    const packages = registry.getPackages();
    if (packages.length === 0) {
        logger.info("No MCP packages configured - skipping eager connections");
        return [];
    }
    logger.info("Connecting configured MCP packages", {
        package_count: packages.length,
    });
    const MAX_ATTEMPTS = 5;
    const RETRY_DELAY_MS = 10_000;
    const delay = (ms) => new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
    const isFatalConnectionError = (error) => {
        if (!(error instanceof Error)) {
            return false;
        }
        const message = error.message ?? "";
        return (message.includes("disabled") ||
            message.includes("not found") ||
            message.includes("Invalid package") ||
            message.includes("command is required") ||
            message.includes("base_url is required"));
    };
    const results = await Promise.all(packages.map(async (pkg) => {
        const startedAt = Date.now();
        let attempt = 0;
        let lastError;
        registry.setConnectionStatus(pkg.id, {
            status: "pending",
            attempts: attempt,
        });
        while (attempt < MAX_ATTEMPTS) {
            attempt += 1;
            try {
                const client = await registry.getClient(pkg.id);
                let health;
                if ("healthCheck" in client && typeof client.healthCheck === "function") {
                    try {
                        health = await client.healthCheck();
                    }
                    catch (error) {
                        logger.debug("Health check failed during eager connection", {
                            package_id: pkg.id,
                            error: error instanceof Error ? error.message : String(error),
                        });
                        health = "error";
                    }
                }
                logger.info("Package connection attempt completed", {
                    package_id: pkg.id,
                    duration_ms: Date.now() - startedAt,
                    health,
                    attempts: attempt,
                });
                registry.setConnectionStatus(pkg.id, {
                    status: "connected",
                    attempts: attempt,
                    health,
                });
                if (health === "needs_auth") {
                    logger.warn("Package requires authentication before use", {
                        package_id: pkg.id,
                        hint: `Run 'authenticate(package_id: "${pkg.id}")' to connect`,
                    });
                }
                return {
                    packageId: pkg.id,
                    packageName: pkg.name,
                    status: "connected",
                    health,
                    attempts: attempt,
                };
            }
            catch (error) {
                lastError = error;
                const fatal = isFatalConnectionError(error);
                const context = {
                    package_id: pkg.id,
                    attempt,
                    max_attempts: MAX_ATTEMPTS,
                    error: error instanceof Error ? error.message : String(error),
                };
                registry.setConnectionStatus(pkg.id, {
                    status: "pending",
                    attempts: attempt,
                    error: context.error,
                });
                if (fatal) {
                    logger.warn("Failed to connect to package during startup", context);
                    break;
                }
                if (attempt >= MAX_ATTEMPTS) {
                    logger.warn("Failed to connect to package after retries", context);
                    break;
                }
                logger.warn("Package connection attempt failed, retrying", {
                    ...context,
                    retry_in_ms: RETRY_DELAY_MS,
                });
                await delay(RETRY_DELAY_MS);
            }
        }
        const errorMessage = lastError instanceof Error ? lastError.message : String(lastError);
        registry.setConnectionStatus(pkg.id, {
            status: "failed",
            attempts: attempt,
            error: errorMessage,
        });
        return {
            packageId: pkg.id,
            packageName: pkg.name,
            status: "failed",
            attempts: attempt,
            error: errorMessage,
        };
    }));
    const connected = results.filter((result) => result.status === "connected").length;
    const failed = results.length - connected;
    logger.info("Finished eager MCP package connections", {
        connected,
        failed,
        total: packages.length,
    });
    return results;
}
function printSilentConnectionSummary(results) {
    const supportsColor = Boolean(process.stdout.isTTY);
    const greenDot = supportsColor ? "\x1b[32m●\x1b[0m" : ".";
    const redDot = supportsColor ? "\x1b[31m●\x1b[0m" : "x";
    for (const result of results) {
        if (!result) {
            continue;
        }
        const ok = result.status === "connected" &&
            (!result.health || result.health === "ok");
        const icon = ok ? greenDot : redDot;
        const label = result.packageName || result.packageId;
        console.log(`${icon} ${label}`);
    }
}
function startEagerConnections(registry, silent) {
    void (async () => {
        try {
            const results = await connectConfiguredPackages(registry);
            if (silent) {
                printSilentConnectionSummary(results);
            }
        }
        catch (error) {
            logger.error("Unexpected error during eager package connections", {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    })();
}
