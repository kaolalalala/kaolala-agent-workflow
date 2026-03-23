import {
  AgentContextView,
  AgentDefinitionView,
  AgentNode,
  HumanMessageView,
  RunEvent,
  RunInfo,
  TaskItem,
  WorkflowEdge,
  WorkflowMessage,
} from "@/features/workflow/types";

type BackendNodeStatus = "idle" | "ready" | "running" | "waiting" | "completed" | "failed";
type BackendTaskStatus = "pending" | "running" | "completed" | "failed";

type AgentDocumentType = "prompt" | "skill" | "reference";

interface BackendRun {
  id: string;
  name: string;
  rootTaskId: string;
  status: RunInfo["status"];
  workflowId?: string;
  workflowVersionId?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  output?: string;
  error?: string;
}

interface BackendNode {
  id: string;
  runId: string;
  name: string;
  role: AgentNode["role"];
  status: BackendNodeStatus;
  taskId?: string;
  position?: { x: number; y: number };
  width?: number;
  height?: number;
  responsibility?: string;
  taskBrief?: string;
  latestInput?: string;
  latestOutput?: string;
  inboundMessages: WorkflowMessage[];
  outboundMessages: WorkflowMessage[];
  resolvedInput?: string;
  error?: string;
  blockedReason?: string;
  executionOrder?: number;
  createdAt: string;
  updatedAt: string;
  agentDefinitionId: string;
  contextId?: string;
}

interface BackendTask {
  id: string;
  runId: string;
  title: string;
  summary?: string;
  parentTaskId?: string;
  assignedNodeId?: string;
  status: BackendTaskStatus;
}

interface BackendEvent {
  id: string;
  runId: string;
  type: RunEvent["type"];
  timestamp: string;
  runEventSeq?: number;
  relatedNodeId?: string;
  relatedTaskId?: string;
  message: string;
  payload?: Record<string, unknown>;
}

interface BackendSnapshot {
  run: BackendRun;
  tasks: BackendTask[];
  nodes: BackendNode[];
  edges: BackendEdge[];
  messages: WorkflowMessage[];
  events: BackendEvent[];
  agentContexts: BackendAgentContext[];
  humanMessages: BackendHumanMessage[];
}

interface BackendAgentDefinition {
  id: string;
  runId: string;
  name: string;
  role: "planner" | "worker" | "summarizer" | "reviewer" | "research" | "router" | "human" | "tool" | "input" | "output";
  systemPrompt: string;
  responsibility: string;
  inputSchema?: string;
  outputSchema?: string;
  allowHumanInput: boolean;
  model?: string;
  temperature?: number;
  provider?: string;
  createdAt: string;
  updatedAt: string;
}

interface BackendHumanMessage {
  id: string;
  runId: string;
  targetNodeId: string;
  content: string;
  attachments?: Array<{
    name: string;
    mimeType: string;
    content: string;
  }>;
  createdAt: string;
}

interface BackendAgentContext {
  id: string;
  nodeId: string;
  runId: string;
  systemPrompt: string;
  taskBrief?: string;
  inboundMessages: WorkflowMessage[];
  outboundMessages: WorkflowMessage[];
  resolvedInput?: string;
  humanMessages: BackendHumanMessage[];
  recentOutputs: string[];
  latestSummary?: string;
  updatedAt: string;
}

interface BackendWorkflowSummary {
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

interface BackendEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  type: "task_flow" | "output_flow" | "loop_back";
  condition?: string;
  maxIterations?: number;
  convergenceKeyword?: string;
}

interface BackendWorkflowDefinition extends BackendWorkflowSummary {
  currentVersionId?: string;
  currentVersionNumber?: number;
  publishedVersionId?: string;
  publishedVersionNumber?: number;
  versionsCount?: number;
  versions?: BackendWorkflowVersionSummary[];
  nodes: Array<{
    id: string;
    name: string;
    role: AgentNode["role"];
    status?: string;
    taskSummary?: string;
    responsibilitySummary?: string;
    position?: { x: number; y: number };
    width?: number;
    height?: number;
  }>;
  edges: BackendEdge[];
  tasks: Array<{
    id: string;
    title: string;
    status: TaskItem["status"];
    parentTaskId?: string;
    assignedNodeId?: string;
    summary?: string;
  }>;
}

interface BackendWorkflowVersionSummary {
  id: string;
  workflowId: string;
  versionNumber: number;
  versionLabel: string;
  versionNotes?: string;
  createdAt: string;
  publishedAt?: string;
}

export interface FrontendSnapshot {
  run: RunInfo;
  tasks: TaskItem[];
  nodes: AgentNode[];
  edges: WorkflowEdge[];
  messages: WorkflowMessage[];
  events: RunEvent[];
  nodeContextsByNodeId: Record<string, AgentContextView>;
  output: string;
}

export interface FrontendNodeAgent {
  definition: AgentDefinitionView;
  context: AgentContextView;
  humanMessages: HumanMessageView[];
}

export interface CredentialSummary {
  id: string;
  provider: string;
  label: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceConfigView {
  id: string;
  name: string;
  defaultProvider?: string;
  defaultModel?: string;
  defaultBaseUrl?: string;
  defaultCredentialId?: string;
  defaultTemperature?: number;
  createdAt: string;
  updatedAt: string;
}

export type ExecutionModeView = "standard" | "dev" | "script";

export interface NodeConfigView {
  id: string;
  runId: string;
  nodeId: string;
  name: string;
  description?: string;
  responsibility?: string;
  systemPrompt?: string;
  additionalPrompt?: string;
  useWorkspaceModelDefault: boolean;
  provider?: string;
  model?: string;
  credentialId?: string;
  baseUrl?: string;
  outputPath?: string;
  temperature?: number;
  allowHumanInput: boolean;
  toolPolicy: "disabled" | "allowed" | "required";
  executionMode: ExecutionModeView;
  workspaceId?: string;
  entryFile?: string;
  runCommand?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceFileView {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  updatedAt: string;
}

export interface WorkspaceFileTreeView {
  workspaceId: string;
  files: WorkspaceFileView[];
}

export interface WorkspaceFileContentView {
  content: string;
  name: string;
  size: number;
}

export interface DevWorkspaceRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  outputFiles: string[];
  success: boolean;
}

export interface LocalEnvironmentView {
  id: string;
  name: string;
  runtimeType: "python";
  source: "system" | "conda";
  pythonPath: string;
  version: string;
  isAvailable: boolean;
}

export interface EnvironmentTestResult {
  success: boolean;
  output: string;
}

export interface LocalProjectConfig {
  id: string;
  workspaceId: string;
  localPath: string;
  entryFile?: string;
  runCommand?: string;
  environmentId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LocalFileInfo {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  updatedAt: string;
}

export interface AgentDocumentView {
  id: string;
  runId?: string;
  ownerType: "workspace" | "node";
  ownerId: string;
  type: AgentDocumentType;
  name: string;
  format: "markdown";
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowSummaryView {
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

export interface WorkflowVersionSummaryView {
  id: string;
  workflowId: string;
  versionNumber: number;
  versionLabel: string;
  versionNotes?: string;
  createdAt: string;
  publishedAt?: string;
}

export interface WorkflowDefinitionView extends WorkflowSummaryView {
  versions: WorkflowVersionSummaryView[];
  nodes: Pick<AgentNode, "id" | "name" | "role" | "taskSummary" | "responsibilitySummary" | "position" | "width" | "height">[];
  edges: WorkflowEdge[];
  tasks: Pick<TaskItem, "id" | "title" | "status" | "parentTaskId" | "assignedNodeId" | "summary">[];
}

export interface ProjectSummaryView {
  id: string;
  name: string;
  description?: string;
  settings: ProjectSettingsView;
  effectiveSettings?: ProjectSettingsView;
  archivedAt?: string;
  settingsUpdatedAt?: string;
  workflowCount?: number;
  runCount?: number;
  fileCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSettingsView {
  defaultProvider?: string;
  defaultModel?: string;
  defaultBaseUrl?: string;
  defaultCredentialId?: string;
  defaultTemperature?: number;
  projectNotes?: string;
}

export interface ModelAssetView {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl?: string;
  credentialId?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PromptTemplateAssetView {
  id: string;
  name: string;
  templateType: "system" | "agent" | "workflow";
  description?: string;
  content: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowTemplatePresetTaskView {
  id: string;
  title: string;
  difficulty: "简单" | "中等" | "复杂";
  input: string;
}

export interface WorkflowTemplateView {
  id: string;
  name: string;
  description?: string;
  rootTaskInput?: string;
  nodes: Pick<AgentNode, "id" | "name" | "role" | "taskSummary" | "responsibilitySummary" | "position" | "width" | "height">[];
  edges: WorkflowEdge[];
  tasks: Pick<TaskItem, "id" | "title" | "status" | "parentTaskId" | "assignedNodeId" | "summary">[];
  nodeCount?: number;
  edgeCount?: number;
  isBuiltin?: boolean;
  templateCategory?: "节点规模" | "任务类型";
  scenario?: string;
  presetTasks?: WorkflowTemplatePresetTaskView[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentTemplateView {
  id: string;
  name: string;
  description?: string;
  role: AgentNode["role"];
  defaultPrompt?: string;
  taskSummary?: string;
  responsibilitySummary?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ScriptAssetView {
  id: string;
  name: string;
  description?: string;
  localPath: string;
  runCommand: string;
  parameterSchema: Record<string, unknown>;
  defaultEnvironmentId?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SkillAssetView {
  id: string;
  name: string;
  description?: string;
  scriptId: string;
  parameterMapping: Record<string, string>;
  outputDescription?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SkillBindingView {
  id: string;
  nodeId: string;
  runId: string;
  skillId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SkillPackRoleSummaryView {
  id: string;
  sourceFile: string;
  roleName: string;
  positioning: string;
  responsibilities: string[];
  domain: string[];
  strengths: string[];
  inputType: string[];
  outputType: string[];
  collaboration: string[];
  scenarios: string[];
  constraints: string[];
  warnings: string[];
}

export interface SkillPackDraftNodeView {
  id: string;
  name: string;
  role: AgentNode["role"];
  taskSummary?: string;
  responsibilitySummary?: string;
  rolePrompt?: string;
  sourceRoleId?: string;
  position?: { x: number; y: number };
  width?: number;
  height?: number;
}

export interface SkillPackWorkflowDraftView {
  name: string;
  description?: string;
  rootTaskInput?: string;
  nodes: SkillPackDraftNodeView[];
  edges: WorkflowEdge[];
  tasks: Pick<TaskItem, "id" | "title" | "status" | "parentTaskId" | "assignedNodeId" | "summary">[];
}

export interface SkillPackPlanView {
  planner: "llm" | "heuristic";
  warnings: string[];
  roleSummaries: SkillPackRoleSummaryView[];
  draft: SkillPackWorkflowDraftView;
}

export interface WorkflowAssetReferenceView {
  id: string;
  workflowId: string;
  assetType: "tool" | "model" | "prompt_template";
  assetId: string;
  createdAt: string;
  updatedAt: string;
}

export interface RunRecordView {
  id: string;
  projectId?: string;
  workflowId?: string;
  workflowName: string;
  runType?: "workflow_run" | "dev_run";
  status: "running" | "success" | "failed";
  startedAt: string;
  finishedAt?: string;
  updatedAt: string;
  durationMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  tokenUsageAvailable?: boolean;
  summary?: string;
  triggerSource: "manual";
}

export interface DevRunDetailView {
  id: string;
  runSnapshotId: string;
  workspaceId: string;
  entryFile?: string;
  runCommand: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
  environmentId?: string;
  createdAt: string;
}

export interface DevRunResultView {
  runId: string;
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface RunDetailLogItemView {
  id: string;
  type: string;
  level: "info" | "warn" | "error";
  time: string;
  seq?: number;
  message: string;
  payload?: Record<string, unknown>;
  nodeId?: string;
  taskId?: string;
}

export interface ProjectFileView {
  id: string;
  projectId: string;
  runId?: string;
  workflowId?: string;
  workflowName?: string;
  name: string;
  type: string;
  size?: number;
  sourceType: "upload" | "run_output" | "manual";
  createdAt: string;
  updatedAt: string;
  pathRef?: string;
  contentText?: string;
  contentJson?: unknown;
}

export interface GlobalSearchResultView {
  projects: ProjectSummaryView[];
  workflows: WorkflowSummaryView[];
  runs: RunRecordView[];
  files: ProjectFileView[];
}

export interface NotificationItemView {
  id: string;
  type: "run_success" | "run_failed" | "template_created";
  title: string;
  description: string;
  time: string;
  href?: string;
}

export interface RunDetailView {
  id: string;
  projectId: string;
  workflowId?: string;
  workflowName: string;
  status: "running" | "success" | "failed";
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  updatedAt: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  tokenUsageAvailable?: boolean;
  inputSnapshot?: string;
  outputSnapshot?: string;
  summary?: string;
  logs: RunDetailLogItemView[];
  executionTimeline: Array<{
    nodeId: string;
    name: string;
    role: string;
    status: "running" | "success" | "failed";
    startedAt?: string;
    finishedAt?: string;
    durationMs?: number;
    startOffsetMs?: number;
    endOffsetMs?: number;
  }>;
  nodeExecutions: Array<{
    nodeId: string;
    name: string;
    role: string;
    status: "running" | "success" | "failed";
    startedAt?: string;
    finishedAt?: string;
    durationMs?: number;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    tokenUsageAvailable?: boolean;
    error?: string;
  }>;
  nodeTraces: Array<{
    nodeId: string;
    name: string;
    role: string;
    status: "running" | "success" | "failed";
    startedAt?: string;
    finishedAt?: string;
    durationMs?: number;
    inputSnapshot?: string;
    outputSnapshot?: string;
    error?: string;
    promptTrace?: {
      provider?: string;
      model?: string;
      requestPath?: string;
      systemPrompt?: string;
      userPrompt?: string;
      messageHistory?: Array<{
        id?: string;
        fromNodeId?: string;
        toNodeId?: string;
        type?: string;
        content?: string;
        createdAt?: string;
      }>;
      completion?: string;
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
      tokenUsageAvailable: boolean;
    };
    toolCalls: Array<{
      id: string;
      nodeId: string;
      nodeName: string;
      toolId?: string;
      toolName?: string;
      status: "running" | "success" | "failed";
      startedAt?: string;
      finishedAt?: string;
      durationMs?: number;
      input?: Record<string, unknown>;
      output?: Record<string, unknown>;
      error?: string;
    }>;
  }>;
  replayHints: {
    nodeReplayReady: boolean;
    stepRerunReady: boolean;
    runCompareReady: boolean;
    notes: string;
  };
  artifacts: ProjectFileView[];
  triggerSource: "manual";
}

export interface RunListSummaryView {
  totalRuns: number;
  runningCount: number;
  successCount: number;
  failedCount: number;
  totalDurationMs: number;
  avgDurationMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  tokenUsageAvailable: boolean;
}

export interface WorkflowRunSummaryView {
  workflowId?: string;
  workflowName: string;
  runCount: number;
  runningCount: number;
  successCount: number;
  failedCount: number;
  totalDurationMs: number;
  avgDurationMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  tokenUsageAvailable: boolean;
  lastRunAt: string;
}

// ── Execution Debug Trace Types ──

export interface NodeTraceView {
  id: string;
  runId: string;
  nodeId: string;
  executionId: string;
  attempt: number;
  status: "running" | "completed" | "failed";
  role: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  resolvedInput?: string;
  latestOutput?: string;
  error?: string;
  provider?: string;
  model?: string;
  llmRoundCount: number;
  toolCallCount: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface PromptTraceView {
  id: string;
  runId: string;
  nodeId: string;
  executionId: string;
  round: number;
  provider?: string;
  model?: string;
  systemPrompt?: string;
  userPrompt?: string;
  messageHistoryJson?: string;
  toolsJson?: string;
  completion?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  statusCode?: number;
  error?: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
}

export interface ToolTraceView {
  id: string;
  runId: string;
  nodeId: string;
  executionId: string;
  round: number;
  toolId?: string;
  toolName?: string;
  sourceType?: string;
  status: "running" | "success" | "failed";
  inputJson?: string;
  outputJson?: string;
  errorJson?: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
}

export interface StateTraceView {
  id: string;
  runId: string;
  nodeId: string;
  executionId: string;
  checkpoint: "pre_execution" | "post_input_resolve" | "post_llm" | "post_execution";
  nodeStatus?: string;
  contextSnapshotJson?: string;
  metadataJson?: string;
  createdAt: string;
}

export interface RunTracesView {
  nodeTraces: NodeTraceView[];
  promptTraces: PromptTraceView[];
  toolTraces: ToolTraceView[];
  stateTraces: StateTraceView[];
}

export interface EvaluationSuiteView {
  id: string;
  name: string;
  description?: string;
  workflowId?: string;
  workflowVersionId?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EvaluationCaseView {
  id: string;
  suiteId: string;
  name: string;
  taskInput: string;
  replayMode: "full";
  expectedOutputContains?: string;
  expectedOutputRegex?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EvaluationCheckView {
  id: string;
  passed: boolean;
  detail: string;
}

export interface EvaluationExecutionReportView {
  evaluationRunId: string;
  suiteId: string;
  caseId: string;
  baselineRunId: string;
  replayRunId: string;
  baseline: {
    taskInput?: string;
    memoryIsolationMode?: string;
    status: string;
  };
  replay: {
    taskInput?: string;
    memoryIsolationMode?: string;
    status: string;
  };
  score: number;
  verdict: "pass" | "warn" | "fail";
  checks: EvaluationCheckView[];
  compare: {
    baselineRunId: string;
    candidateRunId: string;
    baselineStatus: string;
    candidateStatus: string;
    baselineDurationMs?: number;
    candidateDurationMs?: number;
    baselineTotalTokens?: number;
    candidateTotalTokens?: number;
    baselineOutputHash?: string;
    candidateOutputHash?: string;
    statusChanged: boolean;
    durationDeltaMs?: number;
    tokenDelta?: number;
    outputChanged: boolean;
    baselineFailedToolCalls: number;
    candidateFailedToolCalls: number;
    toolFailureDelta: number;
    promptDiffSummary: {
      baselinePromptTraceCount: number;
      candidatePromptTraceCount: number;
      changedPromptCount: number;
      changedNodes: Array<{
        nodeId: string;
        nodeName: string;
        baselinePromptHash?: string;
        candidatePromptHash?: string;
        changed: boolean;
      }>;
    };
    nodeDiffs: Array<{
      nodeId: string;
      nodeName: string;
      baselineStatus?: string;
      candidateStatus?: string;
      statusChanged: boolean;
      baselineTotalTokens?: number;
      candidateTotalTokens?: number;
      tokenDelta?: number;
      baselineOutputHash?: string;
      candidateOutputHash?: string;
      outputChanged: boolean;
    }>;
  };
  artifacts: {
    baselineFiles: string[];
    replayFiles: string[];
    missingReplayFiles: string[];
    additionalReplayFiles: string[];
    changedSharedFiles: string[];
    allReplayFilesUnderManagedRoot: boolean;
  };
  createdAt: string;
}

export interface EvaluationRunView {
  id: string;
  suiteId: string;
  caseId: string;
  baselineRunId?: string;
  replayRunId?: string;
  status: string;
  score?: number;
  verdict?: string;
  report?: EvaluationExecutionReportView;
  createdAt: string;
  updatedAt: string;
}

export interface RunListResponseView {
  runs: RunRecordView[];
  summary?: RunListSummaryView;
  workflowSummaries?: WorkflowRunSummaryView[];
}

export interface RunAnalyticsView {
  rangeDays: number;
  generatedAt: string;
  overview: {
    totalRuns: number;
    successCount: number;
    failedCount: number;
    runningCount: number;
    successRate?: number;
    avgDurationMs?: number;
    totalDurationMs: number;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    tokenUsageAvailable: boolean;
  };
  trend: Array<{
    date: string;
    runCount: number;
    successCount: number;
    failedCount: number;
    runningCount: number;
  }>;
  statusDistribution: Array<{
    status: "success" | "failed" | "running";
    count: number;
  }>;
  workflowTokenUsage: Array<{
    workflowId?: string;
    workflowName: string;
    totalTokens: number;
    runCount: number;
  }>;
  nodeDurationRanking: Array<{
    nodeKey: string;
    nodeName: string;
    role: string;
    avgDurationMs: number;
    runCount: number;
  }>;
  nodeFailureRanking: Array<{
    nodeKey: string;
    nodeName: string;
    role: string;
    failCount: number;
    runCount: number;
    failRate: number;
  }>;
}

export interface RunDiagnosticsView {
  runId: string;
  workflow: {
    workflowId: string | null;
    workflowVersionId: string | null;
  };
  summary: {
    rootCause: string;
    checks: Array<{ id: string; severity: "info" | "warn" | "error"; pass: boolean; message: string }>;
    eventTypeStats: Record<string, number>;
    observability: {
      durationMs?: number;
      llmRequestCount: number;
      llmResponseCount: number;
      tokenStreamCount: number;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      tokenUsageAvailable: boolean;
      toolInvocationCount: number;
      toolSuccessCount: number;
      toolFailureCount: number;
      messageCount: number;
      eventCount: number;
      nodeStatusCounts: Record<string, number>;
      slowestNodes: Array<{ nodeId: string; name: string; durationMs?: number; role: string; status: string }>;
    };
    timeline: {
      runStartedAt?: string;
      runCompletedAt?: string;
      runFailedAt?: string;
    };
  };
  nodes: Array<{
    nodeId: string;
    name: string;
    role: string;
    status: string;
    durationMs?: number;
    execution: {
      provider: string;
      model: string;
      llmRequestCount: number;
      llmResponseCount: number;
      tokenStreamCount: number;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      tokenUsageAvailable: boolean;
      toolInvocationStartedCount: number;
      toolInvocationFailedCount: number;
      toolInvocationSucceededCount: number;
    };
  }>;
}

export interface WorkflowRunPayload {
  nodes: Array<{
    id: string;
    name: string;
    role: AgentNode["role"];
    status?: string;
    taskSummary?: string;
    responsibilitySummary?: string;
    position?: { x: number; y: number };
    width?: number;
    height?: number;
  }>;
  edges: BackendEdge[];
  tasks: Array<{
    id: string;
    title: string;
    status: TaskItem["status"];
    parentTaskId?: string;
    assignedNodeId?: string;
    summary?: string;
  }>;
}

function mapTaskStatus(status: BackendTaskStatus): TaskItem["status"] {
  if (status === "pending") {
    return "ready";
  }
  return status;
}

function mapWorkflowSummary(summary: BackendWorkflowSummary): WorkflowSummaryView {
  return {
    id: summary.id,
    projectId: summary.projectId,
    name: summary.name,
    description: summary.description,
    rootTaskInput: summary.rootTaskInput,
    currentVersionId: summary.currentVersionId,
    currentVersionNumber: summary.currentVersionNumber,
    publishedVersionId: summary.publishedVersionId,
    publishedVersionNumber: summary.publishedVersionNumber,
    versionsCount: summary.versionsCount,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
  };
}

function mapWorkflowVersionSummary(summary: BackendWorkflowVersionSummary): WorkflowVersionSummaryView {
  return {
    id: summary.id,
    workflowId: summary.workflowId,
    versionNumber: summary.versionNumber,
    versionLabel: summary.versionLabel,
    versionNotes: summary.versionNotes,
    createdAt: summary.createdAt,
    publishedAt: summary.publishedAt,
  };
}

export type ToolSourceType = "local_script" | "http_api" | "openclaw";
export type ToolCategory = "search" | "retrieval" | "automation" | "analysis" | "integration" | "custom";
export type ToolScopeType = "agent_role" | "node_instance";

export interface ToolDefinitionView {
  toolId: string;
  name: string;
  description?: string;
  category: ToolCategory;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  sourceType: ToolSourceType;
  sourceConfig: Record<string, unknown>;
  authRequirements: {
    type: "none" | "credential_ref" | "api_key" | "oauth2" | "custom";
    required: boolean;
    fields?: string[];
    description?: string;
  };
  policy: {
    timeoutMs?: number;
    maxRetries?: number;
    retryBackoffMs?: number;
  };
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ToolBindingView {
  id: string;
  scopeType: ToolScopeType;
  scopeId: string;
  toolId: string;
  enabled: boolean;
  priority: number;
  overrideConfig?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ResolvedToolView extends ToolDefinitionView {
  effectiveEnabled: boolean;
  effectivePriority: number;
  resolvedFrom: "platform_pool" | "agent_default" | "node_override";
  effectiveConfig: Record<string, unknown>;
}

export interface ToolValidationResult {
  ok: boolean;
  errors: string[];
}

export interface ToolTestCallResult {
  result: {
    ok: boolean;
    data?: Record<string, unknown>;
    meta?: Record<string, unknown>;
    durationMs: number;
    error?: {
      code: string;
      message: string;
      retriable: boolean;
      source: string;
      details?: Record<string, unknown>;
    };
  };
}

export interface ToolPackageImportResult {
  imported: ToolDefinitionView[];
  generatedTestCases: Array<{
    toolId: string;
    name: string;
    input: Record<string, unknown>;
    expected: {
      ok: boolean;
    };
  }>;
  generatedNodeRegistrations: Array<{
    toolId: string;
    nodeType: string;
    displayName: string;
    category: string;
    defaults: Record<string, unknown>;
  }>;
}

function mapWorkflowDefinition(definition: BackendWorkflowDefinition): WorkflowDefinitionView {
  return {
    ...mapWorkflowSummary(definition),
    versions: (definition.versions ?? []).map(mapWorkflowVersionSummary),
    nodes: definition.nodes.map((node) => ({
      id: node.id,
      name: node.name,
      role: node.role,
      taskSummary: node.taskSummary ?? "",
      responsibilitySummary: node.responsibilitySummary ?? "",
      position: node.position ?? { x: 120, y: 140 },
      width: node.width,
      height: node.height,
    })),
    edges: definition.edges.map((edge) => ({
      id: edge.id,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      type: edge.type,
      condition: edge.condition,
    })),
    tasks: definition.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      parentTaskId: task.parentTaskId,
      assignedNodeId: task.assignedNodeId,
      summary: task.summary ?? "",
    })),
  };
}

export function buildWorkflowPayload(payload: { nodes: AgentNode[]; edges: WorkflowEdge[]; tasks: TaskItem[] }): WorkflowRunPayload {
  return {
    nodes: payload.nodes.map((node) => ({
      id: node.id,
      name: node.name,
      role: node.role,
      status: node.status,
      taskSummary: node.taskSummary,
      responsibilitySummary: node.responsibilitySummary,
      position: node.position,
      width: node.width,
      height: node.height,
    })),
    edges: payload.edges.map((edge) => ({
      id: edge.id,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      type: edge.type,
      condition: edge.condition,
      maxIterations: edge.maxIterations,
      convergenceKeyword: edge.convergenceKeyword,
    })),
    tasks: payload.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      parentTaskId: task.parentTaskId,
      assignedNodeId: task.assignedNodeId,
      summary: task.summary,
    })),
  };
}

async function resolveHttpError(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload?.error) {
      return payload.error;
    }
  } catch {
    // ignore JSON parse error and fallback below
  }
  return `${fallback}（HTTP ${response.status}）`;
}

function mapRunEvent(event: BackendEvent): RunEvent {
  return {
    id: event.id,
    time: event.timestamp,
    type: event.type,
    runEventSeq: event.runEventSeq,
    relatedNodeId: event.relatedNodeId,
    relatedTaskId: event.relatedTaskId,
    message: event.message,
    payload: event.payload,
  };
}

export function mapBackendSnapshot(snapshot: BackendSnapshot): FrontendSnapshot {
  const tasksByNode = new Map(snapshot.tasks.filter((task) => task.assignedNodeId).map((task) => [task.assignedNodeId as string, task]));
  const humanMessagesByNodeId = new Map<string, HumanMessageView[]>();
  for (const item of snapshot.humanMessages ?? []) {
    const list = humanMessagesByNodeId.get(item.targetNodeId) ?? [];
    list.push({
      id: item.id,
      runId: item.runId,
      targetNodeId: item.targetNodeId,
      content: item.content,
      attachments: item.attachments ?? [],
      createdAt: item.createdAt,
    });
    humanMessagesByNodeId.set(item.targetNodeId, list);
  }
  const nodeContextsByNodeId: Record<string, AgentContextView> = {};
  for (const context of snapshot.agentContexts ?? []) {
    nodeContextsByNodeId[context.nodeId] = {
      id: context.id,
      nodeId: context.nodeId,
      systemPrompt: context.systemPrompt,
      taskBrief: context.taskBrief,
      inboundMessages: context.inboundMessages ?? [],
      outboundMessages: context.outboundMessages ?? [],
      resolvedInput: context.resolvedInput,
      humanMessages: humanMessagesByNodeId.get(context.nodeId) ?? [],
      recentOutputs: context.recentOutputs ?? [],
      latestSummary: context.latestSummary,
      updatedAt: context.updatedAt,
    };
  }

  return {
    run: {
      id: snapshot.run.id,
      name: snapshot.run.name,
      status: snapshot.run.status,
      workflowId: snapshot.run.workflowId,
      workflowVersionId: snapshot.run.workflowVersionId,
      startedAt: snapshot.run.startedAt,
      finishedAt: snapshot.run.finishedAt,
      rootTaskId: snapshot.run.rootTaskId,
      output: snapshot.run.output,
      error: snapshot.run.error,
    },
    tasks: snapshot.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: mapTaskStatus(task.status),
      parentTaskId: task.parentTaskId,
      assignedNodeId: task.assignedNodeId,
      summary: task.summary ?? "",
    })),
    nodes: snapshot.nodes.map((node) => ({
      id: node.id,
      name: node.name,
      role: node.role,
      status: node.status,
      taskSummary: tasksByNode.get(node.id)?.summary ?? node.taskBrief ?? "",
      responsibilitySummary: node.responsibility ?? "",
      position: node.position ?? { x: 120, y: 140 },
      width: node.width,
      height: node.height,
      upstreamIds: [],
      downstreamIds: [],
      createdAt: node.createdAt,
      lastUpdatedAt: node.updatedAt,
      blocked: node.status === "waiting",
      retryCount: 0,
      lastError: node.error,
      blockedReason: node.blockedReason,
      executionOrder: node.executionOrder,
      lastInput: node.latestInput,
      lastOutput: node.latestOutput,
      inboundMessages: node.inboundMessages ?? [],
      outboundMessages: node.outboundMessages ?? [],
      resolvedInput: node.resolvedInput,
      taskBrief: node.taskBrief,
      agentDefinitionId: node.agentDefinitionId,
      contextId: node.contextId,
    })),
    edges: snapshot.edges.map((edge) => ({
      id: edge.id,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      type: edge.type,
      condition: edge.condition,
    })),
    messages: snapshot.messages,
    events: snapshot.events.map(mapRunEvent),
    nodeContextsByNodeId,
    output: snapshot.run.output ?? "",
  };
}

export const runtimeClient = {
  async createRun(payload: {
    task: string;
    workflowId?: string;
    workflowVersionId?: string;
    workflow?: WorkflowRunPayload;
  }) {
    const response = await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error("创建运行失败");
    }

    return (await response.json()) as { runId: string };
  },

  async listRuns(input: number | {
    limit?: number;
    status?: "running" | "success" | "failed";
    q?: string;
    workflowId?: string;
    sort?: "time_desc" | "time_asc" | "duration_desc" | "duration_asc" | "tokens_desc" | "tokens_asc";
    runType?: "workflow_run" | "dev_run";
  } = 10) {
    const options = typeof input === "number" ? { limit: input } : input;
    const query = new URLSearchParams();
    query.set("limit", String(options.limit ?? 10));
    if (options.status) {
      query.set("status", options.status);
    }
    if (options.q?.trim()) {
      query.set("q", options.q.trim());
    }
    if (options.workflowId) {
      query.set("workflowId", options.workflowId);
    }
    if (options.sort) {
      query.set("sort", options.sort);
    }
    if (options.runType) {
      query.set("runType", options.runType);
    }
    const response = await fetch(`/api/runs?${query.toString()}`);
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "获取运行记录失败"));
    }
    return (await response.json()) as RunListResponseView;
  },

  async getRunsAnalytics(days = 7, runType?: "workflow_run" | "dev_run") {
    const query = new URLSearchParams();
    query.set("days", String(days));
    if (runType) query.set("runType", runType);
    const response = await fetch(`/api/runs/analytics?${query.toString()}`);
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "获取运行分析失败"));
    }
    return (await response.json()) as { analytics: RunAnalyticsView };
  },

  async listProjectRuns(projectId: string, limit = 20) {
    const response = await fetch(`/api/projects/${projectId}/runs?limit=${limit}`);
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "获取项目运行记录失败"));
    }
    return (await response.json()) as { runs: RunRecordView[] };
  },

  async getProjectRunDetail(projectId: string, runId: string) {
    const response = await fetch(`/api/projects/${projectId}/runs/${runId}`);
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "获取运行详情失败"));
    }
    return (await response.json()) as { run: RunDetailView };
  },

  async listProjectFiles(projectId: string, limit = 200) {
    const response = await fetch(`/api/projects/${projectId}/files?limit=${limit}`);
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "获取项目文件失败"));
    }
    return (await response.json()) as { files: ProjectFileView[] };
  },

  async getProjectFile(projectId: string, fileId: string) {
    const response = await fetch(`/api/projects/${projectId}/files/${fileId}`);
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "获取文件详情失败"));
    }
    return (await response.json()) as { file: ProjectFileView };
  },

  async searchGlobal(query: string, limit = 8) {
    const q = query.trim();
    if (!q) {
      return { projects: [], workflows: [], runs: [], files: [] } satisfies GlobalSearchResultView;
    }
    const response = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=${limit}`);
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "全局搜索失败"));
    }
    return (await response.json()) as GlobalSearchResultView;
  },

  async listNotifications(limit = 20) {
    const response = await fetch(`/api/notifications?limit=${limit}`);
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "获取通知失败"));
    }
    return (await response.json()) as { notifications: NotificationItemView[] };
  },

  async getRunSnapshot(runId: string) {
    const response = await fetch(`/api/runs/${runId}`);
    if (!response.ok) {
      throw new Error("获取运行快照失败");
    }

    const snapshot = (await response.json()) as BackendSnapshot;
    return mapBackendSnapshot(snapshot);
  },

  async startRun(runId: string) {
    const response = await fetch(`/api/runs/${runId}/start`, { method: "POST" });
    if (!response.ok) {
      throw new Error("启动运行失败");
    }

    return (await response.json()) as { ok: true };
  },

  async getNodeAgent(runId: string, nodeId: string): Promise<FrontendNodeAgent> {
    const response = await fetch(`/api/runs/${runId}/nodes/${nodeId}/agent`);
    if (!response.ok) {
      throw new Error("获取节点 Agent 信息失败");
    }

    const payload = (await response.json()) as {
      definition: BackendAgentDefinition;
      context: BackendAgentContext;
    };

    return {
      definition: {
        id: payload.definition.id,
        name: payload.definition.name,
        role: payload.definition.role,
        systemPrompt: payload.definition.systemPrompt,
        responsibility: payload.definition.responsibility,
        inputSchema: payload.definition.inputSchema,
        outputSchema: payload.definition.outputSchema,
        allowHumanInput: payload.definition.allowHumanInput,
        model: payload.definition.model,
        provider: payload.definition.provider,
        temperature: payload.definition.temperature,
      },
      context: {
        id: payload.context.id,
        nodeId: payload.context.nodeId,
        systemPrompt: payload.context.systemPrompt,
        taskBrief: payload.context.taskBrief,
        inboundMessages: payload.context.inboundMessages ?? [],
        outboundMessages: payload.context.outboundMessages ?? [],
        resolvedInput: payload.context.resolvedInput,
        recentOutputs: payload.context.recentOutputs,
        latestSummary: payload.context.latestSummary,
        updatedAt: payload.context.updatedAt,
      },
      humanMessages: payload.context.humanMessages.map((item) => ({
        id: item.id,
        runId: item.runId,
        targetNodeId: item.targetNodeId,
        content: item.content,
        attachments: item.attachments ?? [],
        createdAt: item.createdAt,
      })),
    };
  },

  async sendHumanMessage(
    runId: string,
    nodeId: string,
    content: string,
    attachments?: Array<{ name: string; mimeType: string; content: string }>,
  ) {
    const response = await fetch(`/api/runs/${runId}/nodes/${nodeId}/human-message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, attachments }),
    });
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "发送人工消息失败"));
    }

    return (await response.json()) as { ok: true; humanMessageId: string };
  },

  async rerunFromNode(runId: string, nodeId: string, includeDownstream: boolean) {
    const response = await fetch(`/api/runs/${runId}/nodes/${nodeId}/rerun`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ includeDownstream }),
    });
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "节点重跑失败"));
    }

    return (await response.json()) as { ok: true };
  },

  async getWorkspaceConfig() {
    const response = await fetch("/api/workspace/config");
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "获取工作区配置失败"));
    }
    return (await response.json()) as { workspace: WorkspaceConfigView; credentials: CredentialSummary[] };
  },

  async updateWorkspaceConfig(payload: Partial<WorkspaceConfigView>) {
    const response = await fetch("/api/workspace/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "更新工作区配置失败"));
    }
    return (await response.json()) as { workspace: WorkspaceConfigView };
  },

  async listCredentials() {
    const response = await fetch("/api/credentials");
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "获取凭证列表失败"));
    }
    return (await response.json()) as { credentials: CredentialSummary[] };
  },

  async createCredential(payload: { provider: string; label: string; apiKey: string }) {
    const response = await fetch("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "新增凭证失败"));
    }
    return (await response.json()) as { credentialId: string };
  },

  async getNodeConfig(runId: string, nodeId: string) {
    const response = await fetch(`/api/runs/${runId}/nodes/${nodeId}/config`);
    if (!response.ok) {
      throw new Error("获取节点配置失败");
    }
    return (await response.json()) as { config: NodeConfigView; documents: AgentDocumentView[] };
  },

  async updateNodeConfig(runId: string, nodeId: string, payload: Partial<NodeConfigView>) {
    const response = await fetch(`/api/runs/${runId}/nodes/${nodeId}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error("更新节点配置失败");
    }
    return (await response.json()) as { config: NodeConfigView };
  },

  async uploadNodeDocument(runId: string, nodeId: string, type: AgentDocumentType, file: File) {
    const formData = new FormData();
    formData.append("type", type);
    formData.append("file", file);

    const response = await fetch(`/api/runs/${runId}/nodes/${nodeId}/documents`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      throw new Error("上传文档失败");
    }

    return (await response.json()) as { document: AgentDocumentView };
  },

  async deleteDocument(documentId: string) {
    const response = await fetch(`/api/documents/${documentId}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      throw new Error("删除文档失败");
    }

    return (await response.json()) as { document: AgentDocumentView };
  },

  async listWorkflows() {
    const response = await fetch("/api/workflows");
    if (!response.ok) {
      throw new Error("获取工作流列表失败");
    }
    const payload = (await response.json()) as { workflows: BackendWorkflowSummary[] };
    return { workflows: payload.workflows.map(mapWorkflowSummary) };
  },

  async listProjects(options?: { includeArchived?: boolean }) {
    const query = options?.includeArchived ? "?includeArchived=1" : "";
    const response = await fetch(`/api/projects${query}`);
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "获取项目列表失败"));
    }
    return (await response.json()) as { projects: ProjectSummaryView[] };
  },

  async createProject(payload: { name: string; description?: string }) {
    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "创建项目失败"));
    }
    return (await response.json()) as { project: ProjectSummaryView };
  },

  async deleteProject(projectId: string) {
    const response = await fetch(`/api/projects/${projectId}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "删除项目失败"));
    }
    return (await response.json()) as { projectId: string; deletedWorkflowCount: number };
  },

  async getProject(projectId: string) {
    const response = await fetch(`/api/projects/${projectId}`);
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "获取项目详情失败"));
    }
    return (await response.json()) as { project: ProjectSummaryView };
  },

  async updateProject(
    projectId: string,
    payload: {
      name?: string;
      description?: string;
      archived?: boolean;
      settings?: Partial<ProjectSettingsView>;
    },
  ) {
    const response = await fetch(`/api/projects/${projectId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "更新项目设置失败"));
    }
    return (await response.json()) as { project: ProjectSummaryView };
  },

  async listProjectWorkflows(projectId: string) {
    const response = await fetch(`/api/projects/${projectId}/workflows`);
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "获取项目工作流列表失败"));
    }
    const payload = (await response.json()) as { workflows: BackendWorkflowSummary[] };
    return { workflows: payload.workflows.map(mapWorkflowSummary) };
  },

  async createProjectWorkflow(
    projectId: string,
    payload: {
      name: string;
      description?: string;
      templateId?: string;
      templatePresetTaskId?: string;
      agentTemplateId?: string;
    },
  ) {
    const response = await fetch(`/api/projects/${projectId}/workflows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "创建工作流失败"));
    }
    const result = (await response.json()) as { workflow: BackendWorkflowDefinition };
    return { workflow: mapWorkflowDefinition(result.workflow) };
  },

  async planProjectWorkflowFromSkillPack(
    projectId: string,
    payload: {
      files: File[];
      workflowName?: string;
      workflowDescription?: string;
      preferLlm?: boolean;
    },
  ) {
    const formData = new FormData();
    for (const file of payload.files) {
      formData.append("files", file);
    }
    if (payload.workflowName !== undefined) {
      formData.append("workflowName", payload.workflowName);
    }
    if (payload.workflowDescription !== undefined) {
      formData.append("workflowDescription", payload.workflowDescription);
    }
    if (payload.preferLlm !== undefined) {
      formData.append("preferLlm", payload.preferLlm ? "1" : "0");
    }

    const response = await fetch(`/api/projects/${projectId}/skill-pack/plan`, {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "Skill 包解析失败"));
    }
    return (await response.json()) as SkillPackPlanView;
  },

  async getWorkflow(workflowId: string) {
    const response = await fetch(`/api/workflows/${workflowId}`);
    if (!response.ok) {
      throw new Error("获取工作流详情失败");
    }
    const payload = (await response.json()) as { workflow: BackendWorkflowDefinition };
    return { workflow: mapWorkflowDefinition(payload.workflow) };
  },

  async renameWorkflow(
    workflowId: string,
    payload: { name: string; description?: string; projectId?: string },
  ) {
    const response = await fetch(`/api/workflows/${workflowId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "重命名工作流失败"));
    }
    const result = (await response.json()) as { workflow: BackendWorkflowDefinition };
    return { workflow: mapWorkflowDefinition(result.workflow) };
  },

  async deleteWorkflow(workflowId: string, projectId?: string) {
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    const response = await fetch(`/api/workflows/${workflowId}${query}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "删除工作流失败"));
    }
    return (await response.json()) as { workflowId: string };
  },

  async getWorkflowVersion(workflowId: string, versionId: string) {
    const response = await fetch(`/api/workflows/${workflowId}?versionId=${encodeURIComponent(versionId)}`);
    if (!response.ok) {
      throw new Error("获取工作流详情失败");
    }
    const payload = (await response.json()) as { workflow: BackendWorkflowDefinition };
    return { workflow: mapWorkflowDefinition(payload.workflow) };
  },

  async listWorkflowVersions(workflowId: string) {
    const response = await fetch(`/api/workflows/${workflowId}/versions`);
    if (!response.ok) {
      throw new Error("获取工作流版本列表失败");
    }
    const payload = (await response.json()) as { versions: BackendWorkflowVersionSummary[] };
    return { versions: payload.versions.map(mapWorkflowVersionSummary) };
  },

  async saveWorkflow(payload: {
    workflowId?: string;
    projectId?: string;
    name: string;
    description?: string;
    rootTaskInput?: string;
    versionLabel?: string;
    versionNotes?: string;
    workflow: WorkflowRunPayload;
  }) {
    const response = await fetch("/api/workflows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflowId: payload.workflowId,
        projectId: payload.projectId,
        name: payload.name,
        description: payload.description,
        rootTaskInput: payload.rootTaskInput,
        versionLabel: payload.versionLabel,
        versionNotes: payload.versionNotes,
        nodes: payload.workflow.nodes,
        edges: payload.workflow.edges,
        tasks: payload.workflow.tasks,
      }),
    });
    if (!response.ok) {
      throw new Error("保存工作流失败");
    }

    const result = (await response.json()) as { workflow: BackendWorkflowDefinition };
    return { workflow: mapWorkflowDefinition(result.workflow) };
  },

  async publishWorkflowVersion(workflowId: string, versionId?: string) {
    const response = await fetch(`/api/workflows/${workflowId}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId }),
    });
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "发布工作流版本失败"));
    }
    const result = (await response.json()) as { workflow: BackendWorkflowDefinition };
    return { workflow: mapWorkflowDefinition(result.workflow) };
  },

  async getRunDiagnostics(runId: string) {
    const response = await fetch(`/api/runs/${runId}/diagnostics`);
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "获取运行诊断失败"));
    }
    return (await response.json()) as RunDiagnosticsView;
  },

  async listToolAssets() {
    const response = await fetch("/api/assets/tools");
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "获取工具资产失败"));
    }
    return (await response.json()) as { tools: ToolDefinitionView[] };
  },

  async createToolAsset(payload: Partial<ToolDefinitionView>) {
    const response = await fetch("/api/assets/tools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "创建工具资产失败"));
    }
    return (await response.json()) as { tool: ToolDefinitionView };
  },

  async updateToolAsset(toolId: string, payload: Partial<ToolDefinitionView>) {
    const response = await fetch(`/api/assets/tools/${toolId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "更新工具资产失败"));
    }
    return (await response.json()) as { tool: ToolDefinitionView };
  },

  async deleteToolAsset(toolId: string) {
    const response = await fetch(`/api/assets/tools/${toolId}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "删除工具资产失败"));
    }
    return (await response.json()) as { toolId: string; deletedReferenceCount: number };
  },

  async listModelAssets() {
    const response = await fetch("/api/assets/models");
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "获取模型资产失败"));
    }
    return (await response.json()) as { models: ModelAssetView[] };
  },

  async createModelAsset(payload: {
    name: string;
    provider: string;
    model: string;
    baseUrl?: string;
    credentialId?: string;
    enabled?: boolean;
  }) {
    const response = await fetch("/api/assets/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "创建模型资产失败"));
    }
    return (await response.json()) as { model: ModelAssetView };
  },

  async updateModelAsset(
    modelId: string,
    payload: Partial<{
      name: string;
      provider: string;
      model: string;
      baseUrl: string;
      credentialId: string;
      enabled: boolean;
    }>,
  ) {
    const response = await fetch(`/api/assets/models/${modelId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "更新模型资产失败"));
    }
    return (await response.json()) as { model: ModelAssetView };
  },

  async deleteModelAsset(modelId: string) {
    const response = await fetch(`/api/assets/models/${modelId}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "删除模型资产失败"));
    }
    return (await response.json()) as { id: string };
  },

  async listPromptTemplateAssets(templateType?: "system" | "agent" | "workflow") {
    const query = templateType ? `?templateType=${encodeURIComponent(templateType)}` : "";
    const response = await fetch(`/api/assets/prompts${query}`);
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "获取 Prompt 模板失败"));
    }
    return (await response.json()) as { prompts: PromptTemplateAssetView[] };
  },

  async createPromptTemplateAsset(payload: {
    name: string;
    templateType: "system" | "agent" | "workflow";
    description?: string;
    content: string;
    enabled?: boolean;
  }) {
    const response = await fetch("/api/assets/prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "创建 Prompt 模板失败"));
    }
    return (await response.json()) as { prompt: PromptTemplateAssetView };
  },

  async updatePromptTemplateAsset(
    promptId: string,
    payload: Partial<{
      name: string;
      templateType: "system" | "agent" | "workflow";
      description: string;
      content: string;
      enabled: boolean;
    }>,
  ) {
    const response = await fetch(`/api/assets/prompts/${promptId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "更新 Prompt 模板失败"));
    }
    return (await response.json()) as { prompt: PromptTemplateAssetView };
  },

  async deletePromptTemplateAsset(promptId: string) {
    const response = await fetch(`/api/assets/prompts/${promptId}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "删除 Prompt 模板失败"));
    }
    return (await response.json()) as { id: string };
  },

  async listWorkflowAssetReferences(options?: {
    workflowId?: string;
    assetType?: "tool" | "model" | "prompt_template";
  }) {
    const query = new URLSearchParams();
    if (options?.workflowId) {
      query.set("workflowId", options.workflowId);
    }
    if (options?.assetType) {
      query.set("assetType", options.assetType);
    }
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    const response = await fetch(`/api/assets/references${suffix}`);
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "获取资产引用失败"));
    }
    return (await response.json()) as { references: WorkflowAssetReferenceView[] };
  },

  async upsertWorkflowAssetReference(payload: {
    workflowId: string;
    assetType: "tool" | "model" | "prompt_template";
    assetId: string;
  }) {
    const response = await fetch("/api/assets/references", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "创建资产引用失败"));
    }
    return (await response.json()) as { reference: WorkflowAssetReferenceView };
  },

  async deleteWorkflowAssetReference(referenceId: string) {
    const response = await fetch(`/api/assets/references/${referenceId}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "删除资产引用失败"));
    }
    return (await response.json()) as { id: string };
  },

  async listWorkflowTemplates() {
    const response = await fetch("/api/workflow-templates");
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "获取工作流模板失败"));
    }
    return (await response.json()) as { workflowTemplates: WorkflowTemplateView[] };
  },

  async createWorkflowTemplate(payload: {
    name: string;
    description?: string;
    rootTaskInput?: string;
    nodes?: WorkflowTemplateView["nodes"];
    edges?: WorkflowTemplateView["edges"];
    tasks?: WorkflowTemplateView["tasks"];
    enabled?: boolean;
  }) {
    const response = await fetch("/api/workflow-templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "创建工作流模板失败"));
    }
    return (await response.json()) as { workflowTemplate: WorkflowTemplateView };
  },

  async updateWorkflowTemplate(
    templateId: string,
    payload: Partial<{
      name: string;
      description: string;
      rootTaskInput: string;
      nodes: WorkflowTemplateView["nodes"];
      edges: WorkflowTemplateView["edges"];
      tasks: WorkflowTemplateView["tasks"];
      enabled: boolean;
    }>,
  ) {
    const response = await fetch(`/api/workflow-templates/${templateId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "更新工作流模板失败"));
    }
    return (await response.json()) as { workflowTemplate: WorkflowTemplateView };
  },

  async deleteWorkflowTemplate(templateId: string) {
    const response = await fetch(`/api/workflow-templates/${templateId}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "删除工作流模板失败"));
    }
    return (await response.json()) as { id: string };
  },

  async listAgentTemplates() {
    const response = await fetch("/api/agent-templates");
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "获取 Agent 模板失败"));
    }
    return (await response.json()) as { agentTemplates: AgentTemplateView[] };
  },

  async createAgentTemplate(payload: {
    name: string;
    description?: string;
    role: AgentNode["role"];
    defaultPrompt?: string;
    taskSummary?: string;
    responsibilitySummary?: string;
    enabled?: boolean;
  }) {
    const response = await fetch("/api/agent-templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "创建 Agent 模板失败"));
    }
    return (await response.json()) as { agentTemplate: AgentTemplateView };
  },

  async updateAgentTemplate(
    templateId: string,
    payload: Partial<{
      name: string;
      description: string;
      role: AgentNode["role"];
      defaultPrompt: string;
      taskSummary: string;
      responsibilitySummary: string;
      enabled: boolean;
    }>,
  ) {
    const response = await fetch(`/api/agent-templates/${templateId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "更新 Agent 模板失败"));
    }
    return (await response.json()) as { agentTemplate: AgentTemplateView };
  },

  async deleteAgentTemplate(templateId: string) {
    const response = await fetch(`/api/agent-templates/${templateId}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "删除 Agent 模板失败"));
    }
    return (await response.json()) as { id: string };
  },

  // ── Script Assets ──

  async listScriptAssets() {
    const response = await fetch("/api/assets/scripts");
    if (!response.ok) throw new Error(await resolveHttpError(response, "获取脚本资产失败"));
    return (await response.json()) as { scripts: ScriptAssetView[] };
  },

  async createScriptAsset(payload: {
    name: string;
    localPath: string;
    runCommand: string;
    description?: string;
    parameterSchema?: Record<string, unknown>;
    defaultEnvironmentId?: string;
    enabled?: boolean;
  }) {
    const response = await fetch("/api/assets/scripts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(await resolveHttpError(response, "创建脚本资产失败"));
    return (await response.json()) as { script: ScriptAssetView };
  },

  async updateScriptAsset(
    scriptId: string,
    payload: Partial<{
      name: string;
      description: string;
      localPath: string;
      runCommand: string;
      parameterSchema: Record<string, unknown>;
      defaultEnvironmentId: string;
      enabled: boolean;
    }>,
  ) {
    const response = await fetch(`/api/assets/scripts/${scriptId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(await resolveHttpError(response, "更新脚本资产失败"));
    return (await response.json()) as { script: ScriptAssetView };
  },

  async deleteScriptAsset(scriptId: string) {
    const response = await fetch(`/api/assets/scripts/${scriptId}`, { method: "DELETE" });
    if (!response.ok) throw new Error(await resolveHttpError(response, "删除脚本资产失败"));
    return (await response.json()) as { id: string };
  },

  // ── Skill Assets ──

  async listSkillAssets() {
    const response = await fetch("/api/assets/skills");
    if (!response.ok) throw new Error(await resolveHttpError(response, "获取技能资产失败"));
    return (await response.json()) as { skills: SkillAssetView[] };
  },

  async createSkillAsset(payload: {
    name: string;
    scriptId: string;
    description?: string;
    parameterMapping?: Record<string, string>;
    outputDescription?: string;
    enabled?: boolean;
  }) {
    const response = await fetch("/api/assets/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(await resolveHttpError(response, "创建技能资产失败"));
    return (await response.json()) as { skill: SkillAssetView };
  },

  async updateSkillAsset(
    skillId: string,
    payload: Partial<{
      name: string;
      description: string;
      scriptId: string;
      parameterMapping: Record<string, string>;
      outputDescription: string;
      enabled: boolean;
    }>,
  ) {
    const response = await fetch(`/api/assets/skills/${skillId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(await resolveHttpError(response, "更新技能资产失败"));
    return (await response.json()) as { skill: SkillAssetView };
  },

  async deleteSkillAsset(skillId: string) {
    const response = await fetch(`/api/assets/skills/${skillId}`, { method: "DELETE" });
    if (!response.ok) throw new Error(await resolveHttpError(response, "删除技能资产失败"));
    return (await response.json()) as { id: string };
  },

  // ── Skill Bindings ──

  async listSkillBindings(runId: string, nodeId: string) {
    const response = await fetch(`/api/assets/skill-bindings?runId=${encodeURIComponent(runId)}&nodeId=${encodeURIComponent(nodeId)}`);
    if (!response.ok) throw new Error(await resolveHttpError(response, "获取技能绑定失败"));
    return (await response.json()) as { bindings: SkillBindingView[] };
  },

  async upsertSkillBinding(runId: string, nodeId: string, skillId: string, enabled: boolean) {
    const response = await fetch("/api/assets/skill-bindings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId, nodeId, skillId, enabled }),
    });
    if (!response.ok) throw new Error(await resolveHttpError(response, "保存技能绑定失败"));
    return (await response.json()) as { binding: SkillBindingView };
  },

  async deleteSkillBinding(bindingId: string) {
    const response = await fetch(`/api/assets/skill-bindings?bindingId=${encodeURIComponent(bindingId)}`, { method: "DELETE" });
    if (!response.ok) throw new Error(await resolveHttpError(response, "删除技能绑定失败"));
    return (await response.json()) as { id: string };
  },

  async listTools() {
    // Compatibility alias. Primary path: /api/assets/tools
    return this.listToolAssets();
  },

  async getTool(toolId: string) {
    // Compatibility alias. Primary path: /api/assets/tools/:toolId
    const response = await fetch(`/api/assets/tools/${toolId}`);
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "获取工具详情失败"));
    }
    return (await response.json()) as { tool: ToolDefinitionView };
  },

  async createTool(payload: Partial<ToolDefinitionView>) {
    // Compatibility alias. Primary path: /api/assets/tools
    return this.createToolAsset(payload);
  },

  async updateTool(toolId: string, payload: Partial<ToolDefinitionView>) {
    // Compatibility alias. Primary path: /api/assets/tools/:toolId
    return this.updateToolAsset(toolId, payload);
  },

  async disableTool(toolId: string) {
    // Compatibility alias. Prefer explicit enabled flag under assets path.
    return this.updateToolAsset(toolId, { enabled: false });
  },

  async validateTool(toolId: string) {
    const response = await fetch(`/api/tools/${toolId}/validate`, {
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "校验工具失败"));
    }
    return (await response.json()) as ToolValidationResult;
  },

  async testCallTool(
    toolId: string,
    payload: {
      input?: Record<string, unknown>;
      timeoutMs?: number;
      maxRetries?: number;
    },
  ) {
    const response = await fetch(`/api/tools/${toolId}/test-call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "测试调用工具失败"));
    }
    return (await response.json()) as ToolTestCallResult;
  },

  async importOpenClawTools(payload: {
    tools: Array<{
      id?: string;
      name?: string;
      description?: string;
      category?: ToolCategory;
      inputSchema?: Record<string, unknown>;
      outputSchema?: Record<string, unknown>;
      sourceConfig?: Record<string, unknown>;
      authRequirements?: ToolDefinitionView["authRequirements"];
      policy?: ToolDefinitionView["policy"];
      enabled?: boolean;
    }>;
  }) {
    const response = await fetch("/api/tools/import/openclaw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "导入 OpenClaw 工具失败"));
    }
    return (await response.json()) as { imported: ToolDefinitionView[] };
  },

  async importToolPackage(payload: {
    format: "json" | "yaml" | "zip";
    content: string;
    sourceName?: string;
  }) {
    const response = await fetch("/api/tools/import/package", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "导入 Tool Package 失败"));
    }
    return (await response.json()) as ToolPackageImportResult;
  },

  async listToolBindings(scopeType?: ToolScopeType, scopeId?: string) {
    const query = scopeType && scopeId ? `?scopeType=${scopeType}&scopeId=${encodeURIComponent(scopeId)}` : "";
    const response = await fetch(`/api/tool-bindings${query}`);
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "获取工具绑定失败"));
    }
    return (await response.json()) as { bindings: ToolBindingView[] };
  },

  async replaceToolBindings(
    scopeType: ToolScopeType,
    scopeId: string,
    bindings: Array<{
      toolId: string;
      enabled?: boolean;
      priority?: number;
      overrideConfig?: Record<string, unknown>;
    }>,
  ) {
    const response = await fetch("/api/tool-bindings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scopeType, scopeId, bindings }),
    });
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "更新工具绑定失败"));
    }
    return (await response.json()) as { bindings: ToolBindingView[] };
  },

  async getResolvedNodeTools(runId: string, nodeId: string) {
    const response = await fetch(`/api/runs/${runId}/nodes/${nodeId}/tools`);
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "获取节点工具失败"));
    }
    return (await response.json()) as {
      all: ResolvedToolView[];
      enabled: ResolvedToolView[];
      toolPolicy?: "disabled" | "allowed" | "required";
    };
  },

  connectRunStream(runId: string, onEvent: (event: RunEvent) => void, onError?: (error: Event) => void) {
    let source: EventSource | null = null;
    let reconnectAttempts = 0;
    let closed = false;
    const MAX_RECONNECT = 6;

    const connect = () => {
      if (closed) return;
      source = new EventSource(`/api/runs/${runId}/stream`);

      source.onmessage = (ev) => {
        reconnectAttempts = 0; // 收到消息说明连接正常，重置计数
        try {
          const payload = JSON.parse(ev.data) as { type: string; event?: BackendEvent };
          if (payload.type === "event" && payload.event) {
            onEvent(mapRunEvent(payload.event));
          }
          // heartbeat 不做额外处理，仅用于保活
        } catch {
          // 忽略解析错误
        }
      };

      source.onerror = () => {
        source?.close();
        source = null;
        if (closed) return;

        if (reconnectAttempts < MAX_RECONNECT) {
          // 指数退避：1s / 2s / 4s / 8s / 16s / 30s（上限）
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30_000);
          reconnectAttempts += 1;
          setTimeout(connect, delay);
        } else {
          onError?.(new Event("error"));
        }
      };
    };

    connect();

    return {
      close: () => {
        closed = true;
        source?.close();
        source = null;
      },
    };
  },

  async fetchRunTraces(runId: string, nodeId?: string): Promise<RunTracesView> {
    const url = nodeId
      ? `/api/runs/${runId}/traces?nodeId=${encodeURIComponent(nodeId)}`
      : `/api/runs/${runId}/traces`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(await resolveHttpError(response, "获取调试追踪失败"));
    return response.json();
  },

  async listEvaluationSuites(): Promise<{ suites: EvaluationSuiteView[] }> {
    const response = await fetch("/api/evaluations/suites");
    if (!response.ok) throw new Error(await resolveHttpError(response, "获取评测套件失败"));
    return response.json();
  },

  async createEvaluationSuite(payload: {
    name: string;
    description?: string;
    workflowId?: string;
    workflowVersionId?: string;
    enabled?: boolean;
  }): Promise<{ suite: EvaluationSuiteView }> {
    const response = await fetch("/api/evaluations/suites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(await resolveHttpError(response, "创建评测套件失败"));
    return response.json();
  },

  async listEvaluationCases(suiteId: string): Promise<{ cases: EvaluationCaseView[] }> {
    const response = await fetch(`/api/evaluations/suites/${encodeURIComponent(suiteId)}/cases`);
    if (!response.ok) throw new Error(await resolveHttpError(response, "获取评测用例失败"));
    return response.json();
  },

  async createEvaluationCase(
    suiteId: string,
    payload: {
      name: string;
      taskInput: string;
      replayMode?: "full";
      expectedOutputContains?: string;
      expectedOutputRegex?: string;
      enabled?: boolean;
    },
  ): Promise<{ case: EvaluationCaseView }> {
    const response = await fetch(`/api/evaluations/suites/${encodeURIComponent(suiteId)}/cases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(await resolveHttpError(response, "创建评测用例失败"));
    return response.json();
  },

  async executeEvaluationCase(caseId: string): Promise<{ report: EvaluationExecutionReportView }> {
    const response = await fetch(`/api/evaluations/cases/${encodeURIComponent(caseId)}/execute`, {
      method: "POST",
    });
    if (!response.ok) throw new Error(await resolveHttpError(response, "执行评测用例失败"));
    return response.json();
  },

  async listEvaluationRuns(limit = 50): Promise<{ evaluationRuns: EvaluationRunView[] }> {
    const response = await fetch(`/api/evaluations/runs?limit=${encodeURIComponent(String(limit))}`);
    if (!response.ok) throw new Error(await resolveHttpError(response, "获取评测运行失败"));
    return response.json();
  },

  async getEvaluationRun(evaluationRunId: string): Promise<{ evaluationRun: EvaluationRunView }> {
    const response = await fetch(`/api/evaluations/runs/${encodeURIComponent(evaluationRunId)}`);
    if (!response.ok) throw new Error(await resolveHttpError(response, "获取评测详情失败"));
    return response.json();
  },

  // ── Workspace File API ──

  async listWorkspaceFiles(workspaceId: string): Promise<WorkspaceFileTreeView> {
    const response = await fetch(`/api/workspace/agents/${encodeURIComponent(workspaceId)}/files`);
    if (!response.ok) throw new Error(await resolveHttpError(response, "获取文件列表失败"));
    return response.json();
  },

  async readWorkspaceFile(workspaceId: string, filePath: string): Promise<WorkspaceFileContentView> {
    const response = await fetch(`/api/workspace/agents/${encodeURIComponent(workspaceId)}/files/${filePath}`);
    if (!response.ok) throw new Error(await resolveHttpError(response, "读取文件失败"));
    return response.json();
  },

  async writeWorkspaceFile(workspaceId: string, filePath: string, content: string): Promise<WorkspaceFileView> {
    const response = await fetch(`/api/workspace/agents/${encodeURIComponent(workspaceId)}/files/${filePath}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!response.ok) throw new Error(await resolveHttpError(response, "保存文件失败"));
    return response.json();
  },

  async createWorkspaceFile(workspaceId: string, path: string, content?: string, base64Content?: string): Promise<WorkspaceFileView> {
    const response = await fetch(`/api/workspace/agents/${encodeURIComponent(workspaceId)}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content, base64Content }),
    });
    if (!response.ok) throw new Error(await resolveHttpError(response, "创建文件失败"));
    return response.json();
  },

  async deleteWorkspaceFile(workspaceId: string, filePath: string): Promise<void> {
    const response = await fetch(`/api/workspace/agents/${encodeURIComponent(workspaceId)}/files/${filePath}`, {
      method: "DELETE",
    });
    if (!response.ok) throw new Error(await resolveHttpError(response, "删除文件失败"));
  },

  async runWorkspaceScript(
    workspaceId: string,
    payload: { entryFile?: string; runCommand: string; env?: Record<string, string>; input?: string; environmentId?: string },
  ): Promise<DevWorkspaceRunResult> {
    const response = await fetch(`/api/workspace/agents/${encodeURIComponent(workspaceId)}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(await resolveHttpError(response, "执行脚本失败"));
    return response.json();
  },

  async uploadZip(workspaceId: string, file: Blob): Promise<{ imported: number }> {
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch(`/api/workspace/agents/${encodeURIComponent(workspaceId)}/upload-zip`, {
      method: "POST",
      body: formData,
    });
    if (!response.ok) throw new Error(await resolveHttpError(response, "导入 ZIP 失败"));
    return response.json();
  },

  async uploadInputsZip(workspaceId: string, file: Blob): Promise<{ imported: number }> {
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch(`/api/workspace/agents/${encodeURIComponent(workspaceId)}/inputs-upload-zip`, {
      method: "POST",
      body: formData,
    });
    if (!response.ok) throw new Error(await resolveHttpError(response, "导入 ZIP 到 inputs 失败"));
    return response.json();
  },

  /* ── Environment APIs ── */

  async listEnvironments(): Promise<LocalEnvironmentView[]> {
    const response = await fetch("/api/node/dev/environments");
    if (!response.ok) throw new Error(await resolveHttpError(response, "获取环境列表失败"));
    const data = await response.json();
    return data.environments;
  },

  async refreshEnvironments(): Promise<LocalEnvironmentView[]> {
    const response = await fetch("/api/node/dev/environments", { method: "POST" });
    if (!response.ok) throw new Error(await resolveHttpError(response, "刷新环境列表失败"));
    const data = await response.json();
    return data.environments;
  },

  async testEnvironment(envId: string): Promise<EnvironmentTestResult> {
    const response = await fetch(`/api/node/dev/environments/${encodeURIComponent(envId)}/test`, {
      method: "POST",
    });
    if (!response.ok) throw new Error(await resolveHttpError(response, "测试环境失败"));
    return response.json();
  },

  /* ── Local Project APIs ── */

  async getLocalProjectConfig(workspaceId: string): Promise<LocalProjectConfig | null> {
    const response = await fetch(`/api/workspace/agents/${encodeURIComponent(workspaceId)}/local-project`);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(await resolveHttpError(response, "获取本地工程配置失败"));
    return response.json();
  },

  async saveLocalProjectConfig(
    workspaceId: string,
    config: { localPath: string; entryFile?: string; runCommand?: string; environmentId?: string },
  ): Promise<LocalProjectConfig> {
    const response = await fetch(`/api/workspace/agents/${encodeURIComponent(workspaceId)}/local-project`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    if (!response.ok) throw new Error(await resolveHttpError(response, "保存本地工程配置失败"));
    return response.json();
  },

  async deleteLocalProjectConfig(workspaceId: string): Promise<void> {
    const response = await fetch(`/api/workspace/agents/${encodeURIComponent(workspaceId)}/local-project`, {
      method: "DELETE",
    });
    if (!response.ok) throw new Error(await resolveHttpError(response, "删除本地工程配置失败"));
  },

  async listLocalFiles(workspaceId: string): Promise<{ files: LocalFileInfo[] }> {
    const response = await fetch(`/api/workspace/agents/${encodeURIComponent(workspaceId)}/local-files`);
    if (!response.ok) throw new Error(await resolveHttpError(response, "获取本地文件列表失败"));
    return response.json();
  },

  async readLocalFile(workspaceId: string, filePath: string): Promise<{ content: string; name: string; size: number }> {
    const response = await fetch(
      `/api/workspace/agents/${encodeURIComponent(workspaceId)}/local-files/${filePath}`,
    );
    if (!response.ok) throw new Error(await resolveHttpError(response, "读取本地文件失败"));
    return response.json();
  },

  async writeLocalFile(workspaceId: string, filePath: string, content: string): Promise<LocalFileInfo> {
    const response = await fetch(
      `/api/workspace/agents/${encodeURIComponent(workspaceId)}/local-files/${filePath}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      },
    );
    if (!response.ok) throw new Error(await resolveHttpError(response, "保存本地文件失败"));
    return response.json();
  },

  async createLocalFile(
    workspaceId: string,
    path: string,
    content?: string,
    isDirectory?: boolean,
  ): Promise<LocalFileInfo> {
    const response = await fetch(`/api/workspace/agents/${encodeURIComponent(workspaceId)}/local-files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content, isDirectory }),
    });
    if (!response.ok) throw new Error(await resolveHttpError(response, "创建本地文件失败"));
    return response.json();
  },

  async deleteLocalFile(workspaceId: string, filePath: string): Promise<void> {
    const response = await fetch(
      `/api/workspace/agents/${encodeURIComponent(workspaceId)}/local-files/${filePath}`,
      { method: "DELETE" },
    );
    if (!response.ok) throw new Error(await resolveHttpError(response, "删除本地文件失败"));
  },

  async runLocalScript(
    workspaceId: string,
    payload: { entryFile?: string; runCommand: string; input?: string; environmentId?: string },
  ): Promise<DevWorkspaceRunResult> {
    const response = await fetch(`/api/workspace/agents/${encodeURIComponent(workspaceId)}/local-run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(await resolveHttpError(response, "执行本地脚本失败"));
    return response.json();
  },

  // ── Dev Run (开发台) ──

  async listWorkspaces() {
    const response = await fetch("/api/agent-dev");
    if (!response.ok) throw new Error(await resolveHttpError(response, "获取工作台列表失败"));
    return (await response.json()) as { workspaces: Array<{ id: string; localPath?: string; entryFile?: string; runCommand?: string }> };
  },

  async createWorkspace(payload: { localPath?: string; entryFile?: string; runCommand?: string }) {
    const response = await fetch("/api/agent-dev", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(await resolveHttpError(response, "创建工作台失败"));
    return (await response.json()) as { workspace: { id: string; localPath?: string; entryFile?: string; runCommand?: string } };
  },

  async deleteWorkspace(workspaceId: string) {
    const response = await fetch(`/api/agent-dev?workspaceId=${encodeURIComponent(workspaceId)}`, { method: "DELETE" });
    if (!response.ok) throw new Error(await resolveHttpError(response, "删除工作台失败"));
    return (await response.json()) as { ok: boolean };
  },

  async updateWorkspace(workspaceId: string, payload: { localPath?: string; entryFile?: string; runCommand?: string }) {
    const response = await fetch("/api/agent-dev", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, ...payload }),
    });
    if (!response.ok) throw new Error(await resolveHttpError(response, "更新工作台失败"));
    return (await response.json()) as { workspace: { id: string; localPath?: string; entryFile?: string; runCommand?: string } };
  },

  async createDevRun(
    workspaceId: string,
    payload: { runCommand: string; entryFile?: string; environmentId?: string },
  ): Promise<DevRunResultView> {
    const response = await fetch(`/api/agent-dev/${encodeURIComponent(workspaceId)}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(await resolveHttpError(response, "开发运行失败"));
    return response.json();
  },

  async listDevRuns(limit = 20) {
    const response = await fetch(`/api/agent-dev/runs?limit=${limit}`);
    if (!response.ok) throw new Error(await resolveHttpError(response, "获取开发运行记录失败"));
    return (await response.json()) as {
      runs: Array<{
        id: string; name: string; status: string; runType: string; createdAt: string;
        startedAt?: string; finishedAt?: string;
        workspaceId?: string; entryFile?: string; runCommand?: string; exitCode?: number; durationMs?: number;
      }>
    };
  },

  async getDevRunDetail(runId: string) {
    const response = await fetch(`/api/agent-dev/runs?runId=${encodeURIComponent(runId)}`);
    if (!response.ok) throw new Error(await resolveHttpError(response, "获取开发运行详情失败"));
    return (await response.json()) as { detail: DevRunDetailView | null };
  },
};
