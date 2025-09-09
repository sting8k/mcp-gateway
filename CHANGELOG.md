# Changelog

All notable changes to Super MCP Router will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2025-09-09

### Added
- Support for multiple configuration files via multiple --config arguments
- Support for comma-separated config paths in SUPER_MCP_CONFIG environment variable
- Automatic merging of servers from multiple config files (duplicates handled gracefully)

### Changed
- Configuration loading now supports both single and multiple file inputs
- Backward compatible - existing single config setups continue to work unchanged

## [1.0.4] - 2025-09-09

### Changed
- Reorganized README to prioritize npx (no-installation) method
- Improved documentation flow to make getting started easier
- Moved installation methods to a dedicated section

## [1.0.3] - 2025-09-09

### Fixed
- Fixed critical stdout pollution issue that broke MCP protocol when using npx
- Logger now correctly outputs to stderr instead of stdout, ensuring clean JSON-RPC communication
- This fix makes npx execution reliable for fresh installations

## [1.0.2] - 2025-09-06

### Added
- Support for new Streamable HTTP transport type (recommended for HTTP servers)
- Support for `cwd` configuration field to specify working directory for server processes
- Improved authentication error messages that guide users to authenticate when needed
- Browser-based OAuth provider with callback server for OAuth flows
- Global OAuth lock coordination to prevent concurrent OAuth flows

### Changed
- HTTP transport type detection now uses configured `type` field instead of URL-based detection
- Enhanced error handling for 401/Unauthorized responses with clearer user guidance
- Updated documentation to reflect HTTP+SSE deprecation (as of MCP spec 2025-03-26)

### Deprecated
- HTTP+SSE transport (`type: "sse"`) is now deprecated in favour of Streamable HTTP (`type: "http"`)

## [1.0.1] - 2025-09-01

### Added
- Device code OAuth flow support
- Token storage with OS keychain integration (with file fallback)
- Built-in help system with `get_help` tool
- Comprehensive error codes and contextual help

### Changed
- Improved logging with structured output
- Enhanced tool discovery and caching

## [1.0.0] - 2025-08-25

### Added
- Initial release of Super MCP Router
- Support for multiple MCP servers (stdio and HTTP)
- Meta-tools for package discovery and management
- Tool validation with Ajv schemas
- Basic OAuth support for HTTP servers