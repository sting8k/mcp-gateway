import * as fs from "fs/promises";
import { SuperMcpConfig, PackageConfig, McpClient, StandardServerConfig, ExtendedServerConfig } from "./types.js";
import { StdioMcpClient } from "./clients/stdioClient.js";
import { HttpMcpClient } from "./clients/httpClient.js";
import { AuthManagerImpl } from "./auth/manager.js";
import { getLogger } from "./logging.js";

const logger = getLogger();

/**
 * Expands environment variables in a configuration object.
 * Supports ${VAR} syntax for environment variable substitution.
 * Returns undefined if input is undefined to maintain compatibility.
 */
function expandEnvironmentVariables(env?: Record<string, string>, packageId?: string): Record<string, string> | undefined {
  if (!env) return undefined;
  
  const expanded: Record<string, string> = {};
  const warnings: string[] = [];
  
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      // Support ${VAR} syntax for environment variable expansion
      // Also support $VAR syntax for convenience
      expanded[key] = value
        .replace(/\$\{([^}]+)\}/g, (match, varName) => {
          const envValue = process.env[varName];
          if (envValue !== undefined) {
            logger.debug("Expanded environment variable", {
              package_id: packageId,
              key,
              var_name: varName,
              original: match,
              // Don't log the actual value for security
              has_value: true
            });
            return envValue;
          }
          const warning = `${packageId ? `[${packageId}] ` : ''}Environment variable '${varName}' not found for key '${key}'`;
          warnings.push(warning);
          logger.warn("Environment variable not found", {
            package_id: packageId,
            key,
            var_name: varName,
            original: match,
            suggestion: `Set the environment variable: export ${varName}="your-value"`
          });
          return match; // Keep original if not found
        })
        .replace(/\$([A-Z_][A-Z0-9_]*)/g, (match, varName) => {
          const envValue = process.env[varName];
          if (envValue !== undefined) {
            logger.debug("Expanded environment variable", {
              package_id: packageId,
              key,
              var_name: varName,
              original: match,
              has_value: true
            });
            return envValue;
          }
          // Don't warn for simple $VAR as it might be intentional
          return match;
        });
        
      // Check for common API key patterns that look invalid
      if (expanded[key] && (key.includes('TOKEN') || key.includes('KEY') || key.includes('SECRET'))) {
        if (expanded[key].startsWith('${') || expanded[key] === 'YOUR_TOKEN' || 
            expanded[key] === 'YOUR_API_KEY' || expanded[key].includes('YOUR_')) {
          warnings.push(`${packageId ? `[${packageId}] ` : ''}${key} appears to be unset or using a placeholder value`);
        }
      }
    } else {
      expanded[key] = value;
    }
  }
  
  // Store warnings for later use
  if (warnings.length > 0 && packageId) {
    (expanded as any).__warnings = warnings;
  }
  
  return expanded;
}

export class PackageRegistry {
  private config: SuperMcpConfig;
  private packages: PackageConfig[];
  private clients: Map<string, McpClient> = new Map();
  private clientPromises: Map<string, Promise<McpClient>> = new Map();
  private authManager: AuthManagerImpl;

  constructor(config: SuperMcpConfig, authManager: AuthManagerImpl) {
    this.config = config;
    this.packages = this.normalizeConfig(config);
    this.authManager = authManager;
  }

  private normalizeConfig(config: SuperMcpConfig): PackageConfig[] {
    // If using legacy packages format, expand env vars and return
    if (config.packages) {
      return config.packages.map(pkg => ({
        ...pkg,
        env: expandEnvironmentVariables(pkg.env, pkg.id),
        disabled: pkg.disabled === true,
      }));
    }

    // Convert standard mcpServers format to our internal format
    if (config.mcpServers) {
      const packages: PackageConfig[] = [];
      
      for (const [id, serverConfig] of Object.entries(config.mcpServers)) {
        const extConfig = serverConfig as ExtendedServerConfig;
        
        // Determine transport type
        let transport: "stdio" | "http" = "stdio";
        let transportType: "sse" | "http" | undefined;
        let baseUrl: string | undefined;
        
        if (extConfig.type === "sse" || extConfig.type === "http" || extConfig.url) {
          transport = "http";
          baseUrl = extConfig.url;
          
          // Preserve the specific HTTP transport type from config
          if (extConfig.type === "sse") {
            // HTTP+SSE transport (deprecated as of MCP spec 2025-03-26)
            transportType = "sse";
          } else {
            // Default to Streamable HTTP for "http" type or when type is omitted
            // Streamable HTTP replaced HTTP+SSE as of MCP spec 2025-03-26
            transportType = "http";
          }
        }
        
        const pkg: PackageConfig = {
          id,
          name: extConfig.name || id,
          description: extConfig.description,
          transport,
          transportType,
          command: extConfig.command,
          args: extConfig.args,
          env: expandEnvironmentVariables(extConfig.env, id),
          cwd: extConfig.cwd,
          base_url: baseUrl,
          auth: extConfig.auth,
          extra_headers: extConfig.headers,
          visibility: extConfig.visibility || "default",
          oauth: extConfig.oauth,
          disabled: extConfig.disabled === true,
        };
        
        packages.push(pkg);
      }
      
      return packages;
    }

    return [];
  }

  static async fromConfigFile(configPath: string): Promise<PackageRegistry> {
    return PackageRegistry.fromConfigFiles([configPath]);
  }

  static async fromConfigFiles(configPaths: string[]): Promise<PackageRegistry> {
    logger.info("Loading configurations", { config_paths: configPaths });

    // Merged configuration
    const mergedConfig: SuperMcpConfig = {
      mcpServers: {}
    };

    // Load and merge all config files
    for (const configPath of configPaths) {
      try {
        logger.info("Loading config file", { path: configPath });
        const configData = await fs.readFile(configPath, "utf8");
        const config: SuperMcpConfig = JSON.parse(configData);

        // Merge mcpServers
        if (config.mcpServers) {
          for (const [id, server] of Object.entries(config.mcpServers)) {
            if (mergedConfig.mcpServers![id]) {
              logger.warn("Duplicate server ID found, later config overrides", { 
                id, 
                config_file: configPath 
              });
            }
            mergedConfig.mcpServers![id] = server;
          }
        }

        // Handle legacy packages format
        if (config.packages) {
          logger.warn("Legacy 'packages' format detected, converting to mcpServers", {
            config_file: configPath
          });
          for (const pkg of config.packages) {
            mergedConfig.mcpServers![pkg.id] = {
              command: pkg.command,
              args: pkg.args,
              env: pkg.env,
              cwd: pkg.cwd,
              type: pkg.transport === "http" ? (pkg.transportType || "http") : undefined,
              url: pkg.base_url,
              headers: pkg.extra_headers,
              name: pkg.name,
              description: pkg.description,
              visibility: pkg.visibility,
              oauth: pkg.oauth,
              auth: pkg.auth,
              disabled: pkg.disabled,
            } as any;
          }
        }
      } catch (error: any) {
        logger.error("Failed to load config file", { 
          path: configPath, 
          error: error.message 
        });
        throw new Error(`Failed to load config file ${configPath}: ${error.message}`);
      }
    }

    const authManager = new AuthManagerImpl();
    const registry = new PackageRegistry(mergedConfig, authManager);

    // Validate normalized config
    PackageRegistry.validateConfig(registry.packages);

    // Check for placeholder values
    PackageRegistry.checkForPlaceholders(registry.packages);

    logger.info("Configurations loaded successfully", {
      config_count: configPaths.length,
      total_packages: registry.packages.length,
      packages: registry.packages.map(p => ({ id: p.id, transport: p.transport })),
    });

    return registry;
  }

  private static validateConfig(packages: PackageConfig[]): void {
    if (!Array.isArray(packages)) {
      throw new Error("Invalid configuration: packages must be an array");
    }

    // Allow empty configs - MCP Gateway can run without any MCPs configured
    if (packages.length === 0) {
      logger.info("No MCP servers configured - MCP Gateway running in minimal mode");
      return;
    }

    const seenIds = new Set<string>();
    
    for (const pkg of packages) {
      if (!pkg.id || typeof pkg.id !== "string") {
        throw new Error("Invalid package: id is required and must be a string");
      }

      if (seenIds.has(pkg.id)) {
        throw new Error(`Duplicate package ID: ${pkg.id}`);
      }
      seenIds.add(pkg.id);

      if (!pkg.name || typeof pkg.name !== "string") {
        throw new Error(`Invalid package ${pkg.id}: name is required and must be a string`);
      }

      const isDisabled = pkg.disabled === true;

      if (pkg.transport !== "stdio" && pkg.transport !== "http") {
        throw new Error(`Invalid package ${pkg.id}: transport must be "stdio" or "http"`);
      }

      if (isDisabled) {
        continue;
      }

      if (pkg.transport === "stdio") {
        if (!pkg.command || typeof pkg.command !== "string") {
          throw new Error(`Invalid stdio package ${pkg.id}: command is required and must be a string`);
        }
      }

      if (pkg.transport === "http") {
        if (!pkg.base_url || typeof pkg.base_url !== "string") {
          throw new Error(`Invalid http package ${pkg.id}: base_url is required and must be a string`);
        }

        try {
          new URL(pkg.base_url);
        } catch {
          throw new Error(`Invalid http package ${pkg.id}: base_url must be a valid URL`);
        }
      }

      if (pkg.visibility && pkg.visibility !== "default" && pkg.visibility !== "hidden") {
        throw new Error(`Invalid package ${pkg.id}: visibility must be "default" or "hidden"`);
      }
    }
  }

  private static checkForPlaceholders(packages: PackageConfig[]): void {
    const placeholders = ["YOUR_CLIENT_ID", "YOUR_SECRET", "YOUR_TOKEN"];
    
    for (const pkg of packages) {
      if (pkg.disabled) {
        continue;
      }
      const configStr = JSON.stringify(pkg);
      for (const placeholder of placeholders) {
        if (configStr.includes(placeholder)) {
          logger.warn(`Package ${pkg.id} contains placeholder value: ${placeholder}`, {
            package_id: pkg.id,
          });
          // Mark this package as unavailable
          // This could be handled by adding a status field to the package
        }
      }
    }
  }

  getPackages(options: { safe_only?: boolean; include_disabled?: boolean } = {}): PackageConfig[] {
    const { safe_only = false, include_disabled = false } = options;

    let packages = include_disabled ? [...this.packages] : this.packages.filter(pkg => !pkg.disabled);

    if (safe_only) {
      // Filter out packages that might be unsafe or have placeholder values
      packages = packages.filter(pkg => {
        const configStr = JSON.stringify(pkg);
        const hasPlaceholders = ["YOUR_CLIENT_ID", "YOUR_SECRET", "YOUR_TOKEN"]
          .some(placeholder => configStr.includes(placeholder));
        return !hasPlaceholders;
      });
    }

    return packages;
  }

  getPackage(packageId: string, options: { include_disabled?: boolean } = {}): PackageConfig | undefined {
    const pkg = this.packages.find(pkg => pkg.id === packageId);
    if (!pkg) {
      return undefined;
    }
    if (pkg.disabled && !options.include_disabled) {
      return undefined;
    }
    return pkg;
  }

  async getClient(packageId: string): Promise<McpClient> {
    const rawConfig = this.getPackage(packageId, { include_disabled: true });
    if (rawConfig?.disabled) {
      throw new Error(`Package '${packageId}' is disabled in the MCP Gateway configuration.`);
    }

    // Check if we already have a connected client
    let client = this.clients.get(packageId);
    if (client) {
      // For HTTP clients, check if they're actually connected
      if (client.healthCheck) {
        const health = await client.healthCheck();
        if (health === "ok") {
          return client;
        }
        // Client exists but not healthy, remove it
        this.clients.delete(packageId);
        client = undefined;
      } else {
        return client;
      }
    }
    
    // Check if there's already a connection in progress
    let clientPromise = this.clientPromises.get(packageId);
    if (clientPromise) {
      logger.debug("Client creation already in progress, waiting", {
        package_id: packageId,
      });
      return clientPromise;
    }
    
    // Create new client
    const config = this.getPackage(packageId);
    if (!config) {
      const availablePackages = this.packages.map(p => p.id).join(", ");
      const errorMsg = `Package '${packageId}' not found in configuration.\n`;
      const helpMsg = `Available packages: ${availablePackages}\n\nTo use a package:\n  1. Ensure it's configured in your MCP Gateway config (e.g., ~/.mcp-gateway/config.json)\n  2. Run 'list_tool_packages()' to see all available packages`;
      throw new Error(errorMsg + helpMsg);
    }

    logger.debug("Creating new client", {
      package_id: packageId,
      transport: config.transport,
    });

    // Create the client creation promise
    clientPromise = this.createAndConnectClient(packageId, config);
    this.clientPromises.set(packageId, clientPromise);
    
    try {
      client = await clientPromise;
      this.clients.set(packageId, client);
      return client;
    } catch (error) {
      // Add helpful context to connection errors
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (!errorMessage.includes("MCP") && !errorMessage.includes("diagnostic")) {
        // It's a raw error, enhance it
        let enhancedMessage = `Failed to connect to MCP package '${packageId}'.\n`;
        enhancedMessage += `Transport: ${config.transport}\n`;
        
        if (config.transport === "stdio") {
          enhancedMessage += `Command: ${config.command} ${config.args?.join(" ") || ""}\n`;
        } else if (config.transport === "http") {
          enhancedMessage += `URL: ${config.base_url}\n`;
        }
        
        enhancedMessage += `\nOriginal error: ${errorMessage}`;
        enhancedMessage += `\n\nTroubleshooting:`;
        enhancedMessage += `\n  1. Run 'health_check_all(detailed: true)' for diagnostics`;
        enhancedMessage += `\n  2. Check the package configuration`;
        enhancedMessage += `\n  3. Verify any required authentication`;
        
        const enhancedError = new Error(enhancedMessage);
        (enhancedError as any).originalError = error;
        throw enhancedError;
      }
      throw error;
    } finally {
      // Clean up the promise
      this.clientPromises.delete(packageId);
    }
  }
  
  private async createAndConnectClient(packageId: string, config: PackageConfig): Promise<McpClient> {
    let client: McpClient;
    
    if (config.transport === "stdio") {
      client = new StdioMcpClient(packageId, config);
    } else {
      client = new HttpMcpClient(packageId, config);
    }

    try {
      // Connect the client
      await client.connect();
    } catch (error) {
      // Handle auth errors gracefully for HTTP clients
      if (config.transport === "http" && error instanceof Error && 
          (error.message.includes("Unauthorized") || 
           error.message.includes("401") ||
           error.message.includes("invalid_token") ||
           error.message.includes("authorization") ||
           error.name === "UnauthorizedError")) {
        logger.info("Package requires authentication", {
          package_id: packageId,
          message: `Use 'authenticate(package_id: "${packageId}")' to sign in`,
          oauth_enabled: config.oauth === true,
        });
        // Return the unconnected client - it will report as needing auth
        // The HttpMcpClient's healthCheck will return "needs_auth"
        return client;
      } else {
        // For non-auth errors and stdio errors, throw as normal
        throw error;
      }
    }
    
    return client;
  }

  async closeAll(): Promise<void> {
    logger.info("Closing all clients", {
      client_count: this.clients.size,
    });

    const closePromises = Array.from(this.clients.values()).map(client => 
      client.close().catch(error => 
        logger.error("Error closing client", {
          error: error instanceof Error ? error.message : String(error),
        })
      )
    );

    await Promise.allSettled(closePromises);
    this.clients.clear();

    logger.info("All clients closed");
  }

  getAuthManager(): AuthManagerImpl {
    return this.authManager;
  }

  async healthCheck(packageId: string): Promise<"ok" | "error" | "unavailable"> {
    const pkg = this.getPackage(packageId, { include_disabled: true });
    if (pkg?.disabled) {
      return "unavailable";
    }

    try {
      const client = await this.getClient(packageId);
      if ("healthCheck" in client && typeof client.healthCheck === "function") {
        const result = await client.healthCheck();
        // Map "needs_auth" to "unavailable" for the registry level
        if (result === "needs_auth") {
          return "unavailable";
        }
        return result;
      }
      return "ok";
    } catch (error) {
      logger.debug("Health check failed", {
        package_id: packageId,
        error: error instanceof Error ? error.message : String(error),
      });
      return "unavailable";
    }
  }
  
  async reconnectWithAuth(packageId: string): Promise<void> {
    const config = this.getPackage(packageId, { include_disabled: true });
    if (!config) {
      throw new Error(`Package not found: ${packageId}`);
    }

    if (config.disabled) {
      throw new Error(`Package '${packageId}' is disabled in the MCP Gateway configuration.`);
    }
    
    if (config.transport === "stdio") {
      throw new Error("stdio packages don't require authentication");
    }
    
    logger.info("Reconnecting package with authentication", {
      package_id: packageId,
      transport: config.transport,
    });
    
    // Clear any existing client
    this.clients.delete(packageId);
    
    // Create a new HTTP client
    const client = new HttpMcpClient(packageId, config);
    
    // Call the reconnectWithAuth method
    if ("reconnectWithAuth" in client && typeof client.reconnectWithAuth === "function") {
      await client.reconnectWithAuth();
      // Store the client after reconnection
      this.clients.set(packageId, client);
    } else {
      throw new Error("Client doesn't support reconnection");
    }
  }
  
  async triggerAuthentication(packageId: string): Promise<void> {
    const config = this.getPackage(packageId, { include_disabled: true });
    if (!config) {
      throw new Error(`Package not found: ${packageId}`);
    }

    if (config.disabled) {
      throw new Error(`Package '${packageId}' is disabled in the MCP Gateway configuration.`);
    }
    
    if (config.transport === "stdio") {
      throw new Error("stdio packages don't require authentication");
    }
    
    logger.info("Triggering authentication for package", {
      package_id: packageId,
      transport: config.transport,
    });
    
    // Clear any existing client
    this.clients.delete(packageId);
    
    // Create a new HTTP client with authentication mode
    const client = new HttpMcpClient(packageId, config);
    
    // Call the triggerAuthentication method
    if ("triggerAuthentication" in client && typeof client.triggerAuthentication === "function") {
      await client.triggerAuthentication();
      // Store the client after authentication is triggered
      this.clients.set(packageId, client);
    } else {
      throw new Error("Client doesn't support authentication");
    }
  }
}