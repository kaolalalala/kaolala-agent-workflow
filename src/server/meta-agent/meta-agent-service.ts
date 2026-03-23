/**
 * Meta-Agent Service — the self-planning, self-evaluating, self-evolving agent loop.
 *
 * Receives a high-level goal and autonomously:
 * 1. Plans a workflow (selects/generates node topology)
 * 2. Executes it via the platform's own runtime engine
 * 3. Observes results via traces and node I/O
 * 4. Reflects on output quality via LLM self-evaluation
 * 5. Adapts (modifies prompts, topology, tools) and retries if quality threshold not met
 */
import { makeId, nowIso } from "@/lib/utils";
import { configService } from "@/server/config/config-service";
import { runtimeEngine } from "@/server/runtime/runtime-engine";
import { memoryStore, type RunSnapshot } from "@/server/store/memory-store";
import { callLLM } from "./llm-helper";
import type {
  MetaAgentGoal,
  MetaAgentIteration,
  MetaAgentResult,
  WorkflowBlueprint,
} from "./types";

// ── Active sessions (in-memory tracking for SSE or polling) ─────────────
const activeSessions = new Map<string, { result: MetaAgentResult | null; iterations: MetaAgentIteration[]; status: "running" | "done" }>();

export function getSession(sessionId: string) {
  return activeSessions.get(sessionId);
}

// ── Prompts ─────────────────────────────────────────────────────────────

function buildPlanPrompt(goal: string, availableTemplates: string[], previousAttempt?: { blueprint: WorkflowBlueprint; feedback: string }) {
  let prompt = `You are a Meta-Agent that designs multi-agent workflows. Given a user goal, you must output a workflow as JSON.

Available node roles: input, planner, worker, reviewer, research, router, human, output, summarizer

Available workflow templates for reference:
${availableTemplates.map((t) => `- ${t}`).join("\n")}

User goal: "${goal}"

${previousAttempt ? `
IMPORTANT: A previous attempt failed. Here was the workflow and feedback:

Previous workflow nodes: ${previousAttempt.blueprint.nodes.map((n) => `${n.name}(${n.role})`).join(" → ")}
Feedback: ${previousAttempt.feedback}

Please modify the workflow to address this feedback.
` : ""}

Output ONLY valid JSON (no markdown fences, no explanation) in this exact format:
{
  "nodes": [
    { "id": "n_1", "name": "节点名", "role": "input|planner|worker|reviewer|research|router|output|summarizer", "taskSummary": "任务描述", "responsibilitySummary": "职责描述", "systemPrompt": "可选的 system prompt" }
  ],
  "edges": [
    { "id": "e_1", "sourceNodeId": "n_1", "targetNodeId": "n_2", "type": "task_flow" }
  ],
  "rootTask": "根任务描述"
}

Rules:
- Must have exactly one "input" node and one "output" node
- Edges must form a valid DAG from input to output
- Keep it simple: 3-6 nodes for most tasks
- Each node should have a clear, distinct responsibility
- systemPrompt is optional but recommended for worker/reviewer nodes`;

  return prompt;
}

function buildReflectPrompt(goal: string, output: string, traces: TraceSummary) {
  return `You are evaluating whether a multi-agent workflow successfully achieved a goal.

Goal: "${goal}"

Final output (truncated to 2000 chars):
${output.slice(0, 2000)}

Execution summary:
- Total nodes: ${traces.totalNodes}
- Successful nodes: ${traces.successfulNodes}
- Failed nodes: ${traces.failedNodes}
- Total tokens: ${traces.totalTokens}
- Duration: ${traces.durationMs}ms

${traces.errors.length > 0 ? `Errors encountered:\n${traces.errors.map((e) => `- ${e}`).join("\n")}` : "No errors."}

Rate the output quality on a 0-1 scale and provide feedback.
Output ONLY valid JSON (no markdown fences):
{
  "score": 0.0-1.0,
  "verdict": "pass|warn|fail",
  "feedback": "specific feedback on what was good/bad and what to improve",
  "adaptations": ["specific change 1", "specific change 2"]
}

Scoring guide:
- 0.8-1.0: Goal fully achieved, high quality output
- 0.6-0.8: Goal mostly achieved, minor issues
- 0.4-0.6: Partial achievement, significant improvements needed
- 0.0-0.4: Failed to achieve goal`;
}

interface TraceSummary {
  totalNodes: number;
  successfulNodes: number;
  failedNodes: number;
  totalTokens: number;
  durationMs: number;
  errors: string[];
  nodeOutputs: Array<{ nodeId: string; nodeName: string; output: string }>;
  finalOutput: string;
}

// ── Core Loop ───────────────────────────────────────────────────────────

export async function runMetaAgent(input: MetaAgentGoal): Promise<MetaAgentResult> {
  const sessionId = makeId("meta");
  const maxIter = input.maxIterations ?? 3;
  const threshold = input.qualityThreshold ?? 0.7;
  const startTime = Date.now();
  const iterations: MetaAgentIteration[] = [];
  let totalTokens = 0;
  let currentBlueprint: WorkflowBlueprint | undefined;
  let lastFeedback = "";
  let finalResult: MetaAgentResult;

  activeSessions.set(sessionId, { result: null, iterations, status: "running" });

  try {
    for (let i = 1; i <= maxIter; i++) {
      const iter: MetaAgentIteration = {
        iteration: i,
        phase: "plan",
        startedAt: nowIso(),
      };

      // ── Phase 1: Plan ──
      try {
        iter.phase = "plan";
        const blueprint = await plan(input.goal, currentBlueprint, lastFeedback, input.workflowTemplateId);
        currentBlueprint = blueprint;
        iter.workflowSnapshot = blueprint;

        // ── Phase 2: Execute ──
        iter.phase = "execute";
        const { runId } = await execute(blueprint, input.goal);
        iter.runId = runId;

        // Wait for run to complete
        const snapshot = await waitForRunCompletion(runId, 120_000);
        iter.runStatus = snapshot.run.status;
        iter.runDurationMs = diffMs(snapshot.run.createdAt, snapshot.run.finishedAt);
        // Compute total tokens from node traces
        const nodeTraces = memoryStore.getNodeTraces(runId);
        iter.runTotalTokens = nodeTraces.reduce((sum, t) => sum + (t.totalTokens ?? 0), 0);
        totalTokens += iter.runTotalTokens;

        // ── Phase 3: Observe ──
        iter.phase = "observe";
        const traces = observeRun(snapshot);
        iter.observationSummary = `Nodes: ${traces.totalNodes} (${traces.successfulNodes} ok, ${traces.failedNodes} failed). Tokens: ${traces.totalTokens}. Duration: ${traces.durationMs}ms.`;

        // ── Phase 4: Reflect ──
        iter.phase = "reflect";
        const reflection = await reflect(input.goal, traces);
        iter.reflectionScore = reflection.score;
        iter.reflectionVerdict = reflection.verdict;
        iter.reflectionFeedback = reflection.feedback;
        iter.adaptations = reflection.adaptations;
        lastFeedback = reflection.feedback;

        iter.finishedAt = nowIso();
        iterations.push(iter);

        // Check if quality threshold met
        if (reflection.score >= threshold) {
          finalResult = {
            status: "success",
            goal: input.goal,
            finalOutput: traces.finalOutput,
            finalRunId: runId,
            finalScore: reflection.score,
            iterations,
            totalDurationMs: Date.now() - startTime,
            totalTokensUsed: totalTokens,
            workflowEvolution: iterations
              .filter((it) => it.adaptations && it.adaptations.length > 0)
              .map((it) => ({ iteration: it.iteration, adaptations: it.adaptations! })),
          };
          activeSessions.set(sessionId, { result: finalResult, iterations, status: "done" });
          return finalResult;
        }

        // ── Phase 5: Adapt (implicit — next iteration's plan will use feedback) ──
        iter.phase = "adapt";
      } catch (error) {
        iter.error = error instanceof Error ? error.message : String(error);
        iter.finishedAt = nowIso();
        iterations.push(iter);
        lastFeedback = `Iteration ${i} failed: ${iter.error}. Try a different approach.`;
      }
    }

    // Max iterations reached
    const lastIter = iterations[iterations.length - 1];
    finalResult = {
      status: lastIter?.reflectionScore && lastIter.reflectionScore >= threshold * 0.8
        ? "success"
        : "max_iterations_reached",
      goal: input.goal,
      finalOutput: lastIter?.runId ? getRunFinalOutput(lastIter.runId) : undefined,
      finalRunId: lastIter?.runId,
      finalScore: lastIter?.reflectionScore,
      iterations,
      totalDurationMs: Date.now() - startTime,
      totalTokensUsed: totalTokens,
      workflowEvolution: iterations
        .filter((it) => it.adaptations && it.adaptations.length > 0)
        .map((it) => ({ iteration: it.iteration, adaptations: it.adaptations! })),
    };
    activeSessions.set(sessionId, { result: finalResult, iterations, status: "done" });
    return finalResult;

  } catch (error) {
    finalResult = {
      status: "failed",
      goal: input.goal,
      iterations,
      totalDurationMs: Date.now() - startTime,
      totalTokensUsed: totalTokens,
      workflowEvolution: [],
    };
    activeSessions.set(sessionId, { result: finalResult, iterations, status: "done" });
    return finalResult;
  }
}

// ── Phase implementations ───────────────────────────────────────────────

async function plan(
  goal: string,
  previousBlueprint?: WorkflowBlueprint,
  feedback?: string,
  templateId?: string,
): Promise<WorkflowBlueprint> {
  // If a template is specified and this is the first attempt, use it
  if (templateId && !previousBlueprint) {
    const template = configService.getWorkflowTemplate(templateId);
    if (template) {
      return {
        nodes: template.nodes.map((n) => ({
          id: n.id,
          name: n.name,
          role: n.role,
          taskSummary: n.taskSummary ?? n.name,
          responsibilitySummary: n.responsibilitySummary ?? "",
        })),
        edges: template.edges.map((e) => ({
          id: e.id,
          sourceNodeId: e.sourceNodeId,
          targetNodeId: e.targetNodeId,
          type: e.type ?? "task_flow",
        })),
        rootTask: template.rootTaskInput ?? goal,
      };
    }
  }

  // Get available templates for context
  const templates = configService.listWorkflowTemplates();
  const templateNames = templates.map((t) => `${t.name}: ${t.description ?? ""}`);

  const prompt = buildPlanPrompt(
    goal,
    templateNames,
    previousBlueprint && feedback
      ? { blueprint: previousBlueprint, feedback }
      : undefined,
  );

  const response = await callLLM([
    { role: "system", content: "You are a workflow architect. Output ONLY valid JSON." },
    { role: "user", content: prompt },
  ]);

  return parseBlueprint(response, goal);
}

function parseBlueprint(response: string, goal: string): WorkflowBlueprint {
  // Strip markdown fences if present
  let json = response.trim();
  if (json.startsWith("```")) {
    json = json.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  try {
    const parsed = JSON.parse(json);

    const nodes = (parsed.nodes ?? []).map((n: Record<string, string>, i: number) => ({
      id: n.id || `n_${i + 1}`,
      name: n.name || `Node ${i + 1}`,
      role: n.role || "worker",
      taskSummary: n.taskSummary || n.name || "",
      responsibilitySummary: n.responsibilitySummary || "",
      systemPrompt: n.systemPrompt,
    }));

    const edges = (parsed.edges ?? []).map((e: Record<string, string>, i: number) => ({
      id: e.id || `e_${i + 1}`,
      sourceNodeId: e.sourceNodeId,
      targetNodeId: e.targetNodeId,
      type: e.type || "task_flow",
    }));

    // Validate: must have input and output nodes
    const hasInput = nodes.some((n: { role: string }) => n.role === "input");
    const hasOutput = nodes.some((n: { role: string }) => n.role === "output");

    if (!hasInput) {
      nodes.unshift({
        id: "n_input",
        name: "输入节点",
        role: "input",
        taskSummary: "接收任务输入",
        responsibilitySummary: "注入用户目标",
      });
      if (nodes.length > 1) {
        edges.unshift({ id: "e_auto_in", sourceNodeId: "n_input", targetNodeId: nodes[1].id, type: "task_flow" });
      }
    }

    if (!hasOutput) {
      const lastNonOutput = nodes[nodes.length - 1];
      const outputNode = {
        id: "n_output",
        name: "输出节点",
        role: "output",
        taskSummary: "汇总最终输出",
        responsibilitySummary: "输出最终结果",
      };
      nodes.push(outputNode);
      edges.push({ id: "e_auto_out", sourceNodeId: lastNonOutput.id, targetNodeId: "n_output", type: "task_flow" });
    }

    return {
      nodes,
      edges,
      rootTask: parsed.rootTask || goal,
    };
  } catch {
    // Fallback: create a minimal 3-node workflow
    return {
      nodes: [
        { id: "n_input", name: "输入节点", role: "input", taskSummary: "接收任务输入", responsibilitySummary: "注入用户目标" },
        { id: "n_worker", name: "执行节点", role: "worker", taskSummary: goal, responsibilitySummary: "执行核心任务" },
        { id: "n_output", name: "输出节点", role: "output", taskSummary: "汇总输出", responsibilitySummary: "输出结果" },
      ],
      edges: [
        { id: "e_1", sourceNodeId: "n_input", targetNodeId: "n_worker", type: "task_flow" },
        { id: "e_2", sourceNodeId: "n_worker", targetNodeId: "n_output", type: "task_flow" },
      ],
      rootTask: goal,
    };
  }
}

async function execute(blueprint: WorkflowBlueprint, goal: string): Promise<{ runId: string }> {
  const positionX = 120;
  const positionYStep = 180;

  const nodes = blueprint.nodes.map((n, i) => ({
    id: n.id,
    name: n.name,
    role: n.role as "input" | "planner" | "worker" | "reviewer" | "research" | "router" | "human" | "output" | "summarizer",
    taskSummary: n.taskSummary,
    responsibilitySummary: n.responsibilitySummary,
    position: { x: positionX + i * 250, y: 200 },
  }));

  const edges = blueprint.edges.map((e) => ({
    id: e.id,
    sourceNodeId: e.sourceNodeId,
    targetNodeId: e.targetNodeId,
    type: (e.type ?? "task_flow") as "task_flow" | "output_flow" | "loop_back",
  }));

  const tasks = [
    { id: "t_root", title: blueprint.rootTask || goal, status: "ready" as const },
    ...nodes.filter((n) => n.role !== "input" && n.role !== "output").map((n, i) => ({
      id: `t_${i + 1}`,
      title: n.taskSummary,
      status: "ready" as const,
      assignedNodeId: n.id,
      parentTaskId: "t_root",
    })),
  ];

  // Create and start the run
  const run = runtimeEngine.createRun(goal, { nodes, edges, tasks }, "standard");

  // Save system prompts for nodes that have them
  for (const n of blueprint.nodes) {
    if (n.systemPrompt) {
      try {
        configService.ensureNodeConfig({
          runId: run.id,
          nodeId: n.id,
          name: n.name,
          systemPrompt: n.systemPrompt,
          allowHumanInput: false,
        });
      } catch {
        // Non-critical: node config save failed
      }
    }
  }

  // Start execution (fire-and-forget, engine runs async)
  runtimeEngine.startRun(run.id).catch((err) => {
    console.error("[MetaAgent] startRun error:", err);
  });

  return { runId: run.id };
}

async function waitForRunCompletion(runId: string, timeoutMs: number): Promise<RunSnapshot> {
  const startWait = Date.now();
  const pollInterval = 1000;

  while (Date.now() - startWait < timeoutMs) {
    const snapshot = memoryStore.getRunSnapshot(runId);
    if (!snapshot) throw new Error(`Run ${runId} not found`);

    if (snapshot.run.status === "completed" || snapshot.run.status === "failed") {
      return snapshot;
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error(`Run ${runId} timed out after ${timeoutMs}ms`);
}

function observeRun(snapshot: RunSnapshot): TraceSummary {
  const nodes = snapshot.nodes;
  const successful = nodes.filter((n) => n.status === "completed" || n.status === ("done" as string)).length;
  const failed = nodes.filter((n) => n.status === "failed" || n.status === ("error" as string)).length;

  const errors: string[] = [];
  const nodeOutputs: Array<{ nodeId: string; nodeName: string; output: string }> = [];

  for (const node of nodes) {
    if (node.error) {
      errors.push(`[${node.name}]: ${node.error}`);
    }
    if (node.latestOutput) {
      nodeOutputs.push({ nodeId: node.id, nodeName: node.name, output: node.latestOutput });
    }
  }

  // Find the output node's output as finalOutput
  const outputNode = nodes.find((n) => n.role === "output");
  const finalOutput = outputNode?.latestOutput
    ?? nodeOutputs[nodeOutputs.length - 1]?.output
    ?? "";

  const durationMs = diffMs(snapshot.run.createdAt, snapshot.run.finishedAt) ?? 0;
  const traces = memoryStore.getNodeTraces(snapshot.run.id);
  const totalTokens = traces.reduce((sum, t) => sum + (t.totalTokens ?? 0), 0);

  return {
    totalNodes: nodes.length,
    successfulNodes: successful,
    failedNodes: failed,
    totalTokens,
    durationMs,
    errors,
    nodeOutputs,
    finalOutput,
  };
}

async function reflect(goal: string, traces: TraceSummary): Promise<{
  score: number;
  verdict: string;
  feedback: string;
  adaptations: string[];
}> {
  // If the run completely failed (all nodes failed), skip LLM call
  if (traces.failedNodes === traces.totalNodes || !traces.finalOutput) {
    return {
      score: 0.1,
      verdict: "fail",
      feedback: `Run completely failed. ${traces.errors.length} errors: ${traces.errors.slice(0, 3).join("; ")}`,
      adaptations: ["simplify the workflow", "check if the task is feasible", "reduce node count"],
    };
  }

  const prompt = buildReflectPrompt(goal, traces.finalOutput, traces);

  const response = await callLLM([
    { role: "system", content: "You are a quality evaluator. Output ONLY valid JSON." },
    { role: "user", content: prompt },
  ]);

  try {
    let json = response.trim();
    if (json.startsWith("```")) {
      json = json.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    const parsed = JSON.parse(json);
    return {
      score: Math.max(0, Math.min(1, Number(parsed.score) || 0)),
      verdict: parsed.verdict || "fail",
      feedback: parsed.feedback || "No feedback",
      adaptations: Array.isArray(parsed.adaptations) ? parsed.adaptations : [],
    };
  } catch {
    // If LLM response is unparseable, give a middle score
    return {
      score: 0.5,
      verdict: "warn",
      feedback: "Could not parse reflection response. Output exists but quality uncertain.",
      adaptations: ["improve output clarity"],
    };
  }
}

function getRunFinalOutput(runId: string): string | undefined {
  const snapshot = memoryStore.getRunSnapshot(runId);
  if (!snapshot) return undefined;
  const outputNode = snapshot.nodes.find((n) => n.role === "output");
  return outputNode?.latestOutput ?? snapshot.nodes[snapshot.nodes.length - 1]?.latestOutput;
}

function diffMs(start?: string, end?: string): number | undefined {
  if (!start || !end) return undefined;
  const val = new Date(end).getTime() - new Date(start).getTime();
  return Number.isFinite(val) && val >= 0 ? val : undefined;
}

// ── Public API ──────────────────────────────────────────────────────────

export const metaAgentService = {
  run: runMetaAgent,
  getSession,
};
