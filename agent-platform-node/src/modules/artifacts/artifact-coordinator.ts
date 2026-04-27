import { db } from "../../db/client.js";
import { agentRuns } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { jsonParse, jsonStringify } from "../../shared/json.js";
import type { ToolResult } from "../../tools/tool-types.js";
import { buildArtifactInputFromToolCandidate } from "./artifact-builder.js";
import { createArtifact } from "../work-contexts/work-context.service.js";

export async function persistArtifactsFromToolResult(params: {
  workContextUid?: string;
  runId: number;
  toolResult: ToolResult;
}) {
  const { workContextUid, runId, toolResult } = params;

  if (!workContextUid) return [];
  if (!toolResult.success) return [];
  if (!toolResult.artifactCandidates?.length) return [];

  const created = [];

  for (const candidate of toolResult.artifactCandidates) {
    const input = buildArtifactInputFromToolCandidate({
      candidate,
      runId,
      sourceRunId: runId,
    });

    const artifact = await createArtifact(workContextUid, input);
    created.push(artifact);
  }

  if (created.length > 0) {
    await appendRunOutputArtifactIds(
      runId,
      created.map((artifact) => artifact.artifactUid),
    );
  }

  return created;
}

async function appendRunOutputArtifactIds(runId: number, artifactUids: string[]) {
  const [run] = await db
    .select({ outputArtifactIdsJson: agentRuns.outputArtifactIdsJson })
    .from(agentRuns)
    .where(eq(agentRuns.id, runId));

  if (!run) return;

  const existing = jsonParse<string[]>(run.outputArtifactIdsJson, []);
  const merged = Array.from(new Set([...existing, ...artifactUids]));

  await db
    .update(agentRuns)
    .set({
      outputArtifactIdsJson: jsonStringify(merged),
    })
    .where(eq(agentRuns.id, runId));
}
