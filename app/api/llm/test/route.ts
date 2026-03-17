import { NextResponse } from "next/server";

import { configService } from "@/server/config/config-service";

function summarizeRaw(text: string, limit = 400) {
  return text.replace(/\s+/g, " ").slice(0, limit);
}

async function runProbe(input?: { prompt?: string; timeoutMs?: number }) {
  try {
    const payload = input ?? {};
    const prompt = String(payload.prompt || "Diagnostic test: reply with exactly pong.").trim();
    const timeoutMs = Number(payload.timeoutMs || 40_000);

    const workspace = configService.ensureWorkspaceConfig();
    const provider = workspace.defaultProvider || "mock";
    const baseURL = workspace.defaultBaseUrl || "";
    const model = workspace.defaultModel || "mock-agent-v1";
    const apiKey = configService.resolveCredentialApiKey(workspace.defaultCredentialId);
    const requestPath = "/chat/completions";

    if (!baseURL || !apiKey) {
      return NextResponse.json(
        {
          ok: false,
          error: "Workspace config is missing usable baseURL or credential apiKey.",
          diagnostics: {
            provider,
            baseURL,
            model,
            requestPath,
            messagesCount: 1,
            toolsCount: 0,
            stream: false,
          },
        },
        { status: 400 },
      );
    }

    const requestUrl = `${baseURL.replace(/\/$/, "")}${requestPath}`;
    const body = {
      model,
      temperature: workspace.defaultTemperature ?? 0.2,
      messages: [{ role: "user", content: prompt }],
    };

    console.info("[LLM][probe-request]", {
      provider,
      baseURL,
      model,
      requestPath,
      messagesCount: body.messages.length,
      toolsCount: 0,
      stream: false,
      timeoutMs,
    });

    const response = await fetch(requestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const rawBody = await response.text().catch(() => "");
    const rawSummary = summarizeRaw(rawBody);

    console.info("[LLM][probe-response]", {
      provider,
      baseURL,
      model,
      requestPath,
      status: response.status,
      ok: response.ok,
      rawBodySummary: rawSummary,
    });

    let parsed: unknown = null;
    try {
      parsed = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      parsed = null;
    }

    return NextResponse.json(
      {
        ok: response.ok,
        status: response.status,
        diagnostics: {
          provider,
          baseURL,
          model,
          requestPath,
          messagesCount: body.messages.length,
          toolsCount: 0,
          stream: false,
        },
        rawBodySummary: rawSummary,
        parsed,
      },
      { status: response.ok ? 200 : 502 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as { prompt?: string; timeoutMs?: number };
  return runProbe(payload);
}

export async function GET() {
  return runProbe();
}

