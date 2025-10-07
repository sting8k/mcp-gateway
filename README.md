# MCP Gateway

Aggregate multiple MCP servers into a single interface for CLI. No installation required.

## Quick Start

**1. Add to AI Agent CLI**

Edit your cli config:

```json
{
  "mcpServers": {
    "mcp-gateway": {
      "command": "npx",
      "args": ["-y", "github:sting8k/mcp-gateway", "--transport", "stdio", "--log-to-file", "--log-level", "info"]
    }
  }
}
```

**2. Restart Claude**

MCP Gateway auto-creates `~/.mcp-gateway/config.json` on first run.

> `--transport stdio` is required for CLI's MCP integration. `--log-to-file` keeps protocol-safe logs under `~/.mcp-gateway/logs/`; adjust `--log-level` as needed.

**3. Add MCP Servers** (Optional)

```bash
npx mcp-gateway add filesystem
npx mcp-gateway add github
```

Or edit `~/.mcp-gateway/config.json` directly.

## Configuration

Example `~/.mcp-gateway/config.json`:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxx"
      }
    },
    "notion": {
      "type": "http",
      "url": "https://mcp.notion.com/mcp",
      "oauth": true
    }
  }
}
```

### Config Options

**Stdio servers:**
- `command`: Command to run
- `args`: Arguments
- `env`: Environment variables
- `cwd`: Working directory

**HTTP servers:**
- `type`: `"http"` or `"sse"`
- `url`: Server URL
- `oauth`: Enable OAuth (boolean)
- `headers`: HTTP headers

**Common:**
- `disabled`: Disable without removing (boolean)
- `name`, `description`: Display info

### Environment Variables

Use `${VAR}` in config:
```json
"env": {
  "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
}
```

### Multiple Config Files

Use multiple files via `--config` or comma-separated `MCP_GATEWAY_CONFIG`:

```bash
export MCP_GATEWAY_CONFIG="~/personal.json,~/work.json"
```

## Installation Alternatives

**From GitHub:**
```bash
npx github:sting8k/mcp-gateway
```

**Global install (if published to npm):**
```bash
npm install -g mcp-gateway
```

**From source:**
```bash
git clone https://github.com/sting8k/mcp-gateway.git
cd mcp-gateway
npm install && npm run build
```

## Features

- Single interface for all MCPs (stdio + HTTP)
- OAuth support with token storage
- Tool discovery & validation
- Config hot reload
- Built-in help: `get_help(topic: "getting_started")`

## Security

⚠️ Never commit config files with API keys. Tokens stored in OS keychain.

## Links

- [MCP Specification](https://modelcontextprotocol.io)
- [Available MCP Servers](https://github.com/modelcontextprotocol/servers)
- [Issues & Support](https://github.com/sting8k/mcp-gateway/issues)

---

**License:** MIT
