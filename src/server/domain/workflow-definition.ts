export interface StoredWorkflowNode {
  id: string;
  name: string;
  role: string;
  status?: string;
  taskSummary?: string;
  responsibilitySummary?: string;
  position?: { x: number; y: number };
  width?: number;
  height?: number;
}

export interface StoredWorkflowEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  type: "task_flow" | "output_flow" | "loop_back";
  condition?: string;
  /** Maximum loop iterations before forced stop (loop_back edges only) */
  maxIterations?: number;
  /** If the upstream output contains this keyword, the loop stops (loop_back edges only) */
  convergenceKeyword?: string;
}

export interface StoredWorkflowTask {
  id: string;
  title: string;
  status: string;
  parentTaskId?: string;
  assignedNodeId?: string;
  summary?: string;
}

export interface WorkflowDefinition {
  id: string;
  projectId?: string;
  name: string;
  description?: string;
  rootTaskInput?: string;
  nodes: StoredWorkflowNode[];
  edges: StoredWorkflowEdge[];
  tasks: StoredWorkflowTask[];
  currentVersionId?: string;
  currentVersionNumber?: number;
  publishedVersionId?: string;
  publishedVersionNumber?: number;
  versionsCount?: number;
  versions?: WorkflowVersionSummary[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowDefinitionSummary {
  id: string;
  projectId?: string;
  name: string;
  description?: string;
  rootTaskInput?: string;
  currentVersionId?: string;
  currentVersionNumber?: number;
  publishedVersionId?: string;
  publishedVersionNumber?: number;
  versionsCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowVersionSummary {
  id: string;
  workflowId: string;
  versionNumber: number;
  versionLabel: string;
  versionNotes?: string;
  createdAt: string;
  publishedAt?: string;
}

export interface WorkflowVersionDefinition extends WorkflowVersionSummary {
  rootTaskInput?: string;
  nodes: StoredWorkflowNode[];
  edges: StoredWorkflowEdge[];
  tasks: StoredWorkflowTask[];
}
