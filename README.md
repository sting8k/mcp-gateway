# MCP Gateway

A local MCP gateway that aggregates multiple MCP servers into a single interface for Claude. No installation required—just use `npx`.

## Overview

MCP Gateway allows you to configure multiple MCP servers (both local stdio and hosted HTTP) and access them through a single unified interface with these meta-tools:

- `list_tool_packages` - List available MCP packages and discover their capabilities
- `list_tools` - List tools in a specific package with schemas and examples
- `use_tool` - Execute a tool from any package
- `get_help` - Get detailed guidance on using MCP Gateway effectively
- `authenticate` - Start OAuth authentication for packages that require it
- `health_check_all` - Check the operational status of all configured packages

## Quick Start (No Installation Required!)

### 1. Add to Claude Desktop

Add this to your Claude Desktop MCP settings:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "mcp-gateway": {
      "command": "npx",
      "args": ["-y", "mcp-gateway@latest"]
    }
  }
}
```

### 2. Restart Claude Desktop

That's it! MCP Gateway will automatically:
- Create a `~/.mcp-gateway/` directory (migrating a legacy `~/.super-mcp/` directory if present)
- Create an empty config file at `~/.mcp-gateway/config.json`
- Start working immediately (even with no MCPs configured)

### 3. Add MCP Servers (Optional)

Use the simple CLI to add MCP servers:

```bash
# Add common MCP servers
npx mcp-gateway add filesystem
npx mcp-gateway add github
npx mcp-gateway add memory

# See available servers
npx mcp-gateway add --help
```

Or manually edit `~/.mcp-gateway/config.json` (or any other config file you supply) to add custom MCPs.

## Configuration

MCP Gateway supports the standard MCP `mcpServers` configuration format, making it easy to drop in existing MCP server configurations.

Create an `mcp-config.json` file:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/path/to/directory"
      ]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "YOUR_GITHUB_TOKEN"
      }
    },
    "notion-api": {
      "type": "sse",
      "url": "https://mcp.notion.com/mcp",
      "oauth": true,
      "name": "Notion Integration",
      "description": "Access and manage Notion workspaces"
    }
  }
}
```

### Configuration Options

**Standard MCP fields:**
- `command`: Command to execute (for stdio servers)
- `args`: Command arguments
- `env`: Environment variables (supports variable expansion - see below)
- `cwd`: Working directory for the server process
- `type`: Transport type:
  - `"stdio"`: Local command execution
  - `"sse"`: HTTP+SSE transport (deprecated as of MCP spec 2025-03-26)
  - `"http"`: Streamable HTTP transport (recommended for HTTP servers)
- `url`: Server URL (for HTTP servers)
- `headers`: HTTP headers for authentication

**Extended fields (gateway specific):**
- `oauth`: Enable OAuth authentication (boolean)
- `name`: Human-readable name for the package
- `description`: Description of the package's capabilities
- `visibility`: `"default"` or `"hidden"` (controls display in tool lists)
- `disabled`: Disable a package without removing it from the config

### Environment Variable Expansion

MCP Gateway supports environment variable expansion in the `env` field using `${VAR}` or `$VAR` syntax:

```json
{
  "github": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    "env": {
      "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
    }
  }
}
```

This allows you to:
- Keep sensitive tokens out of configuration files
- Share configurations without exposing credentials
- Use different values across environments

**Security Note**: Only explicitly configured environment variables are passed to MCP servers. This prevents leaking system environment variables to individual servers.

## CLI Commands

MCP Gateway includes a simple CLI for managing MCP servers:

### Adding MCP Servers

```bash
# Add pre-configured MCP servers
npx mcp-gateway add filesystem  # Adds filesystem access
npx mcp-gateway add github      # Adds GitHub integration 
npx mcp-gateway add memory      # Adds persistent memory

# See available servers
npx mcp-gateway add --help
```

The `add` command:
- Adds servers to `~/.mcp-gateway/config.json`
- Uses sensible defaults (e.g., `~/Documents` for filesystem)
- Reminds you about required environment variables

### Default Config Location

If no `--config` is specified, MCP Gateway uses:
- `~/.mcp-gateway/config.json` (auto-created if missing)

A legacy `~/.super-mcp/config.json` is migrated on first run. You can still use custom locations:

```bash
npx mcp-gateway --config /custom/path/config.json
```

Environment variables:
- `MCP_GATEWAY_CONFIG=/path/to/config.json` (supports comma-separated paths)
- `SUPER_MCP_CONFIG` is still respected for backwards compatibility

### Log to File (Optional)

Enable file-based logging with either `--log-to-file` or by setting `MCP_GATEWAY_ENABLE_FILE_LOGS=true`. Logs are written to `~/.mcp-gateway/logs/`.

## Using Multiple Configuration Files

You can split your MCP servers across multiple configuration files for better organization. This is useful for:
- Separating personal and work MCPs
- Grouping MCPs by functionality (e.g., dev tools, AI services, databases)
- Sharing common configurations across projects
- Managing team-wide vs personal tool configurations

### Method 1: Multiple --config Arguments

In your Claude configuration, you can specify multiple config files:

```json
{
  "mcpServers": {
    "mcp-gateway": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-gateway@latest",
        "--config",
        "/Users/YOU/.mcp-gateway/personal-mcps.json",
        "--config",
        "/Users/YOU/.mcp-gateway/work-mcps.json",
        "--config",
        "/Users/YOU/.mcp-gateway/shared-mcps.json"
      ]
    }
  }
}
```

### Method 2: Environment Variable (Comma-Separated)

Set the environment variable with comma-separated paths:

```bash
export MCP_GATEWAY_CONFIG="/path/to/personal.json,/path/to/work.json,/path/to/shared.json"
```

Then use MCP Gateway normally - it will automatically load all specified configs (with hot reload support when files change).

### Example: Organizing by Function

**dev-tools.json:**
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/YOU/dev"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "YOUR_TOKEN" }
    }
  }
}
```

**ai-services.json:**
```json
{
  "mcpServers": {
    "brave-search": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-brave-search"],
      "env": { "BRAVE_API_KEY": "YOUR_KEY" }
    }
  }
}
```

### Important Notes

- **Duplicate IDs**: If the same server ID appears in multiple configs, the last one loaded takes precedence (with a warning logged)
- **Hot Reload**: Config changes are picked up without restarting the gateway
- **Error Handling**: If any config file fails to load, the entire startup fails (fail-fast behavior)
- **Backward Compatible**: Single config files work exactly as before - no changes needed to existing setups
- **Legacy Format**: The old `packages` array format is still supported and automatically converted

## Alternative Installation Methods

While `npx` is the recommended way to use MCP Gateway (no installation, always up-to-date), you can also:

### Install Globally

```bash
npm install -g mcp-gateway
```

Then use in Claude config:

```json
{
  "mcpServers": {
    "mcp-gateway": {
      "command": "mcp-gateway",
      "args": [
        "--config",
        "/Users/YOUR_USERNAME/.mcp-gateway/config.json"
      ]
    }
  }
}
```

To update: `npm update -g mcp-gateway`

### Clone and Build from Source (For Development)

```bash
git clone https://github.com/sting8k/mcp-gateway.git
cd mcp-gateway
npm install
npm run build
```

Then use in Claude config:

```json
{
  "mcpServers": {
    "mcp-gateway": {
      "command": "node",
      "args": [
        "/absolute/path/to/mcp-gateway/dist/cli.js",
        "--config",
        "/Users/YOUR_USERNAME/.mcp-gateway/config.json"
      ]
    }
  }
}
```

To update:

```bash
cd /path/to/mcp-gateway
git pull
npm install
npm run build
```

## Features

- **Single Interface**: Access all your MCPs through one connection
- **Mixed Transports**: Combine stdio and HTTP MCPs seamlessly
- **HTTP Transport Support**: Both HTTP+SSE (legacy) and Streamable HTTP (recommended)
- **OAuth Support**: Browser-based OAuth flow with persistent token storage
- **Tool Discovery**: Automatic tool enumeration and caching
- **Validation**: Schema validation for all tool arguments
- **Config Hot Reload**: Watches config files and reloads packages without restarting
- **Improved HTTP Reconnect**: Automatic reconnection for transient transport failures
- **Improved Authentication**: Clear error messages guiding users to authenticate when needed
- **Built-in Help System**: Interactive guidance with `get_help` tool
- **Auto Migration**: Legacy `.super-mcp` configs are migrated on first run
- **Portable**: Everything contained within this directory

## Project Structure

```
src/
├── cli.ts              # CLI entry point
├── server.ts           # MCP server with meta-tools
├── registry.ts         # Config loading & package management
├── catalog.ts          # Tool caching & discovery
├── summarize.ts        # Tool summaries & arg skeletons
├── validator.ts        # Argument validation
├── logging.ts          # Structured logging
├── types.ts            # TypeScript definitions
├── auth/
│   ├── manager.ts      # Token storage (keychain + file fallback)
│   ├── deviceCode.ts   # Device code OAuth flow
│   ├── browserOAuthProvider.ts # Browser OAuth provider
│   ├── callbackServer.ts # OAuth callback server
│   └── globalOAuthLock.ts # OAuth flow coordination
└── clients/
    ├── stdioClient.ts  # Stdio MCP client
    └── httpClient.ts   # HTTP MCP client
```

## Security

- **Never commit your MCP config files** - they contain API keys and credentials
- Tokens stored securely in OS keychain (with file fallback)
- All sensitive data redacted from logs
- File tokens created with 0600 permissions
- Device code flow (no local HTTP server required)

⚠️ **Important**: The `.gitignore` file excludes your config file, but double-check before committing!

## Built-in Help System

MCP Gateway includes comprehensive built-in help accessible through the `get_help` tool:

### Help Topics
- **getting_started**: Basic workflow and examples
- **workflow**: Common usage patterns
- **authentication**: OAuth and API key setup
- **tool_discovery**: Finding and understanding available tools
- **error_handling**: Troubleshooting error codes
- **common_patterns**: Typical usage scenarios
- **package_types**: Understanding different MCP types

### Usage Examples
```javascript
// Get started with MCP Gateway
get_help(topic: "getting_started")

// Get help for a specific package
get_help(package_id: "github")

// Get help for an error code
get_help(error_code: -32003)
```

### Enhanced Error Messages
All errors now include contextual guidance pointing to relevant help resources and suggesting next steps.

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev -- --config ./mcp-config.json

# Build for production
npm run build
```

MCP Gateway hot-reloads config files while `npm run dev` is running, making it easy to iterate on your configuration without restarting.
