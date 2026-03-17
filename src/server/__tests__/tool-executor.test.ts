import { beforeEach, describe, expect, it } from "vitest";

import { configService } from "@/server/config/config-service";
import { toolExecutor } from "@/server/tools/tool-executor";
import type { ResolvedTool } from "@/server/tools/contracts";

function buildTool(overrides?: Partial<ResolvedTool>): ResolvedTool {
  return {
    toolId: "tool_local_echo",
    name: "Local Echo",
    description: "echo input",
    category: "automation",
    inputSchema: {},
    outputSchema: {},
    sourceType: "local_script",
    sourceConfig: {},
    authRequirements: { type: "none", required: false },
    policy: {},
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    effectiveEnabled: true,
    effectivePriority: 100,
    resolvedFrom: "platform_pool",
    effectiveConfig: {
      command: 'node -e "console.log(JSON.stringify({ ok: true, input: process.env.TOOL_INPUT }))"',
    },
    ...overrides,
  };
}

describe("tool executor", () => {
  beforeEach(() => {
    configService.resetForTests();
  });

  it("runs local script tool successfully", async () => {
    const result = await toolExecutor.execute(buildTool(), { q: "hello" }, { runId: "run_1", nodeId: "node_1" });
    expect(result.ok).toBe(true);
    expect(result.data).toBeTruthy();
  });

  it("returns auth error when credential is missing", async () => {
    const result = await toolExecutor.execute(
      buildTool({
        authRequirements: { type: "credential_ref", required: true },
      }),
      { q: "hello" },
      { runId: "run_1", nodeId: "node_1" },
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("TOOL_AUTH_MISSING");
  });
});
