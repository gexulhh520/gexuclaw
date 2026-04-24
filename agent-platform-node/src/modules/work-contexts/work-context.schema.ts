import { z } from "zod";

export const createWorkContextSchema = z.object({
  title: z.string().min(1),
  goal: z.string().default(""),
  userId: z.string().optional(),
  sessionId: z.string().optional(),
  projectId: z.string().optional(),
  source: z.string().default("manual"),
  metadata: z.record(z.any()).default({}),
});

export const createArtifactSchema = z.object({
  runId: z.number().int().positive().optional(),
  artifactType: z.string().min(1),
  title: z.string().min(1),
  mimeType: z.string().optional(),
  contentText: z.string().default(""),
  contentJson: z.record(z.any()).default({}),
  uri: z.string().optional(),
  status: z.string().default("ready"),
});

export type CreateWorkContextInput = z.infer<typeof createWorkContextSchema>;
export type CreateArtifactInput = z.infer<typeof createArtifactSchema>;
