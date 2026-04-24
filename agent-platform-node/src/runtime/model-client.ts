import type { ToolDefinition } from "../tools/tool-types.js";

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
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
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  raw?: unknown;
};

type OpenAICompatibleToolCall = {
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
};

export class ModelClient {
  async invoke(input: ModelClientInput): Promise<ModelClientResult> {
    // mock provider 用来在没有 Kimi / OpenAI key 的情况下验证 Runtime 闭环。
    // 真实模型统一走 OpenAI-compatible 分支。
    if (input.provider === "mock") {
      return this.invokeMock(input);
    }

    return this.invokeOpenAICompatible(input);
  }

  private async invokeOpenAICompatible(input: ModelClientInput): Promise<ModelClientResult> {
    const apiKey = this.getApiKey(input.provider);
    const baseUrl = input.baseUrl ?? this.getBaseUrl(input.provider);

    if (!apiKey) {
      throw new Error(`Missing API key for provider: ${input.provider}`);
    }

    // Kimi、OpenAI 这类兼容 Chat Completions 的 provider 先共用同一套请求格式。
    // 后续如果某个厂商字段不同，只在这里做适配，不污染 AgentRuntime。
    const body = {
      model: input.modelName,
      messages: input.messages.map((message) => ({
        role: message.role,
        content: message.content,
        tool_call_id: message.tool_call_id,
        tool_calls: message.tool_calls,
      })),
      tools: input.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      })),
      ...input.params,
    };

    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const raw = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(`Model provider request failed: ${response.status} ${JSON.stringify(raw)}`);
    }

    const choice = (raw.choices as Array<Record<string, unknown>> | undefined)?.[0];
    const message = choice?.message as Record<string, unknown> | undefined;
    const usage = raw.usage as Record<string, number> | undefined;

    return {
      content: typeof message?.content === "string" ? message.content : "",
      toolCalls: this.parseToolCalls((message?.tool_calls as OpenAICompatibleToolCall[] | undefined) ?? []),
      usage: {
        inputTokens: usage?.prompt_tokens,
        outputTokens: usage?.completion_tokens,
      },
      raw,
    };
  }

  private invokeMock(input: ModelClientInput): ModelClientResult {
    const latestUser = [...input.messages].reverse().find((message) => message.role === "user")?.content ?? "";
    const latestTool = [...input.messages].reverse().find((message) => message.role === "tool")?.content ?? "";

    // mock 模型看到“百度 / baidu / http”时主动发起 browser.open，
    // 用来验证 tool call、allowed_tools 校验和 agent_run_steps 记录。
    // 一旦已经拿到 tool 结果，就返回最终总结，避免在 phase one 里重复死循环调用同一个工具。
    if (latestTool) {
      return {
        content: `Mock browser flow completed for: ${latestUser}`,
        toolCalls: [],
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    if (input.tools.some((tool) => tool.name === "browser.open") && /baidu|百度|http/i.test(latestUser)) {
      return {
        content: "I will open the requested page with the browser tool.",
        toolCalls: [
          {
            id: "mock_tool_call_browser_open",
            name: "browser.open",
            arguments: { url: latestUser.includes("百度") ? "https://www.baidu.com" : "https://example.com" },
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
      // 模型偶尔会返回非 JSON 参数。第一阶段先降级为空对象，
      // 后续可以在这里增加 repair 或 needs_clarification 策略。
      return {};
    }
  }

  private getApiKey(provider: string): string | undefined {
    // API key 只从环境变量读取，不进入数据库，避免敏感信息落库。
    if (provider === "kimi") return process.env.KIMI_API_KEY;
    if (provider === "openai") return process.env.OPENAI_API_KEY;
    return process.env[`${provider.toUpperCase()}_API_KEY`];
  }

  private getBaseUrl(provider: string): string {
    // Kimi 默认使用 Moonshot 的 OpenAI-compatible 地址。
    if (provider === "kimi") return process.env.KIMI_BASE_URL ?? "https://api.moonshot.cn/v1";
    if (provider === "openai") return process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
    return process.env[`${provider.toUpperCase()}_BASE_URL`] ?? "";
  }
}
