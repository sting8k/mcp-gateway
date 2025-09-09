#!/usr/bin/env node
import { startServer } from "./server.js";
import { initLogger } from "./logging.js";

const args = process.argv.slice(2);

// Get all --config arguments (can be multiple)
const getConfigPaths = (): string[] => {
  const configs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--config" && i + 1 < args.length) {
      configs.push(args[i + 1]);
    }
  }
  
  // If no --config args, check environment variable or use default
  if (configs.length === 0) {
    const envConfig = process.env.SUPER_MCP_CONFIG;
    if (envConfig) {
      // Support comma-separated paths in env variable
      configs.push(...envConfig.split(',').map(p => p.trim()));
    } else {
      configs.push("super-mcp-config.json");
    }
  }
  
  return configs;
};

const getArg = (name: string, d?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : d;
};

const configPaths = getConfigPaths();
const logLevel = getArg("log-level", "info");

// Initialize logger
initLogger(logLevel as any);

startServer({ configPaths, logLevel }).catch(err => {
  console.error(JSON.stringify({ level: "fatal", msg: String(err) }));
  process.exit(1);
});