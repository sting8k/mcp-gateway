/**
 * Help content for various topics in MCP Gateway
 */

export function getTopicHelp(topic: string): string {
  const helpTopics: Record<string, string> = {
    getting_started: `# Getting Started with MCP Gateway

MCP Gateway provides a unified interface to multiple MCP (Model Context Protocol) packages. Here's how to use it effectively:

## Basic Workflow
1. **Discover Packages**: Use \`list_tool_packages\` to see available MCP packages
2. **Explore Tools**: Use \`list_tools\` with a package_id to discover tools in that package
3. **Execute Tools**: Use \`use_tool\` to run a specific tool with appropriate arguments

## Example Flow
\`\`\`
1. list_tool_packages() → See all available packages
2. list_tools(package_id: "filesystem") → See filesystem tools
3. use_tool(package_id: "filesystem", tool_id: "read_file", args: {path: "/tmp/test.txt"})
\`\`\`

## Tips
- Always check package health with \`health_check_all\` if tools aren't working
- Some packages require authentication - use \`authenticate\` when needed
- Use \`dry_run: true\` in use_tool to validate arguments without executing`,

    workflow: `# MCP Gateway Workflow Patterns

## Discovery Flow
1. Start with \`list_tool_packages\` to understand available capabilities
2. Note the package_id values for packages you want to use
3. Use \`list_tools\` to explore each package's functionality
4. Review the argument schemas carefully before using tools

## Common Patterns

### File Operations
- Package: usually "filesystem" or similar
- Common tools: read_file, write_file, list_directory
- Always use absolute paths

### API Integrations
- Packages: "github", "notion-api", "slack", etc.
- May require authentication via \`authenticate\`
- Check health_check_all to verify connection status

### Search Operations
- Look for packages with "search" in the name
- Tools often have query parameters with specific syntax
- Use dry_run to test complex queries

## Error Recovery
- If a tool fails, check the error message for guidance
- Use \`get_help(error_code: <code>)\` for specific error help
- Verify authentication status for API packages
- Check argument types match the schema exactly`,

    authentication: `# Authentication in MCP Gateway

## Overview
Some MCP packages require authentication to access their APIs (e.g., Notion, Slack, GitHub private repos).

## How to Authenticate
1. **Check Status**: Run \`health_check_all\` to see which packages need auth
2. **Start Auth**: Use \`authenticate(package_id: "package-name")\`
3. **Complete in Browser**: A browser window opens for authorization
4. **Verify**: Run \`health_check_all\` again to confirm authentication

## Package Types
- **Local (stdio)**: No authentication needed, runs locally
- **Public APIs**: May work without auth but with limitations
- **Private APIs**: Always require authentication (OAuth)

## Troubleshooting
- If authentication fails, try again - OAuth tokens can expire
- Some packages store tokens securely and remember authentication
- Check package documentation for specific auth requirements`,

    tool_discovery: `# Discovering Tools in MCP Gateway

## Understanding Package Structure
Each package contains related tools:
- **filesystem**: File and directory operations
- **github**: Repository, issue, and PR management
- **notion-api**: Page and database operations
- **brave-search**: Web search capabilities

## Using list_tools Effectively
\`\`\`
list_tools(package_id: "github", summarize: true)
\`\`\`

Returns:
- Tool names and descriptions
- Argument skeletons showing expected format
- Schema hashes for validation

## Reading Tool Schemas
- Required fields are marked in the schema
- Check type constraints (string, number, boolean, object, array)
- Note any enum values for restricted options
- Look for format hints (uri, email, date)

## Tips
- Start with summarize: true for readable format
- Use include_schemas: true only when debugging
- Page through results if a package has many tools`,

    error_handling: `# Error Handling in MCP Gateway

## Common Error Codes

### -32001: PACKAGE_NOT_FOUND
- The package_id doesn't exist
- Solution: Use \`list_tool_packages\` to see valid package IDs

### -32002: TOOL_NOT_FOUND
- The tool_id doesn't exist in the specified package
- Solution: Use \`list_tools(package_id)\` to see valid tool IDs

### -32003: ARG_VALIDATION_FAILED
- Arguments don't match the tool's schema
- Solution: Check the schema and ensure types match exactly
- Use dry_run: true to test arguments

### -32004: PACKAGE_UNAVAILABLE
- Package is configured but not responding
- Solution: Check \`health_check_all\` and verify configuration

### -32005: AUTH_REQUIRED
- Package needs authentication
- Solution: Use \`authenticate(package_id)\`

### -32007: DOWNSTREAM_ERROR
- The underlying MCP server returned an error
- Solution: Check error details and tool documentation

## Best Practices
- Always validate arguments match the schema
- Use dry_run for testing complex operations
- Check health status before troubleshooting
- Read error messages carefully - they often contain the solution`,

    common_patterns: `# Common Patterns in MCP Gateway

## File Management Pattern
\`\`\`
1. list_tools(package_id: "filesystem")
2. use_tool(package_id: "filesystem", tool_id: "list_directory", args: {path: "/tmp"})
3. use_tool(package_id: "filesystem", tool_id: "read_file", args: {path: "/tmp/data.txt"})
4. use_tool(package_id: "filesystem", tool_id: "write_file", args: {path: "/tmp/output.txt", content: "..."})
\`\`\`

## API Search Pattern
\`\`\`
1. authenticate(package_id: "github")  // If needed
2. use_tool(package_id: "github", tool_id: "search_repositories", args: {query: "language:python"})
3. use_tool(package_id: "github", tool_id: "get_repository", args: {owner: "...", repo: "..."})
\`\`\`

## Data Processing Pattern
\`\`\`
1. Read data from one source
2. Process/transform the data
3. Write to another destination
4. Verify the operation succeeded
\`\`\`

## Diagnostic Pattern
\`\`\`
1. health_check_all(detailed: true)
2. Identify problematic packages
3. authenticate() if needed
4. Retry failed operations
\`\`\``,

    package_types: `# Package Types in MCP Gateway

## Local (stdio) Packages
- Run as local processes on your machine
- No network latency
- Full access to local filesystem (with permissions)
- Examples: filesystem, git, docker
- Configuration: command and args

## HTTP/SSE Packages
- Connect to remote MCP servers
- May require authentication (OAuth)
- Subject to network latency and limits
- Examples: notion-api, slack, cloud services
- Configuration: url and optional headers

## Package Capabilities
Different packages offer different capabilities:

### Data Access
- filesystem: Local file operations
- database packages: SQL queries
- API packages: Cloud service data

### Automation
- git: Version control operations
- docker: Container management
- ci/cd packages: Pipeline control

### Integration
- notion-api: Workspace management
- slack: Communication automation
- github: Repository management

## Choosing Packages
- Use local packages for file/system operations
- Use HTTP packages for cloud services
- Check authentication requirements upfront
- Consider rate limits for API packages`,
  };

  return helpTopics[topic] || `Unknown help topic: ${topic}. Available topics: ${Object.keys(helpTopics).join(", ")}`;
}
