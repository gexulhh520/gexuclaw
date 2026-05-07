import { desc, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { agentArtifacts, agentRuns, workContexts, sessions } from "../../db/schema.js";
import { jsonParse } from "../../shared/json.js";

// PromptContext 类型定义
export type PromptContext = {
  contextRole: "main_orchestration" | "subagent_execution";
  sessionId: string;
  sessionDescription?: string;
  userMessage: string;
  recentRuns?: RunTraceSummary[];
  availableAgents?: AgentCapabilitySummary[];
  executionHistory?: Array<{ agentId: string; result: string }>;
};

export type WorkContextBrief = {
  workContextId: string;
  title: string;
  goal: string;
  status: string;
  updatedAt: string;
};

export type WorkContextDetail = {
  workContextId: string;
  title: string;
  goal: string;
  status: string;
  currentStage?: string;
  progressSummary?: string;
  nextAction?: string;
  metadata?: Record<string, unknown>;
  recentRuns: RunTraceSummary[];
  recentArtifacts: ArtifactBrief[];
  runCount: number;
  createdAt: string;
  updatedAt: string;
};

export type WorkContextSummary = {
  workContextId: string;
  title: string;
  goal: string;
  status: string;
  currentStage?: string;
  progressSummary?: string;
  nextAction?: string;
  latestArtifacts?: ArtifactBrief[];
};

export type ArtifactBrief = {
  artifactId: string;
  artifactType: string;
  title: string;
  summary?: string;
  createdAt: string;
};

export type RunTraceSummary = {
  runId: string;
  agentId: string;
  status: string;
  resultSummary?: string;
  createdAt: string;
};

export type AgentPluginInfo = {
  pluginId: string;
  name: string;
  description: string;
};

export type AgentCapabilitySummary = {
  agentId: string;
  name: string;
  description: string;
  type: string;
  capabilities: string[];
  plugins?: AgentPluginInfo[];
};

// ContextBuilder - 构建主 Agent 的上下文
export class ContextBuilder {
  async buildMainAgentContext(params: {
    sessionId: string;
    userMessage: string;
  }): Promise<PromptContext> {
    const { sessionId, userMessage } = params;

    // 1. 获取当前 Session 的信息（包括协作描述）
    const sessionInfo = await this.getSessionInfo(sessionId);

    // 2. 获取最近的 RunTrace
    const recentRuns = await this.getRecentRuns(sessionId, 5);

    return {
      contextRole: "main_orchestration",
      sessionId,
      sessionDescription: sessionInfo?.description,
      userMessage,
      recentRuns,
    };
  }

  // 获取 Session 信息
  private async getSessionInfo(sessionId: string): Promise<{ title: string; description: string } | undefined> {
    const [session] = await db
      .select({
        title: sessions.title,
        description: sessions.description,
      })
      .from(sessions)
      .where(eq(sessions.sessionUid, sessionId));

    if (!session) return undefined;

    return {
      title: session.title,
      description: session.description,
    };
  }

  // 获取 WorkContext 详细信息（用于两步确认）
  async getWorkContextDetail(workContextId: string): Promise<WorkContextDetail | undefined> {
    const [ctx] = await db
      .select()
      .from(workContexts)
      .where(eq(workContexts.workContextUid, workContextId));

    if (!ctx) return undefined;

    // 解析 metadata
    const metadata = jsonParse<Record<string, unknown>>(ctx.metadataJson, {});

    // 获取最近的执行记录
    const recentRuns = await this.getWorkContextRuns(ctx.id, 5);

    // 获取最近的产物
    const recentArtifacts = await this.getWorkContextArtifacts(ctx.id, 5);

    // 获取总执行次数
    const runCount = await this.getWorkContextRunCount(ctx.id);

    return {
      workContextId: ctx.workContextUid,
      title: ctx.title,
      goal: ctx.goal,
      status: ctx.status,
      currentStage: metadata.currentStage as string | undefined,
      progressSummary: metadata.progressSummary as string | undefined,
      nextAction: metadata.nextAction as string | undefined,
      metadata,
      recentRuns,
      recentArtifacts,
      runCount,
      createdAt: ctx.createdAt,
      updatedAt: ctx.updatedAt,
    };
  }

  // 获取 Session 下的 WorkContext 列表（简要信息）
  private async getSessionWorkContexts(sessionId: string): Promise<WorkContextBrief[]> {
    const contexts = await db
      .select({
        workContextUid: workContexts.workContextUid,
        title: workContexts.title,
        goal: workContexts.goal,
        status: workContexts.status,
        updatedAt: workContexts.updatedAt,
      })
      .from(workContexts)
      .where(eq(workContexts.sessionId, sessionId))
      .orderBy(desc(workContexts.updatedAt))
      .limit(10);

    return contexts.map((ctx) => ({
      workContextId: ctx.workContextUid,
      title: ctx.title,
      goal: ctx.goal,
      status: ctx.status,
      updatedAt: ctx.updatedAt,
    }));
  }

  // 获取 WorkContext 摘要
  private async getWorkContextSummary(workContextId: string): Promise<WorkContextSummary | undefined> {
    const [ctx] = await db
      .select()
      .from(workContexts)
      .where(eq(workContexts.workContextUid, workContextId));

    if (!ctx) return undefined;

    const metadata = jsonParse<Record<string, unknown>>(ctx.metadataJson, {});

    return {
      workContextId: ctx.workContextUid,
      title: ctx.title,
      goal: ctx.goal,
      status: ctx.status,
      currentStage: metadata.currentStage as string | undefined,
      progressSummary: metadata.progressSummary as string | undefined,
      nextAction: metadata.nextAction as string | undefined,
      latestArtifacts: [],
    };
  }

  // 获取 WorkContext 下的执行记录
  private async getWorkContextRuns(workContextId: number, limit: number): Promise<RunTraceSummary[]> {
    const workContext = await db.query.workContexts.findFirst({
      where: (wc, { eq }) => eq(wc.id, workContextId),
    });
    if (!workContext) return [];

    const runs = await db
      .select({
        runUid: agentRuns.runUid,
        agentId: agentRuns.agentId,
        status: agentRuns.status,
        resultSummary: agentRuns.resultSummary,
        createdAt: agentRuns.createdAt,
      })
      .from(agentRuns)
      .where(eq(agentRuns.workContextId, workContext.workContextUid))
      .orderBy(desc(agentRuns.id))
      .limit(limit);

    return runs.map((run) => ({
      runId: run.runUid,
      agentId: String(run.agentId),
      status: run.status,
      resultSummary: run.resultSummary || undefined,
      createdAt: run.createdAt,
    }));
  }

  // 获取 WorkContext 下的产物
  private async getWorkContextArtifacts(workContextId: number, limit: number): Promise<ArtifactBrief[]> {
    const artifacts = await db
      .select({
        artifactUid: agentArtifacts.artifactUid,
        artifactType: agentArtifacts.artifactType,
        title: agentArtifacts.title,
        contentText: agentArtifacts.contentText,
        createdAt: agentArtifacts.createdAt,
      })
      .from(agentArtifacts)
      .where(eq(agentArtifacts.workContextId, workContextId))
      .orderBy(desc(agentArtifacts.id))
      .limit(limit);

    return artifacts.map((art) => ({
      artifactId: art.artifactUid,
      artifactType: art.artifactType,
      title: art.title,
      summary: art.contentText?.slice(0, 100),
      createdAt: art.createdAt,
    }));
  }

  // 获取 WorkContext 的总执行次数
  private async getWorkContextRunCount(workContextId: number): Promise<number> {
    const workContext = await db.query.workContexts.findFirst({
      where: (wc, { eq }) => eq(wc.id, workContextId),
    });
    if (!workContext) return 0;

    const result = await db
      .select({ count: agentRuns.id })
      .from(agentRuns)
      .where(eq(agentRuns.workContextId, workContext.workContextUid));

    return result.length;
  }

  // 获取 Session 下的最近执行记录
  private async getRecentRuns(sessionId: string, limit: number): Promise<RunTraceSummary[]> {
    const runs = await db
      .select({
        runUid: agentRuns.runUid,
        agentId: agentRuns.agentId,
        status: agentRuns.status,
        resultSummary: agentRuns.resultSummary,
        createdAt: agentRuns.createdAt,
      })
      .from(agentRuns)
      .where(eq(agentRuns.sessionId, sessionId))
      .orderBy(desc(agentRuns.id))
      .limit(limit);

    return runs.map((run) => ({
      runId: run.runUid,
      agentId: String(run.runUid),
      status: run.status,
      resultSummary: run.resultSummary || undefined,
      createdAt: run.createdAt,
    }));
  }
}
