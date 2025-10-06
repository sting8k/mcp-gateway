import { spawn, ChildProcess } from "child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { McpClient, PackageConfig } from "../types.js";
import { getLogger } from "../logging.js";

const logger = getLogger();

export class StdioMcpClient implements McpClient {
  private client: Client;
  private transport: StdioClientTransport;
  private process?: ChildProcess;
  private packageId: string;
  private config: PackageConfig;

  constructor(packageId: string, config: PackageConfig) {
    this.packageId = packageId;
    this.config = config;
    
    // We'll initialize the client and transport in connect()
    this.client = new Client(
      { name: "mcp-gateway", version: "0.1.0" },
      { capabilities: {} }
    );
    
    // Placeholder transport - will be replaced in connect()
    // Let the SDK handle environment variable merging with safe defaults
    this.transport = new StdioClientTransport({
      command: config.command || "echo",
      args: config.args || [],
      env: config.env,
      cwd: config.cwd,
    });
  }

  async connect(): Promise<void> {
    logger.info("Connecting to stdio MCP", {
      package_id: this.packageId,
      command: this.config.command,
      args: this.config.args,
    });

    try {
      // Create the transport
      // Let the SDK handle environment variable merging with safe defaults
      this.transport = new StdioClientTransport({
        command: this.config.command || "echo",
        args: this.config.args || [],
        env: this.config.env,
        cwd: this.config.cwd,
      });

      // Connect the client to the transport
      await this.client.connect(this.transport);

      logger.info("Successfully connected to stdio MCP", {
        package_id: this.packageId,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Failed to connect to stdio MCP", {
        package_id: this.packageId,
        command: this.config.command,
        args: this.config.args,
        error: errorMessage,
      });
      
      // Provide detailed diagnostic information
      let diagnosticMessage = `Failed to connect to MCP server '${this.packageId}'.\n`;
      
      // Check common issues
      if (errorMessage.includes("ENOENT") || errorMessage.includes("not found")) {
        diagnosticMessage += `\n❌ Command not found: '${this.config.command}'`;
        diagnosticMessage += `\nPossible fixes:`;
        diagnosticMessage += `\n  1. Install the MCP server: npm install -g ${this.config.command}`;
        diagnosticMessage += `\n  2. If using npx, ensure Node.js is installed`;
        diagnosticMessage += `\n  3. Check if the command path is correct`;
        if (this.config.command === "npx" && this.config.args?.[0]) {
          diagnosticMessage += `\n  4. Try installing the package: npm install -g ${this.config.args[0]}`;
        }
      } else if (errorMessage.includes("EACCES") || errorMessage.includes("permission")) {
        diagnosticMessage += `\n❌ Permission denied for command: '${this.config.command}'`;
        diagnosticMessage += `\nPossible fixes:`;
        diagnosticMessage += `\n  1. Check file permissions: chmod +x ${this.config.command}`;
        diagnosticMessage += `\n  2. Ensure you have execute permissions`;
      } else if (errorMessage.includes("spawn")) {
        diagnosticMessage += `\n❌ Failed to spawn process`;
        diagnosticMessage += `\nCommand: ${this.config.command} ${this.config.args?.join(" ") || ""}`;
        diagnosticMessage += `\nWorking directory: ${this.config.cwd || process.cwd()}`;
      } else {
        diagnosticMessage += `\n❌ ${errorMessage}`;
      }
      
      // Check environment variables
      if (this.config.env) {
        const missingEnvVars = Object.entries(this.config.env)
          .filter(([_, value]) => !value || value === "")
          .map(([key]) => key);
        
        if (missingEnvVars.length > 0) {
          diagnosticMessage += `\n\n⚠️ Empty environment variables detected:`;
          missingEnvVars.forEach(key => {
            diagnosticMessage += `\n  - ${key}: Not set or empty`;
          });
        }
      }
      
      const enhancedError = new Error(diagnosticMessage);
      enhancedError.name = "MCPConnectionError";
      (enhancedError as any).originalError = error;
      (enhancedError as any).packageId = this.packageId;
      throw enhancedError;
    }
  }

  async listTools(): Promise<any[]> {
    logger.debug("Listing tools from stdio MCP", {
      package_id: this.packageId,
    });

    try {
      const response = await this.client.listTools();
      
      logger.debug("Retrieved tools from stdio MCP", {
        package_id: this.packageId,
        tool_count: response.tools?.length || 0,
      });

      return response.tools || [];
    } catch (error) {
      logger.error("Failed to list tools from stdio MCP", {
        package_id: this.packageId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async callTool(name: string, args: any): Promise<any> {
    logger.debug("Calling tool on stdio MCP", {
      package_id: this.packageId,
      tool_name: name,
      args_keys: typeof args === "object" && args ? Object.keys(args) : [],
    });

    try {
      const response = await this.client.callTool({
        name,
        arguments: args || {},
      });

      logger.debug("Tool call completed", {
        package_id: this.packageId,
        tool_name: name,
        has_content: !!(response && response.content),
      });

      // MCP client returns { content: [...] } directly
      return response;
    } catch (error) {
      logger.error("Tool call failed", {
        package_id: this.packageId,
        tool_name: name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async close(): Promise<void> {
    logger.debug("Closing stdio MCP client", {
      package_id: this.packageId,
    });

    try {
      await this.client.close();
      
      // Also clean up the process if it exists
      if (this.process && !this.process.killed) {
        this.process.kill();
      }

      logger.debug("Stdio MCP client closed", {
        package_id: this.packageId,
      });
    } catch (error) {
      logger.error("Error closing stdio MCP client", {
        package_id: this.packageId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async healthCheck(): Promise<"ok" | "error"> {
    try {
      // Try to list tools as a health check
      await this.listTools();
      return "ok";
    } catch (error) {
      logger.warn("Health check failed for stdio MCP", {
        package_id: this.packageId,
        error: error instanceof Error ? error.message : String(error),
      });
      return "error";
    }
  }

  async requiresAuth(): Promise<boolean> {
    // Stdio MCPs use environment variables for auth, handled at startup
    return false;
  }

  async isAuthenticated(): Promise<boolean> {
    // Stdio MCPs are authenticated via environment variables at startup
    return true;
  }
}