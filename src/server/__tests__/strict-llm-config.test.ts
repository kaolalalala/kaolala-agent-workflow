import { beforeEach, describe, expect, it } from "vitest";

import { configService } from "@/server/config/config-service";
import {
  defaultBaseUrlForProvider,
  resolveStrictExecutionLLMConfig,
  resolveStrictWorkspaceLLMConfig,
} from "@/server/config/strict-llm-config";

describe("strict llm config", () => {
  beforeEach(() => {
    configService.resetForTests();
  });

  it("maps minimax to the default base url", () => {
    expect(defaultBaseUrlForProvider("MiniMax")).toBe("https://api.minimax.chat/v1");
  });

  it("resolves workspace minimax config without an explicit base url", () => {
    const credential = configService.createCredential({
      provider: "MiniMax",
      label: "minimax-test",
      apiKey: "sk-minimax-test",
    });

    configService.updateWorkspaceConfig({
      defaultProvider: "MiniMax",
      defaultModel: "MiniMax-M2.5",
      defaultCredentialId: credential.id,
      defaultBaseUrl: "",
    });

    const resolved = resolveStrictWorkspaceLLMConfig();
    expect(resolved.provider).toBe("minimax");
    expect(resolved.baseUrl).toBe("https://api.minimax.chat/v1");
    expect(resolved.apiKey).toBe("sk-minimax-test");
  });

  it("resolves execution minimax config without an explicit base url", () => {
    const resolved = resolveStrictExecutionLLMConfig({
      nodeId: "node_minimax",
      name: "MiniMax Node",
      systemPrompt: "You are connected.",
      provider: "MiniMax",
      model: "MiniMax-M2.5",
      apiKey: "sk-minimax-node",
      promptDocuments: [],
      skillDocuments: [],
      referenceDocuments: [],
    });

    expect(resolved.provider).toBe("minimax");
    expect(resolved.baseUrl).toBe("https://api.minimax.chat/v1");
    expect(resolved.apiKey).toBe("sk-minimax-node");
  });
});
