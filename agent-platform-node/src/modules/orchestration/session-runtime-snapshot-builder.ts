/**
 * SessionRuntimeSnapshotBuilder
 * 读取当前 session 下多个 WorkContext、recent runs、artifacts、agents
 * 构造成 SessionRuntimeSnapshot。不判断用户意图。
 */

import { desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import { sessions, workContexts, agentArtifacts, agents, agentRuns } from "../../db/schema.js";
import { jsonParse } from "../../shared/json.js";
import { LedgerReader } from "./ledger-reader.js";
import type { SessionRuntimeSnapshot, WorkContextCard } from "./orchestration.types.js";

export class SessionRuntimeSnapshotBuilder {
  private ledgerReader = new LedgerReader();

  async build(input: {
    sessionId: string;
    userMessage: string;
    selectedWorkContextUid?: string;
  }): Promise<SessionRuntimeSnapshot> {
    const { sessionId, userMessage, selectedWorkContextUid } = input;

    const session = await this.getSession(sessionId);
    const workContextList = await this.getWorkContexts(sessionId, selectedWorkContextUid);
    const globalRecentRuns = await this.ledgerReader.getRecentRunsWithSteps({
      sessionId,
      limit: 10,
      stepsPerRun: 20,
    });
    const globalRecentArtifacts = await this.getRecentArtifacts(sessionId);
    const availableAgents = await this.getAvailableAgents();

    return {
      userMessage,
      session: {
        sessionUid: sessionId,
        title: session?.title,
        description: session?.description,
      },
      selectedWorkContextUid,
      workContexts: workContextList,
      globalRecentRuns,
      globalRecentArtifacts,
      availableAgents,
    };
  }

  private async getSession(sessionId: string) {
    const [session] = await db
      .select({
        title: sessions.title,
        description: sessions.description,
      })
      .from(sessions)
      .where(eq(sessions.sessionUid, sessionId))
      .limit(1);
    return session;
  }

  private async getWorkContexts(
    sessionId: string,
    selectedWorkContextUid?: string
  ): Promise<WorkContextCard[]> {
    const contexts = await db
      .select()
      .from(workContexts)
      .where(eq(workContexts.sessionId, sessionId))
      .orderBy(desc(workContexts.updatedAt))
      .limit(10);

    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;

    return contexts.map((ctx) => {
      const metadata = jsonParse<Record<string, unknown>>(ctx.metadataJson, {});
      const updatedTime = new Date(ctx.updatedAt).getTime();

      return {
        workContextUid: ctx.workContextUid,
        title: ctx.title,
        goal: ctx.goal,
        status: ctx.status,
        summary: metadata.summary as string | undefined,
        progressSummary: metadata.progressSummary as string | undefined,
        currentStage: metadata.currentStage as string | undefined,
        nextAction: metadata.nextAction as string | undefined,
        updatedAt: ctx.updatedAt,
        signals: {
          selectedInUI: ctx.workContextUid === selectedWorkContextUid,
          recentlyActive: updatedTime > oneHourAgo,
          hasFailedRun: false,
          hasOpenIssue: false,
          hasRecentArtifact: false,
          hasUnverifiedSideEffect: false,
        },
      };
    });
  }

  private async getRecentArtifacts(sessionId: string) {
    const runs = await db
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(eq(agentRuns.sessionId, sessionId))
      .orderBy(desc(agentRuns.id))
      .limit(20);

    const runIds = runs.map((r) => r.id);
    if (runIds.length === 0) return [];

    const artifacts = await db
      .select({
        artifactUid: agentArtifacts.artifactUid,
        workContextId: agentArtifacts.workContextId,
        title: agentArtifacts.title,
        artifactType: agentArtifacts.artifactType,
        artifactRole: agentArtifacts.artifactRole,
        contentText: agentArtifacts.contentText,
        createdAt: agentArtifacts.createdAt,
      })
      .from(agentArtifacts)
      .where(inArray(agentArtifacts.runId, runIds))
      .orderBy(desc(agentArtifacts.id))
      .limit(20);

    return artifacts.map((art) => ({
      artifactUid: art.artifactUid,
      workContextUid: String(art.workContextId),
      title: art.title,
      artifactType: art.artifactType,
      artifactRole: art.artifactRole ?? undefined,
      summary: art.contentText?.slice(0, 200),
      createdAt: art.createdAt,
    }));
  }

  private async getAvailableAgents() {
    const activeAgents = await db
      .select()
      .from(agents)
      .where(eq(agents.status, "active"));

    return activeAgents.map((agent) => {
      const capabilities = jsonParse<string[]>(agent.capabilitiesJson, []);
      return {
        agentUid: agent.agentUid,
        name: agent.name,
        description: agent.description || undefined,
        capabilities,
        status: agent.status,
      };
    });
  }
}
