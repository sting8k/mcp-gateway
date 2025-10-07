import { describe, it, expect, vi } from "vitest";
import { handleMultiUseTool } from "../src/handlers/index.js";
import { ERROR_CODES, MultiToolCallInput, MultiToolCallOutput } from "../src/types.js";
import { ValidationError } from "../src/validator.js";

const baseSchema = {
  type: "object",
  properties: {
    message: { type: "string" },
  },
  required: ["message"],
};

type CallToolImpl = (toolId: string, args: any) => Promise<any>;

type TestContext = {
  registry: {
    getPackage: ReturnType<typeof vi.fn>;
    getClient: ReturnType<typeof vi.fn>;
  };
  catalog: {
    getToolSchema: ReturnType<typeof vi.fn>;
  };
  validator: {
    validate: ReturnType<typeof vi.fn>;
  };
  callToolMock: ReturnType<typeof vi.fn>;
};

function createContext(callToolImpl: CallToolImpl, overrides?: { schema?: any; packageId?: string }): TestContext {
  const packageId = overrides?.packageId ?? "pkg";
  const packageConfig = { id: packageId, disabled: false };
  const callToolMock = vi.fn(callToolImpl);

  const registry = {
    getPackage: vi.fn((id: string, options?: { include_disabled?: boolean }) => {
      if (id !== packageId) {
        return undefined;
      }
      if (packageConfig.disabled && !options?.include_disabled) {
        return undefined;
      }
      return packageConfig;
    }),
    getClient: vi.fn(async (id: string) => {
      if (id !== packageId) {
        throw new Error(`Package not found: ${id}`);
      }
      return {
        callTool: callToolMock,
      };
    }),
  };

  const catalog = {
    getToolSchema: vi.fn(async () => overrides?.schema ?? baseSchema),
  };

  const validator = {
    validate: vi.fn(() => {}),
  };

  return { registry, catalog, validator, callToolMock };
}

describe("handleMultiUseTool", () => {
  it("executes multiple requests concurrently and preserves input order", async () => {
    const completionOrder: string[] = [];
    const context = createContext(async (_toolId, args) => {
      if (args.message === "first") {
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      completionOrder.push(args.message);
      return { outcome: args.message };
    });

    const input: MultiToolCallInput = {
      requests: [
        {
          package_id: "pkg",
          tool_id: "echo",
          args: { message: "first" },
          request_id: "req-1",
        },
        {
          package_id: "pkg",
          tool_id: "echo",
          args: { message: "second" },
          request_id: "req-2",
        },
      ],
      concurrency: 2,
    };

    const response = await handleMultiUseTool(input, context as unknown as any);
    expect(response.isError).toBeFalsy();

    const payload = JSON.parse(response.content[0]?.text ?? "{}") as MultiToolCallOutput;
    expect(payload.results).toHaveLength(2);
    expect(payload.results.map((result) => result.request_id)).toEqual(["req-1", "req-2"]);
    expect(payload.results.every((result) => result.status === "ok")).toBe(true);
    expect(payload.results[0]).toMatchObject({
      request_id: "req-1",
      result: { outcome: "first" },
    });
    expect(payload.results[1]).toMatchObject({
      request_id: "req-2",
      result: { outcome: "second" },
    });

    expect(context.registry.getPackage).toHaveBeenCalledTimes(2);
    expect(context.registry.getClient).toHaveBeenCalledTimes(2);
    expect(context.callToolMock).toHaveBeenCalledTimes(2);
    expect(completionOrder).toEqual(["second", "first"]);
  });

  it("captures tool errors without failing the entire batch", async () => {
    const context = createContext(async () => {
      throw {
        code: 1234,
        message: "boom",
        data: { detail: true },
      };
    });

    const input: MultiToolCallInput = {
      requests: [
        {
          package_id: "pkg",
          tool_id: "failing-tool",
          args: { message: "ignored" },
          request_id: "err-1",
        },
      ],
    };

    const response = await handleMultiUseTool(input, context as unknown as any);
    expect(response.isError).toBeFalsy();

    const payload = JSON.parse(response.content[0]?.text ?? "{}") as MultiToolCallOutput;
    expect(payload.results).toHaveLength(1);
    const [result] = payload.results;
    expect(result.status).toBe("error");
    expect(result.request_id).toBe("err-1");
    expect(result.package_id).toBe("pkg");
    expect(result.tool_id).toBe("failing-tool");
    expect(result.error.code).toBe(ERROR_CODES.DOWNSTREAM_ERROR);
    expect(result.error.message).toContain("Tool execution failed");
    expect(result.error.data).toMatchObject({
      package_id: "pkg",
      tool_id: "failing-tool",
      original_error: "[object Object]",
    });
    expect(result.telemetry).toMatchObject({ status: "error" });
    expect(context.callToolMock).toHaveBeenCalledTimes(1);
  });

  it("marks remaining requests as timed out when batch deadline passes", async () => {
    const context = createContext(async (_toolId, args) => {
      if (args.message === "slow") {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return { outcome: args.message };
    });

    const input: MultiToolCallInput = {
      requests: [
        {
          package_id: "pkg",
          tool_id: "echo",
          args: { message: "slow" },
          request_id: "slow-1",
        },
        {
          package_id: "pkg",
          tool_id: "echo",
          args: { message: "skipped" },
          request_id: "slow-2",
        },
      ],
      concurrency: 1,
      timeout_ms: 1,
    };

    const response = await handleMultiUseTool(input, context as unknown as any);
    const payload = JSON.parse(response.content[0]?.text ?? "{}") as MultiToolCallOutput;

    expect(payload.results).toHaveLength(2);
    const [first, second] = payload.results;
    expect(first.status).toBe("ok");
    expect(first.result).toEqual({ outcome: "slow" });
    expect(second.status).toBe("error");
    expect(second.error.code).toBe(ERROR_CODES.DOWNSTREAM_ERROR);
    expect(second.error.message).toContain("Batch timeout");
    expect(second.telemetry.duration_ms).toBe(0);
    expect(context.callToolMock).toHaveBeenCalledTimes(1);
  });

  it("returns validation error when request arguments fail schema validation", async () => {
    const context = createContext(async () => ({}));
    context.validator.validate = vi.fn(() => {
      throw new ValidationError("Missing required message", [
        { instancePath: "/message", message: "is required" },
      ] as any);
    });

    const input: MultiToolCallInput = {
      requests: [
        {
          package_id: "pkg",
          tool_id: "echo",
          args: {},
          request_id: "invalid-1",
        },
      ],
    };

    const response = await handleMultiUseTool(input, context as unknown as any);
    const payload = JSON.parse(response.content[0]?.text ?? "{}") as MultiToolCallOutput;
    expect(payload.results).toHaveLength(1);
    const [result] = payload.results;
    expect(result.status).toBe("error");
    expect(result.error.code).toBe(ERROR_CODES.ARG_VALIDATION_FAILED);
    expect(result.error.message).toContain("Argument validation failed");
    expect(result.error.data).toMatchObject({
      package_id: "pkg",
      tool_id: "echo",
      provided_args: [],
    });
    expect(Array.isArray(result.error.data.errors)).toBe(true);
    expect(result.telemetry.status).toBe("error");
    expect(context.validator.validate).toHaveBeenCalledTimes(1);
  });

  it("propagates downstream timeout errors for individual requests", async () => {
    const context = createContext(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      throw new Error("operation timeout after 5s");
    });

    const input: MultiToolCallInput = {
      requests: [
        {
          package_id: "pkg",
          tool_id: "echo",
          args: { message: "slow" },
          request_id: "timeout-1",
        },
      ],
    };

    const response = await handleMultiUseTool(input, context as unknown as any);
    const payload = JSON.parse(response.content[0]?.text ?? "{}") as MultiToolCallOutput;
    const [result] = payload.results;
    expect(result.status).toBe("error");
    expect(result.error.code).toBe(ERROR_CODES.DOWNSTREAM_ERROR);
    expect(result.error.message).toMatch(/timed out/i);
    expect(result.error.data).toMatchObject({
      package_id: "pkg",
      tool_id: "echo",
      original_error: "operation timeout after 5s",
    });
    expect(result.telemetry.status).toBe("error");
    expect(context.callToolMock).toHaveBeenCalledTimes(1);
  });
});
