/**
 * JSON schemas for multi_use_tool input and output
 */

export const MultiToolParallelInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["requests"],
  properties: {
    requests: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["package_id", "tool_id"],
        properties: {
          request_id: {
            type: "string",
            description: "Client-supplied identifier to correlate responses",
          },
          package_id: {
            type: "string",
            description: "Package ID to execute",
          },
          tool_id: {
            type: "string",
            description: "Tool ID within the package",
          },
          args: {
            description: "Tool arguments (defaults to empty object)",
            default: {},
            oneOf: [
              { type: "object" },
              { type: "array", items: {} },
              { type: "string" },
              { type: "number" },
              { type: "boolean" },
              { type: "null" }
            ],
          },
          dry_run: {
            type: "boolean",
            description: "Validate arguments without execution",
            default: false,
          },
        },
      },
    },
    concurrency: {
      type: "integer",
      minimum: 1,
      description: "Maximum number of requests to execute simultaneously",
    },
    timeout_ms: {
      type: "integer",
      minimum: 0,
      description: "Overall timeout for the batch (milliseconds)",
    },
  },
  examples: [
    {
      requests: [
        {
          package_id: "filesystem",
          tool_id: "fast_read_file",
          args: { path: "/tmp/example.txt" },
        },
        {
          package_id: "filesystem",
          tool_id: "fast_list_directory",
          args: { path: "/tmp" },
        },
      ],
    },
  ],
} as const;

export const MultiToolParallelOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["results"],
  properties: {
    results: {
      type: "array",
      minItems: 1,
      items: {
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["status", "package_id", "tool_id", "args_used", "result", "telemetry"],
            properties: {
              status: { const: "ok" },
              request_id: { type: "string" },
              package_id: { type: "string" },
              tool_id: { type: "string" },
              args_used: {
                oneOf: [
                  { type: "object" },
                  { type: "array", items: {} },
                  { type: "string" },
                  { type: "number" },
                  { type: "boolean" },
                  { type: "null" }
                ],
              },
              result: {
                oneOf: [
                  { type: "object" },
                  { type: "array", items: {} },
                  { type: "string" },
                  { type: "number" },
                  { type: "boolean" },
                  { type: "null" }
                ],
              },
              telemetry: {
                type: "object",
                additionalProperties: false,
                required: ["duration_ms", "status"],
                properties: {
                  duration_ms: { type: "number" },
                  status: { enum: ["ok", "error"] },
                },
              },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["status", "package_id", "tool_id", "error", "telemetry"],
            properties: {
              status: { const: "error" },
              request_id: { type: "string" },
              package_id: { type: "string" },
              tool_id: { type: "string" },
              error: {
                type: "object",
                additionalProperties: true,
                required: ["code", "message"],
                properties: {
                  code: { type: "number" },
                  message: { type: "string" },
                  data: {
                    oneOf: [
                      { type: "object" },
                      { type: "array", items: {} },
                      { type: "string" },
                      { type: "number" },
                      { type: "boolean" },
                      { type: "null" }
                    ],
                  },
                },
              },
              telemetry: {
                type: "object",
                additionalProperties: false,
                required: ["duration_ms", "status"],
                properties: {
                  duration_ms: { type: "number" },
                  status: { enum: ["ok", "error"] },
                },
              },
            },
          }
        ],
      },
    },
  },
  examples: [
    {
      results: [
        {
          status: "ok",
          package_id: "filesystem",
          tool_id: "fast_read_file",
          args_used: { path: "/tmp/example.txt" },
          result: { content: "hello" },
          telemetry: { duration_ms: 12, status: "ok" },
        },
        {
          status: "error",
          package_id: "filesystem",
          tool_id: "fast_list_directory",
          error: { code: -32007, message: "Request timed out" },
          telemetry: { duration_ms: 1000, status: "error" },
        },
      ],
    },
  ],
} as const;
