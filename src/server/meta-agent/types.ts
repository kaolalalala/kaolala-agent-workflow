/**
 * Meta-Agent Types — domain types for the self-planning, self-evolving agent loop.
 */

export interface MetaAgentGoal {
  goal: string;
  projectId?: string;
  maxPlanningRounds?: number;   // planner regenerate / replan budget
  maxStepLimit?: number;        // runtime step budget
  maxIterations?: number;       // deprecated alias for maxPlanningRounds
  qualityThreshold?: number;    // 0-1, default 0.7
  workflowTemplateId?: string;  // optional: start from a specific template
}

export interface MetaAgentStep {
  step: number;
  iteration?: number; // deprecated alias
  phase: "todo" | "plan" | "execute" | "observe" | "reflect" | "adapt";
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
  /** Bandit strategy info (first iteration only) */
  banditTemplateId?: string;
  banditIsExploration?: boolean;
  /** Training data enrichment: full LLM planning prompt sent to the model */
  planningPrompt?: string;
  /** Training data enrichment: raw LLM response before parsing */
  planningRawResponse?: string;
  /** Training data enrichment: per-node quality scores from multi-dimensional evaluator */
  nodeQualityScores?: NodeQualityScore[];
  startedAt: string;
  finishedAt?: string;
}

export type MetaAgentIteration = MetaAgentStep;

/** Per-node multi-dimensional quality score (used by quality evaluator) */
export interface NodeQualityScore {
  nodeId: string;
  nodeName: string;
  nodeRole: string;
  /** How relevant is this node's output to the assigned subtask (0-1) */
  relevance: number;
  /** Did it cover everything expected (0-1) */
  completeness: number;
  /** Is the content factually sound and correct (0-1) */
  accuracy: number;
  /** Is the output well-structured and logically coherent (0-1) */
  coherence: number;
  /** Weighted average of all dimensions (0-1) */
  overallScore: number;
  /** Brief textual feedback */
  feedback: string;
}

/** Multi-dimensional evaluation result for an entire workflow run */
export interface WorkflowEvaluation {
  nodeScores: NodeQualityScore[];
  /** Weighted aggregate across all nodes (0-1) */
  aggregateScore: number;
  /** Overall textual feedback */
  overallFeedback: string;
  /** Topology quality: was the node arrangement reasonable for this goal? (0-1) */
  topologyScore: number;
  /** Collaboration quality: did nodes pass information effectively? (0-1) */
  collaborationScore: number;
}

/** Agent-level quality evaluation (for individual prompt_trace completions) */
export interface AgentOutputEvaluation {
  /** Overall quality score (0-1) */
  score: number;
  /** Role-specific dimension scores */
  dimensions: Record<string, number>;
  /** Brief rationale for the score */
  rationale: string;
}

/** Configuration for DPO multi-strategy runs on the same goal */
export interface MetaAgentDPOGoal {
  goal: string;
  /** Number of different strategies to try (default 3) */
  strategyCount?: number;
  qualityThreshold?: number;
}

export interface WorkflowBlueprint {
  nodes: Array<{
    id: string;
    name: string;
    role: string;
    taskSummary: string;
    responsibilitySummary: string;
    systemPrompt?: string;
    toolIds?: string[];
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
  status: "success" | "failed" | "max_steps_reached" | "max_iterations_reached";
  goal: string;
  finalOutput?: string;
  finalSummary?: string;
  finalRunId?: string;
  finalScore?: number;
  steps: MetaAgentStep[];
  iterations: MetaAgentIteration[];
  totalDurationMs: number;
  totalTokensUsed: number;
  workflowEvolution: Array<{
    iteration: number;
    adaptations: string[];
  }>;
}
