import { configService } from "@/server/config/config-service";
import { AgentNodeToolPolicy } from "@/server/domain";
import { ToolBinding, ResolvedTool } from "@/server/tools/contracts";
import { toolService } from "@/server/tools/tool-service";

function nodeScopeId(runId: string, nodeId: string) {
  return `${runId}:${nodeId}`;
}

function sortBindings(bindings: ToolBinding[]) {
  return bindings.slice().sort((a, b) => b.priority - a.priority || b.updatedAt.localeCompare(a.updatedAt));
}

function defaultToolPolicyForRole(role: string): AgentNodeToolPolicy {
  if (role === "planner" || role === "input" || role === "output") {
    return "disabled";
  }
  return "allowed";
}

export const toolResolver = {
  resolveForNode(runId: string, nodeId: string, role: string) {
    const tools = toolService.listTools();
    const roleBindings = sortBindings(toolService.listBindings("agent_role", role));
    const nodeBindings = sortBindings(toolService.listBindings("node_instance", nodeScopeId(runId, nodeId)));
    const nodeConfig = configService.getNodeConfig(runId, nodeId);
    const toolPolicy = nodeConfig?.toolPolicy ?? defaultToolPolicyForRole(role);

    const toolMap = new Map<string, ResolvedTool>();

    for (const tool of tools) {
      toolMap.set(tool.toolId, {
        ...tool,
        effectiveEnabled: tool.enabled,
        effectivePriority: 0,
        resolvedFrom: "platform_pool",
        effectiveConfig: { ...tool.sourceConfig },
      });
    }

    const applyBindings = (bindings: ToolBinding[], source: ResolvedTool["resolvedFrom"]) => {
      for (const binding of bindings) {
        const tool = toolMap.get(binding.toolId);
        if (!tool) {
          continue;
        }
        toolMap.set(binding.toolId, {
          ...tool,
          effectiveEnabled: binding.enabled,
          effectivePriority: binding.priority,
          resolvedFrom: source,
          effectiveConfig: {
            ...tool.effectiveConfig,
            ...(binding.overrideConfig ?? {}),
          },
        });
      }
    };

    applyBindings(roleBindings, "agent_default");
    applyBindings(nodeBindings, "node_override");

    const all = Array.from(toolMap.values());
    const enabled = toolPolicy === "disabled"
      ? []
      : all.filter((tool) => tool.effectiveEnabled);

    return {
      all,
      enabled,
      toolPolicy,
    };
  },

  makeNodeScopeId: nodeScopeId,
};
