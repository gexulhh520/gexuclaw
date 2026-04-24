import { z } from "zod";

export const createProjectSchema = z.object({
  name: z.string().min(1, "项目名称不能为空"),
  description: z.string().optional(),
  icon: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
