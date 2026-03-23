export type ToolSourceType = "local_script" | "http_api" | "openclaw";

export type ToolCategory =
  | "search"
  | "retrieval"
  | "automation"
  | "analysis"
  | "integration"
  | "custom";

export type ToolScopeType = "agent_role" | "node_instance";

export interface ToolAuthRequirement {
  type: "none" | "credential_ref" | "api_key" | "oauth2" | "custom";
  required: boolean;
  fields?: string[];
  description?: string;
}

export interface ToolPolicy {
  timeoutMs?: number;
  maxRetries?: number;
  retryBackoffMs?: number;
}

export interface ToolDefinition {
  toolId: string;
  pluginId?: string;
  name: string;
  description?: string;
  category: ToolCategory;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  sourceType: ToolSourceType;
  sourceConfig: Record<string, unknown>;
  authRequirements: ToolAuthRequirement;
  policy: ToolPolicy;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ToolPluginManifest {
  pluginId: string;
  name: string;
  version: string;
  description?: string;
  tools: Array<{
    toolId?: string;
    name: string;
    description?: string;
    category: ToolCategory;
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    sourceType: ToolSourceType;
    sourceConfig?: Record<string, unknown>;
    authRequirements?: ToolAuthRequirement;
    policy?: ToolPolicy;
    enabled?: boolean;
  }>;
  defaultBindings?: Array<{
    scopeType: ToolScopeType;
    scopeId: string;
    toolId: string;
    enabled?: boolean;
    priority?: number;
    overrideConfig?: Record<string, unknown>;
  }>;
}

export interface ToolPlugin {
  pluginId: string;
  name: string;
  version: string;
  description?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ToolBinding {
  id: string;
  scopeType: ToolScopeType;
  scopeId: string;
  toolId: string;
  enabled: boolean;
  priority: number;
  overrideConfig?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ResolvedTool extends ToolDefinition {
  effectiveEnabled: boolean;
  effectivePriority: number;
  resolvedFrom: "platform_pool" | "agent_default" | "node_override";
  effectiveConfig: Record<string, unknown>;
}

export interface ToolExecutionError {
  code: string;
  message: string;
  retriable: boolean;
  source: ToolSourceType | "platform";
  details?: Record<string, unknown>;
}

export interface ToolExecutionResult {
  ok: boolean;
  data?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  durationMs: number;
  error?: ToolExecutionError;
}

export interface ToolPackageManifest {
  packageName?: string;
  version?: string;
  tools: Array<{
    toolId?: string;
    name: string;
    description?: string;
    category?: ToolCategory;
    sourceType?: ToolSourceType;
    sourceConfig?: Record<string, unknown>;
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    authRequirements?: Partial<ToolAuthRequirement>;
    policy?: ToolPolicy;
    enabled?: boolean;
  }>;
}
