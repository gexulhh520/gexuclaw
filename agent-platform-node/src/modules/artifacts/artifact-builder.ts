import type { ToolArtifactCandidate } from "../../tools/tool-types.js";
import type { CreateArtifactInput } from "../work-contexts/work-context.schema.js";

function defaultMimeTypeFor(kind: ToolArtifactCandidate["kind"]) {
  switch (kind) {
    case "text":
      return "text/plain";
    case "structured_data":
    case "collection":
      return "application/json";
    case "page":
      return "text/html";
    case "image":
      return "image/png";
    case "link":
      return "text/uri-list";
    case "file":
      return "application/octet-stream";
    default:
      return undefined;
  }
}

export function buildArtifactInputFromToolCandidate(params: {
  candidate: ToolArtifactCandidate;
  runId?: number;
  sourceRunId?: number;
  sourceArtifactIds?: string[];
}): CreateArtifactInput {
  const { candidate, runId, sourceRunId, sourceArtifactIds = [] } = params;

  return {
    runId,
    sourceRunId,
    sourceArtifactIds,
    artifactType: candidate.kind,
    artifactRole: candidate.defaultRole ?? "intermediate",
    title: candidate.title || "Generated artifact",
    mimeType: candidate.mimeType ?? defaultMimeTypeFor(candidate.kind),
    contentText: candidate.contentText || "",
    contentJson: candidate.contentJson ?? {},
    uri: candidate.uri,
    status: "ready",
    metadata: candidate.metadata || {},
  };
}
