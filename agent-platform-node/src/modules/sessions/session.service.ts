import { desc, eq, isNull } from "drizzle-orm";
import { db } from "../../db/client.js";
import { projects, sessions } from "../../db/schema.js";
import { notFound } from "../../shared/errors.js";
import { makeUid } from "../../shared/ids.js";
import { jsonStringify } from "../../shared/json.js";
import { nowIso } from "../../shared/time.js";
import type { CreateSessionInput } from "./session.schema.js";

export async function createSession(input: CreateSessionInput) {
  const now = nowIso();

  // 如果指定了 projectId，验证项目是否存在
  let projectId: number | null = null;
  if (input.projectId) {
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.projectUid, input.projectId));
    if (!project) {
      throw notFound("Project not found", { projectUid: input.projectId });
    }
    projectId = project.id;
  }

  const [session] = await db
    .insert(sessions)
    .values({
      sessionUid: makeUid("session"),
      projectId,
      title: input.title,
      description: input.description ?? "",
      agentIdsJson: jsonStringify(input.agentIds),
      metadataJson: jsonStringify(input.metadata ?? {}),
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return session;
}

export async function listSessions(input?: { projectUid?: string; personal?: boolean; limit?: number }) {
  const limit = Math.min(Math.max(input?.limit ?? 20, 1), 100);

  // 查询项目下的会话
  if (input?.projectUid) {
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.projectUid, input.projectUid));
    if (!project) {
      throw notFound("Project not found", { projectUid: input.projectUid });
    }

    return db
      .select()
      .from(sessions)
      .where(eq(sessions.projectId, project.id))
      .orderBy(desc(sessions.id))
      .limit(limit);
  }

  // 查询个人会话（projectId 为 null）
  if (input?.personal) {
    return db
      .select()
      .from(sessions)
      .where(isNull(sessions.projectId))
      .orderBy(desc(sessions.id))
      .limit(limit);
  }

  // 查询所有会话
  return db
    .select()
    .from(sessions)
    .orderBy(desc(sessions.id))
    .limit(limit);
}

export async function getSessionByUid(sessionUid: string) {
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.sessionUid, sessionUid));

  if (!session) {
    throw notFound("Session not found", { sessionUid });
  }

  return session;
}
