# Agent Platform 核心表字段中文说明

本文档专门解释第一阶段 6 张核心表的字段含义。代码里的 `schema.ts` 负责定义结构，这份文档负责给出中文语义说明，避免后续开发只看到字段名却不知道边界。

补充说明：

- `schema.ts` 中有面向开发者的中文注释。
- PostgreSQL 初始化 SQL 中有 `COMMENT ON TABLE` / `COMMENT ON COLUMN`。
- 本文档负责做集中式字段解释，方便设计和协作查阅。

## 1. `agents`

用途：

- 保存 Agent 的基础身份。
- 描述“这个 Agent 是谁”，不直接描述“这次怎么运行”。

字段说明：

- `id`：数据库内部主键。
- `agent_uid`：业务稳定 id，给 API、前端、日志和外部引用使用。
- `name`：Agent 名称。
- `type`：Agent 类型，例如 `custom`、`builtin`、`main`。
- `description`：Agent 职责描述。
- `capabilities_json`：能力标签列表，例如 `["browser", "summary"]`。
- `owner_user_id`：创建者或归属用户。
- `current_version_id`：当前默认运行版本 id。
- `standalone_enabled`：是否允许用户直接单独运行。
- `subagent_enabled`：是否允许被主 Agent 当作子 Agent 委派。
- `ui_mode`：运行界面模式，例如 `generic`、`custom`。
- `ui_route`：专属前端页面路由。
- `status`：当前状态，例如 `active`、`archived`。
- `created_at`：创建时间。
- `updated_at`：更新时间。

## 2. `model_profiles`

用途：

- 保存模型能力抽象。
- 让 AgentVersion 绑定“稳定模型配置”，而不是直接绑一个裸模型名。

字段说明：

- `id`：数据库内部主键。
- `profile_uid`：业务稳定 id。
- `name`：Profile 名称。
- `provider`：模型供应商，例如 `kimi`、`openai`、`mock`。
- `model_name`：具体模型名。
- `base_url`：模型服务地址。
- `capability_json`：能力标签，例如 `tool_calling`、`vision`、`image_generation`。
- `default_params_json`：默认模型参数，例如 `temperature`、`max_tokens`。
- `max_context_tokens`：上下文窗口上限。
- `status`：Profile 状态。
- `created_at`：创建时间。
- `updated_at`：更新时间。

## 3. `agent_versions`

用途：

- 保存 Agent 的可运行版本。
- 一次运行真正依赖的是 AgentVersion，而不是 agents 表本身。

字段说明：

- `id`：数据库内部主键。
- `agent_id`：所属 Agent。
- `version`：版本号，递增。
- `model_profile_id`：绑定的模型配置。
- `system_prompt`：系统提示词。
- `skill_text`：技能说明或工作方法。
- `allowed_tools_json`：本版本允许暴露给 LLM 的工具白名单。
- `context_policy_json`：上下文读取策略，后续主 Agent / 子 Agent 组装 PromptContext 时使用。
- `model_params_override_json`：覆盖默认模型参数的配置。
- `output_schema_json`：预期输出结构定义。
- `max_steps`：一次运行最大步骤数。
- `status`：版本状态，例如 `draft`、`published`。
- `published_at`：发布时间。
- `created_at`：创建时间。
- `updated_at`：更新时间。

## 4. `agent_runs`

用途：

- 保存一次 Agent 执行的主记录。
- 负责承接输入、快照、状态、结果摘要和错误信息。

字段说明：

- `id`：数据库内部主键。
- `run_uid`：业务稳定 id。
- `agent_id`：执行的 Agent。
- `agent_version_id`：使用的 AgentVersion。
- `user_id`：发起用户。
- `session_id`：所属会话。
- `work_context_id`：所属工作上下文。第一阶段预留。
- `parent_orchestration_event_id`：来源编排事件。第一阶段预留。
- `parent_run_id`：父级运行。第一阶段预留。
- `mode`：运行模式，例如 `standalone`、`subagent`、`main`。
- `status`：运行状态，例如 `queued`、`running`、`success`、`failed`。
- `user_message`：用户原始输入。
- `handoff_note`：主 Agent 的交接说明。第一阶段可为空。
- `delegate_envelope_json`：委派信封结构，主 Agent 语义委派阶段会正式使用。
- `input_artifact_ids_json`：输入产物 id 列表。
- `output_artifact_ids_json`：输出产物 id 列表。
- `snapshot_json`：运行时冻结的 Agent / Version / ModelProfile 快照。
- `context_package_summary_json`：本次上下文包摘要。
- `result_summary`：结果摘要。
- `output_json`：最终输出结构。
- `error_message`：错误信息。
- `started_at`：开始时间。
- `finished_at`：结束时间。
- `created_at`：创建时间。
- `updated_at`：更新时间。

## 5. `agent_run_steps`

用途：

- 保存一次 Run 内部的事实轨迹。
- 第一阶段承担轻量版 RunTrace 的职责。

字段说明：

- `id`：数据库内部主键。
- `run_id`：所属 Run。
- `step_index`：步骤顺序号。
- `step_type`：步骤类型，例如 `model_call`、`tool_start`、`tool_end`、`final`、`error`。
- `content`：步骤文本内容。
- `tool_name`：工具名。
- `tool_call_id`：模型返回的工具调用 id。
- `tool_status`：工具执行状态。
- `input_json`：步骤输入。
- `output_json`：步骤输出。
- `metadata_json`：附加元数据。
- `created_at`：记录时间。

## 6. `model_invocations`

用途：

- 保存一次模型调用的审计记录。
- 用来回答“调用了哪个模型、看到了哪些上下文、消耗了多少 token”。

字段说明：

- `id`：数据库内部主键。
- `invocation_uid`：业务稳定 id。
- `run_id`：所属 Run。
- `step_id`：关联的 `agent_run_steps.id`。
- `model_profile_id`：使用的模型配置。
- `provider`：模型供应商。
- `model_name`：模型名。
- `params_json`：本次调用实际参数。
- `request_summary_json`：请求摘要，不保存完整 prompt。
- `response_summary_json`：响应摘要。
- `raw_payload_ref`：原始 payload 的外部引用地址。
- `prompt_context_summary_json`：本次 PromptContext 摘要。
- `selected_context_refs_json`：本次被选入上下文的结构化 refs。
- `input_tokens`：输入 token 数。
- `output_tokens`：输出 token 数。
- `latency_ms`：耗时毫秒数。
- `status`：调用状态，例如 `success`、`failed`。
- `error_message`：错误信息。
- `created_at`：记录时间。

## 7. 第一阶段边界提醒

- 这 6 张表先解决“单 Agent 跑起来并可复盘”。
- `work_context_id`、`parent_orchestration_event_id`、`delegate_envelope_json` 等字段第一阶段主要是预留，不代表主 Agent 编排已经实现。
- 真正的 WorkContext、Artifact、OrchestrationEvent、Memory 表在后续阶段再逐步落地。
