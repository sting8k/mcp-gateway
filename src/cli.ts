#!/usr/bin/env node
import { startServer } from "./server.js";
import { initLogger } from "./logging.js";

const args = process.argv.slice(2);
const getArg = (name: string, d?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : d;
};

const configPath = getArg("config") || process.env.SUPER_MCP_CONFIG || "super-mcp-config.json";
const logLevel = getArg("log-level", "info");

// Initialize logger
initLogger(logLevel as any);

startServer({ configPath, logLevel }).catch(err => {
  console.error(JSON.stringify({ level: "fatal", msg: String(err) }));
  process.exit(1);
});