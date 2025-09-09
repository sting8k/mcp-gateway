# Super MCP Router

A local MCP router that aggregates multiple MCPs into a single interface for Claude. No installation required - just use npx!

## Overview

Super MCP Router allows you to configure multiple MCP servers (both local stdio and hosted HTTP) and access them through a single unified interface with these meta-tools:

- `list_tool_packages` - List available MCP packages and discover their capabilities
- `list_tools` - List tools in a specific package with schemas and examples
- `use_tool` - Execute a tool from any package
- `get_help` - Get detailed guidance on using Super-MCP effectively
- `authenticate` - Start OAuth authentication for packages that require it
- `health_check_all` - Check the operational status of all configured packages

## Quick Start (No Installation Required!)

### 1. Configure Your MCPs

```bash
# Create a configuration directory (e.g., in your home folder)
mkdir -p ~/.super-mcp
cd ~/.super-mcp

# Download the example configuration
curl -O https://raw.githubusercontent.com/JoshuaWohle/Super-MCP/main/super-mcp-config.example.json

# Copy to your config file
cp super-mcp-config.example.json super-mcp-config.json

# Edit with your MCP packages and credentials
nano super-mcp-config.json
```

### 2. Test Your Configuration

```bash
# Run directly with npx (no installation needed):
npx -y super-mcp-router@latest --config ~/.super-mcp/super-mcp-config.json
```

### 3. Add to Claude

Add to your Claude MCP settings:

```json
{
  "mcpServers": {
    "Super-MCP": {
      "command": "npx",
      "args": [
        "-y",
        "super-mcp-router@latest",
        "--config",
        "/Users/YOUR_USERNAME/.super-mcp/super-mcp-config.json"
      ]
    }
  }
}
```

That's it! No installation needed - npx will automatically download and run the latest version.

## Configuration

Super MCP Router supports the standard MCP `mcpServers` configuration format, making it easy to drop in existing MCP server configurations.

Create a `super-mcp-config.json` file:

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
- `env`: Environment variables
- `cwd`: Working directory for the server process
- `type`: Transport type:
  - `"stdio"`: Local command execution
  - `"sse"`: HTTP+SSE transport (deprecated as of MCP spec 2025-03-26)
  - `"http"`: Streamable HTTP transport (recommended for HTTP servers)
- `url`: Server URL (for HTTP servers)
- `headers`: HTTP headers for authentication

**Extended fields (super-mcp specific):**
- `oauth`: Enable OAuth authentication (boolean)
- `name`: Human-readable name for the package
- `description`: Description of the package's capabilities
- `visibility`: "default" or "hidden" (controls display in tool lists)

## Alternative Installation Methods

While npx is the recommended way to use Super MCP Router (no installation, always up-to-date), you can also:

### Install Globally

```bash
npm install -g super-mcp-router
```

Then use in Claude config:
```json
{
  "mcpServers": {
    "Super-MCP": {
      "command": "super-mcp-router",
      "args": [
        "--config",
        "/Users/YOUR_USERNAME/.super-mcp/super-mcp-config.json"
      ]
    }
  }
}
```

To update: `npm update -g super-mcp-router`

### Clone and Build from Source (For Development)

```bash
git clone https://github.com/JoshuaWohle/Super-MCP.git
cd Super-MCP
npm install
npm run build
```

Then use in Claude config:
```json
{
  "mcpServers": {
    "Super-MCP": {
      "command": "node",
      "args": [
        "/absolute/path/to/Super-MCP/dist/cli.js",
        "--config",
        "/Users/YOUR_USERNAME/.super-mcp/super-mcp-config.json"
      ]
    }
  }
}
```

To update:
```bash
cd /path/to/Super-MCP
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
- **Error Handling**: Comprehensive error codes and messages with contextual help
- **Improved Authentication**: Clear error messages guiding users to authenticate when needed
- **Built-in Help System**: Interactive guidance with `get_help` tool
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

- **Never commit your `super-mcp-config.json`** - it contains API keys and credentials
- Tokens stored securely in OS keychain (with file fallback)
- All sensitive data redacted from logs
- File tokens created with 0600 permissions
- Device code flow (no local HTTP server required)

⚠️ **Important**: The `.gitignore` file excludes your config file, but double-check before committing!

## Built-in Help System

Super MCP includes comprehensive built-in help accessible through the `get_help` tool:

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
// Get started with Super MCP
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
npm run dev -- --config ./super-mcp-config.json

# Build for production
npm run build
```