import { db } from "@/server/persistence/sqlite";
import {
  AgentContext,
  AgentDefinition,
  AgentNode,
  DevRunDetail,
  Event,
  HumanMessage,
  Message,
  NodeTrace,
  PromptTrace,
  Run,
  StateTrace,
  Task,
  ToolTrace,
  WorkflowEdge,
} from "@/server/domain";

export interface RunSnapshot {
  run: Run;
  tasks: Task[];
  nodes: AgentNode[];
  edges: WorkflowEdge[];
  messages: Message[];
  events: Event[];
  agentDefinitions: AgentDefinition[];
  agentContexts: AgentContext[];
  humanMessages: HumanMessage[];
}

// Events too frequent or large to persist individually
const SKIP_PERSIST_EVENTS = new Set(["token_stream", "agent_context_updated"]);

// --- Compact helpers ---
function j(v: unknown): string { return JSON.stringify(v ?? null); }
function p<T>(s: unknown): T { return JSON.parse(typeof s === "string" ? s : "null") as T; }
function str(v: unknown): string | undefined { return typeof v === "string" && v ? v : undefined; }
function num(v: unknown): number | undefined { return typeof v === "number" ? v : undefined; }
function bool(v: unknown): boolean { return v === 1 || v === true; }

type Row = Record<string, unknown>;

// --- Row → domain mappers ---
function toRun(r: Row): Run {
  return {
    id: r.run_id as string, name: r.name as string, rootTaskId: r.root_task_id as string,
    status: r.status as Run["status"], createdAt: r.created_at as string,
    runMode: (str(r.run_mode) as Run["runMode"] | undefined) ?? "standard",
    runType: (str(r.run_type) as Run["runType"] | undefined) ?? "workflow_run",
    workflowId: str(r.workflow_id),
    workflowVersionId: str(r.workflow_version_id),
    taskInput: str(r.task_input),
    memoryIsolationMode: (str(r.memory_isolation_mode) as Run["memoryIsolationMode"] | undefined) ?? "default",
    startedAt: str(r.started_at), finishedAt: str(r.finished_at),
    output: str(r.output), error: str(r.error),
  };
}
function toTask(r: Row): Task {
  return {
    id: r.id as string, runId: r.run_id as string, title: r.title as string,
    summary: str(r.summary), parentTaskId: str(r.parent_task_id),
    assignedNodeId: str(r.assigned_node_id), status: r.status as Task["status"],
  };
}
function toNode(r: Row): AgentNode {
  return {
    id: r.id as string, runId: r.run_id as string, name: r.name as string,
    role: r.role as AgentNode["role"], status: r.status as AgentNode["status"],
    taskId: str(r.task_id), parentNodeId: str(r.parent_node_id),
    position: p<{ x: number; y: number } | null>(r.position_json) ?? undefined,
    width: num(r.width),
    height: num(r.height),
    responsibility: str(r.responsibility), taskBrief: str(r.task_brief),
    latestInput: str(r.latest_input), latestOutput: str(r.latest_output),
    inboundMessages: p<Message[]>(r.inbound_messages_json) ?? [],
    outboundMessages: p<Message[]>(r.outbound_messages_json) ?? [],
    resolvedInput: str(r.resolved_input), error: str(r.error),
    blockedReason: str(r.blocked_reason), executionOrder: num(r.execution_order),
    createdAt: r.created_at as string, updatedAt: r.updated_at as string,
    agentDefinitionId: r.agent_definition_id as string, contextId: str(r.context_id),
  };
}
function toEdge(r: Row): WorkflowEdge {
  return {
    id: r.id as string, runId: r.run_id as string,
    sourceNodeId: r.source_node_id as string, targetNodeId: r.target_node_id as string,
    type: r.type as WorkflowEdge["type"],
    condition: str(r.condition),
    maxIterations: typeof r.max_iterations === "number" ? r.max_iterations : undefined,
    convergenceKeyword: str(r.convergence_keyword),
  } as WorkflowEdge;
}
function toMessage(r: Row): Message {
  return {
    id: r.id as string, runId: r.run_id as string,
    fromNodeId: r.from_node_id as string, toNodeId: r.to_node_id as string,
    type: r.type as Message["type"], content: r.content as string,
    payload: p<Message["payload"]>(r.payload_json) ?? undefined,
    createdAt: r.created_at as string,
  };
}
function toEvent(r: Row): Event {
  return {
    id: r.id as string, runId: r.run_id as string, type: r.type as Event["type"],
    timestamp: r.timestamp as string, runEventSeq: num(r.run_event_seq),
    relatedNodeId: str(r.related_node_id), relatedTaskId: str(r.related_task_id),
    message: r.message as string, payload: p<Event["payload"]>(r.payload_json) ?? undefined,
  };
}
function toDefinition(r: Row): AgentDefinition {
  return {
    id: r.id as string, runId: r.run_id as string, name: r.name as string,
    role: r.role as AgentDefinition["role"], systemPrompt: (r.system_prompt as string) ?? "",
    responsibility: (r.responsibility as string) ?? "", inputSchema: str(r.input_schema),
    outputSchema: str(r.output_schema), allowHumanInput: bool(r.allow_human_input),
    model: str(r.model), temperature: num(r.temperature), provider: str(r.provider),
    createdAt: r.created_at as string, updatedAt: r.updated_at as string,
  };
}
function toContext(r: Row): AgentContext {
  return {
    id: r.id as string, nodeId: r.node_id as string, runId: r.run_id as string,
    systemPrompt: (r.system_prompt as string) ?? "", taskBrief: str(r.task_brief),
    inboundMessages: p<Message[]>(r.inbound_messages_json) ?? [],
    outboundMessages: p<Message[]>(r.outbound_messages_json) ?? [],
    resolvedInput: str(r.resolved_input),
    humanMessages: p<HumanMessage[]>(r.human_messages_json) ?? [],
    recentOutputs: p<string[]>(r.recent_outputs_json) ?? [],
    latestSummary: str(r.latest_summary), updatedAt: r.updated_at as string,
  };
}
function toHumanMessage(r: Row): HumanMessage {
  return {
    id: r.id as string, runId: r.run_id as string, targetNodeId: r.target_node_id as string,
    content: r.content as string,
    attachments: p<HumanMessage["attachments"]>(r.attachments_json) ?? [],
    createdAt: r.created_at as string,
  };
}

// --- Trace row mappers ---
function toNodeTrace(r: Row): NodeTrace {
  return {
    id: r.id as string, runId: r.run_id as string, nodeId: r.node_id as string,
    executionId: r.execution_id as string, attempt: (r.attempt as number) ?? 1,
    status: r.status as NodeTrace["status"], role: r.role as string,
    startedAt: r.started_at as string, finishedAt: str(r.finished_at),
    durationMs: num(r.duration_ms), resolvedInput: str(r.resolved_input),
    latestOutput: str(r.latest_output), error: str(r.error),
    provider: str(r.provider), model: str(r.model),
    llmRoundCount: (r.llm_round_count as number) ?? 0, toolCallCount: (r.tool_call_count as number) ?? 0,
    promptTokens: num(r.prompt_tokens), completionTokens: num(r.completion_tokens),
    totalTokens: num(r.total_tokens), createdAt: r.created_at as string,
  };
}
function toPromptTrace(r: Row): PromptTrace {
  return {
    id: r.id as string, runId: r.run_id as string, nodeId: r.node_id as string,
    executionId: r.execution_id as string, round: (r.round as number) ?? 0,
    provider: str(r.provider), model: str(r.model),
    systemPrompt: str(r.system_prompt), userPrompt: str(r.user_prompt),
    messageHistoryJson: str(r.message_history_json), toolsJson: str(r.tools_json),
    completion: str(r.completion),
    promptTokens: num(r.prompt_tokens), completionTokens: num(r.completion_tokens),
    totalTokens: num(r.total_tokens), statusCode: num(r.status_code),
    error: str(r.error), startedAt: r.started_at as string,
    finishedAt: str(r.finished_at), durationMs: num(r.duration_ms),
    createdAt: r.created_at as string,
  };
}
function toToolTrace(r: Row): ToolTrace {
  return {
    id: r.id as string, runId: r.run_id as string, nodeId: r.node_id as string,
    executionId: r.execution_id as string, round: (r.round as number) ?? 0,
    toolId: str(r.tool_id), toolName: str(r.tool_name), sourceType: str(r.source_type),
    status: r.status as ToolTrace["status"],
    inputJson: str(r.input_json), outputJson: str(r.output_json), errorJson: str(r.error_json),
    startedAt: r.started_at as string, finishedAt: str(r.finished_at),
    durationMs: num(r.duration_ms), createdAt: r.created_at as string,
  };
}
function toStateTrace(r: Row): StateTrace {
  return {
    id: r.id as string, runId: r.run_id as string, nodeId: r.node_id as string,
    executionId: r.execution_id as string,
    checkpoint: r.checkpoint as StateTrace["checkpoint"],
    nodeStatus: str(r.node_status), contextSnapshotJson: str(r.context_snapshot_json),
    metadataJson: str(r.metadata_json), createdAt: r.created_at as string,
  };
}

// --- Prepared statements (created once at module load) ---
const stmts = {
  upsertRun: db.prepare(`
    INSERT INTO run_snapshot(run_id,status,run_mode,run_type,name,root_task_id,workflow_id,workflow_version_id,task_input,memory_isolation_mode,created_at,started_at,finished_at,output,error)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(run_id) DO UPDATE SET
      run_mode=excluded.run_mode,run_type=excluded.run_type,
      workflow_id=excluded.workflow_id,workflow_version_id=excluded.workflow_version_id,
      task_input=excluded.task_input,memory_isolation_mode=excluded.memory_isolation_mode,
      status=excluded.status,started_at=excluded.started_at,finished_at=excluded.finished_at,
      output=excluded.output,error=excluded.error`),
  upsertTask: db.prepare(`
    INSERT INTO run_task(id,run_id,title,summary,parent_task_id,assigned_node_id,status)
    VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET status=excluded.status,assigned_node_id=excluded.assigned_node_id`),
  upsertNode: db.prepare(`
    INSERT INTO run_node(id,run_id,name,role,status,task_id,parent_node_id,position_json,width,height,responsibility,
      task_brief,latest_input,latest_output,inbound_messages_json,outbound_messages_json,resolved_input,
      error,blocked_reason,execution_order,created_at,updated_at,agent_definition_id,context_id)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,status=excluded.status,task_id=excluded.task_id,
      position_json=excluded.position_json,width=excluded.width,height=excluded.height,responsibility=excluded.responsibility,
      task_brief=excluded.task_brief,latest_input=excluded.latest_input,
      latest_output=excluded.latest_output,inbound_messages_json=excluded.inbound_messages_json,
      outbound_messages_json=excluded.outbound_messages_json,resolved_input=excluded.resolved_input,
      error=excluded.error,blocked_reason=excluded.blocked_reason,
      execution_order=excluded.execution_order,updated_at=excluded.updated_at,context_id=excluded.context_id`),
  insertEdge: db.prepare(`
    INSERT OR IGNORE INTO run_edge(id,run_id,source_node_id,target_node_id,type,condition,max_iterations,convergence_keyword)
    VALUES(?,?,?,?,?,?,?,?)`),
  deleteEdges: db.prepare(`DELETE FROM run_edge WHERE run_id=?`),
  insertMessage: db.prepare(`
    INSERT OR IGNORE INTO run_message(id,run_id,from_node_id,to_node_id,type,content,payload_json,created_at)
    VALUES(?,?,?,?,?,?,?,?)`),
  insertEvent: db.prepare(`
    INSERT OR IGNORE INTO run_event(id,run_id,type,timestamp,run_event_seq,related_node_id,related_task_id,message,payload_json)
    VALUES(?,?,?,?,?,?,?,?,?)`),
  upsertDef: db.prepare(`
    INSERT INTO run_agent_definition(id,run_id,name,role,system_prompt,responsibility,input_schema,
      output_schema,allow_human_input,model,temperature,provider,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,system_prompt=excluded.system_prompt,responsibility=excluded.responsibility,
      model=excluded.model,temperature=excluded.temperature,provider=excluded.provider,updated_at=excluded.updated_at`),
  upsertCtx: db.prepare(`
    INSERT INTO run_agent_context(id,node_id,run_id,system_prompt,task_brief,inbound_messages_json,
      outbound_messages_json,resolved_input,human_messages_json,recent_outputs_json,latest_summary,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      system_prompt=excluded.system_prompt,task_brief=excluded.task_brief,
      inbound_messages_json=excluded.inbound_messages_json,outbound_messages_json=excluded.outbound_messages_json,
      resolved_input=excluded.resolved_input,human_messages_json=excluded.human_messages_json,
      recent_outputs_json=excluded.recent_outputs_json,latest_summary=excluded.latest_summary,updated_at=excluded.updated_at`),
  insertHm: db.prepare(`
    INSERT OR IGNORE INTO run_human_message(id,run_id,target_node_id,content,attachments_json,created_at)
    VALUES(?,?,?,?,?,?)`),
  // ── Trace tables ──
  insertNodeTrace: db.prepare(`
    INSERT OR IGNORE INTO run_node_trace(id,run_id,node_id,execution_id,attempt,status,role,started_at,finished_at,duration_ms,
      resolved_input,latest_output,error,provider,model,llm_round_count,tool_call_count,prompt_tokens,completion_tokens,total_tokens,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
  updateNodeTrace: db.prepare(`
    UPDATE run_node_trace SET status=?,finished_at=?,duration_ms=?,resolved_input=?,latest_output=?,error=?,
      llm_round_count=?,tool_call_count=?,prompt_tokens=?,completion_tokens=?,total_tokens=?
    WHERE id=?`),
  insertPromptTrace: db.prepare(`
    INSERT OR IGNORE INTO run_prompt_trace(id,run_id,node_id,execution_id,round,provider,model,system_prompt,user_prompt,
      message_history_json,tools_json,completion,prompt_tokens,completion_tokens,total_tokens,status_code,error,started_at,finished_at,duration_ms,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
  updatePromptTrace: db.prepare(`
    UPDATE run_prompt_trace SET completion=?,prompt_tokens=?,completion_tokens=?,total_tokens=?,status_code=?,error=?,finished_at=?,duration_ms=?
    WHERE id=?`),
  insertToolTrace: db.prepare(`
    INSERT OR IGNORE INTO run_tool_trace(id,run_id,node_id,execution_id,round,tool_id,tool_name,source_type,status,
      input_json,output_json,error_json,started_at,finished_at,duration_ms,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
  updateToolTrace: db.prepare(`
    UPDATE run_tool_trace SET status=?,output_json=?,error_json=?,finished_at=?,duration_ms=?
    WHERE id=?`),
  insertStateTrace: db.prepare(`
    INSERT OR IGNORE INTO run_state_trace(id,run_id,node_id,execution_id,checkpoint,node_status,context_snapshot_json,metadata_json,created_at)
    VALUES(?,?,?,?,?,?,?,?,?)`),
};

function dbNode(n: AgentNode) {
  stmts.upsertNode.run(
    n.id, n.runId, n.name, n.role, n.status, n.taskId ?? null, n.parentNodeId ?? null,
    j(n.position ?? null), n.width ?? null, n.height ?? null, n.responsibility ?? null, n.taskBrief ?? null,
    n.latestInput ?? null, n.latestOutput ?? null,
    j(n.inboundMessages), j(n.outboundMessages),
    n.resolvedInput ?? null, n.error ?? null, n.blockedReason ?? null,
    n.executionOrder ?? null, n.createdAt, n.updatedAt,
    n.agentDefinitionId, n.contextId ?? null,
  );
}
function dbDef(d: AgentDefinition) {
  stmts.upsertDef.run(
    d.id, d.runId, d.name, d.role, d.systemPrompt ?? null, d.responsibility ?? null,
    d.inputSchema ?? null, d.outputSchema ?? null, d.allowHumanInput ? 1 : 0,
    d.model ?? null, d.temperature ?? null, d.provider ?? null, d.createdAt, d.updatedAt,
  );
}
function dbCtx(c: AgentContext) {
  stmts.upsertCtx.run(
    c.id, c.nodeId, c.runId, c.systemPrompt ?? null, c.taskBrief ?? null,
    j(c.inboundMessages), j(c.outboundMessages), c.resolvedInput ?? null,
    j(c.humanMessages), j(c.recentOutputs), c.latestSummary ?? null, c.updatedAt,
  );
}
function dbEdge(e: WorkflowEdge) {
  stmts.insertEdge.run(e.id, e.runId, e.sourceNodeId, e.targetNodeId, e.type, e.condition ?? null, e.maxIterations ?? null, e.convergenceKeyword ?? null);
}

class MemoryStore {
  private runs = new Map<string, Run>();
  private tasks = new Map<string, Task[]>();
  private nodes = new Map<string, AgentNode[]>();
  private edges = new Map<string, WorkflowEdge[]>();
  private messages = new Map<string, Message[]>();
  private events = new Map<string, Event[]>();
  private definitions = new Map<string, AgentDefinition[]>();
  private contexts = new Map<string, AgentContext[]>();
  private humanMessages = new Map<string, HumanMessage[]>();
  private dbAttempted = new Set<string>();

  private tryLoadFromDb(runId: string): void {
    const runRow = db.prepare("SELECT * FROM run_snapshot WHERE run_id=?").get(runId) as Row | undefined;
    if (!runRow) return;
    this.runs.set(runId, toRun(runRow));
    this.tasks.set(runId, (db.prepare("SELECT * FROM run_task WHERE run_id=?").all(runId) as Row[]).map(toTask));
    this.nodes.set(runId, (db.prepare("SELECT * FROM run_node WHERE run_id=?").all(runId) as Row[]).map(toNode));
    this.edges.set(runId, (db.prepare("SELECT * FROM run_edge WHERE run_id=?").all(runId) as Row[]).map(toEdge));
    this.messages.set(runId, (db.prepare("SELECT * FROM run_message WHERE run_id=? ORDER BY rowid").all(runId) as Row[]).map(toMessage));
    this.events.set(runId, (db.prepare("SELECT * FROM run_event WHERE run_id=? ORDER BY run_event_seq").all(runId) as Row[]).map(toEvent));
    this.definitions.set(runId, (db.prepare("SELECT * FROM run_agent_definition WHERE run_id=?").all(runId) as Row[]).map(toDefinition));
    this.contexts.set(runId, (db.prepare("SELECT * FROM run_agent_context WHERE run_id=?").all(runId) as Row[]).map(toContext));
    this.humanMessages.set(runId, (db.prepare("SELECT * FROM run_human_message WHERE run_id=? ORDER BY rowid").all(runId) as Row[]).map(toHumanMessage));
  }

  private ensureLoaded(runId: string): void {
    if (this.runs.has(runId) || this.dbAttempted.has(runId)) return;
    this.dbAttempted.add(runId);
    this.tryLoadFromDb(runId);
  }

  createRunSnapshot(snapshot: RunSnapshot) {
    const runId = snapshot.run.id;
    this.dbAttempted.add(runId);
    this.runs.set(runId, snapshot.run);
    this.tasks.set(runId, snapshot.tasks);
    this.nodes.set(runId, snapshot.nodes);
    this.edges.set(runId, snapshot.edges);
    this.messages.set(runId, snapshot.messages);
    this.events.set(runId, snapshot.events);
    this.definitions.set(runId, snapshot.agentDefinitions);
    this.contexts.set(runId, snapshot.agentContexts);
    this.humanMessages.set(runId, snapshot.humanMessages);

    db.exec("BEGIN");
    try {
      stmts.upsertRun.run(
        runId,
        snapshot.run.status,
        snapshot.run.runMode,
        snapshot.run.runType ?? "workflow_run",
        snapshot.run.name,
        snapshot.run.rootTaskId,
        snapshot.run.workflowId ?? null,
        snapshot.run.workflowVersionId ?? null,
        snapshot.run.taskInput ?? null,
        snapshot.run.memoryIsolationMode ?? "default",
        snapshot.run.createdAt,
        snapshot.run.startedAt ?? null,
        snapshot.run.finishedAt ?? null,
        snapshot.run.output ?? null,
        snapshot.run.error ?? null,
      );
      for (const t of snapshot.tasks) stmts.upsertTask.run(t.id, t.runId, t.title, t.summary ?? null, t.parentTaskId ?? null, t.assignedNodeId ?? null, t.status);
      for (const n of snapshot.nodes) dbNode(n);
      stmts.deleteEdges.run(runId);
      for (const e of snapshot.edges) dbEdge(e);
      for (const d of snapshot.agentDefinitions) dbDef(d);
      for (const c of snapshot.agentContexts) dbCtx(c);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  getRun(runId: string) {
    this.ensureLoaded(runId);
    return this.runs.get(runId);
  }

  updateRun(runId: string, updater: (run: Run) => Run) {
    const current = this.getRun(runId);
    if (!current) return;
    const updated = updater(current);
    this.runs.set(runId, updated);
    stmts.upsertRun.run(
      updated.id,
      updated.status,
      updated.runMode,
      updated.runType ?? "workflow_run",
      updated.name,
      updated.rootTaskId,
      updated.workflowId ?? null,
      updated.workflowVersionId ?? null,
      updated.taskInput ?? null,
      updated.memoryIsolationMode ?? "default",
      updated.createdAt,
      updated.startedAt ?? null,
      updated.finishedAt ?? null,
      updated.output ?? null,
      updated.error ?? null,
    );
  }

  getTasks(runId: string) {
    this.ensureLoaded(runId);
    return this.tasks.get(runId) ?? [];
  }

  replaceTasks(runId: string, tasks: Task[]) {
    this.tasks.set(runId, tasks);
    for (const t of tasks) stmts.upsertTask.run(t.id, t.runId, t.title, t.summary ?? null, t.parentTaskId ?? null, t.assignedNodeId ?? null, t.status);
  }

  updateTask(runId: string, taskId: string, updater: (task: Task) => Task) {
    const tasks = this.getTasks(runId).map((t) => (t.id === taskId ? updater(t) : t));
    this.tasks.set(runId, tasks);
    const updated = tasks.find((t) => t.id === taskId);
    if (updated) stmts.upsertTask.run(updated.id, updated.runId, updated.title, updated.summary ?? null, updated.parentTaskId ?? null, updated.assignedNodeId ?? null, updated.status);
  }

  getNodes(runId: string) {
    this.ensureLoaded(runId);
    return this.nodes.get(runId) ?? [];
  }

  replaceNodes(runId: string, nodes: AgentNode[]) {
    this.nodes.set(runId, nodes);
    for (const n of nodes) dbNode(n);
  }

  updateNode(runId: string, nodeId: string, updater: (node: AgentNode) => AgentNode) {
    const nodes = this.getNodes(runId).map((n) => (n.id === nodeId ? updater(n) : n));
    this.nodes.set(runId, nodes);
    const updated = nodes.find((n) => n.id === nodeId);
    if (updated) dbNode(updated);
  }

  getNodeById(runId: string, nodeId: string) {
    return this.getNodes(runId).find((n) => n.id === nodeId);
  }

  getEdges(runId: string) {
    this.ensureLoaded(runId);
    return this.edges.get(runId) ?? [];
  }

  replaceEdges(runId: string, edges: WorkflowEdge[]) {
    this.edges.set(runId, edges);
    stmts.deleteEdges.run(runId);
    for (const e of edges) dbEdge(e);
  }

  getMessages(runId: string) {
    this.ensureLoaded(runId);
    return this.messages.get(runId) ?? [];
  }

  appendMessage(runId: string, message: Message) {
    this.messages.set(runId, [...this.getMessages(runId), message]);
    stmts.insertMessage.run(message.id, message.runId, message.fromNodeId, message.toNodeId, message.type, message.content, j(message.payload ?? null), message.createdAt);
  }

  getEvents(runId: string) {
    this.ensureLoaded(runId);
    return this.events.get(runId) ?? [];
  }

  appendEvent(runId: string, event: Event) {
    this.events.set(runId, [...this.getEvents(runId), event]);
    if (!SKIP_PERSIST_EVENTS.has(event.type)) {
      stmts.insertEvent.run(event.id, event.runId, event.type, event.timestamp, event.runEventSeq ?? null, event.relatedNodeId ?? null, event.relatedTaskId ?? null, event.message, j(event.payload ?? null));
    }
  }

  getAgentDefinitions(runId: string) {
    this.ensureLoaded(runId);
    return this.definitions.get(runId) ?? [];
  }

  getAgentDefinition(runId: string, definitionId: string) {
    return this.getAgentDefinitions(runId).find((d) => d.id === definitionId);
  }

  replaceAgentDefinitions(runId: string, definitions: AgentDefinition[]) {
    this.definitions.set(runId, definitions);
    for (const d of definitions) dbDef(d);
  }

  getAgentContexts(runId: string) {
    this.ensureLoaded(runId);
    return this.contexts.get(runId) ?? [];
  }

  getAgentContextByNode(runId: string, nodeId: string) {
    return this.getAgentContexts(runId).find((c) => c.nodeId === nodeId);
  }

  updateAgentContext(runId: string, contextId: string, updater: (context: AgentContext) => AgentContext) {
    const list = this.getAgentContexts(runId).map((c) => (c.id === contextId ? updater(c) : c));
    this.contexts.set(runId, list);
    const updated = list.find((c) => c.id === contextId);
    if (updated) dbCtx(updated);
  }

  replaceAgentContexts(runId: string, contexts: AgentContext[]) {
    this.contexts.set(runId, contexts);
    for (const c of contexts) dbCtx(c);
  }

  getHumanMessages(runId: string) {
    this.ensureLoaded(runId);
    return this.humanMessages.get(runId) ?? [];
  }

  appendHumanMessage(runId: string, humanMessage: HumanMessage) {
    this.humanMessages.set(runId, [...this.getHumanMessages(runId), humanMessage]);
    stmts.insertHm.run(humanMessage.id, humanMessage.runId, humanMessage.targetNodeId, humanMessage.content, j(humanMessage.attachments ?? []), humanMessage.createdAt);
  }

  getRunSnapshot(runId: string): RunSnapshot | null {
    const run = this.getRun(runId);
    if (!run) return null;
    return {
      run,
      tasks: this.getTasks(runId),
      nodes: this.getNodes(runId),
      edges: this.getEdges(runId),
      messages: this.getMessages(runId),
      events: this.getEvents(runId),
      agentDefinitions: this.getAgentDefinitions(runId),
      agentContexts: this.getAgentContexts(runId),
      humanMessages: this.getHumanMessages(runId),
    };
  }

  // ── Trace methods (write-only during execution, read for debug UI) ──

  insertNodeTrace(t: NodeTrace) {
    stmts.insertNodeTrace.run(
      t.id, t.runId, t.nodeId, t.executionId, t.attempt, t.status, t.role,
      t.startedAt, t.finishedAt ?? null, t.durationMs ?? null,
      t.resolvedInput ?? null, t.latestOutput ?? null, t.error ?? null,
      t.provider ?? null, t.model ?? null, t.llmRoundCount, t.toolCallCount,
      t.promptTokens ?? null, t.completionTokens ?? null, t.totalTokens ?? null, t.createdAt,
    );
  }

  updateNodeTrace(id: string, patch: Partial<Pick<NodeTrace, "status" | "finishedAt" | "durationMs" | "resolvedInput" | "latestOutput" | "error" | "llmRoundCount" | "toolCallCount" | "promptTokens" | "completionTokens" | "totalTokens">>) {
    const existing = (db.prepare("SELECT * FROM run_node_trace WHERE id=?").get(id) as Row | undefined);
    if (!existing) return;
    stmts.updateNodeTrace.run(
      patch.status ?? existing.status, patch.finishedAt ?? existing.finished_at ?? null,
      patch.durationMs ?? existing.duration_ms ?? null,
      patch.resolvedInput ?? existing.resolved_input ?? null,
      patch.latestOutput ?? existing.latest_output ?? null,
      patch.error ?? existing.error ?? null,
      patch.llmRoundCount ?? existing.llm_round_count ?? 0,
      patch.toolCallCount ?? existing.tool_call_count ?? 0,
      patch.promptTokens ?? existing.prompt_tokens ?? null,
      patch.completionTokens ?? existing.completion_tokens ?? null,
      patch.totalTokens ?? existing.total_tokens ?? null,
      id,
    );
  }

  insertPromptTrace(t: PromptTrace) {
    stmts.insertPromptTrace.run(
      t.id, t.runId, t.nodeId, t.executionId, t.round,
      t.provider ?? null, t.model ?? null, t.systemPrompt ?? null, t.userPrompt ?? null,
      t.messageHistoryJson ?? null, t.toolsJson ?? null,
      t.completion ?? null, t.promptTokens ?? null, t.completionTokens ?? null, t.totalTokens ?? null,
      t.statusCode ?? null, t.error ?? null, t.startedAt, t.finishedAt ?? null, t.durationMs ?? null, t.createdAt,
    );
  }

  updatePromptTrace(id: string, patch: Partial<Pick<PromptTrace, "completion" | "promptTokens" | "completionTokens" | "totalTokens" | "statusCode" | "error" | "finishedAt" | "durationMs">>) {
    stmts.updatePromptTrace.run(
      patch.completion ?? null, patch.promptTokens ?? null,
      patch.completionTokens ?? null, patch.totalTokens ?? null,
      patch.statusCode ?? null, patch.error ?? null,
      patch.finishedAt ?? null, patch.durationMs ?? null, id,
    );
  }

  insertToolTrace(t: ToolTrace) {
    stmts.insertToolTrace.run(
      t.id, t.runId, t.nodeId, t.executionId, t.round,
      t.toolId ?? null, t.toolName ?? null, t.sourceType ?? null, t.status,
      t.inputJson ?? null, t.outputJson ?? null, t.errorJson ?? null,
      t.startedAt, t.finishedAt ?? null, t.durationMs ?? null, t.createdAt,
    );
  }

  updateToolTrace(id: string, patch: Partial<Pick<ToolTrace, "status" | "outputJson" | "errorJson" | "finishedAt" | "durationMs">>) {
    stmts.updateToolTrace.run(
      patch.status ?? null, patch.outputJson ?? null, patch.errorJson ?? null,
      patch.finishedAt ?? null, patch.durationMs ?? null, id,
    );
  }

  insertStateTrace(t: StateTrace) {
    stmts.insertStateTrace.run(
      t.id, t.runId, t.nodeId, t.executionId, t.checkpoint,
      t.nodeStatus ?? null, t.contextSnapshotJson ?? null, t.metadataJson ?? null, t.createdAt,
    );
  }

  // ── Trace queries ──

  getNodeTraces(runId: string, nodeId?: string): NodeTrace[] {
    if (nodeId) {
      return (db.prepare("SELECT * FROM run_node_trace WHERE run_id=? AND node_id=? ORDER BY started_at").all(runId, nodeId) as Row[]).map(toNodeTrace);
    }
    return (db.prepare("SELECT * FROM run_node_trace WHERE run_id=? ORDER BY started_at").all(runId) as Row[]).map(toNodeTrace);
  }

  getPromptTraces(runId: string, nodeId?: string): PromptTrace[] {
    if (nodeId) {
      return (db.prepare("SELECT * FROM run_prompt_trace WHERE run_id=? AND node_id=? ORDER BY started_at, round").all(runId, nodeId) as Row[]).map(toPromptTrace);
    }
    return (db.prepare("SELECT * FROM run_prompt_trace WHERE run_id=? ORDER BY started_at, round").all(runId) as Row[]).map(toPromptTrace);
  }

  getToolTraces(runId: string, nodeId?: string): ToolTrace[] {
    if (nodeId) {
      return (db.prepare("SELECT * FROM run_tool_trace WHERE run_id=? AND node_id=? ORDER BY started_at").all(runId, nodeId) as Row[]).map(toToolTrace);
    }
    return (db.prepare("SELECT * FROM run_tool_trace WHERE run_id=? ORDER BY started_at").all(runId) as Row[]).map(toToolTrace);
  }

  getStateTraces(runId: string, nodeId?: string): StateTrace[] {
    if (nodeId) {
      return (db.prepare("SELECT * FROM run_state_trace WHERE run_id=? AND node_id=? ORDER BY created_at").all(runId, nodeId) as Row[]).map(toStateTrace);
    }
    return (db.prepare("SELECT * FROM run_state_trace WHERE run_id=? ORDER BY created_at").all(runId) as Row[]).map(toStateTrace);
  }

  // ── Dev run detail ──

  insertDevRunDetail(d: DevRunDetail) {
    db.prepare(`
      INSERT INTO dev_run_detail(id,run_snapshot_id,workspace_id,entry_file,run_command,exit_code,stdout,stderr,duration_ms,environment_id,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)
    `).run(d.id, d.runSnapshotId, d.workspaceId, d.entryFile ?? null, d.runCommand, d.exitCode ?? null, d.stdout ?? null, d.stderr ?? null, d.durationMs ?? null, d.environmentId ?? null, d.createdAt);
  }

  getDevRunDetail(runSnapshotId: string): DevRunDetail | null {
    const row = db.prepare("SELECT * FROM dev_run_detail WHERE run_snapshot_id=?").get(runSnapshotId) as Row | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      runSnapshotId: row.run_snapshot_id as string,
      workspaceId: row.workspace_id as string,
      entryFile: str(row.entry_file),
      runCommand: row.run_command as string,
      exitCode: num(row.exit_code),
      stdout: str(row.stdout),
      stderr: str(row.stderr),
      durationMs: num(row.duration_ms),
      environmentId: str(row.environment_id),
      createdAt: row.created_at as string,
    };
  }

  listRunSnapshotRows(opts?: { limit?: number; runType?: string }): Run[] {
    const limit = Math.max(1, Math.min(opts?.limit ?? 40, 200));
    if (opts?.runType) {
      return (db.prepare("SELECT * FROM run_snapshot WHERE run_type=? ORDER BY created_at DESC LIMIT ?").all(opts.runType, limit) as Row[]).map(toRun);
    }
    return (db.prepare("SELECT * FROM run_snapshot ORDER BY created_at DESC LIMIT ?").all(limit) as Row[]).map(toRun);
  }

  /** List dev runs with detail joined */
  listDevRunsWithDetail(limit = 20): Array<Run & { workspaceId?: string; entryFile?: string; runCommand?: string; exitCode?: number; durationMs?: number }> {
    const safeLimit = Math.max(1, Math.min(limit, 200));
    const rows = db.prepare(`
      SELECT rs.*, d.workspace_id, d.entry_file, d.run_command AS detail_run_command, d.exit_code, d.duration_ms AS detail_duration_ms
      FROM run_snapshot rs
      LEFT JOIN dev_run_detail d ON d.run_snapshot_id = rs.run_id
      WHERE rs.run_type = 'dev_run'
      ORDER BY rs.created_at DESC
      LIMIT ?
    `).all(safeLimit) as Row[];
    return rows.map((r) => ({
      ...toRun(r),
      workspaceId: str(r.workspace_id),
      entryFile: str(r.entry_file),
      runCommand: str(r.detail_run_command),
      exitCode: num(r.exit_code),
      durationMs: num(r.detail_duration_ms),
    }));
  }

  reset() {
    this.runs.clear();
    this.tasks.clear();
    this.nodes.clear();
    this.edges.clear();
    this.messages.clear();
    this.events.clear();
    this.definitions.clear();
    this.contexts.clear();
    this.humanMessages.clear();
    this.dbAttempted.clear();
  }
}

export const memoryStore = new MemoryStore();
