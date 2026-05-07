/**
 * LedgerReader - 从 agent_runs / agent_run_steps / agents 读取运行事实
 * 不做用户意图判断，只查事实
 */

import { desc, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { agentRuns, agentRunSteps, agents } from "../../db/schema.js";
import { jsonParse } from "../../shared/json.js";
import type { LedgerSlice } from "../../runtime/task-envelope.js";
import type { RuntimeRunTrace, RuntimeStepTrace } from "./orchestration.types.js";

export class LedgerReader {
  /**
   * 获取 Session 下最近的 runs，每个 run 包含 steps
   */
  async getRecentRunsWithSteps(input: {
    sessionId: string;
    limit?: number;
    stepsPerRun?: number;
  }): Promise<RuntimeRunTrace[]> {
    const limit = input.limit ?? 10;
    const stepsPerRun = input.stepsPerRun ?? 20;

    const runs = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.sessionId, input.sessionId))
      .orderBy(desc(agentRuns.id))
      .limit(limit);

    const result: RuntimeRunTrace[] = [];

    for (const run of runs) {
      const agent = await db
        .select()
        .from(agents)
        .where(eq(agents.id, run.agentId))
        .limit(1);

      const agentRecord = agent[0];

      const steps = await db
        .select()
        .from(agentRunSteps)
        .where(eq(agentRunSteps.runId, run.id))
        .orderBy(agentRunSteps.stepIndex)
        .limit(stepsPerRun);

      result.push({
        runUid: run.runUid,
        agentUid: agentRecord?.agentUid ?? String(run.agentId),
        agentName: agentRecord?.name ?? "Unknown",
        mode: run.mode,
        status: run.status,
        sessionId: run.sessionId ?? undefined,
        parentRunId: run.parentRunId ?? undefined,
        userMessage: run.userMessage,
        resultSummary: run.resultSummary ?? undefined,
        errorMessage: run.errorMessage ?? undefined,
        steps: steps.map((s) => this.toRuntimeStepTrace(s)),
        createdAt: run.createdAt,
      });
    }

    return result;
  }

  /**
   * 根据 runUid 获取单个 run 及其所有 steps
   */
  async getRunWithSteps(runUid: string): Promise<RuntimeRunTrace | undefined> {
    const [run] = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.runUid, runUid))
      .limit(1);

    if (!run) return undefined;

    const agent = await db
      .select()
      .from(agents)
      .where(eq(agents.id, run.agentId))
      .limit(1);

    const agentRecord = agent[0];

    const steps = await db
      .select()
      .from(agentRunSteps)
      .where(eq(agentRunSteps.runId, run.id))
      .orderBy(agentRunSteps.stepIndex);

    return {
      runUid: run.runUid,
      agentUid: agentRecord?.agentUid ?? String(run.agentId),
      agentName: agentRecord?.name ?? "Unknown",
      mode: run.mode,
      status: run.status,
      sessionId: run.sessionId ?? undefined,
      parentRunId: run.parentRunId ?? undefined,
      userMessage: run.userMessage,
      resultSummary: run.resultSummary ?? undefined,
      errorMessage: run.errorMessage ?? undefined,
      steps: steps.map((s) => this.toRuntimeStepTrace(s)),
      createdAt: run.createdAt,
    };
  }

  /**
   * 获取某个 step 附近的切片
   */
  async getStepSlice(input: {
    runUid: string;
    stepIndex: number;
    before?: number;
    after?: number;
  }): Promise<LedgerSlice> {
    const run = await this.getRunWithSteps(input.runUid);
    if (!run) {
      throw new Error(`Run not found: ${input.runUid}`);
    }

    const before = input.before ?? 2;
    const after = input.after ?? 2;

    const startIndex = Math.max(0, input.stepIndex - before);
    const endIndex = Math.min(run.steps.length - 1, input.stepIndex + after);

    const slicedSteps = run.steps.slice(startIndex, endIndex + 1);

    return {
      refId: `step:${input.runUid}:${input.stepIndex}`,
      runUid: input.runUid,
      agentUid: run.agentUid,
      agentName: run.agentName,
      status: run.status,
      steps: slicedSteps,
    };
  }

  /**
   * 获取某个 run 的完整切片
   */
  async getRunSlice(runUid: string): Promise<LedgerSlice> {
    const run = await this.getRunWithSteps(runUid);
    if (!run) {
      throw new Error(`Run not found: ${runUid}`);
    }

    return {
      refId: `run:${runUid}`,
      runUid: run.runUid,
      agentUid: run.agentUid,
      agentName: run.agentName,
      status: run.status,
      steps: run.steps,
    };
  }

  private toRuntimeStepTrace(step: typeof agentRunSteps.$inferSelect): RuntimeStepTrace {
    return {
      stepIndex: step.stepIndex,
      stepType: step.stepType,
      content: step.content ?? undefined,
      toolName: step.toolName ?? undefined,
      toolCallId: step.toolCallId ?? undefined,
      toolStatus: step.toolStatus ?? undefined,
      inputJson: jsonParse(step.inputJson, {}),
      outputJson: jsonParse(step.outputJson, {}),
      metadataJson: jsonParse(step.metadataJson, {}),
      createdAt: step.createdAt,
    };
  }
}
