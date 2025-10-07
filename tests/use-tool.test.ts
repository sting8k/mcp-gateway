import { describe, it, expect, vi } from "vitest";
import { handleUseTool } from "../src/handlers/index.js";
import { ERROR_CODES } from "../src/types.js";
import { ValidationError } from "../src/validator.js";

const baseSchema = {
  type: "object",
  properties: {
    message: { type: "string" },
  },
  required: ["message"],
};

type CallImpl = (args: any) => Promise<any>;

type UseToolContext = {
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

function createContext(options?: { schema?: any; callImpl?: CallImpl }): UseToolContext {
  const schema = options?.schema ?? baseSchema;
  const callImplementation: CallImpl = options?.callImpl ?? (async () => ({ ok: true }));

  const callToolMock = vi.fn(callImplementation);
  const registry = {
    getPackage: vi.fn(() => ({ id: "pkg", disabled: false })),
    getClient: vi.fn(async () => ({ callTool: callToolMock })),
  };

  const catalog = {
    getToolSchema: vi.fn(async () => schema),
  };

  const validator = {
    validate: vi.fn(() => {}),
  };

  return { registry, catalog, validator, callToolMock };
}

describe("handleUseTool", () => {
  it("rejects with validation error when arguments are invalid", async () => {
    const context = createContext();
    context.validator.validate = vi.fn(() => {
      throw new ValidationError("Missing required message", [
        { instancePath: "/message", message: "is required" },
      ] as any);
    });

    await expect(
      handleUseTool(
        {
          package_id: "pkg",
          tool_id: "echo",
          args: {},
        },
        context.registry as unknown as any,
        context.catalog as unknown as any,
        context.validator as unknown as any
      )
    ).rejects.toMatchObject({
      code: ERROR_CODES.ARG_VALIDATION_FAILED,
      message: expect.stringContaining("Argument validation failed"),
      data: {
        package_id: "pkg",
        tool_id: "echo",
        provided_args: [],
      },
    });

    expect(context.validator.validate).toHaveBeenCalledTimes(1);
    expect(context.callToolMock).not.toHaveBeenCalled();
  });

  it("rejects with timeout diagnostics when downstream tool times out", async () => {
    const context = createContext({
      callImpl: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        throw new Error("operation timeout after 5s");
      },
    });

    await handleUseTool(
      {
        package_id: "pkg",
        tool_id: "echo",
        args: { message: "slow" },
      },
      context.registry as unknown as any,
      context.catalog as unknown as any,
      context.validator as unknown as any
    ).then(
      () => {
        throw new Error("Expected call to reject");
      },
      (error) => {
        expect(error.code).toBe(ERROR_CODES.DOWNSTREAM_ERROR);
        expect(error.message).toMatch(/timed out/i);
        expect(error.data).toMatchObject({
          package_id: "pkg",
          tool_id: "echo",
          original_error: "operation timeout after 5s",
        });
      }
    );

    expect(context.registry.getClient).toHaveBeenCalledTimes(1);
    expect(context.callToolMock).toHaveBeenCalledTimes(1);
  });
});
