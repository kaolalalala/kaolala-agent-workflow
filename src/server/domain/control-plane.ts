export type ControlOwnerKind = "runtime" | "planner" | "worker" | "meta_agent" | "human" | "reviewer";

export type ControlRunState =
  | "pending"
  | "running"
  | "waiting_human"
  | "blocked_policy"
  | "retrying"
  | "completed"
  | "failed"
  | "terminated";

export type ControlNodeState =
  | "pending"
  | "ready"
  | "running"
  | "waiting_dependency"
  | "waiting_input"
  | "waiting_approval"
  | "retrying"
  | "completed"
  | "failed"
  | "skipped"
  | "terminated";

export type ControlRecoveryDecision = "retry" | "reroute" | "fallback" | "terminate";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";
export type SideEffectLevel = "none" | "low" | "medium" | "high" | "critical";
export type ControlActionStatus = "proposed" | "approved" | "rejected" | "executing" | "succeeded" | "failed" | "cancelled";

export interface AllowedControlAction {
  actionType: string;
  label: string;
  source: "runtime" | "policy" | "role_template" | "system";
  enabled?: boolean;
  approvalRequired?: boolean;
  reason?: string;
  sideEffectLevel?: SideEffectLevel;
}

export interface ControlBudgetSnapshot {
  maxSteps?: number;
  usedSteps: number;
  maxTokens?: number;
  usedTokens: number;
  maxCostUsd?: number;
  usedCostUsd: number;
  maxWallMs?: number;
  usedWallMs: number;
}

export interface ControlRecoveryPolicy {
  onFailure: ControlRecoveryDecision;
  maxRetries?: number;
  fallbackTarget?: string;
  terminateReasons?: string[];
}

export interface ControlReplayScope {
  nodeReplayReady: boolean;
  stepRerunReady: boolean;
  runCompareReady: boolean;
}

export interface RunControlStateRecord {
  runId: string;
  state: ControlRunState;
  ownerKind: ControlOwnerKind;
  ownerRef: string;
  activeNodeId?: string;
  currentCheckpointId?: string;
  budget: ControlBudgetSnapshot;
  allowedActions: AllowedControlAction[];
  recoveryPolicy: ControlRecoveryPolicy;
  replayScope: ControlReplayScope;
  pendingApprovalCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface NodeControlStateRecord {
  runId: string;
  nodeId: string;
  state: ControlNodeState;
  ownerKind: ControlOwnerKind;
  ownerRef: string;
  allowedActions: AllowedControlAction[];
  recoveryPolicy: ControlRecoveryPolicy;
  budget: ControlBudgetSnapshot;
  checkpointEligible: boolean;
  replayEligible: boolean;
  partialRerunEligible: boolean;
  approvalRequired: boolean;
  approvalStatus?: ApprovalStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ControlActionRecord {
  id: string;
  runId: string;
  nodeId?: string;
  actionType: string;
  targetScope: "run" | "node" | "subtask" | "tool" | "browser" | "memory";
  proposer: string;
  ownerKind: ControlOwnerKind;
  status: ControlActionStatus;
  sideEffectLevel: SideEffectLevel;
  approvalRequired: boolean;
  payload?: Record<string, unknown>;
  recoveryDecision?: ControlRecoveryDecision;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalRequestRecord {
  id: string;
  runId: string;
  nodeId?: string;
  actionId?: string;
  riskLevel: "medium" | "high" | "critical";
  reason: string;
  requestedBy: string;
  status: ApprovalStatus;
  approvedBy?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
}
