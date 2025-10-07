/**
 * Package-specific help content
 */

import { PackageRegistry } from "../registry.js";
import { Catalog } from "../catalog.js";
import { getLogger } from "../logging.js";

const logger = getLogger();

export async function getPackageHelp(packageId: string, registry: PackageRegistry): Promise<string> {
  try {
    const pkg = registry.getPackage(packageId, { include_disabled: true });
    if (!pkg) {
      return `# Package Not Found: ${packageId}

The package "${packageId}" doesn't exist.

Run \`list_tool_packages()\` to see available packages.`;
    }

    if (pkg.disabled) {
      return `# Package Disabled: ${packageId}

The package "${packageId}" is currently disabled in your configuration.

Update your MCP Gateway config to enable it, then rerun \`list_tool_packages()\` or other commands.`;
    }

    const catalog = new Catalog(registry);
    let toolCount = 0;
    let toolExamples = "";
    
    try {
      const tools = await catalog.getPackageTools(packageId);
      toolCount = tools.length;
      
      if (tools.length > 0) {
        const exampleTools = tools.slice(0, 5).map(t => `- ${t.tool.name}: ${t.tool.description || 'No description'}`).join('\n');
        toolExamples = `
## Available Tools (showing first 5 of ${toolCount})
${exampleTools}

Use \`list_tools(package_id: "${packageId}")\` to see all tools.`;
      }
    } catch (error) {
      logger.debug("Could not load tools for help", { package_id: packageId });
      toolExamples = `
## Tools
Unable to load tools. The package may require authentication.
Use \`authenticate(package_id: "${packageId}")\` if needed.`;
    }

    const authInfo = pkg.transport === "http" && pkg.oauth 
      ? `
## Authentication
This package requires OAuth authentication.
Use \`authenticate(package_id: "${packageId}")\` to connect.`
      : pkg.transport === "stdio"
      ? `
## Authentication
This is a local package - no authentication needed.`
      : "";

    return `# Package: ${pkg.name || packageId}

${pkg.description || 'No description available'}

## Basic Info
- **ID**: ${packageId}
- **Type**: ${pkg.transport}
- **Status**: Run \`health_check_all()\` to check
${pkg.transport === "http" ? `- **URL**: ${pkg.base_url || 'Not specified'}` : ''}
${toolExamples}
${authInfo}

## Usage Example
\`\`\`
// 1. List available tools
list_tools(package_id: "${packageId}")

// 2. Execute a tool
use_tool(
  package_id: "${packageId}",
  tool_id: "tool_name",
  args: { /* tool-specific arguments */ }
)
\`\`\`

## Troubleshooting
- If tools aren't working, check \`health_check_all()\`
- For detailed schemas: \`list_tools(package_id: "${packageId}", include_schemas: true)\`
- Test arguments: Add \`dry_run: true\` to use_tool`;

  } catch (error) {
    return `Error generating help for package ${packageId}: ${error instanceof Error ? error.message : String(error)}`;
  }
}
