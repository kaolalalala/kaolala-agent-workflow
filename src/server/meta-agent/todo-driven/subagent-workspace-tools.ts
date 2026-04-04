import type { SubagentAutonomyLevel, WorkspaceFileKind } from "../supervisor-runtime-state";
import type { LLMToolDefinition } from "../llm-helper";

export const workspaceReadTool: LLMToolDefinition = {
  toolId: "workspace_read",
  name: "workspace_read",
  description: "Read an authorized workspace file by file_id for additional execution context.",
  inputSchema: {
    type: "object",
    properties: {
      file_id: { type: "string", description: "Authorized workspace file id." },
      max_chars: { type: "number", description: "Optional max characters to read back." },
    },
    required: ["file_id"],
  },
};

export const workspaceWriteTool: LLMToolDefinition = {
  toolId: "workspace_write",
  name: "workspace_write",
  description: "Write intermediate findings into the workspace for later reuse.",
  inputSchema: {
    type: "object",
    properties: {
      filename: { type: "string", description: "Output filename." },
      content: { type: "string", description: "Content to save." },
      kind: {
        type: "string",
        enum: [
          "research_notes",
          "intermediate_summary",
          "raw_tool_result",
          "analysis_output",
          "verification_report",
          "merge_bundle",
        ] satisfies WorkspaceFileKind[],
      },
    },
    required: ["filename", "content"],
  },
};

export const thinkAndPlanTool: LLMToolDefinition = {
  toolId: "think_and_plan",
  name: "think_and_plan",
  description: "Write a short internal mini-plan before executing a complex subtask.",
  inputSchema: {
    type: "object",
    properties: {
      steps: {
        type: "array",
        items: { type: "string" },
        minItems: 2,
        maxItems: 4,
      },
    },
    required: ["steps"],
  },
};

export const delegateSubtaskTool: LLMToolDefinition = {
  toolId: "delegate_subtask",
  name: "delegate_subtask",
  description: "Delegate a focused child subtask to another specialist subagent.",
  inputSchema: {
    type: "object",
    properties: {
      task_description: { type: "string" },
      preferred_capability: {
        type: "string",
        enum: [
          "research",
          "collection",
          "writing",
          "analysis",
          "review",
          "verification",
          "merge",
          "browser_ops",
          "terminal_ops",
        ],
      },
    },
    required: ["task_description", "preferred_capability"],
  },
};

export function getAutonomyMaxRounds(level: SubagentAutonomyLevel) {
  if (level === "full") return 20;
  if (level === "enhanced") return 12;
  return 6;
}

export function injectAutonomyTools(
  level: SubagentAutonomyLevel,
  nestingDepth = 0,
) {
  if (level === "basic") return [] as LLMToolDefinition[];
  if (level === "enhanced") {
    return [workspaceReadTool, workspaceWriteTool, thinkAndPlanTool];
  }
  return nestingDepth >= 1
    ? [workspaceReadTool, workspaceWriteTool, thinkAndPlanTool]
    : [workspaceReadTool, workspaceWriteTool, thinkAndPlanTool, delegateSubtaskTool];
}
