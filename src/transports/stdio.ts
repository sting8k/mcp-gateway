import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { FSWatcher } from "node:fs";
import { PackageRegistry } from "../registry.js";
import { getLogger } from "../logging.js";

const logger = getLogger();

export interface StdioTransportOptions {
  registry: PackageRegistry;
  configWatchers: FSWatcher[];
}

export async function setupStdioTransport(
  server: Server,
  options: StdioTransportOptions
): Promise<void> {
  const { registry, configWatchers } = options;

  const stdioTransport = new StdioServerTransport();
  await server.connect(stdioTransport);
  logger.info("MCP Gateway started successfully (stdio mode)");

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

  const shutdown = async () => {
    logger.info("Shutting down...");
    closeWatchers();
    await registry.closeAll();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
