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
import type { SessionRuntimeSnapshot, WorkContextCard, ContextRef } from "./orchestration.types.js";

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
      const projection = metadata.projection as Record<string, unknown> | undefined;

      return {
        workContextUid: ctx.workContextUid,
        title: ctx.title,
        goal: ctx.goal,
        status: ctx.status,
        summary: metadata.summary as string | undefined,
        progressSummary: (projection?.progressSummary as string | undefined) ?? (metadata.progressSummary as string | undefined),
        currentStage: (projection?.currentStage as string | undefined) ?? (metadata.currentStage as string | undefined),
        nextAction: metadata.nextAction as string | undefined,
        updatedAt: ctx.updatedAt,
        signals: {
          selectedInUI: ctx.workContextUid === selectedWorkContextUid,
          recentlyActive: updatedTime > oneHourAgo,
          hasFailedRun: !!(projection?.lastFailedRunUid),
          hasOpenIssue: Array.isArray(projection?.openIssues) && (projection?.openIssues as Array<{ status?: string }>).some((x) => x.status === "open"),
          hasRecentArtifact: Array.isArray(projection?.recentRefs) && (projection?.recentRefs as string[]).some((ref) => String(ref).startsWith("artifact:")),
          hasUnverifiedSideEffect: false,
        },
        topRefs: buildTopRefsFromProjection(ctx.workContextUid, projection),
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

function buildTopRefsFromProjection(
  workContextUid: string,
  projection?: Record<string, unknown>
): ContextRef[] {
  if (!projection) return [];

  const refs: ContextRef[] = [];

  const currentFocus = projection.currentFocus as { refId?: string; kind?: string; title?: string } | undefined;
  if (currentFocus?.refId) {
    refs.push({
      refId: currentFocus.refId,
      kind: (currentFocus.kind || "artifact") as ContextRef["kind"],
      title: currentFocus.title || currentFocus.refId,
      summary: (projection.progressSummary as string) || "",
      workContextUid,
      status: "current_focus",
      source: { uid: currentFocus.refId },
      tags: ["current_focus"],
    });
  }

  for (const refId of (projection.recentRefs as string[] | undefined) ?? []) {
    if (refs.some((r) => r.refId === refId)) continue;

    const kind =
      refId.startsWith("file:")
        ? "file"
        : refId.startsWith("artifact:")
          ? "artifact"
          : refId.startsWith("run:")
            ? "run"
            : refId.startsWith("step:")
              ? "step"
              : "artifact";

    refs.push({
      refId,
      kind: kind as ContextRef["kind"],
      title: refId,
      summary: "来自 WorkContext projection.recentRefs",
      workContextUid,
      status: "recent",
      source: { uid: refId },
      tags: ["recent"],
    });
  }

  return refs.slice(0, 10);
}
