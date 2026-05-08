import type { ChatMessage } from "./model-client.js";
import { ModelClient } from "./model-client.js";
import type { ToolArtifactCandidate, ToolResult } from "../tools/tool-types.js";
import { jsonParse } from "../shared/json.js";

export type VisualObservation = {
  source: "vision_model";
  imageCount: number;
  summary: string;
  visibleTexts?: string[];
  uiElements?: Array<{
    type?: string;
    text?: string;
    description?: string;
    location?: string;
  }>;
  state?: Record<string, unknown>;
  nextActionHints?: string[];
  raw?: unknown;
};

export async function buildVisualObservationIfNeeded(params: {
  toolResult: ToolResult;
  modelClient: ModelClient;
  provider: string;
  modelName: string;
  baseUrl?: string | null;
  params?: Record<string, unknown>;
}): Promise<VisualObservation | null> {
  const imageCandidates = findImageCandidates(params.toolResult);

  if (imageCandidates.length === 0) {
    return null;
  }

  const imageMessages = buildImageContentParts(imageCandidates);

  if (imageMessages.length === 0) {
    return null;
  }

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "你是一个视觉观察器。你只负责把图片内容转成用于 Agent 后续工具调用的结构化观察。不要闲聊，不要扩展任务，不要输出 markdown。",
    },
    {
      role: "user",
      content: [
        ...imageMessages,
        {
          type: "text",
          text:
            "请理解这些工具返回的图片。输出严格 JSON，字段包括：summary、visibleTexts、uiElements、state、nextActionHints。重点描述页面状态、关键文本、按钮、输入框、弹窗、错误信息，以及下一步可能操作。",
        },
      ],
    },
  ];

  const result = await params.modelClient.invoke({
    provider: params.provider,
    modelName: params.modelName,
    baseUrl: params.baseUrl,
    params: {
      temperature: 0.2,
      maxTokens: 1200,
      ...(params.params ?? {}),
    },
    messages,
    tools: [],
  });

  const parsed = parseJsonObject(result.content);

  return {
    source: "vision_model",
    imageCount: imageMessages.length,
    summary:
      typeof parsed?.summary === "string"
        ? parsed.summary
        : result.content.slice(0, 1000),
    visibleTexts: Array.isArray(parsed?.visibleTexts)
      ? parsed.visibleTexts.map(String)
      : undefined,
    uiElements: Array.isArray(parsed?.uiElements)
      ? parsed.uiElements
      : undefined,
    state: isPlainObject(parsed?.state) ? parsed.state : undefined,
    nextActionHints: Array.isArray(parsed?.nextActionHints)
      ? parsed.nextActionHints.map(String)
      : undefined,
    raw: parsed ?? result.content,
  };
}

function findImageCandidates(toolResult: ToolResult): ToolArtifactCandidate[] {
  return toolResult.artifactCandidates?.filter((item) => item.kind === "image") ?? [];
}

function buildImageContentParts(candidates: ToolArtifactCandidate[]) {
  const parts: Array<{
    type: "image_url";
    image_url: {
      url: string;
    };
  }> = [];

  for (const candidate of candidates.slice(0, 3)) {
    const contentJson = candidate.contentJson;

    if (!isPlainObject(contentJson)) continue;

    const data = contentJson.data;
    const encoding = contentJson.encoding;
    const mimeType =
      typeof contentJson.mimeType === "string"
        ? contentJson.mimeType
        : candidate.mimeType || "image/png";

    if (encoding === "base64" && typeof data === "string" && data.trim()) {
      parts.push({
        type: "image_url",
        image_url: {
          url: `data:${mimeType};base64,${data}`,
        },
      });
    }
  }

  return parts;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");

    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
      } catch {
        return null;
      }
    }

    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
