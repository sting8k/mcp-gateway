/**
 * Error code help content
 */
export function getErrorHelp(errorCode) {
    const errorHelp = {
        [-32001]: `# Error -32001: PACKAGE_NOT_FOUND

This error means the package_id you specified doesn't exist.

## How to Fix
1. Run \`list_tool_packages()\` to see all available packages
2. Copy the exact package_id from the response
3. Use that package_id in your request

## Common Causes
- Typo in package_id
- Package not configured in your MCP Gateway config (e.g., ~/.mcp-gateway/config.json)
- Using tool name instead of package_id`,
        [-32002]: `# Error -32002: TOOL_NOT_FOUND

The tool_id doesn't exist in the specified package.

## How to Fix
1. Run \`list_tools(package_id: "your-package")\` 
2. Find the correct tool_id from the response
3. Use the exact tool name/id

## Common Causes
- Wrong package selected
- Tool name changed or deprecated
- Case sensitivity issues`,
        [-32003]: `# Error -32003: ARG_VALIDATION_FAILED

The arguments provided don't match the tool's expected schema.

## How to Fix
1. Run \`list_tools(package_id: "...", include_schemas: true)\`
2. Review the exact schema requirements
3. Ensure all required fields are present
4. Check that types match exactly (string vs number)
5. Use \`dry_run: true\` to test

## Common Issues
- Missing required fields
- Wrong data types (sending string instead of number)
- Invalid enum values
- Incorrect nesting of objects`,
        [-32004]: `# Error -32004: PACKAGE_UNAVAILABLE

The package exists but isn't responding.

## How to Fix
1. Run \`health_check_all()\` to check status
2. If it shows "error", check your configuration
3. For local packages, ensure the command is installed
4. For HTTP packages, check network connectivity

## Common Causes
- Local MCP server not installed
- Network issues for HTTP packages
- Incorrect configuration in your MCP Gateway config (e.g., ~/.mcp-gateway/config.json)`,
        [-32005]: `# Error -32005: AUTH_REQUIRED

The package requires authentication before use.

## How to Fix
1. Run \`authenticate(package_id: "package-name")\`
2. Complete OAuth flow in browser
3. Try your operation again

## Notes
- Some packages require API keys in config
- OAuth tokens may expire and need refresh
- Check package documentation for auth setup`,
        [-32007]: `# Error -32007: DOWNSTREAM_ERROR

The underlying MCP server returned an error.

## How to Fix
1. Read the error message details carefully
2. Check if it's an auth issue (401/403)
3. Verify the operation is valid for that package
4. Check package-specific documentation

## Common Causes
- Expired authentication tokens
- Rate limiting
- Invalid operations for the package
- Permissions issues`,
    };
    const help = errorHelp[errorCode];
    if (help) {
        return help;
    }
    return `# Error Code ${errorCode}

This error code is not specifically documented.

## General Troubleshooting
1. Check the error message for details
2. Run \`health_check_all()\` to verify package status
3. Use \`list_tools\` to verify the tool exists
4. Validate arguments with \`dry_run: true\`
5. Check if authentication is needed

For more help, try:
- \`get_help(topic: "error_handling")\`
- \`get_help(topic: "workflow")\``;
}
