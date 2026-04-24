import { z } from "zod";

export const createModelProfileSchema = z.object({
  profileUid: z.string().min(1).optional(),
  name: z.string().min(1),
  provider: z.string().min(1).default("kimi"),
  modelName: z.string().min(1),
  baseUrl: z.string().url().optional(),
  capability: z.record(z.unknown()).default({}),
  defaultParams: z.record(z.unknown()).default({}),
  maxContextTokens: z.number().int().positive().default(32000),
});

export type CreateModelProfileInput = z.infer<typeof createModelProfileSchema>;
