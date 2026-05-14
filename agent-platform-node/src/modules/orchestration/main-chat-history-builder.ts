import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../../db/client.js";
import { agentRuns } from "../../db/schema.js";
import type { ChatMessage } from "../../runtime/model-client.js";

/**
 * 构建主 Agent 的自然对话历史。
 *
 * 只取 mode=main 的 run：
 * - userMessage => user
 * - resultSummary => assistant
 *
 * 不取 subagent run。
 * 不取 running 中间态。
 * 不取 resultSummary 为空的记录。
 */
export async function buildMainChatHistoryMessages(input: {
  sessionId: string;
  limit?: number;
}): Promise<ChatMessage[]> {
  const limit = input.limit ?? 6;

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
        eq(agentRuns.mode, "main"),
        inArray(agentRuns.status, ["success", "failed"]),
        isNotNull(agentRuns.resultSummary)
      )
    )
    .orderBy(desc(agentRuns.id))
    .limit(limit);

  return runs
    .reverse()
    .flatMap((run): ChatMessage[] => {
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
