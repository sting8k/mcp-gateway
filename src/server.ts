import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  ERROR_CODES,
  ListToolPackagesInput,
  ListToolPackagesOutput,
  ListToolsInput,
  ListToolsOutput,
  UseToolInput,
  UseToolOutput,
  MultiToolCallInput,
  MultiToolCallOutput,
  MultiToolCallResult,
  MultiToolCallRequestItem,
  BeginAuthInput,
  BeginAuthOutput,
  AuthStatusInput,
  AuthStatusOutput,
} from "./types.js";
import { PackageRegistry } from "./registry.js";
import { Catalog } from "./catalog.js";
import { getValidator, ValidationError } from "./validator.js";
import { getLogger } from "./logging.js";
import { handleGetHelp } from "./help/index.js";
import { MultiToolParallelInputSchema, MultiToolParallelOutputSchema } from "./schemas/index.js";
import {
  handleListToolPackages,
  handleListTools,
  handleUseTool,
  handleMultiUseTool,
  handleAuthStatus,
  handleHealthCheckAll,
  handleAuthenticate,
  handleReconnectPackage,
  handleAuthenticateAll,
} from "./handlers/index.js";
import http from "node:http";
import { FSWatcher, watch } from "node:fs";
import path from "node:path";
import { URL } from "node:url";

const logger = getLogger();

type TransportMode = "stdio" | "sse" | "http";

interface GatewayContext {
  registry: PackageRegistry;
  catalog: Catalog;
  validator: ReturnType<typeof getValidator>;
}

function createGatewayServer(context: GatewayContext): Server {
  const server = new Server(
    {
      name: "mcp-gateway",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

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
          return await handleListToolPackages(args as any, context.registry, context.catalog);

        case "list_tools":
          return await handleListTools(args as any, context.catalog, context.validator);

        case "use_tool":
          return await handleUseTool(args as any, context.registry, context.catalog, context.validator);

        case "multi_use_tool":
          return await handleMultiUseTool(args as any, context);

        case "health_check_all":
          return await handleHealthCheckAll(args as any, context.registry);

        case "authenticate":
          return await handleAuthenticate(args as any, context.registry);

        case "get_help":
          return await handleGetHelp(args as any, context.registry);

        default:
          throw {
            code: ERROR_CODES.INVALID_PARAMS,
            message: `Unknown tool: ${name}`,
          };
      }
    } catch (error) {
      logger.error("Tool execution failed", {
        tool_name: name,
        error: error instanceof Error ? error.message : String(error),
      });

      if (error && typeof error === "object" && "code" in error) {
        const errorCode = (error as any).code;
        let helpfulMessage = (error as any).message;

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

export async function startServer(options: {
  configPath?: string;
  configPaths?: string[];
  logLevel?: string;
  transport?: TransportMode;
  host?: string;
  port?: number;
}): Promise<void> {
  const { configPath, configPaths, logLevel = "info", transport = "http", host = "127.0.0.1", port = 3001 } = options;

  const rawPaths = configPaths || (configPath ? [configPath] : ["mcp-gateway-config.json"]);
  const paths = rawPaths.map((cfgPath) => path.resolve(cfgPath));

  logger.setLevel(logLevel as any);

  logger.info("Starting MCP Gateway", {
    config_paths: paths,
    log_level: logLevel,
    transport,
    host,
    port,
  });

  const configWatchers: FSWatcher[] = [];
  const closeWatchers = () => {
    while (configWatchers.length > 0) {
      const watcher = configWatchers.pop();
      if (!watcher) {
        continue;
      }
      try {
        watcher.close();
      } catch (error) {
        logger.debug("Failed to close configuration watcher", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };

  let reloadTimeout: NodeJS.Timeout | null = null;
  let reloadInProgress = false;
  let reloadQueued = false;

  try {
    let registry = await PackageRegistry.fromConfigFiles(paths);
    let catalog = new Catalog(registry);
    const validator = getValidator();

    const context: GatewayContext = {
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
      let previousRegistry: PackageRegistry | undefined;
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
          } catch (error) {
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
      } catch (error) {
        logger.error("Failed to reload configuration", {
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
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
          let changedName: string | undefined;
          if (typeof changed === "string") {
            changedName = changed;
          } else if (changed) {
            changedName = (changed as Buffer).toString();
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
      } catch (error) {
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

      const ensureCompatibleAcceptHeader = (req: http.IncomingMessage) => {
        const rawAccept = req.headers["accept"];

        const normalize = (value: string | string[] | undefined): string[] => {
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

          const chunks: Buffer[] = [];
          if (req.method === "POST" || req.method === "DELETE") {
            await new Promise<void>((resolve, reject) => {
              req.on("data", (chunk) => {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
              });
              req.on("end", resolve);
              req.on("error", reject);
            });
          }

          let parsedBody: any = undefined;
          if (chunks.length > 0) {
            try {
              const raw = Buffer.concat(chunks).toString("utf-8");
              parsedBody = JSON.parse(raw);
            } catch (error) {
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
        } catch (error) {
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

    const sessions = new Map<string, { transport: SSEServerTransport; server: Server }>();

    const cleanupSession = async (sessionId: string) => {
      const session = sessions.get(sessionId);
      if (!session) {
        return;
      }
      sessions.delete(sessionId);
      try {
        await session.transport.close();
      } catch (error) {
        logger.debug("Error closing transport", {
          session_id: sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      try {
        await session.server.close();
      } catch (error) {
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

          const chunks: Buffer[] = [];
          await new Promise<void>((resolve, reject) => {
            req.on("data", (chunk) => {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            });
            req.on("end", resolve);
            req.on("error", reject);
          });

          let parsedBody: any = undefined;
          if (chunks.length > 0) {
            try {
              const raw = Buffer.concat(chunks).toString("utf-8");
              parsedBody = JSON.parse(raw);
            } catch (error) {
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
      } catch (error) {
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
  } catch (error) {
    logger.fatal("Failed to start server", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function connectConfiguredPackages(registry: PackageRegistry): Promise<void> {
  const packages = registry.getPackages();

  if (packages.length === 0) {
    logger.info("No MCP packages configured - skipping eager connections");
    return;
  }

  logger.info("Connecting configured MCP packages", {
    package_count: packages.length,
  });

  const results = await Promise.all(
    packages.map(async (pkg) => {
      const startedAt = Date.now();

      try {
        const client = await registry.getClient(pkg.id);
        let health: string | undefined;

        if ("healthCheck" in client && typeof client.healthCheck === "function") {
          try {
            health = await client.healthCheck();
          } catch (error) {
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
      } catch (error) {
        logger.warn("Failed to connect to package during startup", {
          package_id: pkg.id,
          error: error instanceof Error ? error.message : String(error),
        });

        return { status: "failed" };
      }
    })
  );

  const connected = results.filter((result) => result.status === "connected").length;
  const failed = results.length - connected;

  logger.info("Finished eager MCP package connections", {
    connected,
    failed,
    total: packages.length,
  });
}
