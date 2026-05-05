import type { TaskEnvelope } from "./task-envelope.types.js";

export function buildRetryTaskEnvelope(input: {
  originalEnvelope: TaskEnvelope;
  retryAttempt: number;
  previousRunUid: string;
  validationIssues: string[];
}): TaskEnvelope {
  return {
    ...input.originalEnvelope,
    retryContext: {
      retryAttempt: input.retryAttempt,
      previousRunUid: input.previousRunUid,
      validationIssues: input.validationIssues,
      instruction:
        "只修复当前 Objective，不要扩展任务范围，不要执行其他步骤。本次必须补齐上一次缺失的结果。",
    },
  };
}
