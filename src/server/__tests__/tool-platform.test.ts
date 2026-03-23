import { beforeEach, describe, expect, it } from "vitest";

import { configService } from "@/server/config/config-service";
import { toolResolver } from "@/server/tools/tool-resolver";
import { toolService } from "@/server/tools/tool-service";

describe("tool platform v1", () => {
  beforeEach(() => {
    configService.resetForTests();
  });

  it("creates tool definition and reads it back", () => {
    const tool = toolService.createTool({
      toolId: "tool_http_weather",
      name: "Weather API",
      description: "Query weather",
      category: "integration",
      sourceType: "http_api",
      inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
      outputSchema: { type: "object", properties: { temp: { type: "number" } } },
      sourceConfig: { url: "https://example.com/weather" },
      authRequirements: { type: "credential_ref", required: true, fields: ["credentialId"] },
      policy: { timeoutMs: 8000, maxRetries: 1, retryBackoffMs: 500 },
      enabled: true,
    });

    expect(tool.toolId).toBe("tool_http_weather");
    expect(toolService.listTools().length).toBe(1);
    expect(toolService.getTool("tool_http_weather")?.sourceType).toBe("http_api");
  });

  it("supports three-layer bindings and node-level override", () => {
    toolService.createTool({
      toolId: "tool_search",
      name: "Search",
      category: "search",
      sourceType: "http_api",
      sourceConfig: { endpoint: "https://example.com/search" },
      inputSchema: {},
      outputSchema: {},
      authRequirements: { type: "none", required: false },
      enabled: true,
    });

    toolService.upsertBinding({
      scopeType: "agent_role",
      scopeId: "worker",
      toolId: "tool_search",
      enabled: true,
      priority: 200,
      overrideConfig: { topK: 5 },
    });

    toolService.upsertBinding({
      scopeType: "node_instance",
      scopeId: "run_1:node_1",
      toolId: "tool_search",
      enabled: false,
      priority: 300,
      overrideConfig: { topK: 3 },
    });

    const resolved = toolResolver.resolveForNode("run_1", "node_1", "worker");
    expect(resolved.all.length).toBe(1);
    expect(resolved.all[0].resolvedFrom).toBe("node_override");
    expect(resolved.all[0].effectiveEnabled).toBe(false);
    expect(resolved.enabled.length).toBe(0);
  });

  it("imports OpenClaw payload and writes source type", () => {
    const result = toolService.importOpenClawTools({
      tools: [
        {
          id: "tool_openclaw_calc",
          name: "OpenClaw Calculator",
          category: "analysis",
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
          sourceConfig: { manifestVersion: "1.0" },
        },
      ],
    });

    expect(result.imported.length).toBe(1);
    expect(result.imported[0].sourceType).toBe("openclaw");
  });

  it("bootstraps built-in tools and default role bindings", () => {
    toolService.ensurePlatformBootstrap();

    const tools = toolService.listTools();
    const toolIds = new Set(tools.map((item) => item.toolId));
    expect(toolIds.has("tool_agent_os_latest_search")).toBe(true);
    expect(toolIds.has("tool_save_local_report")).toBe(true);
    expect(toolIds.has("tool_get_current_time")).toBe(true);
    expect(toolIds.has("tool_text_stats")).toBe(true);
    expect(toolIds.has("tool_json_extract")).toBe(true);

    const workerBindings = toolService.listBindings("agent_role", "worker");
    expect(workerBindings.some((item) => item.toolId === "tool_agent_os_latest_search" && item.enabled)).toBe(true);
    expect(workerBindings.some((item) => item.toolId === "tool_save_local_report" && item.enabled)).toBe(true);
  });

  it("installs plugin manifest and can disable plugin tools", () => {
    const installed = toolService.installPlugin({
      pluginId: "plugin_demo_pack",
      name: "Demo Pack",
      version: "0.1.0",
      description: "Demo plugin",
      tools: [
        {
          toolId: "tool_demo_echo",
          name: "Demo Echo",
          category: "automation",
          sourceType: "local_script",
          sourceConfig: { command: "node -e \"console.log('{}')\"" },
        },
      ],
      defaultBindings: [
        {
          scopeType: "agent_role",
          scopeId: "worker",
          toolId: "tool_demo_echo",
          enabled: true,
          priority: 99,
        },
      ],
    });

    expect(installed.plugin?.pluginId).toBe("plugin_demo_pack");
    expect(installed.imported.some((item) => item.toolId === "tool_demo_echo")).toBe(true);

    const plugin = toolService.setPluginEnabled("plugin_demo_pack", false);
    expect(plugin?.enabled).toBe(false);
    expect(toolService.getTool("tool_demo_echo")?.enabled).toBe(false);
  });

  it("defaults planner tools to disabled via resolver policy", () => {
    toolService.ensurePlatformBootstrap();
    configService.ensureWorkspaceConfig();
    configService.ensureNodeConfig({
      runId: "run_1",
      nodeId: "node_planner",
      nodeRole: "planner",
      name: "Planner",
      allowHumanInput: true,
    });

    const resolved = toolResolver.resolveForNode("run_1", "node_planner", "planner");
    expect(resolved.toolPolicy).toBe("disabled");
    expect(resolved.enabled.length).toBe(0);
  });
});
