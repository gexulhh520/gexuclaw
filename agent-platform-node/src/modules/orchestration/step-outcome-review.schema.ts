import { z } from "zod";

export const stepOutcomeReviewSchema = z.object({
  decision: z.enum([
    "continue",
    "retry_same_agent",
    "replan_remaining",
    "ask_user",
    "fail",
  ]),

  confidence: z.enum(["high", "medium", "low"]),

  safeToUseProducedRefs: z.boolean(),

  issues: z.array(z.string()).default([]),

  retryInstruction: z.string().optional(),

  replanInstruction: z.string().optional(),

  userQuestion: z.string().optional(),

  finalMessage: z.string().optional(),

  reasoning: z.string().min(1),
});

export type StepOutcomeReview = z.infer<typeof stepOutcomeReviewSchema>;
