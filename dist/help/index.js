/**
 * Help system for MCP Gateway
 * Provides user-facing documentation and troubleshooting guidance
 */
import { getTopicHelp } from "./topics.js";
import { getErrorHelp } from "./errors.js";
import { getPackageHelp } from "./packages.js";
export { getTopicHelp, getErrorHelp, getPackageHelp };
/**
 * Main help handler for the get_help tool
 */
export async function handleGetHelp(input, registry) {
    const { topic = "getting_started", package_id, error_code } = input;
    let helpContent = "";
    // Handle error code help
    if (error_code !== undefined) {
        helpContent = getErrorHelp(error_code);
    }
    // Handle package-specific help
    else if (package_id) {
        helpContent = await getPackageHelp(package_id, registry);
    }
    // Handle topic help
    else {
        helpContent = getTopicHelp(topic);
    }
    return {
        content: [
            {
                type: "text",
                text: helpContent,
            },
        ],
        isError: false,
    };
}
