# Agent 编排架构整改方案：主 Agent 领域路由 + 单领域 Agent 自治执行

## 0. 最终架构定位

本次架构不再采用“一个万能子 Agent”模式，也不回到旧的“多 Agent 细粒度资源交接”模式。

最终采用：

```txt
MainAgent：领域路由 + 粗粒度计划 + 步骤验收 + 最终汇总
DomainAgent：领域自治执行者，负责某个领域内的技能、工具、上下文、产物和任务完成判断
AgentRuntime：负责 DomainAgent 内部的 LLM + tool calling run loop
```

也就是说：

```txt
用户消息
  ↓
MainAgent 读取多个 DomainAgent 的描述 / capabilities / skill 摘要
  ↓
MainAgent 选择一个最合适的 DomainAgent
  ↓
MainAgent 围绕这个 DomainAgent 生成粗粒度 plan
  ↓
每个 plan step 都交给同一个 DomainAgent 执行
  ↓
DomainAgent 自己加载领域 skill / tools / 历史摘要 / 产物目录
  ↓
DomainAgent 执行并汇报摘要
  ↓
MainAgent 根据摘要验收 step
  ↓
所有 step 完成后 MainAgent 汇总给用户
```

核心原则：

```txt
一次任务只选一个领域 Agent。
领域 Agent 内部自治。
主 Agent 不负责资源交接细节。
```

---

## 1. 为什么需要多个领域子 Agent

不能把所有行业技能都塞给一个子 Agent，否则会导致：

```txt
1. skillText 太大
2. tool 列表太大
3. prompt 复杂度过高
4. 领域边界混乱
5. 子 Agent 判断任务完成标准困难
6. 后续维护成本高
```

所以需要多个领域 Agent。

示例：

```txt
code_agent:
  负责代码阅读、修改、调试、测试、Git、依赖诊断

doc_agent:
  负责文档读取、重写、排版、导出、格式校验

browser_agent:
  负责网页打开、搜索、点击、截图、页面内容提取

content_agent:
  负责公众号、小红书、知乎、头条等内容创作和改写

video_agent:
  负责视频转图文、字幕、切片、素材提取

design_agent:
  负责图片生成提示词、宣传图设计、主图设计、海报结构
```

MainAgent 只需要知道这些领域 Agent 的摘要，不需要知道它们每个工具的细节。

---

## 2. MainAgent 职责

MainAgent 负责：

```txt
1. 读取用户和 MainAgent 的历史对话
2. 读取当前会话可用 DomainAgent 的描述、能力、skill 摘要
3. 判断用户任务属于哪个领域
4. 选择一个 DomainAgent
5. 判断是否可以直接回复用户
6. 判断是否需要询问用户
7. 如果需要执行，则基于选中的 DomainAgent 生成粗粒度 plan
8. 将每个 plan step 下发给同一个 DomainAgent
9. 根据 DomainAgent 的摘要验收 step
10. 决定继续下一步、重试、重规划、询问用户或失败
11. 所有步骤完成后汇总最终回复用户
```

MainAgent 不负责：

```txt
1. 不读取完整 refs / relations
2. 不读取 agent_run_steps 全量
3. 不读取 artifact 内容
4. 不处理具体工具调用
5. 不处理资源真实路径
6. 不做跨 Agent 资源交接
7. 不让多个 Agent 共享复杂上下文
```

---

## 3. DomainAgent 职责

DomainAgent 是领域自治执行者。

DomainAgent 负责：

```txt
1. 理解 MainAgent 下发的 step task message
2. 根据领域动态加载自己的 skill
3. 根据领域动态加载自己的 tools
4. 查询自己领域内的历史任务摘要
5. 查询自己产生过的产物目录
6. 执行工具调用
7. 保存执行过程
8. 保存产物
9. 生成最终执行摘要
10. 向 MainAgent 汇报本 step 是否完成
```

DomainAgent 的上下文只包含：

```txt
1. MainAgent 下发给它的历史任务消息
2. DomainAgent 每次执行后的 resultSummary
3. 必要时它自己查询自己的领域产物目录
```

默认不包含：

```txt
agent_run_steps 全量
tool result 全量
artifact 内容
refs
relations
其他领域 Agent 的上下文
```

---

## 4. 会话和 Agent 绑定方式

当前后端 `sessions.agentIdsJson` 仍然保持数组结构：

```ts
agentIds: z.array(z.string()).min(1, "至少选择一个智能体")
```

不要加 `.max(1)`。

原因：

```txt
前端可以先控制用户选择多个可用领域 Agent，或者当前阶段只展示一个默认集合；
后端保留多 Agent 口子；
MainAgent 从 agentIdsJson 里读取候选 DomainAgent 列表；
本次任务只从候选列表中选定一个 DomainAgent 执行。
```

如果当前产品阶段前端只允许选一个，也没问题：

```txt
agentIdsJson = ["code_agent"]
```

如果后面前端允许选多个，也可以：

```txt
agentIdsJson = ["code_agent", "doc_agent", "browser_agent"]
```

但是一次任务仍然只选一个：

```txt
selectedDomainAgentUid = "code_agent"
```

---

## 5. MainAgent 的输入上下文

MainAgent LLM 输入应该是轻量的。

### 5.1 System Prompt

包含：

```txt
1. MainAgent 角色：领域路由、粗粒度计划、验收、汇总
2. 可用 DomainAgent 列表
3. 每个 DomainAgent 的 description / capabilities / skillSummary
4. 输出 JSON schema
5. 禁止读取 refs / relations / artifact 内容
6. 如果执行，只能选择一个 DomainAgent
```

### 5.2 Messages

使用 `buildMainChatHistoryMessages()`：

```txt
mode = main
status in ("success", "failed")
resultSummary is not null
```

转换成：

```txt
user: 历史用户消息
assistant: MainAgent 最终回复
```

### 5.3 Current User Input

当前轮只传：

```json
{
  "userMessage": "用户本轮原始消息",
  "effectiveUserMessage": "继续/重试恢复后的有效任务消息",
  "sessionState": {
    "currentStage": "...",
    "recoverable": true,
    "lastMainSummary": "...",
    "lastSelectedAgentUid": "...",
    "lastSubAgentSummary": "..."
  }
}
```

不要传：

```txt
refs
relations
agent_run_steps
artifact content
tool results
```

---

## 6. MainAgent 输出：MainPlanningDecision

新增文件：

```txt
agent-platform-node/src/modules/orchestration/domain-agent-planning.schema.ts
```

建议 schema：

```ts
import { z } from "zod";

export const domainPlanStepSchema = z.object({
  stepUid: z.string(),
  objective: z.string(),
  expectedResult: z.enum([
    "answer",
    "artifact",
    "file_change",
    "diagnosis",
    "verification",
  ]),
  doneCriteria: z.string(),
  requireReview: z.boolean().default(true),
});

export const domainAgentPlanSchema = z.object({
  planUid: z.string(),
  selectedAgentUid: z.string(),
  objective: z.string(),
  steps: z.array(domainPlanStepSchema).min(1).max(6),
});

export const mainPlanningDecisionSchema = z.object({
  decisionType: z.enum(["answer_directly", "ask_user", "execute_plan"]),
  selectedAgentUid: z.string().nullable(),
  response: z.string().nullable(),
  question: z.string().nullable(),
  plan: domainAgentPlanSchema.nullable(),
  confidence: z.enum(["high", "medium", "low"]),
  reasoning: z.string(),
});

export type DomainAgentPlan = z.infer<typeof domainAgentPlanSchema>;
export type DomainPlanStep = z.infer<typeof domainPlanStepSchema>;
export type MainPlanningDecision = z.infer<typeof mainPlanningDecisionSchema>;
```

规则：

```txt
1. answer_directly:
   - response 必须有值
   - selectedAgentUid = null
   - plan = null

2. ask_user:
   - question 必须有值
   - selectedAgentUid 可以为 null
   - plan = null

3. execute_plan:
   - selectedAgentUid 必须来自候选 DomainAgent 列表
   - plan.selectedAgentUid 必须等于 selectedAgentUid
   - plan.steps 只能是粗粒度业务步骤
   - plan.steps 不允许出现具体工具调用细节
```

---

## 7. MainAgent 方法设计

重写 `agent-platform-node/src/modules/orchestration/main-agent.ts`，移除旧的多 Agent 编排方法。

### 7.1 删除旧方法

删除：

```txt
decideWithSessionIndex
getMainDecisionJsonContract
repairMainDecision
decideFirstStep
decideSecondStep
decideFollowUp
buildDelegateEnvelope
reviewStepOutcome
```

### 7.2 新增方法一：planWithDomainAgents

```ts
async planWithDomainAgents(input: {
  userMessage: string;
  effectiveUserMessage: string;
  mainHistoryMessages: ChatMessage[];
  candidateAgents: Array<{
    agentUid: string;
    name: string;
    description: string;
    capabilities: string[];
    skillSummary: string;
  }>;
  sessionState: {
    currentStage?: string;
    recoverable?: boolean;
    lastMainSummary?: string;
    lastSelectedAgentUid?: string;
    lastSubAgentSummary?: string;
  };
}): Promise<MainPlanningDecision>
```

职责：

```txt
1. 判断用户任务是否需要执行
2. 如果执行，选择一个 DomainAgent
3. 基于选中的 DomainAgent 生成粗粒度 plan
```

---

### 7.3 新增方法二：reviewDomainStep

新增文件：

```txt
agent-platform-node/src/modules/orchestration/domain-step-review.schema.ts
```

schema：

```ts
import { z } from "zod";

export const domainStepReviewSchema = z.object({
  decision: z.enum([
    "step_done",
    "continue_next_step",
    "retry_current_step",
    "replan_remaining",
    "ask_user",
    "fail",
  ]),
  reason: z.string(),
  retryInstruction: z.string().nullable(),
  replanInstruction: z.string().nullable(),
  userQuestion: z.string().nullable(),
});

export type DomainStepReview = z.infer<typeof domainStepReviewSchema>;
```

MainAgent 方法：

```ts
async reviewDomainStep(input: {
  originalUserMessage: string;
  selectedAgent: {
    agentUid: string;
    name: string;
    skillSummary: string;
  };
  plan: DomainAgentPlan;
  currentStep: DomainPlanStep;
  completedSteps: Array<{
    stepUid: string;
    objective: string;
    summary: string;
    status: string;
  }>;
  subAgentReport: {
    status: AgentResult["status"];
    summary: string;
    producedArtifacts: AgentResult["producedArtifacts"];
    touchedResources: AgentResult["touchedResources"];
    openIssues: AgentResult["openIssues"];
    retryAdvice?: AgentResult["retryAdvice"];
  };
}): Promise<DomainStepReview>
```

输入只允许摘要级信息。

---

### 7.4 新增方法三：summarizeDomainPlanResult

```ts
async summarizeDomainPlanResult(input: {
  originalUserMessage: string;
  selectedAgent: {
    agentUid: string;
    name: string;
  };
  plan: DomainAgentPlan;
  completedSteps: Array<{
    stepUid: string;
    objective: string;
    summary: string;
    status: string;
  }>;
}): Promise<string>
```

输出最终给用户看的回复。

---

## 8. 子 Agent 历史上下文 Builder

新增文件：

```txt
agent-platform-node/src/modules/orchestration/domain-agent-history-builder.ts
```

内容：

```ts
import { and, desc, eq, isNotNull, ne } from "drizzle-orm";
import { db } from "../../db/client.js";
import { agentRuns } from "../../db/schema.js";

export type DomainAgentHistoryTurn = {
  taskMessage: string;
  resultSummary: string;
  status: string;
};

export async function buildDomainAgentHistoryTurns(input: {
  sessionId: string;
  agentId: number;
  limit?: number;
}): Promise<DomainAgentHistoryTurn[]> {
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

  return runs.reverse().map((run) => ({
    taskMessage: run.userMessage,
    resultSummary: run.resultSummary ?? "",
    status: run.status,
  }));
}
```

注意：这里按 `agentId` 过滤，避免 code_agent 读到 doc_agent 的历史摘要。

---

## 9. 构建 DomainAgent Step Task Message

新增函数：

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
}): string {
  const planText = input.plan.steps
    .map((step, index) => {
      return `${index + 1}. ${step.stepUid}: ${step.objective}
   完成标准: ${step.doneCriteria}`;
    })
    .join("\n");

  const completedText = input.completedSteps.length
    ? input.completedSteps
        .map((step) => `- ${step.stepUid}: ${step.summary}`)
        .join("\n")
    : "暂无。";

  const historyText = input.historyTurns.length
    ? input.historyTurns
        .map((turn, index) => {
          return `### Turn ${index + 1}
Task from MainAgent:
${turn.taskMessage}

${input.selectedAgent.name} Summary:
${turn.resultSummary}

Status:
${turn.status}`;
        })
        .join("\n\n")
    : "暂无历史任务摘要。";

  return `你是当前任务选定的领域执行 Agent：${input.selectedAgent.name}。

## 原始用户消息
${input.originalUserMessage}

## 当前有效任务消息
${input.effectiveUserMessage}

## 当前总计划
${input.plan.objective}

${planText}

## 已完成步骤摘要
${completedText}

## 当前执行步骤
stepUid: ${input.currentStep.stepUid}
objective: ${input.currentStep.objective}
expectedResult: ${input.currentStep.expectedResult}
doneCriteria: ${input.currentStep.doneCriteria}

## 你的历史任务摘要
${historyText}

## 执行要求
- 只执行当前步骤，不要擅自扩展到其他步骤。
- 你自己判断需要加载哪些技能和工具。
- 你自己管理执行过程、产物和结果。
- 不要依赖 MainAgent 提供 refs / relations。
- 如果需要引用历史产物，你自己通过领域内工具或产物目录查询。
- 执行结束后给出简洁摘要，说明是否完成、产物是什么、是否需要用户补充信息。`;
}
```

---

## 10. orchestration.service.ts 改造

### 10.1 删除旧 import

删除旧编排相关 import：

```ts
import { SessionRuntimeSnapshotBuilder } from "./session-runtime-snapshot-builder.js";
import { SessionContextIndexBuilder } from "./session-context-index-builder.js";
import { DecisionContractValidator } from "./decision-contract-validator.js";
import { ExecutionPlanCompiler } from "./execution-plan-compiler.js";
import { TaskEnvelopeBuilder } from "./task-envelope-builder.js";
import { renderTaskEnvelopeForAgent } from "./task-envelope-renderer.js";
import { evaluateStepResult } from "./step-result-evaluator.js";
import {
  createStepRetryState,
  recordRetryAttempt,
  MAX_STEP_RETRIES,
  MAX_TOTAL_REPAIRS,
  type StepRetryState,
} from "./step-repair-policy.js";
import { buildRetryTaskEnvelope } from "./retry-task-envelope.js";
```

删除旧实例：

```ts
const snapshotBuilder = new SessionRuntimeSnapshotBuilder();
const contextIndexBuilder = new SessionContextIndexBuilder();
const decisionValidator = new DecisionContractValidator();
const planCompiler = new ExecutionPlanCompiler();
const taskEnvelopeBuilder = new TaskEnvelopeBuilder();
```

---

### 10.2 新增 getCandidateDomainAgents

```ts
async function getCandidateDomainAgents(sessionId: string) {
  const [session] = await db
    .select({ agentIdsJson: sessions.agentIdsJson })
    .from(sessions)
    .where(eq(sessions.sessionUid, sessionId))
    .limit(1);

  if (!session) {
    throw notFound("Session not found", { sessionId });
  }

  const agentUids = jsonParse<string[]>(session.agentIdsJson, []);

  if (agentUids.length < 1) {
    throw new Error("当前会话没有绑定任何领域 Agent");
  }

  const result = [];

  for (const agentUid of agentUids) {
    const { agent, version } = await getCurrentAgentVersion(agentUid);

    result.push({
      agent,
      version,
      summary: buildDomainAgentSummary({ agent, version }),
    });
  }

  return result;
}
```

---

### 10.3 新增 buildDomainAgentSummary

```ts
function buildDomainAgentSummary(input: {
  agent: typeof agents.$inferSelect;
  version: typeof agentVersions.$inferSelect;
}) {
  const capabilities = jsonParse<string[]>(input.agent.capabilitiesJson, []);

  return {
    agentUid: input.agent.agentUid,
    name: input.agent.name,
    description: input.agent.description || "",
    capabilities,
    skillSummary: summarizeSkillText(input.version.skillText),
  };
}

function summarizeSkillText(skillText: string | null | undefined): string {
  if (!skillText) return "";

  // 第一版直接截断即可，后续可以改成离线摘要字段。
  return skillText.length > 800 ? skillText.slice(0, 800) + "..." : skillText;
}
```

---

## 11. 重写 processChatAsync

替换旧的 `processChatAsync()`。

核心结构：

```ts
async function processChatAsync(input: ChatRequestInput, mainRunId: string): Promise<void> {
  const { sessionId, message } = input;
  let effectiveUserMessage = message;

  try {
    console.log("[processChatAsync] Domain-agent orchestration flow...");

    effectiveUserMessage = await resolveEffectiveUserMessage({
      sessionId,
      message,
    });

    await markSessionPlanning({
      sessionId,
      runUid: mainRunId,
      effectiveUserMessage,
    });

    const candidateAgents = await getCandidateDomainAgents(sessionId);

    const mainHistoryMessages = await buildMainChatHistoryMessages({
      sessionId,
      limit: 6,
    });

    const planningDecision = await mainAgent.planWithDomainAgents({
      userMessage: message,
      effectiveUserMessage,
      mainHistoryMessages,
      candidateAgents: candidateAgents.map((item) => item.summary),
      sessionState: await buildLightSessionState(sessionId),
    });

    if (planningDecision.decisionType === "answer_directly") {
      const response = planningDecision.response || "我已收到。";

      await updateMainAgentRun(mainRunId, response, "success");

      await markSessionCompleted({
        sessionId,
        runUid: mainRunId,
        effectiveUserMessage,
        summary: response,
      });

      return;
    }

    if (planningDecision.decisionType === "ask_user") {
      const question = planningDecision.question || "请补充更多信息。";

      await updateMainAgentRun(mainRunId, question, "success");

      return;
    }

    if (planningDecision.decisionType !== "execute_plan") {
      throw new Error(`Unsupported decisionType: ${planningDecision.decisionType}`);
    }

    if (!planningDecision.selectedAgentUid || !planningDecision.plan) {
      throw new Error("MainAgent returned execute_plan without selectedAgentUid or plan");
    }

    const selected = candidateAgents.find(
      (item) => item.agent.agentUid === planningDecision.selectedAgentUid
    );

    if (!selected) {
      throw new Error(`Selected agent not found in session candidates: ${planningDecision.selectedAgentUid}`);
    }

    const finalMessage = await executeDomainAgentPlan({
      sessionId,
      mainRunId,
      originalUserMessage: message,
      effectiveUserMessage,
      selectedAgent: selected,
      plan: planningDecision.plan,
    });

    await updateMainAgentRun(mainRunId, finalMessage, "success");

    await markSessionCompleted({
      sessionId,
      runUid: mainRunId,
      effectiveUserMessage,
      summary: finalMessage,
    });

    await patchSessionMetadata(sessionId, {
      lastSelectedAgentUid: selected.agent.agentUid,
      lastSelectedAgentName: selected.agent.name,
    });
  } catch (error) {
    console.error("[processChatAsync] Domain-agent flow error:", error);

    await markSessionBlocked({
      sessionId,
      runUid: mainRunId,
      effectiveUserMessage,
      error,
    });

    await updateMainAgentRun(
      mainRunId,
      `执行失败：${error instanceof Error ? error.message : "未知错误"}。`,
      "failed"
    );
  }
}
```

---

## 12. 新增 executeDomainAgentPlan

```ts
async function executeDomainAgentPlan(input: {
  sessionId: string;
  mainRunId: string;
  originalUserMessage: string;
  effectiveUserMessage: string;
  selectedAgent: {
    agent: typeof agents.$inferSelect;
    version: typeof agentVersions.$inferSelect;
    summary: {
      agentUid: string;
      name: string;
      description: string;
      capabilities: string[];
      skillSummary: string;
    };
  };
  plan: DomainAgentPlan;
}): Promise<string> {
  const [mainRun] = await db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(eq(agentRuns.runUid, input.mainRunId))
    .limit(1);

  if (!mainRun) {
    throw new Error(`Main run not found: ${input.mainRunId}`);
  }

  const completedSteps: Array<{
    stepUid: string;
    objective: string;
    summary: string;
    status: string;
  }> = [];

  for (const step of input.plan.steps) {
    const historyTurns = await buildDomainAgentHistoryTurns({
      sessionId: input.sessionId,
      agentId: input.selectedAgent.agent.id,
      limit: 3,
    });

    const taskMessage = buildDomainAgentStepTaskMessage({
      originalUserMessage: input.originalUserMessage,
      effectiveUserMessage: input.effectiveUserMessage,
      selectedAgent: {
        agentUid: input.selectedAgent.agent.agentUid,
        name: input.selectedAgent.agent.name,
      },
      plan: input.plan,
      currentStep: step,
      completedSteps,
      historyTurns,
    });

    const subRun = await runtime.run({
      agentRecord: input.selectedAgent.agent,
      versionRecord: input.selectedAgent.version,
      userMessage: taskMessage,
      originalUserMessage: undefined,
      taskEnvelope: undefined,
      sessionId: input.sessionId,
      parentRunId: mainRun.id,
      mode: "subagent",
    });

    const agentResult = subRun.agentResult;

    const review = await mainAgent.reviewDomainStep({
      originalUserMessage: input.originalUserMessage,
      selectedAgent: {
        agentUid: input.selectedAgent.agent.agentUid,
        name: input.selectedAgent.agent.name,
        skillSummary: input.selectedAgent.summary.skillSummary,
      },
      plan: input.plan,
      currentStep: step,
      completedSteps,
      subAgentReport: {
        status: agentResult.status,
        summary: agentResult.summary,
        producedArtifacts: agentResult.producedArtifacts,
        touchedResources: agentResult.touchedResources,
        openIssues: agentResult.openIssues,
        retryAdvice: agentResult.retryAdvice,
      },
    });

    if (
      review.decision === "step_done" ||
      review.decision === "continue_next_step"
    ) {
      completedSteps.push({
        stepUid: step.stepUid,
        objective: step.objective,
        summary: agentResult.summary,
        status: agentResult.status,
      });
      continue;
    }

    if (review.decision === "retry_current_step") {
      // 第一版最多重试一次，防止死循环。
      const retryTaskMessage = buildDomainAgentStepTaskMessage({
        originalUserMessage: input.originalUserMessage,
        effectiveUserMessage: input.effectiveUserMessage,
        selectedAgent: {
          agentUid: input.selectedAgent.agent.agentUid,
          name: input.selectedAgent.agent.name,
        },
        plan: input.plan,
        currentStep: {
          ...step,
          objective: `${step.objective}\n\n重试要求：${review.retryInstruction || review.reason}`,
        },
        completedSteps,
        historyTurns,
      });

      const retryRun = await runtime.run({
        agentRecord: input.selectedAgent.agent,
        versionRecord: input.selectedAgent.version,
        userMessage: retryTaskMessage,
        originalUserMessage: undefined,
        taskEnvelope: undefined,
        sessionId: input.sessionId,
        parentRunId: mainRun.id,
        mode: "subagent",
      });

      completedSteps.push({
        stepUid: step.stepUid,
        objective: step.objective,
        summary: retryRun.agentResult.summary,
        status: retryRun.agentResult.status,
      });

      continue;
    }

    if (review.decision === "ask_user") {
      return review.userQuestion || "需要你确认下一步操作。";
    }

    if (review.decision === "replan_remaining") {
      // 第一版可以先不自动重规划，直接返回说明。
      // 后续再实现 mainAgent.replanRemainingWithSameDomainAgent。
      return `当前任务需要重新规划：${review.replanInstruction || review.reason}`;
    }

    if (review.decision === "fail") {
      return `任务执行失败：${review.reason}`;
    }
  }

  return mainAgent.summarizeDomainPlanResult({
    originalUserMessage: input.originalUserMessage,
    selectedAgent: {
      agentUid: input.selectedAgent.agent.agentUid,
      name: input.selectedAgent.agent.name,
    },
    plan: input.plan,
    completedSteps,
  });
}
```

---

## 13. MainAgent 验收逻辑

`reviewDomainStep` 的判断规则：

```txt
1. subAgentReport.status = success 且 summary 满足 doneCriteria
   -> step_done

2. subAgentReport.status = partial_success，但问题不影响后续步骤
   -> continue_next_step

3. subAgentReport.status = failed，且 retryAdvice.retryable = true
   -> retry_current_step

4. subAgentReport.status = needs_clarification
   -> ask_user

5. 当前步骤结果明显不满足 doneCriteria
   - 如果可以重试 -> retry_current_step
   - 如果需要用户信息 -> ask_user
   - 如果计划需要调整 -> replan_remaining
   - 否则 -> fail
```

---

## 14. 需要删除的旧文件

编译通过后，可以物理删除：

```txt
decision-contract-validator.ts
execution-plan-compiler.ts
session-context-index-builder.ts
task-envelope-builder.ts
task-envelope-renderer.ts
retry-task-envelope.ts
step-repair-policy.ts
step-result-evaluator.ts
step-outcome-review.schema.ts
```

如果暂时担心影响，可以先不删除文件，但必须确保：

```txt
orchestration.service.ts 不再 import 它们；
主流程不再调用它们；
main-agent.ts 不再使用旧 schema。
```

---

## 15. 最终数据流

### 15.1 Main run

```txt
mode = main
userMessage = 用户原始消息
resultSummary = MainAgent 最终回复用户的内容
```

### 15.2 Subagent run

```txt
mode = subagent
agentId = 被选中的领域 Agent
userMessage = MainAgent 下发给该领域 Agent 的 step task message
resultSummary = 领域 Agent 执行摘要
steps = 领域 Agent 自己的工具过程
artifacts = 领域 Agent 自己产生的产物
```

### 15.3 MainAgent 历史上下文

```txt
只取 mode=main 的 userMessage/resultSummary
```

### 15.4 DomainAgent 历史上下文

```txt
只取同一个 agentId + mode=subagent 的 userMessage/resultSummary
```

---

## 16. 最终一句话

```txt
MainAgent 负责选择领域 Agent、生成粗粒度计划、验收步骤、汇总结果；
DomainAgent 负责领域内上下文、技能、工具、产物和执行细节；
一次任务只选一个 DomainAgent，避免跨 Agent 资源交接和上下文共享复杂化。
```
