/**
 * Tool definitions for MCP Gateway meta-tools
 */
import { MultiToolParallelInputSchema, MultiToolParallelOutputSchema } from "./multiTool.js";
export const GATEWAY_TOOLS = [
    {
        name: "list_tool_packages",
        description: "List available MCP packages and discover their capabilities. Start here to see what tools you have access to. Each package provides a set of related tools (e.g., filesystem operations, API integrations). Returns package IDs needed for list_tools.",
        inputSchema: {
            type: "object",
            properties: {
                safe_only: {
                    type: "boolean",
                    description: "Only return packages that are considered safe",
                    default: true,
                },
                limit: {
                    type: "number",
                    description: "Maximum number of packages to return",
                    default: 100,
                },
                include_health: {
                    type: "boolean",
                    description: "Include health status for each package (shows if package is connected and ready)",
                    default: true,
                },
            },
            examples: [
                { safe_only: true, include_health: true },
                { limit: 10 }
            ],
        },
    },
    {
        name: "list_tools",
        description: "Explore tools within a specific package to understand what actions you can perform. Use the package_id from list_tool_packages. Returns tool names, descriptions, and argument schemas. Essential for discovering available functionality before using use_tool.",
        inputSchema: {
            type: "object",
            properties: {
                package_id: {
                    type: "string",
                    description: "Package ID from list_tool_packages (e.g., 'filesystem', 'github', 'notion-api')",
                    examples: ["filesystem", "github", "notion-api", "brave-search"],
                },
                summarize: {
                    type: "boolean",
                    description: "Include summaries and argument skeletons showing expected format",
                    default: true,
                },
                include_schemas: {
                    type: "boolean",
                    description: "Include full JSON schemas for tool arguments (verbose, usually not needed)",
                    default: false,
                },
                page_size: {
                    type: "number",
                    description: "Number of tools to return per page",
                    default: 20,
                },
                page_token: {
                    type: ["string", "null"],
                    description: "Token for pagination (from previous response's next_page_token)",
                },
            },
            required: ["package_id"],
            examples: [
                { package_id: "filesystem", summarize: true },
                { package_id: "github", page_size: 10 }
            ],
        },
    },
    {
        name: "use_tool",
        description: "Execute a specific tool from a package. First use list_tool_packages to find packages, then list_tools to discover tools and their arguments, then use this to execute. The args must match the tool's schema exactly.",
        inputSchema: {
            type: "object",
            properties: {
                package_id: {
                    type: "string",
                    description: "Package ID containing the tool (from list_tool_packages)",
                    examples: ["filesystem", "github"],
                },
                tool_id: {
                    type: "string",
                    description: "Tool name/ID to execute (from list_tools)",
                    examples: ["read_file", "search_repositories", "create_page"],
                },
                args: {
                    type: "object",
                    description: "Tool-specific arguments matching the schema from list_tools",
                    examples: [
                        { path: "/Users/example/file.txt" },
                        { query: "language:python stars:>100" }
                    ],
                },
                dry_run: {
                    type: "boolean",
                    description: "Validate arguments without executing (useful for testing)",
                    default: false,
                },
            },
            required: ["package_id", "tool_id", "args"],
            examples: [
                {
                    package_id: "filesystem",
                    tool_id: "read_file",
                    args: { path: "/tmp/test.txt" }
                },
                {
                    package_id: "github",
                    tool_id: "search_repositories",
                    args: { query: "mcp tools", limit: 5 },
                    dry_run: true
                }
            ],
        },
    },
    {
        name: "multi_use_tool",
        description: "Execute multiple tool invocations in parallel and return ordered results and diagnostics.",
        inputSchema: MultiToolParallelInputSchema,
        outputSchema: MultiToolParallelOutputSchema,
    },
    {
        name: "get_help",
        description: "Get detailed guidance on using MCP Gateway effectively. Provides step-by-step instructions, common workflows, troubleshooting tips, and best practices. Use this when you need clarification on how to accomplish tasks.",
        inputSchema: {
            type: "object",
            properties: {
                topic: {
                    type: "string",
                    description: "Help topic to explore",
                    enum: ["getting_started", "workflow", "authentication", "tool_discovery", "error_handling", "common_patterns", "package_types"],
                    default: "getting_started",
                },
                package_id: {
                    type: "string",
                    description: "Get package-specific help and usage patterns",
                    examples: ["filesystem", "github", "notion-api"],
                },
                error_code: {
                    type: "number",
                    description: "Get help for a specific error code",
                    examples: [-32001, -32002, -32003],
                },
            },
            examples: [
                { topic: "getting_started" },
                { topic: "workflow" },
                { package_id: "github" },
                { error_code: -32005 }
            ],
        },
    },
    {
        name: "health_check_all",
        description: "Check connection status and health of all configured packages. Useful for diagnosing issues or verifying which packages are available and authenticated. Shows which packages need authentication.",
        inputSchema: {
            type: "object",
            properties: {
                detailed: {
                    type: "boolean",
                    description: "Include detailed information for each package",
                    default: false,
                },
            },
        },
    },
    {
        name: "authenticate",
        description: "Start OAuth authentication for packages that require it (e.g., Notion, Slack). Opens browser for authorization. Use health_check_all first to see which packages need authentication.",
        inputSchema: {
            type: "object",
            properties: {
                package_id: {
                    type: "string",
                    description: "The package ID to authenticate (must be an OAuth-enabled package)",
                    examples: ["notion-api", "slack"],
                },
                wait_for_completion: {
                    type: "boolean",
                    description: "Whether to wait for OAuth completion before returning",
                    default: true,
                },
            },
            required: ["package_id"],
        },
    },
];
