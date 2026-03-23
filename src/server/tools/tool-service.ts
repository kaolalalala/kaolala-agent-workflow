import { db } from "@/server/persistence/sqlite";
import { makeId, nowIso } from "@/lib/utils";
import {
  ToolBinding,
  ToolDefinition,
  ToolPackageManifest,
  ToolPlugin,
  ToolPluginManifest,
  ToolScopeType,
} from "@/server/tools/contracts";

interface ToolDefinitionRow {
  id: string;
  plugin_id: string | null;
  name: string;
  description: string | null;
  category: ToolDefinition["category"];
  input_schema: string;
  output_schema: string;
  source_type: ToolDefinition["sourceType"];
  source_config_json: string;
  auth_requirements_json: string;
  default_timeout_ms: number | null;
  default_max_retries: number | null;
  default_retry_backoff_ms: number | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

interface ToolPluginRow {
  id: string;
  name: string;
  version: string;
  description: string | null;
  manifest_json: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

interface ToolBindingRow {
  id: string;
  scope_type: ToolScopeType;
  scope_id: string;
  tool_id: string;
  enabled: number;
  priority: number;
  override_config_json: string | null;
  created_at: string;
  updated_at: string;
}

const DEFAULT_TOOL_DEFINITIONS: Array<{
  toolId: string;
  pluginId?: string;
  name: string;
  description: string;
  category: ToolDefinition["category"];
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  sourceType: ToolDefinition["sourceType"];
  sourceConfig: Record<string, unknown>;
  authRequirements: ToolDefinition["authRequirements"];
  policy: ToolDefinition["policy"];
  enabled: boolean;
}> = [
  {
    pluginId: "plugin_core_basics",
    toolId: "tool_agent_os_latest_search",
    name: "Agent OS Latest Search",
    description: "Search latest Agent OS news and papers from Google News RSS and arXiv.",
    category: "search",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query, for example agent os" },
        maxNews: { type: "integer", minimum: 1, maximum: 20, default: 8 },
        maxPapers: { type: "integer", minimum: 1, maximum: 20, default: 6 },
      },
      required: ["query"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        generatedAt: { type: "string" },
        news: { type: "array" },
        papers: { type: "array" },
        markdown: { type: "string" },
      },
    },
    sourceType: "local_script",
    sourceConfig: {
      command: "node ./scripts/tools/search-agent-os-latest.mjs",
    },
    authRequirements: { type: "none", required: false },
    policy: { timeoutMs: 25000, maxRetries: 1, retryBackoffMs: 500 },
    enabled: true,
  },
  {
    pluginId: "plugin_core_basics",
    toolId: "tool_save_local_report",
    name: "Save Local Report",
    description: "Save markdown report to a local directory.",
    category: "automation",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute file path for the report" },
        content: { type: "string", description: "Report markdown content" },
      },
      required: ["content"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        ok: { type: "boolean" },
        path: { type: "string" },
        bytes: { type: "number" },
      },
    },
    sourceType: "local_script",
    sourceConfig: {
      command: "node ./scripts/tools/save-local-report.mjs",
    },
    authRequirements: { type: "none", required: false },
    policy: { timeoutMs: 10000, maxRetries: 0, retryBackoffMs: 200 },
    enabled: true,
  },
  {
    pluginId: "plugin_core_basics",
    toolId: "tool_get_current_time",
    name: "Get Current Time",
    description: "Return current time in ISO/local formats.",
    category: "automation",
    inputSchema: { type: "object", additionalProperties: false },
    outputSchema: {
      type: "object",
      properties: { iso: { type: "string" }, local: { type: "string" }, timezone: { type: "string" } },
    },
    sourceType: "local_script",
    sourceConfig: {
      command: "node ./scripts/tools/get-current-time.mjs",
    },
    authRequirements: { type: "none", required: false },
    policy: { timeoutMs: 5000, maxRetries: 0, retryBackoffMs: 200 },
    enabled: true,
  },
  {
    pluginId: "plugin_core_basics",
    toolId: "tool_text_stats",
    name: "Text Stats",
    description: "Analyze text basic metrics: chars/words/lines.",
    category: "analysis",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
      },
      required: ["text"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        characters: { type: "number" },
        words: { type: "number" },
        lines: { type: "number" },
        preview: { type: "string" },
      },
    },
    sourceType: "local_script",
    sourceConfig: {
      command: "node ./scripts/tools/text-stats.mjs",
    },
    authRequirements: { type: "none", required: false },
    policy: { timeoutMs: 5000, maxRetries: 0, retryBackoffMs: 200 },
    enabled: true,
  },
  {
    pluginId: "plugin_core_basics",
    toolId: "tool_json_extract",
    name: "JSON Extract",
    description: "Extract fields from JSON by dot-path array.",
    category: "analysis",
    inputSchema: {
      type: "object",
      properties: {
        json: { type: "string" },
        paths: { type: "array", items: { type: "string" } },
      },
      required: ["json", "paths"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        values: { type: "object" },
      },
    },
    sourceType: "local_script",
    sourceConfig: {
      command: "node ./scripts/tools/json-extract.mjs",
    },
    authRequirements: { type: "none", required: false },
    policy: { timeoutMs: 8000, maxRetries: 0, retryBackoffMs: 200 },
    enabled: true,
  },
  {
    pluginId: "plugin_core_basics",
    toolId: "tool_http_get_json",
    name: "HTTP GET JSON",
    description: "Fetch JSON from an HTTP endpoint using GET.",
    category: "integration",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string" },
      },
      additionalProperties: true,
    },
    outputSchema: {
      type: "object",
      properties: {
        status: { type: "number" },
      },
    },
    sourceType: "http_api",
    sourceConfig: {
      url: "https://httpbin.org/get",
      method: "GET",
    },
    authRequirements: { type: "none", required: false },
    policy: { timeoutMs: 12000, maxRetries: 1, retryBackoffMs: 300 },
    enabled: true,
  },
];

const DEFAULT_ROLE_BINDINGS: Array<{
  scopeType: ToolScopeType;
  scopeId: string;
  toolId: string;
  enabled: boolean;
  priority: number;
}> = [
  { scopeType: "agent_role", scopeId: "worker", toolId: "tool_agent_os_latest_search", enabled: true, priority: 220 },
  { scopeType: "agent_role", scopeId: "worker", toolId: "tool_save_local_report", enabled: true, priority: 180 },
  { scopeType: "agent_role", scopeId: "worker", toolId: "tool_text_stats", enabled: true, priority: 150 },
  { scopeType: "agent_role", scopeId: "worker", toolId: "tool_json_extract", enabled: true, priority: 140 },
  { scopeType: "agent_role", scopeId: "worker", toolId: "tool_get_current_time", enabled: true, priority: 130 },
  { scopeType: "agent_role", scopeId: "research", toolId: "tool_agent_os_latest_search", enabled: true, priority: 240 },
  { scopeType: "agent_role", scopeId: "research", toolId: "tool_save_local_report", enabled: true, priority: 180 },
  { scopeType: "agent_role", scopeId: "research", toolId: "tool_http_get_json", enabled: true, priority: 170 },
  { scopeType: "agent_role", scopeId: "research", toolId: "tool_get_current_time", enabled: true, priority: 120 },
  { scopeType: "agent_role", scopeId: "summarizer", toolId: "tool_save_local_report", enabled: true, priority: 240 },
  { scopeType: "agent_role", scopeId: "summarizer", toolId: "tool_text_stats", enabled: true, priority: 150 },
];

function parseJsonField(value: string, field: string) {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    throw new Error(`${field} is not valid JSON`);
  }
}

function normalizeAuthRequirement(value: Record<string, unknown>): ToolDefinition["authRequirements"] {
  const type = value.type;
  if (type !== "none" && type !== "credential_ref" && type !== "api_key" && type !== "oauth2" && type !== "custom") {
    return { type: "none", required: false };
  }
  return {
    type,
    required: Boolean(value.required),
    fields: Array.isArray(value.fields) ? value.fields.filter((item): item is string => typeof item === "string") : undefined,
    description: typeof value.description === "string" ? value.description : undefined,
  };
}

function toToolDefinition(row: ToolDefinitionRow): ToolDefinition {
  return {
    toolId: row.id,
    pluginId: row.plugin_id ?? undefined,
    name: row.name,
    description: row.description ?? undefined,
    category: row.category,
    inputSchema: parseJsonField(row.input_schema, "input_schema"),
    outputSchema: parseJsonField(row.output_schema, "output_schema"),
    sourceType: row.source_type,
    sourceConfig: parseJsonField(row.source_config_json, "source_config_json"),
    authRequirements: normalizeAuthRequirement(parseJsonField(row.auth_requirements_json, "auth_requirements_json")),
    policy: {
      timeoutMs: row.default_timeout_ms ?? undefined,
      maxRetries: row.default_max_retries ?? undefined,
      retryBackoffMs: row.default_retry_backoff_ms ?? undefined,
    },
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toToolPlugin(row: ToolPluginRow): ToolPlugin {
  return {
    pluginId: row.id,
    name: row.name,
    version: row.version,
    description: row.description ?? undefined,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toToolBinding(row: ToolBindingRow): ToolBinding {
  return {
    id: row.id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    toolId: row.tool_id,
    enabled: row.enabled === 1,
    priority: row.priority,
    overrideConfig: row.override_config_json ? parseJsonField(row.override_config_json, "override_config_json") : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function ensureToolExists(toolId: string) {
  const found = db.prepare("SELECT id FROM tool_definition WHERE id = ?").get(toolId) as { id: string } | undefined;
  if (!found) {
    throw new Error("工具不存在");
  }
}

function ensurePluginExists(pluginId: string) {
  const found = db.prepare("SELECT id FROM tool_plugin WHERE id = ?").get(pluginId) as { id: string } | undefined;
  if (!found) {
    throw new Error(`插件不存在: ${pluginId}`);
  }
}

function normalizePluginManifest(input: ToolPluginManifest): ToolPluginManifest {
  const pluginId = input.pluginId.trim();
  const name = input.name.trim();
  const version = input.version.trim();
  if (!pluginId || !name || !version) {
    throw new Error("pluginId/name/version 不能为空");
  }
  if (!Array.isArray(input.tools) || input.tools.length === 0) {
    throw new Error("插件 tools 不能为空");
  }
  return {
    ...input,
    pluginId,
    name,
    version,
    description: input.description?.trim() || undefined,
    tools: input.tools.map((item) => ({
      ...item,
      toolId: item.toolId?.trim() || undefined,
      name: item.name.trim(),
      description: item.description?.trim() || undefined,
      sourceConfig: item.sourceConfig ?? {},
      inputSchema: item.inputSchema ?? {},
      outputSchema: item.outputSchema ?? {},
      authRequirements: item.authRequirements ?? { type: "none", required: false },
      enabled: item.enabled ?? true,
    })),
    defaultBindings: input.defaultBindings?.map((binding) => ({
      ...binding,
      scopeId: binding.scopeId.trim(),
      toolId: binding.toolId.trim(),
      enabled: binding.enabled ?? true,
      priority: binding.priority ?? 100,
    })),
  };
}

function normalizeToolPackage(input: ToolPackageManifest): ToolPackageManifest {
  if (!Array.isArray(input.tools) || input.tools.length === 0) {
    throw new Error("tools cannot be empty");
  }

  return {
    packageName: input.packageName?.trim() || "imported-package",
    version: input.version?.trim() || "1.0.0",
    tools: input.tools.map((item) => ({
      toolId: item.toolId?.trim(),
      name: item.name?.trim() || "",
      description: item.description?.trim(),
      category: item.category ?? "integration",
      sourceType: item.sourceType ?? "http_api",
      sourceConfig: item.sourceConfig ?? {},
      inputSchema: item.inputSchema ?? {},
      outputSchema: item.outputSchema ?? {},
      authRequirements: item.authRequirements ?? { type: "none", required: false },
      policy: item.policy ?? {},
      enabled: item.enabled ?? true,
    })),
  };
}

function buildPlaceholderInput(schema: Record<string, unknown>) {
  const properties =
    schema && typeof schema === "object" && schema.properties && typeof schema.properties === "object"
      ? (schema.properties as Record<string, { type?: string }>)
      : {};
  const required =
    schema && typeof schema === "object" && Array.isArray(schema.required)
      ? (schema.required as string[])
      : [];

  const input: Record<string, unknown> = {};
  for (const field of required) {
    const type = properties[field]?.type;
    if (type === "number" || type === "integer") {
      input[field] = 1;
    } else if (type === "boolean") {
      input[field] = true;
    } else if (type === "array") {
      input[field] = [];
    } else if (type === "object") {
      input[field] = {};
    } else {
      input[field] = "sample";
    }
  }
  return input;
}

function ensureDefaultToolingData() {
  const now = nowIso();
  const corePluginId = "plugin_core_basics";
  const corePluginExists = db.prepare("SELECT id FROM tool_plugin WHERE id = ?").get(corePluginId) as { id: string } | undefined;
  if (!corePluginExists) {
    db.prepare(
      `INSERT INTO tool_plugin (id, name, version, description, manifest_json, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      corePluginId,
      "Core Basics",
      "1.0.0",
      "Built-in foundational tools for multi-agent workflows.",
      JSON.stringify({
        pluginId: corePluginId,
        name: "Core Basics",
        version: "1.0.0",
        description: "Built-in foundational tools for multi-agent workflows.",
        tools: DEFAULT_TOOL_DEFINITIONS.map((item) => ({
          toolId: item.toolId,
          name: item.name,
        })),
      }),
      1,
      now,
      now,
    );
  }

  for (const item of DEFAULT_TOOL_DEFINITIONS) {
    const exists = db.prepare("SELECT id FROM tool_definition WHERE id = ?").get(item.toolId) as { id: string } | undefined;
    if (exists) {
      continue;
    }

    db.prepare(
      `INSERT INTO tool_definition (
        id, plugin_id, name, description, category, input_schema, output_schema, source_type, source_config_json,
        auth_requirements_json, default_timeout_ms, default_max_retries, default_retry_backoff_ms,
        enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      item.toolId,
      item.pluginId ?? null,
      item.name,
      item.description,
      item.category,
      JSON.stringify(item.inputSchema),
      JSON.stringify(item.outputSchema),
      item.sourceType,
      JSON.stringify(item.sourceConfig),
      JSON.stringify(item.authRequirements),
      item.policy.timeoutMs ?? null,
      item.policy.maxRetries ?? null,
      item.policy.retryBackoffMs ?? null,
      item.enabled ? 1 : 0,
      now,
      now,
    );
  }

  for (const binding of DEFAULT_ROLE_BINDINGS) {
    const exists = db
      .prepare("SELECT id FROM tool_binding WHERE scope_type = ? AND scope_id = ? AND tool_id = ?")
      .get(binding.scopeType, binding.scopeId, binding.toolId) as { id: string } | undefined;
    if (exists) {
      continue;
    }

    db.prepare(
      `INSERT INTO tool_binding (
        id, scope_type, scope_id, tool_id, enabled, priority, override_config_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      makeId("tool_bind"),
      binding.scopeType,
      binding.scopeId,
      binding.toolId,
      binding.enabled ? 1 : 0,
      binding.priority,
      null,
      now,
      now,
    );
  }
}

export const toolService = {
  ensurePlatformBootstrap() {
    ensureDefaultToolingData();
  },

  listPlugins() {
    const rows = db.prepare("SELECT * FROM tool_plugin ORDER BY created_at DESC").all() as ToolPluginRow[];
    return rows.map(toToolPlugin);
  },

  getPlugin(pluginId: string) {
    const row = db.prepare("SELECT * FROM tool_plugin WHERE id = ?").get(pluginId) as ToolPluginRow | undefined;
    return row ? toToolPlugin(row) : null;
  },

  installPlugin(manifestInput: ToolPluginManifest) {
    const manifest = normalizePluginManifest(manifestInput);
    const now = nowIso();
    const existing = db.prepare("SELECT * FROM tool_plugin WHERE id = ?").get(manifest.pluginId) as ToolPluginRow | undefined;

    if (!existing) {
      db.prepare(
        `INSERT INTO tool_plugin (id, name, version, description, manifest_json, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        manifest.pluginId,
        manifest.name,
        manifest.version,
        manifest.description ?? null,
        JSON.stringify(manifest),
        1,
        now,
        now,
      );
    } else {
      db.prepare(
        `UPDATE tool_plugin
         SET name = ?, version = ?, description = ?, manifest_json = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        manifest.name,
        manifest.version,
        manifest.description ?? null,
        JSON.stringify(manifest),
        now,
        manifest.pluginId,
      );
    }

    const imported: ToolDefinition[] = [];
    for (const item of manifest.tools) {
      if (item.toolId) {
        const existingTool = this.getTool(item.toolId);
        if (existingTool) {
          imported.push(
            this.updateTool(item.toolId, {
              pluginId: manifest.pluginId,
              name: item.name,
              description: item.description,
              category: item.category,
              inputSchema: item.inputSchema ?? {},
              outputSchema: item.outputSchema ?? {},
              sourceType: item.sourceType,
              sourceConfig: item.sourceConfig ?? {},
              authRequirements: item.authRequirements,
              policy: item.policy ?? {},
              enabled: item.enabled ?? true,
            }),
          );
          continue;
        }
      }

      imported.push(
        this.createTool({
          toolId: item.toolId,
          pluginId: manifest.pluginId,
          name: item.name,
          description: item.description,
          category: item.category,
          inputSchema: item.inputSchema ?? {},
          outputSchema: item.outputSchema ?? {},
          sourceType: item.sourceType,
          sourceConfig: item.sourceConfig ?? {},
          authRequirements: item.authRequirements,
          policy: item.policy,
          enabled: item.enabled ?? true,
        }),
      );
    }

    for (const binding of manifest.defaultBindings ?? []) {
      this.upsertBinding({
        scopeType: binding.scopeType,
        scopeId: binding.scopeId,
        toolId: binding.toolId,
        enabled: binding.enabled,
        priority: binding.priority,
        overrideConfig: binding.overrideConfig,
      });
    }

    return {
      plugin: this.getPlugin(manifest.pluginId),
      imported,
    };
  },

  setPluginEnabled(pluginId: string, enabled: boolean) {
    ensurePluginExists(pluginId);
    db.prepare("UPDATE tool_plugin SET enabled = ?, updated_at = ? WHERE id = ?").run(enabled ? 1 : 0, nowIso(), pluginId);
    db.prepare("UPDATE tool_definition SET enabled = ?, updated_at = ? WHERE plugin_id = ?").run(enabled ? 1 : 0, nowIso(), pluginId);
    return this.getPlugin(pluginId);
  },

  listTools() {
    const rows = db.prepare("SELECT * FROM tool_definition ORDER BY created_at DESC").all() as ToolDefinitionRow[];
    return rows.map(toToolDefinition);
  },

  getTool(toolId: string) {
    const row = db.prepare("SELECT * FROM tool_definition WHERE id = ?").get(toolId) as ToolDefinitionRow | undefined;
    return row ? toToolDefinition(row) : null;
  },

  createTool(payload: {
    toolId?: string;
    pluginId?: string;
    name?: string;
    description?: string;
    category?: ToolDefinition["category"];
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    sourceType?: ToolDefinition["sourceType"];
    sourceConfig?: Record<string, unknown>;
    authRequirements?: ToolDefinition["authRequirements"];
    policy?: ToolDefinition["policy"];
    enabled?: boolean;
  }) {
    if (!payload.name?.trim()) {
      throw new Error("name 不能为空");
    }
    if (!payload.category) {
      throw new Error("category 不能为空");
    }
    if (!payload.sourceType) {
      throw new Error("sourceType 不能为空");
    }

    const now = nowIso();
    const toolId = payload.toolId?.trim() || makeId("tool");
    if (payload.pluginId?.trim()) {
      ensurePluginExists(payload.pluginId.trim());
    }
    const tool: ToolDefinition = {
      toolId,
      pluginId: payload.pluginId?.trim() || undefined,
      name: payload.name.trim(),
      description: payload.description?.trim() || undefined,
      category: payload.category,
      inputSchema: payload.inputSchema ?? {},
      outputSchema: payload.outputSchema ?? {},
      sourceType: payload.sourceType,
      sourceConfig: payload.sourceConfig ?? {},
      authRequirements: payload.authRequirements ?? { type: "none", required: false },
      policy: payload.policy ?? {},
      enabled: payload.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    };

    db.prepare(
      `INSERT INTO tool_definition (
        id, plugin_id, name, description, category, input_schema, output_schema, source_type, source_config_json,
        auth_requirements_json, default_timeout_ms, default_max_retries, default_retry_backoff_ms,
        enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      tool.toolId,
      tool.pluginId ?? null,
      tool.name,
      tool.description ?? null,
      tool.category,
      JSON.stringify(tool.inputSchema),
      JSON.stringify(tool.outputSchema),
      tool.sourceType,
      JSON.stringify(tool.sourceConfig),
      JSON.stringify(tool.authRequirements),
      tool.policy.timeoutMs ?? null,
      tool.policy.maxRetries ?? null,
      tool.policy.retryBackoffMs ?? null,
      tool.enabled ? 1 : 0,
      tool.createdAt,
      tool.updatedAt,
    );

    return tool;
  },

  updateTool(toolId: string, payload: Partial<ToolDefinition>) {
    const current = this.getTool(toolId);
    if (!current) {
      throw new Error("工具不存在");
    }
    if (payload.pluginId?.trim()) {
      ensurePluginExists(payload.pluginId.trim());
    }

    const next: ToolDefinition = {
      ...current,
      ...payload,
      toolId,
      pluginId: payload.pluginId ?? current.pluginId,
      updatedAt: nowIso(),
    };

    db.prepare(
      `UPDATE tool_definition SET
        plugin_id = ?,
        name = ?,
        description = ?,
        category = ?,
        input_schema = ?,
        output_schema = ?,
        source_type = ?,
        source_config_json = ?,
        auth_requirements_json = ?,
        default_timeout_ms = ?,
        default_max_retries = ?,
        default_retry_backoff_ms = ?,
        enabled = ?,
        updated_at = ?
      WHERE id = ?`,
    ).run(
      next.pluginId ?? null,
      next.name,
      next.description ?? null,
      next.category,
      JSON.stringify(next.inputSchema),
      JSON.stringify(next.outputSchema),
      next.sourceType,
      JSON.stringify(next.sourceConfig),
      JSON.stringify(next.authRequirements),
      next.policy.timeoutMs ?? null,
      next.policy.maxRetries ?? null,
      next.policy.retryBackoffMs ?? null,
      next.enabled ? 1 : 0,
      next.updatedAt,
      toolId,
    );

    return next;
  },

  disableTool(toolId: string) {
    return this.updateTool(toolId, { enabled: false });
  },

  deleteTool(toolId: string) {
    const current = this.getTool(toolId);
    if (!current) {
      throw new Error("工具不存在");
    }
    db.prepare("DELETE FROM tool_binding WHERE tool_id = ?").run(toolId);
    db.prepare("DELETE FROM tool_definition WHERE id = ?").run(toolId);
    return { toolId };
  },

  listBindings(scopeType?: ToolScopeType, scopeId?: string) {
    if (scopeType && !scopeId) {
      throw new Error("scopeId 不能为空");
    }

    if (!scopeType) {
      const rows = db.prepare("SELECT * FROM tool_binding ORDER BY updated_at DESC").all() as ToolBindingRow[];
      return rows.map(toToolBinding);
    }

    const rows = db
      .prepare("SELECT * FROM tool_binding WHERE scope_type = ? AND scope_id = ? ORDER BY priority DESC, updated_at DESC")
      .all(scopeType, scopeId) as ToolBindingRow[];
    return rows.map(toToolBinding);
  },

  upsertBinding(payload: {
    scopeType?: ToolScopeType;
    scopeId?: string;
    toolId?: string;
    enabled?: boolean;
    priority?: number;
    overrideConfig?: Record<string, unknown>;
  }) {
    if (!payload.scopeType || !payload.scopeId?.trim() || !payload.toolId?.trim()) {
      throw new Error("scopeType、scopeId、toolId 不能为空");
    }

    ensureToolExists(payload.toolId);

    const now = nowIso();
    const scopeId = payload.scopeId.trim();
    const toolId = payload.toolId.trim();
    const existing = db
      .prepare("SELECT * FROM tool_binding WHERE scope_type = ? AND scope_id = ? AND tool_id = ?")
      .get(payload.scopeType, scopeId, toolId) as ToolBindingRow | undefined;

    if (!existing) {
      const binding: ToolBinding = {
        id: makeId("tool_bind"),
        scopeType: payload.scopeType,
        scopeId,
        toolId,
        enabled: payload.enabled ?? true,
        priority: payload.priority ?? 100,
        overrideConfig: payload.overrideConfig,
        createdAt: now,
        updatedAt: now,
      };

      db.prepare(
        `INSERT INTO tool_binding (
          id, scope_type, scope_id, tool_id, enabled, priority, override_config_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        binding.id,
        binding.scopeType,
        binding.scopeId,
        binding.toolId,
        binding.enabled ? 1 : 0,
        binding.priority,
        binding.overrideConfig ? JSON.stringify(binding.overrideConfig) : null,
        binding.createdAt,
        binding.updatedAt,
      );
      return binding;
    }

    const updated: ToolBinding = {
      ...toToolBinding(existing),
      enabled: payload.enabled ?? (existing.enabled === 1),
      priority: payload.priority ?? existing.priority,
      overrideConfig:
        payload.overrideConfig ??
        (existing.override_config_json ? parseJsonField(existing.override_config_json, "override_config_json") : undefined),
      updatedAt: now,
    };

    db.prepare(
      `UPDATE tool_binding SET
        enabled = ?,
        priority = ?,
        override_config_json = ?,
        updated_at = ?
      WHERE id = ?`,
    ).run(
      updated.enabled ? 1 : 0,
      updated.priority,
      updated.overrideConfig ? JSON.stringify(updated.overrideConfig) : null,
      updated.updatedAt,
      updated.id,
    );

    return updated;
  },

  replaceBindings(
    scopeType: ToolScopeType,
    scopeId: string,
    bindings: Array<{
      toolId: string;
      enabled?: boolean;
      priority?: number;
      overrideConfig?: Record<string, unknown>;
    }>,
  ) {
    if (!scopeId.trim()) {
      throw new Error("scopeId 不能为空");
    }

    const now = nowIso();
    db.prepare("DELETE FROM tool_binding WHERE scope_type = ? AND scope_id = ?").run(scopeType, scopeId);

    const result: ToolBinding[] = [];
    for (const item of bindings) {
      const created = this.upsertBinding({
        scopeType,
        scopeId,
        toolId: item.toolId,
        enabled: item.enabled ?? true,
        priority: item.priority ?? 100,
        overrideConfig: item.overrideConfig,
      });
      result.push({ ...created, updatedAt: now });
    }

    return result;
  },

  importOpenClawTools(payload: {
    tools?: Array<{
      id?: string;
      name?: string;
      description?: string;
      category?: ToolDefinition["category"];
      inputSchema?: Record<string, unknown>;
      outputSchema?: Record<string, unknown>;
      sourceConfig?: Record<string, unknown>;
      authRequirements?: Partial<ToolDefinition["authRequirements"]>;
      policy?: ToolDefinition["policy"];
      enabled?: boolean;
    }>;
  }) {
    const tools = payload.tools ?? [];
    if (tools.length === 0) {
      throw new Error("导入内容不能为空");
    }

    const imported: ToolDefinition[] = [];
    for (const item of tools) {
      const existing = item.id ? this.getTool(item.id) : null;
      if (existing && item.id) {
        imported.push(
          this.updateTool(item.id, {
            name: item.name?.trim() || existing.name,
            description: item.description?.trim() || existing.description,
            category: item.category ?? existing.category,
            inputSchema: item.inputSchema ?? existing.inputSchema,
            outputSchema: item.outputSchema ?? existing.outputSchema,
            sourceType: "openclaw",
            sourceConfig: item.sourceConfig ?? existing.sourceConfig,
            authRequirements: item.authRequirements?.type
              ? {
                  type: item.authRequirements.type,
                  required: item.authRequirements.required ?? false,
                  fields: item.authRequirements.fields,
                  description: item.authRequirements.description,
                }
              : existing.authRequirements,
            policy: item.policy ?? existing.policy,
            enabled: item.enabled ?? existing.enabled,
          }),
        );
        continue;
      }

      imported.push(
        this.createTool({
          toolId: item.id,
          name: item.name,
          description: item.description,
          category: item.category ?? "integration",
          inputSchema: item.inputSchema ?? {},
          outputSchema: item.outputSchema ?? {},
          sourceType: "openclaw",
          sourceConfig: item.sourceConfig ?? {},
          authRequirements: item.authRequirements?.type
            ? {
                type: item.authRequirements.type,
                required: item.authRequirements.required ?? false,
                fields: item.authRequirements.fields,
                description: item.authRequirements.description,
              }
            : { type: "none", required: false },
          policy: item.policy,
          enabled: item.enabled ?? true,
        }),
      );
    }

    return { imported };
  },

  importToolPackage(payload: ToolPackageManifest) {
    const normalized = normalizeToolPackage(payload);
    const imported: ToolDefinition[] = [];
    const generatedTestCases: Array<{
      toolId: string;
      name: string;
      input: Record<string, unknown>;
      expected: { ok: boolean };
    }> = [];
    const generatedNodeRegistrations: Array<{
      toolId: string;
      nodeType: string;
      displayName: string;
      category: string;
      defaults: Record<string, unknown>;
    }> = [];

    for (const item of normalized.tools) {
      if (!item.name) {
        throw new Error("tool.name is required");
      }

      const existing = item.toolId ? this.getTool(item.toolId) : null;
      const nextSourceConfig = {
        ...(item.sourceConfig ?? {}),
        __importMeta: {
          packageName: normalized.packageName,
          packageVersion: normalized.version,
        },
      };

      const authRequirement = item.authRequirements?.type
        ? {
            type: item.authRequirements.type,
            required: item.authRequirements.required ?? false,
            fields: item.authRequirements.fields,
            description: item.authRequirements.description,
          }
        : { type: "none" as const, required: false };

      const tool = existing && item.toolId
        ? this.updateTool(item.toolId, {
            name: item.name,
            description: item.description,
            category: item.category,
            sourceType: item.sourceType,
            sourceConfig: nextSourceConfig,
            inputSchema: item.inputSchema,
            outputSchema: item.outputSchema,
            authRequirements: authRequirement,
            policy: item.policy,
            enabled: item.enabled,
          })
        : this.createTool({
            toolId: item.toolId,
            name: item.name,
            description: item.description,
            category: item.category,
            sourceType: item.sourceType,
            sourceConfig: nextSourceConfig,
            inputSchema: item.inputSchema,
            outputSchema: item.outputSchema,
            authRequirements: authRequirement,
            policy: item.policy,
            enabled: item.enabled,
          });

      imported.push(tool);
      generatedTestCases.push({
        toolId: tool.toolId,
        name: `${tool.name} smoke test`,
        input: buildPlaceholderInput(tool.inputSchema),
        expected: { ok: true },
      });
      generatedNodeRegistrations.push({
        toolId: tool.toolId,
        nodeType: `tool.${tool.toolId}`,
        displayName: tool.name,
        category: tool.category,
        defaults: {
          toolId: tool.toolId,
          toolPolicy: "allowed",
        },
      });
    }

    return {
      imported,
      generatedTestCases,
      generatedNodeRegistrations,
    };
  },

  validateToolDefinition(tool: ToolDefinition) {
    const errors: string[] = [];
    if (!tool.name.trim()) {
      errors.push("name is required");
    }
    if (typeof tool.inputSchema !== "object") {
      errors.push("inputSchema must be an object");
    }
    if (typeof tool.outputSchema !== "object") {
      errors.push("outputSchema must be an object");
    }
    if (tool.sourceType === "http_api") {
      const url = String(tool.sourceConfig.url ?? "");
      if (!url) {
        errors.push("http_api requires sourceConfig.url");
      }
    }
    if (tool.sourceType === "local_script") {
      const command = String(tool.sourceConfig.command ?? "");
      if (!command) {
        errors.push("local_script requires sourceConfig.command");
      }
    }
    if (tool.sourceType === "openclaw") {
      const endpoint = String(tool.sourceConfig.endpoint ?? "");
      if (!endpoint) {
        errors.push("openclaw requires sourceConfig.endpoint");
      }
    }

    if (tool.authRequirements.required) {
      if (tool.authRequirements.type === "credential_ref" || tool.authRequirements.type === "api_key") {
        const credentialId = String(tool.sourceConfig.credentialId ?? "");
        if (!credentialId) {
          errors.push("credentialId is required for this auth type");
        }
      }
    }

    return {
      ok: errors.length === 0,
      errors,
    };
  },
};
