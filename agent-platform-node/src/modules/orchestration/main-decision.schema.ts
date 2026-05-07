import { z } from "zod";

export const planStepDraftSchema = z.object({
  targetAgentUid: z.string().min(1),
  objective: z.string().min(1),
  inputRefIds: z.array(z.string()).default([]),
  expectedResultKind: z.enum([
    "answer",
    "artifact",
    "file_change",
    "diagnosis",
    "verification",
  ]),
  requireVerification: z.boolean(),
});

export const mainDecisionSchema = z.object({
  decisionType: z.enum([
    "answer_directly",
    "delegate",
    "multi_step_plan",
    "ask_user",
    "explain_trace",
    "verify_execution",
    "recover_execution",
  ]),

  primaryRefs: z.array(z.string()).default([]),
  secondaryRefs: z.array(z.string()).default([]),

  targetAgentUid: z.string().nullable().default(null),

  plan: z
    .object({
      steps: z.array(planStepDraftSchema).default([]),
    })
    .nullable()
    .default(null),

  response: z.string().nullable().optional().default(null),

  ambiguity: z
    .object({
      candidateRefIds: z.array(z.string()).default([]),
      question: z.string().min(1),
    })
    .nullable()
    .optional()
    .default(null),

  confidence: z.enum(["high", "medium", "low"]),
  reasoning: z.string().min(1),
});

export type MainDecision = z.infer<typeof mainDecisionSchema>;
