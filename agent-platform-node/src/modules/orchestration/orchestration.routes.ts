import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { agentRunSteps, agentRuns, agents } from "../../db/schema.js";
import { runEventBus } from "../../shared/event-bus.js";
import { chatRequestSchema } from "./orchestration.schema.js";
import { handleChat } from "./orchestration.service.js";

export async function registerOrchestrationRoutes(app: FastifyInstance) {
  // 主聊天接口 - 发送消息并由主 Agent 智能委派
  app.post<{ Body: { sessionId: string; message: string; workContextId?: string; selectedAgentId?: string } }>(
    "/api/agent-platform/orchestration/chat",
    async (request, reply) => {
      const input = chatRequestSchema.parse(request.body);
      const result = await handleChat(input);
      return { success: true, data: result };
    }
  );

  // SSE 实时推送 Run 步骤
  app.get<{ Params: { runId: string } }>(
    "/api/agent-platform/runs/:runId/stream",
    async (request, reply) => {
      const { runId } = request.params;

      // 查询 run 是否存在
      const [run] = await db
        .select({ id: agentRuns.id, status: agentRuns.status })
        .from(agentRuns)
        .where(eq(agentRuns.runUid, runId));

      if (!run) {
        reply.code(404).send({ error: "Run not found" });
        return;
      }

      // 如果 run 已完成，直接结束
      if (run.status !== "running") {
        reply.raw.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        reply.raw.write(`event: complete\n`);
        reply.raw.write(`data: ${JSON.stringify({ status: run.status })}\n\n`);
        reply.raw.end();
        return;
      }

      // 设置 SSE 响应头
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      // 发送已存在的步骤（包括主 Agent 和子 Agent 的步骤）
      // 1. 查询主 Agent 的步骤
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

      // 2. 查询子 Agent 的步骤（通过 parentRunId 关联）
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

      // 合并所有步骤并排序
      const allSteps = [...mainSteps, ...childSteps].sort((a, b) => 
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );

      for (const step of allSteps) {
        reply.raw.write(`event: step\n`);
        reply.raw.write(`data: ${JSON.stringify({
          stepIndex: step.stepIndex,
          stepType: step.stepType,
          content: step.content,
          toolName: step.toolName,
          toolStatus: step.toolStatus,
          input: step.inputJson,
          output: step.outputJson,
          createdAt: step.createdAt,
          agentName: step.agentName,
        })}\n\n`);
      }

      // 订阅实时步骤更新
      let isConnectionClosed = false;

      const unsubscribeStep = runEventBus.subscribeToRunSteps(runId, (step) => {
        if (isConnectionClosed) return;
        reply.raw.write(`event: step\n`);
        reply.raw.write(`data: ${JSON.stringify({
          stepIndex: step.stepIndex,
          stepType: step.stepType,
          content: step.content,
          toolName: step.toolName,
          toolStatus: step.toolStatus,
          input: step.input,
          output: step.output,
          createdAt: step.createdAt,
          agentName: step.agentName,
        })}\n\n`);
        // 立即刷新缓冲区，确保数据实时发送
        if (typeof (reply.raw as NodeJS.WritableStream & { flush?: () => void }).flush === 'function') {
          (reply.raw as NodeJS.WritableStream & { flush?: () => void }).flush?.();
        }
      });

      const unsubscribeStatus = runEventBus.subscribeToRunStatus(runId, (status) => {
        if (isConnectionClosed) return;
        reply.raw.write(`event: status\n`);
        reply.raw.write(`data: ${JSON.stringify(status)}\n\n`);

        // 如果 Run 完成或失败，关闭连接
        if (status.status === "success" || status.status === "failed") {
          reply.raw.write(`event: complete\n`);
          reply.raw.write(`data: ${JSON.stringify({ status: status.status })}\n\n`);
          reply.raw.end();
          isConnectionClosed = true;
          unsubscribeStep();
          unsubscribeStatus();
        }
      });

      // 客户端断开连接时清理订阅
      request.raw.on("close", () => {
        if (!isConnectionClosed) {
          isConnectionClosed = true;
          unsubscribeStep();
          unsubscribeStatus();
          console.log(`[SSE] 客户端断开连接: ${runId}`);
        }
      });

      // 保持连接活跃（可选：发送心跳）
      const heartbeat = setInterval(() => {
        if (isConnectionClosed) {
          clearInterval(heartbeat);
          return;
        }
        reply.raw.write(`event: heartbeat\n`);
        reply.raw.write(`data: ${JSON.stringify({ time: new Date().toISOString() })}\n\n`);
      }, 30000); // 每30秒发送一次心跳

      // 清理心跳定时器
      request.raw.on("close", () => {
        clearInterval(heartbeat);
      });
    }
  );
}
