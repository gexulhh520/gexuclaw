# 改进计划 - 补齐 touchedResources 资源图谱与 artifact fallback

## 背景

当前已完成：

1. TaskEnvelope 不默认渲染 Original User Message
2. Selected Context 默认隐藏，避免重复
3. artifacts 支持 contentText/contentJson 渲染
4. step dependsOn 可以自动合并上一步产生的 refs
5. touchedResources 已经可以变成 file/url/resource refs

本次继续补齐 6 项改进。

***

## 步骤 1：修改 ContextRelation 类型，增加资源操作关系

**文件**：`src/modules/orchestration/orchestration.types.ts`

在 `ContextRelation.relation` 中新增：

* `"touched"`

* `"read"`

* `"wrote"`

* `"modified"`

* `"deleted"`

***

## 步骤 2：修改 appendRunResultRefs，根据 operation 生成准确关系

**文件**：`src/modules/orchestration/orchestration.service.ts`

改动点：

1. 新增 `mapTouchedOperationToRelation()` helper，将 operation 字符串映射到对应的关系类型
2. 将关系方向从 `resource -> run`（used\_by）改为 `run -> resource`（read/wrote/modified/touched）
3. ref 的 summary 改为 `${resource.operation || "touched"}; verified=${resource.verified ? "true" : "false"}`
4. ref 的 status 统一为 `resource.verified ? "verified" : "unverified"`

***

## 步骤 3：TaskEnvelope Hydrator 支持 url/resource

**文件**：

* `src/modules/orchestration/task-envelope.types.ts`

* `src/modules/orchestration/task-envelope-context-hydrator.ts`

* `src/modules/orchestration/task-envelope-builder.ts`

改动点：

1. 在 `task-envelope.types.ts` 中新增 `ResourceSlice` 类型
2. 在 `TaskEnvelope.selectedContext` 中增加 `resources: ResourceSlice[]`
3. 在 `task-envelope-context-hydrator.ts` 中增加 url/resource 的处理逻辑
4. 在 `task-envelope-builder.ts` 中将 `hydrated.resources` 接入 selectedContext

***

## 步骤 4：TaskEnvelopeRenderer 渲染 Resources

**文件**：`src/modules/orchestration/task-envelope-renderer.ts`

在 Files 区块后面增加 Resources 区块渲染：

```
## Resources
- url:xxx
  kind: url
  uri: https://...
  status: success
  lastOperation: crawl
  summary: ...
```

***

## 步骤 5：Previous Runs 必须显示 summary

**文件**：

* `src/modules/orchestration/task-envelope-context-hydrator.ts`

* `src/modules/orchestration/task-envelope-renderer.ts`

改动点：

1. hydrator 中从 run.resultSummary 和 ref.tags 推断 agentUid，填入 LedgerSlice
2. renderer 中在 Previous Runs 每个 slice 下渲染 summary（限制 500 字符）

***

## 步骤 6：没有 artifact 时自动生成 fallback artifact

**文件**：

* 新建 `src/modules/artifacts/fallback-artifact.ts`

* `src/runtime/agent-runtime.ts`

改动点：

1. 新建 `persistFallbackArtifactFromFinalSummary()` 函数
2. 在 `AgentRuntime.run()` 中 `executeRunLoop` 返回后、`buildAgentResult` 之前调用
3. 只在没有现有 artifact 且 summary 非空时生成

***

## 步骤 7：禁用 agent 自动扩散 refs，防止上下文串台

**文件**：`src/modules/orchestration/task-envelope-builder.ts`

改动点：

1. 在 `resolveRefs()` 中删除/注释掉 `directRef.kind === "agent"` 的自动扩散逻辑
2. 保留 `findRelatedRefsForAgent` 方法但不再被调用（或后续可安全删除）

原因：agent 是执行者不是数据源，plan 内数据传递已由 dependsOn -> producedRefsByStepUid 解决。

***

## 验收标准

### 场景 1：文案 Agent 没有主动生成 artifact

* 第一个文案 Agent 只输出 final summary，没有 artifact directive

* 应自动生成 fallback artifact

* 下一个 Agent 的 TaskEnvelope 中能看到 Artifacts 区块包含标题内容

### 场景 2：文件 Agent 写入文件

* touchedResources: `{ type: "file", uri: "1.txt", operation: "write", verified: true }`

* 应生成 ContextRef: `file:1.txt`, kind=`file`, status=`verified`

* 应生成关系：`run:xxx --wrote--> file:1.txt`

### 场景 3：浏览器/爬虫 Agent 访问 URL

* touchedResources: `{ type: "url", uri: "https://example.com/page/1", operation: "crawl", verified: true }`

* 应生成 ContextRef: `url:https://example.com/page/1`, kind=`url`

* 应生成关系：`run:xxx --read--> url:https://example.com/page/1`

* 下游 TaskEnvelope 应显示 Resources 区块

### 场景 4：不能串台

* Step2 依赖 Step1，只能自动拿 Step1 的 produced refs

* 不允许因为 Step2 的 inputRefIds 里出现 `agent:writer_agent` 就自动拉取无关历史 run

***

## 最终链路

```
SubAgent 执行
  ↓
ToolResult.operation / sideEffects / outputRefs
  ↓
AgentResult.touchedResources
  ↓
appendRunResultRefs
  ↓
生成 file/url/resource refs
  ↓
生成 run --read/wrote/modified/touched--> resource 关系
  ↓
executionContext.producedRefsByStepUid 记录这些 refs
  ↓
下一 step 根据 dependsOn 自动合并 refs
  ↓
TaskEnvelope Hydrator 查询 artifact/run/resource
  ↓
Renderer 渲染 Previous Runs / Artifacts / Files / Resources
  ↓
下一个 SubAgent 能继续干活
```

