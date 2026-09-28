import { AgentAdapter } from "@/server/agents/adapters/agent-adapter";
import { buildPrompt } from "@/server/agents/builder/prompt-builder";
import { AgentExecutionInput, AgentExecutionOutput } from "@/server/agents/types";
import type { ResolvedTool } from "@/server/tools/contracts";
import { withRetry, isTransientHttpStatus } from "@/server/runtime/retry";
import { llmCircuitBreaker, serviceKeyFromUrl } from "@/server/runtime/circuit-breaker";
import { createHash } from "node:crypto";

interface LLMConfig {
  provider?: string;
  baseURL: string;
  apiKey: string;
  model: string;
  requestTimeoutMs?: number;
  runId?: string;
  nodeId?: string;
}

interface ChatCompletionToolCall {
  id?: string;
  type?: "function";
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface ChatCompletionUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      role?: "assistant";
      content?: string | null;
      tool_calls?: ChatCompletionToolCall[];
    };
  }>;
  usage?: ChatCompletionUsage;
}

interface StreamDelta {
  content?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
}

interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: {
          name: string;
          arguments: string;
        };
      }>;
    }
  | { role: "tool"; tool_call_id: string; content: string };

function toSafeToolName(toolId: string, index: number) {
  const safe = toolId
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/^_+/, "")
    .slice(0, 50);
  return safe ? `${safe}_${index}` : `tool_${index}`;
}

function normalizeToolParameters(schema: Record<string, unknown>) {
  if (schema.type === "object") {
    return schema;
  }
  return {
    type: "object",
    properties: schema,
    additionalProperties: true,
  };
}

function parseToolArguments(raw?: string): Record<string, unknown> {
  if (!raw?.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return { raw };
  }
}

function parseToolDirective(content?: string) {
  if (!content) {
    return null;
  }
  const match = content.match(/^\/tool\s+([a-zA-Z0-9:_-]+)(?:\s+(.+))?$/);
  if (!match) {
    return null;
  }

  let parsedInput: Record<string, unknown> = {};
  if (match[2]) {
    try {
      parsedInput = JSON.parse(match[2]) as Record<string, unknown>;
    } catch {
      parsedInput = { raw: match[2] };
    }
  }

  return { toolId: match[1], input: parsedInput };
}

function buildAuthHeaders(provider: string | undefined, apiKey: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const normalizedProvider = (provider ?? "").trim().toLowerCase();
  if (normalizedProvider === "anthropic") {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
    return headers;
  }
  headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

function inferRouterCondition(text: string) {
  const routingSource = text.toLowerCase();
  if (routingSource.includes("reject") || routingSource.includes("拒绝")) {
    return "reject";
  }
  if (routingSource.includes("approve") || routingSource.includes("通过")) {
    return "approve";
  }
  if (routingSource.includes("research") || routingSource.includes("调研")) {
    return "research";
  }
  if (routingSource.includes("summary") || routingSource.includes("总结")) {
    return "summary";
  }
  return "default";
}

function summarizeRaw(text: string, limit = 320) {
  return text.replace(/\s+/g, " ").slice(0, limit);
}

function stripThinkBlocks(text: string): string {
  if (!text) return "";
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^\s+|\s+$/g, "");
}

function looksLikeDraftOnly(text: string): boolean {
  const normalized = (text || "").trim();
  if (!normalized) return true;
  const draftSignals = /(我将|我会|让我|先分析|接下来|稍后|I will|Let me|next I will)/i.test(normalized);
  const deliverableSignals = /(方案|计划|步骤|结论|总结|交付|建议|风险|验收|##|###|1\.|2\.|3\.)/i.test(normalized);
  return draftSignals && !deliverableSignals;
}

function excerpt(text: string, limit = 1200) {
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function toUsageNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return value >= 0 ? value : undefined;
}

function normalizeTokenUsage(raw: unknown): TokenUsage | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const usage = raw as Record<string, unknown>;
  const promptTokens = toUsageNumber(usage.prompt_tokens ?? usage.promptTokens);
  const completionTokens = toUsageNumber(usage.completion_tokens ?? usage.completionTokens);
  const totalTokens = toUsageNumber(usage.total_tokens ?? usage.totalTokens);
  if (
    typeof promptTokens !== "number"
    && typeof completionTokens !== "number"
    && typeof totalTokens !== "number"
  ) {
    return undefined;
  }
  return { promptTokens, completionTokens, totalTokens };
}

function hashText(text: string) {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

function isDuplicatedByHalves(text: string) {
  if (!text || text.length % 2 !== 0) {
    return false;
  }
  const half = text.length / 2;
  return text.slice(0, half) === text.slice(half);
}

function buildMessageHistoryTrace(messages: ChatMessage[]) {
  return messages.map((item) => {
    if (item.role === "system" || item.role === "user") {
      return {
        role: item.role,
        content: excerpt(item.content),
      };
    }
    if (item.role === "assistant") {
      return {
        role: item.role,
        content: excerpt(item.content ?? ""),
        toolCalls: item.tool_calls?.map((call) => ({
          id: call.id,
          name: call.function.name,
        })),
      };
    }
    return {
      role: item.role,
      toolCallId: item.tool_call_id,
      content: excerpt(item.content ?? ""),
    };
  });
}

/** Parse OpenAI-compatible SSE stream, yielding content/tool_call deltas */
async function* parseSSEStream(body: ReadableStream<Uint8Array>): AsyncGenerator<{ delta?: StreamDelta; usage?: TokenUsage }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") return;
        try {
          const parsed = JSON.parse(data) as { choices?: Array<{ delta?: StreamDelta }>; usage?: unknown };
          const usage = normalizeTokenUsage(parsed.usage);
          const delta = parsed.choices?.[0]?.delta;
          if (delta || usage) {
            yield { delta, usage };
          }
        } catch {
          // skip malformed SSE lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export class LLMChatAdapter implements AgentAdapter {
  constructor(private readonly config: LLMConfig) {}

  private async forceFinalize(
    messages: ChatMessage[],
    model: string,
    timeoutMs: number,
    requestPath: string,
  ): Promise<string> {
    const requestUrl = `${this.config.baseURL}${requestPath}`;
    const finalizeMessages: ChatMessage[] = [
      ...messages,
      {
        role: "user",
        content:
          "请不要再调用工具，不要描述你将要做什么。请基于已有信息直接给出最终完整答案（可执行、结构化、可交付）。",
      },
    ];
    const body = {
      model,
      temperature: 0.2,
      messages: finalizeMessages,
      stream: false,
    };
    const res = await fetch(requestUrl, {
      method: "POST",
      headers: buildAuthHeaders(this.config.provider, this.config.apiKey),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      return "";
    }
    const rawBody = await res.text().catch(() => "");
    try {
      const data = JSON.parse(rawBody) as ChatCompletionResponse;
      const content = data.choices?.[0]?.message?.content ?? "";
      return stripThinkBlocks(content).trim();
    } catch {
      return "";
    }
  }

  private async recoverNonStreamCompletion(
    requestUrl: string,
    body: Record<string, unknown>,
    timeoutMs: number,
    round: number,
  ): Promise<{ status: number; rawBody: string; data: ChatCompletionResponse }> {
    const executeOnce = async () => {
      const res = await fetch(requestUrl, {
        method: "POST",
        headers: buildAuthHeaders(this.config.provider, this.config.apiKey),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const rawBody = await res.text().catch(() => "");
      if (!res.ok) {
        const snippet = summarizeRaw(rawBody, 240);
        const err = new Error(`LLM request failed: ${res.status}${snippet ? ` - ${snippet}` : ""}`);
        if (!isTransientHttpStatus(res.status)) {
          throw Object.assign(err, { permanent: true });
        }
        throw err;
      }
      if (!rawBody.trim()) {
        throw new Error("LLM response parse failed: empty body");
      }
      let data: ChatCompletionResponse;
      try {
        data = JSON.parse(rawBody) as ChatCompletionResponse;
      } catch {
        throw new Error(`LLM response parse failed: ${summarizeRaw(rawBody, 240) || "empty body"}`);
      }
      return { status: res.status, rawBody, data };
    };

    const retry = await withRetry(executeOnce, { maxRetries: 2, baseDelayMs: 1200 }, (attempt, error, delayMs) => {
      console.warn("[LLM][parse-retry]", {
        runId: this.config.runId,
        nodeId: this.config.nodeId,
        round,
        attempt,
        delayMs,
        error: error.message.slice(0, 220),
      });
    });

    if (!retry.ok) {
      throw retry.error ?? new Error("LLM parse recovery failed");
    }
    return retry.value!;
  }

  async run(input: AgentExecutionInput): Promise<AgentExecutionOutput> {
    const latestHuman = input.context.humanMessages.at(-1)?.content?.trim() ?? "";
    const structuredToolDirective = parseToolDirective(latestHuman) || parseToolDirective(input.resolvedInput);
    if (structuredToolDirective) {
      const toolResult = await input.invokeTool({
        toolId: structuredToolDirective.toolId,
        input: structuredToolDirective.input,
      });
      const finalText = toolResult.ok
        ? JSON.stringify(toolResult.data ?? {})
        : toolResult.error?.message ?? "Structured tool action failed.";
      return {
        latestOutput: finalText,
        finalOutput: input.node.role === "summarizer" || input.node.role === "output" ? finalText : undefined,
      };
    }

    if (input.node.role === "router") {
      const inbound = input.context.inboundMessages.at(-1)?.content?.trim() ?? "";
      const routerSource = [latestHuman, inbound, input.resolvedInput].filter(Boolean).join("\n");
      const condition = inferRouterCondition(routerSource);
      const forwarded = input.resolvedInput || inbound || latestHuman || "Router forwarded current context.";
      return {
        latestOutput: `Router selected branch: ${condition}`,
        outboundMessages: [
          {
            toNodeId: "",
            type: input.context.inboundMessages.at(-1)?.type ?? "task_assignment",
            content: forwarded,
          },
        ],
        condition,
      };
    }

    const prompt = buildPrompt(input);
    const tools = input.availableTools.map((tool, index) => ({
      tool,
      apiName: toSafeToolName(tool.toolId, index),
    }));
    const toolByApiName = new Map<string, ResolvedTool>(tools.map((item) => [item.apiName, item.tool]));

    const systemInstruction =
      "When tools are available, decide autonomously whether to call them. " +
      "You may call tools multiple times in sequence to complete complex tasks. " +
      "For latest/current/web/news/paper requests, call search/retrieval tools before answering. " +
      "If user asks to save to local path, call a save tool and include saved path in final answer. " +
      "When you have gathered enough information, return your final answer directly without calling more tools. " +
      "Do not stop at analysis intent (e.g., 'I will analyze...'); output the final deliverable content.";
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: [prompt.system, systemInstruction].filter(Boolean).join("\n\n"),
      },
      { role: "user", content: prompt.user },
    ];

    // Agentic tool loop: configurable max rounds (default 10, cap 20)
    const configuredMaxRounds = input.maxToolRounds ?? 10;
    const maxToolRounds = Math.min(Math.max(configuredMaxRounds, 1), 20);
    let latestText = "";
    // Use streaming only on final-answer rounds (when streamTokens is provided)
    const hasStreamCallback = Boolean(input.streamTokens);
    // Loop detection: track consecutive identical tool calls
    let lastToolCallSignature = "";
    let consecutiveIdenticalCalls = 0;
    const MAX_CONSECUTIVE_IDENTICAL = 3;

    for (let round = 0; round <= maxToolRounds; round += 1) {
      // Check token budget before each LLM request
      if (input.checkBudget) {
        const budgetResult = input.checkBudget();
        if (!budgetResult.allowed) {
          const finalText = latestText || budgetResult.reason || "Token 预算耗尽，停止执行。";
          if (hasStreamCallback) input.streamTokens?.(finalText);
          return {
            latestOutput: finalText,
            finalOutput: input.node.role === "summarizer" ? finalText : undefined,
          };
        }
      }

      const requestPath = "/chat/completions";
      const requestUrl = `${this.config.baseURL}${requestPath}`;

      // Stream only when:
      // 1. streamTokens callback is provided, AND
      // 2. This is the final forced round (maxToolRounds reached) — we can't predict
      //    if LLM will call tools or return text, so we stream on forced-final round.
      // For earlier rounds, non-streaming is used so tool calls can be parsed atomically.
      const useStream = hasStreamCallback && round === maxToolRounds;

      const body = {
        model: input.definition.model ?? this.config.model,
        temperature: input.definition.temperature ?? 0.3,
        messages,
        stream: useStream,
        ...(useStream ? { stream_options: { include_usage: true } } : {}),
        ...(tools.length > 0
          ? {
              tools: tools.map((item) => ({
                type: "function",
                function: {
                  name: item.apiName,
                  description: item.tool.description || item.tool.name,
                  parameters: normalizeToolParameters(item.tool.inputSchema),
                },
              })),
              tool_choice: "auto",
            }
          : {}),
      };
      const toolsCount = tools.length;
      const messagesCount = messages.length;

      console.info("[LLM][request]", {
        runId: this.config.runId,
        nodeId: this.config.nodeId,
        provider: this.config.provider ?? "unknown",
        baseURL: this.config.baseURL,
        model: body.model,
        requestPath,
        messagesCount,
        toolsCount,
        stream: useStream,
        round,
      });
      input.emitLifecycleEvent?.("llm_request_sent", {
        provider: this.config.provider ?? "unknown",
        baseURL: this.config.baseURL,
        model: body.model,
        requestPath,
        messagesCount,
        toolsCount,
        stream: useStream,
        round,
        promptTrace: {
          systemPrompt: prompt.system ? excerpt(prompt.system, 4000) : undefined,
          userPrompt: prompt.user ? excerpt(prompt.user, 4000) : undefined,
          messageHistory: buildMessageHistoryTrace(messages),
        },
      });

      // Circuit breaker check
      const circuitKey = serviceKeyFromUrl(this.config.baseURL);
      const circuitCheck = llmCircuitBreaker.canRequest(circuitKey);
      if (!circuitCheck.allowed) {
        const cbText = latestText || circuitCheck.reason || "LLM 服务熔断中，请稍后重试。";
        if (hasStreamCallback) input.streamTokens?.(cbText);
        return {
          latestOutput: cbText,
          finalOutput: input.node.role === "summarizer" ? cbText : undefined,
        };
      }

      const timeoutMs = this.config.requestTimeoutMs ?? 90_000;
      const fetchFn = async (): Promise<Response> => {
        const res = await fetch(requestUrl, {
          method: "POST",
          headers: buildAuthHeaders(this.config.provider, this.config.apiKey),
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) {
          const rawErr = await res.text().catch(() => "");
          const snippet = summarizeRaw(rawErr, 240);
          const err = new Error(`LLM request failed: ${res.status}${snippet ? ` - ${snippet}` : ""}`);
          // Attach status for transient classification
          if (isTransientHttpStatus(res.status)) {
            throw err;
          }
          // Non-transient HTTP errors: throw directly (will not be retried)
          throw Object.assign(err, { permanent: true });
        }
        return res;
      };

      const retryResult = await withRetry(fetchFn, { maxRetries: 3, baseDelayMs: 1200 }, (attempt, error, delayMs) => {
        console.warn("[LLM][retry]", {
          runId: this.config.runId,
          nodeId: this.config.nodeId,
          round,
          attempt,
          delayMs,
          error: error.message.slice(0, 200),
        });
      });

      if (!retryResult.ok) {
        llmCircuitBreaker.onFailure(circuitKey, retryResult.error?.message);
        const err = retryResult.error!;
        if (err.name === "TimeoutError" || err.message.includes("timeout")) {
          throw new Error(`LLM request timed out after ${retryResult.attempts} attempt(s) (> ${timeoutMs / 1000}s)`);
        }
        throw new Error(`LLM request failed after ${retryResult.attempts} attempt(s): ${err.message}`);
      }
      llmCircuitBreaker.onSuccess(circuitKey);
      const response = retryResult.value!;

      // ---------- Streaming path ----------
      if (useStream && response.body) {
        const toolCallAccumulator = new Map<number, { id: string; name: string; args: string }>();
        let streamedText = "";
        let streamChunkCount = 0;
        let streamedUsage: TokenUsage | undefined;

        for await (const chunk of parseSSEStream(response.body)) {
          if (chunk.usage) {
            streamedUsage = chunk.usage;
          }
          const delta = chunk.delta;
          if (!delta) {
            continue;
          }
          if (delta.content) {
            streamChunkCount += 1;
            streamedText += delta.content;
            input.streamTokens?.(delta.content);
          }
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const existing = toolCallAccumulator.get(tc.index) ?? { id: "", name: "", args: "" };
              toolCallAccumulator.set(tc.index, {
                id: tc.id ?? existing.id,
                name: existing.name + (tc.function?.name ?? ""),
                args: existing.args + (tc.function?.arguments ?? ""),
              });
            }
          }
        }

        if (streamedText) latestText = streamedText;

        const finalText = latestText || "LLM returned no content.";
        const usagePayload = streamedUsage
          ? {
              tokenUsage: streamedUsage,
              promptTokens: streamedUsage.promptTokens,
              completionTokens: streamedUsage.completionTokens,
              totalTokens: streamedUsage.totalTokens,
            }
          : {};
        console.info("[LLM][stream_assembled]", {
          runId: this.config.runId,
          nodeId: this.config.nodeId,
          provider: this.config.provider ?? "unknown",
          model: body.model,
          round,
          streamChunkCount,
          assembledLength: finalText.length,
          assembledHash: hashText(finalText),
          assembledDuplicatedByHalves: isDuplicatedByHalves(finalText),
          tokenUsage: streamedUsage,
        });
        input.emitLifecycleEvent?.("llm_response_received", {
          provider: this.config.provider ?? "unknown",
          baseURL: this.config.baseURL,
          model: body.model,
          requestPath,
          status: response.status,
          ok: true,
          stream: true,
          round,
          completion: excerpt(finalText, 4000),
          ...usagePayload,
        });
        return {
          latestOutput: finalText,
          finalOutput: input.node.role === "summarizer" ? finalText : undefined,
        };
      }

      // ---------- Non-streaming path ----------
      let rawBody = await response.text().catch(() => "");
      console.info("[LLM][response]", {
        runId: this.config.runId,
        nodeId: this.config.nodeId,
        provider: this.config.provider ?? "unknown",
        baseURL: this.config.baseURL,
        model: body.model,
        requestPath,
        status: response.status,
        ok: response.ok,
        rawBodyLength: rawBody.length,
        rawBodyHash: hashText(rawBody),
        rawBodySummary: summarizeRaw(rawBody),
        round,
      });
      let data: ChatCompletionResponse;
      try {
        if (!rawBody.trim()) {
          throw new Error("empty body");
        }
        data = JSON.parse(rawBody) as ChatCompletionResponse;
      } catch {
        const recovered = await this.recoverNonStreamCompletion(requestUrl, body as Record<string, unknown>, timeoutMs, round);
        rawBody = recovered.rawBody;
        data = recovered.data;
      }
      const assistantMessage = data.choices?.[0]?.message;
      const assistantText = stripThinkBlocks((assistantMessage?.content ?? "").trim());
      const tokenUsage = normalizeTokenUsage(data.usage);
      input.emitLifecycleEvent?.("llm_response_received", {
        provider: this.config.provider ?? "unknown",
        baseURL: this.config.baseURL,
        model: body.model,
        requestPath,
        status: response.status,
        ok: response.ok,
        rawBodySummary: summarizeRaw(rawBody),
        round,
        completion: assistantText ? excerpt(assistantText, 4000) : undefined,
        tokenUsage,
        promptTokens: tokenUsage?.promptTokens,
        completionTokens: tokenUsage?.completionTokens,
        totalTokens: tokenUsage?.totalTokens,
      });
      if (assistantText) {
        latestText = assistantText;
      }
      console.info("[LLM][response_text]", {
        runId: this.config.runId,
        nodeId: this.config.nodeId,
        provider: this.config.provider ?? "unknown",
        model: body.model,
        round,
        textLength: assistantText.length,
        textHash: hashText(assistantText),
        textDuplicatedByHalves: isDuplicatedByHalves(assistantText),
      });

      const toolCalls = assistantMessage?.tool_calls ?? [];
      messages.push({
        role: "assistant",
        content: assistantText,
        ...(toolCalls.length > 0
          ? {
              tool_calls: toolCalls
                .filter((call) => call.function?.name)
                .map((call, index) => ({
                  id: call.id || `tool_call_${round}_${index}`,
                  type: "function" as const,
                  function: {
                    name: call.function?.name || "",
                    arguments: call.function?.arguments || "{}",
                  },
                })),
            }
          : {}),
      });

      if (toolCalls.length === 0) {
        const finalText = latestText || "LLM returned no content.";
        // Emit streaming tokens from full text when callback provided but we're in non-stream round
        if (hasStreamCallback && finalText) {
          input.streamTokens?.(finalText);
        }
        return {
          latestOutput: finalText,
          finalOutput: input.node.role === "summarizer" ? finalText : undefined,
        };
      }

      // Build a signature of this round's tool calls for loop detection
      const roundSignature = toolCalls
        .map((c) => `${c.function?.name ?? ""}:${c.function?.arguments ?? ""}`)
        .join("|");

      if (roundSignature === lastToolCallSignature && roundSignature !== "") {
        consecutiveIdenticalCalls++;
        if (consecutiveIdenticalCalls >= MAX_CONSECUTIVE_IDENTICAL) {
          console.warn("[LLM] Loop detected: identical tool calls repeated", {
            round,
            signature: roundSignature.slice(0, 200),
          });
          // Force return whatever we have
          const finalText = latestText || "Agent 检测到工具调用循环，已终止执行。";
          if (hasStreamCallback) input.streamTokens?.(finalText);
          return {
            latestOutput: finalText,
            finalOutput: input.node.role === "summarizer" ? finalText : undefined,
          };
        }
      } else {
        consecutiveIdenticalCalls = 1;
        lastToolCallSignature = roundSignature;
      }

      for (let index = 0; index < toolCalls.length; index += 1) {
        const call = toolCalls[index];
        const toolCallId = call.id || `tool_call_${round}_${index}`;
        const apiName = call.function?.name || "";
        const resolvedTool = toolByApiName.get(apiName) ?? input.availableTools.find((item) => item.toolId === apiName);

        const toolResult = resolvedTool
          ? await input.invokeTool({
              toolId: resolvedTool.toolId,
              input: parseToolArguments(call.function?.arguments),
            })
          : {
              ok: false,
              durationMs: 0,
              error: {
                code: "TOOL_NOT_FOUND",
                message: `Model requested an unregistered tool: ${apiName}`,
                retriable: false,
                source: "platform" as const,
              },
            };

        messages.push({
          role: "tool",
          tool_call_id: toolCallId,
          content: JSON.stringify(toolResult),
        });
      }

      // Emit tool_round_completed event for UI tracking
      input.emitLifecycleEvent?.("llm_response_received", {
        provider: this.config.provider ?? "unknown",
        baseURL: this.config.baseURL,
        model: body.model,
        requestPath,
        status: response.status,
        ok: true,
        stream: false,
        round,
        toolRoundCompleted: true,
        toolCallCount: toolCalls.length,
        toolNames: toolCalls.map((c) => c.function?.name ?? "").filter(Boolean),
      });
    }

    // If we exhausted all rounds, return what we have
    let exhaustedText = latestText || "LLM tool-call rounds exhausted.";
    if (looksLikeDraftOnly(exhaustedText) || exhaustedText.includes("tool-call rounds exhausted")) {
      const finalized = await this.forceFinalize(
        messages,
        input.definition.model ?? this.config.model,
        this.config.requestTimeoutMs ?? 60_000,
        "/chat/completions",
      );
      if (finalized) {
        exhaustedText = finalized;
      }
    }
    if (hasStreamCallback) input.streamTokens?.(exhaustedText);
    return {
      latestOutput: exhaustedText,
      finalOutput: input.node.role === "summarizer" ? exhaustedText : undefined,
    };
  }
}
