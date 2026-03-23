/**
 * WorkingMemory — dynamic context assembly for agent node execution.
 *
 * Replaces the fixed "5 memories + 12 upstream messages" concatenation
 * with a token-budget-aware assembler that dynamically allocates space
 * across context sources based on relevance and available budget.
 *
 * Context sources (in priority order):
 * 1. Task description (always included, never trimmed)
 * 2. Human messages (high priority — explicit user intent)
 * 3. Upstream inbound messages (DAG data flow)
 * 4. Long-term memory hits (cross-run knowledge)
 * 5. System prompt (always included at the end)
 *
 * Token estimation: 1 token ≈ 1.5 Chinese characters or 4 English characters.
 * This is a rough heuristic — precise tokenization would require a tokenizer library.
 */

import type { MemorySearchResult } from "@/server/memory/long-term-memory-service";

// ──────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────

export interface ContextSource {
  /** Section label for the prompt */
  label: string;
  /** The actual content lines */
  lines: string[];
  /** Priority: lower = more important, included first */
  priority: number;
  /** If true, never trim this source */
  required?: boolean;
}

export interface AssembleOptions {
  /** Max approximate token budget for the entire prompt (default: 6000) */
  tokenBudget?: number;
  /** Task description */
  taskTitle: string;
  /** Node-level task brief */
  nodeBrief: string;
  /** Formatted inbound messages from upstream nodes */
  inboundLines: string[];
  /** Formatted human messages */
  humanLines: string[];
  /** Memory search results */
  memoryHits: MemorySearchResult[];
  /** Node system prompt */
  systemPrompt: string;
}

export interface AssembledContext {
  /** The final assembled prompt string */
  prompt: string;
  /** Approximate token count */
  estimatedTokens: number;
  /** How many memory items were included */
  memoryItemsIncluded: number;
  /** How many inbound messages were included */
  inboundIncluded: number;
  /** Whether any content was trimmed due to budget */
  wasTrimmed: boolean;
}

// ──────────────────────────────────────────────────────────
// Token estimation
// ──────────────────────────────────────────────────────────

/**
 * Rough token estimate. Not precise, but good enough for budget allocation.
 * Chinese: ~1.5 chars/token. English: ~4 chars/token. Mixed: ~2.5 chars/token.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Count Han characters vs Latin characters
  const hanCount = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const totalChars = text.length;
  const latinCount = totalChars - hanCount;
  return Math.ceil(hanCount / 1.5 + latinCount / 4);
}

function estimateLinesTokens(lines: string[]): number {
  return lines.reduce((sum, line) => sum + estimateTokens(line), 0);
}

// ──────────────────────────────────────────────────────────
// Formatting helpers
// ──────────────────────────────────────────────────────────

function formatMemoryHit(item: MemorySearchResult, index: number): string {
  const header = [
    `#${index + 1}`,
    item.title ?? item.sourceType,
    `score=${item.score.toFixed(3)}`,
    `type=${item.memoryType}`,
    `source=${item.sourceType}`,
    `time=${item.updatedAt}`,
  ].join(" | ");
  return `- ${header}\n  ${item.summary || item.content.slice(0, 220)}`;
}

// ──────────────────────────────────────────────────────────
// Working Memory assembler
// ──────────────────────────────────────────────────────────

export function assembleContext(options: AssembleOptions): AssembledContext {
  const budget = options.tokenBudget ?? 6000;
  let wasTrimmed = false;

  // ── Required sections (always included) ──
  const taskSection = `用户任务:\n${options.taskTitle}`;
  const briefSection = `节点任务:\n${options.nodeBrief || "未提供节点任务"}`;
  const promptSection = `节点 Prompt:\n${options.systemPrompt || "无"}`;

  const requiredTokens =
    estimateTokens(taskSection) +
    estimateTokens(briefSection) +
    estimateTokens(promptSection);

  let remainingBudget = budget - requiredTokens;

  // ── Allocate remaining budget across optional sections ──
  // Priority allocation: human messages > inbound > memory
  const humanBudget = Math.min(Math.floor(remainingBudget * 0.35), estimateLinesTokens(options.humanLines));
  const inboundBudget = Math.min(Math.floor(remainingBudget * 0.35), estimateLinesTokens(options.inboundLines));
  const memoryBudget = remainingBudget - humanBudget - inboundBudget;

  // ── Trim human messages to budget ──
  const includedHuman: string[] = [];
  let humanTokensUsed = 0;
  // Include from most recent (end of array)
  for (let i = options.humanLines.length - 1; i >= 0; i--) {
    const tokens = estimateTokens(options.humanLines[i]);
    if (humanTokensUsed + tokens > humanBudget) {
      wasTrimmed = true;
      break;
    }
    includedHuman.unshift(options.humanLines[i]);
    humanTokensUsed += tokens;
  }

  // ── Trim inbound messages to budget ──
  const includedInbound: string[] = [];
  let inboundTokensUsed = 0;
  for (let i = options.inboundLines.length - 1; i >= 0; i--) {
    const tokens = estimateTokens(options.inboundLines[i]);
    if (inboundTokensUsed + tokens > inboundBudget) {
      wasTrimmed = true;
      break;
    }
    includedInbound.unshift(options.inboundLines[i]);
    inboundTokensUsed += tokens;
  }

  // ── Trim memory hits to budget ──
  // Memory hits are already sorted by relevance (score desc)
  const includedMemory: string[] = [];
  let memoryTokensUsed = 0;
  let memoryItemsIncluded = 0;
  for (let i = 0; i < options.memoryHits.length; i++) {
    const formatted = formatMemoryHit(options.memoryHits[i], i);
    const tokens = estimateTokens(formatted);
    if (memoryTokensUsed + tokens > memoryBudget) {
      wasTrimmed = true;
      break;
    }
    includedMemory.push(formatted);
    memoryTokensUsed += tokens;
    memoryItemsIncluded++;
  }

  // ── Assemble final prompt ──
  const humanText = includedHuman.length > 0
    ? includedHuman.map((line) => `- ${line}`).join("\n")
    : "- 无";
  const inboundText = includedInbound.length > 0
    ? includedInbound.join("\n")
    : "- 无";
  const memoryText = includedMemory.length > 0
    ? includedMemory.join("\n")
    : "- 无";

  const prompt = [
    taskSection,
    briefSection,
    `上游消息:\n${inboundText}`,
    `人工消息:\n${humanText}`,
    `长期记忆检索:\n${memoryText}`,
    promptSection,
  ].join("\n\n");

  const estimatedTokens = estimateTokens(prompt);

  return {
    prompt,
    estimatedTokens,
    memoryItemsIncluded,
    inboundIncluded: includedInbound.length,
    wasTrimmed,
  };
}
