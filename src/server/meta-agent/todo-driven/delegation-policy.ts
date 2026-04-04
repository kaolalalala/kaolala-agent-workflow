import type { RunState, TodoCapabilityType, TodoItem } from "../supervisor-runtime-state";
import type { MemoryState } from "../memory-state";
import { selectRoutingMemories } from "../memory-state";
import type { DelegationDecision } from "./types";
import { getSubagentById } from "./subagent-registry";

const CAPABILITY_AGENT_MAP: Record<TodoCapabilityType, string> = {
  planning: "planner_agent",
  research: "research_agent",
  collection: "collector_agent",
  writing: "writer_agent",
  analysis: "analyst_agent",
  review: "reviewer_agent",
  verification: "verification_agent",
  merge: "merge_agent",
  browser_ops: "browser_operator_agent",
  terminal_ops: "terminal_operator_agent",
};

function hasInputContext(state: RunState, todo: TodoItem) {
  if (todo.input_refs.length > 0) {
    return true;
  }

  if (todo.depends_on.length === 0) {
    return true;
  }

  const dependencySet = new Set(todo.depends_on);
  const linkedArtifacts = state.artifacts.filter((artifact) => dependencySet.has(artifact.related_todo));
  return linkedArtifacts.length > 0;
}

function applyMemoryRoutingOverride(
  todo: TodoItem,
  memoryState: MemoryState | undefined,
): DelegationDecision | null {
  if (!memoryState) return null;
  const routingMemories = selectRoutingMemories(memoryState, todo, 2);
  const preferredRouting = routingMemories.find((item) => item.confidence >= 0.55);
  if (!preferredRouting) return null;

  if (preferredRouting.preferred_mode === "split") {
    return {
      mode: "split",
      reason: `Project routing memory suggests splitting this ${todo.capability_type} todo first.`,
    };
  }
  if (preferredRouting.preferred_mode === "self") {
    return {
      mode: "self",
      reason: `Project routing memory keeps this ${todo.capability_type} todo under supervisor control.`,
    };
  }

  return {
    mode: "delegate",
    target_agent_id:
      preferredRouting.preferred_agent_id && getSubagentById(preferredRouting.preferred_agent_id)
        ? preferredRouting.preferred_agent_id
        : CAPABILITY_AGENT_MAP[todo.capability_type],
    reason: preferredRouting.preferred_agent_id
      ? `Project routing memory prefers ${preferredRouting.preferred_agent_id} for ${todo.capability_type} tasks.`
      : `Project routing memory escalates this ${todo.capability_type} todo to a specialist agent.`,
  };
}

export function decideTodoExecutionMode(
  state: RunState,
  todo: TodoItem,
  memoryState?: MemoryState,
): DelegationDecision {
  if (todo.forced_target_agent_id) {
    return {
      mode: "delegate",
      target_agent_id: todo.forced_target_agent_id,
      reason: `Recovery reroute constraint enforces delegation to ${todo.forced_target_agent_id}.`,
    };
  }

  if (todo.capability_type === "planning" || todo.capability_type === "review") {
    return {
      mode: "self",
      reason: "Planning/review todos keep supervisor ownership unless explicitly routed by memory.",
    };
  }

  if (todo.capability_type === "writing" && !hasInputContext(state, todo)) {
    return {
      mode: "split",
      reason: "Writing todo lacks material context; split into collection + writing.",
    };
  }

  const memoryOverride = applyMemoryRoutingOverride(todo, memoryState);
  if (memoryOverride) {
    return memoryOverride;
  }

  if (todo.capability_type === "analysis") {
    return {
      mode: "self",
      reason: "Analysis / synthesis todo stays under supervisor control by default.",
    };
  }

  const targetAgent = CAPABILITY_AGENT_MAP[todo.capability_type];
  return {
    mode: "delegate",
    target_agent_id: targetAgent,
    reason: `Delegate ${todo.capability_type} task to ${targetAgent}.`,
  };
}
