export type OpenAICompatibleProviderConfig = {
  provider: string;
  baseURL: string;
  apiKey?: string;
  defaultModel: string;

  supportsTools: boolean;
  supportsStream: boolean;

  omitEmptyTools: boolean;
  stripReasoningContentFromInput: boolean;
  mapDeveloperToSystem: boolean;

  maxTokensParamName: "max_tokens" | "max_completion_tokens";

  timeoutMs: number;
  maxRetries: number;

  defaultMaxTokens?: number;
};

export function getProviderConfig(input: {
  provider: string;
  baseUrl?: string | null;
  modelName?: string | null;
}): OpenAICompatibleProviderConfig {
  const provider = input.provider;

  switch (provider) {
    case "openai":
      return {
        provider,
        baseURL: input.baseUrl || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
        apiKey: process.env.OPENAI_API_KEY,
        defaultModel: input.modelName || process.env.OPENAI_DEFAULT_MODEL || "gpt-4o-mini",
        supportsTools: true,
        supportsStream: true,
        omitEmptyTools: true,
        stripReasoningContentFromInput: true,
        mapDeveloperToSystem: false,
        maxTokensParamName: "max_tokens",
        timeoutMs: Number(process.env.OPENAI_TIMEOUT_MS || 60_000),
        maxRetries: Number(process.env.OPENAI_MAX_RETRIES || 2),
        defaultMaxTokens: Number(process.env.OPENAI_DEFAULT_MAX_TOKENS || 2000),
      };

    case "deepseek":
      return {
        provider,
        baseURL: input.baseUrl || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
        apiKey: process.env.DEEPSEEK_API_KEY,
        defaultModel: input.modelName || process.env.DEEPSEEK_DEFAULT_MODEL || "deepseek-chat",
        supportsTools: true,
        supportsStream: true,
        omitEmptyTools: true,
        stripReasoningContentFromInput: true,
        mapDeveloperToSystem: true,
        maxTokensParamName: "max_tokens",
        timeoutMs: Number(process.env.DEEPSEEK_TIMEOUT_MS || 60_000),
        maxRetries: Number(process.env.DEEPSEEK_MAX_RETRIES || 2),
        defaultMaxTokens: Number(process.env.DEEPSEEK_DEFAULT_MAX_TOKENS || 86400),
      };

    case "kimi":
      return {
        provider,
        baseURL: input.baseUrl || process.env.KIMI_BASE_URL || "https://api.moonshot.cn/v1",
        apiKey: process.env.KIMI_API_KEY,
        defaultModel: input.modelName || process.env.KIMI_DEFAULT_MODEL || "moonshot-v1-8k",
        supportsTools: true,
        supportsStream: true,
        omitEmptyTools: true,
        stripReasoningContentFromInput: false,
        mapDeveloperToSystem: true,
        maxTokensParamName: "max_completion_tokens",
        timeoutMs: Number(process.env.KIMI_TIMEOUT_MS || 180_000),
        maxRetries: Number(process.env.KIMI_MAX_RETRIES || 2),
        defaultMaxTokens: Number(process.env.KIMI_DEFAULT_MAX_TOKENS || 86400),
      };

    case "openrouter":
      return {
        provider,
        baseURL: input.baseUrl || process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
        apiKey: process.env.OPENROUTER_API_KEY,
        defaultModel: input.modelName || process.env.OPENROUTER_DEFAULT_MODEL || "openai/gpt-4o-mini",
        supportsTools: true,
        supportsStream: true,
        omitEmptyTools: true,
        stripReasoningContentFromInput: true,
        mapDeveloperToSystem: true,
        maxTokensParamName: "max_tokens",
        timeoutMs: Number(process.env.OPENROUTER_TIMEOUT_MS || 60_000),
        maxRetries: Number(process.env.OPENROUTER_MAX_RETRIES || 2),
        defaultMaxTokens: Number(process.env.OPENROUTER_DEFAULT_MAX_TOKENS || 2000),
      };

    case "ollama":
      return {
        provider,
        baseURL: input.baseUrl || process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1",
        apiKey: process.env.OLLAMA_API_KEY || "ollama",
        defaultModel: input.modelName || process.env.OLLAMA_DEFAULT_MODEL || "llama3.1",
        supportsTools: false,
        supportsStream: true,
        omitEmptyTools: true,
        stripReasoningContentFromInput: true,
        mapDeveloperToSystem: true,
        maxTokensParamName: "max_tokens",
        timeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS || 120_000),
        maxRetries: Number(process.env.OLLAMA_MAX_RETRIES || 0),
        defaultMaxTokens: Number(process.env.OLLAMA_DEFAULT_MAX_TOKENS || 2000),
      };

    case "lmstudio":
      return {
        provider,
        baseURL: input.baseUrl || process.env.LMSTUDIO_BASE_URL || "http://localhost:1234/v1",
        apiKey: process.env.LMSTUDIO_API_KEY || "lmstudio",
        defaultModel: input.modelName || process.env.LMSTUDIO_DEFAULT_MODEL || "local-model",
        supportsTools: false,
        supportsStream: true,
        omitEmptyTools: true,
        stripReasoningContentFromInput: true,
        mapDeveloperToSystem: true,
        maxTokensParamName: "max_tokens",
        timeoutMs: Number(process.env.LMSTUDIO_TIMEOUT_MS || 120_000),
        maxRetries: Number(process.env.LMSTUDIO_MAX_RETRIES || 0),
        defaultMaxTokens: Number(process.env.LMSTUDIO_DEFAULT_MAX_TOKENS || 2000),
      };

    default:
      return {
        provider,
        baseURL: input.baseUrl || process.env[`${provider.toUpperCase()}_BASE_URL`] || "",
        apiKey: process.env[`${provider.toUpperCase()}_API_KEY`],
        defaultModel: input.modelName || process.env[`${provider.toUpperCase()}_DEFAULT_MODEL`] || "",
        supportsTools: true,
        supportsStream: true,
        omitEmptyTools: true,
        stripReasoningContentFromInput: true,
        mapDeveloperToSystem: true,
        maxTokensParamName: "max_tokens",
        timeoutMs: Number(process.env[`${provider.toUpperCase()}_TIMEOUT_MS`] || 60_000),
        maxRetries: Number(process.env[`${provider.toUpperCase()}_MAX_RETRIES`] || 2),
        defaultMaxTokens: Number(process.env[`${provider.toUpperCase()}_DEFAULT_MAX_TOKENS`] || 2000),
      };
  }
}
