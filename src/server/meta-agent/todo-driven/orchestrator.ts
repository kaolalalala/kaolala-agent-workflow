import { nowIso } from "@/lib/utils";
import { addExecutionLog, addIssue, createRunState, type RunState } from "../supervisor-runtime-state";
import { callLLMWithUsage } from "../llm-helper";
import { sanitizeModelText } from "../text-cleaner";
import type { MemoryState } from "../memory-state";
import type { MetaAgentGoal, MetaAgentResult, MetaAgentStep } from "../types";
import { singleLlmTodoExecutor } from "./executor";
import { runTodoDrivenStep } from "./loop";
import { type TodoPlannerLlmInvoker } from "./planner";
import { applyReplanDecision, checkReplanTrigger, evaluateReplan } from "./replanner";
import { applyRunTerminalDecision, determineRunTerminalState } from "./terminal-state";
import { readWorkspaceFileContent } from "./workspace-files";
import type { ParallelWaveOptions, RecoveryPolicyOptions, SubagentRunner, TodoPlanningContext } from "./types";

export interface TodoDrivenProgressEvent {
  step: number;
  phase: "bootstrapping" | "step_running" | "idle" | "blocked" | "completed" | "failed" | "max_steps";
  state: RunState;
  stepRecord?: MetaAgentStep;
  iteration?: MetaAgentStep;
}

export interface TodoDrivenOrchestratorOptions {
  sessionId?: string;
  initialState?: RunState;
  planningContext?: TodoPlanningContext;
  memoryState?: MemoryState;
  stepExecutor?: typeof singleLlmTodoExecutor;
  planningInvokeLlm?: TodoPlannerLlmInvoker;
  replanInvokeLlm?: (messages: Array<{ role: "system" | "user" | "assistant"; content: string }>) => Promise<{
    content: string;
    usage: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
      source: "provider" | "estimated";
    };
  }>;
  subagentRunner?: SubagentRunner;
  parallel?: ParallelWaveOptions;
  recoveryPolicy?: RecoveryPolicyOptions;
  reviewFailRetryBudget?: number;
  planningMaxAttempts?: number;
  maxSteps?: number;
  idleStepLimit?: number;
  onProgress?: (event: TodoDrivenProgressEvent) => void;
  /**
   * Human-in-the-Loop hook forwarded to runTodoDrivenStep.
   * Called after the initial plan is generated; execution pauses until
   * the returned Promise resolves (user confirms or timeout fires).
   */
  onPlanReady?: (todos: import("../supervisor-runtime-state").TodoItem[]) => Promise<string>;
}

export interface TodoDrivenOrchestratorOutput {
  result: MetaAgentResult;
  state: RunState;
}

function countDoneTodos(state: RunState) {
  return state.todos.filter((todo) => todo.status === "done").length;
}

function estimateScore(state: RunState) {
  if (state.todos.length === 0) return 0;
  return countDoneTodos(state) / state.todos.length;
}

/**
 * Collect all completed todo outputs (artifact summaries + notes) for synthesis.
 */
function collectTodoOutputs(state: RunState): string[] {
  const completed = state.todos.filter((todo) => todo.status === "done");
  const outputs: string[] = [];

  for (const todo of completed) {
    const parts: string[] = [`[${todo.id}] ${todo.title}`];

    // Gather artifact summaries linked to this todo
    const linkedArtifacts = state.artifacts.filter(
      (a) => a.related_todo === todo.id || a.id === todo.output_ref,
    );
    for (const artifact of linkedArtifacts) {
      if (artifact.summary) {
        parts.push(`  Artifact (${artifact.type}): ${artifact.summary}`);
      }
    }

    // Gather relevant notes (skip internal planner/recovery metadata)
    const meaningfulNotes = (todo.notes ?? []).filter(
      (n) =>
        !n.startsWith("planner_") &&
        !n.startsWith("recovery_") &&
        !n.startsWith("split_") &&
        !n.startsWith("wave_") &&
        !n.startsWith("supervisor_"),
    );
    if (meaningfulNotes.length > 0) {
      parts.push(`  Notes: ${meaningfulNotes.join("; ")}`);
    }

    outputs.push(parts.join("\n"));
  }

  return outputs;
}

function readLatestFinalDeliveryOutput(state: RunState) {
  const genericPreferred = [...state.artifacts]
    .reverse()
    .find((artifact) => artifact.type === "final_output" || artifact.type === "report" || artifact.type === "manifest");
  if (genericPreferred?.workspace_file_id) {
    return readWorkspaceFileContent(state, genericPreferred.workspace_file_id, 40000);
  }
  return genericPreferred?.inline_preview ?? genericPreferred?.summary ?? null;
}

/**
 * Use LLM to synthesize a comprehensive final output from all completed todo results.
 * Falls back to simple concatenation if LLM fails.
 */
async function buildFinalOutput(state: RunState): Promise<{ text: string | undefined; tokenUsage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number; source: string } }> {
  const todoOutputs = collectTodoOutputs(state);
  if (todoOutputs.length === 0) return { text: undefined };

  const explicitFinalOutput = readLatestFinalDeliveryOutput(state);
  if (explicitFinalOutput) {
    return { text: sanitizeModelText(explicitFinalOutput) };
  }

  // If only one todo completed with a single artifact, no need for LLM synthesis
  if (todoOutputs.length === 1) {
    const completed = state.todos.filter((todo) => todo.status === "done");
    const lastCompleted = completed[0];
    const artifact = state.artifacts.find((item) => item.id === lastCompleted?.output_ref);
    const lastNote = lastCompleted && lastCompleted.notes.length > 0
      ? lastCompleted.notes[lastCompleted.notes.length - 1]
      : undefined;
    const text = sanitizeModelText(artifact?.summary ?? lastNote ?? "");
    return { text: text || undefined };
  }

  try {
    const prompt = [
      "You are a synthesis agent. Your job is to produce a comprehensive final output by analyzing ALL completed task results below.",
      "",
      `Original goal: ${state.goal}`,
      "",
      "== COMPLETED TASK RESULTS ==",
      ...todoOutputs.map((output, i) => `\n--- Task ${i + 1} ---\n${output}`),
      "",
      "== INSTRUCTIONS ==",
      "1. Analyze ALL task results above — do not ignore any task output.",
      "2. Synthesize a coherent, well-structured final answer that addresses the original goal.",
      "3. Preserve key findings, data points, and evidence from each task.",
      "4. Resolve any contradictions or overlaps between task outputs.",
      "5. Organize the output logically (not by task order, but by topic/relevance).",
      "6. Be comprehensive but concise — include all important information without unnecessary repetition.",
      "",
      "Produce the final synthesized output directly. Do NOT wrap in JSON or add meta-commentary.",
    ].join("\n");

    const llmResult = await callLLMWithUsage([
      { role: "system", content: "You are an expert synthesis agent that produces comprehensive, well-organized final outputs from multiple task results." },
      { role: "user", content: prompt },
    ]);

    return {
      text: sanitizeModelText(llmResult.content),
      tokenUsage: {
        prompt_tokens: llmResult.usage.prompt_tokens,
        completion_tokens: llmResult.usage.completion_tokens,
        total_tokens: llmResult.usage.total_tokens,
        source: llmResult.usage.source,
      },
    };
  } catch (error) {
    throw new Error(
      `Final synthesis failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function buildIteration(
  step: number,
  startedAt: string,
  state: RunState,
  selectedTodoId: string | null,
  reviewStatus?: string,
  reviewReason?: string,
): MetaAgentStep {
  const selectedTodo = selectedTodoId
    ? state.todos.find((todo) => todo.id === selectedTodoId)
    : undefined;

  const score =
    reviewStatus === "pass" ? 1
      : reviewStatus === "revise" ? 0.6
        : reviewStatus === "split" ? 0.45
          : reviewStatus === "fail" ? 0.2
            : estimateScore(state);

  return {
    step,
    iteration: step,
    phase: "todo",
    runStatus: state.status,
    runTotalTokens: Number(state.metadata.llm_total_tokens ?? 0),
    observationSummary: selectedTodo
      ? `todo=${selectedTodo.id} capability=${selectedTodo.capability_type} status=${selectedTodo.status}`
      : "No selected todo in this step.",
    reflectionScore: score,
    reflectionVerdict:
      reviewStatus === "pass" ? "pass"
        : reviewStatus === "fail" ? "fail"
          : reviewStatus === "split" ? "warn"
            : reviewStatus === "revise" ? "warn"
              : "warn",
    reflectionFeedback: reviewReason,
    adaptations: reviewStatus === "split" ? [`split:${reviewReason ?? "todo split"}`] : undefined,
    startedAt,
    finishedAt: nowIso(),
  };
}

async function buildMetaResult(
  status: MetaAgentResult["status"],
  input: MetaAgentGoal,
  state: RunState,
  steps: MetaAgentStep[],
  startedAtMs: number,
): Promise<MetaAgentResult> {
  const synthesis = await buildFinalOutput(state);

  // Track synthesis token usage
  if (synthesis.tokenUsage) {
    const prev = {
      prompt: Number(state.metadata.llm_prompt_tokens_total ?? 0),
      completion: Number(state.metadata.llm_completion_tokens_total ?? 0),
      total: Number(state.metadata.llm_total_tokens ?? 0),
      calls: Number(state.metadata.llm_call_count ?? 0),
    };
    state.metadata.llm_prompt_tokens_total = prev.prompt + synthesis.tokenUsage.prompt_tokens;
    state.metadata.llm_completion_tokens_total = prev.completion + synthesis.tokenUsage.completion_tokens;
    state.metadata.llm_total_tokens = prev.total + synthesis.tokenUsage.total_tokens;
    state.metadata.llm_call_count = prev.calls + 1;

    addExecutionLog(state, {
      timestamp: nowIso(),
      todo_id: "orchestrator",
      actor: "synthesis_agent",
      action: "final_synthesis",
      message: JSON.stringify({
        todo_count: state.todos.filter((t) => t.status === "done").length,
        tokens: synthesis.tokenUsage.total_tokens,
      }),
    });
  }

  const totalTokensUsed = Number(state.metadata.llm_total_tokens ?? 0);
  return {
    status,
    goal: input.goal,
    finalOutput: synthesis.text,
    finalScore: estimateScore(state),
    steps,
    iterations: steps,
    totalDurationMs: Date.now() - startedAtMs,
    totalTokensUsed,
    workflowEvolution: steps
      .filter((it) => Array.isArray(it.adaptations) && it.adaptations.length > 0)
      .map((it) => ({
        iteration: it.step,
        adaptations: it.adaptations ?? [],
      })),
  };
}

/**
 * Todo-Driven Orchestrator:
 * single authoritative control loop for next-step decisions and completion.
 */
export async function runTodoDrivenOrchestrator(
  input: MetaAgentGoal,
  options: TodoDrivenOrchestratorOptions = {},
): Promise<TodoDrivenOrchestratorOutput> {
  const startedAtMs = Date.now();
  const state = options.initialState ?? createRunState(input.goal);
  const maxSteps = Math.max(
    1,
    options.maxSteps ?? input.maxStepLimit ?? Math.max(12, (input.maxPlanningRounds ?? input.maxIterations ?? 3) * 4),
  );
  const idleStepLimit = Math.max(1, options.idleStepLimit ?? 2);
  const steps: MetaAgentStep[] = [];
  let idleCount = 0;

  options.onProgress?.({
    step: 0,
    phase: "bootstrapping",
    state,
  });

  for (let step = 1; step <= maxSteps; step++) {
    const startedAt = nowIso();

    let stepResult: Awaited<ReturnType<typeof runTodoDrivenStep>>;
    try {
      stepResult = await runTodoDrivenStep(state, options.stepExecutor ?? singleLlmTodoExecutor, {
        planningContext: options.planningContext,
        memoryState: options.memoryState,
        planningInvokeLlm: options.planningInvokeLlm,
        replanInvokeLlm: options.replanInvokeLlm,
        planningMaxAttempts: options.planningMaxAttempts,
        currentStep: step,
        maxSteps,
        subagentRunner: options.subagentRunner,
        parallel: options.parallel,
        recoveryPolicy: options.recoveryPolicy,
        reviewFailRetryBudget: options.reviewFailRetryBudget,
        allowInternalReplan: true,
        onPlanReady: options.onPlanReady,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addIssue(state, {
        todo_id: "orchestrator",
        type: "critical_orchestrator_step_error",
        message,
        status: "open",
      });
      addExecutionLog(state, {
        timestamp: nowIso(),
        todo_id: "orchestrator",
        actor: "orchestrator",
        action: "step_exception",
        message: JSON.stringify({ step, error: message }),
      });
      stepResult = {
        state,
        selected_todo_id: null,
        review: {
          status: "fail",
          reason: message,
          missing_criteria: [],
        },
        executor_result: {
          status: "error",
          output: "",
          error_message: message,
        },
      };
    }

    if (stepResult.selected_todo_id === null && !stepResult.wave_id && !(stepResult.selected_todo_ids?.length)) {
      idleCount += 1;
    } else {
      idleCount = 0;
    }

    // Replan is handled inside runTodoDrivenStep when allowInternalReplan=true.
    // The orchestrator passes allowInternalReplan via the step options below, so we
    // do NOT duplicate the trigger+evaluate+apply cycle here — doing so would run
    // replan twice per step and mis-attribute the token usage.

    const terminalDecision = determineRunTerminalState(state, {
      step,
      maxSteps,
      idleCount,
      idleStepLimit,
      maxStepsReached: false,
    });
    state.status = terminalDecision.runStatus;

    const iteration = buildIteration(
      step,
      startedAt,
      state,
      stepResult.selected_todo_id,
      stepResult.review?.status,
      stepResult.review?.reason,
    );
    iteration.runStatus = terminalDecision.runStatus;
    steps.push(iteration);

    if (terminalDecision.shouldTerminate) {
      applyRunTerminalDecision(state, terminalDecision, {
        step,
        maxSteps,
        idleCount,
        idleStepLimit,
        maxStepsReached: false,
      });

      const progressPhase =
        terminalDecision.runStatus === "completed" ? "completed"
          : terminalDecision.runStatus === "blocked" ? "blocked"
            : "failed";
      options.onProgress?.({
        step,
        phase: progressPhase,
        state,
        stepRecord: iteration,
        iteration,
      });

      const resultStatus =
        terminalDecision.resultStatus === "success" ? "success"
          : terminalDecision.resultStatus === "max_iterations_reached" ? "max_iterations_reached"
            : "failed";
      const result = await buildMetaResult(resultStatus, input, state, steps, startedAtMs);
      return { result, state };
    }

    options.onProgress?.({
      step,
      phase: terminalDecision.runStatus === "idle" ? "idle" : "step_running",
      state,
      stepRecord: iteration,
      iteration,
    });
  }

  const terminalDecision = determineRunTerminalState(state, {
    step: maxSteps,
    maxSteps,
    idleCount,
    idleStepLimit,
    maxStepsReached: true,
  });
  applyRunTerminalDecision(state, terminalDecision, {
    step: maxSteps,
    maxSteps,
    idleCount,
    idleStepLimit,
    maxStepsReached: true,
  });

  options.onProgress?.({
    step: maxSteps,
    phase: "max_steps",
    state,
    stepRecord: steps[steps.length - 1],
    iteration: steps[steps.length - 1],
  });

  const result = await buildMetaResult("max_steps_reached", input, state, steps, startedAtMs);
  return { result, state };
}
