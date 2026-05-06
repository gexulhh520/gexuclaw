import OpenAI from "openai";
import type { ToolDefinition } from "../tools/tool-types.js";
import type {
  ChatMessage,
  ModelClientInput,
  ModelClientResult,
  ModelToolCall,
} from "./model-client.js";
import type { OpenAICompatibleProviderConfig } from "./provider-config.js";

type OpenAICompatibleToolCall = {
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
};

export class OpenAICompatibleProvider {
  private readonly client: OpenAI;

  constructor(private readonly config: OpenAICompatibleProviderConfig) {
    if (!config.baseURL) {
      throw new Error(`Missing baseURL for provider: ${config.provider}`);
    }

    if (!config.apiKey) {
      throw new Error(`Missing API key for provider: ${config.provider}`);
    }

    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      timeout: config.timeoutMs,
      maxRetries: config.maxRetries,
    });
  }

  async invoke(input: ModelClientInput): Promise<ModelClientResult> {
    const startedAt = Date.now();

    const messages = this.normalizeMessages(input.messages);
    const tools = this.normalizeTools(input.tools);
    const params = this.stripInternalParams(input.params);

    const body: Record<string, unknown> = {
      model: input.modelName,
      messages,
      ...params,
    };

    if (tools.length > 0) {
      body.tools = tools;
    } else if (!this.config.omitEmptyTools) {
      body.tools = [];
    }

    const timeoutMs = this.resolveTimeoutMs(input.params);

    console.log("[OpenAICompatibleProvider] request start", {
      provider: this.config.provider,
      modelName: input.modelName,
      messageCount: messages.length,
      toolCount: tools.length,
      bodyChars: JSON.stringify(body).length,
      timeoutMs,
    });

    try {
      const completion = await this.client.chat.completions.create(
        body as never,
        {
          timeout: timeoutMs,
          maxRetries: this.config.maxRetries,
        }
      );

      const message = completion.choices[0]?.message as
        | {
            content?: string | null;
            tool_calls?: OpenAICompatibleToolCall[];
            reasoning_content?: string;
          }
        | undefined;

      console.log("[OpenAICompatibleProvider] response message:", message);
      console.log("[OpenAICompatibleProvider] request done", {
        provider: this.config.provider,
        modelName: input.modelName,
        elapsedMs: Date.now() - startedAt,
        hasContent: !!message?.content,
        toolCallCount: message?.tool_calls?.length ?? 0,
      });
      console.log("[OpenAICompatibleProvider] content:", typeof message?.content === "string" ? message.content : "",);
      return {
        content: typeof message?.content === "string" ? message.content : "",
        reasoningContent:
          typeof message?.reasoning_content === "string"
            ? message.reasoning_content
            : undefined,
        toolCalls: this.parseToolCalls(message?.tool_calls ?? []),
        usage: {
          inputTokens: completion.usage?.prompt_tokens,
          outputTokens: completion.usage?.completion_tokens,
        },
        raw: completion,
      };
    } catch (error) {
      console.error("[OpenAICompatibleProvider] request failed", {
        provider: this.config.provider,
        modelName: input.modelName,
        elapsedMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  }

  private normalizeMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
    return messages.map((message) => {
      const normalized: Record<string, unknown> = {
        role: message.role,
        content: message.content ?? "",
      };

      if (message.tool_call_id) {
        normalized.tool_call_id = message.tool_call_id;
      }

      if (message.tool_calls?.length) {
        normalized.tool_calls = message.tool_calls;
      }

      if (
        message.reasoning_content &&
        !this.config.stripReasoningContentFromInput
      ) {
        normalized.reasoning_content = message.reasoning_content;
      }

      return normalized;
    });
  }

  private normalizeTools(tools: ToolDefinition[]): ToolDefinition[] {
    if (!tools.length) return [];

    if (!this.config.supportsTools) {
      return [];
    }

    return tools;
  }

  private stripInternalParams(params: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(params || {})) {
      if (value === undefined || value === null) continue;

      if (key === "timeoutMs") continue;

      result[key] = value;
    }

    return result;
  }

  private resolveTimeoutMs(params: Record<string, unknown>): number {
    const raw = params?.timeoutMs;

    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
      return raw;
    }

    return this.config.timeoutMs;
  }

  private parseToolCalls(toolCalls: OpenAICompatibleToolCall[]): ModelToolCall[] {
    return toolCalls
      .filter((toolCall) => toolCall.function?.name)
      .map((toolCall, index) => ({
        id: toolCall.id ?? `tool_call_${index + 1}`,
        name: toolCall.function?.name ?? "",
        arguments: this.parseToolArguments(toolCall.function?.arguments),
      }));
  }

  private parseToolArguments(value: string | undefined): Record<string, unknown> {
    if (!value) return {};

    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
}
