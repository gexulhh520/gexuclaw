# 定时任务 V2：双 Agent + 异步草案方案

## 目标

- 不改当前老逻辑，新增一套 V2 流程并行运行。
- 主图 `Executor` 只负责让 LLM 判定是否触发定时任务规划。
- 命中后立即返回“后台生成中”，不阻塞用户继续聊天。
- 草案由 `Planner Agent` 异步生成，完成后通过通知栏/WS 提醒。
- 草案支持三种操作：预执行试跑、直接确认创建、重新规划。
- 日常执行由“目标驱动执行 Agent”完成，不做固定步骤重放。

---

## 核心原则

1. `scheduled_task__plan_draft` 在 V2 中是触发器，不是同步执行器。
2. 草案是“实现目标的最佳执行思路参考”，不是硬编码脚本。
3. 执行阶段依赖 `Executor Agent` 动态思考和调工具。
4. 旧链路不动，V2 通过 feature flag 和新路由逐步灰度。

---

## V2 架构

- `Main Executor V2`
  - 负责聊天与触发判定。
  - 命中后只投递异步任务并立刻回复用户。
- `Planner Agent V2`
  - 异步生成草案（目标、执行思路、工具提示、成功标准）。
- `Task Executor Agent V2`
  - 运行时循环：`thinking -> acting -> context_manager -> thinking`。
  - 依据目标动态执行，不重放固定参数步骤。
- `Notification Channel`
  - 草案就绪/失败通过 WS + 通知栏推送。

---

## 主链路（V2）

1. 用户在聊天中表达“生成定时任务”。
2. 主 Agent 命中 `scheduled_task__plan_draft`。
3. 不进入同步子图，直接创建 `planner_job`（Celery）。
4. 立即返回用户：
   - “任务草案正在后台生成，完成后会通知你。”
5. 用户继续聊天不受阻塞。
6. 后台生成完成后推送草案卡片。

---

## 草案数据语义（V2）

草案内容建议收敛为：

- `goal`
- `execution_strategy`
- `tool_hints`
- `success_criteria`
- `risk_notes`

可选：

- `reference_steps`（仅参考，不作为执行器硬重放输入）

---

## 草案完成后的用户操作

1. **预执行试一试**
   - 调用 `Task Executor Agent` 做 dry-run。
   - 返回预执行结果与风险提示。

2. **确认创建**
   - 草案转为 `active`。
   - 进入调度体系。

3. **重新规划**
   - 再次异步触发 `Planner Agent`。
   - 产出新版本草案（保留版本历史）。

---

## 执行 Agent 约束（必须）

- 仅在 **Task Executor Agent V2（每日执行阶段）** 禁用 `scheduled_task__plan_draft`（防回归保险丝）。
- `Main Executor V2` 保留 `scheduled_task__plan_draft` 触发能力，用于异步启动 `Planner Agent`。
- 仅允许白名单工具：`task.tool_whitelist_json ∩ 系统白名单`。
- 增加运行保护：
  - `max_steps`
  - `max_duration`
  - 失败重试策略

---

## 文件改造清单（V2 新增，不动旧逻辑）

- `backend/agents/executor_v2.py`
- `backend/agents/planner_agent.py`
- `backend/agents/task_executor_agent.py`
- `backend/workers/planner_jobs.py`
- `backend/services/planner_service_v2.py`
- `backend/services/task_execution_service_v2.py`
- `backend/api/scheduled_tasks_v2.py`
- `backend/schemas/scheduled_task_v2.py`

---

## 事件协议（建议）

- `planner_draft_queued`
- `planner_draft_ready`
- `planner_draft_failed`

字段建议：

- `draft_id`
- `title`
- `analysis_status`
- `session_id`
- `request_id`
- `summary`（可选）

---

## 路由建议（V2）

- `POST /api/v2/scheduled-tasks/drafts`（触发异步生成）
- `GET /api/v2/scheduled-tasks/drafts/{draft_id}`（查看草案）
- `POST /api/v2/scheduled-tasks/{draft_id}/preview`（预执行）
- `POST /api/v2/scheduled-tasks/{draft_id}/confirm`（确认创建）
- `POST /api/v2/scheduled-tasks/{draft_id}/replan`（重新规划）

---

## 实施顺序（推荐）

### T1：异步草案（先跑通体验）

- 主图命中后改为异步排队 + 即时回复。
- 后台生成草案 + 通知栏推送。

### T2：执行 Agent 切换

- 调度执行改成目标驱动 Agent。
- 禁用规划工具 + 白名单约束。

### T3：草案语义收敛

- `plan_json` 向“策略参考”收敛。
- 逐步减少固定步骤重放依赖。

---

## 兼容策略

- 增加配置开关：`SCHEDULED_TASK_V2_ENABLED=true`
- V2 API 和旧 API 并行。
- 老任务继续跑旧链路；新任务可按开关切 V2。
