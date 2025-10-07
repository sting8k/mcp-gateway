import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getLogger } from "../logging.js";
const logger = getLogger();
export async function setupStdioTransport(server, options) {
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
            }
            catch (error) {
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
