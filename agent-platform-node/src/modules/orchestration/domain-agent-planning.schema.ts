import { z } from "zod";

export const domainPlanStepSchema = z.object({
  stepUid: z.string(),
  objective: z.string(),
  expectedResult: z.enum([
    "answer",
    "artifact",
    "file_change",
    "diagnosis",
    "verification",
  ]),
  doneCriteria: z.string(),
  requireReview: z.boolean().default(true),
});

export const domainAgentPlanSchema = z.object({
  planUid: z.string(),
  selectedAgentUid: z.string(),
  objective: z.string(),
  steps: z.array(domainPlanStepSchema).min(1).max(6),
});

export const mainPlanningDecisionSchema = z.object({
  decisionType: z.enum(["answer_directly", "ask_user", "execute_plan"]),
  selectedAgentUid: z.string().nullable(),
  response: z.string().nullable(),
  question: z.string().nullable(),
  plan: domainAgentPlanSchema.nullable(),
  confidence: z.enum(["high", "medium", "low"]),
  reasoning: z.string(),
});

export type DomainAgentPlan = z.infer<typeof domainAgentPlanSchema>;
export type DomainPlanStep = z.infer<typeof domainPlanStepSchema>;
export type MainPlanningDecision = z.infer<typeof mainPlanningDecisionSchema>;
