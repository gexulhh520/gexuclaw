# agent-platform-node 下一阶段修复与测试清单

## 目标

当前代码已经进入“可测试的最小闭环”：

```txt
User Message
  ↓
SessionRuntimeSnapshotBuilder
  ↓
SessionContextIndexBuilder
  ↓
MainAgent.decideWithSessionIndex()
  ↓
MainDecision JSON
  ↓
DecisionContractValidator
  ↓
OrchestrationService
  - 创建真实 WorkContext
  - 注入 effectiveWorkContextUid
  ↓
ExecutionPlanCompiler
  ↓
TaskEnvelopeBuilder
  ↓
AgentRuntime.run()
  ↓
ToolRuntime
  ↓
agent_runs / agent_run_steps / agent_artifacts
  ↓
stepResults
  ↓
updateWorkContextProjection()
  ↓
updateMainAgentRun()
  ↓
下一轮 Snapshot 读取 projection
```

本轮修复目标不是重构整套架构，而是补齐以下关键稳定性：

```txt
1. 多步骤之间真正传递 artifact refs
2. projection.currentFocus 自动更新
3. repairMainDecision 使用完整 JSON contract
4. 为下一阶段 AgentResult Builder 预留接口
5. 跑通四个端到端测试用例
```

---

# 一、当前已基本对齐的部分

当前已完成：

```txt
1. MainDecision 已支持 createWorkContext
2. Validator 已校验 targetWorkContextUid / refId / agentUid
3. OrchestrationService 已能创建真实 WorkContext
4. TaskEnvelope 已作为子 Agent 的 user message
5. AgentRuntime 已使用 finalStatus
6. SnapshotBuilder 已读取 projection
7. WorkContextDecisionCard 已包含 projection 信息
8. WorkContextProjectionService 已有最小实现
```

这些先不要推翻，继续在现有结构上补齐。

---

# 二、必须继续补齐的 3 个核心点

## 1. 多步骤之间把 artifact refs 真正传下去

### 当前问题

`appendRunResultRefs()` 已经支持 `artifacts` 参数，但是 `executePlanAsync()` 调用时还没有真正查询子 run 产生的 artifacts。

当前调用类似：

```ts
runningContextIndex = appendRunResultRefs(runningContextIndex, {
  runUid: run.runUid,
  agentUid: step.targetAgentUid,
  summary: run.summary,
  status: run.status,
  workContextUid: plan.workContextUid,
});
```

这意味着后续 step 只能看到：

```txt
run:xxx
```

但看不到：

```txt
artifact:xxx
file:xxx
```

### 为什么要修

典型多步骤任务：

```txt
step1: code_search_agent 搜索登录逻辑，产出 artifact:login_search_result
step2: code_reader_agent 阅读搜索结果并解释登录链路
```

如果 step1 的 artifact 没传给 step2，第二个 Agent 只能看到 run summary，不能稳定使用结构化产物。

### 建议修法

#### 方案 A：让 AgentRuntime.run() 返回 run.id

修改 `AgentRuntime.run()` 的返回值：

```ts
return {
  runId: run.id,
  runUid: run.runUid,
  status: finalStatus,
  summary: result.summary,
  stepsCount: result.stepsCount,
};
```

然后 `executePlanAsync()` 可以直接根据 `run.runId` 查询 artifacts。

#### 方案 B：用 runUid 反查 id

如果暂时不想改 runtime 返回值，可以在 `executePlanAsync()` 里反查：

```ts
const [runRecord] = await db
  .select({ id: agentRuns.id })
  .from(agentRuns)
  .where(eq(agentRuns.runUid, run.runUid))
  .limit(1);
```

推荐方案 A，更干净。

### 查询 artifacts

在每个 step 执行完成后查询：

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
  .where(eq(agentArtifacts.runId, run.runId));
```

如果使用方案 B，则：

```ts
.where(eq(agentArtifacts.runId, runRecord.id));
```

### appendRunResultRefs 调用改成

```ts
runningContextIndex = appendRunResultRefs(runningContextIndex, {
  runUid: run.runUid,
  agentUid: step.targetAgentUid,
  summary: run.summary,
  status: run.status,
  workContextUid: plan.workContextUid,
  artifacts: producedArtifacts.map((artifact) => ({
    artifactUid: artifact.artifactUid,
    title: artifact.title,
    artifactType: artifact.artifactType,
    artifactRole: artifact.artifactRole,
    summary: artifact.contentText?.slice(0, 300),
  })),
});
```

同时把这些 artifact refs 也收集到 `allProducedArtifacts`，用于后面更新 projection。

---

## 2. projection.currentFocus 自动更新

### 当前问题

`updateWorkContextProjection()` 目前会更新：

```txt
currentStage
progressSummary
recentRefs
openIssues
lastRunUid
lastSuccessfulRunUid
lastFailedRunUid
```

但是没有根据本轮产物更新：

```txt
currentFocus
```

如果本轮产生了最终 artifact，下一轮 Snapshot 仍然可能不知道当前焦点是什么。

### 为什么要修

用户下一轮可能说：

```txt
继续说这个
刚才那个不对
把这个写进去
失败了
换个路径写
```

如果 `currentFocus` 没更新，主 Agent 就要猜“这个”指的是哪个 run/artifact/file。

### 修改 `updateWorkContextProjection()`

在 `updateWorkContextProjection()` 中增加：

```ts
const nextCurrentFocus =
  input.producedArtifactRefs?.[0]
    ? {
        refId: input.producedArtifactRefs[0].refId,
        kind: "artifact" as const,
        title: input.producedArtifactRefs[0].title,
      }
    : existingProjection.currentFocus ?? null;
```

然后写入：

```ts
const updatedProjection: WorkContextProjection = {
  ...existingProjection,
  currentStage: mapRunStatusToStage(input.status),
  progressSummary: input.summary,
  currentFocus: nextCurrentFocus,
  recentRefs: mergedRecentRefs,
  openIssues: mergedOpenIssues,
  lastRunUid: input.runUid,
  lastSuccessfulRunUid:
    input.status === "success" ? input.runUid : existingProjection.lastSuccessfulRunUid,
  lastFailedRunUid:
    input.status === "failed" ? input.runUid : existingProjection.lastFailedRunUid,
};
```

### executePlanAsync 也要传 producedArtifactRefs

执行完成后：

```ts
await updateWorkContextProjection({
  workContextUid: finalWorkContextId,
  runUid: stepResults[stepResults.length - 1]?.runUid ?? mainRunId,
  status: finalStatus,
  summary: finalMessage,
  producedArtifactRefs,
});
```

其中：

```ts
const producedArtifactRefs = allProducedArtifacts.map((artifact) => ({
  refId: `artifact:${artifact.artifactUid}`,
  title: artifact.title,
}));
```

---

## 3. 更完整 AgentResult Builder，下一阶段实现

### 当前问题

现在 `AgentRuntime.run()` 返回的是简化结果：

```ts
{
  runUid,
  status,
  summary,
  stepsCount
}
```

对最小闭环够用，但对稳定恢复、多轮追踪、失败分析还不够。

缺少：

```txt
operations
producedArtifacts
touchedResources
openIssues
retryAdvice
```

### 目标结构

新增标准 AgentResult：

```ts
export type AgentResult = {
  status: "success" | "partial_success" | "failed";
  summary: string;

  operations: Array<{
    toolName?: string;
    operationType?: "read" | "write" | "search" | "execute" | "verify" | "unknown";
    target?: string;
    status: "success" | "failed" | "unverified";
    errorMessage?: string;
    verification?: {
      required: boolean;
      status: "verified" | "failed" | "unverified" | "not_applicable";
    };
  }>;

  producedArtifacts: Array<{
    artifactUid: string;
    title: string;
    role?: string;
  }>;

  touchedResources: Array<{
    type: "file" | "artifact" | "url" | "database" | "unknown";
    uri: string;
    operation: string;
    verified?: boolean;
  }>;

  openIssues: Array<{
    refId?: string;
    type?: string;
    message: string;
    severity: "low" | "medium" | "high";
  }>;

  retryAdvice: {
    retryable: boolean;
    reason?: string;
  };
};
```

### 新增文件

```txt
src/runtime/agent-result-builder.ts
```

### 第一版实现逻辑

从 `tool_end` steps 生成 operations：

```ts
const toolEndSteps = steps.filter((s) => s.stepType === "tool_end");

const operations = toolEndSteps.map((step) => {
  const output = jsonParse<any>(step.outputJson, {});
  const metadata = jsonParse<any>(step.metadataJson, {});

  return {
    toolName: step.toolName,
    operationType: metadata.operation?.type ?? "unknown",
    target: metadata.operation?.target ?? output.operation?.target,
    status: step.toolStatus === "failed" ? "failed" : "success",
    errorMessage: output.error?.message ?? output.error,
    verification: metadata.verification ?? output.verification,
  };
});
```

从 artifacts 表生成 `producedArtifacts`。

从 operation / sideEffects / outputRefs 生成 `touchedResources`。

从 failed operation 生成 `openIssues`：

```ts
const openIssues = operations
  .filter((op) => op.status === "failed")
  .map((op) => ({
    message: `${op.toolName || "tool"} 执行失败：${op.errorMessage || "未知错误"}`,
    severity: "high" as const,
  }));
```

### AgentRuntime 最终 outputJson 应存 AgentResult

后续将：

```ts
outputJson: jsonStringify(result)
```

升级成：

```ts
const agentResult = await buildAgentResult({
  runId: run.id,
  runUid: run.runUid,
  summary: result.summary,
  status: finalStatus,
});

await db.update(agentRuns).set({
  status: agentResult.status,
  resultSummary: agentResult.summary,
  outputJson: jsonStringify(agentResult),
});
```

### executePlanAsync 使用 AgentResult

```ts
stepResults.push({
  stepUid: step.stepUid,
  agentUid: step.targetAgentUid,
  runUid: run.runUid,
  status: run.status,
  summary: run.agentResult?.summary || run.summary || "",
});
```

后续 `updateWorkContextProjection()` 也可以从 `agentResult` 拿：

```txt
producedArtifacts
touchedResources
openIssues
```

---

# 三、MainDecision Prompt 与 repair 稳定性

## 1. 当前 buildMainDecisionSystemPrompt 已经不错

当前 prompt 已经具备：

```txt
1. 明确主 Agent 是结构化决策器，不是执行器
2. 必须输出 MainDecision JSON
3. 不允许输出 Markdown / 代码块 / 解释性文字
4. 不允许编造 workContextUid / refId / agentUid
5. targetWorkContextUid 只能来自输入
6. 新任务必须 targetWorkContextUid=null + createWorkContext
7. refs 和 agents 必须来自候选集合
8. 失败恢复、内容不满意、歧义场景有规则
```

这版可以继续用，不要推翻。

---

## 2. 需要优化：JSON contract 应该抽出来复用

建议新增：

```ts
private getMainDecisionJsonContract(): string
private getAskUserFallbackExample(): string
```

让：

```txt
buildMainDecisionSystemPrompt()
repairMainDecision()
```

复用同一份结构描述。

这样主决策和 repair 不会出现：主 prompt 有 `createWorkContext`，repair prompt 没有的情况。

---

## 3. getMainDecisionJsonContract 建议内容

```ts
private getMainDecisionJsonContract(): string {
  return `MainDecision JSON 必须包含以下所有顶层字段：

{
  "decisionType": "answer_directly | create_work_context | use_existing_work_context | switch_work_context | delegate | multi_step_plan | ask_user | explain_trace | verify_execution | recover_execution",
  "targetWorkContextUid": "string or null",
  "createWorkContext": {
    "title": "string",
    "goal": "string"
  } 或 null,
  "primaryRefs": ["string"],
  "secondaryRefs": ["string"],
  "targetAgentUid": "string or null",
  "plan": {
    "steps": [
      {
        "targetAgentUid": "string",
        "objective": "string",
        "inputRefIds": ["string"],
        "expectedResultKind": "answer | artifact | file_change | diagnosis | verification",
        "requireVerification": true
      }
    ]
  } 或 null,
  "response": "string or null",
  "ambiguity": {
    "candidateWorkContextUids": ["string"],
    "candidateRefIds": ["string"],
    "question": "string"
  } 或 null,
  "confidence": "high | medium | low",
  "reasoning": "string"
}

硬性规则：
1. 所有顶层字段都必须存在。
2. 缺失数组字段用 []。
3. 缺失对象字段用 null。
4. targetWorkContextUid 如果不为 null，必须来自输入 workContexts。
5. createWorkContext 只有在需要新建 WorkContext 时填写，否则为 null。
6. plan 只有执行型决策填写，否则为 null。
7. response 只有 answer_directly 填写，否则为 null。
8. ambiguity 只有 ask_user 填写，否则为 null。
9. 不要创造额外字段。`;
}
```

---

## 4. getAskUserFallbackExample 建议内容

```ts
private getAskUserFallbackExample(): string {
  return `{
  "decisionType": "ask_user",
  "targetWorkContextUid": null,
  "createWorkContext": null,
  "primaryRefs": [],
  "secondaryRefs": [],
  "targetAgentUid": null,
  "plan": null,
  "response": null,
  "ambiguity": {
    "candidateWorkContextUids": [],
    "candidateRefIds": [],
    "question": "请确认你要继续处理哪一项。"
  },
  "confidence": "low",
  "reasoning": "需要用户澄清。"
}`;
}
```

---

## 5. repairMainDecision 应该改成更稳定

当前 `repairMainDecision()` 的问题：

```txt
它只说“必须符合 MainDecision schema”
但没有把完整 JSON contract 给 LLM
```

建议改成：

```ts
private async repairMainDecision(
  badOutput: string,
  zodError: import("zod").ZodError
): Promise<MainDecision> {
  const contract = this.getMainDecisionJsonContract();
  const fallbackExample = this.getAskUserFallbackExample();

  const repairPrompt = `你是 MainDecision JSON 修复器。

你的任务：
只修复 JSON 格式和字段结构，不要重新做业务决策。
不要输出 Markdown。
不要输出代码块。
不要输出解释。
只能输出一个 JSON object。

必须满足以下 MainDecision JSON 合约：

${contract}

如果无法确定原始意图，请输出这个 ask_user fallback 结构：

${fallbackExample}

Zod 校验错误：
${zodError.message}

原始输出：
${badOutput}`;

  try {
    const repairResult = await this.modelClient.complete({
      systemPrompt: repairPrompt,
      userMessage: "请返回修复后的 MainDecision JSON。只输出 JSON object。",
      temperature: 0,
    });

    const json = this.extractJsonObject(repairResult.content);
    const repaired = mainDecisionSchema.safeParse(json);

    if (repaired.success) {
      console.log("[MainAgent] Repair 成功");
      return repaired.data;
    }

    console.warn("[MainAgent] Repair 后仍不合法:", repaired.error.message);
  } catch (error) {
    console.warn("[MainAgent] Repair 调用失败:", error);
  }

  return {
    decisionType: "ask_user",
    targetWorkContextUid: null,
    createWorkContext: null,
    primaryRefs: [],
    secondaryRefs: [],
    targetAgentUid: null,
    plan: null,
    response: null,
    ambiguity: {
      candidateWorkContextUids: [],
      candidateRefIds: [],
      question: "我需要确认一下你要继续处理哪一项。",
    },
    confidence: "low",
    reasoning: "MainDecision JSON parse failed after repair.",
  };
}
```

---

# 四、端到端测试用例

## 测试前置条件

建议测试时关闭旧 fallback：

```bash
ENABLE_LEGACY_FALLBACK=false
```

这样新流程失败不会被旧流程掩盖。

---

## 用例 1：新会话：“查看项目的登录逻辑”

### 用户输入

```txt
查看项目的登录逻辑
```

### 期望链路

```txt
1. SnapshotBuilder 发现当前 session 下没有合适 WorkContext
2. ContextIndexBuilder 至少提供 repo/workspace ref
3. MainDecision 输出：
   - decisionType = multi_step_plan 或 delegate
   - targetWorkContextUid = null
   - createWorkContext.title/goal 有值
   - plan.steps 有 code_search/code_reader 或相关 Agent
4. Validator 通过
5. OrchestrationService 创建真实 WorkContext
6. ExecutionPlanCompiler 使用真实 workContextUid
7. TaskEnvelopeBuilder 构造 TaskEnvelope
8. AgentRuntime 子 Agent 执行
9. 主 run 最终 summary 不是“任务执行完成”，而是子 Agent summary
10. WorkContextProjection 更新：
    - currentStage = completed 或 blocked
    - progressSummary = 本轮摘要
    - lastRunUid 有值
```

### 验收点

```txt
agent_runs:
- main run status = success / failed / partial_success
- sub run status 与工具执行状态一致

work_contexts:
- 新增一条 WorkContext
- metadataJson.projection 存在
```

---

## 用例 2：下一轮：“token 是怎么生成的”

### 用户输入

```txt
token 是怎么生成的？
```

### 前置条件

上一轮已经执行过“查看项目登录逻辑”。

### 期望链路

```txt
1. SnapshotBuilder 读取上一轮 WorkContext projection
2. WorkContextCard 包含：
   - progressSummary
   - currentStage
   - recentRefs
   - currentFocus 如果已有
3. ContextIndexBuilder 生成：
   - wc:xxx
   - artifact:xxx
   - file:auth.service.ts 或相关 ref
4. MainDecision 选择已有 targetWorkContextUid
5. 不创建新 WorkContext
6. primaryRefs 指向 token/auth/login 相关 ref
7. 委派 code_reader_agent 或代码阅读类 Agent
8. 子 Agent 只围绕 token 生成逻辑回答
```

### 验收点

```txt
MainDecision:
- targetWorkContextUid = 上一轮 WorkContext
- createWorkContext = null
- decisionType = delegate 或 multi_step_plan
- primaryRefs 不为空

work_contexts:
- 不应新建第二个无关 WorkContext
```

---

## 用例 3：失败场景：“失败了”

### 用户输入

```txt
失败了
```

### 前置条件

前一轮存在 failed / partial_success run，或者 projection.openIssues / lastFailedRunUid 有值。

### 期望链路

```txt
1. SnapshotBuilder 读取 projection.lastFailedRunUid / openIssues
2. ContextIndexBuilder 生成 failed run / failed step / issue refs
3. MainDecision 输出：
   - decisionType = recover_execution 或 ask_user
   - 如果证据明确，应该 recover_execution
   - targetWorkContextUid 指向失败任务
   - primaryRefs 包含 failed step/run/artifact/file
4. Validator 校验 refs 存在
5. TaskEnvelope 指向失败对象，而不是重新开始新任务
```

### 验收点

```txt
如果只有一个明显失败对象：
- 不应该反问
- 应该 recover_execution

如果多个失败对象：
- 可以 ask_user
- ambiguity.candidateWorkContextUids / candidateRefIds 应该包含候选
```

---

## 用例 4：工具失败时确认子 run.status 和主 run.status 是否都变 failed

### 测试方式

让某个子 Agent 调用必然失败的工具，例如：

```txt
写入一个没有权限的路径
```

或让文件工具返回：

```json
{
  "success": false,
  "error": "Permission denied"
}
```

### 期望链路

```txt
1. ToolRuntime 返回 success=false
2. agent_run_steps 记录 tool_end:
   - toolStatus = failed
   - outputJson.success = false
3. AgentRuntime.hasFailedTool = true
4. 子 agent_runs.status = failed
5. AgentRuntime.run() 返回 status = failed
6. executePlanAsync.stepResults 记录 failed
7. finalStatus = failed
8. main agent_runs.status = failed
9. updateWorkContextProjection:
   - currentStage = blocked
   - lastFailedRunUid = 子 runUid 或最后 runUid
```

### 验收点

```txt
子 run:
- status = failed

主 run:
- status = failed

work_contexts.metadataJson.projection:
- currentStage = blocked
- lastFailedRunUid 不为空
```

---

# 五、最终建议优先级

## 立即修

```txt
1. 多步骤之间把 artifact refs 真正传下去
2. projection.currentFocus 自动更新
3. repairMainDecision 复用完整 JSON contract
```

## 下一阶段修

```txt
4. AgentResult Builder
5. 从 AgentResult 自动推导 openIssues / touchedResources
6. 更强的失败恢复策略
```

## 当前状态判断

当前代码已经可以进入端到端测试阶段。

但如果要让多轮能力更稳，尤其是下面这些表达：

```txt
继续
刚才那个
失败了
换个路径写
token 那块详细说
```

就需要优先补：

```txt
artifact refs 传递
currentFocus 更新
repair JSON contract 稳定化
```

这三块补完后，主 Agent / 子 Agent 协作架构会更像一个真正可持续演进的运行时系统，而不是单轮委派系统。
