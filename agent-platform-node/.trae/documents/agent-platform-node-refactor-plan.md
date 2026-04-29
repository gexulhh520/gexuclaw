# Agent Platform Node 重构计划（对齐修复版）

## 项目背景

当前 `agent-platform-node` 已具备多 Agent 平台雏形：Fastify API、Drizzle 数据库、AgentRuntime、ToolRuntime、PluginRegistry、WorkContext、Artifact、agent\_runs、agent\_run\_steps、parentRunId、SSE run stream、MainAgent orchestration。

**核心问题：**

1. 主 Agent 看到的上下文太粗，只能看到 WorkContext 列表和 recentRuns 摘要
2. recentRuns 不包含 agent\_run\_steps，无法知道具体工具执行细节
3. 一个 Session 里可能有多个 WorkContext，仅靠当前 WorkContext 无法判断用户指代
4. 主 Agent 到子 Agent 目前主要靠 handoffNote，自然语言交接不稳定
5. handoffNote 会增加额外 LLM 生成/理解成本，后续应废弃
6. 子 Agent 需要结构化 TaskEnvelope，而不是模糊 handoffNote
7. ToolResult 当前只有 success/data/error/meta/artifactCandidates，缺少 operation、sideEffects、verification、inputRefs、outputRefs
8. tool\_start 和 tool\_end 如果都完整存 input/output 会浪费存储，需要轻量化
9. 工具写入失败时，要写入的内容可能丢失，需要 pending\_write artifact
10. run.status 当前可能在工具失败后仍然 success，需要修正状态语义

## 重构总目标

建立结构化 Agent 决策与执行链路：

```
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
```

核心原则：**代码不判断用户业务意图；代码负责结构化事实、建立 refs、校验引用、执行计划、记录结果；LLM 负责基于结构化上下文做语义裁决。**

***

## LLM 参与边界

- **必须固定格式输出：** 只有 `MainDecision` 一处
- **不要求固定 JSON：** SubAgent AgentResult 由代码合成，LLM 输出自然语言 summary
- **完全由代码生成：** SessionRuntimeSnapshot、SessionContextIndex、ContextRef、ContextRelation、DecisionContractValidator 结果、ExecutionPlan、TaskEnvelope、ToolResult、AgentResult.operations、WorkContextProjection、Ledger records

***

## 实施阶段

### Phase 1：类型定义（P0）

#### 1.1 新增 orchestration.types.ts

**文件：** `src/modules/orchestration/orchestration.types.ts`

定义核心类型：

- `ContextRef` / `ContextRefKind` - 可引用对象索引
- `ContextRelation` - 引用对象之间的关系
- `SessionContextIndex` - 上下文索引
- `RuntimeStepTrace` / `RuntimeRunTrace` - 运行时轨迹
- `WorkContextCard` - WorkContext 卡片
- `SessionRuntimeSnapshot` - 会话运行时快照
- `MainDecisionInput` - 给 LLM 的决策输入
- `MainDecision` - 主 Agent 决策结果
- `ExecutionPlan` - 执行计划

#### 1.2 新增 main-decision.schema.ts

**文件：** `src/modules/orchestration/main-decision.schema.ts`

使用 zod 定义 `MainDecision` 的完整 schema：

- `planStepDraftSchema`
- `mainDecisionSchema`（含 decisionType 枚举、targetWorkContextUid、primaryRefs/secondaryRefs、targetAgentUid、plan、response、ambiguity、confidence、reasoning）

#### 1.3 新增 task-envelope.ts

**文件：** `src/runtime/task-envelope.ts`

定义 TaskEnvelope 及其相关切片类型：

- `TaskEnvelope`
- `LedgerSlice`
- `ArtifactSlice`
- `FileSlice`

#### 1.4 扩展 ToolResult

**文件：** `src/tools/tool-types.ts`

向后兼容扩展 `ToolResult`，新增：

- `operation` - 操作类型和目标
- `sideEffects` - 副作用记录
- `verification` - 验证状态
- `inputRefs` / `outputRefs` - 输入输出引用
- 结构化 `error` 对象（含 code、message、retryable、category）

要求：保留旧字段；写入类工具必须返回 operation/sideEffects/verification；读类工具可以只返回 operation；失败时 error 尽量使用结构化对象。

#### 1.5 新增 agent-result.ts

**文件：** `src/runtime/agent-result.ts`

定义 `AgentResult` 类型：

- `status`（success / partial\_success / failed / needs\_clarification）
- `summary`
- `operations`（从工具事实生成）
- `producedArtifacts`
- `touchedResources`
- `openIssues`
- `retryAdvice`

规则：status/operations/verification/touchedResources 应从工具事实生成；summary 可使用 LLM final 文本；不要让 LLM 覆盖工具真实失败状态。

***

### Phase 2：数据读取层（P0）

#### 2.1 新增 LedgerReader

**文件：** `src/modules/orchestration/ledger-reader.ts`

职责：从 `agent_runs` / `agent_run_steps` / `agents` 读取运行事实，不做用户意图判断。

提供方法：

- `getRecentRunsWithSteps(sessionId, limit?, stepsPerRun?)`
- `getRunWithSteps(runUid)`
- `getStepSlice(runUid, stepIndex, before?, after?)`
- `getRunSlice(runUid)`

注意：不要直接替换旧 `getRecentRuns()`，旧方法可继续用于摘要。

#### 2.2 新增 SessionRuntimeSnapshotBuilder

**文件：** `src/modules/orchestration/session-runtime-snapshot-builder.ts`

职责：读取当前 session 下多个 WorkContext、recent runs、artifacts、agents，构造成 `SessionRuntimeSnapshot`。

输入：`{ sessionId, userMessage, selectedWorkContextUid? }`

实现要求：

1. 获取 session 信息
2. 获取 session 下最近/活跃的 WorkContext（limit 10）
3. 每个 WorkContext 转为 `WorkContextCard`
4. 读取 `globalRecentRuns` = `ledgerReader.getRecentRunsWithSteps(sessionId, 10)`
5. 读取 `globalRecentArtifacts`
6. 获取 `availableAgents`
7. `selectedWorkContextUid` 只作为信号，不作为绝对依据

#### 2.3 新增 SessionContextIndexBuilder

**文件：** `src/modules/orchestration/session-context-index-builder.ts`

职责：把 `SessionRuntimeSnapshot` 中的 WorkContext / Run / Step / Artifact / Agent / File 转成 refs。

输出：`SessionContextIndex`

refId 格式：

- `wc:<workContextUid>`
- `run:<runUid>`
- `step:<runUid>:<stepIndex>`
- `artifact:<artifactUid>`
- `agent:<agentUid>`
- `file:<path>`

需要生成的 relation：

- run `belongs_to` work\_context
- step `belongs_to` run
- step `belongs_to` work\_context
- run `executed_by` agent
- step `attempted_write` file
- artifact `belongs_to` work\_context

***

### Phase 3：主 Agent 决策层（P0）

#### 3.1 升级 MainAgent

**文件：** `src/modules/orchestration/main-agent.ts`

新增方法 `decideWithSessionIndex()`：

- 接收 `userMessage` + `snapshot` + `contextIndex`
- 构造 `MainDecisionInput` JSON
- 调用 LLM 输出 `MainDecision` JSON
- 使用低温度（0\~0.1）
- 支持 JSON Schema / json\_object 格式
- 解析失败时自动 repair 一次，仍失败则降级为 `ask_user`

Prompt 要求（System Prompt）：

- 禁止编造 refId、workContextUid、agentUid
- selectedInUI 只是提示，不是绝对依据
- 多个候选都强且无法区分时必须 ask\_user
- 优先关注 failed、error、unverified、write\_failed 的 refs

`MainDecisionInput` 放入 OpenAI `messages[].content` 的 user message 中，不是 tools。

#### 3.2 新增 DecisionContractValidator

**文件：** `src/modules/orchestration/decision-contract-validator.ts`

职责：校验 LLM 输出是否引用了真实对象，不判断用户业务语义。

校验项：

1. targetWorkContextUid 是否存在
2. primaryRefs / secondaryRefs 是否存在于 contextIndex.refs
3. selected refs 是否属于当前 session
4. targetAgentUid 是否存在于 availableAgents
5. plan.steps 中 targetAgentUid 是否存在
6. plan.steps 中 inputRefIds 是否存在
7. decisionType 为 delegate/multi\_step\_plan/recover/verify 时是否有必要字段
8. 如果校验失败，返回 ask\_user 或 repair/fallback

***

### Phase 4：计划编译层（P0）

#### 4.1 新增 ExecutionPlanCompiler

**文件：** `src/modules/orchestration/execution-plan-compiler.ts`

注意：**这个模块不需要 LLM。**

职责：把 `MainDecision` 确定性转换为 `ExecutionPlan`。

转换规则：

- `answer_directly` → `direct_response`
- `delegate` → `single_agent`
- `multi_step_plan` → `sequential_agents` 或 `parallel_agents`
- 为 plan 和 step 生成 uid
- 补 dependsOn
- 根据 targetAgentUid / expectedResultKind 从 Agent 当前可用工具中筛选 allowedTools
- allowedTools 不能超过 AgentVersion.allowedTools + pluginTools
- selectedRefs = primaryRefs + secondaryRefs

重要约束：ExecutionPlanCompiler 不能创造工具权限。最终暴露给 LLM 的工具必须是 `AgentVersion.allowedTools + pluginTools` 与 `TaskEnvelope.allowedTools` 的交集。

***

### Phase 5：Orchestration 主流程接入（P0/P1）

#### 5.1 修改 orchestration.service.ts

**文件：** `src/modules/orchestration/orchestration.service.ts`

目标新流程：

```ts
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

if (!validation.valid) {
  // 返回澄清问题或 fallback
}

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
```

迁移要求：

1. 新流程优先
2. 保留旧流程 fallback
3. 新流程失败时可回退旧流程
4. 所有新增委派逻辑必须走 TaskEnvelope

***

### Phase 6：子 Agent 委派层（P1）

#### 6.1 新增 TaskEnvelopeBuilder

**文件：** `src/modules/orchestration/task-envelope-builder.ts`

职责：把 `ExecutionPlan.step` 转成 `TaskEnvelope`，不调用 LLM。

构造流程：

```
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
```

约束：

- 只展开 inputRefIds 相关上下文
- 不给整个 session 历史
- 不给所有 WorkContext
- 不给所有 artifacts
- 子 Agent 不再自己猜上下文
- requireVerification 为 true 时，constraints 中必须要求验证副作用

#### 6.2 新增 TaskEnvelopeRenderer

**文件：** `src/modules/orchestration/task-envelope-renderer.ts`

注意：**这是代码渲染，不是 LLM 调用。**

职责：将 `TaskEnvelope` 渲染为子 Agent 可读的 Task Envelope Prompt。

#### 6.3 废弃 handoffNote

修改 `RunAgentInput` 类型：

- 新增 `originalUserMessage` 字段
- 新增 `taskEnvelope?: TaskEnvelope` 字段
- 废弃 `handoffNote` / `userMessage`

规则：

- `main` / `standalone` 可以没有 taskEnvelope，使用 originalUserMessage
- `subagent` 必须有 taskEnvelope，originalUserMessage 只用于追踪
- 子 Agent 的任务目标来自 `taskEnvelope.objective`

落库：

```ts
userMessage: input.originalUserMessage,
handoffNote: null,
delegateEnvelopeJson: input.taskEnvelope ? jsonStringify(input.taskEnvelope) : null,
```

数据库字段 `handoffNote` 可以先保留，但新流程不再写入。

***

### Phase 7：AgentRuntime 修改（P1）

#### 7.1 接收 taskEnvelope

**文件：** `src/runtime/agent-runtime.ts`

`RunAgentInput` 增加 `taskEnvelope?: TaskEnvelope` 和 `originalUserMessage: string`。

#### 7.2 计算 effectiveUserMessage

```ts
const effectiveUserMessage =
  input.mode === "subagent" && input.taskEnvelope
    ? input.taskEnvelope.objective
    : input.originalUserMessage;
```

#### 7.3 渲染 taskEnvelopePrompt

```ts
const taskEnvelopePrompt = input.taskEnvelope
  ? renderTaskEnvelopeForAgent(input.taskEnvelope)
  : undefined;
```

#### 7.4 renderSystemMessage 不再拼 handoffNote

旧：`context.handoffNote ? \`\nHandoff note:\n${context.handoffNote}\` : ""`
新：`taskEnvelopePrompt ? \`\nTask Envelope:\n${taskEnvelopePrompt}\` : ""\`

#### 7.5 工具权限取交集

```ts
const baseAllowedTools = [...new Set([...allowedTools, ...pluginToolIds])];
const envelopeAllowedTools = args.input.taskEnvelope?.allowedTools;
const mergedAllowedTools = envelopeAllowedTools
  ? baseAllowedTools.filter((tool) => envelopeAllowedTools.includes(tool))
  : baseAllowedTools;
```

这样 TaskEnvelope.allowedTools 变成硬约束。

***

### Phase 8：工具和状态层（P1）

#### 8.1 tool\_start / tool\_end 轻量化

**文件：** `src/runtime/agent-runtime.ts`

策略：

- `tool_start` 只存 summary input + inputRefs，不存大 content
- `tool_end` 存 ToolResult + summary input + metadata
- 大 content 保存为 artifact，不重复存进 step

tool\_start 存 metadata：{ inputRefs, omittedFields, recordLevel: "summary" }
tool\_end 存 metadata：{ inputRefs, operation, sideEffects, verification, outputRefs, recordLevel: "result" }

#### 8.2 filesystem 写入类工具返回 sideEffects/verification

**文件：** `src/modules/plugins/builtins/filesystem-core/filesystem-tools.ts`

修改 fs\_write、fs\_append、fs\_edit、fs\_apply\_patch：

- 返回 `operation` 字段
- 返回 `sideEffects` 数组
- 返回 `verification` 对象
- 失败时返回结构化 `error` 对象

#### 8.3 run.status 根据工具结果计算

不要固定 success。

```ts
const finalStatus = result.hasFailedTool
  ? "failed"
  : result.hasUnverifiedSideEffect
    ? "partial_success"
    : "success";
```

`executeRunLoop` 需要累计 toolExecutions / hasFailedTool / hasUnverifiedSideEffect，然后由代码合成 AgentResult。

***

### Phase 9：pending\_write artifact（P1/P2）

场景：某个 Agent 生成了内容，准备写入文件，但 fs\_write 失败。

第一版策略：

1. 如果写入工具失败且 input 中存在大段 content，自动保存 content 为 artifact
2. `artifactRole = pending_write`
3. `artifactType = file_content`
4. metadata 中保存 targetPath、failedRunUid、failedStepRef
5. `ToolResult.outputRefs` 指向 artifact

ContextIndexBuilder 后续需要生成：

- artifact: status=pending\_write
- file:README.md status=write\_failed
- step: status=failed

并建立 relation：

- artifact `intended_for` file
- step `attempted_write_artifact` artifact
- step `attempted_write` file

长期目标：写入前先把待写入内容 staging 为 artifact，fs\_write 只接收 contentArtifactUid，避免大内容进入 tool input。

***

### Phase 10：投影与体验层（P2）

#### 10.1 新增 WorkContextProjectionService

**文件：** `src/modules/work-contexts/work-context-projection.service.ts`

职责：从 ledger/artifacts 更新 WorkContext 的 progressSummary / currentFocus / openIssues / recentRefs。

第一版投影字段：

- `currentStage`（created / planning / executing / waiting\_user / recovering / completed / blocked）
- `progressSummary`
- `recentRefs`
- `currentFocus`
- `openIssues`
- `lastRunUid` / `lastSuccessfulRunUid` / `lastFailedRunUid`

#### 10.2 ResponseComposer

第一版可以很薄：

1. direct\_response 使用 MainDecision.response
2. 子 Agent 执行后使用 AgentResult.summary
3. 多步骤执行汇总 AgentResult.status / summary / openIssues
4. 复杂自然语言总结后续再接 LLM，可选

不要第一版就把 ResponseComposer 做成复杂 LLM 总结器。

***

## 推荐实施顺序

| Phase    | 内容                                                                        | 优先级   | 文件                                                                                                |
| -------- | ------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------- |
| Phase 1  | 类型定义：ContextRef / MainDecision / TaskEnvelope / AgentResult / ToolResult  | P0    | orchestration.types.ts, main-decision.schema.ts, task-envelope.ts, agent-result.ts, tool-types.ts |
| Phase 2  | LedgerReader + SessionRuntimeSnapshotBuilder + SessionContextIndexBuilder | P0    | ledger-reader.ts, session-runtime-snapshot-builder.ts, session-context-index-builder.ts           |
| Phase 3  | MainAgent.decideWithSessionIndex + MainDecision LLM JSON 输出               | P0    | main-agent.ts                                                                                     |
| Phase 4  | DecisionContractValidator + ExecutionPlanCompiler                         | P0    | decision-contract-validator.ts, execution-plan-compiler.ts                                        |
| Phase 5  | Orchestration 主流程接入，保留旧流程 fallback                                        | P0/P1 | orchestration.service.ts                                                                          |
| Phase 6  | TaskEnvelopeBuilder + TaskEnvelopeRenderer                                | P1    | task-envelope-builder.ts, task-envelope-renderer.ts                                               |
| Phase 7  | AgentRuntime 支持 taskEnvelope，废弃 handoffNote 新逻辑                           | P1    | agent-runtime.ts                                                                                  |
| Phase 8  | ToolResult 增强 + tool\_start/tool\_end 轻量化 + run.status 修正                 | P1    | tool-types.ts, agent-runtime.ts, filesystem-tools.ts                                              |
| Phase 9  | pending\_write artifact                                                   | P1/P2 | filesystem-tools.ts, artifact-coordinator.ts                                                      |
| Phase 10 | WorkContextProjectionService + ResponseComposer 优化                        | P2    | work-context-projection.service.ts                                                                |

***

## 验收标准

1. **多 WorkContext 指代：** Session 里有 wc\_file\_test 和 wc\_arch。当前 UI 选中 wc\_arch。wc\_file\_test 最近有 fs\_write failed。用户输入"失败了"。期望 LLM Decision 选择 wc\_file\_test，primaryRefs 包含 failed step，不应该盲目使用当前 UI 选中的 wc\_arch。
2. **模糊多候选：** wc\_file\_test 有工具失败，wc\_arch 有架构方案被用户否定。用户输入"刚才那个失败了"。如果两个候选证据都强，MainDecision.decisionType = ask\_user，问题应该带候选。
3. **子 Agent 输入：** subagent run 新流程必须有 delegateEnvelopeJson。不再依赖 handoffNote。TaskEnvelope 中包含 objective、selectedContext、allowedTools、expectedResult。
4. **工具权限：** 子 Agent 暴露给 LLM 的 tools = AgentVersion/Plugin tools ∩ TaskEnvelope.allowedTools。
5. **工具写入失败：** fs\_write 写 README.md 失败。ToolResult 包含 operation、sideEffects、verification、error。agent\_run\_steps.tool\_end.metadataJson 包含 sideEffects/verification。run.status = failed 或 partial\_success。如果 input 有 content，生成 pending\_write artifact。
6. **tool\_start 存储：** tool\_start 不存大 content。tool\_start 只存 summary/inputRefs。tool\_end 存结果和 metadata。
7. **失败后恢复：** 上一步内容生成成功，但写入失败。用户输入"重新写"。期望 MainDecision primaryRefs 包含 pending\_write artifact 和 failed step。TaskEnvelope 给 filesystem\_agent。子 Agent 使用 pending\_write artifact 内容重试写入，而不是重新生成内容。

***

## 风险与注意事项

1. **向后兼容：** 所有类型扩展必须向后兼容，不要破坏现有工具的运行
2. **数据库字段：** handoffNote 字段先保留但新流程不再写入，不需要立刻删除数据库字段
3. **旧流程保留：** 新流程优先，保留旧流程 fallback，新流程失败时可回退旧流程
4. **LLM 稳定性：** MainDecision 使用低温度（0\~0.1）+ JSON Schema + zod 校验 + 一次 repair + 失败降级为 ask\_user
5. **大内容不塞进 JSON：** 给主 Agent LLM 的 JSON 只放 title/summary/status/tags/evidence，大内容通过 ref 引用
6. **不要做的事情：**
   - 不要继续增强 handoffNote
   - 不要让 LLM 额外生成 handoffNote
   - 不要用正则判断"失败了/继续/刚才那个"
   - 不要让代码判断用户业务语义
   - 不要把整个 Session 历史塞给子 Agent
   - 不要让子 Agent 自己猜上下文
   - 不要把大段 content 同时存在 tool\_start 和 tool\_end
   - 不要让工具失败后 run 仍然固定 success
   - 不要让 TaskEnvelope.allowedTools 只是软提示，必须和工具 manifest 取交集
   - 不要强制子 Agent LLM 输出完整 AgentResult JSON

