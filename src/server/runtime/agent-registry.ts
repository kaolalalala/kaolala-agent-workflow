/**
 * AgentRegistry — runtime registry of agent node capabilities within a run.
 *
 * Built at run startup from node configs and definitions. Enables:
 * - Capability-based agent lookup (for handoff/subtask without hardcoding node names)
 * - Agent discovery by role, name, or skill description
 *
 * The registry lives in memory per-run and is discarded when the run ends.
 */

import type { AgentNode, NodeRole, AgentDefinition } from "@/server/domain";
import { embeddingService } from "@/server/memory/embedding-service";

// ──────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────

export interface AgentCapability {
  nodeId: string;
  nodeName: string;
  role: NodeRole;
  responsibility: string;
  systemPromptExcerpt: string;
  /** Computed on first access, cached */
  embedding?: number[];
}

export interface AgentMatch {
  nodeId: string;
  nodeName: string;
  role: NodeRole;
  score: number;
}

// ──────────────────────────────────────────────────────────
// Registry
// ──────────────────────────────────────────────────────────

export class AgentRegistry {
  private agents = new Map<string, AgentCapability>();
  private embeddingsReady = false;

  /** Register a node's capabilities */
  register(node: AgentNode, definition: AgentDefinition): void {
    // Skip port nodes — they don't have agent capabilities
    if (node.role === "input" || node.role === "output") return;

    this.agents.set(node.id, {
      nodeId: node.id,
      nodeName: node.name,
      role: node.role,
      responsibility: definition.responsibility || "",
      systemPromptExcerpt: (definition.systemPrompt || "").slice(0, 500),
    });
  }

  /** Find an agent by exact node name (case-insensitive) */
  findByName(name: string): AgentCapability | undefined {
    const lower = name.toLowerCase();
    for (const agent of this.agents.values()) {
      if (agent.nodeName.toLowerCase() === lower) return agent;
    }
    return undefined;
  }

  /** Find an agent by node ID */
  findById(nodeId: string): AgentCapability | undefined {
    return this.agents.get(nodeId);
  }

  /** Find agents by role */
  findByRole(role: NodeRole): AgentCapability[] {
    return Array.from(this.agents.values()).filter((a) => a.role === role);
  }

  /**
   * Find the best matching agent for a task description.
   * Uses text overlap scoring (fast, sync). Falls back to role matching.
   */
  findBestMatch(taskDescription: string, excludeNodeId?: string): AgentMatch | null {
    const lower = taskDescription.toLowerCase();
    const candidates = Array.from(this.agents.values())
      .filter((a) => a.nodeId !== excludeNodeId);

    if (candidates.length === 0) return null;

    // Score each candidate by keyword overlap with their responsibility + system prompt
    const scored = candidates.map((agent) => {
      const agentText = `${agent.nodeName} ${agent.responsibility} ${agent.systemPromptExcerpt}`.toLowerCase();

      // Simple word overlap score
      const queryWords = new Set(lower.match(/[\u4e00-\u9fff]+|[a-z0-9_]{2,}/g) ?? []);
      const agentWords = new Set(agentText.match(/[\u4e00-\u9fff]+|[a-z0-9_]{2,}/g) ?? []);
      let overlap = 0;
      for (const word of queryWords) {
        if (agentWords.has(word)) overlap++;
      }
      const overlapScore = queryWords.size > 0 ? overlap / queryWords.size : 0;

      // Role affinity bonus
      let roleBonus = 0;
      if (/研究|research|调查|investigate|搜索|search/.test(lower) && agent.role === "research") roleBonus = 0.3;
      if (/审核|review|检查|check|验证|verify/.test(lower) && agent.role === "reviewer") roleBonus = 0.3;
      if (/总结|summarize|汇总|aggregate/.test(lower) && agent.role === "summarizer") roleBonus = 0.3;
      if (/规划|plan|分解|decompose/.test(lower) && agent.role === "planner") roleBonus = 0.3;
      if (/路由|route|分发|dispatch/.test(lower) && agent.role === "router") roleBonus = 0.3;

      return {
        nodeId: agent.nodeId,
        nodeName: agent.nodeName,
        role: agent.role,
        score: overlapScore + roleBonus,
      };
    });

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];

    // Require a minimum score to avoid random matches
    return best.score > 0.05 ? best : scored[0]; // Always return at least one if candidates exist
  }

  /**
   * Async version using embedding similarity for better matching.
   */
  async findBestMatchAsync(taskDescription: string, excludeNodeId?: string): Promise<AgentMatch | null> {
    if (!embeddingService.isAvailable()) {
      return this.findBestMatch(taskDescription, excludeNodeId);
    }

    // Ensure agent embeddings are computed
    if (!this.embeddingsReady) {
      await this.computeEmbeddings();
    }

    const queryEmb = await embeddingService.embed(taskDescription);
    if (!queryEmb) {
      return this.findBestMatch(taskDescription, excludeNodeId);
    }

    const candidates = Array.from(this.agents.values())
      .filter((a) => a.nodeId !== excludeNodeId && a.embedding);

    if (candidates.length === 0) {
      return this.findBestMatch(taskDescription, excludeNodeId);
    }

    const scored = candidates.map((agent) => ({
      nodeId: agent.nodeId,
      nodeName: agent.nodeName,
      role: agent.role,
      score: embeddingService.cosineSimilarity(queryEmb, agent.embedding!),
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored[0];
  }

  /** Get a description of all available agents (for injection into prompts) */
  describeAll(excludeNodeId?: string): string {
    const agents = Array.from(this.agents.values())
      .filter((a) => a.nodeId !== excludeNodeId);

    if (agents.length === 0) return "无其他可用 Agent。";

    return agents.map((a) =>
      `- ${a.nodeName} (${a.role}): ${a.responsibility || a.systemPromptExcerpt.slice(0, 100) || "无描述"}`
    ).join("\n");
  }

  /** Number of registered agents */
  get size(): number {
    return this.agents.size;
  }

  private async computeEmbeddings(): Promise<void> {
    const agents = Array.from(this.agents.values());
    const texts = agents.map((a) => `${a.nodeName} ${a.role} ${a.responsibility} ${a.systemPromptExcerpt}`);
    const embeddings = await embeddingService.embedBatch(texts);

    for (let i = 0; i < agents.length; i++) {
      if (embeddings[i]) {
        agents[i].embedding = embeddings[i]!;
      }
    }
    this.embeddingsReady = true;
  }
}
