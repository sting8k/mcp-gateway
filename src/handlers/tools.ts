import { ListToolsInput, ListToolsOutput } from "../types.js";
import { Catalog } from "../catalog.js";

export async function handleListTools(
  input: ListToolsInput,
  catalog: Catalog,
  validator: any
): Promise<any> {
  const {
    package_id,
    summarize = true,
    include_schemas = false,
    page_size = 20,
    page_token,
  } = input;

  const toolInfos = await catalog.buildToolInfos(package_id, {
    summarize,
    include_schemas,
  });

  // Apply pagination
  const startIndex = page_token ? 
    Math.max(0, parseInt(Buffer.from(page_token, 'base64').toString('utf8'))) : 0;
  const endIndex = startIndex + page_size;
  const tools = toolInfos.slice(startIndex, endIndex);
  
  const nextToken = endIndex < toolInfos.length ? 
    Buffer.from(endIndex.toString()).toString('base64') : null;

  const result: ListToolsOutput = {
    tools,
    next_page_token: nextToken,
  };

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2),
      },
    ],
    isError: false,
  };
}
