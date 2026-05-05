import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { agentRuns, agentRunSteps, agentArtifacts } from "../../db/schema.js";
import { jsonParse } from "../../shared/json.js";
import type { ContextRef } from "./orchestration.types.js";
import type { LedgerSlice, ArtifactSlice, FileSlice, ResourceSlice } from "./task-envelope.types.js";

export async function hydrateTaskEnvelopeContext(refs: ContextRef[]): Promise<{
  ledgerSlices: LedgerSlice[];
  artifacts: ArtifactSlice[];
  files: FileSlice[];
  resources: ResourceSlice[];
}> {
  const ledgerSlices: LedgerSlice[] = [];
  const artifacts: ArtifactSlice[] = [];
  const files: FileSlice[] = [];
  const resources: ResourceSlice[] = [];

  for (const ref of refs) {
    if (ref.kind === "run") {
      const runUid = ref.source?.runUid || ref.source?.uid || "";
      if (!runUid) continue;

      const [run] = await db
        .select()
        .from(agentRuns)
        .where(eq(agentRuns.runUid, runUid))
        .limit(1);

      if (!run) continue;

      const steps = await db
        .select()
        .from(agentRunSteps)
        .where(eq(agentRunSteps.runId, run.id))
        .orderBy(agentRunSteps.stepIndex);

      const agentUid = inferAgentUidFromRunRef(ref);

      ledgerSlices.push({
        refId: ref.refId,
        runUid,
        agentUid,
        status: run.status || ref.status || "unknown",
        summary: run.resultSummary ?? ref.summary ?? "",
        steps: steps.map((s) => ({
          stepIndex: s.stepIndex,
          stepType: s.stepType,
          content: s.content ?? undefined,
          toolName: s.toolName ?? undefined,
          toolCallId: s.toolCallId ?? undefined,
          toolStatus: s.toolStatus ?? undefined,
          inputJson: jsonParse(s.inputJson, {}),
          outputJson: jsonParse(s.outputJson, {}),
          metadataJson: jsonParse(s.metadataJson, {}),
          createdAt: s.createdAt,
        })),
      });
    }

    if (ref.kind === "artifact") {
      const artifactUid = ref.source?.uid || "";
      if (!artifactUid) continue;

      const [artifact] = await db
        .select()
        .from(agentArtifacts)
        .where(eq(agentArtifacts.artifactUid, artifactUid))
        .limit(1);

      if (!artifact) continue;

      artifacts.push({
        refId: ref.refId,
        artifactUid: artifact.artifactUid,
        title: artifact.title,
        artifactType: artifact.artifactType,
        artifactRole: artifact.artifactRole ?? undefined,
        summary: ref.summary,
        contentText: artifact.contentText ?? undefined,
        contentJson: artifact.contentJson ? jsonParse(artifact.contentJson, undefined) : undefined,
      });
    }

    if (ref.kind === "file") {
      files.push({
        refId: ref.refId,
        uri: ref.source?.uri || "",
        path: ref.source?.uri || "",
        lastKnownStatus:
          ref.status === "write_failed"
            ? "failed"
            : ref.status === "ok"
              ? "success"
              : ref.status === "unverified"
                ? "unverified"
                : "unknown",
        summary: ref.summary,
      });
    }

    if (ref.kind === "url" || ref.kind === "resource") {
      resources.push({
        refId: ref.refId,
        kind: ref.kind,
        uri: ref.source?.uri || "",
        title: ref.title,
        lastKnownOperation: ref.tags.find((t) =>
          ["read", "write", "save", "fetch", "crawl", "scrape", "modify", "delete"].includes(t)
        ),
        lastKnownStatus:
          ref.status === "verified"
            ? "success"
            : ref.status === "unverified"
              ? "unverified"
              : "unknown",
        summary: ref.summary,
      });
    }
  }

  return { ledgerSlices, artifacts, files, resources };
}

function inferAgentUidFromRunRef(ref: ContextRef): string {
  return (
    ref.tags.find(
      (t) =>
        t !== "run" &&
        t !== ref.status &&
        !["success", "failed", "partial_success", "running"].includes(t)
    ) || ""
  );
}
