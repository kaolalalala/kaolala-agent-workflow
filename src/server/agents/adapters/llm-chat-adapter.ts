import { AgentAdapter } from "@/server/agents/adapters/agent-adapter";
import { buildPrompt } from "@/server/agents/builder/prompt-builder";
import { AgentExecutionInput, AgentExecutionOutput } from "@/server/agents/types";
import type { ResolvedTool } from "@/server/tools/contracts";
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

function summarizeRaw(text: string, limit = 320) {
  return text.replace(/\s+/g, " ").slice(0, limit);
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

  async run(input: AgentExecutionInput): Promise<AgentExecutionOutput> {
    const prompt = buildPrompt(input);
    const tools = input.availableTools.map((tool, index) => ({
      tool,
      apiName: toSafeToolName(tool.toolId, index),
    }));
    const toolByApiName = new Map<string, ResolvedTool>(tools.map((item) => [item.apiName, item.tool]));

    const systemInstruction =
      "When tools are available, decide autonomously whether to call them. " +
      "For latest/current/web/news/paper requests, call search/retrieval tools before answering. " +
      "If user asks to save to local path, call a save tool and include saved path in final answer.";
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: [prompt.system, systemInstruction].filter(Boolean).join("\n\n"),
      },
      { role: "user", content: prompt.user },
    ];

    const maxToolRounds = 2;
    let latestText = "";
    // Use streaming only on final-answer rounds (when streamTokens is provided)
    const hasStreamCallback = Boolean(input.streamTokens);

    for (let round = 0; round <= maxToolRounds; round += 1) {
      const requestPath = "/chat/completions";
      const requestUrl = `${this.config.baseURL}${requestPath}`;

      // Stream on the last round when callback provided; non-streaming for tool-call rounds
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

      let response: Response;
      try {
        response = await fetch(requestUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.config.requestTimeoutMs ?? 60_000),
        });
      } catch (error) {
        if (error instanceof Error && error.name === "TimeoutError") {
          throw new Error(`LLM request timed out (> ${(this.config.requestTimeoutMs ?? 60_000) / 1000}s)`);
        }
        throw new Error(`LLM request failed: ${error instanceof Error ? error.message : String(error)}`);
      }

      if (!response.ok) {
        const rawErr = await response.text().catch(() => "");
        const snippet = summarizeRaw(rawErr, 240);
        throw new Error(`LLM request failed: ${response.status}${snippet ? ` - ${snippet}` : ""}`);
      }

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
      const rawBody = await response.text().catch(() => "");
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
        data = JSON.parse(rawBody) as ChatCompletionResponse;
      } catch {
        throw new Error(`LLM response parse failed: ${summarizeRaw(rawBody, 240) || "empty body"}`);
      }
      const assistantMessage = data.choices?.[0]?.message;
      const assistantText = (assistantMessage?.content ?? "").trim();
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
    }

    throw new Error("LLM tool-call rounds exceeded limit and were aborted.");
  }
}
