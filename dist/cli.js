#!/usr/bin/env node
import { startServer } from "./server.js";
import { initLogger } from "./logging.js";
import { setSilentMode, setVerboseMode } from "./runtimeOptions.js";
import * as fs from "fs";
import * as path from "path";
import { homedir } from "os";
const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const verbose = hasFlag("--verbose") || hasFlag("--debug");
const silentFlag = hasFlag("--silent");
const silent = silentFlag && !verbose;
setVerboseMode(verbose);
setSilentMode(silent);
const emitCliMessage = (message) => {
    if (!silent || verbose) {
        console.error(message);
    }
};
const envFileLoggingPreference = () => {
    const raw = process.env.MCP_GATEWAY_ENABLE_FILE_LOGS;
    if (!raw) {
        return undefined;
    }
    const normalized = raw.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
        return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
        return false;
    }
    return undefined;
};
const resolveFileLoggingPreference = () => {
    if (hasFlag("--log-to-file")) {
        return true;
    }
    if (hasFlag("--no-log-to-file")) {
        return false;
    }
    const envPreference = envFileLoggingPreference();
    if (typeof envPreference === "boolean") {
        return envPreference;
    }
    return false;
};
// Auto-create setup on first run
async function ensureSetup(options = {}) {
    const baseDir = homedir();
    const legacyDir = path.join(baseDir, '.super-mcp');
    const gatewayDir = path.join(baseDir, '.mcp-gateway');
    if (!fs.existsSync(gatewayDir)) {
        fs.mkdirSync(gatewayDir, { recursive: true });
    }
    const configFile = path.join(gatewayDir, 'config.json');
    try {
        if (options.enableFileLogging) {
            const logsDir = path.join(gatewayDir, 'logs');
            if (!fs.existsSync(logsDir)) {
                fs.mkdirSync(logsDir, { recursive: true });
            }
        }
        // If legacy config exists and new config is missing, migrate it
        const legacyConfig = path.join(legacyDir, 'config.json');
        if (!fs.existsSync(configFile) && fs.existsSync(legacyConfig)) {
            fs.copyFileSync(legacyConfig, configFile);
            if (!options.silent) {
                emitCliMessage(`📁 Migrated existing config from ${legacyConfig} to ${configFile}`);
            }
        }
        // Create empty config if it doesn't exist
        if (!fs.existsSync(configFile)) {
            const emptyConfig = {
                "$schema": "https://raw.githubusercontent.com/JoshuaWohle/Super-MCP/main/super-mcp-config.schema.json",
                "mcpServers": {}
            };
            fs.writeFileSync(configFile, JSON.stringify(emptyConfig, null, 2));
            if (!options.silent) {
                emitCliMessage(`📁 Created config at: ${configFile}`);
                emitCliMessage(`💡 Add MCP servers to the config or use 'npx mcp-gateway add'`);
            }
        }
    }
    catch (error) {
        // Non-fatal, continue anyway
        if (!options.silent) {
            emitCliMessage(`Warning: Could not create setup: ${error}`);
        }
    }
    return configFile;
}
// Get all --config arguments (can be multiple)
const getConfigPaths = async (options = {}) => {
    const configs = [];
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
        }
        else {
            // Use default config location (now in ~/.mcp-gateway/ with fallback to ~/.super-mcp/)
            const defaultConfig = await ensureSetup(options);
            configs.push(defaultConfig);
        }
    }
    return configs;
};
const getArg = (name, d) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : d;
};
// Simple CLI for adding MCPs
async function handleAddCommand() {
    const serverType = args[1];
    const configFile = await ensureSetup({ enableFileLogging: resolveFileLoggingPreference(), silent });
    // Read existing config
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    config.mcpServers = config.mcpServers || {};
    // Pre-defined templates for common MCPs
    const templates = {
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
        emitCliMessage("Usage: npx mcp-gateway add <server-type>");
        emitCliMessage("\nAvailable server types:");
        Object.keys(templates).forEach(type => {
            emitCliMessage(`  ${type} - ${templates[type].description}`);
        });
        emitCliMessage("\nExample: npx mcp-gateway add filesystem");
        process.exit(0);
    }
    const template = templates[serverType];
    if (!template) {
        emitCliMessage(`❌ Unknown server type: ${serverType}`);
        emitCliMessage(`Available types: ${Object.keys(templates).join(', ')}`);
        process.exit(1);
    }
    // Add to config
    config.mcpServers[serverType] = template;
    // Save config
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
    emitCliMessage(`✅ Added ${serverType} to config at ${configFile}`);
    if (template.env) {
        emitCliMessage(`⚠️  Remember to set environment variables:`);
        Object.keys(template.env).forEach(key => {
            emitCliMessage(`   export ${template.env[key].replace('${', '').replace('}', '')}=<your-value>`);
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
    const logToFile = resolveFileLoggingPreference();
    const configPaths = await getConfigPaths({ enableFileLogging: logToFile, silent });
    const logLevelArg = getArg("log-level");
    const logLevel = logLevelArg ?? (verbose ? "debug" : "error");
    const transportArg = getArg("transport", "http") ?? "http";
    const validTransports = new Set(["http", "sse", "stdio"]);
    if (!validTransports.has(transportArg)) {
        emitCliMessage(`Invalid transport: ${transportArg}. Expected one of http, sse, stdio.`);
        process.exit(1);
    }
    const transport = transportArg;
    const host = getArg("host", "127.0.0.1");
    const portArg = getArg("port");
    const port = portArg ? Number(portArg) : 3001;
    if (Number.isNaN(port)) {
        emitCliMessage(`Invalid port: ${portArg}`);
        process.exit(1);
    }
    // Initialize logger
    initLogger(logLevel, {
        enableFileLogging: logToFile,
        isStdioMode: transport === "stdio",
        silent,
        verbose,
    });
    startServer({ configPaths, logLevel, transport, host, port, silent }).catch(err => {
        console.error(JSON.stringify({ level: "fatal", msg: String(err) }));
        process.exit(1);
    });
}
// Run main
main().catch(err => {
    console.error(`Fatal error: ${err}`);
    process.exit(1);
});
