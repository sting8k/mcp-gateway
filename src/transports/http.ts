import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { FSWatcher } from "node:fs";
import { PackageRegistry } from "../registry.js";
import { getLogger } from "../logging.js";
import http from "node:http";
import { URL } from "node:url";

const logger = getLogger();

export interface HttpTransportOptions {
  registry: PackageRegistry;
  configWatchers: FSWatcher[];
  host: string;
  port: number;
}

function ensureCompatibleAcceptHeader(req: http.IncomingMessage): void {
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
}

export async function setupHttpTransport(
  server: Server,
  options: HttpTransportOptions
): Promise<void> {
  const { registry, configWatchers, host, port } = options;

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

  await server.connect(streamableTransport);

  const allowedPaths = new Set(["/", "/mcp", "/mcp/"]);

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
    await registry.closeAll();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
