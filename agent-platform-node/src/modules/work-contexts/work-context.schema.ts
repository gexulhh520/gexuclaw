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

// Artifact 类型枚举
export const ArtifactTypeEnum = z.enum([
  "text",
  "structured_data",
  "page",
  "image",
  "link",
  "file",
  "collection",
]);

// Artifact 角色枚举
export const ArtifactRoleEnum = z.enum([
  "input",
  "reference",
  "intermediate",
  "draft",
  "final",
  "output",
  "pending_write",
]);

export const createArtifactSchema = z.object({
  runId: z.number().int().positive().optional(),
  artifactType: ArtifactTypeEnum,
  artifactRole: ArtifactRoleEnum.default("output"),
  title: z.string().min(1),
  mimeType: z.string().optional(),
  contentText: z.string().default(""),
  contentJson: z.union([z.record(z.any()), z.array(z.any())]).default({}),
  uri: z.string().optional(),
  status: z.string().default("ready"),
  sourceRunId: z.number().int().positive().optional(),
  sourceArtifactIds: z.array(z.string()).default([]),
  metadata: z.record(z.any()).default({}),
});

export type CreateWorkContextInput = z.infer<typeof createWorkContextSchema>;
export type CreateArtifactInput = z.infer<typeof createArtifactSchema>;
