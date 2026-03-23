/**
 * LLM Helper — lightweight LLM call wrapper for Meta-Agent's own reasoning.
 *
 * Uses the workspace default model config (same model the user configured for their agents).
 * This keeps Meta-Agent's LLM calls simple and separate from the runtime engine.
 */
import { configService } from "@/server/config/config-service";

interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function callLLM(messages: LLMMessage[]): Promise<string> {
  const workspace = configService.ensureWorkspaceConfig();
  const provider = workspace.defaultProvider ?? "mock";
  const model = workspace.defaultModel ?? "mock-agent-v1";

  if (provider === "mock") {
    return "[Meta-Agent mock response — configure a real LLM provider in workspace settings to enable Meta-Agent reasoning]";
  }

  const apiKey = configService.resolveCredentialApiKey(workspace.defaultCredentialId) ?? "";

  const baseUrl = workspace.defaultBaseUrl ?? (
    provider === "openai" ? "https://api.openai.com/v1"
    : provider === "anthropic" ? "https://api.anthropic.com/v1"
    : provider === "deepseek" ? "https://api.deepseek.com/v1"
    : "https://api.openai.com/v1"
  );

  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (provider === "anthropic") {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.3,
        max_tokens: 4096,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`LLM call failed (${res.status}): ${text.slice(0, 200)}`);
    }

    const data = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content ?? "";
  } finally {
    clearTimeout(timeout);
  }
}
