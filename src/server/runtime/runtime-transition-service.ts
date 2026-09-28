import { nowIso, makeId } from "@/lib/utils";
import {
  AgentNode,
  ControlNodeState,
  ControlOwnerKind,
  ControlRunState,
  Event,
  EventType,
  Message,
  NodeRole,
  NodeStatus,
  Run,
  TaskStatus,
} from "@/server/domain";
import { eventStreamHub } from "@/server/api/event-stream";
import { notificationService } from "@/server/notification/notification-service";
import { stateMachine } from "@/server/runtime/state-machine";
import { memoryStore } from "@/server/store/memory-store";

export interface RuntimeTransitionDependencies {
  nextEventSequence(runId: string): number;
  buildDefaultMessagePayload(runId: string, fromNodeId: string, type: Message["type"], content: string): Message["payload"];
  mustNode(runId: string, nodeId: string): AgentNode;
  mustContext(runId: string, nodeId: string): { outboundMessages: Message[]; inboundMessages: Message[] };
  syncRunControl(runId: string, patch?: Partial<{ state: ControlRunState; ownerKind: ControlOwnerKind; ownerRef: string; activeNodeId?: string; currentCheckpointId?: string }>): void;
  syncNodeControl(runId: string, nodeId: string, patch?: Partial<{ state: ControlNodeState; ownerKind: ControlOwnerKind; ownerRef: string; approvalRequired: boolean }>): void;
  ownerKindForRole(role: NodeRole): ControlOwnerKind;
}

export class RuntimeTransitionService {
  constructor(private readonly deps: RuntimeTransitionDependencies) {}

  transitionRun(runId: string, to: Run["status"], patch?: Partial<Run>) {
    const run = memoryStore.getRun(runId);
    if (!run) {
      console.warn(`[Runtime] transitionRun skipped because run is missing: ${runId}`);
      return false;
    }

    const status = run.status === to ? to : stateMachine.run(run.status, to);
    memoryStore.updateRun(runId, (current) => ({
      ...current,
      status,
      startedAt: to === "running" ? current.startedAt ?? nowIso() : current.startedAt,
      ...patch,
    }));
    this.deps.syncRunControl(runId);
    return true;
  }

  transitionTask(runId: string, taskId: string, to: TaskStatus) {
    const task = memoryStore.getTasks(runId).find((item) => item.id === taskId);
    if (!task) {
      console.warn(`[Runtime] transitionTask skipped because task is missing: ${runId}/${taskId}`);
      return false;
    }
    const status = task.status === to ? to : stateMachine.task(task.status, to);
    memoryStore.updateTask(runId, taskId, (current) => ({ ...current, status }));
    return true;
  }

  transitionNode(runId: string, nodeId: string, to: NodeStatus, patch?: Partial<AgentNode>) {
    const node = memoryStore.getNodeById(runId, nodeId);
    if (!node) {
      console.warn(`[Runtime] transitionNode skipped because node is missing: ${runId}/${nodeId}`);
      return false;
    }

    const status = node.status === to ? to : stateMachine.node(node.status, to);
    memoryStore.updateNode(runId, nodeId, (current) => ({
      ...current,
      status,
      updatedAt: nowIso(),
      ...patch,
    }));
    this.deps.syncNodeControl(runId, nodeId);
    if (to === "running") {
      this.deps.syncRunControl(runId, {
        activeNodeId: nodeId,
        ownerKind: this.deps.ownerKindForRole(node.role),
        ownerRef: nodeId,
      });
    } else {
      this.deps.syncRunControl(runId);
    }
    return true;
  }

  updateNode(runId: string, nodeId: string, patch: Partial<AgentNode>) {
    memoryStore.updateNode(runId, nodeId, (current) => ({
      ...current,
      ...patch,
      updatedAt: nowIso(),
    }));
    this.deps.syncNodeControl(runId, nodeId);
    this.deps.syncRunControl(runId);
  }

  emit(runId: string, type: EventType, data: Omit<Event, "id" | "runId" | "type" | "timestamp">) {
    const event: Event = {
      id: makeId("event"),
      runId,
      type,
      timestamp: nowIso(),
      runEventSeq: this.deps.nextEventSequence(runId),
      ...data,
    };

    memoryStore.appendEvent(runId, event);
    eventStreamHub.publish(runId, event);

    if (type === "run_completed" || type === "run_failed") {
      const run = memoryStore.getRun(runId);
      notificationService
        .notifyRunEvent(runId, type, {
          runName: run?.name,
          status: run?.status,
          finishedAt: event.timestamp,
          ...(data as Record<string, unknown>),
        })
        .catch((err) => console.warn("[Runtime] Notification dispatch failed:", err instanceof Error ? err.message : err));
    }
  }

  sendMessage(
    runId: string,
    fromNodeId: string,
    toNodeId: string,
    type: Message["type"],
    content: string,
    relatedTaskId?: string,
    payload?: Message["payload"],
  ): Message {
    const message: Message = {
      id: makeId("msg"),
      runId,
      fromNodeId,
      toNodeId,
      type,
      content,
      payload: payload ?? this.deps.buildDefaultMessagePayload(runId, fromNodeId, type, content),
      createdAt: nowIso(),
    };

    memoryStore.appendMessage(runId, message);
    this.updateNode(runId, fromNodeId, {
      outboundMessages: [...(this.deps.mustNode(runId, fromNodeId).outboundMessages ?? []), message].slice(-30),
    });

    const sourceContext = memoryStore.getAgentContextByNode(runId, fromNodeId);
    if (sourceContext) {
      memoryStore.updateAgentContext(runId, sourceContext.id, (current) => ({
        ...current,
        outboundMessages: [...(current.outboundMessages ?? []), message].slice(-30),
        updatedAt: nowIso(),
      }));
      const refreshedSourceContext = this.deps.mustContext(runId, fromNodeId);

      this.emit(runId, "agent_context_updated", {
        relatedNodeId: fromNodeId,
        relatedTaskId,
        message: `节点 ${fromNodeId} 发送消息`,
        payload: {
          reason: "message",
          contextPatch: {
            outboundMessages: refreshedSourceContext.outboundMessages.slice(-30),
          },
        },
      });
    }

    if (type === "task_assignment") {
      this.emit(runId, "task_assigned", {
        relatedNodeId: toNodeId,
        relatedTaskId,
        message: `任务已分配到节点 ${toNodeId}`,
      });
    }

    this.emit(runId, "message_sent", {
      relatedNodeId: toNodeId,
      relatedTaskId,
      message: `消息已发送: ${fromNodeId} -> ${toNodeId}`,
      payload: {
        messageId: message.id,
        messageType: message.type,
        fromNodeId,
        toNodeId,
        content: message.content,
        message,
      },
    });

    const targetContext = memoryStore.getAgentContextByNode(runId, toNodeId);
    if (targetContext) {
      memoryStore.updateAgentContext(runId, targetContext.id, (current) => ({
        ...current,
        inboundMessages: [...current.inboundMessages, message].slice(-30),
        updatedAt: nowIso(),
      }));
      const refreshedTargetContext = this.deps.mustContext(runId, toNodeId);

      this.updateNode(runId, toNodeId, {
        inboundMessages: [...(this.deps.mustNode(runId, toNodeId).inboundMessages ?? []), message].slice(-30),
      });

      this.emit(runId, "agent_context_updated", {
        relatedNodeId: toNodeId,
        message: `节点 ${toNodeId} 收到新消息`,
        payload: {
          reason: "message",
          contextPatch: {
            inboundMessages: refreshedTargetContext.inboundMessages.slice(-30),
          },
        },
      });

      this.emit(runId, "message_delivered", {
        relatedNodeId: toNodeId,
        relatedTaskId,
        message: `消息已投递到节点 ${toNodeId}`,
        payload: { message },
      });
    }

    return message;
  }
}
