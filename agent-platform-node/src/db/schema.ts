import { boolean, integer, pgTable, serial, text } from "drizzle-orm/pg-core";

// agents：Agent 的基础身份表。
// 这里只放"这个 Agent 是谁"的稳定属性，不放具体运行配置。
export const agents = pgTable("agents", {
  id: serial("id").primaryKey(),
  // agent_uid：业务稳定 id，给 API、日志、前端和外部引用使用。
  agentUid: text("agent_uid").notNull().unique(),
  name: text("name").notNull(),
  // type：区分 custom / builtin / main。第一阶段先保留文本字段，后续可继续约束枚举。
  type: text("type").notNull(),
  description: text("description").notNull().default(""),
  capabilitiesJson: text("capabilities_json").notNull().default("[]"),
  ownerUserId: text("owner_user_id"),
  // current_version_id：指向当前默认运行版本，便于 run API 直接取"当前发布版"。
  currentVersionId: integer("current_version_id"),
  standaloneEnabled: boolean("standalone_enabled").notNull().default(true),
  subagentEnabled: boolean("subagent_enabled").notNull().default(false),
  uiMode: text("ui_mode").notNull().default("generic"),
  uiRoute: text("ui_route"),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// model_profiles：模型抽象层。
// AgentVersion 绑定的是 profile，而不是直接绑死某个裸模型名。
export const modelProfiles = pgTable("model_profiles", {
  id: serial("id").primaryKey(),
  profileUid: text("profile_uid").notNull().unique(),
  name: text("name").notNull(),
  // provider + model_name + base_url 共同决定真正走哪个模型服务。
  provider: text("provider").notNull(),
  modelName: text("model_name").notNull(),
  baseUrl: text("base_url"),
  // capability_json：记录 tool_calling / vision / image_generation 等能力标签。
  capabilityJson: text("capability_json").notNull().default("{}"),
  // default_params_json：记录默认 temperature、max_tokens、reasoning 等参数。
  defaultParamsJson: text("default_params_json").notNull().default("{}"),
  maxContextTokens: integer("max_context_tokens").notNull().default(32000),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// agent_versions：Agent 的可运行版本表。
// 真正影响运行行为的 prompt、skill、allowed_tools、context_policy 都冻结在这里。
export const agentVersions = pgTable("agent_versions", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").notNull(),
  version: integer("version").notNull(),
  modelProfileId: integer("model_profile_id").notNull(),
  systemPrompt: text("system_prompt").notNull(),
  skillText: text("skill_text").notNull().default(""),
  // allowed_tools_json：本版本允许暴露给 LLM 的工具白名单。
  allowedToolsJson: text("allowed_tools_json").notNull().default("[]"),
  // context_policy_json：后续多 Agent / WorkContext 阶段的上下文读取策略入口。
  contextPolicyJson: text("context_policy_json").notNull().default("{}"),
  modelParamsOverrideJson: text("model_params_override_json").notNull().default("{}"),
  outputSchemaJson: text("output_schema_json").notNull().default("{}"),
  maxSteps: integer("max_steps").notNull().default(6),
  status: text("status").notNull().default("published"),
  publishedAt: text("published_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// agent_runs：一次 Agent 执行的主记录。
// 这一层负责承接输入、快照、状态、结果摘要和错误信息。
export const agentRuns = pgTable("agent_runs", {
  id: serial("id").primaryKey(),
  // run_uid：业务稳定 id，给前端查询和跨表引用使用。
  runUid: text("run_uid").notNull().unique(),
  agentId: integer("agent_id").notNull(),
  agentVersionId: integer("agent_version_id").notNull(),
  userId: text("user_id"),
  sessionId: text("session_id"),
  // 下面三个 parent / work_context 字段第一阶段先预留，后面主 Agent 编排会用到。
  workContextId: text("work_context_id"),
  parentOrchestrationEventId: text("parent_orchestration_event_id"),
  parentRunId: integer("parent_run_id"),
  mode: text("mode").notNull().default("standalone"),
  status: text("status").notNull().default("queued"),
  userMessage: text("user_message").notNull(),
  handoffNote: text("handoff_note"),
  // delegate_envelope_json：主 Agent 语义委派阶段会写入完整任务信封。
  delegateEnvelopeJson: text("delegate_envelope_json").notNull().default("{}"),
  inputArtifactIdsJson: text("input_artifact_ids_json").notNull().default("[]"),
  outputArtifactIdsJson: text("output_artifact_ids_json").notNull().default("[]"),
  // snapshot_json：冻结本次运行时看到的 Agent / Version / ModelProfile 快照。
  snapshotJson: text("snapshot_json").notNull().default("{}"),
  // context_package_summary_json：记录这次 prompt context 的摘要，而不是完整 prompt。
  contextPackageSummaryJson: text("context_package_summary_json").notNull().default("{}"),
  resultSummary: text("result_summary"),
  outputJson: text("output_json").notNull().default("{}"),
  errorMessage: text("error_message"),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// agent_run_steps：Run 内部的事实轨迹。
// 第一阶段把模型调用、工具开始、工具结束、最终输出、错误都落到这里。
export const agentRunSteps = pgTable("agent_run_steps", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull(),
  stepIndex: integer("step_index").notNull(),
  // step_type：用于区分是模型调用、工具调用还是最终结果。
  stepType: text("step_type").notNull(),
  content: text("content"),
  toolName: text("tool_name"),
  toolCallId: text("tool_call_id"),
  toolStatus: text("tool_status"),
  inputJson: text("input_json").notNull().default("{}"),
  outputJson: text("output_json").notNull().default("{}"),
  metadataJson: text("metadata_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
});

// model_invocations：一次模型调用的审计记录。
// 用来回答"这次到底调用了哪个模型、看到了哪些上下文、耗了多少 token"。
export const modelInvocations = pgTable("model_invocations", {
  id: serial("id").primaryKey(),
  invocationUid: text("invocation_uid").notNull().unique(),
  runId: integer("run_id").notNull(),
  stepId: integer("step_id"),
  modelProfileId: integer("model_profile_id").notNull(),
  provider: text("provider").notNull(),
  modelName: text("model_name").notNull(),
  paramsJson: text("params_json").notNull().default("{}"),
  requestSummaryJson: text("request_summary_json").notNull().default("{}"),
  responseSummaryJson: text("response_summary_json").notNull().default("{}"),
  rawPayloadRef: text("raw_payload_ref"),
  // 这两个字段是后面 PromptContext / ContextBuilder 设计能否复盘的关键。
  promptContextSummaryJson: text("prompt_context_summary_json").notNull().default("{}"),
  selectedContextRefsJson: text("selected_context_refs_json").notNull().default("{}"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  latencyMs: integer("latency_ms"),
  status: text("status").notNull(),
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull(),
});

// projects：项目空间表。
// 作为多个会话的容器，代表一个完整的工作领域或目标。
export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  projectUid: text("project_uid").notNull().unique(),
  userId: text("user_id"),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  icon: text("icon").notNull().default("📁"),
  status: text("status").notNull().default("active"),
  metadataJson: text("metadata_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// sessions：会话表。
// 代表与 Agent 的一次完整协作过程，归属某个项目或个人空间。
export const sessions = pgTable("sessions", {
  id: serial("id").primaryKey(),
  sessionUid: text("session_uid").notNull().unique(),
  projectId: integer("project_id"), // null 表示个人会话，不归属项目
  userId: text("user_id"),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  // agentIdsJson：本次会话关联的智能体列表
  agentIdsJson: text("agent_ids_json").notNull().default("[]"),
  status: text("status").notNull().default("active"),
  metadataJson: text("metadata_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// work_contexts：同一工作目标下的主容器。
// 归属某个会话，由 LLM 在会话过程中动态生成，承接"这件工作是什么、现在做到哪、最近一次运行和最近一个产物是什么"。
export const workContexts = pgTable("work_contexts", {
  id: serial("id").primaryKey(),
  workContextUid: text("work_context_uid").notNull().unique(),
  userId: text("user_id"),
  // sessionId：归属的会话（字符串类型，与 agent_runs 保持一致）
  sessionId: text("session_id"),
  // projectId：归属的项目（可选，用于快速筛选）
  projectId: text("project_id"),
  title: text("title").notNull(),
  goal: text("goal").notNull().default(""),
  status: text("status").notNull().default("active"),
  // source：来源标识，如 manual / llm_generated
  source: text("source").notNull().default("manual"),
  currentRunId: integer("current_run_id"),
  latestArtifactId: integer("latest_artifact_id"),
  metadataJson: text("metadata_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// agent_artifacts：运行产物索引表。
// 第一版先承接文本、JSON 摘要、引用地址，不急着做复杂文件存储。
export const agentArtifacts = pgTable("agent_artifacts", {
  id: serial("id").primaryKey(),
  artifactUid: text("artifact_uid").notNull().unique(),
  workContextId: integer("work_context_id").notNull(),
  runId: integer("run_id"),
  artifactType: text("artifact_type").notNull(),
  title: text("title").notNull(),
  mimeType: text("mime_type"),
  contentText: text("content_text").notNull().default(""),
  contentJson: text("content_json").notNull().default("{}"),
  uri: text("uri"),
  status: text("status").notNull().default("ready"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
