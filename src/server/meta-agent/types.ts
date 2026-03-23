/**
 * Meta-Agent Types — domain types for the self-planning, self-evolving agent loop.
 */

export interface MetaAgentGoal {
  goal: string;
  maxIterations?: number;       // default 3
  qualityThreshold?: number;    // 0-1, default 0.7
  workflowTemplateId?: string;  // optional: start from a specific template
}

export interface MetaAgentIteration {
  iteration: number;
  phase: "plan" | "execute" | "observe" | "reflect" | "adapt";
  workflowSnapshot?: WorkflowBlueprint;
  runId?: string;
  runStatus?: string;
  runDurationMs?: number;
  runTotalTokens?: number;
  observationSummary?: string;
  reflectionScore?: number;
  reflectionVerdict?: string;
  reflectionFeedback?: string;
  adaptations?: string[];
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface WorkflowBlueprint {
  nodes: Array<{
    id: string;
    name: string;
    role: string;
    taskSummary: string;
    responsibilitySummary: string;
    systemPrompt?: string;
  }>;
  edges: Array<{
    id: string;
    sourceNodeId: string;
    targetNodeId: string;
    type: string;
  }>;
  rootTask: string;
}

export interface MetaAgentResult {
  status: "success" | "failed" | "max_iterations_reached";
  goal: string;
  finalOutput?: string;
  finalRunId?: string;
  finalScore?: number;
  iterations: MetaAgentIteration[];
  totalDurationMs: number;
  totalTokensUsed: number;
  workflowEvolution: Array<{
    iteration: number;
    adaptations: string[];
  }>;
}
