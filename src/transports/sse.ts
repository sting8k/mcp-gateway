import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { FSWatcher } from "node:fs";
import { PackageRegistry } from "../registry.js";
import { Catalog } from "../catalog.js";
import { getLogger } from "../logging.js";
import http from "node:http";
import { URL } from "node:url";

const logger = getLogger();

export interface SseTransportOptions {
  registry: PackageRegistry;
  catalog: Catalog;
  validator: any;
  configWatchers: FSWatcher[];
  host: string;
  port: number;
  createGatewayServer: (context: { registry: PackageRegistry; catalog: Catalog; validator: any }) => Server;
}

export async function setupSseTransport(options: SseTransportOptions): Promise<void> {
  const { registry, catalog, validator, configWatchers, host, port, createGatewayServer } = options;

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
        const gatewayServer = createGatewayServer({ registry, catalog, validator });

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
    await registry.closeAll();
    for (const sessionId of Array.from(sessions.keys())) {
      await cleanupSession(sessionId);
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
