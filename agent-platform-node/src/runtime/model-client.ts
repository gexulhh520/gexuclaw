import type { ToolDefinition } from "../tools/tool-types.js";
import { OpenAICompatibleProvider } from "./openai-compatible-provider.js";
import {
  getProviderConfig,
  type OpenAICompatibleProviderConfig,
} from "./provider-config.js";

export type TextContentPart = {
  type: "text";
  text: string;
};

export type ImageUrlContentPart = {
  type: "image_url";
  image_url: {
    url: string;
  };
};

export type ChatContent = string | Array<TextContentPart | ImageUrlContentPart>;

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: ChatContent;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
  reasoning_content?: string;
};

export type ModelToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ModelClientInput = {
  provider: string;
  modelName: string;
  baseUrl?: string | null;
  params: Record<string, unknown>;
  messages: ChatMessage[];
  tools: ToolDefinition[];
};

export type ModelClientResult = {
  content: string;
  toolCalls: ModelToolCall[];
  reasoningContent?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  raw?: unknown;
};

export class ModelClient {
  private readonly providerCache = new Map<string, OpenAICompatibleProvider>();

  async invoke(input: ModelClientInput): Promise<ModelClientResult> {
    if (input.provider === "mock") {
      return this.invokeMock(input);
    }

    const config = getProviderConfig({
      provider: input.provider,
      baseUrl: input.baseUrl,
      modelName: input.modelName,
    });

    const normalizedInput = this.normalizeInput(input, config);

    const provider = this.getOpenAICompatibleProvider(config);

    return provider.invoke(normalizedInput);
  }

  async complete(input: {
    systemPrompt: string;
    userMessage: string;
    provider?: string;
    modelName?: string;
    baseUrl?: string | null;
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
  }): Promise<{ content: string }> {
    const providerName =
      input.provider || process.env.DEFAULT_MODEL_PROVIDER || "mock";

    if (providerName === "mock") {
      const result = await this.invoke({
        provider: "mock",
        modelName: "mock-model",
        params: {},
        messages: [
          { role: "system", content: input.systemPrompt },
          { role: "user", content: input.userMessage },
        ],
        tools: [],
      });

      return { content: result.content };
    }

    const config = getProviderConfig({
      provider: providerName,
      baseUrl: input.baseUrl,
      modelName: input.modelName,
    });
 //console.log("[MainAgent] getProviderConfig:", config);
    const result = await this.invoke({
      provider: providerName,
      modelName: input.modelName || config.defaultModel,
      baseUrl: config.baseURL,
      params: {
        temperature: input.temperature ?? 0.7,
        maxTokens: input.maxTokens ?? config.defaultMaxTokens ?? 1000,
        timeoutMs: input.timeoutMs ?? config.timeoutMs,
      },
      messages: [
        { role: "system", content: input.systemPrompt },
        { role: "user", content: input.userMessage },
      ],
      tools: [],
    });
    //console.log("[MainAgent] invoke result.content:", result.content);
    return { content: result.content };
  }

  private normalizeInput(
    input: ModelClientInput,
    config: OpenAICompatibleProviderConfig
  ): ModelClientInput {
    const modelName = input.modelName || config.defaultModel;

    if (!modelName) {
      throw new Error(`Missing modelName for provider: ${config.provider}`);
    }

    const params = this.normalizeParams(input.params, config, modelName);

    return {
      ...input,
      provider: config.provider,
      modelName,
      baseUrl: config.baseURL,
      params,
      messages: input.messages,
      tools: input.tools,
    };
  }

  private normalizeParams(
    params: Record<string, unknown>,
    config: OpenAICompatibleProviderConfig,
    modelName: string
  ): Record<string, unknown> {
    const normalized: Record<string, unknown> = {
      ...params,
    };

    if (normalized.timeoutMs === undefined) {
      normalized.timeoutMs = config.timeoutMs;
    }

    if (typeof normalized.maxTokens === "number") {
      normalized[config.maxTokensParamName] = normalized.maxTokens;
      delete normalized.maxTokens;
    }

    if (
      normalized[config.maxTokensParamName] === undefined &&
      typeof config.defaultMaxTokens === "number"
    ) {
      normalized[config.maxTokensParamName] = config.defaultMaxTokens;
    }

    if (config.provider === "kimi" && modelName === "kimi-k2.5") {
      normalized.temperature = 1;
    }

    return normalized;
  }

  private getOpenAICompatibleProvider(
    config: OpenAICompatibleProviderConfig
  ): OpenAICompatibleProvider {
    const cacheKey = [
      config.provider,
      config.baseURL,
      config.defaultModel,
    ].join("|");

    const cached = this.providerCache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const provider = new OpenAICompatibleProvider(config);
    this.providerCache.set(cacheKey, provider);

    return provider;
  }

  private invokeMock(input: ModelClientInput): ModelClientResult {
    const latestUser = contentToText(
      [...input.messages].reverse().find((message) => message.role === "user")?.content
    );

    const latestTool = contentToText(
      [...input.messages].reverse().find((message) => message.role === "tool")?.content
    );

    const systemMessage = contentToText(
      input.messages.find((message) => message.role === "system")?.content
    );

    const artifactDirectivesEnabled =
      systemMessage.includes("Artifact directives are enabled for this task.") ||
      systemMessage.includes("Artifact directives are enabled for this agent version.");

    if (latestTool) {
      const parsedTool = this.parseToolPayload(latestTool);
      const rawCandidates = Array.isArray(parsedTool?.artifactCandidates)
        ? parsedTool.artifactCandidates
        : [];

      const firstCandidate = rawCandidates[0] as Record<string, unknown> | undefined;
      const candidateId =
        typeof firstCandidate?.candidateId === "string"
          ? firstCandidate.candidateId
          : undefined;

      const directives = {
        artifactDecisions: candidateId
          ? [
              {
                candidateId,
                keep: true,
                artifactRole: "reference",
                title: "浏览页面快照",
              },
            ]
          : [],
        declaredArtifacts: [
          {
            artifactType: "text",
            artifactRole: "final",
            title: "Mock 结果摘要",
            contentText: `Mock flow completed for: ${latestUser}`,
          },
        ],
      };

      const content = artifactDirectivesEnabled
        ? `Mock flow completed for: ${latestUser}\n<artifact_directives>${JSON.stringify(
            directives
          )}</artifact_directives>`
        : `Mock flow completed for: ${latestUser}`;

      return {
        content,
        toolCalls: [],
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    if (
      input.tools.some((tool) => tool.function.name.includes("browser_open")) &&
      /baidu|百度|http/i.test(latestUser)
    ) {
      return {
        content: "I will open the requested page with the browser tool.",
        toolCalls: [
          {
            id: "mock_tool_call_browser_open",
            name: "browser_open",
            arguments: {
              url: latestUser.includes("百度")
                ? "https://www.baidu.com"
                : "https://example.com",
            },
          },
        ],
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    return {
      content: `Mock model response for: ${latestUser}`,
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  private parseToolPayload(value: string): Record<string, unknown> | null {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

export function contentToText(content: ChatContent | undefined): string {
  if (!content) return "";

  if (typeof content === "string") {
    return content;
  }

  return content
    .filter((part): part is TextContentPart => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}
