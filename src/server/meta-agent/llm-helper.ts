/**
 * LLM helper for Meta-Agent planning / reflection.
 * Adds resilient retry, timeout handling, and empty-body guards.
 */
import { resolveStrictWorkspaceLLMConfig } from "@/server/config/strict-llm-config";
import { withRetry, isTransientHttpStatus } from "@/server/runtime/retry";
import { sanitizeModelText } from "./text-cleaner";

interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMTokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  source: "provider" | "estimated";
}

export interface LLMCallResult {
  content: string;
  usage: LLMTokenUsage;
}

interface ChatCompletionToolCall {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: ChatCompletionToolCall[];
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

function summarizeRaw(text: string, limit = 240) {
  return text.replace(/\s+/g, " ").slice(0, limit);
}

function makeTransientLlmError(message: string) {
  return Object.assign(new Error(message), { transient: true });
}

function buildRequestUrl(baseUrl: string) {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed;
  return `${trimmed}/chat/completions`;
}

function estimateTokenCountFromText(text: string) {
  const length = Array.from(text).length;
  if (length <= 0) return 0;
  // Rough heuristic to avoid zero-token telemetry when provider usage is absent.
  return Math.max(1, Math.ceil(length / 3));
}

function estimateUsage(messages: LLMMessage[], content: string): LLMTokenUsage {
  const promptText = messages.map((item) => `${item.role}:${item.content}`).join("\n");
  const promptTokens = estimateTokenCountFromText(promptText);
  const completionTokens = estimateTokenCountFromText(content);
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
    source: "estimated",
  };
}

function toFiniteNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function extractUsage(
  parsed: ChatCompletionResponse,
  messages: LLMMessage[],
  content: string,
): LLMTokenUsage {
  const usage = parsed.usage ?? {};
  let prompt = toFiniteNumber(usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokens);
  let completion = toFiniteNumber(
    usage.completion_tokens ?? usage.output_tokens ?? usage.completionTokens,
  );
  let total = toFiniteNumber(usage.total_tokens ?? usage.totalTokens);

  if (total <= 0 && (prompt > 0 || completion > 0)) {
    total = prompt + completion;
  }

  if (total > 0 && prompt <= 0 && completion <= 0) {
    prompt = Math.floor(total / 2);
    completion = total - prompt;
  }

  if (total > 0) {
    return {
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: total,
      source: "provider",
    };
  }

  return estimateUsage(messages, content);
}

function toAbortError(error: unknown) {
  if (!(error instanceof Error)) return null;
  if (error.name === "AbortError") return error;
  const msg = error.message.toLowerCase();
  if (msg.includes("aborted") || msg.includes("timeout") || msg.includes("timed out")) {
    return error;
  }
  return null;
}

export async function callLLMWithUsage(messages: LLMMessage[]): Promise<LLMCallResult> {
  const {
    provider,
    model,
    baseUrl,
    apiKey,
  } = resolveStrictWorkspaceLLMConfig();
  const requestUrl = buildRequestUrl(baseUrl);
  const timeoutMs = 90_000;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (provider === "anthropic") {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const executeOnce = async () => {
    const res = await fetch(requestUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.3,
        max_tokens: 4096,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const raw = await res.text().catch(() => "");
    if (!res.ok) {
      const err = new Error(`LLM call failed (${res.status}): ${summarizeRaw(raw)}`);
      if (!isTransientHttpStatus(res.status)) {
        throw Object.assign(err, { permanent: true });
      }
      throw err;
    }

    if (!raw.trim()) {
      throw makeTransientLlmError("LLM call returned empty body");
    }

    let parsed: ChatCompletionResponse;
    try {
      parsed = JSON.parse(raw) as ChatCompletionResponse;
    } catch {
      throw makeTransientLlmError(`LLM response parse failed: ${summarizeRaw(raw) || "empty body"}`);
    }

    const content = parsed.choices?.[0]?.message?.content ?? "";
    if (!String(content).trim()) {
      throw makeTransientLlmError("LLM response content is empty");
    }

    return {
      content: String(content),
      usage: extractUsage(parsed, messages, String(content)),
    };
  };

  const retry = await withRetry(
    executeOnce,
    { maxRetries: 3, baseDelayMs: 1200, maxDelayMs: 10_000, jitterFactor: 0.25 },
    (attempt, error, delayMs) => {
      console.warn("[MetaAgent][LLM][retry]", {
        provider,
        model,
        requestUrl,
        attempt,
        delayMs,
        error: error.message.slice(0, 220),
      });
    },
  );

  if (!retry.ok) {
    const err = retry.error!;
    if (toAbortError(err)) {
      throw new Error(`LLM request timed out/aborted after ${retry.attempts} attempt(s) (> ${timeoutMs / 1000}s)`);
    }
    throw new Error(`LLM request failed after ${retry.attempts} attempt(s): ${err.message}`);
  }

  const output = retry.value ?? {
    content: "",
    usage: estimateUsage(messages, ""),
  };
  return output;
}

export async function callLLM(messages: LLMMessage[]): Promise<string> {
  const result = await callLLMWithUsage(messages);
  return result.content;
}

// ---------------------------------------------------------------------------
// Tool-use loop for subagent execution
// ---------------------------------------------------------------------------

export interface LLMToolDefinition {
  toolId: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface LLMToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMToolCallResult {
  toolCallId: string;
  result: Record<string, unknown>;
}

export interface LLMWithToolsResult {
  content: string;
  usage: LLMTokenUsage;
  tool_calls_made: Array<{
    tool_name: string;
    arguments: Record<string, unknown>;
    result: Record<string, unknown>;
  }>;
}

export class LLMToolLoopError extends Error {
  tool_calls_made: LLMWithToolsResult["tool_calls_made"];
  latest_text: string;
  usage: LLMTokenUsage;

  constructor(
    message: string,
    payload: {
      tool_calls_made: LLMWithToolsResult["tool_calls_made"];
      latest_text: string;
      usage: LLMTokenUsage;
    },
  ) {
    super(message);
    this.name = "LLMToolLoopError";
    this.tool_calls_made = payload.tool_calls_made;
    this.latest_text = payload.latest_text;
    this.usage = payload.usage;
  }
}

type ToolMessage = { role: "tool"; tool_call_id: string; content: string };
type AssistantToolMessage = {
  role: "assistant";
  content: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};

export interface ToolLoopOptions {
  maxRounds?: number;
  contextBudgetTokens?: number;
  compactionTriggerRatio?: number;
  keepRecentCount?: number;
}

function estimateConversationTokens(messages: Array<LLMMessage | AssistantToolMessage | ToolMessage>) {
  return messages.reduce((sum, message) => {
    if (message.role === "tool") {
      return sum + estimateTokenCountFromText(message.content);
    }
    const toolCallsText =
      "tool_calls" in message && Array.isArray(message.tool_calls)
        ? JSON.stringify(message.tool_calls)
        : "";
    return sum + estimateTokenCountFromText(`${message.role}:${message.content}\n${toolCallsText}`);
  }, 0);
}

export async function compactToolConversation(
  messages: Array<LLMMessage | AssistantToolMessage | ToolMessage>,
  keepRecentCount = 4,
): Promise<{
  compacted: Array<LLMMessage | AssistantToolMessage | ToolMessage>;
  summary: string;
  usage: LLMTokenUsage;
}> {
  let systemPrefixLength = 0;
  while (systemPrefixLength < messages.length && messages[systemPrefixLength]?.role === "system") {
    systemPrefixLength += 1;
  }

  const systemMessages = messages.slice(0, systemPrefixLength);
  const workingMessages = messages.slice(systemPrefixLength);
  if (workingMessages.length <= keepRecentCount + 2) {
    return {
      compacted: messages,
      summary: "",
      usage: estimateUsage(systemMessages as LLMMessage[], ""),
    };
  }

  const earlyMessages = workingMessages.slice(0, Math.max(0, workingMessages.length - keepRecentCount));
  const recentMessages = workingMessages.slice(Math.max(0, workingMessages.length - keepRecentCount));
  const earlyText = earlyMessages
    .map((message) => {
      if (message.role === "tool") {
        return `[tool:${message.tool_call_id}] ${message.content}`;
      }
      const toolCallsText =
        "tool_calls" in message && Array.isArray(message.tool_calls)
          ? ` tool_calls=${JSON.stringify(message.tool_calls)}`
          : "";
      return `[${message.role}] ${message.content}${toolCallsText}`;
    })
    .join("\n");

  const summaryPrompt: LLMMessage[] = [
    {
      role: "system",
      content: "You compress a multi-round tool conversation into a concise execution summary. Keep resolved facts, partial findings, open questions, and any file ids or tool outputs that matter. Return plain text only.",
    },
    {
      role: "user",
      content: [
        "Compress the following early tool conversation into a concise summary for continued execution.",
        "Keep important facts, results, unfinished threads, and relevant workspace/file references.",
        "",
        earlyText.slice(0, 12000),
      ].join("\n"),
    },
  ];

  const llmResult = await callLLMWithUsage(summaryPrompt);
  const summary = sanitizeModelText(llmResult.content).slice(0, 1800);
  return {
    compacted: [
      ...systemMessages,
      {
        role: "assistant",
        content: `Conversation summary: ${summary}`,
      },
      ...recentMessages,
    ],
    summary,
    usage: llmResult.usage,
  };
}

/**
 * Multi-round LLM call with function calling (tool-use loop).
 * On each round, if the LLM returns tool_calls, invokes them via `executeTool`,
 * feeds results back, and loops until the LLM returns a final text response.
 */
export async function callLLMWithTools(
  messages: LLMMessage[],
  tools: LLMToolDefinition[],
  executeTool: (call: LLMToolCallRequest) => Promise<Record<string, unknown>>,
  maxRoundsOrOptions: number | ToolLoopOptions = 6,
): Promise<LLMWithToolsResult> {
  const {
    provider,
    model,
    baseUrl,
    apiKey,
  } = resolveStrictWorkspaceLLMConfig();
  const requestUrl = buildRequestUrl(baseUrl);
  const timeoutMs = 90_000;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (provider === "anthropic") {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  // Normalize tool schemas for OpenAI-compatible format
  function normalizeParameters(schema: Record<string, unknown>): Record<string, unknown> {
    const result = { ...schema };
    if (!result.type) result.type = "object";
    if (!result.properties) result.properties = {};
    return result;
  }

  const toolDefs = tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.toolId,
      description: t.description,
      parameters: normalizeParameters(t.inputSchema),
    },
  }));

  const conversationMessages: Array<LLMMessage | AssistantToolMessage | ToolMessage> = [...messages];
  const totalUsage: LLMTokenUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, source: "provider" };
  const toolCallsMade: LLMWithToolsResult["tool_calls_made"] = [];
  let latestText = "";
  const toolLoopOptions =
    typeof maxRoundsOrOptions === "number"
      ? { maxRounds: maxRoundsOrOptions }
      : maxRoundsOrOptions;
  const maxRounds = Math.max(1, toolLoopOptions.maxRounds ?? 6);
  const contextBudgetTokens = Math.max(2000, toolLoopOptions.contextBudgetTokens ?? 12000);
  const compactionTriggerRatio = Math.min(0.95, Math.max(0.4, toolLoopOptions.compactionTriggerRatio ?? 0.7));
  const keepRecentCount = Math.max(2, toolLoopOptions.keepRecentCount ?? 4);

  for (let round = 0; round <= maxRounds; round++) {
    const estimatedTokens = estimateConversationTokens(conversationMessages);
    if (estimatedTokens > contextBudgetTokens * compactionTriggerRatio) {
      const compacted = await compactToolConversation(conversationMessages, keepRecentCount);
      conversationMessages.splice(0, conversationMessages.length, ...compacted.compacted);
      totalUsage.prompt_tokens += compacted.usage.prompt_tokens;
      totalUsage.completion_tokens += compacted.usage.completion_tokens;
      totalUsage.total_tokens += compacted.usage.total_tokens;
    }

    const body = {
      model,
      messages: conversationMessages,
      temperature: 0.3,
      max_tokens: 4096,
      ...(toolDefs.length > 0 ? { tools: toolDefs, tool_choice: "auto" } : {}),
    };

    const fetchOnce = async () => {
      const resp = await fetch(requestUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await resp.text().catch(() => "");
      if (!resp.ok) {
        const err = new Error(`LLM call failed (${resp.status}): ${summarizeRaw(text)}`);
        if (!isTransientHttpStatus(resp.status)) {
          throw Object.assign(err, { permanent: true });
        }
        throw err;
      }
      if (!text.trim()) {
        throw makeTransientLlmError("LLM tool-loop call returned empty body");
      }
      let result: ChatCompletionResponse;
      try {
        result = JSON.parse(text) as ChatCompletionResponse;
      } catch {
        throw makeTransientLlmError(`LLM response parse failed: ${summarizeRaw(text) || "empty body"}`);
      }
      return result;
    };

    const retry = await withRetry(
      fetchOnce,
      { maxRetries: 5, baseDelayMs: 2500, maxDelayMs: 20_000, jitterFactor: 0.35 },
      (attempt, error, delayMs) => {
        console.warn("[MetaAgent][LLM][tool-loop][retry]", {
          round, attempt, delayMs,
          error: error.message.slice(0, 220),
        });
      },
    );

    if (!retry.ok) {
      throw new LLMToolLoopError(
        `LLM tool-loop failed after ${retry.attempts} attempt(s) (round ${round}): ${retry.error!.message}`,
        {
          tool_calls_made: [...toolCallsMade],
          latest_text: latestText,
          usage: { ...totalUsage },
        },
      );
    }
    const parsed = retry.value!;

    // Accumulate token usage
    const roundUsage = extractUsage(parsed, messages, parsed.choices?.[0]?.message?.content ?? "");
    totalUsage.prompt_tokens += roundUsage.prompt_tokens;
    totalUsage.completion_tokens += roundUsage.completion_tokens;
    totalUsage.total_tokens += roundUsage.total_tokens;

    const assistantMessage = parsed.choices?.[0]?.message;
    const assistantText = String(assistantMessage?.content ?? "");
    if (assistantText) latestText = assistantText;

    const toolCalls = assistantMessage?.tool_calls ?? [];

    // No tool calls → final response
    if (toolCalls.length === 0) {
      return {
        content: latestText || "LLM returned no content.",
        usage: totalUsage,
        tool_calls_made: toolCallsMade,
      };
    }

    // Record assistant message with tool_calls.
    // IMPORTANT: use the provider-assigned call.id when it is a non-empty string.
    // Some providers (e.g. MiniMax) validate that tool result messages reference the
    // exact same id they emitted; generating a fallback id causes a 400 "tool id not found".
    // We therefore only fall back to a local id when the provider gave us nothing at all.
    const normalizedToolCalls = toolCalls
      .filter((c) => c.function?.name)
      .map((c, i) => ({
        id: (typeof c.id === "string" && c.id.trim()) ? c.id.trim() : `tc_${round}_${i}`,
        type: "function" as const,
        function: {
          name: c.function?.name || "",
          arguments: c.function?.arguments || "{}",
        },
      }));

    conversationMessages.push({
      role: "assistant",
      content: assistantText,
      tool_calls: normalizedToolCalls,
    });

    // Execute each tool call — use the same normalized id so the tool result
    // message always matches the assistant message exactly.
    for (let i = 0; i < toolCalls.length; i++) {
      const call = toolCalls[i];
      const callId = normalizedToolCalls[i]?.id ?? `tc_${round}_${i}`;
      const fnName = call.function?.name ?? "";
      let fnArgs: Record<string, unknown> = {};
      try {
        fnArgs = JSON.parse(call.function?.arguments || "{}") as Record<string, unknown>;
      } catch {
        fnArgs = {};
      }

      let toolResult: Record<string, unknown>;
      try {
        toolResult = await executeTool({ id: callId, name: fnName, arguments: fnArgs });
      } catch (err) {
        toolResult = {
          error: true,
          message: err instanceof Error ? err.message : String(err),
        };
      }

      toolCallsMade.push({
        tool_name: fnName,
        arguments: fnArgs,
        result: toolResult,
      });

      conversationMessages.push({
        role: "tool",
        tool_call_id: callId,
        content: JSON.stringify(toolResult),
      });
    }
  }

  // Exceeded max rounds
  return {
    content: latestText || "Tool-use loop exceeded maximum rounds.",
    usage: totalUsage,
    tool_calls_made: toolCallsMade,
  };
}
