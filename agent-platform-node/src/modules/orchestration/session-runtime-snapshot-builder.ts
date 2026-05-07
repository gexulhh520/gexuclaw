/**
 * SessionRuntimeSnapshotBuilder
 * 读取当前 session 下的 recent runs、artifacts、agents
 * 构造成 SessionRuntimeSnapshot。不判断用户意图。
 */

import { desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import { sessions, agentArtifacts, agents } from "../../db/schema.js";
import { jsonParse } from "../../shared/json.js";
import { LedgerReader } from "./ledger-reader.js";
import type { SessionRuntimeSnapshot } from "./orchestration.types.js";

export class SessionRuntimeSnapshotBuilder {
  private ledgerReader = new LedgerReader();

  async build(input: {
    sessionId: string;
    userMessage: string;
    effectiveUserMessage: string;
  }): Promise<SessionRuntimeSnapshot> {
    const { sessionId, userMessage, effectiveUserMessage } = input;

    const session = await this.getSession(sessionId);
    const sessionMetadata = jsonParse<Record<string, unknown>>(
      session?.metadataJson,
      {}
    );

    const globalRecentRuns = await this.ledgerReader.getRecentRunsWithSteps({
      sessionId,
      limit: 10,
      stepsPerRun: 20,
    });

    const globalRecentArtifacts = await this.getRecentArtifacts(sessionId);
    const availableAgents = await this.getAvailableAgents(session);

    return {
      userMessage,
      effectiveUserMessage,
      session: {
        sessionUid: sessionId,
        title: session?.title,
        description: session?.description,
        metadata: sessionMetadata,
      },
      sessionState: {
        currentStage: sessionMetadata.currentStage as string | undefined,
        recoverable: sessionMetadata.recoverable as boolean | undefined,
        lastEffectiveUserMessage: sessionMetadata.lastEffectiveUserMessage as string | undefined,
        lastRecoverableRunUid: sessionMetadata.lastRecoverableRunUid as string | undefined,
        lastFailedRunUid: sessionMetadata.lastFailedRunUid as string | undefined,
        lastSuccessfulRunUid: sessionMetadata.lastSuccessfulRunUid as string | undefined,
        recentRefs: Array.isArray(sessionMetadata.recentRefs)
          ? (sessionMetadata.recentRefs as string[])
          : [],
        openIssues: Array.isArray(sessionMetadata.openIssues)
          ? (sessionMetadata.openIssues as any)
          : [],
      },
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
        agentIdsJson: sessions.agentIdsJson,
        metadataJson: sessions.metadataJson,
      })
      .from(sessions)
      .where(eq(sessions.sessionUid, sessionId))
      .limit(1);

    return session;
  }

  private async getRecentArtifacts(sessionId: string) {
    const artifacts = await db
      .select({
        artifactUid: agentArtifacts.artifactUid,
        sessionId: agentArtifacts.sessionId,
        title: agentArtifacts.title,
        artifactType: agentArtifacts.artifactType,
        artifactRole: agentArtifacts.artifactRole,
        contentText: agentArtifacts.contentText,
        createdAt: agentArtifacts.createdAt,
      })
      .from(agentArtifacts)
      .where(eq(agentArtifacts.sessionId, sessionId))
      .orderBy(desc(agentArtifacts.id))
      .limit(20);

    return artifacts.map((art) => ({
      artifactUid: art.artifactUid,
      sessionId: art.sessionId ?? undefined,
      title: art.title,
      artifactType: art.artifactType,
      artifactRole: art.artifactRole ?? undefined,
      summary: art.contentText?.slice(0, 200),
      createdAt: art.createdAt,
    }));
  }

  private async getAvailableAgents(session: { agentIdsJson: string } | undefined) {
    const sessionAgentUids = session ? jsonParse<string[]>(session.agentIdsJson, []) : [];

    if (sessionAgentUids.length === 0) {
      return [];
    }

    const activeAgents = await db
      .select()
      .from(agents)
      .where(inArray(agents.agentUid, sessionAgentUids));

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
