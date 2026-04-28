import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../../db/client.js";
import { agentRunSteps, agentRuns, agents, modelInvocations } from "../../db/schema.js";
import { AgentRuntime } from "../../runtime/agent-runtime.js";
import { notFound } from "../../shared/errors.js";
import { getCurrentAgentVersion } from "../agents/agent.service.js";
import { getWorkContextByUid } from "../work-contexts/work-context.service.js";
import { pluginRegistry } from "../plugins/plugin-registry-instance.js";
import type { RunAgentInput } from "./run.schema.js";

const runtime = new AgentRuntime({ pluginRegistry });

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

export async function listRuns(input?: { agentUid?: string; workContextId?: string; sessionId?: string; limit?: number }) {
  const limit = Math.min(Math.max(input?.limit ?? 20, 1), 100);

  if (input?.agentUid) {
    const [agent] = await db.select().from(agents).where(eq(agents.agentUid, input.agentUid));
    if (!agent) throw notFound("Agent not found", { agentUid: input.agentUid });

    const runs = await db
      .select({
        run: agentRuns,
        agentName: agents.name,
      })
      .from(agentRuns)
      .innerJoin(agents, eq(agentRuns.agentId, agents.id))
      .where(eq(agentRuns.agentId, agent.id))
      .orderBy(desc(agentRuns.id))
      .limit(limit);
    
    return runs.map(r => ({ ...r.run, agentName: r.agentName }));
  }

  if (input?.workContextId) {
    const runs = await db
      .select({
        run: agentRuns,
        agentName: agents.name,
      })
      .from(agentRuns)
      .innerJoin(agents, eq(agentRuns.agentId, agents.id))
      .where(eq(agentRuns.workContextId, input.workContextId))
      .orderBy(desc(agentRuns.id))
      .limit(limit);
    
    return runs.map(r => ({ ...r.run, agentName: r.agentName }));
  }

  if (input?.sessionId) {
    console.log(`[RunService] Querying runs with sessionId: ${input.sessionId}`);
    const runs = await db
      .select({
        run: agentRuns,
        agentName: agents.name,
      })
      .from(agentRuns)
      .innerJoin(agents, eq(agentRuns.agentId, agents.id))
      .where(and(
        eq(agentRuns.sessionId, input.sessionId),
        isNull(agentRuns.parentRunId)  // 只返回主 Agent 的 runs，过滤掉子 Agent 的 runs
      ))
      .orderBy(desc(agentRuns.id))
      .limit(limit);
    console.log(`[RunService] Found ${runs.length} runs for sessionId: ${input.sessionId}`);
    return runs.map(r => ({ ...r.run, agentName: r.agentName }));
  }

  const runs = await db
    .select({
      run: agentRuns,
      agentName: agents.name,
    })
    .from(agentRuns)
    .innerJoin(agents, eq(agentRuns.agentId, agents.id))
    .orderBy(desc(agentRuns.id))
    .limit(limit);
  
  return runs.map(r => ({ ...r.run, agentName: r.agentName }));
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
