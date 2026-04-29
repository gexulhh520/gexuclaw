# Agent Platform Node 重构任务说明（修复对齐版）

> 目标：把当前 `agent-platform-node` 从“主 Agent 靠浅层上下文 + handoffNote 委派”升级为“结构化 Session 状态 + ContextRefs 证据索引 + MainDecision 结构化裁决 + TaskEnvelope 子任务执行”的多 Agent 控制系统。

***

## 0. 核心结论

当前系统不是缺少 Agent 骨架，而是缺少一条稳定的结构化决策链路。

现有问题：

```txt
1. 主 Agent 看到的上下文太粗，只能看到 WorkContext 列表和 recentRuns 摘要。
2. recentRuns 不包含 agent_run_steps，无法知道具体工具执行细节。
3. 一个 Session 里可能有多个 WorkContext，仅靠当前 WorkContext 无法判断用户指代。
4. 主 Agent 到子 Agent 目前主要靠 handoffNote，自然语言交接不稳定。
5. handoffNote 会增加额外 LLM 生成/理解成本，后续应废弃。
6. 子 Agent 需要结构化 TaskEnvelope，而不是模糊 handoffNote。
7. ToolResult 当前只有 success/data/error/meta/artifactCandidates，缺少 operation、sideEffects、verification、inputRefs、outputRefs。
8. tool_start 和 tool_end 如果都完整存 input/output 会浪费存储，需要轻量化。
9. 工具写入失败时，要写入的内容可能丢失，需要 pending_write artifact。
10. run.status 当前可能在工具失败后仍然 success，需要修正状态语义。
```

最终目标链路：

```txt
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

核心原则：

```txt
代码不判断用户业务意图。
代码负责结构化事实、建立 refs、校验引用、执行计划、记录结果。
LLM 负责基于结构化上下文做语义裁决。
```

***

## 1. LLM 参与边界

本次重构中，必须要求 LLM 固定格式输出的核心位置只有一个：

```txt
MainDecision
```

不应该让每一层都变成 LLM JSON 输出。

### 1.1 必须固定格式输出

```txt
Main LLM Decision Maker
```

它必须输出 `MainDecision` JSON，因为后续代码要解析并执行：

```txt
MainDecision
  ↓
DecisionContractValidator
  ↓
ExecutionPlanCompiler
  ↓
TaskEnvelopeBuilder
```

### 1.2 不要求固定 JSON 输出

```txt
SubAgent AgentResult 完整 JSON
```

子 Agent 最终可以输出自然语言 summary。`AgentResult` 不应该完全相信 LLM 自己总结，而应该由 `AgentRuntime` 基于工具事实合成。

```txt
LLM final 文本
  + tool_end ToolResult
  + artifact records
  + verification
  ↓
AgentRuntime.buildAgentResult()
```

### 1.3 可选使用 LLM 的地方

```txt
1. MainDecision repair：MainDecision JSON 解析失败时，最多让 LLM 修复一次。
2. ResponseComposer 复杂汇总：复杂多步骤结果可让 LLM 组织自然语言回复。
3. PlanRefiner：如果后续 MainDecision.plan 太粗，可增加，但第一版不建议。
```

### 1.4 完全由代码生成的部分

```txt
SessionRuntimeSnapshot
SessionContextIndex
ContextRef
ContextRelation
DecisionContractValidator 结果
ExecutionPlan
TaskEnvelope
ToolResult
AgentResult.operations
WorkContextProjection
Ledger records
```

***

## 2. MainDecisionInput 如何传给 LLM

`MainDecisionInput` 是代码提前构造好的动态 JSON。LLM 不会自己知道你的 WorkContext、Agent、Run、Step、Artifact，必须由代码查出来并传入。

### 2.1 数据来源

| 动态字段                     | 来源模块                          | 数据来源                                               |
| ------------------------ | ----------------------------- | -------------------------------------------------- |
| `workContexts`           | SessionRuntimeSnapshotBuilder | `work_contexts` 表                                  |
| `refs`                   | SessionContextIndexBuilder    | WorkContext / Run / Step / Artifact / File / Agent |
| `availableAgents`        | SessionRuntimeSnapshotBuilder | `agents` / `agent_versions` / 当前可用 Agent           |
| `relations`              | SessionContextIndexBuilder    | run/step/artifact/tool metadata 生成                 |
| `selectedWorkContextUid` | ChatRequestInput              | 前端传入的 `workContextId`                              |
| `userMessage`            | ChatRequestInput              | 用户当前消息                                             |

### 2.2 OpenAI Chat Completions 传参位置

`MainDecisionInput` 应该放进 OpenAI `messages` 参数中的 `user.content`。

```ts
const result = await openai.chat.completions.create({
  model: "gpt-4.1-mini",
  temperature: 0.1,
  messages: [
    {
      role: "system",
      content: mainDecisionSystemPrompt,
    },
    {
      role: "user",
      content: JSON.stringify(mainDecisionInput, null, 2),
    },
  ],
  response_format: {
    type: "json_object",
  },
});
```

如果使用 JSON Schema structured output，优先使用 schema：

```ts
const result = await openai.chat.completions.create({
  model: "gpt-4.1-mini",
  temperature: 0.1,
  messages: [
    { role: "system", content: mainDecisionSystemPrompt },
    { role: "user", content: JSON.stringify(mainDecisionInput, null, 2) },
  ],
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "main_decision",
      strict: true,
      schema: mainDecisionJsonSchema,
    },
  },
});
```

### 2.3 OpenAI Responses API 传参位置

如果使用 Responses API，则放在 `input[].content[].text` 中：

```ts
const response = await openai.responses.create({
  model: "gpt-4.1-mini",
  temperature: 0.1,
  input: [
    {
      role: "system",
      content: [
        { type: "input_text", text: mainDecisionSystemPrompt },
      ],
    },
    {
      role: "user",
      content: [
        { type: "input_text", text: JSON.stringify(mainDecisionInput, null, 2) },
      ],
    },
  ],
  text: {
    format: {
      type: "json_schema",
      name: "main_decision",
      strict: true,
      schema: mainDecisionJsonSchema,
    },
  },
});
```

### 2.4 不要放到 tools 里

`MainDecisionInput` 不是工具参数，不要放到：

```txt
tools
tool_choice
function.arguments
```

它是主 Agent 决策上下文，应放入 `messages[].content` 或 Responses API 的 `input[].content[].text`。

***

## 3. MainDecisionInput 格式

```ts
export type MainDecisionInput = {
  userMessage: string;
  selectedWorkContextUid?: string | null;

  workContexts: WorkContextCard[];

  refs: ContextRef[];
  relations: ContextRelation[];

  availableAgents: Array<{
    agentUid: string;
    name: string;
    description?: string;
    capabilities?: string[];
    toolHints?: string[];
  }>;
};
```

### 3.1 输入示例

```json
{
  "userMessage": "失败了",
  "selectedWorkContextUid": "wc_arch",
  "workContexts": [
    {
      "workContextUid": "wc_file_test",
      "title": "文件系统 Agent 多轮测试",
      "summary": "最近 README.md 写入失败",
      "signals": {
        "selectedInUI": false,
        "recentlyActive": true,
        "hasFailedRun": true,
        "hasRecentArtifact": true
      }
    },
    {
      "workContextUid": "wc_arch",
      "title": "主 Agent 与子 Agent 协作架构",
      "summary": "正在讨论 TaskEnvelope 与 ContextIndex",
      "signals": {
        "selectedInUI": true,
        "recentlyActive": true,
        "hasFailedRun": false,
        "hasRecentArtifact": false
      }
    }
  ],
  "refs": [
    {
      "refId": "step:run_123:8",
      "kind": "step",
      "title": "fs_write 写入 README.md 失败",
      "summary": "filesystem_agent 调用 fs_write 写入 README.md，返回 Permission denied",
      "workContextUid": "wc_file_test",
      "status": "failed",
      "tags": ["step", "failed", "file_write", "write_failed"],
      "evidence": {
        "recencyRank": 1,
        "statusSignals": ["failed", "tool_error"],
        "semanticSignals": ["写入", "README", "失败"]
      }
    },
    {
      "refId": "artifact:artifact_readme_content_001",
      "kind": "artifact",
      "title": "README.md 待写入内容",
      "summary": "README.md 内容已经生成，但写入文件失败，当前为 pending_write",
      "workContextUid": "wc_file_test",
      "status": "pending_write",
      "tags": ["artifact", "pending_write", "file_content"]
    },
    {
      "refId": "file:README.md",
      "kind": "file",
      "title": "README.md",
      "summary": "目标文件，最近写入失败",
      "workContextUid": "wc_file_test",
      "status": "write_failed",
      "tags": ["file", "write_failed"]
    }
  ],
  "relations": [
    {
      "fromRefId": "step:run_123:8",
      "toRefId": "file:README.md",
      "relation": "attempted_write"
    },
    {
      "fromRefId": "artifact:artifact_readme_content_001",
      "toRefId": "file:README.md",
      "relation": "intended_for"
    },
    {
      "fromRefId": "step:run_123:8",
      "toRefId": "wc:wc_file_test",
      "relation": "belongs_to"
    }
  ],
  "availableAgents": [
    {
      "agentUid": "filesystem_agent",
      "name": "文件系统 Agent",
      "description": "负责 workspace 文件读取、写入、修改和回读验证",
      "capabilities": ["file_read", "file_write", "file_verify"]
    },
    {
      "agentUid": "writer_agent",
      "name": "文档写作 Agent",
      "description": "负责生成、改写和总结文本内容",
      "capabilities": ["write_text", "rewrite", "summarize"]
    }
  ]
}
```

***

## 4. MainDecision 输出格式

LLM 必须只输出一个合法 JSON 对象：

```txt
不要 Markdown。
不要代码块。
不要解释文字。
所有顶层字段都必须存在。
无值用 null。
空数组用 []。
```

### 4.1 TypeScript / Zod Schema

```ts
import { z } from "zod";

export const planStepDraftSchema = z.object({
  targetAgentUid: z.string().min(1),
  objective: z.string().min(1),
  inputRefIds: z.array(z.string()).default([]),
  expectedResultKind: z
    .enum(["answer", "artifact", "file_change", "diagnosis", "verification"])
    .default("answer"),
  requireVerification: z.boolean().default(false),
});

export const mainDecisionSchema = z.object({
  decisionType: z.enum([
    "answer_directly",
    "create_work_context",
    "use_existing_work_context",
    "switch_work_context",
    "delegate",
    "multi_step_plan",
    "ask_user",
    "explain_trace",
    "verify_execution",
    "recover_execution",
  ]),

  targetWorkContextUid: z.string().nullable().default(null),

  primaryRefs: z.array(z.string()).default([]),
  secondaryRefs: z.array(z.string()).default([]),

  targetAgentUid: z.string().nullable().default(null),

  plan: z
    .object({
      steps: z.array(planStepDraftSchema).default([]),
    })
    .nullable()
    .default(null),

  response: z.string().nullable().default(null),

  ambiguity: z
    .object({
      candidateWorkContextUids: z.array(z.string()).default([]),
      candidateRefIds: z.array(z.string()).default([]),
      question: z.string().min(1),
    })
    .nullable()
    .default(null),

  confidence: z.enum(["high", "medium", "low"]),
  reasoning: z.string().min(1),
});

export type MainDecision = z.infer<typeof mainDecisionSchema>;
```

### 4.2 输出示例：恢复失败执行

```json
{
  "decisionType": "recover_execution",
  "targetWorkContextUid": "wc_file_test",
  "primaryRefs": [
    "step:run_123:8",
    "artifact:artifact_readme_content_001",
    "file:README.md"
  ],
  "secondaryRefs": [],
  "targetAgentUid": "filesystem_agent",
  "plan": {
    "steps": [
      {
        "targetAgentUid": "filesystem_agent",
        "objective": "使用已保存的 README.md 待写入内容重新写入 README.md，并执行回读校验。",
        "inputRefIds": [
          "step:run_123:8",
          "artifact:artifact_readme_content_001",
          "file:README.md"
        ],
        "expectedResultKind": "file_change",
        "requireVerification": true
      }
    ]
  },
  "response": null,
  "ambiguity": null,
  "confidence": "high",
  "reasoning": "用户反馈失败，最强证据是最近 fs_write 写入 README.md 失败，且存在 pending_write artifact。"
}
```

### 4.3 输出示例：需要澄清

```json
{
  "decisionType": "ask_user",
  "targetWorkContextUid": null,
  "primaryRefs": [],
  "secondaryRefs": [
    "step:run_123:8",
    "artifact:arch_plan"
  ],
  "targetAgentUid": null,
  "plan": null,
  "response": null,
  "ambiguity": {
    "candidateWorkContextUids": [
      "wc_file_test",
      "wc_arch"
    ],
    "candidateRefIds": [
      "step:run_123:8",
      "artifact:arch_plan"
    ],
    "question": "你说的“刚才那个失败了”是指 README.md 文件写入失败，还是刚才讨论的架构方案不满意？"
  },
  "confidence": "low",
  "reasoning": "两个候选都能解释用户表达，无法稳定判断主对象。"
}
```

### 4.4 输出示例：直接回答

```json
{
  "decisionType": "answer_directly",
  "targetWorkContextUid": null,
  "primaryRefs": [],
  "secondaryRefs": [],
  "targetAgentUid": null,
  "plan": null,
  "response": "Execution Plan Compiler 不需要 LLM，它只负责把 MainDecision 编译成可执行计划。",
  "ambiguity": null,
  "confidence": "high",
  "reasoning": "用户询问架构设计中的概念解释，不需要调用子 Agent。"
}
```

***

## 5. MainDecision System Prompt 要求

```txt
你是主 Agent 的结构化决策器，不是执行器。

你会收到：
1. 用户消息
2. 当前 Session 下多个 WorkContext 卡片
3. ContextRefs
4. ContextRelations
5. 可用 Agent 列表

你必须输出一个合法 MainDecision JSON。
不要输出 Markdown。
不要输出代码块。
不要输出解释性文字。
不要编造不存在的 workContextUid、refId、agentUid。

决策规则：
1. 你必须从 ContextRefs 中选择 primaryRefs / secondaryRefs。
2. primaryRefs 是本轮主要处理对象。
3. secondaryRefs 是相关但本轮不主要处理的对象。
4. primaryRefs、secondaryRefs、plan.steps[].inputRefIds 必须来自输入 refs[].refId。
5. targetAgentUid、plan.steps[].targetAgentUid 必须来自 availableAgents[].agentUid。
6. targetWorkContextUid 必须来自 workContexts[].workContextUid，除非 decisionType=create_work_context 或 ask_user。
7. 如果用户表达执行失败、报错、没生效、没写入，优先关注 tags/status/evidence 中包含 failed、error、unverified、write_failed 的 refs。
8. 如果用户表达内容不满意、方案不对、设计不行，优先关注 artifact、document、plan、architecture 相关 refs。
9. selectedInUI 只是提示，不是绝对依据。
10. 如果当前 UI 选中的 WorkContext 与其他 refs 的强证据冲突，以证据更强者为准。
11. 如果多个候选都强且无法判断主次，decisionType 必须是 ask_user。
12. answer_directly 必须填写 response。
13. ask_user 必须填写 ambiguity.question。
14. delegate、recover_execution、verify_execution、multi_step_plan 必须填写 plan.steps。
15. reasoning 只写简短内部理由，不要超过 300 字。
```

***

## 6. MainDecision 解析、修复和校验

### 6.1 统一解析函数

不要在业务代码里散落 `JSON.parse()`。

```ts
async function callLlmForMainDecision(input: {
  modelClient: ModelClient;
  systemPrompt: string;
  decisionInput: MainDecisionInput;
}): Promise<MainDecision> {
  const raw = await input.modelClient.invoke({
    messages: [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: JSON.stringify(input.decisionInput, null, 2) },
    ],
    params: {
      temperature: 0.1,
    },
  });

  const json = extractJsonObject(raw.content);
  const parsed = mainDecisionSchema.safeParse(json);

  if (parsed.success) return parsed.data;

  return repairMainDecisionJsonOnce({
    modelClient: input.modelClient,
    badOutput: raw.content,
    zodError: parsed.error,
    originalInput: input.decisionInput,
  });
}
```

### 6.2 Repair 最多一次

如果解析失败，可以让 LLM 修一次，但只能一次。

Repair prompt：

```txt
你的上一次输出不是合法 MainDecision JSON。
请只修复 JSON，不要改变决策意图。
不要输出 Markdown。
不要输出解释。
错误信息如下：
{zodError}

原始输出：
{badOutput}

必须符合 MainDecision schema。
```

如果 repair 后仍失败，降级为：

```json
{
  "decisionType": "ask_user",
  "targetWorkContextUid": null,
  "primaryRefs": [],
  "secondaryRefs": [],
  "targetAgentUid": null,
  "plan": null,
  "response": null,
  "ambiguity": {
    "candidateWorkContextUids": [],
    "candidateRefIds": [],
    "question": "我需要确认一下你要继续处理哪一项。"
  },
  "confidence": "low",
  "reasoning": "MainDecision JSON parse failed after repair."
}
```

### 6.3 DecisionContractValidator

即使 JSON 格式合法，也必须校验引用是否合法。

校验项：

```txt
1. targetWorkContextUid 是否存在。
2. primaryRefs / secondaryRefs 是否存在于 contextIndex.refs。
3. selected refs 是否属于当前 session。
4. targetAgentUid 是否存在于 availableAgents。
5. plan.steps 中 targetAgentUid 是否存在。
6. plan.steps 中 inputRefIds 是否存在。
7. decisionType 为 delegate/multi_step_plan/recover/verify 时是否有必要字段。
```

示例：

```ts
function validateDecision(input: {
  decision: MainDecision;
  refs: ContextRef[];
  availableAgents: AgentDecisionCard[];
  workContexts: WorkContextCard[];
}) {
  const refIds = new Set(input.refs.map((ref) => ref.refId));
  const agentUids = new Set(input.availableAgents.map((agent) => agent.agentUid));
  const workContextUids = new Set(input.workContexts.map((wc) => wc.workContextUid));

  for (const refId of [...input.decision.primaryRefs, ...input.decision.secondaryRefs]) {
    if (!refIds.has(refId)) {
      throw new Error(`Invalid refId: ${refId}`);
    }
  }

  for (const step of input.decision.plan?.steps ?? []) {
    if (!agentUids.has(step.targetAgentUid)) {
      throw new Error(`Invalid targetAgentUid: ${step.targetAgentUid}`);
    }

    for (const refId of step.inputRefIds) {
      if (!refIds.has(refId)) {
        throw new Error(`Invalid inputRefId: ${refId}`);
      }
    }
  }

  if (input.decision.targetAgentUid && !agentUids.has(input.decision.targetAgentUid)) {
    throw new Error(`Invalid targetAgentUid: ${input.decision.targetAgentUid}`);
  }

  if (
    input.decision.targetWorkContextUid &&
    !workContextUids.has(input.decision.targetWorkContextUid)
  ) {
    throw new Error(`Invalid targetWorkContextUid: ${input.decision.targetWorkContextUid}`);
  }
}
```

Validator 不判断用户意图，只检查 LLM 选择的对象是否真实存在、结构是否可执行。

***

## 7. 核心类型定义

### 7.1 ContextRef

```ts
export type ContextRefKind =
  | "work_context"
  | "run"
  | "step"
  | "artifact"
  | "file"
  | "agent"
  | "tool";

export type ContextRef = {
  refId: string;
  kind: ContextRefKind;

  title: string;
  summary: string;

  workContextUid?: string;
  status?: string;

  source: {
    table?: "work_contexts" | "agent_runs" | "agent_run_steps" | "agent_artifacts";
    uid?: string;
    runUid?: string;
    stepIndex?: number;
    uri?: string;
  };

  tags: string[];

  evidence?: {
    selectedInUI?: boolean;
    recencyRank?: number;
    statusSignals?: string[];
    semanticSignals?: string[];
  };

  updatedAt?: string;
};
```

### 7.2 ContextRelation

```ts
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
```

### 7.3 SessionContextIndex

```ts
export type SessionContextIndex = {
  refs: ContextRef[];
  relations: ContextRelation[];
};
```

### 7.4 RuntimeRunTrace

```ts
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
```

### 7.5 WorkContextCard

```ts
export type WorkContextCard = {
  workContextUid: string;
  title: string;
  goal: string;
  status: string;

  summary?: string;
  progressSummary?: string;
  currentStage?: string;
  nextAction?: string;

  updatedAt: string;

  latestRun?: {
    runUid: string;
    agentUid: string;
    agentName?: string;
    status: string;
    summary?: string;
    errorMessage?: string;
  };

  latestArtifact?: {
    artifactUid: string;
    title: string;
    artifactType: string;
    summary?: string;
  };

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
```

### 7.6 SessionRuntimeSnapshot

```ts
export type SessionRuntimeSnapshot = {
  userMessage: string;

  session: {
    sessionUid: string;
    title?: string;
    description?: string;
  };

  selectedWorkContextUid?: string;

  workContexts: WorkContextCard[];

  globalRecentRuns: RuntimeRunTrace[];

  globalRecentArtifacts: Array<{
    artifactUid: string;
    workContextUid?: string;
    title: string;
    artifactType: string;
    artifactRole?: string;
    summary?: string;
    createdAt?: string;
  }>;

  availableAgents: Array<{
    agentUid: string;
    name: string;
    description?: string;
    capabilities?: string[];
    status?: string;
  }>;
};
```

***

## 8. ExecutionPlan

`ExecutionPlanCompiler` 不需要 LLM。它只负责把 `MainDecision` 确定性转换成可执行计划。

```ts
export type ExecutionPlan = {
  planUid: string;

  mode:
    | "direct_response"
    | "single_agent"
    | "sequential_agents"
    | "parallel_agents";

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

  finalResponseStrategy:
    | "use_direct_response"
    | "compose_from_agent_results"
    | "compose_from_ledger";
};
```

重要约束：

```txt
ExecutionPlanCompiler 不能创造工具权限。
它只能从目标 Agent 当前版本 allowedTools + pluginTools 中筛选。
TaskEnvelope.allowedTools 是本次任务临时授权。
最终暴露给 LLM 的工具必须是：
AgentVersion.allowedTools + pluginTools 与 TaskEnvelope.allowedTools 的交集。
```

***

## 9. TaskEnvelope

`TaskEnvelope` 是主 Agent 给子 Agent 的结构化任务包。它替代 `handoffNote`。

```ts
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
    format: "agent_result";
    mustIncludeOperations: boolean;
    mustIncludeOpenIssues: boolean;
  };
};

export type LedgerSlice = {
  refId: string;
  runUid: string;
  agentUid: string;
  agentName?: string;
  status: string;
  steps: RuntimeStepTrace[];
};

export type ArtifactSlice = {
  refId: string;
  artifactUid: string;
  title: string;
  artifactType: string;
  artifactRole?: string;
  summary?: string;
  contentText?: string;
  contentJson?: unknown;
};

export type FileSlice = {
  refId: string;
  uri: string;
  path: string;
  lastKnownOperation?: "read" | "write" | "edit" | "append" | "move" | "delete";
  lastKnownStatus?: "success" | "failed" | "unverified" | "unknown";
  summary?: string;
};
```

注意：`TaskEnvelope.outputContract.format` 不代表必须让子 Agent LLM 输出完整 JSON。第一版中，`AgentResult` 由代码合成，子 Agent LLM 的最终自然语言作为 summary。

***

## 10. AgentResult

`AgentResult` 是子 Agent run 的标准结果，但它不应该完全由 LLM 输出。

### 10.1 生成方式

```txt
LLM final summary
  + tool_end ToolResult
  + artifact records
  + verification
  ↓
AgentRuntime.buildAgentResult()
```

### 10.2 类型

```ts
export type AgentResult = {
  status: "success" | "partial_success" | "failed" | "needs_clarification";

  summary: string;

  operations: Array<{
    toolName?: string;
    operationType?: string;
    target?: string;
    status: "success" | "failed" | "skipped";
    errorCode?: string;
    errorMessage?: string;
    verification?: {
      required: boolean;
      status: "verified" | "unverified" | "failed" | "not_applicable";
      method?: string;
      evidence?: unknown;
    };
  }>;

  producedArtifacts: Array<{
    artifactUid?: string;
    title: string;
    role?: string;
  }>;

  touchedResources: Array<{
    type: "file" | "artifact" | "url" | "db_record" | "external_resource";
    uri: string;
    operation: string;
    verified: boolean;
  }>;

  openIssues: Array<{
    type: string;
    message: string;
    severity: "low" | "medium" | "high";
  }>;

  retryAdvice?: {
    retryable: boolean;
    retryMode?: "same_agent" | "different_agent" | "human_needed";
    reason?: string;
  };
};
```

### 10.3 规则

```txt
1. status、operations、verification、touchedResources 应从工具事实生成。
2. summary 可使用 LLM final 文本。
3. openIssues 可由工具错误和 verification 派生。
4. 不要让 LLM 覆盖工具真实失败状态。
```

***

## 11. ToolResult 扩展

当前 `ToolResult` 太弱，需要兼容扩展。

```ts
export type ToolResult = {
  success: boolean;

  data?: unknown;

  error?: string | {
    code: string;
    message: string;
    retryable?: boolean;
    category?:
      | "validation"
      | "permission"
      | "not_found"
      | "conflict"
      | "runtime"
      | "external"
      | "unknown";
  };

  meta?: Record<string, unknown>;

  artifactCandidates?: ToolArtifactCandidate[];

  operation?: {
    type:
      | "read"
      | "write"
      | "edit"
      | "append"
      | "delete"
      | "list"
      | "search"
      | "analyze"
      | "generate"
      | "verify";
    target?: string;
    targetKind?: "file" | "artifact" | "url" | "db_record" | "external_resource";
  };

  sideEffects?: Array<{
    type:
      | "file_write"
      | "file_edit"
      | "file_append"
      | "file_delete"
      | "artifact_create"
      | "external_call";
    target: string;
    status: "created" | "modified" | "deleted" | "attempted" | "none";
  }>;

  verification?: {
    required: boolean;
    status: "verified" | "unverified" | "failed" | "not_applicable";
    method?: string;
    evidence?: unknown;
  };

  inputRefs?: Array<{
    refId?: string;
    artifactUid?: string;
    uri?: string;
    role?: "input" | "source" | "target" | "content";
  }>;

  outputRefs?: Array<{
    refId?: string;
    artifactUid?: string;
    uri?: string;
    role?: "result" | "created" | "modified" | "pending_write";
  }>;
};
```

要求：

```txt
1. 保留旧字段，避免破坏现有工具。
2. 写入类工具必须返回 operation / sideEffects / verification。
3. 读类工具可以只返回 operation。
4. 失败时 error 尽量使用结构化对象。
```

***

## 12. LedgerReader

新增文件：

```txt
agent-platform-node/src/modules/orchestration/ledger-reader.ts
```

职责：

```txt
从 agent_runs / agent_run_steps / agents 读取运行事实。
不要做用户意图判断。
```

必须提供：

```ts
export class LedgerReader {
  async getRecentRunsWithSteps(input: {
    sessionId: string;
    limit?: number;
    stepsPerRun?: number;
  }): Promise<RuntimeRunTrace[]>;

  async getRunWithSteps(runUid: string): Promise<RuntimeRunTrace | undefined>;

  async getStepSlice(input: {
    runUid: string;
    stepIndex: number;
    before?: number;
    after?: number;
  }): Promise<LedgerSlice>;

  async getRunSlice(runUid: string): Promise<LedgerSlice>;
}
```

不要直接替换旧 `getRecentRuns()`。旧方法可继续用于摘要，新方法用于运行态快照。

***

## 13. SessionRuntimeSnapshotBuilder

新增文件：

```txt
agent-platform-node/src/modules/orchestration/session-runtime-snapshot-builder.ts
```

职责：

```txt
读取当前 session 下多个 WorkContext、recent runs、artifacts、agents，构造成 SessionRuntimeSnapshot。
不判断用户意图。
```

输入：

```ts
{
  sessionId: string;
  userMessage: string;
  selectedWorkContextUid?: string;
}
```

输出：

```ts
SessionRuntimeSnapshot
```

实现要求：

```txt
1. 获取 session 信息。
2. 获取 session 下最近/活跃的 WorkContext，建议 limit 10。
3. 每个 WorkContext 转为 WorkContextCard。
4. 读取 globalRecentRuns = ledgerReader.getRecentRunsWithSteps(sessionId, 10)。
5. 读取 globalRecentArtifacts。
6. 获取 availableAgents。
7. selectedWorkContextUid 只作为信号，不作为绝对依据。
```

***

## 14. SessionContextIndexBuilder

新增文件：

```txt
agent-platform-node/src/modules/orchestration/session-context-index-builder.ts
```

职责：

```txt
把 SessionRuntimeSnapshot 中的 WorkContext / Run / Step / Artifact / Agent / File 转成 refs。
不判断用户意图。
```

输出：

```ts
SessionContextIndex
```

第一版至少支持这些 ref：

```txt
work_context
run
step
artifact
agent
file
```

refId 格式建议：

```txt
wc:<workContextUid>
run:<runUid>
step:<runUid>:<stepIndex>
artifact:<artifactUid>
agent:<agentUid>
file:<path>
```

需要生成 relation：

```txt
run belongs_to work_context
step belongs_to run
step belongs_to work_context
run executed_by agent
step attempted_write file
artifact belongs_to work_context
```

***

## 15. MainAgent 升级

当前文件：

```txt
agent-platform-node/src/modules/orchestration/main-agent.ts
```

新增方法：

```ts
async decideWithSessionIndex(input: {
  userMessage: string;
  snapshot: SessionRuntimeSnapshot;
  contextIndex: SessionContextIndex;
}): Promise<MainDecision>
```

内部调用 LLM 时：

```ts
const mainDecisionInput: MainDecisionInput = {
  userMessage,
  selectedWorkContextUid: snapshot.selectedWorkContextUid ?? null,
  workContexts: snapshot.workContexts,
  refs: contextIndex.refs,
  relations: contextIndex.relations,
  availableAgents: snapshot.availableAgents,
};

const decision = await modelClient.invokeJson({
  system: mainDecisionSystemPrompt,
  input: mainDecisionInput,
  schema: mainDecisionSchema,
  temperature: 0.1,
});
```

***

## 16. DecisionContractValidator

新增文件：

```txt
agent-platform-node/src/modules/orchestration/decision-contract-validator.ts
```

职责：

```txt
校验 LLM 输出是否引用了真实对象。
不判断用户业务语义。
```

校验项：

```txt
1. targetWorkContextUid 是否存在。
2. primaryRefs / secondaryRefs 是否存在于 contextIndex.refs。
3. selected refs 是否属于当前 session。
4. targetAgentUid 是否存在于 availableAgents。
5. plan.steps 中 targetAgentUid 是否存在。
6. plan.steps 中 inputRefIds 是否存在。
7. decisionType 为 delegate/multi_step_plan/recover/verify 时必须有必要字段。
8. 如果校验失败，返回 ask_user 或 repair/fallback。
```

***

## 17. ExecutionPlanCompiler

新增文件：

```txt
agent-platform-node/src/modules/orchestration/execution-plan-compiler.ts
```

注意：**这个模块不需要 LLM。**

职责：

```txt
把 MainDecision / PlanDraft 确定性转换为 ExecutionPlan。
```

要求：

```txt
1. answer_directly → direct_response。
2. delegate → single_agent。
3. multi_step_plan → sequential_agents 或 parallel_agents。
4. 为 plan 和 step 生成 uid。
5. 补 dependsOn。
6. 根据 targetAgentUid / expectedResultKind 从 Agent 当前可用工具中筛选 allowedTools。
7. allowedTools 不能超过 AgentVersion.allowedTools + pluginTools。
8. selectedRefs = primaryRefs + secondaryRefs。
```

***

## 18. TaskEnvelopeBuilder

新增文件：

```txt
agent-platform-node/src/modules/orchestration/task-envelope-builder.ts
```

职责：

```txt
把 ExecutionPlan.step 转成 TaskEnvelope。
不调用 LLM。
```

构造流程：

```txt
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

```txt
1. 只展开 inputRefIds 相关上下文。
2. 不给整个 session 历史。
3. 不给所有 WorkContext。
4. 不给所有 artifacts。
5. 子 Agent 不再自己猜上下文。
6. requireVerification 为 true 时，constraints 中必须要求验证副作用。
```

***

## 19. 废弃 handoffNote

`handoffNote` 不再作为独立协议字段。

旧流程：

```txt
MainAgent LLM → handoffNote → SubAgent LLM
```

新流程：

```txt
MainAgent LLM → MainDecision
代码 → ExecutionPlan
代码 → TaskEnvelope
代码 → renderTaskEnvelopePrompt()
SubAgent LLM 执行
```

### 19.1 RunAgentInput 目标结构

```ts
type RunAgentInput = {
  agentRecord: {
    id: number;
    agentUid: string;
    name: string;
    type: string;
  };

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
```

规则：

```txt
main / standalone:
- 可以没有 taskEnvelope
- 使用 originalUserMessage 作为模型 user message

subagent:
- 新流程必须有 taskEnvelope
- originalUserMessage 只用于追踪
- 子 Agent 的任务目标来自 taskEnvelope.objective

迁移期：
- 可以允许旧流程 fallback 使用 legacy handoffNote
- 但所有新增委派逻辑必须走 taskEnvelope
```

### 19.2 落库

```ts
await db.insert(agentRuns).values({
  userMessage: input.originalUserMessage,
  handoffNote: null,
  delegateEnvelopeJson: input.taskEnvelope
    ? jsonStringify(input.taskEnvelope)
    : null,
});
```

数据库字段 `handoffNote` 可以先保留，但新流程不再写入。

***

## 20. TaskEnvelopeRenderer

新增文件：

```txt
agent-platform-node/src/modules/orchestration/task-envelope-renderer.ts
```

函数：

```ts
export function renderTaskEnvelopeForAgent(envelope: TaskEnvelope): string {
  return `
You are executing a delegated task.

Objective:
${envelope.objective}

Original User Message:
${envelope.originalUserMessage}

Selected Context Refs:
${envelope.selectedContext.refs.map(ref => `- ${ref.refId} [${ref.kind}] ${ref.title}: ${ref.summary}`).join("\n")}

Ledger Slices:
${JSON.stringify(envelope.selectedContext.ledgerSlices, null, 2)}

Artifacts:
${JSON.stringify(envelope.selectedContext.artifacts, null, 2)}

Files:
${JSON.stringify(envelope.selectedContext.files, null, 2)}

Constraints:
${envelope.constraints.map(item => `- ${item}`).join("\n")}

Allowed Tools:
${envelope.allowedTools.map(item => `- ${item}`).join("\n")}

Expected Result:
${JSON.stringify(envelope.expectedResult, null, 2)}

Output Contract:
Use the tools when needed. Your final natural language answer will be used as summary.
Do not invent tool results. Tool facts will be collected by runtime.
`;
}
```

注意：这是代码渲染，不是 LLM 调用。

***

## 21. AgentRuntime 修改

当前文件：

```txt
agent-platform-node/src/runtime/agent-runtime.ts
```

### 21.1 接收 taskEnvelope

`RunAgentInput` 增加：

```ts
taskEnvelope?: TaskEnvelope;
originalUserMessage: string;
```

废弃：

```ts
handoffNote;
userMessage;
```

### 21.2 计算 effectiveUserMessage

```ts
const effectiveUserMessage =
  input.mode === "subagent" && input.taskEnvelope
    ? input.taskEnvelope.objective
    : input.originalUserMessage;
```

### 21.3 渲染 taskEnvelopePrompt

```ts
const taskEnvelopePrompt = input.taskEnvelope
  ? renderTaskEnvelopeForAgent(input.taskEnvelope)
  : undefined;
```

### 21.4 renderSystemMessage 不再拼 handoffNote

旧：

```ts
context.handoffNote ? `\nHandoff note:\n${context.handoffNote}` : ""
```

新：

```ts
taskEnvelopePrompt ? `\nTask Envelope:\n${taskEnvelopePrompt}` : ""
```

### 21.5 工具权限取交集

当前：

```ts
const mergedAllowedTools = [...new Set([...allowedTools, ...pluginToolIds])];
```

改为：

```ts
const baseAllowedTools = [...new Set([...allowedTools, ...pluginToolIds])];

const envelopeAllowedTools = args.input.taskEnvelope?.allowedTools;

const mergedAllowedTools = envelopeAllowedTools
  ? baseAllowedTools.filter((tool) => envelopeAllowedTools.includes(tool))
  : baseAllowedTools;
```

这样 TaskEnvelope.allowedTools 变成硬约束。

***

## 22. tool\_start / tool\_end 存储策略

不要 tool\_start 和 tool\_end 都存完整大 input。

新增工具输入规范化函数：

```ts
normalizeToolInputForTrace({
  toolName,
  input,
  workContextUid,
  runId,
})
```

策略：

```txt
1. tool_start 只存 summary input + inputRefs。
2. tool_end 存 ToolResult + summary input + metadata。
3. 大 content 保存为 artifact，不重复存进 step。
```

tool\_start：

```ts
await this.createStep({
  runId: args.runId,
  stepIndex: stepIndex++,
  stepType: "tool_start",
  toolName: toolCall.name,
  toolCallId: toolCall.id,
  toolStatus: "running",
  input: normalizedToolInput.summaryInput,
  metadata: {
    inputRefs: normalizedToolInput.inputRefs,
    omittedFields: normalizedToolInput.omittedFields,
    recordLevel: "summary",
  },
});
```

tool\_end：

```ts
await this.createStep({
  runId: args.runId,
  stepIndex: stepIndex++,
  stepType: "tool_end",
  toolName: toolCall.name,
  toolCallId: toolCall.id,
  toolStatus: decoratedToolResult.toolResult.success ? "success" : "failed",
  input: normalizedToolInput.summaryInput,
  output: decoratedToolResult.toolResult,
  metadata: {
    inputRefs: normalizedToolInput.inputRefs,
    operation: decoratedToolResult.toolResult.operation,
    sideEffects: decoratedToolResult.toolResult.sideEffects,
    verification: decoratedToolResult.toolResult.verification,
    outputRefs: decoratedToolResult.toolResult.outputRefs,
    recordLevel: "result",
  },
});
```

***

## 23. run.status 计算

不要固定成功。

```ts
const finalStatus = result.hasFailedTool
  ? "failed"
  : result.hasUnverifiedSideEffect
    ? "partial_success"
    : "success";
```

`executeRunLoop` 需要累计：

```ts
toolExecutions;
hasFailedTool;
hasUnverifiedSideEffect;
```

然后：

```ts
await db.update(agentRuns).set({
  status: result.agentResult.status,
  resultSummary: result.agentResult.summary,
  outputJson: jsonStringify(result.agentResult),
});
```

***

## 24. pending\_write artifact

场景：

```txt
某个 Agent 生成了内容，准备写入文件，但 fs_write 失败。
```

要求：

```txt
要写入的内容不能丢。
必须保存为 pending_write artifact。
```

### 24.1 第一版

如果写入工具失败，且 input 中存在大段 content：

```txt
1. 自动保存 content 为 artifact。
2. artifactRole = pending_write。
3. artifactType = file_content。
4. metadata 中保存 targetPath、failedRunUid、failedStepRef。
5. ToolResult.outputRefs 指向 artifact。
```

示例 metadata：

```json
{
  "targetPath": "README.md",
  "writeStatus": "failed",
  "failedRunUid": "run_fs_123",
  "failedStepRef": "step:run_fs_123:8"
}
```

### 24.2 长期目标

```txt
写入前先把待写入内容 staging 为 artifact。
fs_write 只接收 contentArtifactUid。
避免大内容进入 tool input。
```

ContextIndexBuilder 后续需要生成：

```txt
artifact:<artifactUid> status=pending_write
file:README.md status=write_failed
step:<runUid>:<stepIndex> status=failed
```

并建立 relations：

```txt
artifact intended_for file
step attempted_write_artifact artifact
step attempted_write file
```

***

## 25. Orchestration 主流程接入

这个不是 P2，而是 P0/P1。否则前面模块不会真正跑起来。

新增或修改：

```txt
agent-platform-node/src/modules/orchestration/orchestration.service.ts
```

目标流程：

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

```txt
1. 新流程优先。
2. 保留旧流程 fallback。
3. 新流程失败时可回退旧流程。
4. 所有新增委派逻辑必须走 TaskEnvelope。
```

***

## 26. WorkContextProjectionService

文件路径应放在：

```txt
agent-platform-node/src/modules/work-contexts/work-context-projection.service.ts
```

不要放在 orchestration 目录。

职责：

```txt
从 ledger/artifacts 更新 progressSummary/currentFocus/openIssues/recentRefs。
不判断用户下一轮意图。
```

第一版投影字段：

```ts
export type WorkContextProjection = {
  workContextUid: string;

  currentStage:
    | "created"
    | "planning"
    | "executing"
    | "waiting_user"
    | "recovering"
    | "completed"
    | "blocked";

  progressSummary: string;

  recentRefs: string[];

  currentFocus?: {
    refId: string;
    kind: "file" | "artifact" | "run" | "step";
    title: string;
  };

  openIssues: Array<{
    issueRefId: string;
    summary: string;
    severity: "low" | "medium" | "high";
  }>;

  lastRunUid?: string;
  lastSuccessfulRunUid?: string;
  lastFailedRunUid?: string;
};
```

***

## 27. ResponseComposer

第一版可以很薄：

```txt
1. direct_response 使用 MainDecision.response。
2. 子 Agent 执行后使用 AgentResult.summary。
3. 多步骤执行汇总 AgentResult.status / summary / openIssues。
4. 复杂自然语言总结后续再接 LLM，可选。
```

不要第一版就把 ResponseComposer 做成复杂 LLM 总结器。

***

## 28. 推荐实施顺序

| Phase    | 内容                                                                        | 优先级   |
| -------- | ------------------------------------------------------------------------- | ----- |
| Phase 1  | 类型定义：ContextRef / MainDecision / TaskEnvelope / AgentResult / ToolResult  | P0    |
| Phase 2  | LedgerReader + SessionRuntimeSnapshotBuilder + SessionContextIndexBuilder | P0    |
| Phase 3  | MainAgent.decideWithSessionIndex + MainDecision LLM JSON 输出               | P0    |
| Phase 4  | DecisionContractValidator + ExecutionPlanCompiler                         | P0    |
| Phase 5  | Orchestration 主流程接入，保留旧流程 fallback                                        | P0/P1 |
| Phase 6  | TaskEnvelopeBuilder + TaskEnvelopeRenderer                                | P1    |
| Phase 7  | AgentRuntime 支持 taskEnvelope，废弃 handoffNote 新逻辑                           | P1    |
| Phase 8  | ToolResult 增强 + tool\_start/tool\_end 轻量化 + run.status 修正                 | P1    |
| Phase 9  | pending\_write artifact                                                   | P1/P2 |
| Phase 10 | WorkContextProjectionService + ResponseComposer 优化                        | P2    |

***

## 29. 验收标准

### 29.1 多 WorkContext 指代

场景：

```txt
Session 里有 wc_file_test 和 wc_arch。
当前 UI 选中 wc_arch。
wc_file_test 最近有 fs_write failed。
用户输入：失败了
```

期望：

```txt
LLM Decision 选择 wc_file_test。
primaryRefs 包含 failed step。
不应该盲目使用当前 UI 选中的 wc_arch。
```

### 29.2 模糊多候选

场景：

```txt
wc_file_test 有工具失败。
wc_arch 有架构方案被用户否定。
用户输入：刚才那个失败了
```

期望：

```txt
如果两个候选证据都强，MainDecision.decisionType = ask_user。
问题应该带候选：
“你说的是文件写入失败，还是架构方案不满意？”
```

### 29.3 子 Agent 输入

期望：

```txt
subagent run 新流程必须有 delegateEnvelopeJson。
不再依赖 handoffNote。
TaskEnvelope 中包含 objective、selectedContext、allowedTools、expectedResult。
```

### 29.4 工具权限

期望：

```txt
子 Agent 暴露给 LLM 的 tools = AgentVersion/Plugin tools ∩ TaskEnvelope.allowedTools。
```

### 29.5 工具写入失败

场景：

```txt
fs_write 写 README.md 失败。
```

期望：

```txt
ToolResult 包含 operation、sideEffects、verification、error。
agent_run_steps.tool_end.metadataJson 包含 sideEffects/verification。
run.status = failed 或 partial_success。
如果 input 有 content，生成 pending_write artifact。
```

### 29.6 tool\_start 存储

期望：

```txt
tool_start 不存大 content。
tool_start 只存 summary/inputRefs。
tool_end 存结果和 metadata。
```

### 29.7 失败后恢复

场景：

```txt
上一步内容生成成功，但写入失败。
用户输入：重新写
```

期望：

```txt
MainDecision primaryRefs 包含 pending_write artifact 和 failed step。
TaskEnvelope 给 filesystem_agent。
子 Agent 使用 pending_write artifact 内容重试写入，而不是重新生成内容。
```

***

## 30. 不要做的事情

```txt
1. 不要继续增强 handoffNote。
2. 不要让 LLM 额外生成 handoffNote。
3. 不要用正则判断“失败了/继续/刚才那个”。
4. 不要让代码判断用户业务语义。
5. 不要把整个 Session 历史塞给子 Agent。
6. 不要让子 Agent 自己猜上下文。
7. 不要把大段 content 同时存在 tool_start 和 tool_end。
8. 不要让工具失败后 run 仍然固定 success。
9. 不要让 TaskEnvelope.allowedTools 只是软提示，必须和工具 manifest 取交集。
10. 不要强制子 Agent LLM 输出完整 AgentResult JSON。
```

***

## 31. 最终目标

重构完成后，主 Agent 不再靠模糊上下文和 handoffNote 调度。

它应该变成：

```txt
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
```

最终效果：

```txt
用户说“失败了”
系统不是反问“哪里失败了”
而是基于 refs 知道最近哪个 WorkContext、哪个 run、哪个 step、哪个工具、哪个 artifact 相关。
如果证据明确，直接恢复。
如果证据冲突，精准澄清。
如果内容已生成但写入失败，使用 pending_write artifact 重试，而不是重新生成。
```

