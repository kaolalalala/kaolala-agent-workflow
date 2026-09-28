import { makeId, nowIso } from "@/lib/utils";
import { assembleContext } from "@/server/memory/working-memory";
import { longTermMemoryService } from "@/server/memory/long-term-memory-service";
import {
  AgentContext,
  AgentDefinition,
  AgentNode,
  Event,
  Message,
  HumanMessage,
} from "@/server/domain";
import type { ResolvedAgentExecutionConfig } from "@/server/config/config-resolver";
import { memoryStore } from "@/server/store/memory-store";

export interface RuntimeNodeExecutionDependencies {
  readMessageData(message: Message): Record<string, unknown>;
  describeInboundMessage(message: Message): string;
  formatHumanMessage(message: HumanMessage): string;
  getMemoryScope(runId: string): { workspaceId?: string; workflowId?: string };
  emit(runId: string, type: Event["type"], data: Omit<Event, "id" | "runId" | "type" | "timestamp">): void;
}

export class RuntimeNodeExecutionService {
  constructor(private readonly deps: RuntimeNodeExecutionDependencies) {}

  resolveNodeExecutionInput(
    runId: string,
    node: AgentNode,
    definition: AgentDefinition,
    context: AgentContext,
  ) {
    const run = memoryStore.getRun(runId);
    const rootTask = memoryStore.getTasks(runId).find((item) => item.id === run?.rootTaskId);
    const inbound = context.inboundMessages;
    const humanMessages = context.humanMessages;
    console.info("[Runtime][context]", {
      runId,
      nodeId: node.id,
      nodeRole: node.role,
      provider: definition.provider ?? "unconfigured",
      model: definition.model ?? "unconfigured",
      inboundMessagesCount: inbound.length,
      humanMessagesCount: humanMessages.length,
      outboundMessagesCount: context.outboundMessages.length,
    });

    const inboundHumanMessages = inbound
      .slice(-12)
      .map((message) => {
        const data = this.deps.readMessageData(message);
        if (typeof data.humanMessage === "string" && data.humanMessage.trim()) {
          return `${data.humanMessage.trim()} (from ${message.fromNodeId})`;
        }
        return null;
      })
      .filter((item): item is string => Boolean(item));

    const inboundLines = inbound
      .slice(-12)
      .map((message) => `- [${message.type}] ${this.deps.describeInboundMessage(message)}`);

    const explicitHumanLines = humanMessages
      .slice(-16)
      .map((message) => this.deps.formatHumanMessage(message));
    const mergedHumanLines = Array.from(new Set([...explicitHumanLines, ...inboundHumanMessages]));

    const taskTitle = rootTask?.title || context.taskBrief || node.taskBrief || "未提供任务";
    const memoryScope = this.deps.getMemoryScope(runId);
    const memoryQuery = [
      taskTitle,
      context.taskBrief || node.taskBrief || "",
      ...inbound.slice(-16).map((message) => this.deps.describeInboundMessage(message)),
      ...humanMessages.slice(-4).map((message) => message.content),
    ]
      .filter(Boolean)
      .join("\n");

    const memoryHits = longTermMemoryService.search({
      query: memoryQuery,
      workspaceId: memoryScope.workspaceId ?? runId,
      workflowId: memoryScope.workflowId,
      runId,
      nodeId: node.id,
      limit: 8,
      minScore: 0.15,
    });

    if (memoryHits.length > 0) {
      this.deps.emit(runId, "memory_retrieved", {
        relatedNodeId: node.id,
        relatedTaskId: node.taskId,
        message: `${node.name} 已检索到 ${memoryHits.length} 条长期记忆`,
        payload: {
          memoryIds: memoryHits.map((item) => item.id),
          scores: memoryHits.map((item) => Number(item.score.toFixed(4))),
        },
      });
    }

    const modelName = (definition.model ?? "").toLowerCase();
    let tokenBudget = 6000;
    if (/128k|gpt-4o|claude-3|gemini-1\.5/.test(modelName)) {
      tokenBudget = 12000;
    } else if (/32k|gpt-4-turbo/.test(modelName)) {
      tokenBudget = 10000;
    } else if (/16k/.test(modelName)) {
      tokenBudget = 8000;
    }

    const assembled = assembleContext({
      tokenBudget,
      taskTitle,
      nodeBrief: context.taskBrief || node.taskBrief || "",
      inboundLines,
      humanLines: mergedHumanLines,
      memoryHits,
      systemPrompt: definition.systemPrompt || "",
    });

    return assembled.prompt;
  }

  composeSystemPrompt(resolved: ResolvedAgentExecutionConfig) {
    const parts = [resolved.systemPrompt || ""];

    if (resolved.additionalPrompt) {
      parts.push(`附加要求:\n${resolved.additionalPrompt}`);
    }

    if (resolved.promptDocuments.length > 0) {
      parts.push(
        `Prompt 资产:\n${resolved.promptDocuments.map((doc) => `# ${doc.name}\n${doc.content}`).join("\n\n")}`,
      );
    }

    if (resolved.skillDocuments.length > 0) {
      parts.push(
        `Skill 资产:\n${resolved.skillDocuments.map((doc) => `# ${doc.name}\n${doc.content}`).join("\n\n")}`,
      );
    }

    if (resolved.referenceDocuments.length > 0) {
      parts.push(
        `Reference 资产:\n${resolved.referenceDocuments.map((doc) => `# ${doc.name}\n${doc.content}`).join("\n\n")}`,
      );
    }

    return parts.filter(Boolean).join("\n\n");
  }

  buildInitialContext(runId: string, node: AgentNode, definition: AgentDefinition): AgentContext {
    return {
      id: node.contextId ?? makeId("agent_ctx"),
      nodeId: node.id,
      runId,
      systemPrompt: definition.systemPrompt,
      taskBrief: node.taskBrief,
      inboundMessages: [],
      outboundMessages: [],
      resolvedInput: "",
      humanMessages: [],
      recentOutputs: [],
      latestSummary: undefined,
      updatedAt: nowIso(),
    };
  }
}
