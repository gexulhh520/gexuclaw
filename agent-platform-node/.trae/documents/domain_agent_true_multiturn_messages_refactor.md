# 增量整改方案：DomainAgent 历史上下文改成真正多轮 messages

## 0. 背景

上一版已经改成：

```txt
MainAgent：读取多个领域 Agent 描述/skill 摘要，选择一个领域 Agent，生成粗粒度 plan，逐步验收
DomainAgent：负责领域内 skill / tool / artifact / 执行过程
```

当前 `DomainAgent` 的历史上下文是通过 `buildDomainAgentHistoryTurns()` 查询出来，然后拼进当前 `userMessage`：

```txt
## 你的历史任务摘要
### Turn 1
Task from MainAgent:
...

DomainAgent Summary:
...
```

本次整改目标：

```txt
不要再把历史摘要拼进当前 userMessage。
改成把同领域 Agent 的历史 run 转成标准 ChatMessage[]：

[
  { role: "user", content: "上一次 MainAgent 下发的任务..." },
  { role: "assistant", content: "上一次 DomainAgent 执行摘要..." },
  { role: "user", content: "当前 MainAgent 下发的任务..." }
]
```

---

## 1. 最终效果

改完后，DomainAgent 每次执行时传给 LLM 的 messages 应该是：

```ts
[
  { role: "system", content: systemMessage },

  { role: "user", content: "历史任务 1：MainAgent 下发的任务消息" },
  { role: "assistant", content: "历史摘要 1：DomainAgent resultSummary" },

  { role: "user", content: "历史任务 2：MainAgent 下发的任务消息" },
  { role: "assistant", content: "历史摘要 2：DomainAgent resultSummary" },

  { role: "user", content: "当前任务：MainAgent 下发的当前 step task message" }
]
```

其中：

```txt
systemMessage = 领域 Agent 的 systemPrompt + skillText + plugin catalog + tool rules
historyMessages = 同一个 session + 同一个 agentId 的 subagent 历史 run
current user message = 当前 step task message
```

---

## 2. 修改点总览

本次只改四块：

```txt
1. AgentRuntime.run 入参加 historyMessages?: ChatMessage[]
2. AgentRuntime.executeRunLoop 构造 messages 时插入 historyMessages
3. domain-agent-history-builder.ts 从 turns 改成 ChatMessage[]
4. orchestration.service.ts 调 runtime.run 时传入 historyMessages，并删除 stepTaskMessage 里的历史摘要 section
```

---

## 3. 修改 AgentRuntime 输入类型

文件：

```txt
agent-platform-node/src/runtime/agent-runtime.ts
```

给 `RunAgentInput` 增加：

```ts
historyMessages?: ChatMessage[];
```

修改后：

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
    allowedPluginIdsJson: string;
    allowedToolsJson: string;
    contextPolicyJson: string;
    modelParamsOverrideJson: string;
    maxSteps: number;
  };
  userMessage: string;
  historyMessages?: ChatMessage[];
  handoffNote?: string;
  originalUserMessage?: string;
  taskEnvelope?: TaskEnvelope;
  userId?: string;
  sessionId?: string;
  parentRunId?: number;
  mode: "standalone" | "subagent" | "main";
};
```

如果文件里还有 `RunAgentInputExtended`，也同步加：

```ts
historyMessages?: ChatMessage[];
```

---

## 4. 新增 historyMessages 清洗函数

在 `agent-runtime.ts` 中新增：

```ts
function sanitizeHistoryMessages(messages: ChatMessage[] | undefined): ChatMessage[] {
  return (messages ?? [])
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}
```

原因：

```txt
历史 messages 只允许 user / assistant。
不要把旧 tool message、tool_calls、tool_call_id、reasoning_content 带进新一轮。
否则 OpenAI-compatible 消息协议可能因为 tool call 不成对而报错。
```

---

## 5. 修改 AgentRuntime messages 构建

文件：

```txt
agent-platform-node/src/runtime/agent-runtime.ts
```

找到当前逻辑：

```ts
const messages: ChatMessage[] = [
  { role: "system", content: systemMessage },
  { role: "user", content: effectiveUserMessage },
];
```

替换成：

```ts
const historyMessages = sanitizeHistoryMessages(args.input.historyMessages);

const messages: ChatMessage[] = [
  { role: "system", content: systemMessage },
  ...historyMessages,
  { role: "user", content: effectiveUserMessage },
];
```

---

## 6. 重写 domain-agent-history-builder.ts

文件：

```txt
agent-platform-node/src/modules/orchestration/domain-agent-history-builder.ts
```

当前是：

```ts
export type DomainAgentHistoryTurn = {
  taskMessage: string;
  resultSummary: string;
  status: string;
};

export async function buildDomainAgentHistoryTurns(...)
```

改成直接返回 `ChatMessage[]`：

```ts
import { and, desc, eq, isNotNull, ne } from "drizzle-orm";
import { db } from "../../db/client.js";
import { agentRuns } from "../../db/schema.js";
import type { ChatMessage } from "../../runtime/model-client.js";

export async function buildDomainAgentHistoryMessages(input: {
  sessionId: string;
  agentId: number;
  limit?: number;
}): Promise<ChatMessage[]> {
  const limit = input.limit ?? 3;

  const runs = await db
    .select({
      userMessage: agentRuns.userMessage,
      resultSummary: agentRuns.resultSummary,
      status: agentRuns.status,
    })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.sessionId, input.sessionId),
        eq(agentRuns.agentId, input.agentId),
        eq(agentRuns.mode, "subagent"),
        ne(agentRuns.status, "running"),
        isNotNull(agentRuns.resultSummary)
      )
    )
    .orderBy(desc(agentRuns.id))
    .limit(limit);

  return runs.reverse().flatMap((run): ChatMessage[] => {
    const messages: ChatMessage[] = [];

    if (run.userMessage?.trim()) {
      messages.push({
        role: "user",
        content: run.userMessage,
      });
    }

    if (run.resultSummary?.trim()) {
      messages.push({
        role: "assistant",
        content: run.resultSummary,
      });
    }

    return messages;
  });
}
```

注意：

```txt
必须按 agentId 过滤。
不能只按 sessionId + mode=subagent 查，否则不同领域 Agent 的历史会串。
```

---

## 7. 修改 orchestration.service.ts 的 import

文件：

```txt
agent-platform-node/src/modules/orchestration/orchestration.service.ts
```

把：

```ts
import { buildDomainAgentHistoryTurns } from "./domain-agent-history-builder.js";
```

改成：

```ts
import { buildDomainAgentHistoryMessages } from "./domain-agent-history-builder.js";
```

---

## 8. 修改 buildDomainAgentStepTaskMessage 入参

当前 `buildDomainAgentStepTaskMessage()` 里包含：

```ts
historyTurns: Array<{
  taskMessage: string;
  resultSummary: string;
  status: string;
}>;
```

并且模板里有：

```txt
## 你的历史任务摘要
${historyText}
```

本次要删除这些。

### 8.1 修改函数入参

从：

```ts
function buildDomainAgentStepTaskMessage(input: {
  originalUserMessage: string;
  effectiveUserMessage: string;
  selectedAgent: {
    agentUid: string;
    name: string;
  };
  plan: DomainAgentPlan;
  currentStep: DomainPlanStep;
  completedSteps: Array<{
    stepUid: string;
    objective: string;
    summary: string;
    status: string;
  }>;
  historyTurns: Array<{
    taskMessage: string;
    resultSummary: string;
    status: string;
  }>;
}): string
```

改成：

```ts
function buildDomainAgentStepTaskMessage(input: {
  originalUserMessage: string;
  effectiveUserMessage: string;
  selectedAgent: {
    agentUid: string;
    name: string;
  };
  plan: DomainAgentPlan;
  currentStep: DomainPlanStep;
  completedSteps: Array<{
    stepUid: string;
    objective: string;
    summary: string;
    status: string;
  }>;
}): string
```

### 8.2 删除 historyText 构造

删除：

```ts
const historyText = input.historyTurns.length
  ? input.historyTurns
      .map(...)
      .join("\n\n")
  : "暂无历史任务摘要。";
```

### 8.3 删除模板中的历史段

删除：

```txt
## 你的历史任务摘要
${historyText}
```

新的 `stepTaskMessage` 只包含当前任务需要的信息：

```txt
你是当前任务选定的领域执行 Agent：xxx。

## 原始用户消息
...

## 当前有效任务消息
...

## 当前总计划
...

## 已完成步骤摘要
...

## 当前执行步骤
...

## 执行要求
...
```

---

## 9. 修改 executeDomainAgentPlan

文件：

```txt
agent-platform-node/src/modules/orchestration/orchestration.service.ts
```

### 9.1 查询 historyMessages

当前是：

```ts
const historyTurns = await buildDomainAgentHistoryTurns({
  sessionId: input.sessionId,
  agentId: input.selectedAgent.agent.id,
  limit: 3,
});
```

改成：

```ts
const historyMessages = await buildDomainAgentHistoryMessages({
  sessionId: input.sessionId,
  agentId: input.selectedAgent.agent.id,
  limit: 3,
});
```

### 9.2 构造 stepTaskMessage 时不再传 historyTurns

当前：

```ts
const stepTaskMessage = buildDomainAgentStepTaskMessage({
  originalUserMessage: input.originalUserMessage,
  effectiveUserMessage: input.effectiveUserMessage,
  selectedAgent: {
    agentUid: input.selectedAgent.agent.agentUid,
    name: input.selectedAgent.agent.name,
  },
  plan: input.plan,
  currentStep,
  completedSteps,
  historyTurns,
});
```

改成：

```ts
const stepTaskMessage = buildDomainAgentStepTaskMessage({
  originalUserMessage: input.originalUserMessage,
  effectiveUserMessage: input.effectiveUserMessage,
  selectedAgent: {
    agentUid: input.selectedAgent.agent.agentUid,
    name: input.selectedAgent.agent.name,
  },
  plan: input.plan,
  currentStep,
  completedSteps,
});
```

### 9.3 runtime.run 增加 historyMessages

当前：

```ts
const runResult = await runtime.run({
  agentRecord: input.selectedAgent.agent,
  versionRecord: input.selectedAgent.version,
  userMessage: stepTaskMessage,
  sessionId: input.sessionId,
  parentRunId: mainRun.id,
  mode: "subagent",
});
```

改成：

```ts
const runResult = await runtime.run({
  agentRecord: input.selectedAgent.agent,
  versionRecord: input.selectedAgent.version,
  userMessage: stepTaskMessage,
  historyMessages,
  originalUserMessage: undefined,
  taskEnvelope: undefined,
  sessionId: input.sessionId,
  parentRunId: mainRun.id,
  mode: "subagent",
});
```

注意：

```txt
必须显式传 originalUserMessage: undefined
必须显式传 taskEnvelope: undefined
```

原因：

```txt
AgentRuntime 内部会优先使用 originalUserMessage 或 taskEnvelope 渲染结果。
当前我们希望 DomainAgent 当前 user message 就是 stepTaskMessage。
```

---

## 10. retry 分支也要传 historyMessages

如果 `review.decision === "retry_current_step"` 分支里也调用了 `runtime.run()`，同样要传：

```ts
const retryHistoryMessages = await buildDomainAgentHistoryMessages({
  sessionId: input.sessionId,
  agentId: input.selectedAgent.agent.id,
  limit: 3,
});

const retryRun = await runtime.run({
  agentRecord: input.selectedAgent.agent,
  versionRecord: input.selectedAgent.version,
  userMessage: retryTaskMessage,
  historyMessages: retryHistoryMessages,
  originalUserMessage: undefined,
  taskEnvelope: undefined,
  sessionId: input.sessionId,
  parentRunId: mainRun.id,
  mode: "subagent",
});
```

---

## 11. 顺手修复 AgentResult 类型问题

当前代码中可能有类似：

```ts
stepResult = {
  summary: runResult.summary || "执行完成",
  status: runResult.status,
  agentResult: runResult as unknown as AgentResult,
};
```

这个是错的。

`runtime.run()` 返回的是：

```ts
{
  runId,
  runUid,
  status,
  summary,
  stepsCount,
  agentResult
}
```

真正的 `AgentResult` 在：

```ts
runResult.agentResult
```

所以要改成：

```ts
stepResult = {
  summary: runResult.summary || "执行完成",
  status: runResult.status,
  agentResult: runResult.agentResult,
};
```

---

## 12. 新的 DomainAgent LLM messages 示例

假设 code_agent 之前执行过一次分析任务，现在要执行修改任务。

最终传给模型的是：

```ts
[
  {
    role: "system",
    content: "code_agent systemPrompt + skillText + plugin catalog + tool rules"
  },
  {
    role: "user",
    content: "MainAgent 下发任务：分析 model-client complete 和 invoke 的调用关系"
  },
  {
    role: "assistant",
    content: "已完成分析，确认 invoke 支持 messages，complete 当前只支持 systemPrompt + userMessage。"
  },
  {
    role: "user",
    content: "MainAgent 下发任务：修改 complete 方法，使其支持 messages 参数，并保持旧调用兼容。"
  }
]
```

这就是 DomainAgent 的真正多轮对话上下文。

---

## 13. 数据库存储语义不变

每一轮 DomainAgent 执行后仍然保存：

```txt
agent_runs.mode = subagent
agent_runs.agentId = 当前领域 Agent id
agent_runs.userMessage = 当前 MainAgent 下发的 stepTaskMessage
agent_runs.resultSummary = 当前 DomainAgent 执行摘要
agent_runs.outputJson = AgentResult
```

下一轮通过：

```ts
buildDomainAgentHistoryMessages({
  sessionId,
  agentId,
  limit: 3,
})
```

转成：

```ts
[
  { role: "user", content: previousRun.userMessage },
  { role: "assistant", content: previousRun.resultSummary }
]
```

---

## 14. 验收标准

改完后需要满足：

```txt
1. TypeScript 编译通过。
2. AgentRuntime.run 支持 historyMessages?: ChatMessage[]。
3. AgentRuntime.executeRunLoop 构建 messages 时包含：
   system + historyMessages + current user。
4. historyMessages 只包含 user / assistant，不包含 tool。
5. domain-agent-history-builder.ts 输出 ChatMessage[]。
6. orchestration.service.ts 不再使用 buildDomainAgentHistoryTurns。
7. buildDomainAgentStepTaskMessage 不再包含“你的历史任务摘要” section。
8. executeDomainAgentPlan 调 runtime.run 时传入 historyMessages。
9. retry 分支也传入 historyMessages。
10. subagent run 的 userMessage 仍然保存当前 stepTaskMessage。
11. subagent run 的 resultSummary 仍然保存当前执行摘要。
12. 不同领域 Agent 的历史不会串，因为查询按 agentId 过滤。
```

---

## 15. 最终一句话

```txt
MainAgent 下发的历史任务消息 + DomainAgent 历史执行摘要，
不再拼进当前 user prompt，
而是作为标准 user/assistant messages 注入 DomainAgent 的 LLM 上下文。
```
