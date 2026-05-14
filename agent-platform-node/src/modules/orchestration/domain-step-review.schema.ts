import { z } from "zod";

export const domainStepReviewSchema = z.object({
  decision: z.enum([
    "step_done",
    "continue_next_step",
    "retry_current_step",
    "replan_remaining",
    "ask_user",
    "fail",
  ]),
  reason: z.string(),
  retryInstruction: z.string().nullable(),
  replanInstruction: z.string().nullable(),
  userQuestion: z.string().nullable(),
});

export type DomainStepReview = z.infer<typeof domainStepReviewSchema>;
