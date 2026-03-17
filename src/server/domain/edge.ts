export type EdgeType = "task_flow" | "output_flow" | "loop_back";

export interface WorkflowEdge {
  id: string;
  runId: string;
  sourceNodeId: string;
  targetNodeId: string;
  type: EdgeType;
  /** Conditional routing label — only followed when upstream emits a matching condition */
  condition?: string;
  /** Maximum loop iterations (loop_back edges only) */
  maxIterations?: number;
  /** Convergence keyword — loop stops when output contains this (loop_back edges only) */
  convergenceKeyword?: string;
}
