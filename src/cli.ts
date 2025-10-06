#!/usr/bin/env node
import { startServer } from "./server.js";
import { initLogger } from "./logging.js";
import * as fs from "fs";
import * as path from "path";
import { homedir } from "os";

const args = process.argv.slice(2);

// Auto-create setup on first run
async function ensureSetup(): Promise<string> {
  const baseDir = homedir();
  const legacyDir = path.join(baseDir, '.super-mcp');
  const gatewayDir = path.join(baseDir, '.mcp-gateway');
  if (!fs.existsSync(gatewayDir)) {
    fs.mkdirSync(gatewayDir, { recursive: true });
  }

  const logsDir = path.join(gatewayDir, 'logs');
  const configFile = path.join(gatewayDir, 'config.json');
  
  try {
    // Create directories if they don't exist
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    // If legacy config exists and new config is missing, migrate it
    const legacyConfig = path.join(legacyDir, 'config.json');
    if (!fs.existsSync(configFile) && fs.existsSync(legacyConfig)) {
      fs.copyFileSync(legacyConfig, configFile);
      console.error(`📁 Migrated existing config from ${legacyConfig} to ${configFile}`);
    }
    
    // Create empty config if it doesn't exist
    if (!fs.existsSync(configFile)) {
      const emptyConfig = {
        "$schema": "https://raw.githubusercontent.com/JoshuaWohle/Super-MCP/main/super-mcp-config.schema.json",
        "mcpServers": {}
      };
      fs.writeFileSync(configFile, JSON.stringify(emptyConfig, null, 2));
      console.error(`📁 Created config at: ${configFile}`);
      console.error(`💡 Add MCP servers to the config or use 'npx mcp-gateway add'`);
    }
  } catch (error) {
    // Non-fatal, continue anyway
    console.error(`Warning: Could not create setup: ${error}`);
  }
  
  return configFile;
}

// Get all --config arguments (can be multiple)
const getConfigPaths = async (): Promise<string[]> => {
  const configs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--config" && i + 1 < args.length) {
      configs.push(args[i + 1]);
    }
  }
  
  // If no --config args, check environment variable or use default
  if (configs.length === 0) {
    const envConfig = process.env.MCP_GATEWAY_CONFIG || process.env.SUPER_MCP_CONFIG;
    if (envConfig) {
      // Support comma-separated paths in env variable
      configs.push(...envConfig.split(',').map(p => p.trim()));
    } else {
      // Use default config location (now in ~/.mcp-gateway/ with fallback to ~/.super-mcp/)
      const defaultConfig = await ensureSetup();
      configs.push(defaultConfig);
    }
  }
  
  return configs;
};

const getArg = (name: string, d?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : d;
};

// Simple CLI for adding MCPs
async function handleAddCommand() {
  const serverType = args[1];
  const configFile = await ensureSetup();
  
  // Read existing config
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  config.mcpServers = config.mcpServers || {};
  
  // Pre-defined templates for common MCPs
  const templates: Record<string, any> = {
    filesystem: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", path.join(homedir(), "Documents")],
      name: "File System",
      description: "Access and manage local files"
    },
    github: {
      command: "npx", 
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
      },
      name: "GitHub",
      description: "Manage GitHub repositories"
    },
    memory: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-memory"],
      name: "Memory",
      description: "Persistent memory storage"
    }
  };
  
  if (!serverType || serverType === '--help') {
    console.error("Usage: npx mcp-gateway add <server-type>");
    console.error("\nAvailable server types:");
    Object.keys(templates).forEach(type => {
      console.error(`  ${type} - ${templates[type].description}`);
    });
    console.error("\nExample: npx mcp-gateway add filesystem");
    process.exit(0);
  }
  
  const template = templates[serverType];
  if (!template) {
    console.error(`❌ Unknown server type: ${serverType}`);
    console.error(`Available types: ${Object.keys(templates).join(', ')}`);
    process.exit(1);
  }
  
  // Add to config
  config.mcpServers[serverType] = template;
  
  // Save config
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
  console.error(`✅ Added ${serverType} to config at ${configFile}`);
  
  if (template.env) {
    console.error(`⚠️  Remember to set environment variables:`);
    Object.keys(template.env).forEach(key => {
      console.error(`   export ${template.env[key].replace('${', '').replace('}', '')}=<your-value>`);
    });
  }
  
  process.exit(0);
}

// Main entry point
async function main() {
  // Handle special commands
  if (args[0] === 'add') {
    return handleAddCommand();
  }
  
  const configPaths = await getConfigPaths();
  const logLevel = getArg("log-level", "info");

  // Initialize logger
  initLogger(logLevel as any);

  startServer({ configPaths, logLevel }).catch(err => {
    console.error(JSON.stringify({ level: "fatal", msg: String(err) }));
    process.exit(1);
  });
}

// Run main
main().catch(err => {
  console.error(`Fatal error: ${err}`);
  process.exit(1);
});