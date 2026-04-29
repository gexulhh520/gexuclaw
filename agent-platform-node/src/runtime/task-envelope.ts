/**
 * TaskEnvelope - 主 Agent 给子 Agent 的结构化任务包
 * 替代 handoffNote
 *
 * 注意：类型定义已迁移到 modules/orchestration/task-envelope.types.ts
 * 此文件保留作为统一导出入口，避免大面积修改现有导入。
 */

export type {
  TaskEnvelope,
  LedgerSlice,
  ArtifactSlice,
  FileSlice,
} from "../modules/orchestration/task-envelope.types.js";
