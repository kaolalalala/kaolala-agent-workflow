/**
 * DurableScheduler — checkpoint-based DAG execution scheduler.
 *
 * Separates the "what to run next" decision (orchestration) from "actually running it" (execution).
 * After each node completes, a checkpoint is written to SQLite so the run can be resumed
 * from the last completed wave if the process crashes.
 *
 * Key concepts:
 * - **Checkpoint**: a row in `run_checkpoint` recording that a specific node finished (success or failure).
 * - **ScheduleState**: a row in `run_schedule_state` recording the DAG schedule progress (which nodes
 *   are executed, which are pending, current wave index). This is the "orchestrator's brain".
 * - **Wave**: a batch of nodes at the same DAG depth that can execute in parallel.
 *
 * Recovery flow:
 * 1. On startup, scan `run_schedule_state` for status='active'.
 * 2. For each, load checkpoints to determine which nodes already completed.
 * 3. Rebuild pendingDependencies from the DAG, subtract completed nodes.
 * 4. Resume from the next ready wave.
 */

import { db } from "@/server/persistence/sqlite";
import { makeId, nowIso } from "@/lib/utils";

// ──────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────

export interface NodeCheckpoint {
  id: string;
  runId: string;
  nodeId: string;
  status: "running" | "completed" | "failed";
  waveIndex: number;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  createdAt: string;
}

export interface ScheduleState {
  runId: string;
  /** Serialized DagInfo — only the serializable parts */
  dagJson: string;
  /** Node IDs in execution scope */
  scopeJson: string;
  /** Node IDs already executed */
  executedJson: string;
  /** Map<nodeId, pendingDependencyCount> */
  pendingDependenciesJson: string;
  currentWaveIndex: number;
  rerunMode: boolean;
  rerunStartNodeId?: string;
  /** Serialized loop-back state for resume */
  loopStateJson?: string;
  status: "active" | "completed" | "failed" | "cancelled";
  createdAt: string;
  updatedAt: string;
}

/** Serializable DAG representation (no Maps) for persistence */
export interface SerializableDag {
  orderedNodeIds: string[];
  incoming: Record<string, string[]>;
  outgoing: Record<string, string[]>;
  loopBackEdges: Array<{
    id: string;
    sourceNodeId: string;
    targetNodeId: string;
    maxIterations: number;
    convergenceKeyword?: string;
  }>;
}

// ──────────────────────────────────────────────────────────
// Prepared statements
// ──────────────────────────────────────────────────────────

const stmts = {
  upsertCheckpoint: db.prepare(`
    INSERT INTO run_checkpoint(id, run_id, node_id, status, wave_index, started_at, finished_at, error, created_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id, node_id) DO UPDATE SET
      status=excluded.status, wave_index=excluded.wave_index,
      finished_at=excluded.finished_at, error=excluded.error`),

  getCheckpoints: db.prepare(
    `SELECT * FROM run_checkpoint WHERE run_id=? ORDER BY wave_index, created_at`,
  ),

  upsertScheduleState: db.prepare(`
    INSERT INTO run_schedule_state(run_id, dag_json, scope_json, executed_json, pending_dependencies_json,
      current_wave_index, rerun_mode, rerun_start_node_id, loop_state_json, status, created_at, updated_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id) DO UPDATE SET
      executed_json=excluded.executed_json, pending_dependencies_json=excluded.pending_dependencies_json,
      current_wave_index=excluded.current_wave_index, loop_state_json=excluded.loop_state_json,
      status=excluded.status, updated_at=excluded.updated_at`),

  getScheduleState: db.prepare(
    `SELECT * FROM run_schedule_state WHERE run_id=?`,
  ),

  getActiveSchedules: db.prepare(
    `SELECT * FROM run_schedule_state WHERE status='active'`,
  ),

  deleteScheduleState: db.prepare(
    `DELETE FROM run_schedule_state WHERE run_id=?`,
  ),

  deleteCheckpoints: db.prepare(
    `DELETE FROM run_checkpoint WHERE run_id=?`,
  ),
};

// ──────────────────────────────────────────────────────────
// Row mappers
// ──────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

function toCheckpoint(r: Row): NodeCheckpoint {
  return {
    id: r.id as string,
    runId: r.run_id as string,
    nodeId: r.node_id as string,
    status: r.status as NodeCheckpoint["status"],
    waveIndex: r.wave_index as number,
    startedAt: r.started_at as string,
    finishedAt: (r.finished_at as string) || undefined,
    error: (r.error as string) || undefined,
    createdAt: r.created_at as string,
  };
}

function toScheduleState(r: Row): ScheduleState {
  return {
    runId: r.run_id as string,
    dagJson: r.dag_json as string,
    scopeJson: r.scope_json as string,
    executedJson: r.executed_json as string,
    pendingDependenciesJson: r.pending_dependencies_json as string,
    currentWaveIndex: r.current_wave_index as number,
    rerunMode: (r.rerun_mode as number) === 1,
    rerunStartNodeId: (r.rerun_start_node_id as string) || undefined,
    loopStateJson: (r.loop_state_json as string) || undefined,
    status: r.status as ScheduleState["status"],
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

// ──────────────────────────────────────────────────────────
// DurableScheduler
// ──────────────────────────────────────────────────────────

export class DurableScheduler {

  // ── Checkpoint operations ──

  /** Record that a node has started execution in a given wave */
  checkpointNodeStarted(runId: string, nodeId: string, waveIndex: number): NodeCheckpoint {
    const now = nowIso();
    const cp: NodeCheckpoint = {
      id: makeId("ckpt"),
      runId,
      nodeId,
      status: "running",
      waveIndex,
      startedAt: now,
      createdAt: now,
    };
    stmts.upsertCheckpoint.run(
      cp.id, cp.runId, cp.nodeId, cp.status, cp.waveIndex,
      cp.startedAt, null, null, cp.createdAt,
    );
    return cp;
  }

  /** Record that a node has completed (success) */
  checkpointNodeCompleted(runId: string, nodeId: string, waveIndex: number): void {
    const now = nowIso();
    // Use upsert — if already exists from "started", update it
    stmts.upsertCheckpoint.run(
      makeId("ckpt"), runId, nodeId, "completed", waveIndex,
      now, now, null, now,
    );
  }

  /** Record that a node has failed */
  checkpointNodeFailed(runId: string, nodeId: string, waveIndex: number, error: string): void {
    const now = nowIso();
    stmts.upsertCheckpoint.run(
      makeId("ckpt"), runId, nodeId, "failed", waveIndex,
      now, now, error, now,
    );
  }

  /** Get all checkpoints for a run */
  getCheckpoints(runId: string): NodeCheckpoint[] {
    return (stmts.getCheckpoints.all(runId) as Row[]).map(toCheckpoint);
  }

  /** Get set of completed node IDs for a run */
  getCompletedNodeIds(runId: string): Set<string> {
    const checkpoints = this.getCheckpoints(runId);
    return new Set(
      checkpoints.filter((cp) => cp.status === "completed").map((cp) => cp.nodeId),
    );
  }

  // ── Schedule state operations ──

  /** Save or update the schedule state for a run */
  saveScheduleState(state: ScheduleState): void {
    stmts.upsertScheduleState.run(
      state.runId, state.dagJson, state.scopeJson, state.executedJson,
      state.pendingDependenciesJson, state.currentWaveIndex,
      state.rerunMode ? 1 : 0, state.rerunStartNodeId ?? null,
      state.loopStateJson ?? null, state.status,
      state.createdAt, state.updatedAt,
    );
  }

  /** Get the schedule state for a run */
  getScheduleState(runId: string): ScheduleState | null {
    const row = stmts.getScheduleState.get(runId) as Row | undefined;
    return row ? toScheduleState(row) : null;
  }

  /** Mark schedule as completed */
  completeSchedule(runId: string): void {
    const existing = this.getScheduleState(runId);
    if (existing) {
      this.saveScheduleState({ ...existing, status: "completed", updatedAt: nowIso() });
    }
  }

  /** Mark schedule as failed */
  failSchedule(runId: string): void {
    const existing = this.getScheduleState(runId);
    if (existing) {
      this.saveScheduleState({ ...existing, status: "failed", updatedAt: nowIso() });
    }
  }

  // ── Recovery operations ──

  /** Find all runs that were in-progress when the process last exited */
  getInterruptedSchedules(): ScheduleState[] {
    return (stmts.getActiveSchedules.all() as Row[]).map(toScheduleState);
  }

  /** Build a recovery plan: which nodes are already done, which need to run */
  buildRecoveryPlan(runId: string): {
    scheduleState: ScheduleState;
    completedNodeIds: Set<string>;
    failedNodeIds: Set<string>;
    dag: SerializableDag;
    scope: Set<string>;
    remainingScope: Set<string>;
  } | null {
    const scheduleState = this.getScheduleState(runId);
    if (!scheduleState || scheduleState.status !== "active") {
      return null;
    }

    const checkpoints = this.getCheckpoints(runId);
    const completedNodeIds = new Set<string>();
    const failedNodeIds = new Set<string>();
    for (const cp of checkpoints) {
      if (cp.status === "completed") completedNodeIds.add(cp.nodeId);
      if (cp.status === "failed") failedNodeIds.add(cp.nodeId);
    }

    const dag = JSON.parse(scheduleState.dagJson) as SerializableDag;
    const scope = new Set(JSON.parse(scheduleState.scopeJson) as string[]);
    const remainingScope = new Set<string>();
    for (const nodeId of scope) {
      if (!completedNodeIds.has(nodeId)) {
        remainingScope.add(nodeId);
      }
    }

    return { scheduleState, completedNodeIds, failedNodeIds, dag, scope, remainingScope };
  }

  /** Clean up checkpoint data after a run is fully done */
  cleanup(runId: string): void {
    stmts.deleteCheckpoints.run(runId);
    stmts.deleteScheduleState.run(runId);
  }

  // ── Helpers for building serializable DAG ──

  /** Convert a Map-based DagInfo to a serializable representation */
  static serializeDag(dagInfo: {
    orderedNodeIds: string[];
    incoming: Map<string, string[]>;
    outgoing: Map<string, string[]>;
    loopBackEdges: Array<{
      id: string;
      sourceNodeId: string;
      targetNodeId: string;
      maxIterations: number;
      convergenceKeyword?: string;
    }>;
  }): SerializableDag {
    return {
      orderedNodeIds: dagInfo.orderedNodeIds,
      incoming: Object.fromEntries(dagInfo.incoming),
      outgoing: Object.fromEntries(dagInfo.outgoing),
      loopBackEdges: dagInfo.loopBackEdges,
    };
  }

  /** Restore Maps from a serialized DAG */
  static deserializeDag(serialized: SerializableDag): {
    orderedNodeIds: string[];
    orderMap: Map<string, number>;
    incoming: Map<string, string[]>;
    outgoing: Map<string, string[]>;
    loopBackEdges: Array<{
      id: string;
      sourceNodeId: string;
      targetNodeId: string;
      maxIterations: number;
      convergenceKeyword?: string;
    }>;
  } {
    return {
      orderedNodeIds: serialized.orderedNodeIds,
      orderMap: new Map(serialized.orderedNodeIds.map((id, i) => [id, i + 1])),
      incoming: new Map(Object.entries(serialized.incoming)),
      outgoing: new Map(Object.entries(serialized.outgoing)),
      loopBackEdges: serialized.loopBackEdges,
    };
  }
}

export const durableScheduler = new DurableScheduler();
