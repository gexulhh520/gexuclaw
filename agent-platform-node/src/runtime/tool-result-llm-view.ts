import type { ToolResult } from "../tools/tool-types.js";
import { jsonStringify } from "../shared/json.js";

export type LlmToolResult = {
  success: boolean;
  error?: ToolResult["error"];
  operation?: ToolResult["operation"];
  verification?: ToolResult["verification"];
  outputRefs?: ToolResult["outputRefs"];
  data?: unknown;
  artifactCandidates?: unknown[];
};

export function buildLlmToolResult(params: {
  toolResult: ToolResult;
  visualObservation?: unknown;
}): LlmToolResult {
  const { toolResult, visualObservation } = params;

  const safeData = stripLargeFields(toolResult.data);

  return {
    success: toolResult.success,
    error: toolResult.error,
    operation: toolResult.operation,
    verification: toolResult.verification,
    outputRefs: toolResult.outputRefs,
    data: {
      ...(isPlainObject(safeData) ? safeData : { value: safeData }),
      visualObservation: visualObservation ?? undefined,
    },
    artifactCandidates: toolResult.artifactCandidates?.map((item) => ({
      candidateId: item.candidateId,
      kind: item.kind,
      title: item.title,
      mimeType: item.mimeType,
      uri: item.uri,
      metadata: {
        source: item.metadata?.source,
        toolName: item.metadata?.toolName,
        contentIndex: item.metadata?.contentIndex,
        sizeChars: item.metadata?.sizeChars,
        omittedLargeContent: true,
      },
    })),
  };
}

export function buildLlmToolMessageContent(params: {
  toolResult: ToolResult;
  visualObservation?: unknown;
}): string {
  return jsonStringify(buildLlmToolResult(params));
}

function stripLargeFields(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, val) => {
      if (typeof val === "string" && val.length > 2000) {
        return `[OMITTED_LARGE_STRING:${val.length}_CHARS]`;
      }
      return val;
    })
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
