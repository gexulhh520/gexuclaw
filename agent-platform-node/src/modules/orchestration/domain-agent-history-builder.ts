import { and, desc, eq, isNotNull, ne } from "drizzle-orm";
import { db } from "../../db/client.js";
import { agentRuns } from "../../db/schema.js";

export type DomainAgentHistoryTurn = {
  taskMessage: string;
  resultSummary: string;
  status: string;
};

export async function buildDomainAgentHistoryTurns(input: {
  sessionId: string;
  agentId: number;
  limit?: number;
}): Promise<DomainAgentHistoryTurn[]> {
  const limit = input.limit ?? 3;

  const runs = await db
    .select({
      userMessage: agentRuns.userMessage,
      resultSummary: agentRuns.resultSummary,
      status: agentRuns.status,
    })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.sessionId, input.sessionId),
        eq(agentRuns.agentId, input.agentId),
        eq(agentRuns.mode, "subagent"),
        ne(agentRuns.status, "running"),
        isNotNull(agentRuns.resultSummary)
      )
    )
    .orderBy(desc(agentRuns.id))
    .limit(limit);

  return runs.reverse().map((run) => ({
    taskMessage: run.userMessage,
    resultSummary: run.resultSummary ?? "",
    status: run.status,
  }));
}
