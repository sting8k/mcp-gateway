import {
  ERROR_CODES,
  UseToolInput,
  UseToolOutput,
  MultiToolCallInput,
  MultiToolCallOutput,
  MultiToolCallResult,
  MultiToolCallRequestItem,
} from "../types.js";
import { PackageRegistry } from "../registry.js";
import { Catalog } from "../catalog.js";
import { ValidationError } from "../validator.js";

interface GatewayContext {
  registry: PackageRegistry;
  catalog: Catalog;
  validator: ReturnType<any>;
}

export async function handleUseTool(
  input: UseToolInput,
  registry: PackageRegistry,
  catalog: Catalog,
  validator: any
): Promise<any> {
  const { package_id, tool_id, args, dry_run = false } = input;

  // Validate that the package exists
  const packageConfig = registry.getPackage(package_id);
  if (!packageConfig) {
    const disabledConfig = registry.getPackage(package_id, { include_disabled: true });
    if (disabledConfig?.disabled) {
      throw {
        code: ERROR_CODES.PACKAGE_UNAVAILABLE,
        message: `Package ${package_id} is disabled in configuration`,
        data: { package_id },
      };
    }
    throw {
      code: ERROR_CODES.PACKAGE_NOT_FOUND,
      message: `Package not found: ${package_id}`,
      data: { package_id },
    };
  }

  // Get and validate the tool schema
  const schema = await catalog.getToolSchema(package_id, tool_id);
  if (!schema) {
    throw {
      code: ERROR_CODES.TOOL_NOT_FOUND,
      message: `Tool not found: ${tool_id} in package ${package_id}`,
      data: { package_id, tool_id },
    };
  }

  // Validate arguments
  try {
    validator.validate(schema, args, { package_id, tool_id });
  } catch (error) {
    if (error instanceof ValidationError) {
      // Build a helpful error message
      let helpMessage = `Argument validation failed for tool '${tool_id}' in package '${package_id}'.\n`;
      helpMessage += `\n${error.message}\n`;
      
      // Add specific guidance based on validation errors
      if (error.errors && error.errors.length > 0) {
        helpMessage += `\nValidation errors:`;
        error.errors.forEach((err: any) => {
          const path = err.instancePath || "root";
          helpMessage += `\n  • ${path}: ${err.message}`;
          
          // Add specific suggestions
          if (err.keyword === "required") {
            helpMessage += ` (missing: ${err.params?.missingProperty})`;
          } else if (err.keyword === "type") {
            helpMessage += ` (expected: ${err.params?.type}, got: ${typeof err.data})`;
          } else if (err.keyword === "enum") {
            helpMessage += ` (allowed values: ${err.params?.allowedValues?.join(", ")})`;
          }
        });
      }
      
      helpMessage += `\n\nTo see the correct schema, run:`;
      helpMessage += `\n  list_tools(package_id: "${package_id}", include_schemas: true)`;
      helpMessage += `\n\nTo test your arguments without executing:`;
      helpMessage += `\n  use_tool(package_id: "${package_id}", tool_id: "${tool_id}", args: {...}, dry_run: true)`;
      
      throw {
        code: ERROR_CODES.ARG_VALIDATION_FAILED,
        message: helpMessage,
        data: {
          package_id,
          tool_id,
          errors: error.errors,
          provided_args: args ? Object.keys(args) : [],
        },
      };
    }
    throw error;
  }

  // Handle dry run
  if (dry_run) {
    const result: UseToolOutput = {
      package_id,
      tool_id,
      args_used: args,
      result: { dry_run: true },
      telemetry: { duration_ms: 0, status: "ok" },
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

  // Execute the tool
  const startTime = Date.now();
  try {
    const client = await registry.getClient(package_id);
    const toolResult = await client.callTool(tool_id, args);
    const duration = Date.now() - startTime;

    const result: UseToolOutput = {
      package_id,
      tool_id,
      args_used: args,
      result: toolResult,
      telemetry: { duration_ms: duration, status: "ok" },
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
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Build helpful diagnostic message
    let diagnosticMessage = `Tool execution failed in package '${package_id}', tool '${tool_id}'.\n`;
    
    // Add specific error context
    if (errorMessage.includes("not found") || errorMessage.includes("undefined")) {
      diagnosticMessage += `\n❌ Tool might not exist or package not properly connected`;
      diagnosticMessage += `\nTroubleshooting:`;
      diagnosticMessage += `\n  1. Run 'health_check_all()' to verify package status`;
      diagnosticMessage += `\n  2. Run 'list_tools(package_id: "${package_id}")' to see available tools`;
      diagnosticMessage += `\n  3. Check if the tool name is correct (case-sensitive)`;
    } else if (errorMessage.includes("timeout")) {
      diagnosticMessage += `\n❌ Tool execution timed out after ${duration}ms`;
      diagnosticMessage += `\nThis might indicate:`;
      diagnosticMessage += `\n  1. The operation is taking longer than expected`;
      diagnosticMessage += `\n  2. The MCP server is not responding`;
      diagnosticMessage += `\n  3. Network issues (for HTTP-based MCPs)`;
    } else if (errorMessage.includes("permission") || errorMessage.includes("denied")) {
      diagnosticMessage += `\n❌ Permission denied`;
      diagnosticMessage += `\nPossible causes:`;
      diagnosticMessage += `\n  1. Insufficient permissions for the requested operation`;
      diagnosticMessage += `\n  2. API key/token lacks required scopes`;
      diagnosticMessage += `\n  3. File system permissions (for filesystem MCPs)`;
    } else if (errorMessage.includes("auth") || errorMessage.includes("401") || errorMessage.includes("403")) {
      diagnosticMessage += `\n❌ Authentication/Authorization error`;
      diagnosticMessage += `\nTroubleshooting:`;
      diagnosticMessage += `\n  1. Check if API keys/tokens are valid`;
      diagnosticMessage += `\n  2. Run 'authenticate(package_id: "${package_id}")' if OAuth-based`;
      diagnosticMessage += `\n  3. Verify credentials have required permissions`;
    } else {
      diagnosticMessage += `\n❌ ${errorMessage}`;
    }
    
    // Add execution context
    diagnosticMessage += `\n\nExecution context:`;
    diagnosticMessage += `\n  Package: ${package_id}`;
    diagnosticMessage += `\n  Tool: ${tool_id}`;
    diagnosticMessage += `\n  Duration: ${duration}ms`;
    if (args && Object.keys(args).length > 0) {
      diagnosticMessage += `\n  Arguments provided: ${Object.keys(args).join(", ")}`;
    }
    
    throw {
      code: ERROR_CODES.DOWNSTREAM_ERROR,
      message: diagnosticMessage,
      data: {
        package_id,
        tool_id,
        duration_ms: duration,
        original_error: errorMessage,
        args_provided: args ? Object.keys(args) : [],
      },
    };
  }
}

export async function handleMultiUseTool(
  input: MultiToolCallInput,
  context: GatewayContext
): Promise<any> {
  const totalRequests = input.requests.length;
  const results: MultiToolCallResult[] = new Array(totalRequests);
  const effectiveConcurrency = Math.max(
    1,
    Math.min(
      typeof input.concurrency === "number" && input.concurrency > 0
        ? input.concurrency
        : totalRequests,
      totalRequests
    )
  );
  const deadline =
    typeof input.timeout_ms === "number" ? Date.now() + input.timeout_ms : undefined;
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= totalRequests) {
        break;
      }

      const request = input.requests[currentIndex];
      if (deadline && Date.now() > deadline) {
        results[currentIndex] = createMultiToolTimeoutResult(request);
        continue;
      }

      const callStart = Date.now();
      const useToolInput: UseToolInput = {
        package_id: request.package_id,
        tool_id: request.tool_id,
        args: request.args ?? {},
        dry_run: request.dry_run ?? false,
      };

      try {
        const response = await handleUseTool(
          useToolInput,
          context.registry,
          context.catalog,
          context.validator
        );
        const payload = extractUseToolPayload(response);
        results[currentIndex] = {
          status: "ok",
          request_id: request.request_id,
          ...payload,
        };
      } catch (error) {
        const duration = Date.now() - callStart;
        const normalized = normalizeMultiToolError(error);
        results[currentIndex] = {
          status: "error",
          request_id: request.request_id,
          package_id: request.package_id,
          tool_id: request.tool_id,
          error: normalized,
          telemetry: {
            duration_ms: duration,
            status: "error",
          },
        };
      }
    }
  };

  await Promise.all(Array.from({ length: effectiveConcurrency }, () => worker()));

  for (let i = 0; i < totalRequests; i += 1) {
    if (!results[i]) {
      results[i] = createMultiToolTimeoutResult(input.requests[i]);
    }
  }

  const output: MultiToolCallOutput = { results };
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(output, null, 2),
      },
    ],
    isError: false,
    structuredContent: output,
  };
}

export function extractUseToolPayload(response: any): UseToolOutput {
  const textEntry = Array.isArray(response?.content)
    ? response.content.find((item: any) => typeof item?.text === "string")
    : undefined;

  if (!textEntry) {
    throw {
      code: ERROR_CODES.INTERNAL_ERROR,
      message: "Invalid response format returned from use_tool handler",
    };
  }

  try {
    return JSON.parse(textEntry.text) as UseToolOutput;
  } catch (error) {
    throw {
      code: ERROR_CODES.INTERNAL_ERROR,
      message: "Failed to parse use_tool handler response payload",
      data: {
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export function normalizeMultiToolError(error: unknown): {
  code: number;
  message: string;
  data?: any;
} {
  if (error instanceof ValidationError) {
    return {
      code: error.code,
      message: error.message,
      data: { errors: error.errors },
    };
  }

  if (error && typeof error === "object") {
    const maybeCode = (error as any).code;
    const maybeMessage = (error as any).message;
    const maybeData = (error as any).data;
    if (typeof maybeCode === "number" && typeof maybeMessage === "string") {
      return maybeData !== undefined
        ? { code: maybeCode, message: maybeMessage, data: maybeData }
        : { code: maybeCode, message: maybeMessage };
    }
  }

  if (error instanceof Error) {
    return {
      code: ERROR_CODES.DOWNSTREAM_ERROR,
      message: error.message,
    };
  }

  return {
    code: ERROR_CODES.INTERNAL_ERROR,
    message: String(error),
  };
}

export function createMultiToolTimeoutResult(
  request: MultiToolCallRequestItem
): MultiToolCallResult {
  return {
    status: "error",
    request_id: request.request_id,
    package_id: request.package_id,
    tool_id: request.tool_id,
    error: {
      code: ERROR_CODES.DOWNSTREAM_ERROR,
      message: "Batch timeout reached before request execution",
      data: { reason: "batch_timeout" },
    },
    telemetry: {
      duration_ms: 0,
      status: "error",
    },
  };
}
