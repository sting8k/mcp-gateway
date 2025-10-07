import { summarizeTool, argsSkeleton, summarizePackage, createSchemaHash } from "./summarize.js";
import { getLogger } from "./logging.js";
const logger = getLogger();
export class Catalog {
    cache = new Map();
    registry;
    globalEtag = "";
    constructor(registry) {
        this.registry = registry;
        this.updateGlobalEtag();
    }
    updateGlobalEtag() {
        const timestamp = Date.now().toString();
        const cacheKeys = Array.from(this.cache.keys()).sort().join(",");
        this.globalEtag = `sha256:${Buffer.from(timestamp + cacheKeys).toString('hex').slice(0, 16)}`;
    }
    async refreshPackage(packageId) {
        logger.debug("Refreshing package catalog", { package_id: packageId });
        try {
            const client = await this.registry.getClient(packageId);
            const tools = await client.listTools();
            const cachedTools = tools.map(tool => ({
                packageId,
                tool,
                summary: summarizeTool(tool),
                argsSkeleton: argsSkeleton(tool.inputSchema),
                schemaHash: createSchemaHash(tool.inputSchema),
            }));
            const packageEtag = `sha256:${Buffer.from(JSON.stringify(cachedTools)).toString('hex').slice(0, 16)}`;
            this.cache.set(packageId, {
                packageId,
                tools: cachedTools,
                lastUpdated: Date.now(),
                etag: packageEtag,
            });
            this.updateGlobalEtag();
            logger.debug("Package catalog refreshed", {
                package_id: packageId,
                tool_count: tools.length,
                etag: packageEtag,
            });
        }
        catch (error) {
            logger.error("Failed to refresh package catalog", {
                package_id: packageId,
                error: error instanceof Error ? error.message : String(error),
            });
            // If it's an auth error (OAuth/401/Unauthorized), don't throw - just cache empty tools
            if (error instanceof Error &&
                (error.message.includes("OAuth") ||
                    error.message.includes("401") ||
                    error.message.includes("Unauthorized") ||
                    error.message.includes("invalid_token") ||
                    error.message.includes("authorization"))) {
                logger.info("Package requires authentication, caching empty tools", {
                    package_id: packageId,
                });
                this.cache.set(packageId, {
                    packageId,
                    tools: [],
                    lastUpdated: Date.now(),
                    etag: `auth-pending-${Date.now()}`,
                });
                return;
            }
            throw error;
        }
    }
    async ensurePackageLoaded(packageId) {
        if (!this.cache.has(packageId)) {
            await this.refreshPackage(packageId);
        }
    }
    async getPackageTools(packageId) {
        await this.ensurePackageLoaded(packageId);
        const cached = this.cache.get(packageId);
        return cached?.tools || [];
    }
    countTools(packageId) {
        const cached = this.cache.get(packageId);
        return cached?.tools.length || 0;
    }
    async getTool(packageId, toolId) {
        await this.ensurePackageLoaded(packageId);
        const cached = this.cache.get(packageId);
        return cached?.tools.find(t => t.tool.name === toolId);
    }
    async getToolSchema(packageId, toolId) {
        const tool = await this.getTool(packageId, toolId);
        return tool?.tool.inputSchema;
    }
    paginate(packageId, pageSize = 20, pageToken) {
        const cached = this.cache.get(packageId);
        if (!cached) {
            return { items: [], next: null };
        }
        const tools = cached.tools;
        let startIndex = 0;
        if (pageToken) {
            try {
                const decoded = Buffer.from(pageToken, 'base64').toString('utf8');
                const parsed = JSON.parse(decoded);
                startIndex = parsed.index || 0;
            }
            catch (error) {
                logger.warn("Invalid page token", {
                    package_id: packageId,
                    page_token: pageToken,
                });
                startIndex = 0;
            }
        }
        const endIndex = startIndex + pageSize;
        const items = tools.slice(startIndex, endIndex);
        let nextToken = null;
        if (endIndex < tools.length) {
            nextToken = Buffer.from(JSON.stringify({ index: endIndex })).toString('base64');
        }
        return { items, next: nextToken };
    }
    etag() {
        return this.globalEtag;
    }
    getPackageEtag(packageId) {
        const cached = this.cache.get(packageId);
        return cached?.etag || "";
    }
    async buildPackageSummary(packageConfig) {
        try {
            const tools = await this.getPackageTools(packageConfig.id);
            // If no tools loaded (e.g., needs auth), return a descriptive message
            if (tools.length === 0) {
                const cached = this.cache.get(packageConfig.id);
                if (cached?.etag?.startsWith('auth-pending')) {
                    return `${packageConfig.transport} MCP package (authentication required)`;
                }
                return `${packageConfig.transport} MCP package (no tools available)`;
            }
            const toolsForSummary = tools.map(ct => ct.tool);
            return summarizePackage(packageConfig, toolsForSummary);
        }
        catch (error) {
            logger.debug("Failed to build package summary", {
                package_id: packageConfig.id,
                error: error instanceof Error ? error.message : String(error),
            });
            return `${packageConfig.transport} MCP package`;
        }
    }
    async buildToolInfos(packageId, options = {}) {
        const tools = await this.getPackageTools(packageId);
        return tools.map(cachedTool => ({
            package_id: packageId,
            tool_id: cachedTool.tool.name,
            name: cachedTool.tool.name,
            summary: options.summarize ? cachedTool.summary : undefined,
            args_skeleton: options.summarize ? cachedTool.argsSkeleton : undefined,
            schema_hash: cachedTool.schemaHash,
            schema: options.include_schemas ? cachedTool.tool.inputSchema : undefined,
        }));
    }
    clear() {
        logger.debug("Clearing catalog cache");
        this.cache.clear();
        this.updateGlobalEtag();
    }
    clearPackage(packageId) {
        logger.debug("Clearing package cache", { package_id: packageId });
        this.cache.delete(packageId);
        this.updateGlobalEtag();
    }
    getCacheStats() {
        let totalTools = 0;
        for (const cached of this.cache.values()) {
            totalTools += cached.tools.length;
        }
        return {
            packageCount: this.cache.size,
            totalTools,
        };
    }
}
