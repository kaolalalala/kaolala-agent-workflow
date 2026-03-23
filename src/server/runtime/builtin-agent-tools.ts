/**
 * Built-in Agent Tools — special tools intercepted by the runtime engine.
 *
 * These tools are injected into agent nodes' available tools and handled
 * directly by the runtime (not by toolExecutor). The LLM sees them as
 * regular tools and can call them like any other tool.
 *
 * Tools:
 * - transfer_to_agent: Handoff current task to a more suitable agent (Swarm pattern)
 * - spawn_subtask: Create a sub-task for another agent, optionally wait for result
 */

import type { ResolvedTool } from "@/server/tools/contracts";

// ──────────────────────────────────────────────────────────
// Tool IDs (used for interception in invokeTool)
// ──────────────────────────────────────────────────────────

export const BUILTIN_TOOL_TRANSFER = "__builtin_transfer_to_agent";
export const BUILTIN_TOOL_SUBTASK = "__builtin_spawn_subtask";

export function isBuiltinTool(toolId: string): boolean {
  return toolId === BUILTIN_TOOL_TRANSFER || toolId === BUILTIN_TOOL_SUBTASK;
}

// ──────────────────────────────────────────────────────────
// Tool definitions (injected into availableTools)
// ──────────────────────────────────────────────────────────

export function getBuiltinAgentTools(availableAgentsDescription: string): ResolvedTool[] {
  return [
    {
      toolId: BUILTIN_TOOL_TRANSFER,
      name: "transfer_to_agent",
      description:
        "将当前任务转交给另一个更合适的 Agent 处理。当你发现当前任务超出你的能力范围，" +
        "或者有另一个 Agent 更适合处理时，使用此工具。转交后你的执行将暂停，" +
        "目标 Agent 的执行结果将作为你的输出返回。\n\n" +
        "可用的 Agent:\n" + availableAgentsDescription,
      category: "automation",
      inputSchema: {
        type: "object",
        properties: {
          target_agent_name: {
            type: "string",
            description: "目标 Agent 的名称（从可用 Agent 列表中选择），或描述你需要的能力（系统会自动匹配）",
          },
          reason: {
            type: "string",
            description: "转交原因 — 为什么这个任务应该由目标 Agent 处理",
          },
          context: {
            type: "string",
            description: "需要传递给目标 Agent 的上下文信息和已有进展",
          },
        },
        required: ["target_agent_name", "reason"],
      },
      outputSchema: { type: "object" },
      sourceType: "local_script",
      sourceConfig: {},
      authRequirements: { type: "none", required: false },
      policy: { timeoutMs: 300_000 },
      enabled: true,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
      effectiveEnabled: true,
      effectivePriority: 100,
      resolvedFrom: "platform_pool",
      effectiveConfig: {},
    },
    {
      toolId: BUILTIN_TOOL_SUBTASK,
      name: "spawn_subtask",
      description:
        "创建一个子任务交给另一个 Agent 执行，你保持控制权并等待结果。" +
        "适用于需要其他 Agent 协助完成某个子步骤的场景。" +
        "与 transfer_to_agent 不同：transfer 是完全移交控制权，spawn_subtask 是委托子任务后继续你的工作。\n\n" +
        "可用的 Agent:\n" + availableAgentsDescription,
      category: "automation",
      inputSchema: {
        type: "object",
        properties: {
          target_agent_name: {
            type: "string",
            description: "执行子任务的 Agent 名称，或描述你需要的能力",
          },
          task_description: {
            type: "string",
            description: "子任务的详细描述 — 要明确告诉目标 Agent 需要做什么、返回什么",
          },
          context: {
            type: "string",
            description: "传递给子任务 Agent 的背景上下文",
          },
        },
        required: ["target_agent_name", "task_description"],
      },
      outputSchema: { type: "object" },
      sourceType: "local_script",
      sourceConfig: {},
      authRequirements: { type: "none", required: false },
      policy: { timeoutMs: 300_000 },
      enabled: true,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
      effectiveEnabled: true,
      effectivePriority: 100,
      resolvedFrom: "platform_pool",
      effectiveConfig: {},
    },
  ];
}
