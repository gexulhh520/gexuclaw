import { z } from "zod";

// 用户发送消息请求
export const chatRequestSchema = z.object({
  sessionId: z.string(),
  message: z.string().min(1, "消息不能为空"),
  selectedAgentId: z.string().optional(), // 用户选中的 Agent，主 Agent 可以参考
});

export type ChatRequestInput = z.infer<typeof chatRequestSchema>;

// 主 Agent 判断结果
export const orchestrationDecisionSchema = z.object({
  action: z.enum(["delegate", "clarify", "respond"]),
  workContextId: z.string().optional(),
  targetAgentId: z.string().optional(),
  handoffNote: z.string().optional(),
  response: z.string().optional(),
  reasoning: z.string(),
});

export type OrchestrationDecision = z.infer<typeof orchestrationDecisionSchema>;

// DelegateEnvelope - 委派信封
export const delegateEnvelopeSchema = z.object({
  delegateId: z.string(),
  sourceAgentId: z.string(),
  targetAgentId: z.string(),
  mode: z.enum(["subagent", "standalone"]).default("subagent"),
  sessionId: z.string(),
  userMessage: z.string(),
  handoffNote: z.string(),
  authority: z.object({
    scope: z.string(),
    canRead: z.array(z.string()),
    canWrite: z.array(z.string()),
  }),
  expectedResult: z.string(),
});

export type DelegateEnvelope = z.infer<typeof delegateEnvelopeSchema>;

// 聊天响应
export const chatResponseSchema = z.object({
  message: z.string(),
  runId: z.string().optional(),
  agentId: z.string().optional(),
  artifacts: z.array(z.object({
    id: z.string(),
    type: z.string(),
    title: z.string(),
  })).optional(),
});

export type ChatResponse = z.infer<typeof chatResponseSchema>;
