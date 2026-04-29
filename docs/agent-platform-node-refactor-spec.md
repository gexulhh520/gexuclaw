# Agent Platform Node 重构补充说明：LLM 参与边界、输入格式与固定输出协议

> 本文用于补充 `agent-platform-node` 的主 Agent / 子 Agent 协作重构设计，重点说明：哪些地方需要 LLM，哪些地方不需要 LLM，调用 OpenAI 时动态 JSON 应该放在哪里，主 Agent LLM 应该输出什么固定格式，以及如何保证输出稳定。

---

## 1. 总体原则

这次重构中，不应该让每一层都依赖 LLM 输出固定 JSON。

核心原则是：

```txt
LLM 只负责语义决策。
代码负责事实整理、索引构建、校验、编译、执行、工具验证、账本记录。
```

也就是说：

```txt
代码构造结构化世界状态
  ↓
LLM 在结构化输入中做主决策
  ↓
代码校验 LLM 选择是否真实存在
  ↓
代码编译执行计划
  ↓
代码构造 TaskEnvelope
  ↓
子 Agent LLM 执行具体任务
  ↓
工具结果由 ToolRuntime 产生
  ↓
AgentResult 由代码基于工具事实合成
```

---

## 2. 哪些地方需要 LLM 固定格式输出？

### 2.1 必须固定格式输出：MainDecision

唯一强制要求 LLM 输出固定结构 JSON 的核心位置是：

```txt
Main LLM Decision Maker
```

原因：后续代码需要解析它，并进入：

```txt
DecisionContractValidator
ExecutionPlanCompiler
TaskEnvelopeBuilder
SubAgentRuntime
```

如果主 Agent 只输出自然语言，例如：

```txt
我觉得应该让文件系统 Agent 去重试一下。
```

代码无法稳定知道：

```txt
哪个 WorkContext？
选中了哪些 refs？
哪个 Agent？
是恢复、验证、委派、解释，还是澄清？
是否有多步骤计划？
```

所以 `MainDecision` 必须是固定 JSON。

---

### 2.2 不建议固定格式输出：SubAgent AgentResult

子 Agent 不建议强制完整输出 `AgentResult JSON`。

原因：子 Agent 的真实执行事实来自：

```txt
tool_end steps
ToolResult
artifact records
sideEffects
verification
```

这些事实应该由代码产生，不应该让 LLM 编造或总结。

推荐方式：

```txt
子 Agent LLM 输出自然语言 summary
  +
ToolRuntime 产生 ToolResult
  +
AgentRuntime 收集 toolExecutions / artifacts
  ↓
AgentRuntime.buildAgentResult() 由代码合成 AgentResult
```

LLM 可以负责：

```txt
summary
userFacingMessage
解释性建议
```

代码必须负责：

```txt
status
operations
toolName
operationType
target
errorCode
errorMessage
verification
sideEffects
touchedResources
producedArtifacts
retryable
```

---

## 3. 哪些模块不需要 LLM？

以下模块不应该让 LLM 输出固定 JSON，必须由代码确定性产生：

```txt
SessionRuntimeSnapshotBuilder
SessionContextIndexBuilder
ContextRef
ContextRelation
DecisionContractValidator
ExecutionPlanCompiler
TaskEnvelopeBuilder
ToolResult
agent_run_steps
tool_start / tool_end
AgentResult.operations
WorkContextProjection 初版
```

这些属于：

```txt
事实整理
引用索引
合法性校验
计划编译
任务封装
工具事实
运行账本
状态投影
```

它们必须稳定、可复现、可审计。

---

## 4. MainDecision LLM 的输入从哪里来？

LLM 不是自己知道系统里的 WorkContext、Agent、Ref。

这些动态内容必须由代码在调用 LLM 前准备好。

完整链路：

```txt
ChatRequestInput
  ↓
SessionRuntimeSnapshotBuilder
  - 查 session
  - 查 session 下 workContexts
  - 查 recent runs with steps
  - 查 recent artifacts
  - 查 available agents
  ↓
SessionContextIndexBuilder
  - 把 workContexts / runs / steps / artifacts / files / agents 转成 refs
  - 建立 relations
  ↓
MainAgent.decideWithSessionIndex()
  - 把 userMessage + workContexts + refs + relations + availableAgents 喂给 LLM
  ↓
LLM 输出 MainDecision
  ↓
DecisionContractValidator
  - 校验 LLM 输出 ID 是否都来自输入
```

动态字段来源：

| 字段 | 来源模块 | 数据来源 |
|---|---|---|
| `userMessage` | ChatRequestInput | 用户当前消息 |
| `selectedWorkContextUid` | ChatRequestInput | 前端传入的 `workContextId` |
| `workContexts` | SessionRuntimeSnapshotBuilder | `work_contexts` 表 |
| `refs` | SessionContextIndexBuilder | WorkContext / Run / Step / Artifact / File / Agent |
| `relations` | SessionContextIndexBuilder | 根据 run / step / artifact / tool metadata 生成 |
| `availableAgents` | SessionRuntimeSnapshotBuilder | `agents` / `agent_versions` / 当前可用 Agent |

---

## 5. 给 LLM 的动态 JSON 是什么？

调用主 Agent LLM 时，应传入一个经过裁剪的决策输入 JSON，建议命名为：

```ts
export type MainDecisionInput = {
  userMessage: string;
  selectedWorkContextUid?: string | null;
  workContexts: WorkContextDecisionCard[];
  refs: ContextRef[];
  relations: ContextRelation[];
  availableAgents: AgentDecisionCard[];
};
```

注意：给 LLM 的不是原始数据库 JSON，也不是完整历史，而是结构化、摘要化、裁剪后的决策输入。

---

## 6. MainDecisionInput 示例

用户输入：

```txt
失败了
```

代码构造给 LLM 的输入：

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

---

## 7. 这个 JSON 放在 OpenAI 的哪个参数里？

### 7.1 Chat Completions 风格

动态 JSON 放在 `messages` 参数中的 `user` message 里：

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

职责划分：

```txt
system.content = 决策规则 + 输出格式要求
user.content = 本轮动态 MainDecisionInput JSON
response_format = 要求模型输出 JSON
```

---

### 7.2 Responses API 风格

如果使用 OpenAI Responses API：

```ts
const response = await openai.responses.create({
  model: "gpt-4.1-mini",
  temperature: 0.1,
  input: [
    {
      role: "system",
      content: [
        {
          type: "input_text",
          text: mainDecisionSystemPrompt,
        },
      ],
    },
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: JSON.stringify(mainDecisionInput, null, 2),
        },
      ],
    },
  ],
  text: {
    format: {
      type: "json_object",
    },
  },
});
```

如果 API 支持 JSON Schema，优先使用 `json_schema`：

```ts
const response = await openai.responses.create({
  model: "gpt-4.1-mini",
  temperature: 0.1,
  input: [
    {
      role: "system",
      content: [
        {
          type: "input_text",
          text: mainDecisionSystemPrompt,
        },
      ],
    },
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: JSON.stringify(mainDecisionInput, null, 2),
        },
      ],
    },
  ],
  text: {
    format: {
      type: "json_schema",
      name: "main_decision",
      schema: mainDecisionJsonSchema,
      strict: true,
    },
  },
});
```

---

### 7.3 项目内 ModelClient 建议封装

建议给当前项目的 `ModelClient` 增加一个 `invokeJson` 或类似封装：

```ts
const decision = await modelClient.invokeJson({
  purpose: "main_decision",
  system: mainDecisionSystemPrompt,
  input: mainDecisionInput,
  schema: mainDecisionSchema,
  temperature: 0.1,
});
```

`invokeJson()` 内部负责：

```txt
1. 把 input JSON.stringify 后放进 user message。
2. 开启 json_schema / json_object。
3. 调 OpenAI。
4. 解析 JSON。
5. zod 校验。
6. repair 一次。
7. 仍失败则 fallback 为 ask_user。
```

不要把 `MainDecisionInput` 放进：

```txt
tools
tool_choice
function.arguments
```

它不是工具调用参数，而是主 Agent LLM 的决策输入。

---

## 8. MainDecision 输出格式

MainDecision LLM 必须输出一个纯 JSON 对象，不要 Markdown，不要代码块，不要解释性文字。

统一用 `null` 表示无值，数组为空就 `[]`。建议不要省略字段。

```json
{
  "decisionType": "answer_directly | create_work_context | use_existing_work_context | switch_work_context | delegate | multi_step_plan | ask_user | explain_trace | verify_execution | recover_execution",
  "targetWorkContextUid": "string or null",
  "primaryRefs": ["refId"],
  "secondaryRefs": ["refId"],
  "targetAgentUid": "string or null",
  "plan": {
    "steps": [
      {
        "targetAgentUid": "agentUid",
        "objective": "string",
        "inputRefIds": ["refId"],
        "expectedResultKind": "answer | artifact | file_change | diagnosis | verification",
        "requireVerification": true
      }
    ]
  },
  "response": "string or null",
  "ambiguity": {
    "candidateWorkContextUids": ["workContextUid"],
    "candidateRefIds": ["refId"],
    "question": "string"
  },
  "confidence": "high | medium | low",
  "reasoning": "string"
}
```

实际模型输出示例不应包含 `"string or null"` 这种描述，而应使用真实 JSON 值。

---

## 9. MainDecision Zod Schema

建议新增文件：

```txt
agent-platform-node/src/modules/orchestration/main-decision.schema.ts
```

内容：

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

---

## 10. MainDecision Prompt 要求

System Prompt 必须明确：

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

选择规则：
1. primaryRefs、secondaryRefs、plan.steps[].inputRefIds 必须来自输入 refs[].refId。
2. targetAgentUid、plan.steps[].targetAgentUid 必须来自 availableAgents[].agentUid。
3. targetWorkContextUid 必须来自 workContexts[].workContextUid，除非 decisionType=create_work_context 或 ask_user。
4. 如果用户表达执行失败、报错、没生效、没写入，优先关注 tags/status/evidence 中包含 failed、error、unverified、write_failed 的 refs。
5. 如果用户表达内容不满意、方案不对、设计不行，优先关注 artifact、document、plan、architecture 相关 refs。
6. selectedInUI 只是提示，不是绝对依据。
7. 如果当前 UI 选中的 WorkContext 与其他 refs 的强证据冲突，以证据更强者为准。
8. 如果多个候选都强且无法判断主次，decisionType 必须是 ask_user。
9. 如果 decisionType=answer_directly，必须填写 response。
10. 如果 decisionType=ask_user，必须填写 ambiguity.question。
11. 如果 decisionType=delegate/recover_execution/verify_execution/multi_step_plan，必须填写 plan.steps。
12. reasoning 只写简短内部理由，不要超过 300 字。
```

---

## 11. MainDecision 输出示例

### 11.1 直接回答

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
  "reasoning": "用户询问架构概念，不需要调用子 Agent。"
}
```

---

### 11.2 委派单个子 Agent

```json
{
  "decisionType": "delegate",
  "targetWorkContextUid": "wc_file_test",
  "primaryRefs": [
    "artifact:artifact_readme_content_001",
    "file:README.md"
  ],
  "secondaryRefs": [],
  "targetAgentUid": "filesystem_agent",
  "plan": {
    "steps": [
      {
        "targetAgentUid": "filesystem_agent",
        "objective": "将已生成的 README 内容写入 README.md，并进行回读校验。",
        "inputRefIds": [
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
  "reasoning": "用户要求把已有内容写入文件，最相关 refs 是 pending README 内容和目标文件。"
}
```

---

### 11.3 恢复失败执行

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
        "objective": "基于上次失败的写入步骤，使用已保存的 pending_write 内容重新写入 README.md，并执行回读校验。",
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

---

### 11.4 验证执行结果

```json
{
  "decisionType": "verify_execution",
  "targetWorkContextUid": "wc_file_test",
  "primaryRefs": [
    "file:README.md",
    "step:run_123:8"
  ],
  "secondaryRefs": [],
  "targetAgentUid": "filesystem_agent",
  "plan": {
    "steps": [
      {
        "targetAgentUid": "filesystem_agent",
        "objective": "读取 README.md 并验证上次写入内容是否真实落盘。",
        "inputRefIds": [
          "file:README.md",
          "step:run_123:8"
        ],
        "expectedResultKind": "verification",
        "requireVerification": true
      }
    ]
  },
  "response": null,
  "ambiguity": null,
  "confidence": "high",
  "reasoning": "用户质疑文件是否写入，应该委派 filesystem_agent 做回读验证。"
}
```

---

### 11.5 多步骤计划

```json
{
  "decisionType": "multi_step_plan",
  "targetWorkContextUid": "wc_recovery",
  "primaryRefs": [
    "step:run_1:8",
    "step:run_2:4",
    "step:run_3:5"
  ],
  "secondaryRefs": [],
  "targetAgentUid": null,
  "plan": {
    "steps": [
      {
        "targetAgentUid": "filesystem_agent",
        "objective": "诊断并修复 README.md 写入失败问题。",
        "inputRefIds": [
          "step:run_1:8"
        ],
        "expectedResultKind": "file_change",
        "requireVerification": true
      },
      {
        "targetAgentUid": "artifact_agent",
        "objective": "诊断并修复 artifact 保存失败问题。",
        "inputRefIds": [
          "step:run_2:4"
        ],
        "expectedResultKind": "diagnosis",
        "requireVerification": false
      },
      {
        "targetAgentUid": "browser_agent",
        "objective": "诊断并修复页面内容提取失败问题。",
        "inputRefIds": [
          "step:run_3:5"
        ],
        "expectedResultKind": "diagnosis",
        "requireVerification": false
      }
    ]
  },
  "response": null,
  "ambiguity": null,
  "confidence": "high",
  "reasoning": "用户明确要求处理多个失败问题，因此生成多步骤恢复计划。"
}
```

---

### 11.6 需要澄清

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

---

## 12. 如何保证 LLM 稳定输出？

稳定机制不是只靠 prompt，而是以下组合：

```txt
结构化输入
+ 严格 schema
+ 低温度
+ 只允许引用 refs
+ 代码校验
+ 失败自动修复一次
+ 仍失败则降级 ask_user
```

---

### 12.1 调用参数

建议：

```txt
temperature: 0 或 0.1
top_p: 1
max_tokens: 足够但不要过大
```

MainDecision 是控制面决策，不是创作任务，不要用高温度。

---

### 12.2 统一 JSON 调用函数

建议实现：

```ts
async function callLlmForJson<T>(input: {
  systemPrompt: string;
  userInput: unknown;
  schema: z.ZodSchema<T>;
  modelClient: ModelClient;
  temperature?: number;
  repair?: boolean;
}): Promise<T> {
  // 1. 调 LLM
  // 2. 提取 JSON
  // 3. zod.safeParse
  // 4. 如果失败，repair 一次
  // 5. 仍失败，抛错或 fallback
}
```

---

### 12.3 Repair 最多一次

解析失败时可以让 LLM 修复一次，但不能无限循环。

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

如果修复后仍然失败，降级为：

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

---

## 13. DecisionContractValidator 必须存在

即使 LLM 输出 JSON 合法，也不代表可执行。

必须再做引用校验：

```txt
targetWorkContextUid 是否真实存在
primaryRefs 是否都存在
secondaryRefs 是否都存在
targetAgentUid 是否真实存在
plan.steps[].targetAgentUid 是否真实存在
plan.steps[].inputRefIds 是否真实存在
decisionType 和必填字段是否匹配
```

伪代码：

```ts
function validateDecision(input: {
  decision: MainDecision;
  refs: ContextRef[];
  availableAgents: AgentDecisionCard[];
  workContexts: WorkContextDecisionCard[];
}) {
  const refIds = new Set(input.refs.map(ref => ref.refId));
  const agentUids = new Set(input.availableAgents.map(agent => agent.agentUid));
  const workContextUids = new Set(input.workContexts.map(wc => wc.workContextUid));

  for (const refId of input.decision.primaryRefs) {
    if (!refIds.has(refId)) {
      throw new Error(`Invalid primaryRef: ${refId}`);
    }
  }

  for (const refId of input.decision.secondaryRefs) {
    if (!refIds.has(refId)) {
      throw new Error(`Invalid secondaryRef: ${refId}`);
    }
  }

  for (const step of input.decision.plan?.steps ?? []) {
    if (!agentUids.has(step.targetAgentUid)) {
      throw new Error(`Invalid plan targetAgentUid: ${step.targetAgentUid}`);
    }

    for (const refId of step.inputRefIds) {
      if (!refIds.has(refId)) {
        throw new Error(`Invalid plan inputRefId: ${refId}`);
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

Validator 不判断用户业务语义，只检查它选的对象是否真实存在、结构是否可执行。

---

## 14. 大内容不要放进 MainDecisionInput

给主 Agent LLM 的 JSON 只放：

```txt
title
summary
status
tags
evidence
refId
workContextUid
agentUid
capabilities
```

不要放：

```txt
大文件全文
完整网页内容
超长 artifact content
完整 tool input/output 大对象
完整聊天历史
```

大内容应该通过 ref 引用：

```json
{
  "refId": "artifact:artifact_readme_content_001",
  "kind": "artifact",
  "title": "README.md 待写入内容",
  "summary": "已生成但写入失败的 README 内容，约 1200 字",
  "status": "pending_write",
  "source": {
    "table": "agent_artifacts",
    "uid": "artifact_readme_content_001"
  },
  "tags": ["artifact", "pending_write", "file_content"]
}
```

真正执行时，由 `TaskEnvelopeBuilder` 根据 ref 展开必要内容给子 Agent。

---

## 15. 结论

本重构中 LLM 的固定格式输出应收敛到一处：

```txt
Main LLM Decision Maker → MainDecision JSON
```

其余结构应由代码产生：

```txt
SessionRuntimeSnapshot
SessionContextIndex
ContextRef
ExecutionPlan
TaskEnvelope
ToolResult
AgentResult.operations
WorkContextProjection
```

最重要的稳定链路是：

```txt
代码构造 MainDecisionInput JSON
  ↓
放入 OpenAI messages/input 的 user 内容
  ↓
system prompt 规定决策规则和输出格式
  ↓
OpenAI 输出 MainDecision JSON
  ↓
zod schema 校验
  ↓
DecisionContractValidator 校验 ref/agent/workContext 是否真实存在
  ↓
ExecutionPlanCompiler 编译
  ↓
TaskEnvelopeBuilder 构造子 Agent 输入
```
