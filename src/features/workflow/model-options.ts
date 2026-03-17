export interface ProviderOption {
  value: string;
  label: string;
}

export const COMMON_PROVIDERS: ProviderOption[] = [
  { value: "openai", label: "OpenAI" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "minimax", label: "MiniMax" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "glm", label: "GLM" },
  { value: "qwen", label: "Qwen" },
  { value: "anthropic", label: "Anthropic" },
  { value: "custom", label: "自定义" },
];

export const PROVIDER_MODELS: Record<string, string[]> = {
  openai: ["gpt-4.1", "gpt-4o", "gpt-4o-mini"],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  minimax: [
    "MiniMax-M2.5",
    "MiniMax-M2.5-highspeed",
    "MiniMax-M2.5-Lightning",
    "MiniMax-M1",
    "MiniMax-Text-01",
  ],
  openrouter: ["openai/gpt-4.1", "deepseek/deepseek-chat", "google/gemini-2.0-flash-001"],
  glm: ["glm-4.5", "glm-4.5-air", "glm-4-flash"],
  qwen: ["qwen-plus", "qwen-max", "qwen-turbo"],
  anthropic: ["claude-3-7-sonnet", "claude-3-5-sonnet", "claude-3-5-haiku"],
  custom: [],
};
