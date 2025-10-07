import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { ERROR_CODES, } from "./types.js";
import { PackageRegistry } from "./registry.js";
import { Catalog } from "./catalog.js";
import { getValidator, ValidationError } from "./validator.js";
import { getLogger } from "./logging.js";
import { handleGetHelp } from "./help/index.js";
import { MultiToolParallelInputSchema, MultiToolParallelOutputSchema } from "./schemas/index.js";
import http from "node:http";
import { watch } from "node:fs";
import path from "node:path";
import { URL } from "node:url";
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
        return {
            tools: [
                {
                    name: "list_tool_packages",
                    description: "List available MCP packages and discover their capabilities. Start here to see what tools you have access to. Each package provides a set of related tools (e.g., filesystem operations, API integrations). Returns package IDs needed for list_tools.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            safe_only: {
                                type: "boolean",
                                description: "Only return packages that are considered safe",
                                default: true,
                            },
                            limit: {
                                type: "number",
                                description: "Maximum number of packages to return",
                                default: 100,
                            },
                            include_health: {
                                type: "boolean",
                                description: "Include health status for each package (shows if package is connected and ready)",
                                default: true,
                            },
                        },
                        examples: [
                            { safe_only: true, include_health: true },
                            { limit: 10 }
                        ],
                    },
                },
                {
                    name: "list_tools",
                    description: "Explore tools within a specific package to understand what actions you can perform. Use the package_id from list_tool_packages. Returns tool names, descriptions, and argument schemas. Essential for discovering available functionality before using use_tool.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            package_id: {
                                type: "string",
                                description: "Package ID from list_tool_packages (e.g., 'filesystem', 'github', 'notion-api')",
                                examples: ["filesystem", "github", "notion-api", "brave-search"],
                            },
                            summarize: {
                                type: "boolean",
                                description: "Include summaries and argument skeletons showing expected format",
                                default: true,
                            },
                            include_schemas: {
                                type: "boolean",
                                description: "Include full JSON schemas for tool arguments (verbose, usually not needed)",
                                default: false,
                            },
                            page_size: {
                                type: "number",
                                description: "Number of tools to return per page",
                                default: 20,
                            },
                            page_token: {
                                type: ["string", "null"],
                                description: "Token for pagination (from previous response's next_page_token)",
                            },
                        },
                        required: ["package_id"],
                        examples: [
                            { package_id: "filesystem", summarize: true },
                            { package_id: "github", page_size: 10 }
                        ],
                    },
                },
                {
                    name: "use_tool",
                    description: "Execute a specific tool from a package. First use list_tool_packages to find packages, then list_tools to discover tools and their arguments, then use this to execute. The args must match the tool's schema exactly.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            package_id: {
                                type: "string",
                                description: "Package ID containing the tool (from list_tool_packages)",
                                examples: ["filesystem", "github"],
                            },
                            tool_id: {
                                type: "string",
                                description: "Tool name/ID to execute (from list_tools)",
                                examples: ["read_file", "search_repositories", "create_page"],
                            },
                            args: {
                                type: "object",
                                description: "Tool-specific arguments matching the schema from list_tools",
                                examples: [
                                    { path: "/Users/example/file.txt" },
                                    { query: "language:python stars:>100" }
                                ],
                            },
                            dry_run: {
                                type: "boolean",
                                description: "Validate arguments without executing (useful for testing)",
                                default: false,
                            },
                        },
                        required: ["package_id", "tool_id", "args"],
                        examples: [
                            {
                                package_id: "filesystem",
                                tool_id: "read_file",
                                args: { path: "/tmp/test.txt" }
                            },
                            {
                                package_id: "github",
                                tool_id: "search_repositories",
                                args: { query: "mcp tools", limit: 5 },
                                dry_run: true
                            }
                        ],
                    },
                },
                {
                    name: "multi_use_tool",
                    description: "Execute multiple tool invocations in parallel and return ordered results and diagnostics.",
                    inputSchema: MultiToolParallelInputSchema,
                    outputSchema: MultiToolParallelOutputSchema,
                },
                {
                    name: "get_help",
                    description: "Get detailed guidance on using MCP Gateway effectively. Provides step-by-step instructions, common workflows, troubleshooting tips, and best practices. Use this when you need clarification on how to accomplish tasks.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            topic: {
                                type: "string",
                                description: "Help topic to explore",
                                enum: ["getting_started", "workflow", "authentication", "tool_discovery", "error_handling", "common_patterns", "package_types"],
                                default: "getting_started",
                            },
                            package_id: {
                                type: "string",
                                description: "Get package-specific help and usage patterns",
                                examples: ["filesystem", "github", "notion-api"],
                            },
                            error_code: {
                                type: "number",
                                description: "Get help for a specific error code",
                                examples: [-32001, -32002, -32003],
                            },
                        },
                        examples: [
                            { topic: "getting_started" },
                            { topic: "workflow" },
                            { package_id: "github" },
                            { error_code: -32005 }
                        ],
                    },
                },
                {
                    name: "health_check_all",
                    description: "Check connection status and health of all configured packages. Useful for diagnosing issues or verifying which packages are available and authenticated. Shows which packages need authentication.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            detailed: {
                                type: "boolean",
                                description: "Include detailed information for each package",
                                default: false,
                            },
                        },
                    },
                },
                {
                    name: "authenticate",
                    description: "Start OAuth authentication for packages that require it (e.g., Notion, Slack). Opens browser for authorization. Use health_check_all first to see which packages need authentication.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            package_id: {
                                type: "string",
                                description: "The package ID to authenticate (must be an OAuth-enabled package)",
                                examples: ["notion-api", "slack"],
                            },
                            wait_for_completion: {
                                type: "boolean",
                                description: "Whether to wait for OAuth completion before returning",
                                default: true,
                            },
                        },
                        required: ["package_id"],
                    },
                },
            ],
        };
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
    const { configPath, configPaths, logLevel = "info", transport = "http", host = "127.0.0.1", port = 3001 } = options;
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
    const closeWatchers = () => {
        while (configWatchers.length > 0) {
            const watcher = configWatchers.pop();
            if (!watcher) {
                continue;
            }
            try {
                watcher.close();
            }
            catch (error) {
                logger.debug("Failed to close configuration watcher", {
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
    };
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
        await connectConfiguredPackages(context.registry);
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
                await connectConfiguredPackages(newRegistry);
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
            const stdioTransport = new StdioServerTransport();
            await server.connect(stdioTransport);
            logger.info("MCP Gateway started successfully (stdio mode)");
            const shutdown = async () => {
                logger.info("Shutting down...");
                closeWatchers();
                await context.registry.closeAll();
                process.exit(0);
            };
            process.on("SIGINT", shutdown);
            process.on("SIGTERM", shutdown);
            return;
        }
        if (transport === "http") {
            const streamableTransport = new StreamableHTTPServerTransport({
                sessionIdGenerator: undefined,
                enableJsonResponse: true,
                onsessioninitialized: async (sessionId) => {
                    logger.debug("Streamable HTTP session initialized", { session_id: sessionId });
                },
                onsessionclosed: async (sessionId) => {
                    logger.debug("Streamable HTTP session closed", { session_id: sessionId });
                },
            });
            const server = createGatewayServer(context);
            await server.connect(streamableTransport);
            const allowedPaths = new Set(["/", "/mcp", "/mcp/"]);
            const ensureCompatibleAcceptHeader = (req) => {
                const rawAccept = req.headers["accept"];
                const normalize = (value) => {
                    if (!value) {
                        return [];
                    }
                    if (Array.isArray(value)) {
                        return value.flatMap((entry) => entry.split(",")).map((entry) => entry.trim()).filter((entry) => entry.length > 0);
                    }
                    return value.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
                };
                const tokens = new Set(normalize(rawAccept).map((entry) => entry.toLowerCase()));
                if (!tokens.has("application/json")) {
                    tokens.add("application/json");
                }
                if (!tokens.has("text/event-stream")) {
                    tokens.add("text/event-stream");
                }
                req.headers["accept"] = Array.from(tokens).join(", ");
            };
            const httpServer = http.createServer(async (req, res) => {
                try {
                    if (!req.url) {
                        res.writeHead(404).end();
                        return;
                    }
                    const parsedUrl = new URL(req.url, `http://${req.headers.host ?? `${host}:${port}`}`);
                    logger.debug("Incoming HTTP request", {
                        method: req.method,
                        path: parsedUrl.pathname,
                        headers: req.headers,
                    });
                    if (!allowedPaths.has(parsedUrl.pathname)) {
                        res.writeHead(404).end();
                        return;
                    }
                    if (req.method === "OPTIONS") {
                        res.setHeader("Access-Control-Allow-Origin", "*");
                        res.setHeader("Access-Control-Allow-Headers", "content-type, mcp-session-id, mcp-protocol-version");
                        res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
                        res.writeHead(204).end();
                        return;
                    }
                    const chunks = [];
                    if (req.method === "POST" || req.method === "DELETE") {
                        await new Promise((resolve, reject) => {
                            req.on("data", (chunk) => {
                                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                            });
                            req.on("end", resolve);
                            req.on("error", reject);
                        });
                    }
                    let parsedBody = undefined;
                    if (chunks.length > 0) {
                        try {
                            const raw = Buffer.concat(chunks).toString("utf-8");
                            parsedBody = JSON.parse(raw);
                        }
                        catch (error) {
                            logger.debug("Failed to parse request body", {
                                error: error instanceof Error ? error.message : String(error),
                            });
                        }
                    }
                    res.setHeader("Access-Control-Allow-Origin", "*");
                    if (req.method === "POST" || req.method === "DELETE" || req.method === "GET") {
                        ensureCompatibleAcceptHeader(req);
                    }
                    await streamableTransport.handleRequest(req, res, parsedBody);
                }
                catch (error) {
                    logger.error("HTTP server error", {
                        error: error instanceof Error ? error.message : String(error),
                    });
                    if (!res.writableEnded) {
                        res.writeHead(500).end("Internal Server Error");
                    }
                }
            });
            httpServer.on("error", (error) => {
                logger.fatal("Failed to start HTTP server", {
                    error: error instanceof Error ? error.message : String(error),
                });
                process.exit(1);
            });
            httpServer.listen(port, host, () => {
                logger.info("MCP Gateway started successfully (streamable HTTP mode)", {
                    host,
                    port,
                });
            });
            const shutdown = async () => {
                logger.info("Shutting down...");
                httpServer.close();
                closeWatchers();
                await context.registry.closeAll();
                process.exit(0);
            };
            process.on("SIGINT", shutdown);
            process.on("SIGTERM", shutdown);
            return;
        }
        const sessions = new Map();
        const cleanupSession = async (sessionId) => {
            const session = sessions.get(sessionId);
            if (!session) {
                return;
            }
            sessions.delete(sessionId);
            try {
                await session.transport.close();
            }
            catch (error) {
                logger.debug("Error closing transport", {
                    session_id: sessionId,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
            try {
                await session.server.close();
            }
            catch (error) {
                logger.debug("Error closing session server", {
                    session_id: sessionId,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        };
        const sseServer = http.createServer(async (req, res) => {
            try {
                if (!req.url) {
                    res.writeHead(404).end();
                    return;
                }
                const parsedUrl = new URL(req.url, `http://${req.headers.host ?? `${host}:${port}`}`);
                if (req.method === "OPTIONS") {
                    res.setHeader("Access-Control-Allow-Origin", "*");
                    res.setHeader("Access-Control-Allow-Headers", "content-type");
                    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
                    res.writeHead(204).end();
                    return;
                }
                const isSseStreamPath = parsedUrl.pathname === "/events" || parsedUrl.pathname === "/sse";
                if (req.method === "GET" && isSseStreamPath) {
                    res.setHeader("Access-Control-Allow-Origin", "*");
                    res.setHeader("Cache-Control", "no-cache, no-transform");
                    const transportInstance = new SSEServerTransport("/transport", res);
                    const gatewayServer = createGatewayServer(context);
                    sessions.set(transportInstance.sessionId, { transport: transportInstance, server: gatewayServer });
                    transportInstance.onclose = () => {
                        cleanupSession(transportInstance.sessionId).catch((error) => {
                            logger.debug("Failed to cleanup session", {
                                session_id: transportInstance.sessionId,
                                error: error instanceof Error ? error.message : String(error),
                            });
                        });
                    };
                    transportInstance.onerror = (error) => {
                        logger.error("SSE transport error", {
                            session_id: transportInstance.sessionId,
                            error: error instanceof Error ? error.message : String(error),
                        });
                    };
                    gatewayServer.onclose = () => {
                        cleanupSession(transportInstance.sessionId).catch(() => undefined);
                    };
                    gatewayServer.onerror = (error) => {
                        logger.error("Server error", {
                            session_id: transportInstance.sessionId,
                            error: error instanceof Error ? error.message : String(error),
                        });
                    };
                    await gatewayServer.connect(transportInstance);
                    logger.info("SSE session established", {
                        session_id: transportInstance.sessionId,
                    });
                    return;
                }
                if (req.method === "POST" && parsedUrl.pathname === "/transport") {
                    const sessionId = parsedUrl.searchParams.get("sessionId");
                    if (!sessionId) {
                        res.writeHead(400).end("Missing sessionId");
                        return;
                    }
                    const session = sessions.get(sessionId);
                    if (!session) {
                        res.writeHead(404).end("Unknown session");
                        return;
                    }
                    const chunks = [];
                    await new Promise((resolve, reject) => {
                        req.on("data", (chunk) => {
                            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                        });
                        req.on("end", resolve);
                        req.on("error", reject);
                    });
                    let parsedBody = undefined;
                    if (chunks.length > 0) {
                        try {
                            const raw = Buffer.concat(chunks).toString("utf-8");
                            parsedBody = JSON.parse(raw);
                        }
                        catch (error) {
                            res.writeHead(400).end("Invalid JSON");
                            logger.debug("Failed to parse POST body", {
                                session_id: sessionId,
                                error: error instanceof Error ? error.message : String(error),
                            });
                            return;
                        }
                    }
                    res.setHeader("Access-Control-Allow-Origin", "*");
                    await session.transport.handlePostMessage(req, res, parsedBody);
                    return;
                }
                res.writeHead(404).end();
            }
            catch (error) {
                logger.error("HTTP server error", {
                    error: error instanceof Error ? error.message : String(error),
                });
                if (!res.writableEnded) {
                    res.writeHead(500).end("Internal Server Error");
                }
            }
        });
        sseServer.on("error", (error) => {
            logger.fatal("Failed to start SSE server", {
                error: error instanceof Error ? error.message : String(error),
            });
            process.exit(1);
        });
        sseServer.listen(port, host, () => {
            logger.info("MCP Gateway started successfully (SSE mode)", {
                host,
                port,
            });
        });
        const shutdown = async () => {
            logger.info("Shutting down...");
            sseServer.close();
            closeWatchers();
            await context.registry.closeAll();
            for (const sessionId of Array.from(sessions.keys())) {
                await cleanupSession(sessionId);
            }
            process.exit(0);
        };
        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);
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
        return;
    }
    logger.info("Connecting configured MCP packages", {
        package_count: packages.length,
    });
    const results = await Promise.all(packages.map(async (pkg) => {
        const startedAt = Date.now();
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
            });
            if (health === "needs_auth") {
                logger.warn("Package requires authentication before use", {
                    package_id: pkg.id,
                    hint: `Run 'authenticate(package_id: "${pkg.id}")' to connect`,
                });
            }
            return { status: "connected", health };
        }
        catch (error) {
            logger.warn("Failed to connect to package during startup", {
                package_id: pkg.id,
                error: error instanceof Error ? error.message : String(error),
            });
            return { status: "failed" };
        }
    }));
    const connected = results.filter((result) => result.status === "connected").length;
    const failed = results.length - connected;
    logger.info("Finished eager MCP package connections", {
        connected,
        failed,
        total: packages.length,
    });
}
async function handleListToolPackages(input, registry, catalog) {
    const { safe_only = true, limit = 100, include_health = true } = input;
    const packages = registry.getPackages({ safe_only }).slice(0, limit);
    const packageInfos = await Promise.all(packages.map(async (pkg) => {
        const toolCount = catalog.countTools(pkg.id);
        const health = include_health ? await registry.healthCheck(pkg.id) : undefined;
        const summary = await catalog.buildPackageSummary(pkg);
        const authMode = pkg.transport === "http"
            ? (pkg.auth?.mode ?? "none")
            : "env";
        return {
            package_id: pkg.id,
            name: pkg.name,
            description: pkg.description,
            transport: pkg.transport,
            auth_mode: authMode,
            tool_count: toolCount,
            health,
            summary: pkg.description || summary,
            visibility: pkg.visibility,
        };
    }));
    const result = {
        packages: packageInfos,
        catalog_etag: catalog.etag(),
        updated_at: new Date().toISOString(),
    };
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
async function handleListTools(input, catalog, validator) {
    const { package_id, summarize = true, include_schemas = false, page_size = 20, page_token, } = input;
    const toolInfos = await catalog.buildToolInfos(package_id, {
        summarize,
        include_schemas,
    });
    // Apply pagination
    const startIndex = page_token ?
        Math.max(0, parseInt(Buffer.from(page_token, 'base64').toString('utf8'))) : 0;
    const endIndex = startIndex + page_size;
    const tools = toolInfos.slice(startIndex, endIndex);
    const nextToken = endIndex < toolInfos.length ?
        Buffer.from(endIndex.toString()).toString('base64') : null;
    const result = {
        tools,
        next_page_token: nextToken,
    };
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
async function handleUseTool(input, registry, catalog, validator) {
    const { package_id, tool_id, args, dry_run = false } = input;
    // Validate that the package exists
    const packageConfig = registry.getPackage(package_id);
    if (!packageConfig) {
        const disabledConfig = registry.getPackage(package_id, { include_disabled: true });
        if (disabledConfig?.disabled) {
            throw {
                code: ERROR_CODES.PACKAGE_UNAVAILABLE,
                message: `Package ${package_id} is disabled in configuration`,
                data: { package_id },
            };
        }
        throw {
            code: ERROR_CODES.PACKAGE_NOT_FOUND,
            message: `Package not found: ${package_id}`,
            data: { package_id },
        };
    }
    // Get and validate the tool schema
    const schema = await catalog.getToolSchema(package_id, tool_id);
    if (!schema) {
        throw {
            code: ERROR_CODES.TOOL_NOT_FOUND,
            message: `Tool not found: ${tool_id} in package ${package_id}`,
            data: { package_id, tool_id },
        };
    }
    // Validate arguments
    try {
        validator.validate(schema, args, { package_id, tool_id });
    }
    catch (error) {
        if (error instanceof ValidationError) {
            // Build a helpful error message
            let helpMessage = `Argument validation failed for tool '${tool_id}' in package '${package_id}'.\n`;
            helpMessage += `\n${error.message}\n`;
            // Add specific guidance based on validation errors
            if (error.errors && error.errors.length > 0) {
                helpMessage += `\nValidation errors:`;
                error.errors.forEach((err) => {
                    const path = err.instancePath || "root";
                    helpMessage += `\n  • ${path}: ${err.message}`;
                    // Add specific suggestions
                    if (err.keyword === "required") {
                        helpMessage += ` (missing: ${err.params?.missingProperty})`;
                    }
                    else if (err.keyword === "type") {
                        helpMessage += ` (expected: ${err.params?.type}, got: ${typeof err.data})`;
                    }
                    else if (err.keyword === "enum") {
                        helpMessage += ` (allowed values: ${err.params?.allowedValues?.join(", ")})`;
                    }
                });
            }
            helpMessage += `\n\nTo see the correct schema, run:`;
            helpMessage += `\n  list_tools(package_id: "${package_id}", include_schemas: true)`;
            helpMessage += `\n\nTo test your arguments without executing:`;
            helpMessage += `\n  use_tool(package_id: "${package_id}", tool_id: "${tool_id}", args: {...}, dry_run: true)`;
            throw {
                code: ERROR_CODES.ARG_VALIDATION_FAILED,
                message: helpMessage,
                data: {
                    package_id,
                    tool_id,
                    errors: error.errors,
                    provided_args: args ? Object.keys(args) : [],
                },
            };
        }
        throw error;
    }
    // Handle dry run
    if (dry_run) {
        const result = {
            package_id,
            tool_id,
            args_used: args,
            result: { dry_run: true },
            telemetry: { duration_ms: 0, status: "ok" },
        };
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
    // Execute the tool
    const startTime = Date.now();
    try {
        const client = await registry.getClient(package_id);
        const toolResult = await client.callTool(tool_id, args);
        const duration = Date.now() - startTime;
        const result = {
            package_id,
            tool_id,
            args_used: args,
            result: toolResult,
            telemetry: { duration_ms: duration, status: "ok" },
        };
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
        const duration = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : String(error);
        // Build helpful diagnostic message
        let diagnosticMessage = `Tool execution failed in package '${package_id}', tool '${tool_id}'.\n`;
        // Add specific error context
        if (errorMessage.includes("not found") || errorMessage.includes("undefined")) {
            diagnosticMessage += `\n❌ Tool might not exist or package not properly connected`;
            diagnosticMessage += `\nTroubleshooting:`;
            diagnosticMessage += `\n  1. Run 'health_check_all()' to verify package status`;
            diagnosticMessage += `\n  2. Run 'list_tools(package_id: "${package_id}")' to see available tools`;
            diagnosticMessage += `\n  3. Check if the tool name is correct (case-sensitive)`;
        }
        else if (errorMessage.includes("timeout")) {
            diagnosticMessage += `\n❌ Tool execution timed out after ${duration}ms`;
            diagnosticMessage += `\nThis might indicate:`;
            diagnosticMessage += `\n  1. The operation is taking longer than expected`;
            diagnosticMessage += `\n  2. The MCP server is not responding`;
            diagnosticMessage += `\n  3. Network issues (for HTTP-based MCPs)`;
        }
        else if (errorMessage.includes("permission") || errorMessage.includes("denied")) {
            diagnosticMessage += `\n❌ Permission denied`;
            diagnosticMessage += `\nPossible causes:`;
            diagnosticMessage += `\n  1. Insufficient permissions for the requested operation`;
            diagnosticMessage += `\n  2. API key/token lacks required scopes`;
            diagnosticMessage += `\n  3. File system permissions (for filesystem MCPs)`;
        }
        else if (errorMessage.includes("auth") || errorMessage.includes("401") || errorMessage.includes("403")) {
            diagnosticMessage += `\n❌ Authentication/Authorization error`;
            diagnosticMessage += `\nTroubleshooting:`;
            diagnosticMessage += `\n  1. Check if API keys/tokens are valid`;
            diagnosticMessage += `\n  2. Run 'authenticate(package_id: "${package_id}")' if OAuth-based`;
            diagnosticMessage += `\n  3. Verify credentials have required permissions`;
        }
        else {
            diagnosticMessage += `\n❌ ${errorMessage}`;
        }
        // Add execution context
        diagnosticMessage += `\n\nExecution context:`;
        diagnosticMessage += `\n  Package: ${package_id}`;
        diagnosticMessage += `\n  Tool: ${tool_id}`;
        diagnosticMessage += `\n  Duration: ${duration}ms`;
        if (args && Object.keys(args).length > 0) {
            diagnosticMessage += `\n  Arguments provided: ${Object.keys(args).join(", ")}`;
        }
        throw {
            code: ERROR_CODES.DOWNSTREAM_ERROR,
            message: diagnosticMessage,
            data: {
                package_id,
                tool_id,
                duration_ms: duration,
                original_error: errorMessage,
                args_provided: args ? Object.keys(args) : [],
            },
        };
    }
}
async function handleMultiUseTool(input, context) {
    const totalRequests = input.requests.length;
    const results = new Array(totalRequests);
    const effectiveConcurrency = Math.max(1, Math.min(typeof input.concurrency === "number" && input.concurrency > 0
        ? input.concurrency
        : totalRequests, totalRequests));
    const deadline = typeof input.timeout_ms === "number" ? Date.now() + input.timeout_ms : undefined;
    let nextIndex = 0;
    const worker = async () => {
        while (true) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            if (currentIndex >= totalRequests) {
                break;
            }
            const request = input.requests[currentIndex];
            if (deadline && Date.now() > deadline) {
                results[currentIndex] = createMultiToolTimeoutResult(request);
                continue;
            }
            const callStart = Date.now();
            const useToolInput = {
                package_id: request.package_id,
                tool_id: request.tool_id,
                args: request.args ?? {},
                dry_run: request.dry_run ?? false,
            };
            try {
                const response = await handleUseTool(useToolInput, context.registry, context.catalog, context.validator);
                const payload = extractUseToolPayload(response);
                results[currentIndex] = {
                    status: "ok",
                    request_id: request.request_id,
                    ...payload,
                };
            }
            catch (error) {
                const duration = Date.now() - callStart;
                const normalized = normalizeMultiToolError(error);
                results[currentIndex] = {
                    status: "error",
                    request_id: request.request_id,
                    package_id: request.package_id,
                    tool_id: request.tool_id,
                    error: normalized,
                    telemetry: {
                        duration_ms: duration,
                        status: "error",
                    },
                };
            }
        }
    };
    await Promise.all(Array.from({ length: effectiveConcurrency }, () => worker()));
    for (let i = 0; i < totalRequests; i += 1) {
        if (!results[i]) {
            results[i] = createMultiToolTimeoutResult(input.requests[i]);
        }
    }
    const output = { results };
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(output, null, 2),
            },
        ],
        isError: false,
        structuredContent: output,
    };
}
function extractUseToolPayload(response) {
    const textEntry = Array.isArray(response?.content)
        ? response.content.find((item) => typeof item?.text === "string")
        : undefined;
    if (!textEntry) {
        throw {
            code: ERROR_CODES.INTERNAL_ERROR,
            message: "Invalid response format returned from use_tool handler",
        };
    }
    try {
        return JSON.parse(textEntry.text);
    }
    catch (error) {
        throw {
            code: ERROR_CODES.INTERNAL_ERROR,
            message: "Failed to parse use_tool handler response payload",
            data: {
                error: error instanceof Error ? error.message : String(error),
            },
        };
    }
}
function normalizeMultiToolError(error) {
    if (error instanceof ValidationError) {
        return {
            code: error.code,
            message: error.message,
            data: { errors: error.errors },
        };
    }
    if (error && typeof error === "object") {
        const maybeCode = error.code;
        const maybeMessage = error.message;
        const maybeData = error.data;
        if (typeof maybeCode === "number" && typeof maybeMessage === "string") {
            return maybeData !== undefined
                ? { code: maybeCode, message: maybeMessage, data: maybeData }
                : { code: maybeCode, message: maybeMessage };
        }
    }
    if (error instanceof Error) {
        return {
            code: ERROR_CODES.DOWNSTREAM_ERROR,
            message: error.message,
        };
    }
    return {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: String(error),
    };
}
function createMultiToolTimeoutResult(request) {
    return {
        status: "error",
        request_id: request.request_id,
        package_id: request.package_id,
        tool_id: request.tool_id,
        error: {
            code: ERROR_CODES.DOWNSTREAM_ERROR,
            message: "Batch timeout reached before request execution",
            data: { reason: "batch_timeout" },
        },
        telemetry: {
            duration_ms: 0,
            status: "error",
        },
    };
}
async function handleAuthStatus(input, registry, authManager) {
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
async function handleHealthCheckAll(input, registry) {
    const { detailed = false } = input;
    logger.info("Performing health check on all packages");
    const packages = registry.getPackages({ safe_only: false, include_disabled: true });
    const results = await Promise.all(packages.map(async (pkg) => {
        if (pkg.disabled) {
            return {
                package_id: pkg.id,
                name: pkg.name,
                transport: pkg.transport,
                status: "disabled",
                diagnostic: "Package is disabled in configuration",
            };
        }
        try {
            const health = await registry.healthCheck(pkg.id);
            const client = await registry.getClient(pkg.id);
            const requiresAuth = client.requiresAuth ? await client.requiresAuth() : false;
            const isAuthenticated = requiresAuth && client.isAuthenticated ? await client.isAuthenticated() : true;
            const result = {
                package_id: pkg.id,
                name: pkg.name,
                transport: pkg.transport,
                status: health,
                requires_auth: requiresAuth,
                is_authenticated: isAuthenticated,
            };
            // Add diagnostic information for problematic packages
            if (health !== "ok") {
                result.diagnostic = "Package is not healthy";
                if (health === "unavailable") {
                    result.suggested_actions = [];
                    if (pkg.transport === "stdio") {
                        result.suggested_actions.push(`Check if '${pkg.command}' is installed`);
                        if (pkg.command === "npx" && pkg.args?.[0]) {
                            result.suggested_actions.push(`Try: npm install -g ${pkg.args[0]}`);
                        }
                    }
                    else if (pkg.transport === "http") {
                        result.suggested_actions.push(`Check network connectivity to ${pkg.base_url}`);
                        if (requiresAuth && !isAuthenticated) {
                            result.suggested_actions.push(`Run: authenticate(package_id: "${pkg.id}")`);
                        }
                    }
                }
            }
            // Check for environment variable issues
            if (pkg.env) {
                const envIssues = [];
                for (const [key, value] of Object.entries(pkg.env)) {
                    if (!value || value === "" || value.includes("YOUR_") || value.startsWith("${")) {
                        envIssues.push(`${key} appears unset or invalid`);
                    }
                }
                if (envIssues.length > 0) {
                    result.env_issues = envIssues;
                }
            }
            if (detailed) {
                result.description = pkg.description;
                result.visibility = pkg.visibility;
                if (pkg.transport === "http") {
                    result.base_url = pkg.base_url;
                }
                if (pkg.transport === "stdio") {
                    result.command = pkg.command;
                    result.args = pkg.args;
                }
            }
            return result;
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const diagnostic = {
                package_id: pkg.id,
                name: pkg.name,
                transport: pkg.transport,
                status: "error",
                error: errorMessage,
                diagnostic: "Failed to check package health",
                suggested_actions: []
            };
            // Add specific suggestions based on error
            if (errorMessage.includes("ENOENT") || errorMessage.includes("not found")) {
                diagnostic.suggested_actions.push(`Install the MCP server: ${pkg.command}`);
            }
            else if (errorMessage.includes("EACCES") || errorMessage.includes("permission")) {
                diagnostic.suggested_actions.push(`Check file permissions for: ${pkg.command}`);
            }
            else if (errorMessage.includes("auth")) {
                diagnostic.suggested_actions.push(`Check authentication credentials`);
            }
            return diagnostic;
        }
    }));
    const summary = {
        total: results.length,
        healthy: results.filter((r) => r.status === "ok").length,
        errored: results.filter((r) => r.status === "error").length,
        unavailable: results.filter((r) => r.status === "unavailable").length,
        disabled: results.filter((r) => r.status === "disabled").length,
        requiring_auth: results.filter((r) => r.requires_auth).length,
        authenticated: results.filter((r) => r.is_authenticated).length,
        with_env_issues: results.filter((r) => r.env_issues && r.env_issues.length > 0).length,
    };
    // Add overall recommendations
    const recommendations = [];
    if (summary.errored > 0) {
        recommendations.push("Some packages have errors - check the 'suggested_actions' for each");
    }
    if (summary.unavailable > 0) {
        recommendations.push("Some packages are unavailable - they may need installation or authentication");
    }
    if (summary.with_env_issues > 0) {
        recommendations.push("Some packages have environment variable issues - check 'env_issues' for details");
    }
    if (summary.disabled > 0) {
        recommendations.push("Some packages are disabled - update your configuration to enable them if needed");
    }
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    summary,
                    recommendations: recommendations.length > 0 ? recommendations : undefined,
                    packages: results
                }, null, 2),
            },
        ],
        isError: false,
    };
}
// OAuth is now handled automatically by the MCP SDK
// This function is kept for backward compatibility but simplified
async function handleAuthenticate(input, registry) {
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
            const { OAuthCallbackServer } = await import("./auth/callbackServer.js");
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
        const { HttpMcpClient } = await import("./clients/httpClient.js");
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
async function handleReconnectPackage(input, registry) {
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
async function handleAuthenticateAll(input, registry) {
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
export { handleUseTool, handleMultiUseTool, };
