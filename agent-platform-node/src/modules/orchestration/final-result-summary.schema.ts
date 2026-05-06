import { z } from "zod";

export const finalResultSummarySchema = z.object({
  status: z.enum(["success", "partial_success", "failed"]),
  finalAnswer: z.string().min(1),
  openIssues: z.array(z.string()).default([]),
  reasoning: z.string().optional(),
});

export type FinalResultSummary = z.infer<typeof finalResultSummarySchema>;
