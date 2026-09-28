import type { ResolvedAgentExecutionConfig } from "@/server/config/config-resolver";
import { configService } from "@/server/config/config-service";

export interface StrictWorkspaceLLMConfig {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  credentialId: string;
  defaultTemperature?: number;
}

export interface StrictExecutionLLMConfig {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
}

function normalize(value?: string) {
  return value?.trim() ?? "";
}

function shouldAutoProvisionVitestConfig() {
  return process.env.VITEST === "true";
}

function ensureVitestWorkspaceConfig() {
  if (!shouldAutoProvisionVitestConfig()) {
    return null;
  }

  const workspace = configService.ensureWorkspaceConfig();
  const provider = normalize(workspace.defaultProvider).toLowerCase();
  const model = normalize(workspace.defaultModel);
  const baseUrl = normalize(workspace.defaultBaseUrl);
  const credentialId = normalize(workspace.defaultCredentialId);
  const apiKey = normalize(configService.resolveCredentialApiKey(credentialId));
  const hasUsableConfig = Boolean(
    provider &&
    provider !== "mock" &&
    model &&
    (baseUrl || defaultBaseUrlForProvider(provider)) &&
    credentialId &&
    apiKey,
  );

  if (hasUsableConfig) {
    return {
      provider,
      model,
      baseUrl: baseUrl || defaultBaseUrlForProvider(provider),
      apiKey,
    };
  }

  const existing = configService.listCredentials().find((item) => item.label === "__vitest_llm__");
  const credential = existing ?? configService.createCredential({
    provider: "openai",
    label: "__vitest_llm__",
    apiKey: "sk-vitest-llm",
  });

  const updated = configService.updateWorkspaceConfig({
    defaultProvider: "openai",
    defaultModel: "gpt-4.1-mini",
    defaultBaseUrl: "https://test-llm.local/v1",
    defaultCredentialId: credential.id,
    defaultTemperature: typeof workspace.defaultTemperature === "number" ? workspace.defaultTemperature : 0.2,
  });

  return {
    provider: "openai",
    model: updated.defaultModel ?? "gpt-4.1-mini",
    baseUrl: updated.defaultBaseUrl ?? "https://test-llm.local/v1",
    apiKey: normalize(configService.resolveCredentialApiKey(updated.defaultCredentialId)) || "sk-vitest-llm",
  };
}

export function defaultBaseUrlForProvider(provider: string) {
  switch (provider.trim().toLowerCase()) {
    case "openai":
      return "https://api.openai.com/v1";
    case "minimax":
      return "https://api.minimax.chat/v1";
    case "openrouter":
      return "https://openrouter.ai/api/v1";
    case "deepseek":
      return "https://api.deepseek.com/v1";
    case "anthropic":
      return "https://api.anthropic.com/v1";
    default:
      return "";
  }
}

function assertProvider(scope: string, provider: string) {
  if (!provider) {
    throw new Error(`${scope} LLM provider is not configured.`);
  }
  if (provider === "mock") {
    throw new Error(`${scope} mock provider has been disabled. Please configure a real LLM provider.`);
  }
}

export function resolveStrictWorkspaceLLMConfig(): StrictWorkspaceLLMConfig {
  const vitestFallback = ensureVitestWorkspaceConfig();
  const workspace = configService.ensureWorkspaceConfig();
  const explicitProvider = normalize(workspace.defaultProvider).toLowerCase();
  const provider = normalize(workspace.defaultProvider || vitestFallback?.provider).toLowerCase();
  assertProvider("Workspace", provider);

  const model = normalize(workspace.defaultModel || vitestFallback?.model);
  if (!model) {
    throw new Error("Workspace LLM model is not configured.");
  }

  const configuredBaseUrl = normalize(workspace.defaultBaseUrl);
  const defaultProviderBaseUrl = defaultBaseUrlForProvider(provider);
  const baseUrl = explicitProvider
    ? configuredBaseUrl || defaultProviderBaseUrl || normalize(vitestFallback?.baseUrl)
    : configuredBaseUrl || normalize(vitestFallback?.baseUrl) || defaultProviderBaseUrl;
  if (!baseUrl) {
    throw new Error(`Workspace base URL is not configured for provider "${provider}".`);
  }

  const credentialId = normalize(workspace.defaultCredentialId);
  if (!credentialId) {
    throw new Error("Workspace LLM credential is not configured.");
  }

  const apiKey = normalize(configService.resolveCredentialApiKey(credentialId) || vitestFallback?.apiKey);
  if (!apiKey) {
    throw new Error("Workspace LLM credential is missing API key.");
  }

  return {
    provider,
    model,
    baseUrl,
    apiKey,
    credentialId,
    defaultTemperature: workspace.defaultTemperature,
  };
}

export function resolveStrictExecutionLLMConfig(
  resolved: ResolvedAgentExecutionConfig,
  scope = `Node ${resolved.nodeId}`,
): StrictExecutionLLMConfig {
  const vitestFallback = ensureVitestWorkspaceConfig();
  const explicitProvider = normalize(resolved.provider).toLowerCase();
  const provider = normalize(resolved.provider || vitestFallback?.provider).toLowerCase();
  assertProvider(scope, provider);

  const model = normalize(resolved.model || vitestFallback?.model);
  if (!model) {
    throw new Error(`${scope} LLM model is not configured.`);
  }

  const configuredBaseUrl = normalize(resolved.baseUrl);
  const defaultProviderBaseUrl = defaultBaseUrlForProvider(provider);
  const baseUrl = explicitProvider
    ? configuredBaseUrl || defaultProviderBaseUrl || normalize(vitestFallback?.baseUrl)
    : configuredBaseUrl || normalize(vitestFallback?.baseUrl) || defaultProviderBaseUrl;
  if (!baseUrl) {
    throw new Error(`${scope} base URL is not configured for provider "${provider}".`);
  }

  const apiKey = normalize(resolved.apiKey || vitestFallback?.apiKey);
  if (!apiKey) {
    throw new Error(`${scope} API key is not configured.`);
  }

  return {
    provider,
    model,
    baseUrl,
    apiKey,
  };
}
