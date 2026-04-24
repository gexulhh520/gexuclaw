import { desc, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { agentArtifacts, workContexts } from "../../db/schema.js";
import { notFound } from "../../shared/errors.js";
import { makeUid } from "../../shared/ids.js";
import { jsonStringify } from "../../shared/json.js";
import { nowIso } from "../../shared/time.js";
import type { CreateArtifactInput, CreateWorkContextInput } from "./work-context.schema.js";

export async function createWorkContext(input: CreateWorkContextInput) {
  const now = nowIso();

  const [workContext] = await db
    .insert(workContexts)
    .values({
      workContextUid: makeUid("wc"),
      title: input.title,
      goal: input.goal,
      userId: input.userId,
      sessionId: input.sessionId,
      projectId: input.projectId,
      source: input.source,
      metadataJson: jsonStringify(input.metadata),
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return workContext;
}

export async function listWorkContexts(input?: {
  sessionId?: string;
  projectId?: string;
  limit?: number;
}) {
  const limit = Math.min(Math.max(input?.limit ?? 20, 1), 100);

  if (input?.sessionId) {
    return db
      .select()
      .from(workContexts)
      .where(eq(workContexts.sessionId, input.sessionId))
      .orderBy(desc(workContexts.id))
      .limit(limit);
  }

  if (input?.projectId) {
    return db
      .select()
      .from(workContexts)
      .where(eq(workContexts.projectId, input.projectId))
      .orderBy(desc(workContexts.id))
      .limit(limit);
  }

  return db.select().from(workContexts).orderBy(desc(workContexts.id)).limit(limit);
}

export async function getWorkContextByUid(workContextUid: string) {
  const [workContext] = await db
    .select()
    .from(workContexts)
    .where(eq(workContexts.workContextUid, workContextUid));

  if (!workContext) throw notFound("WorkContext not found", { workContextUid });
  return workContext;
}

export async function createArtifact(workContextUid: string, input: CreateArtifactInput) {
  const workContext = await getWorkContextByUid(workContextUid);
  const now = nowIso();

  const [artifact] = await db
    .insert(agentArtifacts)
    .values({
      artifactUid: makeUid("artifact"),
      workContextId: workContext.id,
      runId: input.runId,
      artifactType: input.artifactType,
      title: input.title,
      mimeType: input.mimeType,
      contentText: input.contentText,
      contentJson: jsonStringify(input.contentJson),
      uri: input.uri,
      status: input.status,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await db
    .update(workContexts)
    .set({
      latestArtifactId: artifact.id,
      updatedAt: now,
    })
    .where(eq(workContexts.id, workContext.id));

  return artifact;
}

export async function listArtifactsByWorkContext(workContextUid: string) {
  const workContext = await getWorkContextByUid(workContextUid);

  return db
    .select()
    .from(agentArtifacts)
    .where(eq(agentArtifacts.workContextId, workContext.id))
    .orderBy(desc(agentArtifacts.id));
}
