# agent-platform-node 剩余修复清单

本文档整理当前仓库在新结构化编排闭环中仍需修改的点。目标是让新流程从：

```txt
User Message
↓
SessionRuntimeSnapshotBuilder
↓
SessionContextIndexBuilder
↓
MainAgent.decideWithSessionIndex()
↓
DecisionContractValidator
↓
ExecutionPlanCompiler
↓
TaskEnvelopeBuilder
↓
AgentRuntime.run()
↓
WorkContextProjection / ResponseComposer
```

形成更稳定、可验证、可恢复的最小闭环。

---

## P0：必须立刻修，否则闭环结果不可信

### 1. 修 `AgentRuntime.run()` 返回状态永远是 `success`

文件：

```txt
agent-platform-node/src/runtime/agent-runtime.ts
```

当前逻辑已经计算了：

```ts
const finalStatus = result.hasFailedTool
  ? "failed"
  : result.hasUnverifiedSideEffect
    ? "partial_success"
    : "success";
```

也已经把 `finalStatus` 写入数据库：

```ts
await db
  .update(agentRuns)
  .set({
    status: finalStatus,
    resultSummary: result.summary,
    outputJson: jsonStringify(result),
    finishedAt,
    updatedAt: finishedAt,
  })
  .where(eq(agentRuns.id, run.id));
```

但返回给上层时仍然写死：

```ts
return {
  runUid: run.runUid,
  status: "success",
  summary: result.summary,
  stepsCount: result.stepsCount,
};
```

必须改成：

```ts
return {
  runUid: run.runUid,
  status: finalStatus,
  summary: result.summary,
  stepsCount: result.stepsCount,
};
```

否则 `executePlanAsync()` 收集到的 `run.status` 永远可能是 `success`，主 run 会误判失败任务为成功。

---

### 2. 修 SSE `emitRunStatus` 使用写死的 `success`

文件：

```txt
agent-platform-node/src/runtime/agent-runtime.ts
```

当前：

```ts
runEventBus.emitRunStatus(runUid, {
  runId: runUid,
  status: "success",
  resultSummary: result.summary,
  updatedAt: finishedAt,
});
```

改成：

```ts
runEventBus.emitRunStatus(runUid, {
  runId: runUid,
  status: finalStatus,
  resultSummary: result.summary,
  updatedAt: finishedAt,
});
```

否则前端看到的状态和数据库状态不一致。

---

### 3. 去掉 TaskEnvelope 的双重注入

文件：

```txt
agent-platform-node/src/runtime/agent-runtime.ts
```

当前 TaskEnvelope 同时进入：

```txt
system message
user message
```

相关代码：

```ts
const effectiveUserMessage =
  args.input.mode === "subagent" && args.input.taskEnvelope
    ? renderTaskEnvelopeForAgent(args.input.taskEnvelope)
    : args.input.originalUserMessage || args.input.userMessage;

const taskEnvelopePrompt = args.input.taskEnvelope
  ? renderTaskEnvelopeForAgent(args.input.taskEnvelope)
  : undefined;

const systemMessage = this.renderSystemMessage(
  promptContext,
  artifactDirectiveConfig,
  pluginCatalogInjection,
  taskEnvelopePrompt
);
```

`renderSystemMessage()` 里还有：

```ts
taskEnvelopePrompt ? `\nTask Envelope:\n${taskEnvelopePrompt}` : "",
```

建议修法：**TaskEnvelope 只放在 user message，不放在 system message。**

推荐改法：

```ts
const effectiveUserMessage =
  args.input.mode === "subagent" && args.input.taskEnvelope
    ? renderTaskEnvelopeForAgent(args.input.taskEnvelope)
    : args.input.originalUserMessage || args.input.userMessage;

const systemMessage = this.renderSystemMessage(
  promptContext,
  artifactDirectiveConfig,
  pluginCatalogInjection
);

const messages: ChatMessage[] = [
  { role: "system", content: systemMessage },
  { role: "user", content: effectiveUserMessage },
];
```

然后删除 `renderSystemMessage()` 的 `taskEnvelopePrompt` 参数和对应拼接段：

```ts
private renderSystemMessage(
  context: ReturnType<typeof buildPromptContext>,
  artifactDirectiveConfig: ArtifactDirectiveConfig,
  pluginCatalogInjection?: string,
): string {
  const sections = [
    context.systemPrompt,
    context.skillText ? `\nSkill:\n${context.skillText}` : "",
    context.handoffNote ? `\nHandoff note:\n${context.handoffNote}` : "",
  ];

  ...
}
```

---

### 4. 统一 `TaskEnvelope` 类型来源

涉及文件：

```txt
agent-platform-node/src/runtime/agent-runtime.ts
agent-platform-node/src/modules/orchestration/task-envelope-builder.ts
agent-platform-node/src/modules/orchestration/task-envelope-renderer.ts
```

当前 `AgentRuntime` 里使用：

```ts
import type { TaskEnvelope } from "./task-envelope.js";
```

而 TaskEnvelopeBuilder / Renderer 在 `modules/orchestration` 下。建议统一为一个类型来源，避免 runtime 和 orchestration 各自维护一份结构。

推荐新增或确认文件：

```txt
agent-platform-node/src/modules/orchestration/task-envelope.types.ts
```

内容示例：

```ts
export type TaskEnvelope = {
  envelopeUid: string;
  parentRunUid: string;
  workContextUid?: string;
  targetAgentUid: string;
  objective: string;
  originalUserMessage: string;
  selectedContext: {
    refs: Array<{
      refId: string;
      kind: string;
      title: string;
      summary?: string;
      status?: string;
    }>;
    ledgerSlices?: unknown[];
    artifacts?: unknown[];
    files?: unknown[];
  };
  constraints: string[];
  allowedTools: string[];
  expectedResult: {
    kind: "answer" | "artifact" | "file_change" | "diagnosis" | "verification";
    requireVerification: boolean;
  };
};
```

然后统一导入：

```ts
// 在 runtime/agent-runtime.ts
import type { TaskEnvelope } from "../modules/orchestration/task-envelope.types.js";

// 在 orchestration 内部
import type { TaskEnvelope } from "./task-envelope.types.js";
```

---

## P1：影响多轮质量，建议马上修

### 5. 扩展 `WorkContextDecisionCard`，让 projection 信息真正进入 LLM

文件：

```txt
agent-platform-node/src/modules/orchestration/orchestration.types.ts
agent-platform-node/src/modules/orchestration/main-agent.ts
```

当前 `WorkContextDecisionCard` 太少：

```ts
export type WorkContextDecisionCard = {
  workContextUid: string;
  title: string;
  summary?: string;
  signals: {
    selectedInUI: boolean;
    recentlyActive: boolean;
    hasFailedRun: boolean;
    hasRecentArtifact: boolean;
  };
};
```

建议改成：

```ts
export type WorkContextDecisionCard = {
  workContextUid: string;
  title: string;
  summary?: string;

  currentStage?: string;
  progressSummary?: string;
  currentFocus?: {
    refId: string;
    kind: string;
    title: string;
  } | null;
  recentRefs?: string[];
  openIssues?: Array<{
    refId?: string;
    summary: string;
    severity?: "low" | "medium" | "high";
    status: "open" | "resolved";
  }>;

  signals: {
    selectedInUI: boolean;
    recentlyActive: boolean;
    hasFailedRun: boolean;
    hasOpenIssue: boolean;
    hasRecentArtifact: boolean;
    hasUnverifiedSideEffect?: boolean;
  };
};
```

然后 `main-agent.ts` 的 `buildMainDecisionInput()` 改成：

```ts
workContexts: input.snapshot.workContexts.map((wc) => ({
  workContextUid: wc.workContextUid,
  title: wc.title,
  summary: wc.summary || wc.goal || "",
  currentStage: wc.currentStage,
  progressSummary: wc.progressSummary,
  currentFocus: wc.currentFocus ?? null,
  recentRefs: wc.recentRefs ?? wc.topRefs?.map((r) => r.refId) ?? [],
  openIssues: wc.openIssues ?? [],
  signals: {
    selectedInUI: wc.signals.selectedInUI,
    recentlyActive: wc.signals.recentlyActive,
    hasFailedRun: wc.signals.hasFailedRun,
    hasOpenIssue: wc.signals.hasOpenIssue,
    hasRecentArtifact: wc.signals.hasRecentArtifact,
    hasUnverifiedSideEffect: wc.signals.hasUnverifiedSideEffect,
  },
})),
```

---

### 6. 扩展 `WorkContextCard`

文件：

```txt
agent-platform-node/src/modules/orchestration/orchestration.types.ts
agent-platform-node/src/modules/orchestration/session-runtime-snapshot-builder.ts
```

当前 `WorkContextCard` 有：

```ts
progressSummary?: string;
currentStage?: string;
nextAction?: string;
topRefs?: ContextRef[];
```

建议补：

```ts
currentFocus?: {
  refId: string;
  kind: string;
  title: string;
} | null;

recentRefs?: string[];

openIssues?: Array<{
  refId?: string;
  summary: string;
  severity?: "low" | "medium" | "high";
  status: "open" | "resolved";
}>;
```

然后在 `SessionRuntimeSnapshotBuilder.getWorkContexts()` 里从 projection 取：

```ts
const projection = metadata.projection as Record<string, unknown> | undefined;
const currentFocus = projection?.currentFocus as WorkContextCard["currentFocus"];
const recentRefs = Array.isArray(projection?.recentRefs)
  ? (projection.recentRefs as string[])
  : [];
const openIssues = Array.isArray(projection?.openIssues)
  ? (projection.openIssues as WorkContextCard["openIssues"])
  : [];
```

返回 WorkContextCard 时加上：

```ts
currentFocus,
recentRefs,
openIssues,
```

---

### 7. 修 `globalRecentArtifacts.workContextUid` 映射错误

文件：

```txt
agent-platform-node/src/modules/orchestration/session-runtime-snapshot-builder.ts
```

当前：

```ts
workContextUid: String(art.workContextId),
```

这里 `workContextId` 很可能是数据库数字 ID，不是业务 UID。后续 `ContextIndexBuilder` 会生成：

```ts
toRefId: `wc:${art.workContextUid}`
```

如果这里是数字，会得到：

```txt
wc:12
```

但真实 WorkContext ref 是：

```txt
wc:work_context_xxx
```

关系会错。

修法：查询 artifacts 时 join `workContexts`，拿真实 `workContextUid`。

示例：

```ts
const artifacts = await db
  .select({
    artifactUid: agentArtifacts.artifactUid,
    workContextUid: workContexts.workContextUid,
    title: agentArtifacts.title,
    artifactType: agentArtifacts.artifactType,
    artifactRole: agentArtifacts.artifactRole,
    contentText: agentArtifacts.contentText,
    createdAt: agentArtifacts.createdAt,
  })
  .from(agentArtifacts)
  .leftJoin(workContexts, eq(agentArtifacts.workContextId, workContexts.id))
  .where(inArray(agentArtifacts.runId, runIds))
  .orderBy(desc(agentArtifacts.id))
  .limit(20);
```

返回：

```ts
return artifacts.map((art) => ({
  artifactUid: art.artifactUid,
  workContextUid: art.workContextUid ?? undefined,
  title: art.title,
  artifactType: art.artifactType,
  artifactRole: art.artifactRole ?? undefined,
  summary: art.contentText?.slice(0, 200),
  createdAt: art.createdAt,
}));
```

---

### 8. 增强 `appendRunResultRefs()`：追加 artifact refs

文件：

```txt
agent-platform-node/src/modules/orchestration/orchestration.service.ts
```

当前 `appendRunResultRefs()` 只追加 run ref。多步骤任务里，step1 生成的 artifact/file refs 没有进入 step2。

建议第一版在每个 step 执行后查该 run 的 artifacts：

```ts
const producedArtifacts = await db
  .select({
    artifactUid: agentArtifacts.artifactUid,
    title: agentArtifacts.title,
    artifactType: agentArtifacts.artifactType,
    artifactRole: agentArtifacts.artifactRole,
    contentText: agentArtifacts.contentText,
  })
  .from(agentArtifacts)
  .where(eq(agentArtifacts.runId, run.id));
```

然后 `appendRunResultRefs()` 支持：

```ts
artifacts?: Array<{
  artifactUid: string;
  title: string;
  artifactType: string;
  artifactRole?: string | null;
  summary?: string;
}>;
```

追加 artifact ref：

```ts
{
  refId: `artifact:${artifact.artifactUid}`,
  kind: "artifact",
  title: artifact.title,
  summary: artifact.summary || artifact.artifactType,
  workContextUid: input.workContextUid,
  status: artifact.artifactRole === "pending_write" ? "pending_write" : "ready",
  source: {
    table: "agent_artifacts",
    uid: artifact.artifactUid,
  },
  tags: ["artifact", artifact.artifactType, artifact.artifactRole || ""].filter(Boolean),
}
```

再加 relation：

```ts
{
  fromRefId: `artifact:${artifact.artifactUid}`,
  toRefId: `run:${input.runUid}`,
  relation: "produced",
}
```

这样 step2 可以使用 step1 的产物。

---

## P2：架构完整性修复

### 9. 清理 Validator 重复校验

文件：

```txt
agent-platform-node/src/modules/orchestration/decision-contract-validator.ts
```

现在 `targetWorkContextUid` 不存在校验出现两次：

```ts
if (decision.targetWorkContextUid) {
  if (!validWorkContextUids.has(decision.targetWorkContextUid)) {
    issues.push(`targetWorkContextUid ${decision.targetWorkContextUid} 不存在`);
  }
}
```

后面又有：

```ts
if (decision.targetWorkContextUid && !validWorkContextUids.has(decision.targetWorkContextUid)) {
  issues.push(`targetWorkContextUid ${decision.targetWorkContextUid} 不存在，LLM 可能编造了 WorkContextUid`);
}
```

保留第二个即可，删除第一个，避免 fallback question 里重复报错。

---

### 10. 新建最小 `WorkContextProjectionService`

新增文件：

```txt
agent-platform-node/src/modules/work-contexts/work-context-projection.service.ts
```

第一版只做增量更新 `metadataJson.projection`。

类型：

```ts
export type WorkContextProjection = {
  currentStage:
    | "created"
    | "planning"
    | "executing"
    | "waiting_user"
    | "recovering"
    | "completed"
    | "blocked";

  progressSummary: string;

  currentFocus?: {
    refId: string;
    kind: "file" | "artifact" | "run" | "step" | "repo" | "patch" | "log";
    title: string;
  } | null;

  recentRefs: string[];

  openIssues: Array<{
    refId?: string;
    summary: string;
    severity: "low" | "medium" | "high";
    status: "open" | "resolved";
  }>;

  lastRunUid?: string;
  lastSuccessfulRunUid?: string | null;
  lastFailedRunUid?: string | null;
};
```

方法：

```ts
export async function updateWorkContextProjection(input: {
  workContextUid: string;
  runUid: string;
  status: string;
  summary: string;
  producedArtifactRefs?: Array<{
    refId: string;
    title: string;
  }>;
  touchedRefs?: string[];
  openIssues?: Array<{
    refId?: string;
    summary: string;
    severity?: "low" | "medium" | "high";
  }>;
}) {
  // 1. 查 work_contexts
  // 2. 解析 metadataJson.projection
  // 3. merge recentRefs
  // 4. 根据 status 设置 currentStage
  // 5. 写回 metadataJson.projection
}
```

状态映射：

```ts
function mapRunStatusToStage(status: string) {
  if (status === "failed") return "blocked";
  if (status === "partial_success") return "waiting_user";
  return "completed";
}
```

增量合并规则：

```txt
newRecentRefs = producedArtifactRefs + touchedRefs + previous.recentRefs
去重
最多保留 20 个
```

---

### 11. 在 `executePlanAsync()` 完成后更新 projection

文件：

```txt
agent-platform-node/src/modules/orchestration/orchestration.service.ts
```

在所有 step 完成后、`updateMainAgentRun()` 前或后，调用：

```ts
await updateWorkContextProjection({
  workContextUid: finalWorkContextId,
  runUid: stepResults[stepResults.length - 1]?.runUid ?? mainRunId,
  status: stepResults.some((r) => r.status === "failed")
    ? "failed"
    : stepResults.some((r) => r.status === "partial_success")
      ? "partial_success"
      : "success",
  summary: finalMessage,
  producedArtifactRefs,
  touchedRefs,
  openIssues,
});
```

第一版没有完整 artifacts/touchedRefs 也没关系，至少写：

```ts
workContextUid
runUid
status
summary
```

这样下一轮 SnapshotBuilder 能读到 projection。

---

### 12. `createWorkContext()` 初始 metadata 写 projection

文件：

```txt
agent-platform-node/src/modules/orchestration/orchestration.service.ts
```

当前创建：

```ts
metadataJson: jsonStringify({
  createdBy: "main_agent",
  createdAt: now,
})
```

建议改成：

```ts
metadataJson: jsonStringify({
  createdBy: "main_agent",
  createdAt: now,
  projection: {
    currentStage: "created",
    progressSummary: goal,
    currentFocus: null,
    recentRefs: [],
    openIssues: [],
    lastRunUid: null,
    lastSuccessfulRunUid: null,
    lastFailedRunUid: null,
  },
})
```

---

## P3：Prompt 与决策稳定性

### 13. `main-agent.ts` prompt 补强 createWorkContext 规则

文件：

```txt
agent-platform-node/src/modules/orchestration/main-agent.ts
```

在 `buildMainDecisionSystemPrompt()` 里明确加：

```txt
你不能生成新的 workContextUid。
targetWorkContextUid 只能来自输入 workContexts[].workContextUid。
如果这是新任务，或者输入 workContexts 中没有合适对象：
- targetWorkContextUid 必须为 null
- createWorkContext 必须填写 title 和 goal
- decisionType 可以是 create_work_context、delegate 或 multi_step_plan
- 真实 workContextUid 由系统代码创建，不由你生成
任何形如 wc_xxx、work_context_xxx 的新 ID 都禁止由你生成。
如果需要执行任务但 targetWorkContextUid 为 null，必须填写 createWorkContext。
```

同时输出格式示例里加入：

```json
"createWorkContext": null
```

或：

```json
"createWorkContext": {
  "title": "查看项目登录逻辑",
  "goal": "搜索并解释项目登录入口、认证流程、token 生成和鉴权中间件"
}
```

---

### 14. `repairMainDecision()` fallback 补 `createWorkContext`

文件：

```txt
agent-platform-node/src/modules/orchestration/main-agent.ts
```

确认 repair 失败 fallback 里有：

```ts
createWorkContext: null,
```

如果没有必须加，否则和 schema/type 不一致。

---

## P4：可选但建议

### 15. WorkContext UID 前缀统一

文件：

```txt
agent-platform-node/src/modules/orchestration/orchestration.service.ts
```

当前：

```ts
workContextUid: makeUid("work_context")
```

这不是错误，可以继续用。

如果希望更短，可以统一为：

```ts
workContextUid: makeUid("wc")
```

注意：如果已有数据使用 `work_context_xxx`，不要强制迁移。系统应兼容两种 uid。

---

### 16. 开发测试时默认关闭 legacy fallback

环境变量：

```bash
ENABLE_LEGACY_FALLBACK=false
```

上线灰度可临时设：

```bash
ENABLE_LEGACY_FALLBACK=true
```

目标是测试新闭环时不要被旧流程掩盖。

---

## 最终修复顺序

按下面顺序修：

```txt
1. AgentRuntime 返回 finalStatus，而不是 success
2. SSE emitRunStatus 使用 finalStatus
3. TaskEnvelope 只注入 user message，不要 system/user 双重注入
4. 统一 TaskEnvelope 类型来源
5. 修 globalRecentArtifacts.workContextUid 映射
6. 扩展 WorkContextCard / WorkContextDecisionCard，传 projection 信息
7. appendRunResultRefs 增加 artifact refs
8. 清理 Validator 重复校验
9. 新增 WorkContextProjectionService
10. executePlanAsync 完成后更新 projection
11. createWorkContext 初始 metadata 写 projection
12. main-agent prompt 补强 createWorkContext 规则
```

当前最致命的是 **1 和 2**。只要不修，工具失败时上层仍可能认为子 Agent 成功，主 Agent 多轮恢复会继续错判。

---

## 最小验收用例

### 用例 1：工具失败状态透传

模拟子 Agent 工具失败。

期望：

```txt
agent_runs.status = failed
AgentRuntime.run() 返回 status = failed
SSE runStatus.status = failed
main run 最终 status = failed
```

---

### 用例 2：新会话新任务创建 WorkContext

用户：

```txt
查看项目的登录逻辑
```

期望：

```txt
MainDecision.targetWorkContextUid = null
MainDecision.createWorkContext 有 title/goal
OrchestrationService 创建真实 WorkContext
ExecutionPlan.workContextUid 是真实 uid
SubAgent TaskEnvelope.workContextUid 是真实 uid
```

---

### 用例 3：多步骤结果汇总

用户：

```txt
查看项目登录逻辑并解释 token 生成
```

期望：

```txt
step1 搜索 Agent 执行
step2 阅读 Agent 执行
主 run resultSummary 不是“任务执行完成”
而是包含子 Agent summary
```

---

### 用例 4：下一轮使用 projection

第一轮完成登录逻辑分析后，用户下一轮说：

```txt
token 是怎么生成的？
```

期望：

```txt
SnapshotBuilder 读取 work_contexts.metadataJson.projection
WorkContextCard 包含 progressSummary/currentFocus/recentRefs/openIssues
MainDecisionInput.workContexts 包含这些字段
LLM 能选择已有 WorkContext，而不是新建
```
