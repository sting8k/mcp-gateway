# Super MCP Router

A local MCP router that aggregates multiple MCPs into a single interface for Claude.

## Overview

Super MCP Router allows you to configure multiple MCP servers (both local stdio and hosted HTTP) and access them through a single unified interface with just 5 meta-tools:

- `list_tool_packages` - List available MCP packages
- `list_tools` - List tools in a specific package  
- `use_tool` - Execute a tool from any package
- `begin_auth` - Start OAuth authentication for hosted MCPs
- `auth_status` - Check authentication status

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/your-username/super-mcp-router.git
cd super-mcp-router
npm install
```

### 2. Configure Your MCPs

```bash
# Copy the example configuration
cp super-mcp-config.example.json super-mcp-config.json

# Edit with your MCP packages and credentials
nano super-mcp-config.json
```

### 3. Build and Test

```bash
# Build the project
npm run build

# Test with your config
npx tsx src/cli.ts --config ./super-mcp-config.json
```

### 4. Add to Claude

Add to your Claude MCP settings:

```json
{
  "mcpServers": {
    "Super-MCP": {
      "command": "npx",
      "args": [
        "tsx",
        "/absolute/path/to/super-mcp-router/src/cli.ts",
        "--config",
        "/absolute/path/to/super-mcp-router/super-mcp-config.json"
      ]
    }
  }
}
```

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
- `type`: Transport type ("stdio" or "sse")
- `url`: Server URL (for HTTP/SSE servers)
- `headers`: HTTP headers for authentication

**Extended fields (super-mcp specific):**
- `oauth`: Enable OAuth authentication (boolean)
- `name`: Human-readable name for the package
- `description`: Description of the package's capabilities
- `visibility`: "default" or "hidden" (controls display in tool lists)

## Claude Configuration

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
        "/absolute/path/to/super-mcp-config.json"
      ]
    }
  }
}
```

## Features

- **Single Interface**: Access all your MCPs through one connection
- **Mixed Transports**: Combine stdio and HTTP MCPs seamlessly
- **OAuth Support**: Browser-based OAuth flow with persistent token storage
- **Tool Discovery**: Automatic tool enumeration and caching
- **Validation**: Schema validation for all tool arguments
- **Error Handling**: Comprehensive error codes and messages
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

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev -- --config ./super-mcp-config.json

# Build for production
npm run build
```