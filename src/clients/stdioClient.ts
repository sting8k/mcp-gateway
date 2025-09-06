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
      { name: "super-mcp-router", version: "0.1.0" },
      { capabilities: {} }
    );
    
    // Placeholder transport - will be replaced in connect()
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries({ ...process.env, ...config.env })) {
      if (value !== undefined) {
        env[key] = value;
      }
    }
    
    this.transport = new StdioClientTransport({
      command: config.command || "echo",
      args: config.args || [],
      env,
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
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries({ ...process.env, ...this.config.env })) {
        if (value !== undefined) {
          env[key] = value;
        }
      }
      
      this.transport = new StdioClientTransport({
        command: this.config.command || "echo",
        args: this.config.args || [],
        env,
        cwd: this.config.cwd,
      });

      // Connect the client to the transport
      await this.client.connect(this.transport);

      logger.info("Successfully connected to stdio MCP", {
        package_id: this.packageId,
      });
    } catch (error) {
      logger.error("Failed to connect to stdio MCP", {
        package_id: this.packageId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
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