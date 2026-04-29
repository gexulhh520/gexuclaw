# agent-platform-node 新编排闭环修补任务

## 目标

把当前已经接入的结构化编排骨架，补成可以稳定端到端跑通的最小闭环。

当前已有主链路：

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
updateMainAgentRun()
```

当前主要缺口：

```txt
1. createWorkContext 没进入 MainDecision schema 和新流程。
2. 新流程里 targetWorkContextUid=null 时没有创建真实 WorkContext。
3. MainDecision prompt 没强约束 LLM 不得生成新 workContextUid。
4. executePlanAsync 没收集子 Agent 结果，最后只返回“任务执行完成”。
5. 多步骤之间没有把前一步结果更新进 runningContextIndex。
6. SnapshotBuilder 没使用 projection.currentFocus / recentRefs / openIssues。
7. legacy fallback 会掩盖新流程错误。
```

---

# 一、补 MainDecision.createWorkContext

## 目标

LLM 不能自己生成新的 `workContextUid`。

如果它判断是新任务，只能输出：

```json
{
  "targetWorkContextUid": null,
  "createWorkContext": {
    "title": "查看项目登录逻辑",
    "goal": "搜索并解释当前项目的登录入口、认证流程、token 生成和鉴权中间件"
  }
}
```

真实 `workContextUid` 必须由后端代码创建。

---

## 修改 1：`src/modules/orchestration/orchestration.types.ts`

在 `MainDecision` 里新增字段：

```ts
createWorkContext: {
  title: string;
  goal: string;
} | null;
```

建议最终结构：

```ts
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

  targetWorkContextUid: string | null;

  createWorkContext: {
    title: string;
    goal: string;
  } | null;

  primaryRefs: string[];
  secondaryRefs: string[];

  targetAgentUid: string | null;

  plan: {
    steps: Array<{
      targetAgentUid: string;
      objective: string;
      inputRefIds: string[];
      expectedResultKind: "answer" | "artifact" | "file_change" | "diagnosis" | "verification";
      requireVerification: boolean;
    }>;
  } | null;

  response: string | null;

  ambiguity: {
    candidateWorkContextUids: string[];
    candidateRefIds: string[];
    question: string;
  } | null;

  confidence: "high" | "medium" | "low";
  reasoning: string;
};
```

---

## 修改 2：`src/modules/orchestration/main-decision.schema.ts`

新增 schema：

```ts
const createWorkContextSchema = z.object({
  title: z.string().min(1),
  goal: z.string().min(1),
});
```

在 `mainDecisionSchema` 中加入：

```ts
createWorkContext: createWorkContextSchema.nullable().default(null),
```

repair fallback 也要补：

```ts
createWorkContext: null,
```

---

## 修改 3：`src/modules/orchestration/main-agent.ts`

在 `buildMainDecisionSystemPrompt()` 里补充规则：

```txt
16. 你不能生成新的 workContextUid。
17. targetWorkContextUid 只能来自输入 workContexts[].workContextUid。
18. 如果这是新任务，或者输入 workContexts 中没有合适对象：
    - targetWorkContextUid 必须为 null
    - createWorkContext 必须填写 title 和 goal
    - decisionType 可以是 create_work_context、delegate 或 multi_step_plan
    - 真实 workContextUid 由系统代码创建，不由你生成
19. 任何形如 wc_xxx、work_context_xxx 的新 ID 都禁止由你生成。
20. 如果需要执行任务但 targetWorkContextUid 为 null，必须填写 createWorkContext。
```

并在输出格式说明里加入 `createWorkContext` 字段。

---

# 二、增强 DecisionContractValidator

## 目标

`DecisionContractValidator` 只做合法性校验，不写数据库。

必须校验：

```txt
1. targetWorkContextUid 如果存在，必须来自 snapshot.workContexts。
2. LLM 不允许编造 workContextUid。
3. 需要执行任务但没有 targetWorkContextUid 时，必须有 createWorkContext.title/goal。
4. primaryRefs / secondaryRefs / plan.steps[].inputRefIds 必须来自 contextIndex.refs。
5. targetAgentUid / plan.steps[].targetAgentUid 必须来自 snapshot.availableAgents。
```

---

## 建议逻辑

```ts
const needsExecution = [
  "delegate",
  "multi_step_plan",
  "recover_execution",
  "verify_execution",
  "create_work_context",
].includes(decision.decisionType);

if (decision.targetWorkContextUid && !knownWorkContextUids.has(decision.targetWorkContextUid)) {
  return invalidAskUser("targetWorkContextUid 不存在，LLM 可能编造了 WorkContextUid");
}

if (needsExecution && !decision.targetWorkContextUid) {
  if (!decision.createWorkContext?.title || !decision.createWorkContext?.goal) {
    return invalidAskUser("需要执行任务但没有 targetWorkContextUid，也没有 createWorkContext.title/goal");
  }
}

if (decision.decisionType === "create_work_context") {
  if (decision.targetWorkContextUid !== null) {
    return invalidAskUser("create_work_context 不允许携带 targetWorkContextUid");
  }
}
```

fallbackDecision 也要符合新的 schema：

```ts
{
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
    question: "我需要确认一下你要继续处理哪一项。"
  },
  confidence: "low",
  reasoning: "Decision validation failed."
}
```

---

# 三、OrchestrationService 创建真实 WorkContext

## 目标

Validator 之后、PlanCompiler 之前，如果需要新建 WorkContext，则由代码创建真实 WorkContext。

---

## 修改位置

`src/modules/orchestration/orchestration.service.ts`

当前大概是：

```ts
const validation = decisionValidator.validate(...);

if (!validation.valid) { ... }

const plan = planCompiler.compile({
  decision: validation.normalizedDecision,
  snapshot,
  contextIndex,
});
```

改成：

```ts
const validation = decisionValidator.validate({
  decision: mainDecision,
  snapshot,
  contextIndex,
});

if (!validation.valid) {
  ...
  return;
}

const normalizedDecision = validation.normalizedDecision;

let effectiveWorkContextUid = normalizedDecision.targetWorkContextUid;

if (!effectiveWorkContextUid && normalizedDecision.createWorkContext) {
  const created = await createWorkContext(
    sessionId,
    normalizedDecision.createWorkContext.title,
    normalizedDecision.createWorkContext.goal
  );

  effectiveWorkContextUid = created.workContextUid;
}

const effectiveDecision = {
  ...normalizedDecision,
  targetWorkContextUid: effectiveWorkContextUid,
};

const plan = planCompiler.compile({
  decision: effectiveDecision,
  snapshot,
  contextIndex,
});
```

注意：不要让 `Validator` 创建数据库记录。创建 WorkContext 是业务副作用，应该放在 `OrchestrationService`。

---

# 四、ExecutionPlanCompiler 修正

## 目标

Compiler 必须使用真实 `targetWorkContextUid`。

如果是执行型 plan，但仍然没有 `targetWorkContextUid`，应该抛错，不要继续执行。

```ts
if (
  ["single_agent", "sequential_agents"].includes(mode) &&
  !decision.targetWorkContextUid
) {
  throw new Error("Execution plan requires targetWorkContextUid");
}
```

---

# 五、AgentRuntime 支持 TaskEnvelope

## 目标

新流程中子 Agent 不再依赖 `handoffNote`，而是依赖 `TaskEnvelope`。

必须确认并补齐：

```txt
1. RunAgentInput 增加 taskEnvelope?: TaskEnvelope
2. RunAgentInput 增加 originalUserMessage?: string
3. subagent 新流程下 taskEnvelope 必须存在
4. agent_runs.delegateEnvelopeJson 写入 taskEnvelope
5. system prompt 中渲染 TaskEnvelope
6. 工具权限取交集
```

---

## 类型修改

在 `AgentRuntime` 的 input 类型中加入：

```ts
taskEnvelope?: TaskEnvelope;
originalUserMessage?: string;
```

需要 import：

```ts
import type { TaskEnvelope } from "../modules/orchestration/orchestration.types.js";
import { renderTaskEnvelopeForAgent } from "../modules/orchestration/task-envelope-renderer.js";
```

---

## run 创建时写入 taskEnvelope

在 insert `agentRuns` 时：

```ts
delegateEnvelopeJson: input.taskEnvelope
  ? jsonStringify(input.taskEnvelope)
  : undefined,
handoffNote: input.handoffNote,
```

---

## PromptContext 构建时使用 TaskEnvelope

当前旧逻辑可能是：

```ts
userMessage: args.input.userMessage,
handoffNote: args.input.handoffNote,
```

新逻辑应改成：

```ts
const effectiveUserMessage =
  args.input.taskEnvelope
    ? renderTaskEnvelopeForAgent(args.input.taskEnvelope)
    : args.input.userMessage;
```

然后 messages：

```ts
const messages: ChatMessage[] = [
  { role: "system", content: systemMessage },
  { role: "user", content: effectiveUserMessage },
];
```

同时 system prompt 里不要重复塞 handoffNote。新流程下 `handoffNote` 可以为空。

---

## 工具权限取交集

当前可能是：

```ts
const mergedAllowedTools = [...new Set([...allowedTools, ...pluginToolIds])];
const toolRuntime = new ToolRuntime(mergedAllowedTools, this.pluginRegistry);
```

改成：

```ts
const baseAllowedTools = [...new Set([...allowedTools, ...pluginToolIds])];

const envelopeAllowedTools = args.input.taskEnvelope?.allowedTools;

const effectiveAllowedTools = envelopeAllowedTools
  ? baseAllowedTools.filter((tool) => envelopeAllowedTools.includes(tool))
  : baseAllowedTools;

const toolRuntime = new ToolRuntime(effectiveAllowedTools, this.pluginRegistry);
```

并在 subagent 新流程下，如果 `taskEnvelope.allowedTools` 为空，可以允许无工具任务，但不能自动放大全部工具权限。

---

# 六、executePlanAsync 收集子 Agent 结果

## 当前问题

当前所有 steps 执行完成后只写：

```ts
"任务执行完成"
```

用户拿不到子 Agent 真正结果。

---

## 修改目标

在 `executePlanAsync()` 中收集结果：

```ts
const stepResults: Array<{
  stepUid: string;
  agentUid: string;
  runUid: string;
  status: string;
  summary: string;
}> = [];
```

每个 step 执行后：

```ts
stepResults.push({
  stepUid: step.stepUid,
  agentUid: step.targetAgentUid,
  runUid: run.runUid,
  status: run.status,
  summary: run.summary || "",
});
```

最后：

```ts
const finalMessage = composeExecutionResult(stepResults);

await updateMainAgentRun(
  mainRunId,
  finalMessage,
  stepResults.some((r) => r.status === "failed") ? "failed" : "success",
  finalWorkContextId
);
```

简单实现：

```ts
function composeExecutionResult(results: Array<{
  stepUid: string;
  agentUid: string;
  runUid: string;
  status: string;
  summary: string;
}>): string {
  if (results.length === 0) return "任务执行完成。";

  if (results.length === 1) {
    return results[0].summary || "任务执行完成。";
  }

  return results
    .map((r, index) => {
      const title = `${index + 1}. ${r.agentUid}：${r.status}`;
      return `${title}\n${r.summary || "无摘要"}`;
    })
    .join("\n\n");
}
```

这就是第一版 `ResponseComposer`。

---

# 七、多步骤之间更新 runningContextIndex

## 当前问题

`executePlanAsync()` 每一步都用最初的 `contextIndex`。

这会导致：

```txt
step1 搜索出来的 artifact/file refs
step2 读取阶段拿不到
```

---

## 第一版修补

在 `executePlanAsync()` 中维护：

```ts
let runningContextIndex = contextIndex;
```

每个 step 后，基于 run result 追加 run ref：

```ts
runningContextIndex = appendRunResultRefs(runningContextIndex, {
  runUid: run.runUid,
  agentUid: step.targetAgentUid,
  summary: run.summary,
  status: run.status,
  workContextUid: plan.workContextUid,
});
```

然后下一步：

```ts
const taskEnvelope = taskEnvelopeBuilder.build({
  step,
  plan,
  contextIndex: runningContextIndex,
  parentRunUid: mainRunId,
  originalUserMessage,
});
```

第一版 append 可以简单：

```ts
function appendRunResultRefs(
  index: SessionContextIndex,
  input: {
    runUid: string;
    agentUid: string;
    summary?: string;
    status: string;
    workContextUid?: string;
  }
): SessionContextIndex {
  const runRefId = `run:${input.runUid}`;

  return {
    refs: [
      ...index.refs,
      {
        refId: runRefId,
        kind: "run",
        title: `${input.agentUid} run`,
        summary: input.summary || "",
        workContextUid: input.workContextUid,
        status: input.status,
        source: {
          table: "agent_runs",
          uid: input.runUid,
          runUid: input.runUid,
        },
        tags: ["run", input.status, input.agentUid],
      },
    ],
    relations: input.workContextUid
      ? [
          ...index.relations,
          {
            fromRefId: runRefId,
            toRefId: `wc:${input.workContextUid}`,
            relation: "belongs_to",
          },
        ]
      : index.relations,
  };
}
```

第二版再从 `agent_artifacts` 查新 artifacts 并追加 artifact refs。

---

# 八、SnapshotBuilder 使用 projection

## 当前问题

`SessionRuntimeSnapshotBuilder` 现在只读：

```ts
metadata.summary
metadata.progressSummary
metadata.currentStage
metadata.nextAction
```

signals 也基本是 false：

```ts
hasFailedRun: false
hasOpenIssue: false
hasRecentArtifact: false
```

---

## 第一版修补

从 metadata 里读取：

```ts
const projection = metadata.projection as WorkContextProjection | undefined;
```

然后 WorkContextCard 加：

```ts
progressSummary: projection?.progressSummary ?? metadata.progressSummary as string | undefined,
currentStage: projection?.currentStage ?? metadata.currentStage as string | undefined,
topRefs: buildTopRefsFromProjection(ctx.workContextUid, projection),
signals: {
  selectedInUI: ctx.workContextUid === selectedWorkContextUid,
  recentlyActive: updatedTime > oneHourAgo,
  hasFailedRun: projection?.lastFailedRunUid ? true : false,
  hasOpenIssue: (projection?.openIssues ?? []).some((x) => x.status === "open"),
  hasRecentArtifact: (projection?.recentRefs ?? []).some((ref) => ref.startsWith("artifact:")),
  hasUnverifiedSideEffect: false,
}
```

实现辅助函数：

```ts
function buildTopRefsFromProjection(
  workContextUid: string,
  projection?: any
): ContextRef[] {
  if (!projection) return [];

  const refs: ContextRef[] = [];

  if (projection.currentFocus?.refId) {
    refs.push({
      refId: projection.currentFocus.refId,
      kind: projection.currentFocus.kind || "artifact",
      title: projection.currentFocus.title || projection.currentFocus.refId,
      summary: projection.progressSummary || "",
      workContextUid,
      status: "current_focus",
      source: { uid: projection.currentFocus.refId },
      tags: ["current_focus"],
    });
  }

  for (const refId of projection.recentRefs ?? []) {
    if (refs.some((r) => r.refId === refId)) continue;

    const kind =
      refId.startsWith("file:")
        ? "file"
        : refId.startsWith("artifact:")
          ? "artifact"
          : refId.startsWith("run:")
            ? "run"
            : refId.startsWith("step:")
              ? "step"
              : "artifact";

    refs.push({
      refId,
      kind,
      title: refId,
      summary: "来自 WorkContext projection.recentRefs",
      workContextUid,
      status: "recent",
      source: { uid: refId },
      tags: ["recent"],
    });
  }

  return refs.slice(0, 10);
}
```

`ContextRefKind` 类型如果不允许动态字符串，按当前 union 做强转或扩展。

---

# 九、关闭或控制 legacy fallback

## 当前问题

`catch` 里直接：

```ts
await processChatAsyncOld(input, mainRunId);
```

会掩盖新流程错误。

---

## 修改目标

加环境变量：

```ts
const ENABLE_LEGACY_FALLBACK = process.env.ENABLE_LEGACY_FALLBACK === "true";
```

catch 改成：

```ts
} catch (error) {
  console.error("[processChatAsync] New flow error:", error);

  if (ENABLE_LEGACY_FALLBACK) {
    console.log("[processChatAsync] Fallback to old flow due to error");
    await processChatAsyncOld(input, mainRunId);
    return;
  }

  await updateMainAgentRun(
    mainRunId,
    `新编排流程执行失败：${error instanceof Error ? error.message : "未知错误"}`,
    "failed",
    finalWorkContextId
  );
}
```

plan mode fallback 也同样处理：

```ts
if (ENABLE_LEGACY_FALLBACK) {
  await processChatAsyncOld(input, mainRunId);
} else {
  await updateMainAgentRun(
    mainRunId,
    `新编排流程暂不支持 plan mode: ${plan.mode}`,
    "failed",
    plan.workContextUid
  );
}
```

---

# 十、验收用例

## 用例 1：新会话新任务

用户：

```txt
查看项目的登录逻辑
```

期望：

```txt
1. MainDecision 输出 targetWorkContextUid=null + createWorkContext。
2. OrchestrationService 创建真实 WorkContext。
3. PlanCompiler 使用真实 workContextUid。
4. 子 Agent 收到 TaskEnvelope。
5. 主 run 最终 resultSummary 不是“任务执行完成”，而是子 Agent summary。
```

---

## 用例 2：已有 WorkContext 追问

用户：

```txt
token 是怎么生成的？
```

期望：

```txt
1. SnapshotBuilder 读取 projection/topRefs。
2. MainDecision 选择已有 wc_login_logic。
3. primaryRefs 包含 auth.service.ts 或 login summary artifact。
4. 委派 code_reader_agent。
```

---

## 用例 3：失败恢复

用户：

```txt
失败了
```

期望：

```txt
1. ContextIndex 中有 failed step ref。
2. MainDecision 输出 recover_execution。
3. targetAgentUid 是对应子 Agent。
4. TaskEnvelope inputRefIds 包含 failed step 和相关 artifact/file。
```

---

## 用例 4：关闭 fallback 测试

设置：

```bash
ENABLE_LEGACY_FALLBACK=false
```

期望：

```txt
1. 新流程任何错误直接体现在 main run failed。
2. 不自动进入 processChatAsyncOld。
3. 日志能看到真实新流程断点。
```

---

# 最重要的修补顺序

按这个顺序做：

```txt
1. MainDecision + schema 增加 createWorkContext。
2. Validator 校验 createWorkContext 和禁止 LLM 编造 workContextUid。
3. OrchestrationService 在 Validator 后创建真实 WorkContext。
4. AgentRuntime 真正支持 taskEnvelope。
5. executePlanAsync 收集 stepResults，最终返回子 Agent summary。
6. runningContextIndex 增量追加 step run refs。
7. SnapshotBuilder 读取 projection/topRefs。
8. legacy fallback 加开关。
```

做到前 5 步，新结构化编排就具备一个更真实的端到端闭环。
