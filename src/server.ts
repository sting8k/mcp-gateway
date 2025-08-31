import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  ERROR_CODES,
  ListToolPackagesInput,
  ListToolPackagesOutput,
  ListToolsInput,
  ListToolsOutput,
  UseToolInput,
  UseToolOutput,
  BeginAuthInput,
  BeginAuthOutput,
  AuthStatusInput,
  AuthStatusOutput,
} from "./types.js";
import { PackageRegistry } from "./registry.js";
import { Catalog } from "./catalog.js";
import { getValidator, ValidationError } from "./validator.js";
import { getLogger } from "./logging.js";

const logger = getLogger();

export async function startServer(options: {
  configPath: string;
  logLevel?: string;
}): Promise<void> {
  const { configPath, logLevel = "info" } = options;

  // Initialize logger
  logger.setLevel(logLevel as any);
  
  logger.info("Starting Super MCP Router", {
    config_path: configPath,
    log_level: logLevel,
  });

  try {
    // Start the OAuth callback server immediately (before any OAuth attempts)
    // OAuth is now handled by the MCP SDK directly
    
    // Load configuration and create registry
    const registry = await PackageRegistry.fromConfigFile(configPath);
    const catalog = new Catalog(registry);
    const validator = getValidator();
    const authManager = registry.getAuthManager();

    // Create MCP server
    const server = new Server(
      {
        name: "super-mcp-router",
        version: "0.1.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Add meta-tools
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "list_tool_packages",
            description: "List available tool packages (MCPs) and their basic information",
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
                  description: "Include health status for each package",
                  default: true,
                },
              },
            },
          },
          {
            name: "list_tools",
            description: "List tools available in a specific package",
            inputSchema: {
              type: "object",
              properties: {
                package_id: {
                  type: "string",
                  description: "ID of the package to list tools for",
                },
                summarize: {
                  type: "boolean",
                  description: "Include summaries and argument skeletons",
                  default: true,
                },
                include_schemas: {
                  type: "boolean",
                  description: "Include full JSON schemas for tool arguments",
                  default: false,
                },
                page_size: {
                  type: "number",
                  description: "Number of tools to return per page",
                  default: 20,
                },
                page_token: {
                  type: ["string", "null"],
                  description: "Token for pagination",
                },
              },
              required: ["package_id"],
            },
          },
          {
            name: "use_tool",
            description: "Execute a tool from a specific package",
            inputSchema: {
              type: "object",
              properties: {
                package_id: {
                  type: "string",
                  description: "ID of the package containing the tool",
                },
                tool_id: {
                  type: "string",
                  description: "ID of the tool to execute",
                },
                args: {
                  type: "object",
                  description: "Arguments to pass to the tool",
                },
                dry_run: {
                  type: "boolean",
                  description: "If true, validate arguments but don't execute",
                  default: false,
                },
              },
              required: ["package_id", "tool_id", "args"],
            },
          },
          {
            name: "health_check_all",
            description: "Check the operational status of all configured packages",
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
            description: "Authenticate an HTTP package that requires OAuth (like Notion)",
            inputSchema: {
              type: "object",
              properties: {
                package_id: {
                  type: "string",
                  description: "The package ID to authenticate",
                },
                wait_for_completion: {
                  type: "boolean",
                  description: "Whether to wait for OAuth completion",
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
            return await handleListToolPackages(args as any, registry, catalog);

          case "list_tools":
            return await handleListTools(args as any, catalog, validator);

          case "use_tool":
            return await handleUseTool(args as any, registry, catalog, validator);

          case "health_check_all":
            return await handleHealthCheckAll(args as any, registry);

          case "authenticate":
            return await handleAuthenticate(args as any, registry);

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
          throw error;
        }

        throw {
          code: ERROR_CODES.INTERNAL_ERROR,
          message: error instanceof Error ? error.message : String(error),
          data: { tool_name: name },
        };
      }
    });

    // Create transport and connect
    const transport = new StdioServerTransport();
    await server.connect(transport);

    logger.info("Super MCP Router started successfully");

    // Graceful shutdown
    process.on("SIGINT", async () => {
      logger.info("Shutting down...");
      await registry.closeAll();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      logger.info("Shutting down...");
      await registry.closeAll();
      process.exit(0);
    });
    
  } catch (error) {
    logger.fatal("Failed to start server", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function handleListToolPackages(
  input: ListToolPackagesInput,
  registry: PackageRegistry,
  catalog: Catalog
): Promise<any> {
  const { safe_only = true, limit = 100, include_health = true } = input;

  const packages = registry.getPackages({ safe_only }).slice(0, limit);
  
  const packageInfos = await Promise.all(
    packages.map(async (pkg) => {
      const toolCount = catalog.countTools(pkg.id);
      const health = include_health ? await registry.healthCheck(pkg.id) : undefined;
      const summary = await catalog.buildPackageSummary(pkg);

      const authMode: "env" | "oauth2" | "none" = pkg.transport === "http" 
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
    })
  );

  const result: ListToolPackagesOutput = {
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

async function handleListTools(
  input: ListToolsInput,
  catalog: Catalog,
  validator: any
): Promise<any> {
  const {
    package_id,
    summarize = true,
    include_schemas = false,
    page_size = 20,
    page_token,
  } = input;

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

  const result: ListToolsOutput = {
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

async function handleUseTool(
  input: UseToolInput,
  registry: PackageRegistry,
  catalog: Catalog,
  validator: any
): Promise<any> {
  const { package_id, tool_id, args, dry_run = false } = input;

  // Validate that the package exists
  const packageConfig = registry.getPackage(package_id);
  if (!packageConfig) {
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
  } catch (error) {
    if (error instanceof ValidationError) {
      throw {
        code: ERROR_CODES.ARG_VALIDATION_FAILED,
        message: error.message,
        data: {
          package_id,
          tool_id,
          errors: error.errors,
        },
      };
    }
    throw error;
  }

  // Handle dry run
  if (dry_run) {
    const result: UseToolOutput = {
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

    const result: UseToolOutput = {
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
  } catch (error) {
    const duration = Date.now() - startTime;
    throw {
      code: ERROR_CODES.DOWNSTREAM_ERROR,
      message: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
      data: {
        package_id,
        tool_id,
        duration_ms: duration,
        original_error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}


async function handleAuthStatus(
  input: AuthStatusInput,
  registry: PackageRegistry,
  authManager: any
): Promise<any> {
  const { package_id } = input;

  const packageConfig = registry.getPackage(package_id);
  if (!packageConfig) {
    throw {
      code: ERROR_CODES.PACKAGE_NOT_FOUND,
      message: `Package not found: ${package_id}`,
      data: { package_id },
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
      } else {
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
  } catch (error) {
    throw {
      code: ERROR_CODES.INTERNAL_ERROR,
      message: `Failed to get auth status: ${error instanceof Error ? error.message : String(error)}`,
      data: { package_id },
    };
  }
}

async function handleHealthCheckAll(
  input: { detailed?: boolean },
  registry: PackageRegistry
): Promise<any> {
  const { detailed = false } = input;

  logger.info("Performing health check on all packages");

  const packages = registry.getPackages({ safe_only: false });
  const results = await Promise.all(
    packages.map(async (pkg) => {
      try {
        const health = await registry.healthCheck(pkg.id);
        const client = await registry.getClient(pkg.id);
        const requiresAuth = client.requiresAuth ? await client.requiresAuth() : false;
        const isAuthenticated = requiresAuth && client.isAuthenticated ? await client.isAuthenticated() : true;

        const result: any = {
          package_id: pkg.id,
          name: pkg.name,
          transport: pkg.transport,
          status: health,
          requires_auth: requiresAuth,
          is_authenticated: isAuthenticated,
        };

        if (detailed) {
          result.description = pkg.description;
          result.visibility = pkg.visibility;
          if (pkg.transport === "http") {
            result.base_url = pkg.base_url;
          }
        }

        return result;
      } catch (error) {
        return {
          package_id: pkg.id,
          name: pkg.name,
          transport: pkg.transport,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    })
  );

  const summary = {
    total: results.length,
    healthy: results.filter((r) => r.status === "ok").length,
    errored: results.filter((r) => r.status === "error").length,
    requiring_auth: results.filter((r) => r.requires_auth).length,
    authenticated: results.filter((r) => r.is_authenticated).length,
  };

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ summary, packages: results }, null, 2),
      },
    ],
    isError: false,
  };
}

// OAuth is now handled automatically by the MCP SDK
// This function is kept for backward compatibility but simplified
async function handleAuthenticate(
  input: { package_id: string; wait_for_completion?: boolean },
  registry: PackageRegistry
): Promise<any> {
  const { package_id, wait_for_completion = true } = input;
  
  logger.info("=== AUTHENTICATE START ===", { 
    package_id,
    wait_for_completion,
    timestamp: new Date().toISOString(),
  });
  
  const pkg = registry.getPackage(package_id);
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
      } catch (error) {
        logger.info("Tool access failed, need to authenticate", { 
          package_id,
          error: error instanceof Error ? error.message : String(error),
        });
        // Fall through to re-authenticate
      }
    }
  } catch (error) {
    logger.info("Client not available or errored", { 
      package_id,
      error: error instanceof Error ? error.message : String(error),
    });
    // Continue with auth
  }
  
  // Trigger OAuth explicitly for HTTP packages  
  try {
    // Start OAuth callback server first (only if waiting for completion)
    let callbackServer: any = null;
    
    if (wait_for_completion) {
      const { OAuthCallbackServer } = await import("./auth/callbackServer.js");
      callbackServer = new OAuthCallbackServer();
      
      try {
        await callbackServer.start();
        logger.info("OAuth callback server started", { package_id });
        
        // Give the server a moment to be fully ready
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
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
    const clients = (registry as any).clients as Map<string, any>;
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
        } else {
          throw new Error("Authentication succeeded but connection failed");
        }
      } catch (error) {
        logger.error("OAuth failed", {
          package_id,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        if (callbackServer) {
          try {
            await callbackServer.stop();
            logger.info("OAuth callback server stopped", { package_id });
          } catch (err) {
            logger.debug("Error stopping callback server", { 
              package_id,
              error: err instanceof Error ? err.message : String(err)
            });
          }
        }
      }
    } else {
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
    } else {
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
  } catch (error) {
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

async function handleReconnectPackage(
  input: { package_id: string },
  registry: PackageRegistry
): Promise<any> {
  const { package_id } = input;
  
  logger.info("Attempting to reconnect package", { package_id });
  
  try {
    // Clear any existing client
    const clients = (registry as any).clients as Map<string, any>;
    clients.delete(package_id);
    
    // Clear transport pool for this package
    // const { TransportPool } = await import("./clients/transportPool.js");
    // const pool = TransportPool.getInstance();
    const pkg = registry.getPackage(package_id);
    if (pkg?.base_url) {
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
  } catch (error) {
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

async function handleAuthenticateAll(
  input: { skip_authenticated?: boolean; wait_for_completion?: boolean },
  registry: PackageRegistry
): Promise<any> {
  const { skip_authenticated = true, wait_for_completion = true } = input;

  logger.info("Attempting to authenticate all packages", {
    skip_authenticated,
    wait_for_completion,
  });
  
  // Ensure callback server is running
  // const { SimpleOAuthProvider } = await import("./auth/simpleOAuthProvider.js");
  // await SimpleOAuthProvider.startGlobalCallbackServer();
  logger.info("OAuth callback server ready on port 5173");

  const packages = registry.getPackages({ safe_only: false });
  const results = [];

  for (const pkg of packages) {
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
          } catch {
            // Need to authenticate
          }
        }
      } catch {
        // Need to authenticate
      }
    }
    
    // Authenticate this package
    console.log(`\n📦 Authenticating ${pkg.name}...`);
    
    const authResult = await handleAuthenticate(
      { package_id: pkg.id, wait_for_completion },
      registry
    );
    
    // Parse the result
    try {
      const resultData = JSON.parse(authResult.content[0].text);
      results.push({
        package_id: pkg.id,
        name: pkg.name,
        ...resultData,
      });
    } catch {
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