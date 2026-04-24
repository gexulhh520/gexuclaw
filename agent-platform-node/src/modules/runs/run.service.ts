import { desc, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { agentRunSteps, agentRuns, agents, modelInvocations } from "../../db/schema.js";
import { AgentRuntime } from "../../runtime/agent-runtime.js";
import { notFound } from "../../shared/errors.js";
import { getCurrentAgentVersion } from "../agents/agent.service.js";
import { getWorkContextByUid } from "../work-contexts/work-context.service.js";
import type { RunAgentInput } from "./run.schema.js";

const runtime = new AgentRuntime();

export async function runAgent(agentUid: string, input: RunAgentInput) {
  // run API 默认取当前发布版本，不要求调用方自己传 version id。
  const { agent, version } = await getCurrentAgentVersion(agentUid);

  if (input.workContextId) {
    await getWorkContextByUid(input.workContextId);
  }

  return runtime.run({
    agentRecord: agent,
    versionRecord: version,
    userMessage: input.userMessage,
    handoffNote: input.handoffNote,
    userId: input.userId,
    sessionId: input.sessionId,
    workContextId: input.workContextId,
    mode: input.mode,
  });
}

export async function getRunByUid(runUid: string) {
  const [run] = await db.select().from(agentRuns).where(eq(agentRuns.runUid, runUid));
  if (!run) throw notFound("AgentRun not found", { runUid });
  return run;
}

export async function listRuns(input?: { agentUid?: string; workContextId?: string; limit?: number }) {
  const limit = Math.min(Math.max(input?.limit ?? 20, 1), 100);

  if (input?.agentUid) {
    const [agent] = await db.select().from(agents).where(eq(agents.agentUid, input.agentUid));
    if (!agent) throw notFound("Agent not found", { agentUid: input.agentUid });

    return db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.agentId, agent.id))
      .orderBy(desc(agentRuns.id))
      .limit(limit);
  }

  if (input?.workContextId) {
    return db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.workContextId, input.workContextId))
      .orderBy(desc(agentRuns.id))
      .limit(limit);
  }

  return db.select().from(agentRuns).orderBy(desc(agentRuns.id)).limit(limit);
}

export async function listRunSteps(runUid: string) {
  const run = await getRunByUid(runUid);
  // step_index 保证前端按真实执行顺序展示时间线。
  return db.select().from(agentRunSteps).where(eq(agentRunSteps.runId, run.id)).orderBy(agentRunSteps.stepIndex);
}

export async function listRunModelInvocations(runUid: string) {
  const run = await getRunByUid(runUid);
  // 一个 run 里可能有多次模型调用，按自增 id 返回即可满足第一阶段审计查看。
  return db.select().from(modelInvocations).where(eq(modelInvocations.runId, run.id)).orderBy(modelInvocations.id);
}
