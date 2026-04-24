import { z } from "zod";

export const createAgentSchema = z.object({
  agentUid: z.string().min(1).optional(),
  name: z.string().min(1),
  type: z.enum(["custom", "builtin", "main"]).default("custom"),
  description: z.string().default(""),
  capabilities: z.array(z.string()).default([]),
  ownerUserId: z.string().optional(),
  standaloneEnabled: z.boolean().default(true),
  subagentEnabled: z.boolean().default(false),
  uiMode: z.enum(["generic", "custom"]).default("generic"),
  uiRoute: z.string().optional(),
});

export const createAgentVersionSchema = z.object({
  modelProfileUid: z.string().min(1),
  systemPrompt: z.string().min(1),
  skillText: z.string().default(""),
  allowedTools: z.array(z.string()).default([]),
  contextPolicy: z.record(z.unknown()).default({}),
  modelParamsOverride: z.record(z.unknown()).default({}),
  outputSchema: z.record(z.unknown()).default({}),
  maxSteps: z.number().int().positive().max(20).default(6),
});

export type CreateAgentInput = z.infer<typeof createAgentSchema>;
export type CreateAgentVersionInput = z.infer<typeof createAgentVersionSchema>;
