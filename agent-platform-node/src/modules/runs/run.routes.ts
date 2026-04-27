import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { agentRunSteps, agentRuns, agents } from "../../db/schema.js";
import { ok } from "../../shared/api-response.js";
import { getRunByUid, listRunModelInvocations, listRuns, listRunSteps } from "./run.service.js";

export async function registerRunRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { agentUid?: string; workContextId?: string; sessionId?: string; limit?: string } }>(
    "/api/agent-platform/runs",
    async (request) => {
    return ok(
      await listRuns({
        agentUid: request.query.agentUid,
        workContextId: request.query.workContextId,
        sessionId: request.query.sessionId,
        limit: request.query.limit ? Number(request.query.limit) : undefined,
      }),
    );
    },
  );

  // 查询 Run 详情（不包含步骤，保持兼容）
  app.get<{ Params: { runUid: string } }>("/api/agent-platform/runs/:runUid", async (request) => {
    return ok(await getRunByUid(request.params.runUid));
  });

  // 查询 Run 详情和步骤（新接口）
  app.get<{ Params: { runId: string } }>("/api/agent-platform/runs/:runId/details", async (request) => {
    const { runId } = request.params;

    // 查询 run 基本信息
    const [run] = await db
      .select({
        id: agentRuns.id,
        runUid: agentRuns.runUid,
        agentId: agentRuns.agentId,
        status: agentRuns.status,
        resultSummary: agentRuns.resultSummary,
        userMessage: agentRuns.userMessage,
        createdAt: agentRuns.createdAt,
        updatedAt: agentRuns.updatedAt,
      })
      .from(agentRuns)
      .where(eq(agentRuns.runUid, runId));

    if (!run) {
      return { success: false, error: "Run not found" };
    }

    // 查询主 run 的步骤
    const mainSteps = await db
      .select({
        stepIndex: agentRunSteps.stepIndex,
        stepType: agentRunSteps.stepType,
        content: agentRunSteps.content,
        toolName: agentRunSteps.toolName,
        toolStatus: agentRunSteps.toolStatus,
        inputJson: agentRunSteps.inputJson,
        outputJson: agentRunSteps.outputJson,
        createdAt: agentRunSteps.createdAt,
        agentName: agents.name,
      })
      .from(agentRunSteps)
      .innerJoin(agentRuns, eq(agentRunSteps.runId, agentRuns.id))
      .innerJoin(agents, eq(agentRuns.agentId, agents.id))
      .where(eq(agentRunSteps.runId, run.id))
      .orderBy(agentRunSteps.stepIndex);

    // 查询子 run 的步骤（通过 parentRunId 关联）
    const childSteps = await db
      .select({
        stepIndex: agentRunSteps.stepIndex,
        stepType: agentRunSteps.stepType,
        content: agentRunSteps.content,
        toolName: agentRunSteps.toolName,
        toolStatus: agentRunSteps.toolStatus,
        inputJson: agentRunSteps.inputJson,
        outputJson: agentRunSteps.outputJson,
        createdAt: agentRunSteps.createdAt,
        agentName: agents.name,
      })
      .from(agentRunSteps)
      .innerJoin(agentRuns, eq(agentRunSteps.runId, agentRuns.id))
      .innerJoin(agents, eq(agentRuns.agentId, agents.id))
      .where(eq(agentRuns.parentRunId, run.id))
      .orderBy(agentRunSteps.createdAt);

    // 合并所有步骤并按时间排序
    const allSteps = [...mainSteps, ...childSteps].sort((a, b) => 
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    return ok({
      run: {
        runId: run.runUid,
        agentId: String(run.agentId),
        status: run.status,
        resultSummary: run.resultSummary,
        userMessage: run.userMessage,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      },
      steps: allSteps.map((step) => ({
        stepIndex: step.stepIndex,
        stepType: step.stepType,
        content: step.content,
        toolName: step.toolName,
        toolStatus: step.toolStatus,
        input: step.inputJson,
        output: step.outputJson,
        createdAt: step.createdAt,
        agentName: step.agentName,
      })),
    });
  });

  app.get<{ Params: { runUid: string } }>("/api/agent-platform/runs/:runUid/steps", async (request) => {
    return ok(await listRunSteps(request.params.runUid));
  });

  app.get<{ Params: { runUid: string } }>("/api/agent-platform/runs/:runUid/model-invocations", async (request) => {
    return ok(await listRunModelInvocations(request.params.runUid));
  });
}
