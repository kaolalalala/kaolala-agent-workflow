import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configService } from "@/server/config/config-service";
import { callLLMWithUsage } from "@/server/meta-agent/llm-helper";

describe("llm helper retry behavior", () => {
  const originalFetch = global.fetch;
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  beforeEach(() => {
    configService.resetForTests();
    const credential = configService.createCredential({
      provider: "MiniMax",
      label: "minimax-test",
      apiKey: "sk-minimax-test",
    });

    configService.updateWorkspaceConfig({
      defaultProvider: "MiniMax",
      defaultModel: "MiniMax-M2.5",
      defaultCredentialId: credential.id,
      defaultBaseUrl: "https://api.minimax.chat/v1",
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    warnSpy.mockClear();
    vi.restoreAllMocks();
  });

  it("retries when the provider returns HTTP 200 with an empty body", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("", { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [
          {
            message: {
              content: "{\"todos\":[]}",
            },
          },
        ],
        usage: {
          prompt_tokens: 11,
          completion_tokens: 7,
          total_tokens: 18,
        },
      }), { status: 200 }));
    global.fetch = fetchMock as typeof global.fetch;

    const result = await callLLMWithUsage([
      { role: "system", content: "Return JSON only." },
      { role: "user", content: "Generate an empty todo list." },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.content).toBe("{\"todos\":[]}");
    expect(result.usage.total_tokens).toBe(18);
    expect(warnSpy).toHaveBeenCalled();
  });
});
