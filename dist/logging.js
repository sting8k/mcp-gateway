import * as fs from "fs";
import * as path from "path";
function envEnablesFileLogging() {
    const raw = process.env.MCP_GATEWAY_ENABLE_FILE_LOGS;
    if (!raw) {
        return false;
    }
    const normalized = raw.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
        return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
        return false;
    }
    return false;
}
class Logger {
    level;
    levelPriority = {
        debug: 0,
        info: 1,
        warn: 2,
        error: 3,
        fatal: 4,
    };
    logFile;
    logStream;
    enableFileLogging;
    isStdioMode;
    constructor(level = "error", options) {
        this.level = level;
        const baseDir = options?.baseDir ?? process.env.HOME ?? "";
        this.isStdioMode = options?.isStdioMode ?? false;
        this.enableFileLogging =
            typeof options?.enableFileLogging === "boolean"
                ? options.enableFileLogging
                : envEnablesFileLogging();
        if (this.enableFileLogging && baseDir) {
            const gatewayBase = path.join(baseDir, ".mcp-gateway");
            const logsDir = path.join(gatewayBase, "logs");
            if (!fs.existsSync(logsDir)) {
                fs.mkdirSync(logsDir, { recursive: true });
            }
            const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
            this.logFile = path.join(logsDir, `mcp-gateway-${timestamp}.log`);
            this.logStream = fs.createWriteStream(this.logFile, { flags: "a" });
            this.writeToFile({
                level: "info",
                msg: "===== MCP Gateway Starting =====",
                timestamp: new Date().toISOString(),
                pid: process.pid,
                node_version: process.version,
                platform: process.platform,
                log_file: this.logFile,
            });
            // Only log to stderr if not in stdio mode (to avoid breaking MCP protocol)
            if (!this.isStdioMode) {
                console.error(`📝 Logging to: ${this.logFile}`);
            }
        }
        this.setupProcessHandlers();
    }
    setupProcessHandlers() {
        process.on('uncaughtException', (error) => {
            this.writeToFile({
                level: "fatal",
                msg: "UNCAUGHT EXCEPTION - Server will crash",
                timestamp: new Date().toISOString(),
                error_message: error.message,
                error_stack: error.stack,
                error_name: error.name,
            });
            // Ensure log is written before exit
            if (this.logStream) {
                this.logStream.end(() => process.exit(1));
            }
            else {
                process.exit(1);
            }
        });
        process.on('unhandledRejection', (reason, promise) => {
            this.writeToFile({
                level: "error",
                msg: "UNHANDLED REJECTION",
                timestamp: new Date().toISOString(),
                reason: reason instanceof Error ? reason.message : String(reason),
                stack: reason instanceof Error ? reason.stack : undefined,
            });
        });
        process.on('exit', (code) => {
            this.writeToFile({
                level: "info",
                msg: `Process exiting with code ${code}`,
                timestamp: new Date().toISOString(),
            });
        });
        process.on('SIGINT', () => {
            this.writeToFile({
                level: "info",
                msg: "Received SIGINT",
                timestamp: new Date().toISOString(),
            });
        });
        process.on('SIGTERM', () => {
            this.writeToFile({
                level: "info",
                msg: "Received SIGTERM",
                timestamp: new Date().toISOString(),
            });
        });
    }
    writeToFile(entry) {
        if (this.logStream && !this.logStream.destroyed) {
            this.logStream.write(JSON.stringify(entry) + '\n');
        }
    }
    setLevel(level) {
        this.level = level;
    }
    shouldLog(level) {
        return this.levelPriority[level] >= this.levelPriority[this.level];
    }
    sanitizeData(data) {
        if (typeof data !== "object" || data === null) {
            return data;
        }
        if (Array.isArray(data)) {
            return data.map(item => this.sanitizeData(item));
        }
        const sanitized = {};
        for (const [key, value] of Object.entries(data)) {
            // Redact sensitive information
            if (key.toLowerCase().includes("token") ||
                key.toLowerCase().includes("secret") ||
                key.toLowerCase().includes("key") ||
                key.toLowerCase().includes("password")) {
                sanitized[key] = "[REDACTED]";
            }
            else if (typeof value === "string" && (value.includes("Bearer ") ||
                value.includes("access_token") ||
                value.includes("refresh_token"))) {
                sanitized[key] = "[REDACTED]";
            }
            else {
                sanitized[key] = this.sanitizeData(value);
            }
        }
        return sanitized;
    }
    log(level, msg, data = {}) {
        if (!this.shouldLog(level)) {
            return;
        }
        const entry = {
            level,
            msg,
            timestamp: new Date().toISOString(),
            ...this.sanitizeData(data),
        };
        // Write to file
        this.writeToFile(entry);
        // Write to stderr ONLY if NOT in stdio mode
        // In stdio mode, stderr must be silent (stdout is used for JSON-RPC)
        // Exception: Always log fatal errors to stderr
        if (!this.isStdioMode || level === "fatal") {
            console.error(JSON.stringify(entry));
        }
    }
    debug(msg, data) {
        this.log("debug", msg, data);
    }
    info(msg, data) {
        this.log("info", msg, data);
    }
    warn(msg, data) {
        this.log("warn", msg, data);
    }
    error(msg, data) {
        this.log("error", msg, data);
    }
    fatal(msg, data) {
        this.log("fatal", msg, data);
    }
}
let logger;
let loggerOptions;
export function initLogger(level = "error", options) {
    loggerOptions = options;
    logger = new Logger(level, options);
    return logger;
}
export function getLogger() {
    if (!logger) {
        logger = new Logger("error", loggerOptions);
    }
    return logger;
}
