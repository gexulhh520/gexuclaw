import { desc, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { agents, agentRuns, sessions, agentVersions } from "../../db/schema.js";
import { notFound } from "../../shared/errors.js";
import { makeUid } from "../../shared/ids.js";
import { jsonParse, jsonStringify } from "../../shared/json.js";
import { nowIso } from "../../shared/time.js";
import { getCurrentAgentVersion } from "../agents/agent.service.js";
import { AgentRuntime } from "../../runtime/agent-runtime.js";
import { MainAgent, type CandidateDomainAgent } from "./main-agent.js";
import { runEventBus } from "../../shared/event-bus.js";
import { pluginRegistry } from "../plugins/plugin-registry-instance.js";
import { buildMainChatHistoryMessages } from "./main-chat-history-builder.js";
import { buildDomainAgentHistoryTurns } from "./domain-agent-history-builder.js";
import type {
  DomainAgentPlan,
  DomainPlanStep,
} from "./domain-agent-planning.schema.js";
import type { ChatRequestInput, ChatResponse } from "./orchestration.schema.js";
import type { AgentResult } from "../../runtime/agent-result.js";

const runtime = new AgentRuntime({ pluginRegistry });
const mainAgent = new MainAgent();

// 最大步骤重试次数
const MAX_STEP_RETRIES = 3;

// 判断是否是继续/重试类消息
function isContinuationMessage(message: string): boolean {
  const text = message.trim();
  return /^(继续|继续执行|接着|接着执行|重试|再试一次|重新试试|再来一次|刚才那个|上次那个|继续刚才|继续上次|恢复执行)$/.test(text);
}

// 获取 Session metadata
async function getSessionMetadata(sessionId: string) {
  const [session] = await db
    .select({ metadataJson: sessions.metadataJson })
    .from(sessions)
    .where(eq(sessions.sessionUid, sessionId))
    .limit(1);

  return jsonParse<Record<string, any>>(session?.metadataJson, {});
}

// 更新 Session metadata
async function patchSessionMetadata(
  sessionId: string,
  patch: Record<string, unknown>
) {
  const [session] = await db
    .select({ metadataJson: sessions.metadataJson })
    .from(sessions)
    .where(eq(sessions.sessionUid, sessionId))
    .limit(1);

  const metadata = jsonParse<Record<string, unknown>>(session?.metadataJson, {});
  const next = {
    ...metadata,
    ...patch,
  };

  await db
    .update(sessions)
    .set({
      metadataJson: jsonStringify(next),
      updatedAt: nowIso(),
    })
    .where(eq(sessions.sessionUid, sessionId));

  return next;
}

// 查找最近可恢复的 run
async function findLatestRecoverableRun(sessionId: string) {
  const metadata = await getSessionMetadata(sessionId);

  if (metadata.lastRecoverableRunUid) {
    const [run] = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.runUid, String(metadata.lastRecoverableRunUid)))
      .limit(1);

    if (run) return run;
  }

  const runs = await db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.sessionId, sessionId))
    .orderBy(desc(agentRuns.id))
    .limit(20);

  return runs.find((run) => run.status === "failed" && !!run.userMessage);
}

// 解析有效用户消息（处理继续/重试场景）
async function resolveEffectiveUserMessage(input: {
  sessionId: string;
  message: string;
}) {
  if (!isContinuationMessage(input.message)) {
    return input.message;
  }

  const metadata = await getSessionMetadata(input.sessionId);

  if (
    typeof metadata.lastEffectiveUserMessage === "string" &&
    metadata.lastEffectiveUserMessage.trim()
  ) {
    return metadata.lastEffectiveUserMessage;
  }

  const latestRecoverableRun = await findLatestRecoverableRun(input.sessionId);

  return latestRecoverableRun?.userMessage || input.message;
}

// 标记 Session 为 planning 状态
async function markSessionPlanning(input: {
  sessionId: string;
  runUid: string;
  effectiveUserMessage: string;
}) {
  const metadata = await getSessionMetadata(input.sessionId);
  const recentRefs = Array.isArray(metadata.recentRefs) ? metadata.recentRefs : [];

  await patchSessionMetadata(input.sessionId, {
    currentStage: "planning",
    recoverable: true,
    lastEffectiveUserMessage: input.effectiveUserMessage,
    lastRecoverableRunUid: input.runUid,
    recentRefs: Array.from(new Set([`run:${input.runUid}`, ...recentRefs])).slice(0, 20),
  });
}

// 标记 Session 为 blocked 状态
async function markSessionBlocked(input: {
  sessionId: string;
  runUid: string;
  effectiveUserMessage: string;
  error: unknown;
}) {
  const metadata = await getSessionMetadata(input.sessionId);
  const recentRefs = Array.isArray(metadata.recentRefs) ? metadata.recentRefs : [];
  const openIssues = Array.isArray(metadata.openIssues) ? metadata.openIssues : [];

  const errorMessage =
    input.error instanceof Error ? input.error.message : String(input.error || "未知错误");

  await patchSessionMetadata(input.sessionId, {
    currentStage: "blocked",
    recoverable: true,
    lastEffectiveUserMessage: input.effectiveUserMessage,
    lastRecoverableRunUid: input.runUid,
    lastFailedRunUid: input.runUid,
    lastError: errorMessage,
    lastErrorAt: nowIso(),
    recentRefs: Array.from(new Set([`run:${input.runUid}`, ...recentRefs])).slice(0, 20),
    openIssues: [
      {
        refId: `run:${input.runUid}`,
        summary: `执行失败：${errorMessage}`,
        severity: "high",
        status: "open",
      },
      ...openIssues,
    ].slice(0, 10),
  });

  await db
    .update(agentRuns)
    .set({
      errorMessage,
      updatedAt: nowIso(),
    })
    .where(eq(agentRuns.runUid, input.runUid));
}

// 标记 Session 为 completed 状态
async function markSessionCompleted(input: {
  sessionId: string;
  runUid: string;
  effectiveUserMessage: string;
  summary: string;
}) {
  const metadata = await getSessionMetadata(input.sessionId);
  const recentRefs = Array.isArray(metadata.recentRefs) ? metadata.recentRefs : [];
  const openIssues = Array.isArray(metadata.openIssues) ? metadata.openIssues : [];

  await patchSessionMetadata(input.sessionId, {
    currentStage: "completed",
    recoverable: false,
    lastEffectiveUserMessage: input.effectiveUserMessage,
    lastSuccessfulRunUid: input.runUid,
    lastRecoverableRunUid: null,
    lastError: null,
    progressSummary: input.summary,
    recentRefs: Array.from(new Set([`run:${input.runUid}`, ...recentRefs])).slice(0, 20),
    openIssues: openIssues.map((issue: any) => ({
      ...issue,
      status: "resolved",
    })),
  });
}

// 构建轻量级会话状态
async function buildLightSessionState(sessionId: string) {
  const metadata = await getSessionMetadata(sessionId);

  return {
    currentStage: metadata.currentStage,
    recoverable: metadata.recoverable,
    lastMainSummary: metadata.progressSummary,
    lastSelectedAgentUid: metadata.lastSelectedAgentUid,
    lastSubAgentSummary: metadata.lastSubAgentSummary,
  };
}

// 获取候选DomainAgent列表
async function getCandidateDomainAgents(sessionId: string): Promise<
  Array<{
    agent: typeof agents.$inferSelect;
    version: typeof agentVersions.$inferSelect;
    summary: CandidateDomainAgent;
  }>
> {
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
    throw new Error("当前会话没有绑定任何领域Agent");
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

// 构建DomainAgent摘要
function buildDomainAgentSummary(input: {
  agent: typeof agents.$inferSelect;
  version: typeof agentVersions.$inferSelect;
}): CandidateDomainAgent {
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

  return skillText.length > 800 ? skillText.slice(0, 800) + "..." : skillText;
}

// 获取或创建主Agent记录
async function getOrCreateMainAgent() {
  const now = nowIso();

  let mainAgent = await db.query.agents.findFirst({
    where: eq(agents.agentUid, "main_agent"),
  });

  if (mainAgent && mainAgent.currentVersionId) {
    return mainAgent;
  }

  if (!mainAgent) {
    [mainAgent] = await db
      .insert(agents)
      .values({
        agentUid: "main_agent",
        name: "AI Assistant",
        description: "负责智能委派和任务编排的主Agent",
        type: "orchestrator",
        status: "active",
        capabilitiesJson: jsonStringify(["orchestration", "delegation", "task_management"]),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
  }

  // 创建初始版本
  const [version] = await db
    .insert(agentVersions)
    .values({
      agentId: mainAgent!.id,
      version: 1,
      modelProfileId: 1,
      systemPrompt: "你是AI Assistant，负责理解用户需求并智能委派给合适的Agent执行。",
      skillText: "任务分析、Agent选择、结果汇总",
      allowedToolsJson: "[]",
      contextPolicyJson: "{}",
      modelParamsOverrideJson: "{}",
      maxSteps: 5,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  // 更新agent的currentVersionId
  await db
    .update(agents)
    .set({ currentVersionId: version.id, updatedAt: now })
    .where(eq(agents.id, mainAgent!.id));

  // 返回更新后的agent
  const [updatedAgent] = await db.select().from(agents).where(eq(agents.id, mainAgent!.id));
  return updatedAgent!;
}

// 创建主Agent的run记录
async function createMainAgentRun(
  sessionId: string,
  userMessage: string,
  resultSummary: string,
  status: string
) {
  const now = nowIso();
  const runUid = makeUid("run");

  const mainAgentRecord = await getOrCreateMainAgent();

  const [run] = await db
    .insert(agentRuns)
    .values({
      runUid,
      agentId: mainAgentRecord.id,
      agentVersionId: mainAgentRecord.currentVersionId!,
      sessionId,
      mode: "main",
      status,
      userMessage,
      resultSummary,
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      finishedAt: status !== "running" ? now : undefined,
    })
    .returning();

  return run;
}

// 更新主Agent的run记录
async function updateMainAgentRun(runUid: string, resultSummary: string, status: string) {
  const now = nowIso();
  await db
    .update(agentRuns)
    .set({
      resultSummary,
      status,
      updatedAt: now,
      finishedAt: status === "success" || status === "failed" ? now : undefined,
    })
    .where(eq(agentRuns.runUid, runUid));

  runEventBus.emitRunStatus(runUid, {
    runId: runUid,
    status,
    resultSummary,
    updatedAt: now,
  });

  console.log(`[MainAgent] Run updated: ${runUid}, status=${status}`);
}

// 构建DomainAgent步骤任务消息
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

  return `你是当前任务选定的领域执行Agent：${input.selectedAgent.name}。

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
- 不要依赖MainAgent提供refs/relations。
- 如果需要引用历史产物，你自己通过领域内工具或产物目录查询。
- 执行结束后给出简洁摘要，说明是否完成、产物是什么、是否需要用户补充信息。`;
}

// 主聊天处理函数
export async function handleChat(input: ChatRequestInput): Promise<ChatResponse> {
  const { sessionId, message } = input;

  console.log(`[handleChat] Looking for session: ${sessionId}`);
  const [session] = await db.select().from(sessions).where(eq(sessions.sessionUid, sessionId));
  if (!session) {
    console.error(`[handleChat] Session not found: ${sessionId}`);
    throw notFound("Session not found", { sessionId });
  }
  console.log(`[handleChat] Session found: ${session.sessionUid}`);

  console.log("[handleChat] Creating main agent run...");
  let run;
  try {
    run = await createMainAgentRun(sessionId, message, "正在分析您的请求...", "running");
    console.log(`[handleChat] Run created: ${run.runUid}`);
  } catch (e) {
    console.error("[handleChat] Failed to create run:", e);
    throw e;
  }

  processChatAsync(input, run.runUid);

  return {
    message: "正在处理您的请求...",
    runId: run.runUid,
    agentId: "main_agent",
  };
}

// 异步处理完整的聊天流程
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

// 执行DomainAgent计划
async function executeDomainAgentPlan(input: {
  sessionId: string;
  mainRunId: string;
  originalUserMessage: string;
  effectiveUserMessage: string;
  selectedAgent: {
    agent: typeof agents.$inferSelect;
    version: typeof agentVersions.$inferSelect;
    summary: CandidateDomainAgent;
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

  const steps = input.plan.steps;

  for (let i = 0; i < steps.length; i++) {
    const currentStep = steps[i];
    console.log(`[executeDomainAgentPlan] Executing step ${i + 1}/${steps.length}: ${currentStep.stepUid}`);

    const historyTurns = await buildDomainAgentHistoryTurns({
      sessionId: input.sessionId,
      agentId: input.selectedAgent.agent.id,
      limit: 3,
    });

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

    let retryCount = 0;
    let stepSuccess = false;
    let stepResult: { summary: string; status: string; agentResult?: AgentResult } | null = null;

    while (retryCount < MAX_STEP_RETRIES && !stepSuccess) {
      try {
        const runResult = await runtime.run({
          agentRecord: input.selectedAgent.agent,
          versionRecord: input.selectedAgent.version,
          userMessage: stepTaskMessage,
          sessionId: input.sessionId,
          parentRunId: mainRun.id,
          mode: "subagent",
        });

        stepResult = {
          summary: runResult.summary || "执行完成",
          status: runResult.status,
          agentResult: runResult as unknown as AgentResult,
        };

        if (runResult.status === "success" || runResult.status === "partial_success") {
          stepSuccess = true;
        } else {
          retryCount++;
          if (retryCount < MAX_STEP_RETRIES) {
            console.log(`[executeDomainAgentPlan] Step ${currentStep.stepUid} failed, retrying (${retryCount}/${MAX_STEP_RETRIES})...`);
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
      } catch (error) {
        retryCount++;
        console.error(`[executeDomainAgentPlan] Step ${currentStep.stepUid} error:`, error);
        if (retryCount >= MAX_STEP_RETRIES) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    if (!stepSuccess || !stepResult) {
      throw new Error(`步骤 ${currentStep.stepUid} 执行失败，已达到最大重试次数`);
    }

    completedSteps.push({
      stepUid: currentStep.stepUid,
      objective: currentStep.objective,
      summary: stepResult.summary,
      status: stepResult.status,
    });

    if (currentStep.requireReview && stepResult.agentResult) {
      const review = await mainAgent.reviewDomainStep({
        originalUserMessage: input.originalUserMessage,
        selectedAgent: {
          agentUid: input.selectedAgent.agent.agentUid,
          name: input.selectedAgent.agent.name,
          skillSummary: input.selectedAgent.summary.skillSummary,
        },
        plan: input.plan,
        currentStep,
        completedSteps,
        subAgentReport: {
          status: stepResult.agentResult.status,
          summary: stepResult.agentResult.summary,
          producedArtifacts: stepResult.agentResult.producedArtifacts || [],
          touchedResources: stepResult.agentResult.touchedResources || [],
          openIssues: stepResult.agentResult.openIssues || [],
          retryAdvice: stepResult.agentResult.retryAdvice,
        },
      });

      console.log(`[executeDomainAgentPlan] Step review decision: ${review.decision}`);

      if (review.decision === "fail") {
        throw new Error(`步骤 ${currentStep.stepUid} 被判定为失败: ${review.reason}`);
      }

      if (review.decision === "ask_user") {
        const question = review.userQuestion || "需要您确认如何继续。";
        await updateMainAgentRun(input.mainRunId, question, "success");
        return question;
      }

      if (review.decision === "retry_current_step" && retryCount < MAX_STEP_RETRIES) {
        i--;
        retryCount++;
        console.log(`[executeDomainAgentPlan] Retrying step ${currentStep.stepUid} as per review`);
        continue;
      }

      if (review.decision === "replan_remaining") {
        console.log(`[executeDomainAgentPlan] Replaining remaining steps: ${review.replanInstruction}`);
      }
    }
  }

  const finalMessage = await mainAgent.summarizeDomainPlanResult({
    originalUserMessage: input.originalUserMessage,
    selectedAgent: {
      agentUid: input.selectedAgent.agent.agentUid,
      name: input.selectedAgent.agent.name,
    },
    plan: input.plan,
    completedSteps,
  });

  return finalMessage;
}
