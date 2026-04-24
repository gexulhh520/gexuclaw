import { z } from "zod";

export const createSessionSchema = z.object({
  title: z.string().min(1, "会话标题不能为空"),
  description: z.string().optional(),
  projectId: z.string().optional(), // null 或不传表示个人会话
  agentIds: z.array(z.string()).min(1, "至少选择一个智能体"),
  metadata: z.record(z.unknown()).optional(),
});

export type CreateSessionInput = z.infer<typeof createSessionSchema>;
