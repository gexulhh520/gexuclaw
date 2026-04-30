/**
 * WorkContextProjectionService
 * 增量更新 work_contexts.metadataJson.projection
 */

import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { workContexts } from "../../db/schema.js";
import { jsonParse, jsonStringify } from "../../shared/json.js";
import { nowIso } from "../../shared/time.js";

export type WorkContextProjection = {
  currentStage:
    | "created"
    | "planning"
    | "executing"
    | "waiting_user"
    | "recovering"
    | "completed"
    | "blocked";

  progressSummary: string;

  currentFocus?: {
    refId: string;
    kind: "file" | "artifact" | "run" | "step" | "repo" | "patch" | "log";
    title: string;
  } | null;

  recentRefs: string[];

  openIssues: Array<{
    refId?: string;
    summary: string;
    severity: "low" | "medium" | "high";
    status: "open" | "resolved";
  }>;

  lastRunUid?: string;
  lastSuccessfulRunUid?: string | null;
  lastFailedRunUid?: string | null;
};

function mapRunStatusToStage(status: string): WorkContextProjection["currentStage"] {
  if (status === "failed") return "blocked";
  if (status === "partial_success") return "waiting_user";
  return "completed";
}

export async function updateWorkContextProjection(input: {
  workContextUid: string;
  runUid: string;
  status: string;
  summary: string;
  producedArtifactRefs?: Array<{
    refId: string;
    title: string;
  }>;
  touchedRefs?: string[];
  openIssues?: Array<{
    refId?: string;
    summary: string;
    severity?: "low" | "medium" | "high";
  }>;
}) {
  const [record] = await db
    .select({
      id: workContexts.id,
      metadataJson: workContexts.metadataJson,
    })
    .from(workContexts)
    .where(eq(workContexts.workContextUid, input.workContextUid))
    .limit(1);

  if (!record) {
    console.warn(`[WorkContextProjection] WorkContext not found: ${input.workContextUid}`);
    return;
  }

  const metadata = jsonParse<Record<string, unknown>>(record.metadataJson, {});
  const existingProjection = (metadata.projection as WorkContextProjection | undefined) ?? {
    currentStage: "created",
    progressSummary: "",
    currentFocus: null,
    recentRefs: [],
    openIssues: [],
    lastRunUid: undefined,
    lastSuccessfulRunUid: null,
    lastFailedRunUid: null,
  };

  // 合并 recentRefs：新产生的 artifact refs + touched refs + 之前的 recentRefs
  const newRefs = [
    ...(input.producedArtifactRefs?.map((a) => a.refId) ?? []),
    ...(input.touchedRefs ?? []),
  ];
  const mergedRecentRefs = Array.from(new Set([...newRefs, ...existingProjection.recentRefs])).slice(0, 20);

  // 合并 openIssues
  const incomingIssues = (input.openIssues ?? []).map((issue) => ({
    refId: issue.refId,
    summary: issue.summary,
    severity: issue.severity ?? ("medium" as const),
    status: "open" as const,
  }));
  const mergedOpenIssues = [...incomingIssues, ...existingProjection.openIssues].slice(0, 10);

  // 自动更新 currentFocus：如果有新产生的 artifact，聚焦到第一个 artifact
  const firstArtifactRef = input.producedArtifactRefs?.[0];
  const nextCurrentFocus = firstArtifactRef
    ? {
        refId: firstArtifactRef.refId,
        kind: "artifact" as const,
        title: firstArtifactRef.title,
      }
    : existingProjection.currentFocus ?? null;

  const updatedProjection: WorkContextProjection = {
    ...existingProjection,
    currentStage: mapRunStatusToStage(input.status),
    progressSummary: input.summary,
    currentFocus: nextCurrentFocus,
    recentRefs: mergedRecentRefs,
    openIssues: mergedOpenIssues,
    lastRunUid: input.runUid,
    lastSuccessfulRunUid: input.status === "success" ? input.runUid : existingProjection.lastSuccessfulRunUid,
    lastFailedRunUid: input.status === "failed" ? input.runUid : existingProjection.lastFailedRunUid,
  };

  const updatedMetadata = {
    ...metadata,
    projection: updatedProjection,
  };

  await db
    .update(workContexts)
    .set({
      metadataJson: jsonStringify(updatedMetadata),
      updatedAt: nowIso(),
    })
    .where(eq(workContexts.id, record.id));

  console.log(`[WorkContextProjection] Updated ${input.workContextUid}, stage=${updatedProjection.currentStage}`);
}
