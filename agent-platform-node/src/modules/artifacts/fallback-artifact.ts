import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { agentArtifacts, workContexts } from "../../db/schema.js";
import { jsonStringify } from "../../shared/json.js";
import { makeUid } from "../../shared/ids.js";
import { nowIso } from "../../shared/time.js";

export async function persistFallbackArtifactFromFinalSummary(input: {
  workContextUid?: string;
  runId: number;
  summary: string;
  agentName: string;
}) {
  if (!input.workContextUid) return;
  if (!input.summary || input.summary.trim().length === 0) return;

  const existingArtifacts = await db
    .select({ id: agentArtifacts.id })
    .from(agentArtifacts)
    .where(eq(agentArtifacts.runId, input.runId))
    .limit(1);

  if (existingArtifacts.length > 0) return;

  const [wc] = await db
    .select({ id: workContexts.id })
    .from(workContexts)
    .where(eq(workContexts.workContextUid, input.workContextUid))
    .limit(1);

  if (!wc) return;

  const now = nowIso();

  await db.insert(agentArtifacts).values({
    artifactUid: makeUid("artifact"),
    workContextId: wc.id,
    runId: input.runId,
    sourceRunId: input.runId,
    artifactType: "text",
    artifactRole: "intermediate",
    title: `${input.agentName} final output`,
    mimeType: "text/plain",
    contentText: input.summary,
    contentJson: "{}",
    status: "ready",
    sourceArtifactIdsJson: "[]",
    metadataJson: jsonStringify({
      generatedBy: "fallback_final_summary",
    }),
    createdAt: now,
    updatedAt: now,
  });
}
