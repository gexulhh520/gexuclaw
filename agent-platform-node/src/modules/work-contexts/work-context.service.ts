import { desc, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { agentArtifacts, agentRuns, workContexts } from "../../db/schema.js";
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
      artifactRole: input.artifactRole,
      title: input.title,
      mimeType: input.mimeType,
      contentText: input.contentText,
      contentJson: jsonStringify(input.contentJson),
      uri: input.uri,
      status: input.status,
      sourceRunId: input.sourceRunId,
      sourceArtifactIdsJson: jsonStringify(input.sourceArtifactIds),
      metadataJson: jsonStringify(input.metadata),
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

export async function updateWorkContextRunBinding(
  workContextUid: string,
  runUid: string,
  progressSummary?: string
) {
  const workContext = await getWorkContextByUid(workContextUid);
  const now = nowIso();

  // 查询 run 的数据库 id
  const [run] = await db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(eq(agentRuns.runUid, runUid));

  if (!run) {
    console.error(`[WorkContext] Run not found: ${runUid}`);
    throw notFound("Run not found", { runUid });
  }

  const [updated] = await db
    .update(workContexts)
    .set({
      currentRunId: run.id,
      updatedAt: now,
      metadataJson: jsonStringify({
        ...JSON.parse(workContext.metadataJson || '{}'),
        progressSummary,
        lastRunAt: now,
      }),
    })
    .where(eq(workContexts.id, workContext.id))
    .returning();

  console.log(`[WorkContext] Updated run binding: ${workContextUid} -> run ${run.id} (${runUid})`);
  return updated;
}

export async function listArtifactsByWorkContext(workContextUid: string) {
  const workContext = await getWorkContextByUid(workContextUid);

  return db
    .select()
    .from(agentArtifacts)
    .where(eq(agentArtifacts.workContextId, workContext.id))
    .orderBy(desc(agentArtifacts.id));
}

// 获取 WorkContext 工作台聚合数据
export async function getWorkContextWorkbench(workContextUid: string) {
  const workContext = await getWorkContextByUid(workContextUid);

  // 加载该 WorkContext 的 artifacts
  const artifacts = await db
    .select()
    .from(agentArtifacts)
    .where(eq(agentArtifacts.workContextId, workContext.id))
    .orderBy(desc(agentArtifacts.id))
    .limit(50);

  // 加载该 WorkContext 关联的 runs（通过 workContextId 或 sourceRunId）
  const runs = await db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.workContextId, workContextUid))
    .orderBy(desc(agentRuns.id))
    .limit(20);

  // 解析 metadataJson 获取扩展字段
  let metadata: Record<string, any> = {};
  try {
    metadata = JSON.parse(workContext.metadataJson || '{}');
  } catch {
    metadata = {};
  }

  return {
    workContext: {
      ...workContext,
      // 展开常用元数据字段
      currentStage: metadata.currentStage || '',
      progressSummary: metadata.progressSummary || '',
      nextAction: metadata.nextAction || '',
    },
    artifacts,
    runs,
    // 最近一个产物
    latestArtifact: artifacts[0] || null,
    // 最近一次运行
    latestRun: runs[0] || null,
  };
}
