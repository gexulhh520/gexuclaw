import { and, desc, eq, isNotNull, ne } from "drizzle-orm";
import { db } from "../../db/client.js";
import { agentRuns } from "../../db/schema.js";
import type { ChatMessage } from "../../runtime/model-client.js";

export async function buildDomainAgentHistoryMessages(input: {
  sessionId: string;
  agentId: number;
  limit?: number;
}): Promise<ChatMessage[]> {
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

  return runs.reverse().flatMap((run): ChatMessage[] => {
    const messages: ChatMessage[] = [];

    if (run.userMessage?.trim()) {
      messages.push({
        role: "user",
        content: run.userMessage,
      });
    }

    if (run.resultSummary?.trim()) {
      messages.push({
        role: "assistant",
        content: run.resultSummary,
      });
    }

    return messages;
  });
}
