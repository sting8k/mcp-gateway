// Standard MCP config format
export interface StandardMcpConfig {
  mcpServers: Record<string, StandardServerConfig>;
}

export interface StandardServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  disabled?: boolean;
  // Transport config:
  // - "stdio": Local command execution
  // - "sse": HTTP+SSE transport (deprecated in MCP spec 2025-03-26)
  // - "http": Streamable HTTP transport (recommended)
  type?: "stdio" | "sse" | "http";
  url?: string;
  headers?: Record<string, string>;
}

// Extended super-mcp config format (backward compatibility)
export interface SuperMcpConfig {
  mcpServers?: Record<string, StandardServerConfig | ExtendedServerConfig>;
  packages?: PackageConfig[]; // Legacy format support
}

export interface ExtendedServerConfig extends StandardServerConfig {
  // Extended properties for super-mcp
  name?: string;
  description?: string;
  visibility?: "default" | "hidden";
  auth?: AuthConfig;
  oauth?: boolean; // Enable OAuth for this server
}

export interface PackageConfig {
  id: string;
  name: string;
  description?: string;
  transport: "stdio" | "http";
  transportType?: "sse" | "http"; // For HTTP transport: HTTP+SSE (deprecated) or Streamable HTTP
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  base_url?: string;
  auth?: AuthConfig;
  extra_headers?: Record<string, string>;
  visibility: "default" | "hidden";
  oauth?: boolean; // Enable OAuth for this server
  disabled?: boolean;
}

export interface AuthConfig {
  mode: "oauth2";
  method: "device_code" | "authorization_code_pkce";
  scopes: string[];
  client_id: string;
}

export interface PackageInfo {
  package_id: string;
  name: string;
  description?: string;
  transport: "stdio" | "http";
  auth_mode: "env" | "oauth2" | "none";
  tool_count: number;
  health?: "ok" | "error" | "unavailable";
  summary: string;
  visibility: "default" | "hidden";
}

export interface ToolInfo {
  package_id: string;
  tool_id: string;
  name: string;
  summary?: string;
  args_skeleton?: any;
  schema_hash: string;
  schema?: any;
}

export interface ListToolPackagesInput {
  safe_only?: boolean;
  limit?: number;
  include_health?: boolean;
}

export interface ListToolPackagesOutput {
  packages: PackageInfo[];
  catalog_etag: string;
  updated_at: string;
}

export interface ListToolsInput {
  package_id: string;
  summarize?: boolean;
  include_schemas?: boolean;
  page_size?: number;
  page_token?: string | null;
}

export interface ListToolsOutput {
  tools: ToolInfo[];
  next_page_token?: string | null;
}

export interface UseToolInput {
  package_id: string;
  tool_id: string;
  args: any;
  dry_run?: boolean;
}

export interface UseToolOutput {
  package_id: string;
  tool_id: string;
  args_used: any;
  result: any;
  telemetry: {
    duration_ms: number;
    status: "ok" | "error";
  };
}

export interface MultiToolCallRequestItem extends UseToolInput {
  request_id?: string;
}

export interface MultiToolCallInput {
  requests: MultiToolCallRequestItem[];
  concurrency?: number;
  timeout_ms?: number;
}

export interface MultiToolCallSuccess extends UseToolOutput {
  request_id?: string;
  status: "ok";
}

export interface MultiToolCallError {
  request_id?: string;
  package_id: string;
  tool_id: string;
  status: "error";
  error: {
    code: number;
    message: string;
    data?: any;
  };
  telemetry: UseToolOutput["telemetry"];
}

export type MultiToolCallResult = MultiToolCallSuccess | MultiToolCallError;

export interface MultiToolCallOutput {
  results: MultiToolCallResult[];
}

export interface BeginAuthInput {
  package_id: string;
}

export interface BeginAuthOutput {
  method: "device_code";
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface AuthStatusInput {
  package_id: string;
}

export interface AuthStatusOutput {
  state: "pending" | "authorized" | "error";
  scopes?: string[];
  expires_at?: string;
}

export interface McpClient {
  connect(): Promise<void>;
  listTools(): Promise<any[]>;
  callTool(name: string, args: any): Promise<any>;
  close(): Promise<void>;
  healthCheck?(): Promise<"ok" | "error" | "needs_auth">;
  requiresAuth?(): Promise<boolean>;
  isAuthenticated?(): Promise<boolean>;
}

export interface AuthManager {
  beginAuth(packageId: string, config: AuthConfig): Promise<BeginAuthOutput>;
  getAuthStatus(packageId: string): Promise<AuthStatusOutput>;
  getAuthHeaders(packageId: string): Promise<Record<string, string>>;
}

export const ERROR_CODES = {
  INVALID_PARAMS: -32602,
  PACKAGE_NOT_FOUND: -32001,
  TOOL_NOT_FOUND: -32002,
  ARG_VALIDATION_FAILED: -32003,
  PACKAGE_UNAVAILABLE: -32004,
  AUTH_REQUIRED: -32005,
  AUTH_INCOMPLETE: -32006,
  DOWNSTREAM_ERROR: -32007,
  INTERNAL_ERROR: -32603,
} as const;