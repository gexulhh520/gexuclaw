import { z } from "zod";

export const runAgentSchema = z.object({
  userMessage: z.string().min(1),
  handoffNote: z.string().optional(),
  userId: z.string().optional(),
  sessionId: z.string().optional(),
  mode: z.enum(["standalone", "subagent", "main"]).default("standalone"),
});

export type RunAgentInput = z.infer<typeof runAgentSchema>;
