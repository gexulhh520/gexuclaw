Agent Platform Node 重构任务说明
用于交给其他大模型 / Codex / Trae 执行重构。
一、项目背景
当前项目路径：
agent-platform-node
当前系统已具备多 Agent 平台雏形：Fastify API、Drizzle 数据库、AgentRuntime、ToolRuntime、PluginRegistry、WorkContext、Artifact、agent_runs、agent_run_steps、parentRunId、SSE run stream、MainAgent orchestration。
现有核心文件：
agent-platform-node/src/modules/orchestration/orchestration.service.ts
agent-platform-node/src/modules/orchestration/main-agent.ts
agent-platform-node/src/modules/orchestration/context-builder.ts
agent-platform-node/src/modules/orchestration/orchestration.schema.ts
agent-platform-node/src/runtime/agent-runtime.ts
agent-platform-node/src/runtime/tool-runtime.ts
agent-platform-node/src/tools/tool-types.ts
agent-platform-node/src/db/schema.ts
agent-platform-node/src/modules/work-contexts/work-context.service.ts
agent-platform-node/src/modules/artifacts/artifact-coordinator.ts
当前核心问题：
1. 主 Agent 看到的上下文太粗，只能看到 WorkContext 列表和 recentRuns 摘要。
2. recentRuns 不包含 agent_run_steps，无法知道工具执行细节。
3. 一个 Session 里可能有多个 WorkContext，仅靠当前 WorkContext 无法判断用户指代。
4. 主 Agent 到子 Agent 目前主要靠 handoffNote，自然语言交接不稳定。
5. handoffNote 会增加额外 LLM 生成/理解成本，后续应废弃。
6. 子 Agent 需要结构化 TaskEnvelope，而不是模糊 handoffNote。
7. ToolResult 当前只有 success/data/error/meta/artifactCandidates，缺少 operation、sideEffects、verification、inputRefs、outputRefs。
8. tool_start 和 tool_end 如果都完整存 input/output 会浪费存储，需要轻量化。
9. 工具写入失败时，要写入的内容可能丢失，需要 pending_write artifact。
10. run.status 当前可能在工具失败后仍然 success，需要修正状态语义。
二、重构总目标
建立结构化 Agent 决策与执行链路：
User Message
  ↓
Session Runtime Snapshot Builder
  ↓
Session Context Index Builder
  ↓
Main LLM Decision Maker
  ↓
Decision Contract Validator
  ↓
Execution Plan Compiler
  ↓
Task Envelope Builder
  ↓
SubAgent Runtime
  ↓
Tool Runtime
  ↓
Execution Ledger
  ↓
WorkContext Projection
  ↓
Response Composer
核心原则：代码不判断用户业务意图；代码负责结构化事实、建立 refs、校验引用、执行计划、记录结果；LLM 负责基于结构化上下文做语义决策。
三、关键概念
1. Snapshot
Session Runtime Snapshot 是当前 Session 的运行态事实快照。它回答：当前 Session 下有哪些 WorkContext、每个 WorkContext 最近状态是什么、最近有哪些 run、run 是哪个 Agent 执行的、run 里有哪些 steps、有没有工具失败、最近有哪些 artifact、当前可用哪些 Agent。它不判断用户意图，只查事实。
2. ContextRef / refs
refs 是从 Snapshot 中抽取出来的“可引用对象索引”。它把 WorkContext、Run、Step、Artifact、File、Agent、Tool 统一变成 LLM 可以选择、代码可以校验的引用对象。
export type ContextRef = {
  refId: string;
  kind: "work_context" | "run" | "step" | "artifact" | "file" | "agent" | "tool";
  title: string;
  summary: string;
  workContextUid?: string;
  status?: string;
  source: { table?: string; uid?: string; runUid?: string; stepIndex?: number; uri?: string };
  tags: string[];
  evidence?: { selectedInUI?: boolean; recencyRank?: number; statusSignals?: string[]; semanticSignals?: string[] };
  updatedAt?: string;
};
refId 给代码执行使用，title/summary/tags/evidence 给 LLM 判断使用。
3. TaskEnvelope
TaskEnvelope 是主 Agent 给子 Agent 的结构化任务包，用来替代 handoffNote。子 Agent 不应该再靠自然语言 handoffNote 猜任务，而是接收 objective、originalUserMessage、selectedContext、constraints、allowedTools、expectedResult、outputContract。
4. handoffNote
handoffNote 后续不再作为独立协议字段。不要再让 LLM 额外生成 handoffNote。TaskEnvelopePrompt 是 TaskEnvelope 的代码渲染文本，不是 LLM 生成文本。
四、第一阶段：新增核心类型
建议新增或整理到：
agent-platform-node/src/modules/orchestration/orchestration.types.ts
agent-platform-node/src/runtime/task-envelope.ts
agent-platform-node/src/runtime/agent-result.ts
1. ContextRelation
export type ContextRelation = {
  fromRefId: string;
  toRefId: string;
  relation:
    | "belongs_to"
    | "created_by"
    | "executed_by"
    | "attempted_write"
    | "attempted_write_artifact"
    | "intended_for"
    | "produced"
    | "used_by"
    | "derived_from";
};

export type SessionContextIndex = {
  refs: ContextRef[];
  relations: ContextRelation[];
};
2. RuntimeRunTrace
export type RuntimeStepTrace = {
  stepIndex: number;
  stepType: string;
  content?: string;
  toolName?: string;
  toolCallId?: string;
  toolStatus?: string;
  inputJson?: unknown;
  outputJson?: unknown;
  metadataJson?: unknown;
  createdAt: string;
};

export type RuntimeRunTrace = {
  runUid: string;
  agentUid: string;
  agentName: string;
  mode: string;
  status: string;
  sessionId?: string;
  workContextUid?: string;
  parentRunId?: number;
  userMessage: string;
  resultSummary?: string;
  errorMessage?: string;
  steps: RuntimeStepTrace[];
  createdAt: string;
};
3. WorkContextCard / SessionRuntimeSnapshot
export type WorkContextCard = {
  workContextUid: string;
  title: string;
  goal: string;
  status: string;
  progressSummary?: string;
  currentStage?: string;
  nextAction?: string;
  updatedAt: string;
  latestRun?: { runUid: string; agentUid: string; agentName?: string; status: string; summary?: string; errorMessage?: string };
  latestArtifact?: { artifactUid: string; title: string; artifactType: string; summary?: string };
  signals: {
    selectedInUI: boolean;
    recentlyActive: boolean;
    hasFailedRun: boolean;
    hasOpenIssue: boolean;
    hasRecentArtifact: boolean;
    hasUnverifiedSideEffect?: boolean;
  };
  topRefs?: ContextRef[];
};

export type SessionRuntimeSnapshot = {
  userMessage: string;
  session: { sessionUid: string; title?: string; description?: string };
  selectedWorkContextUid?: string;
  workContexts: WorkContextCard[];
  globalRecentRuns: RuntimeRunTrace[];
  globalRecentArtifacts: Array<{ artifactUid: string; workContextUid?: string; title: string; artifactType: string; artifactRole?: string; summary?: string; createdAt?: string }>;
  availableAgents: Array<{ agentUid: string; name: string; description?: string; capabilities?: string[]; status?: string }>;
};
4. MainDecision
export type MainDecision = {
  decisionType:
    | "answer_directly"
    | "create_work_context"
    | "use_existing_work_context"
    | "switch_work_context"
    | "delegate"
    | "multi_step_plan"
    | "ask_user"
    | "explain_trace"
    | "verify_execution"
    | "recover_execution";
  targetWorkContextUid?: string;
  primaryRefs: string[];
  secondaryRefs: string[];
  targetAgentUid?: string;
  plan?: {
    steps: Array<{
      targetAgentUid: string;
      objective: string;
      inputRefIds: string[];
      expectedResultKind?: "answer" | "artifact" | "file_change" | "diagnosis" | "verification";
      requireVerification?: boolean;
    }>;
  };
  response?: string;
  ambiguity?: { candidateWorkContextUids: string[]; candidateRefIds: string[]; question: string };
  confidence: "high" | "medium" | "low";
  reasoning: string;
};
5. ExecutionPlan
export type ExecutionPlan = {
  planUid: string;
  mode: "direct_response" | "single_agent" | "sequential_agents" | "parallel_agents";
  workContextUid?: string;
  selectedRefs: string[];
  steps: Array<{
    stepUid: string;
    targetAgentUid: string;
    objective: string;
    inputRefIds: string[];
    dependsOn: string[];
    expectedResultKind: "answer" | "artifact" | "file_change" | "diagnosis" | "verification";
    requireVerification: boolean;
    allowedTools: string[];
  }>;
  finalResponseStrategy: "use_direct_response" | "compose_from_agent_results" | "compose_from_ledger";
};
6. TaskEnvelope
export type TaskEnvelope = {
  envelopeUid: string;
  parentRunUid: string;
  workContextUid: string;
  targetAgentUid: string;
  objective: string;
  originalUserMessage: string;
  selectedContext: {
    refs: ContextRef[];
    ledgerSlices: LedgerSlice[];
    artifacts: ArtifactSlice[];
    files: FileSlice[];
  };
  constraints: string[];
  allowedTools: string[];
  expectedResult: {
    kind: "answer" | "file_change" | "artifact" | "diagnosis" | "verification";
    requireVerification: boolean;
  };
  outputContract: {
    format: "agent_result_json";
    mustIncludeOperations: boolean;
    mustIncludeOpenIssues: boolean;
  };
};
五、第二阶段：增强 ToolResult
当前文件：agent-platform-node/src/tools/tool-types.ts。
需要兼容扩展为：
export type ToolResult = {
  success: boolean;
  data?: unknown;
  error?: string | {
    code: string;
    message: string;
    retryable?: boolean;
    category?: "validation" | "permission" | "not_found" | "conflict" | "runtime" | "external" | "unknown";
  };
  meta?: Record<string, unknown>;
  artifactCandidates?: ToolArtifactCandidate[];
  operation?: {
    type: "read" | "write" | "edit" | "append" | "delete" | "list" | "search" | "analyze" | "generate" | "verify";
    target?: string;
    targetKind?: "file" | "artifact" | "url" | "db_record" | "external_resource";
  };
  sideEffects?: Array<{
    type: "file_write" | "file_edit" | "file_append" | "file_delete" | "artifact_create" | "external_call";
    target: string;
    status: "created" | "modified" | "deleted" | "attempted" | "none";
  }>;
  verification?: {
    required: boolean;
    status: "verified" | "unverified" | "failed" | "not_applicable";
    method?: string;
    evidence?: unknown;
  };
  inputRefs?: Array<{ refId?: string; artifactUid?: string; uri?: string; role?: "input" | "source" | "target" | "content" }>;
  outputRefs?: Array<{ refId?: string; artifactUid?: string; uri?: string; role?: "result" | "created" | "modified" | "pending_write" }>;
};
要求：保留旧字段避免破坏现有工具；写入类工具必须返回 operation / sideEffects / verification；读类工具可以只返回 operation；失败时 error 尽量使用结构化对象。
六、第三阶段：新增 LedgerReader
新增文件：agent-platform-node/src/modules/orchestration/ledger-reader.ts。
职责：从 agent_runs / agent_run_steps / agents 读取运行事实，不做用户意图判断。
必须提供：
export class LedgerReader {
  async getRecentRunsWithSteps(input: { sessionId: string; limit?: number; stepsPerRun?: number }): Promise<RuntimeRunTrace[]>;
  async getRunWithSteps(runUid: string): Promise<RuntimeRunTrace | undefined>;
  async getStepSlice(input: { runUid: string; stepIndex: number; before?: number; after?: number }): Promise<LedgerSlice>;
  async getRunSlice(runUid: string): Promise<LedgerSlice>;
}
注意：getRecentRuns 当前只读 agent_runs 摘要，不要直接替换。新增 getRecentRunsWithSteps 用于运行态快照。
七、第四阶段：新增 SessionRuntimeSnapshotBuilder
新增文件：agent-platform-node/src/modules/orchestration/session-runtime-snapshot-builder.ts。
职责：读取当前 session 下多个 WorkContext、recent runs、artifacts、agents，构造成 SessionRuntimeSnapshot。不判断用户意图。
实现要求：获取 session 信息；获取 session 下最近/活跃的 WorkContext，建议 limit 10；每个 WorkContext 转为 WorkContextCard；读取 globalRecentRuns；读取 globalRecentArtifacts；获取 availableAgents；selectedWorkContextUid 只作为信号，不作为绝对依据。
八、第五阶段：新增 SessionContextIndexBuilder
新增文件：agent-platform-node/src/modules/orchestration/session-context-index-builder.ts。
职责：把 SessionRuntimeSnapshot 中的 WorkContext / Run / Step / Artifact / Agent / File 转成 refs。不判断用户意图。
refId 格式建议：
wc:<workContextUid>
run:<runUid>
step:<runUid>:<stepIndex>
artifact:<artifactUid>
agent:<agentUid>
file:<path>
需要生成 relation：run belongs_to work_context；step belongs_to run；step belongs_to work_context；run executed_by agent；step attempted_write file；artifact belongs_to work_context。
九、第六阶段：升级 MainAgent
当前文件：agent-platform-node/src/modules/orchestration/main-agent.ts。
新增方法：
async decideWithSessionIndex(input: {
  userMessage: string;
  snapshot: SessionRuntimeSnapshot;
  contextIndex: SessionContextIndex;
}): Promise<MainDecision>
Prompt 要求：主 Agent 会收到用户消息、多个 WorkContext 卡片、ContextRefs 和 relations、可用 Agent；它必须选择相关 WorkContext、primaryRefs / secondaryRefs，并决定直接回复、委派、恢复、验证、解释、创建任务、多步骤计划或澄清。禁止编造 refId、workContextUid、agentUid。多个候选都强且无法区分时必须 ask_user。selectedInUI 只是提示，不是绝对依据。
十、第七阶段：新增 DecisionContractValidator
新增文件：agent-platform-node/src/modules/orchestration/decision-contract-validator.ts。
职责：校验 LLM 输出是否引用真实对象，不判断用户业务语义。
校验项：targetWorkContextUid 是否存在；primaryRefs / secondaryRefs 是否存在；selected refs 是否属于当前 session；targetAgentUid 是否存在；plan.steps 中 targetAgentUid 和 inputRefIds 是否存在；delegate/multi_step_plan/recover/verify 是否具备必要字段。
十一、第八阶段：新增 ExecutionPlanCompiler
新增文件：agent-platform-node/src/modules/orchestration/execution-plan-compiler.ts。
注意：这个模块不需要 LLM。职责是把 MainDecision / PlanDraft 确定性转换为 ExecutionPlan。
要求：answer_directly → direct_response；delegate → single_agent；multi_step_plan → sequential_agents 或 parallel_agents；为 plan 和 step 生成 uid；补 dependsOn；根据 targetAgentUid / expectedResultKind 推导 allowedTools；allowedTools 不能超过 AgentVersion.allowedTools + plugin tools；selectedRefs = primaryRefs + secondaryRefs。
十二、第九阶段：新增 TaskEnvelopeBuilder
新增文件：agent-platform-node/src/modules/orchestration/task-envelope-builder.ts。
职责：把 ExecutionPlan.step 转成 TaskEnvelope，不调用 LLM。
构造流程：
PlanStep.inputRefIds
  ↓
从 ContextIndex 找 refs
  ↓
根据 refs.source 展开 ledgerSlices / artifacts / files
  ↓
根据 targetAgentUid 和 expectedResultKind 计算 allowedTools
  ↓
加入 constraints 和 outputContract
  ↓
生成 TaskEnvelope
约束：只展开 inputRefIds 相关上下文；不提供整个 session 历史；不提供所有 WorkContext；不提供所有 artifacts；子 Agent 不再自己猜上下文；requireVerification 为 true 时，constraints 中必须要求验证副作用。
十三、第十阶段：废弃 handoffNote
1. 修改 RunAgentInput
当前 AgentRuntime.run 使用 userMessage / handoffNote，建议改成：
type RunAgentInput = {
  agentRecord: { id: number; agentUid: string; name: string; type: string };
  versionRecord: {
    id: number;
    version: number;
    modelProfileId: number;
    systemPrompt: string;
    skillText: string;
    allowedToolsJson: string;
    contextPolicyJson: string;
    modelParamsOverrideJson: string;
    maxSteps: number;
  };
  originalUserMessage: string;
  taskEnvelope?: TaskEnvelope;
  userId?: string;
  sessionId?: string;
  workContextId?: string;
  parentRunId?: number;
  mode: "standalone" | "subagent" | "main";
};
规则：main / standalone 可以没有 taskEnvelope，使用 originalUserMessage；subagent 必须有 taskEnvelope，originalUserMessage 只用于追踪，子 Agent 的任务目标来自 taskEnvelope.objective。
2. 不再使用 handoffNote
创建 agent_runs 时：
userMessage: input.originalUserMessage,
handoffNote: null,
delegateEnvelopeJson: input.taskEnvelope ? jsonStringify(input.taskEnvelope) : null,
如果数据库字段 handoffNote 仍存在，先置空即可，不需要立刻删数据库字段。
3. 新增 renderTaskEnvelopeForAgent
新增文件：agent-platform-node/src/modules/orchestration/task-envelope-renderer.ts。
注意：这是代码渲染，不是 LLM 调用。函数应将 TaskEnvelope 渲染为子 Agent 可读的 Task Envelope Prompt。
十四、第十一阶段：修改 AgentRuntime
当前文件：agent-platform-node/src/runtime/agent-runtime.ts。
需要修改：接收 taskEnvelope 和 originalUserMessage；计算 effectiveUserMessage；渲染 taskEnvelopePrompt；renderSystemMessage 中不要再拼 handoffNote，而是拼 Task Envelope；工具权限改为 AgentVersion/Plugin tools 与 TaskEnvelope.allowedTools 的交集；tool_start / tool_end 轻量化存储；run.status 不能固定 success。
示例：
const effectiveUserMessage =
  input.mode === "subagent" && input.taskEnvelope
    ? input.taskEnvelope.objective
    : input.originalUserMessage;

const baseAllowedTools = [...new Set([...allowedTools, ...pluginToolIds])];
const envelopeAllowedTools = args.input.taskEnvelope?.allowedTools;
const mergedAllowedTools = envelopeAllowedTools
  ? baseAllowedTools.filter((tool) => envelopeAllowedTools.includes(tool))
  : baseAllowedTools;
tool_start 只存 summary input + inputRefs；tool_end 存 ToolResult + summary input + metadata；大 content 保存为 artifact，不重复存进 step。
十五、第十二阶段：pending_write artifact
场景：某个 Agent 生成了内容，准备写入文件，但 fs_write 失败。要求：要写入的内容不能丢，必须保存为 pending_write artifact。
第一版策略：如果写入工具失败且 input 中有大段 content，自动保存 content 为 artifact；artifactRole = pending_write；artifactType = file_content；metadata 中保存 targetPath、failedRunUid、failedStepRef；ToolResult.outputRefs 指向 artifact。
ContextIndexBuilder 后续需要生成：artifact: status=pending_write；file:README.md status=write_failed；step:: status=failed，并建立 artifact intended_for file、step attempted_write_artifact artifact、step attempted_write file 的 relations。
十六、第十三阶段：修改 Orchestration 主流程
当前 processChatAsync 旧流程大概是 buildMainAgentContext → decideFirstStep → decideSecondStep → delegate/respond/clarify。新流程先不要删除旧流程，可以 fallback。
目标流程：
const snapshot = await sessionRuntimeSnapshotBuilder.build({
  sessionId: input.sessionId,
  userMessage: input.message,
  selectedWorkContextUid: input.workContextId,
});

const contextIndex = await sessionContextIndexBuilder.build(snapshot);

const decision = await mainAgent.decideWithSessionIndex({
  userMessage: input.message,
  snapshot,
  contextIndex,
});

const validation = await decisionContractValidator.validate({
  decision,
  snapshot,
  contextIndex,
});

const plan = await executionPlanCompiler.compile({
  decision: validation.normalizedDecision,
  snapshot,
  contextIndex,
});

const result = await executePlan({
  plan,
  mainRunId,
  snapshot,
  contextIndex,
});
executePlan 中：如果 direct_response，直接回复；如果 single_agent/sequential_agents，逐步构造 TaskEnvelope；调用 AgentRuntime.run({ mode: “subagent”, taskEnvelope, originalUserMessage })；收集 AgentResult。
十七、验收标准
1.多 WorkContext 指代：Session 里有 wc_file_test 和 wc_arch。当前 UI 选中 wc_arch。wc_file_test 最近有 fs_write failed。用户输入“失败了”。期望 LLM Decision 选择 wc_file_test，primaryRefs 包含 failed step，不应该盲目使用当前 UI 选中的 wc_arch。
2.模糊多候选：wc_file_test 有工具失败，wc_arch 有架构方案被用户否定。用户输入“刚才那个失败了”。如果两个候选证据都强，MainDecision.decisionType = ask_user，问题应该带候选：“你说的是文件写入失败，还是架构方案不满意？”
3.子 Agent 输入：subagent run 必须有 delegateEnvelopeJson。不再依赖 handoffNote。TaskEnvelope 中包含 objective、selectedContext、allowedTools、expectedResult。
4.工具权限：子 Agent 暴露给 LLM 的 tools = AgentVersion/Plugin tools ∩ TaskEnvelope.allowedTools。
5.工具写入失败：fs_write 写 README.md 失败。ToolResult 包含 operation、sideEffects、verification、error。agent_run_steps.tool_end.metadataJson 包含 sideEffects/verification。run.status = failed 或 partial_success。如果 input 有 content，生成 pending_write artifact。
6.tool_start 存储：tool_start 不存大 content。tool_start 只存 summary/inputRefs。tool_end 存结果和 metadata。
7.失败后恢复：上一步内容生成成功，但写入失败。用户输入“重新写”。期望 MainDecision primaryRefs 包含 pending_write artifact 和 failed step。TaskEnvelope 给 filesystem_agent。子 Agent 使用 pending_write artifact 内容重试写入，而不是重新生成内容。
十八、不要做的事情
1. 不要继续增强 handoffNote。
2. 不要让 LLM 额外生成 handoffNote。
3. 不要用正则判断“失败了/继续/刚才那个”。
4. 不要让代码判断用户业务语义。
5. 不要把整个 Session 历史塞给子 Agent。
6. 不要让子 Agent 自己猜上下文。
7. 不要把大段 content 同时存在 tool_start 和 tool_end。
8. 不要让工具失败后 run 仍然固定 success。
9. 不要让 TaskEnvelope.allowedTools 只是软提示，必须和工具 manifest 取交集。
十九、推荐实施顺序
Phase 1：地基。新增 orchestration.types.ts / task-envelope.ts；扩展 ToolResult；新增 LedgerReader；新增 SessionRuntimeSnapshotBuilder；新增 SessionContextIndexBuilder。
Phase 2：主 Agent 决策。MainAgent 新增 decideWithSessionIndex；新增 DecisionContractValidator；新增 ExecutionPlanCompiler。
Phase 3：子 Agent 委派。新增 TaskEnvelopeBuilder；新增 TaskEnvelopeRenderer；AgentRuntime 支持 taskEnvelope；废弃 handoffNote；工具权限取交集。
Phase 4：工具和状态。AgentRuntime tool_start/tool_end 轻量化；filesystem 写入类工具返回 sideEffects/verification；写入失败保存 pending_write artifact；run.status 根据工具结果计算。
Phase 5：投影与体验。新增 WorkContextProjectionService；从 ledger/artifacts 更新 progressSummary/currentFocus/openIssues/recentRefs；前端展示 selectedRefs、TaskEnvelope、failed step、pending artifact。
二十、最终目标
重构完成后，主 Agent 不再靠模糊上下文和 handoffNote 调度。
结构化 Session 状态
  +
ContextRefs 证据索引
  +
LLM MainDecision
  +
代码校验
  +
ExecutionPlan
  +
TaskEnvelope
  +
子 Agent 受限执行
  +
工具副作用验证
  +
Ledger 复盘
最终效果：用户说“失败了”，系统不是反问“哪里失败了”，而是基于 refs 知道最近哪个 WorkContext、哪个 run、哪个 step、哪个工具、哪个 artifact 相关。如果证据明确，直接恢复；如果证据冲突，精准澄清；如果内容已生成但写入失败，使用 pending_write artifact 重试，而不是重新生成。