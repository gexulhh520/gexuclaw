import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { agents, agentRuns, agentArtifacts, agentVersions, modelProfiles, sessions, workContexts } from "../../db/schema.js";
import { notFound } from "../../shared/errors.js";
import { makeUid } from "../../shared/ids.js";
import { jsonParse, jsonStringify } from "../../shared/json.js";
import { nowIso } from "../../shared/time.js";
import { getCurrentAgentVersion } from "../agents/agent.service.js";
import { AgentRuntime } from "../../runtime/agent-runtime.js";
import { ContextBuilder } from "./context-builder.js";
import { MainAgent } from "./main-agent.js";
import { runEventBus } from "../../shared/event-bus.js";
import { updateWorkContextRunBinding } from "../work-contexts/work-context.service.js";
import { updateWorkContextProjection } from "../work-contexts/work-context-projection.service.js";
import { pluginRegistry } from "../plugins/plugin-registry-instance.js";
import { SessionRuntimeSnapshotBuilder } from "./session-runtime-snapshot-builder.js";
import { SessionContextIndexBuilder } from "./session-context-index-builder.js";
import { DecisionContractValidator } from "./decision-contract-validator.js";
import { ExecutionPlanCompiler } from "./execution-plan-compiler.js";
import { TaskEnvelopeBuilder } from "./task-envelope-builder.js";
import { renderTaskEnvelopeForAgent } from "./task-envelope-renderer.js";
import type { ChatRequestInput, ChatResponse, OrchestrationDecision, DelegateEnvelope } from "./orchestration.schema.js";
import type { AgentCapabilitySummary } from "./context-builder.js";
import type { AgentResult } from "../../runtime/agent-result.js";
import { evaluateStepResult } from "./step-result-evaluator.js";
import {
  createStepRetryState,
  recordRetryAttempt,
  MAX_STEP_RETRIES,
  MAX_TOTAL_REPAIRS,
  type StepRetryState,
} from "./step-repair-policy.js";
import { buildRetryTaskEnvelope } from "./retry-task-envelope.js";

const runtime = new AgentRuntime({ pluginRegistry });
const contextBuilder = new ContextBuilder();
const mainAgent = new MainAgent();
const snapshotBuilder = new SessionRuntimeSnapshotBuilder();
const contextIndexBuilder = new SessionContextIndexBuilder();
const decisionValidator = new DecisionContractValidator();
const planCompiler = new ExecutionPlanCompiler();
const taskEnvelopeBuilder = new TaskEnvelopeBuilder();

const ENABLE_LEGACY_FALLBACK = process.env.ENABLE_LEGACY_FALLBACK === "true";

// 最大链式委派深度，防止无限循环
const MAX_DELEGATION_DEPTH = 5;

// 获取可用 Agent 列表
async function getAvailableAgents(): Promise<AgentCapabilitySummary[]> {
  const agents = await db.query.agents.findMany({
    where: (agents, { eq }) => eq(agents.status, "active"),
  });

  return agents.map((agent) => {
    const capabilities = jsonParse<string[]>(agent.capabilitiesJson, []);
    
    // 获取该 Agent 挂载的插件信息
    const attachedPlugins = pluginRegistry.getPluginsForAgent(agent.id);
    const plugins = attachedPlugins.map((p) => ({
      pluginId: p.pluginId,
      name: p.name,
      description: p.description || "",
    }));
    
    return {
      agentId: agent.agentUid,
      name: agent.name,
      description: agent.description || "",
      type: agent.type,
      capabilities,
      plugins: plugins.length > 0 ? plugins : undefined,
    };
  });
}

// 创建新的 WorkContext
async function createWorkContext(sessionId: string, title: string, goal: string) {
  const now = nowIso();
  const [workContext] = await db
    .insert(workContexts)
    .values({
      workContextUid: makeUid("work_context"),
      sessionId,
      title,
      goal,
      status: "active",
      source: "llm_generated",
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
      }),
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return workContext;
}

// 获取或创建主 Agent 记录
async function getOrCreateMainAgent() {
  const now = nowIso();
  
  // 查找已有的 main_agent
  let mainAgent = await db.query.agents.findFirst({
    where: eq(agents.agentUid, "main_agent"),
  });
  
  if (mainAgent) {
    console.log(`[MainAgent] Found existing main_agent: ${mainAgent.id}, currentVersionId: ${mainAgent.currentVersionId}`);
    
    // 如果存在但没有 currentVersionId，需要创建版本
    if (!mainAgent.currentVersionId) {
      console.log("[MainAgent] Existing agent has no version, creating one...");
      
      // 先查找一个可用的 model profile
      const [defaultProfile] = await db.select().from(modelProfiles).limit(1);
      
      // 创建初始版本
      const [version] = await db
        .insert(agentVersions)
        .values({
          agentId: mainAgent.id,
          version: 1,
          modelProfileId: defaultProfile?.id || 1,
          systemPrompt: "你是 AI Assistant，负责理解用户需求并智能委派给合适的 Agent 执行。",
          skillText: "任务分析、Agent 选择、结果汇总",
          allowedToolsJson: "[]",
          contextPolicyJson: "{}",
          modelParamsOverrideJson: "{}",
          maxSteps: 5,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      
      console.log(`[MainAgent] Created version ${version.version} for existing agent`);
      
      // 更新 agent 的 currentVersionId
      await db
        .update(agents)
        .set({ currentVersionId: version.id, updatedAt: now })
        .where(eq(agents.id, mainAgent.id));
      
      // 返回更新后的 agent
      const [updatedAgent] = await db.select().from(agents).where(eq(agents.id, mainAgent.id));
      return updatedAgent!;
    }
    
    return mainAgent;
  }
  
  // 创建 main_agent
  console.log("[MainAgent] Creating main_agent record...");
  
  // 先查找一个可用的 model profile
  const [defaultProfile] = await db.select().from(modelProfiles).limit(1);
  console.log(`[MainAgent] Using model profile: ${defaultProfile?.id || 1}`);
  
  [mainAgent] = await db
    .insert(agents)
    .values({
      agentUid: "main_agent",
      name: "AI Assistant",
      description: "负责智能委派和任务编排的主 Agent",
      type: "orchestrator",
      status: "active",
      capabilitiesJson: jsonStringify(["orchestration", "delegation", "task_management"]),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  
  console.log(`[MainAgent] Created main_agent: ${mainAgent.id}`);
  
  // 创建初始版本
  try {
    const [version] = await db
      .insert(agentVersions)
      .values({
        agentId: mainAgent.id,
        version: 1,
        modelProfileId: defaultProfile?.id || 1,
        systemPrompt: "你是 AI Assistant，负责理解用户需求并智能委派给合适的 Agent 执行。",
        skillText: "任务分析、Agent 选择、结果汇总",
        allowedToolsJson: "[]",
        contextPolicyJson: "{}",
        modelParamsOverrideJson: "{}",
        maxSteps: 5,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    
    console.log(`[MainAgent] Created main_agent version: ${version.version}`);
    
    // 更新 agent 的 currentVersionId
    await db
      .update(agents)
      .set({ currentVersionId: version.id, updatedAt: now })
      .where(eq(agents.id, mainAgent.id));
    
    console.log(`[MainAgent] Updated main_agent currentVersionId to ${version.id}`);
    
    // 返回更新后的 mainAgent
    const [updatedAgent] = await db.select().from(agents).where(eq(agents.id, mainAgent.id));
    return updatedAgent!;
  } catch (e) {
    console.error("[MainAgent] Failed to create version:", e);
    throw e;
  }
}

// 创建主 Agent 的 run 记录（用于 respond/clarify 等直接回复场景）
async function createMainAgentRun(
  sessionId: string,
  userMessage: string,
  resultSummary: string,
  status: string
) {
  const now = nowIso();
  const runUid = makeUid("run");

  // 获取或创建主 Agent
  console.log("[createMainAgentRun] Getting or creating main agent...");
  const mainAgentRecord = await getOrCreateMainAgent();
  console.log(`[createMainAgentRun] Main agent: ${mainAgentRecord.agentUid}`);
  
  console.log("[createMainAgentRun] Getting current agent version...");
  const { agent, version } = await getCurrentAgentVersion(mainAgentRecord.agentUid);
  console.log(`[createMainAgentRun] Agent version: ${version.version}`);

  const snapshot = {
    agent: {
      id: agent.id,
      agentUid: agent.agentUid,
      name: agent.name,
      type: agent.type,
    },
    version: {
      id: version.id,
      version: version.version,
      allowedTools: jsonParse<string[]>(version.allowedToolsJson, []),
      contextPolicy: jsonParse<Record<string, unknown>>(version.contextPolicyJson, {}),
    },
    modelProfile: {
      id: 0,
      profileUid: "main-agent-profile",
      provider: "system",
      modelName: "main-agent",
    },
  };

  const [run] = await db
    .insert(agentRuns)
    .values({
      runUid,
      agentId: agent.id,
      agentVersionId: version.id,
      sessionId,
      mode: "main",
      status,
      userMessage,
      resultSummary,
      snapshotJson: jsonStringify(snapshot),
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      finishedAt: now,
    })
    .returning();

  console.log(`[MainAgent] Run created: ${run.runUid} for session: ${sessionId}, agent: ${agent.name}`);

  return run;
}

// 主聊天处理函数（立即返回，异步执行）
export async function handleChat(input: ChatRequestInput): Promise<ChatResponse> {
  const { sessionId, message, workContextId, selectedAgentId } = input;

  // 1. 验证 Session 存在
  console.log(`[handleChat] Looking for session: ${sessionId}`);
  const [session] = await db.select().from(sessions).where(eq(sessions.sessionUid, sessionId));
  if (!session) {
    console.error(`[handleChat] Session not found: ${sessionId}`);
    throw notFound("Session not found", { sessionId });
  }
  console.log(`[handleChat] Session found: ${session.sessionUid}`);

  // 2. 创建主 Agent 的 run 记录，状态为 running
  console.log("[handleChat] Creating main agent run...");
  let run;
  try {
    run = await createMainAgentRun(sessionId, message, "正在分析您的请求...", "running");
    console.log(`[handleChat] Run created: ${run.runUid}`);
  } catch (e) {
    console.error("[handleChat] Failed to create run:", e);
    throw e;
  }
  
  // 3. 异步执行完整的决策和执行流程
  processChatAsync(input, run.runUid);
  
  // 4. 立即返回 runId，前端通过 SSE 监听进度
  return {
    message: "正在处理您的请求...",
    workContextId: workContextId || "",
    runId: run.runUid,
    agentId: "main_agent",  // 返回主 Agent 的 ID
  };
}

// 异步处理完整的聊天流程（主 Agent 决策 + 子 Agent 执行）
async function processChatAsync(input: ChatRequestInput, mainRunId: string): Promise<void> {
  const { sessionId, message, workContextId, selectedAgentId } = input;

  // 声明在函数顶部，确保 catch 块可以访问
  let finalWorkContextId: string | undefined;

  try {
    // ===== 新流程：基于 SessionRuntimeSnapshot + SessionContextIndex =====
    console.log("[processChatAsync] 尝试新结构化决策流程...");

    const snapshot = await snapshotBuilder.build({
      sessionId,
      userMessage: message,
      selectedWorkContextUid: workContextId,
    });

    const contextIndex = contextIndexBuilder.build(snapshot);

    const mainDecision = await mainAgent.decideWithSessionIndex({
      userMessage: message,
      snapshot,
      contextIndex,
    });

    const validation = decisionValidator.validate({
      decision: mainDecision,
      snapshot,
      contextIndex,
    });

    if (!validation.valid) {
      console.log("[processChatAsync] Decision validation failed, fallback to ask_user");
      await updateMainAgentRun(
        mainRunId,
        validation.fallbackDecision.ambiguity?.question || "我需要确认一下你要继续处理哪一项。",
        "success",
        mainDecision.targetWorkContextUid ?? undefined
      );
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

    if (
      effectiveDecision.decisionType === "create_work_context" &&
      (!effectiveDecision.plan || effectiveDecision.plan.steps.length === 0)
    ) {
      await updateMainAgentRun(
        mainRunId,
        `已创建新的工作上下文「${effectiveDecision.createWorkContext?.title || "新任务"}」，但当前没有合适的执行 Agent。请先配置或选择具备相关能力的 Agent 后继续。`,
        "success",
        effectiveWorkContextUid ?? undefined
      );
      return;
    }

    // ask_user: 直接返回问题给用户
    if (effectiveDecision.decisionType === "ask_user") {
      const question = effectiveDecision.ambiguity?.question || "我需要确认一下你要继续处理哪一项。";
      await updateMainAgentRun(mainRunId, question, "success", effectiveWorkContextUid ?? undefined);
      return;
    }

    const plan = planCompiler.compile({
      decision: effectiveDecision,
      snapshot,
      contextIndex,
    });

    console.log(`[processChatAsync] ExecutionPlan mode: ${plan.mode}, steps: ${plan.steps.length}`);

    // 根据 plan mode 执行
    switch (plan.mode) {
      case "direct_response": {
        await updateMainAgentRun(
          mainRunId,
          validation.normalizedDecision.response || "我已收到您的消息",
          "success",
          plan.workContextUid
        );
        return;
      }

      case "single_agent":
      case "sequential_agents": {
        await updateMainAgentRun(mainRunId, "正在委派任务给子 Agent...", "running", plan.workContextUid);
        await executePlanAsync(plan, sessionId, message, mainRunId, contextIndex);
        return;
      }

      default: {
        if (ENABLE_LEGACY_FALLBACK) {
          console.log("[processChatAsync] Plan mode not handled, fallback to old flow");
          await processChatAsyncOld(input, mainRunId);
        } else {
          await updateMainAgentRun(
            mainRunId,
            `新编排流程暂不支持 plan mode: ${plan.mode}`,
            "failed",
            plan.workContextUid
          );
        }
        return;
      }
    }
  } catch (error) {
    console.error("[processChatAsync] New flow error:", error);

    if (ENABLE_LEGACY_FALLBACK) {
      console.log("[processChatAsync] Fallback to old flow due to error");
      await processChatAsyncOld(input, mainRunId);
      return;
    }
    //新编排流程执行失败，更新运行状态为失败并记录错误信息
    await updateMainAgentRun(
      mainRunId,
      `执行失败：${error instanceof Error ? error.message : "未知错误"}`,
      "failed",
      finalWorkContextId
    );
  }
}

// 执行计划（新流程）
async function executePlanAsync(
  plan: import("./orchestration.types.js").ExecutionPlan,
  sessionId: string,
  originalUserMessage: string,
  mainRunId: string,
  contextIndex: import("./orchestration.types.js").SessionContextIndex
): Promise<void> {
  const [mainRun] = await db.select({ id: agentRuns.id }).from(agentRuns).where(eq(agentRuns.runUid, mainRunId));
  if (!mainRun) {
    console.error(`[executePlanAsync] Main run not found: ${mainRunId}`);
    return;
  }

  let finalWorkContextId = plan.workContextUid;
  let runningContextIndex = contextIndex;

  const stepResults: Array<{
    stepUid: string;
    agentUid: string;
    runUid: string;
    status: "success" | "partial_success" | "failed";
    summary: string;
    issues?: string[];
    agentResult?: AgentResult;
  }> = [];

  const allProducedArtifacts: Array<{
    artifactUid: string;
    title: string;
  }> = [];

  const allAgentResults: Array<Record<string, unknown>> = [];

  type StepExecutionContext = {
    producedRefsByStepUid: Map<string, string[]>;
    runRefByStepUid: Map<string, string>;
  };

  const executionContext: StepExecutionContext = {
    producedRefsByStepUid: new Map(),
    runRefByStepUid: new Map(),
  };

  const retryState = createStepRetryState();

  for (const step of plan.steps) {
    try {
      console.log(`[executePlanAsync] Executing step: ${step.stepUid}, agent: ${step.targetAgentUid}`);

      const { agent, version } = await getCurrentAgentVersion(step.targetAgentUid);

      const resolvedInputRefIds = resolveStepInputRefIds(step, executionContext);

      const resolvedStep = {
        ...step,
        inputRefIds: resolvedInputRefIds,
      };

      let taskEnvelope = await taskEnvelopeBuilder.build({
        step: resolvedStep,
        plan,
        contextIndex: runningContextIndex,
        parentRunUid: mainRunId,
        originalUserMessage,
      });

      let acceptedRun: Awaited<ReturnType<typeof runtime.run>> | null = null;
      let acceptedAgentResult: AgentResult | null = null;
      let acceptedEvaluationIssues: string[] = [];

      while (true) {
        console.log(`[executePlanAsync] TaskEnvelope:\n${JSON.stringify(taskEnvelope, null, 2)}`);

        const run = await runtime.run({
          agentRecord: agent,
          versionRecord: version,
          userMessage: originalUserMessage,
          originalUserMessage,
          taskEnvelope,
          sessionId,
          workContextId: plan.workContextUid || "",
          parentRunId: mainRun.id,
          mode: "subagent",
        });

        const agentResult = run.agentResult;

        const evaluation = evaluateStepResult({
          step: resolvedStep,
          agentResult,
        });

        const review = await mainAgent.reviewStepOutcome({
          originalUserMessage,
          currentPlan: plan,
          currentStep: resolvedStep,
          taskEnvelope,
          agentResult,
          ruleEvaluation: evaluation,
          stepResultsSoFar: stepResults.map((item) => ({
            stepUid: item.stepUid,
            agentUid: item.agentUid,
            runUid: item.runUid,
            status: item.status,
            summary: item.summary,
            issues: item.issues,
          })),
        });

        console.log(
          `[executePlanAsync] MainAgent step review: ${review.decision}, safe=${review.safeToUseProducedRefs}, confidence=${review.confidence}`
        );

        if (review.decision === "continue") {
          if (!review.safeToUseProducedRefs) {
            stepResults.push({
              stepUid: resolvedStep.stepUid,
              agentUid: resolvedStep.targetAgentUid,
              runUid: run.runUid,
              status: "failed",
              summary: agentResult.summary,
              issues: [
                "MainAgent review returned continue but safeToUseProducedRefs=false.",
                ...review.issues,
              ],
              agentResult,
            });

            await updateMainAgentRun(
              mainRunId,
              review.finalMessage || "步骤结果不可信，已停止继续执行，避免污染后续任务。",
              "failed",
              finalWorkContextId
            );
            return;
          }

          acceptedRun = run;
          acceptedAgentResult = agentResult;
          acceptedEvaluationIssues = review.issues;
          break;
        }

        if (review.decision === "retry_same_agent") {
          if (!canRetryStep({ stepUid: resolvedStep.stepUid, retryState })) {
            stepResults.push({
              stepUid: resolvedStep.stepUid,
              agentUid: resolvedStep.targetAgentUid,
              runUid: run.runUid,
              status: "failed",
              summary: agentResult.summary,
              issues: [
                "Retry limit reached.",
                ...review.issues,
              ],
              agentResult,
            });

            await updateMainAgentRun(
              mainRunId,
              review.finalMessage || "当前步骤重试次数已达上限，任务已停止。",
              "failed",
              finalWorkContextId
            );
            return;
          }

          recordRetryAttempt({
            stepUid: resolvedStep.stepUid,
            issues: review.issues.length > 0 ? review.issues : evaluation.issues,
            retryState,
          });

          taskEnvelope = buildRetryTaskEnvelope({
            originalEnvelope: taskEnvelope,
            retryAttempt: retryState.attemptsByStepUid.get(resolvedStep.stepUid) ?? 1,
            previousRunUid: run.runUid,
            validationIssues: review.issues.length > 0 ? review.issues : evaluation.issues,
            instruction:
              review.retryInstruction ||
              "只修复当前 Objective，不要扩展任务范围，不要执行其他步骤。只能使用 TaskEnvelope 中明确给出的输入资源。",
          });

          continue;
        }

        if (review.decision === "replan_remaining") {
          stepResults.push({
            stepUid: resolvedStep.stepUid,
            agentUid: resolvedStep.targetAgentUid,
            runUid: run.runUid,
            status: "failed",
            summary: agentResult.summary,
            issues: review.issues,
            agentResult,
          });

          await updateMainAgentRun(
            mainRunId,
            review.finalMessage ||
              `当前步骤需要重新规划：${review.replanInstruction || review.reasoning}`,
            "failed",
            finalWorkContextId
          );
          return;
        }

        if (review.decision === "ask_user") {
          stepResults.push({
            stepUid: resolvedStep.stepUid,
            agentUid: resolvedStep.targetAgentUid,
            runUid: run.runUid,
            status: "partial_success",
            summary: agentResult.summary,
            issues: review.issues,
            agentResult,
          });

          await updateMainAgentRun(
            mainRunId,
            review.userQuestion || review.finalMessage || "需要你确认下一步操作。",
            "success",
            finalWorkContextId
          );
          return;
        }

        if (review.decision === "fail") {
          stepResults.push({
            stepUid: resolvedStep.stepUid,
            agentUid: resolvedStep.targetAgentUid,
            runUid: run.runUid,
            status: "failed",
            summary: agentResult.summary,
            issues: review.issues,
            agentResult,
          });

          await updateMainAgentRun(
            mainRunId,
            review.finalMessage || "任务执行失败。",
            "failed",
            finalWorkContextId
          );
          return;
        }
      }

      if (!acceptedRun || !acceptedAgentResult) {
        await updateMainAgentRun(
          mainRunId,
          `步骤执行失败：未获得有效执行结果。stepUid=${resolvedStep.stepUid}`,
          "failed",
          finalWorkContextId
        );
        return;
      }

      const run = acceptedRun;
      const agentResult = acceptedAgentResult;

      console.log(`[executePlanAsync] Step accepted: ${run.runUid}, status: ${agentResult.status}`);

      const producedArtifacts = run.runId
        ? await db
            .select({
              artifactUid: agentArtifacts.artifactUid,
              title: agentArtifacts.title,
              artifactType: agentArtifacts.artifactType,
              artifactRole: agentArtifacts.artifactRole,
              contentText: agentArtifacts.contentText,
            })
            .from(agentArtifacts)
            .where(eq(agentArtifacts.runId, run.runId))
        : [];

      console.log(`[executePlanAsync] Step produced ${producedArtifacts.length} artifacts`);

      allAgentResults.push(agentResult as unknown as Record<string, unknown>);

      stepResults.push({
        stepUid: resolvedStep.stepUid,
        agentUid: resolvedStep.targetAgentUid,
        runUid: run.runUid,
        status: acceptedEvaluationIssues.length > 0 ? "partial_success" : (agentResult.status === "needs_clarification" ? "partial_success" : agentResult.status),
        summary: agentResult.summary || "",
        issues: acceptedEvaluationIssues,
        agentResult,
      });

      const producedRefIds: string[] = [];
      const runRefId = `run:${run.runUid}`;
      producedRefIds.push(runRefId);

      for (const artifact of producedArtifacts) {
        producedRefIds.push(`artifact:${artifact.artifactUid}`);
      }

      const touchedResources = agentResult.touchedResources || [];

      for (const resource of touchedResources) {
        if (!resource.uri) continue;

        if (resource.type === "file") {
          producedRefIds.push(`file:${resource.uri}`);
        } else if (resource.type === "url") {
          producedRefIds.push(`url:${resource.uri}`);
        } else {
          producedRefIds.push(`resource:${resource.uri}`);
        }
      }

      executionContext.producedRefsByStepUid.set(resolvedStep.stepUid, [
        ...new Set(producedRefIds),
      ]);
      executionContext.runRefByStepUid.set(resolvedStep.stepUid, runRefId);

      runningContextIndex = appendRunResultRefs(runningContextIndex, {
        runUid: run.runUid,
        agentUid: resolvedStep.targetAgentUid,
        summary: agentResult.summary,
        status: agentResult.status,
        workContextUid: plan.workContextUid,
        artifacts: producedArtifacts.map((artifact) => ({
          artifactUid: artifact.artifactUid,
          title: artifact.title,
          artifactType: artifact.artifactType,
          artifactRole: artifact.artifactRole,
          summary: artifact.contentText?.slice(0, 300),
        })),
        agentResult: agentResult as unknown as Record<string, unknown>,
      });

      for (const artifact of producedArtifacts) {
        allProducedArtifacts.push({
          artifactUid: artifact.artifactUid,
          title: artifact.title,
        });
      }

      if (plan.workContextUid) {
        finalWorkContextId = plan.workContextUid;
      }
    } catch (error) {
      console.error(`[executePlanAsync] Step failed:`, error);
      await updateMainAgentRun(
        mainRunId,
        `执行失败：${error instanceof Error ? error.message : "未知错误"}`,
        "failed",
        finalWorkContextId
      );
      return;
    }
  }

  const finalSummary = await mainAgent.summarizeFinalResult({
    originalUserMessage,
    plan,
    stepResults,
    producedArtifacts: allProducedArtifacts,
    touchedRefs: extractTouchedRefsFromAgentResults(allAgentResults),
    openIssues: extractOpenIssuesFromAgentResults(allAgentResults),
  });

  const finalStatus = finalSummary.status;
  const finalMessage = finalSummary.finalAnswer;

  const producedArtifactRefs = allProducedArtifacts.map((artifact) => ({
    refId: `artifact:${artifact.artifactUid}`,
    title: artifact.title,
  }));

  const touchedRefs = extractTouchedRefsFromAgentResults(allAgentResults);
  const openIssues = extractOpenIssuesFromAgentResults(allAgentResults);

  if (finalWorkContextId) {
    await updateWorkContextProjection({
      workContextUid: finalWorkContextId,
      runUid: stepResults[stepResults.length - 1]?.runUid ?? mainRunId,
      status: finalStatus,
      summary: finalMessage,
      producedArtifactRefs,
      touchedRefs: touchedRefs.map((r) => r.refId),
      openIssues: openIssues.map((issue) => ({
        type: issue.type,
        summary: issue.message,
        severity: issue.severity as "low" | "medium" | "high" | undefined,
      })),
    });
  }

  await updateMainAgentRun(
    mainRunId,
    finalMessage,
    finalStatus,
    finalWorkContextId
  );
}

function canRetryStep(input: {
  stepUid: string;
  retryState: StepRetryState;
}): boolean {
  const attempts = input.retryState.attemptsByStepUid.get(input.stepUid) ?? 0;
  return attempts < MAX_STEP_RETRIES && input.retryState.totalRepairAttempts < MAX_TOTAL_REPAIRS;
}

function resolveStepInputRefIds(
  step: import("./orchestration.types.js").ExecutionPlan["steps"][0],
  executionContext: {
    producedRefsByStepUid: Map<string, string[]>;
  }
): string[] {
  const refs = new Set<string>(step.inputRefIds || []);

  for (const depStepUid of step.dependsOn || []) {
    const producedRefs = executionContext.producedRefsByStepUid.get(depStepUid) || [];
    for (const refId of producedRefs) {
      refs.add(refId);
    }
  }

  return [...refs];
}

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

function composeStepFailureMessage(input: {
  step: import("./orchestration.types.js").ExecutionPlan["steps"][0];
  evaluation: import("./step-result-evaluator.js").StepEvaluation;
  repairDecision: import("./step-repair-policy.js").AutoRepairAction;
  previousRunUid: string;
}): string {
  const { step, evaluation, repairDecision, previousRunUid } = input;

  const lines = [
    `步骤 ${step.stepUid}（${step.targetAgentUid}）执行失败：`,
    `  - 评估状态：${evaluation.status}`,
    `  - 失败原因：`,
    ...evaluation.issues.map((issue) => `    - ${issue}`),
    `  - 自动修复决策：${repairDecision}`,
    `  - 上次运行：${previousRunUid}`,
  ];

  return lines.join("\n");
}

function appendRunResultRefs(
  index: import("./orchestration.types.js").SessionContextIndex,
  input: {
    runUid: string;
    agentUid: string;
    summary?: string;
    status: string;
    workContextUid?: string;
    artifacts?: Array<{
      artifactUid: string;
      title: string;
      artifactType: string;
      artifactRole?: string | null;
      summary?: string;
    }>;
    agentResult?: Record<string, unknown>;
  }
): import("./orchestration.types.js").SessionContextIndex {
  const runRefId = `run:${input.runUid}`;

  const newRefs: import("./orchestration.types.js").ContextRef[] = [
    {
      refId: runRefId,
      kind: "run" as const,
      title: `${input.agentUid} run`,
      summary: input.summary || "",
      workContextUid: input.workContextUid,
      status: input.status,
      source: {
        table: "agent_runs" as const,
        uid: input.runUid,
        runUid: input.runUid,
      },
      tags: ["run", input.status, input.agentUid],
    },
  ];

  const newRelations: import("./orchestration.types.js").ContextRelation[] = [
    {
      fromRefId: runRefId,
      toRefId: `agent:${input.agentUid}`,
      relation: "executed_by" as const,
    },
  ];

  if (input.workContextUid) {
    newRelations.push({
      fromRefId: runRefId,
      toRefId: `wc:${input.workContextUid}`,
      relation: "belongs_to" as const,
    });
  }

  if (input.artifacts) {
    for (const artifact of input.artifacts) {
      const artifactRefId = `artifact:${artifact.artifactUid}`;
      newRefs.push({
        refId: artifactRefId,
        kind: "artifact" as const,
        title: artifact.title,
        summary: artifact.summary || artifact.artifactType,
        workContextUid: input.workContextUid,
        status: artifact.artifactRole === "pending_write" ? "pending_write" : "ready",
        source: {
          table: "agent_artifacts" as const,
          uid: artifact.artifactUid,
        },
        tags: ["artifact", artifact.artifactType, artifact.artifactRole || ""].filter(Boolean),
      });
      newRelations.push({
        fromRefId: artifactRefId,
        toRefId: runRefId,
        relation: "produced" as const,
      });
      if (input.workContextUid) {
        newRelations.push({
          fromRefId: artifactRefId,
          toRefId: `wc:${input.workContextUid}`,
          relation: "belongs_to" as const,
        });
      }
    }
  }

  // 处理 touchedResources
  const touchedResources = input.agentResult?.touchedResources as
    | Array<{
        type?: string;
        uri?: string;
        operation?: string;
        verified?: boolean;
      }>
    | undefined;

  if (touchedResources) {
    for (const resource of touchedResources) {
      if (!resource.uri) continue;

      const refId =
        resource.type === "file"
          ? `file:${resource.uri}`
          : resource.type === "url"
            ? `url:${resource.uri}`
            : `resource:${resource.uri}`;

      const kind: import("./orchestration.types.js").ContextRefKind =
        resource.type === "file"
          ? "file"
          : resource.type === "url"
            ? "url"
            : "resource";

      if (!newRefs.find((r) => r.refId === refId) && !index.refs.find((r) => r.refId === refId)) {
        newRefs.push({
          refId,
          kind,
          title: resource.uri.split("/").pop() || resource.uri,
          summary: `${resource.operation || "touched"}; verified=${resource.verified ? "true" : "false"}`,
          workContextUid: input.workContextUid,
          status: resource.verified ? "verified" : "unverified",
          source: {
            uri: resource.uri,
          },
          tags: [
            resource.type || "resource",
            resource.operation || "unknown",
            resource.verified ? "verified" : "unverified",
          ],
        });
      }

      const relation = mapTouchedOperationToRelation(resource.operation);

      newRelations.push({
        fromRefId: runRefId,
        toRefId: refId,
        relation,
      });

      if (input.workContextUid) {
        newRelations.push({
          fromRefId: refId,
          toRefId: `wc:${input.workContextUid}`,
          relation: "belongs_to" as const,
        });
      }
    }
  }

  return {
    refs: [...index.refs, ...newRefs],
    relations: [...index.relations, ...newRelations],
  };
}

function mapTouchedOperationToRelation(
  operation?: string
): import("./orchestration.types.js").ContextRelation["relation"] {
  const op = (operation || "").toLowerCase();

  if (["read", "fetch", "open", "visit", "navigate", "crawl", "scrape"].some((k) => op.includes(k))) {
    return "read";
  }

  if (["write", "create", "save", "append"].some((k) => op.includes(k))) {
    return "wrote";
  }

  if (["edit", "update", "modify", "patch"].some((k) => op.includes(k))) {
    return "modified";
  }

  if (["delete", "remove"].some((k) => op.includes(k))) {
    return "deleted";
  }

  return "touched";
}

// 旧流程（fallback）
async function processChatAsyncOld(input: ChatRequestInput, mainRunId: string): Promise<void> {
  const { sessionId, message, workContextId, selectedAgentId } = input;

  // 声明在函数顶部，确保 catch 块可以访问
  let finalWorkContextId: string | undefined;

  try {
    // 获取可用 Agent 列表
    const availableAgents = await getAvailableAgents();

    // ===== 第一步：初步判断 =====
    const firstStepContext = await contextBuilder.buildMainAgentContext({
      sessionId,
      userMessage: message,
      workContextId,
    });

    const firstStepDecision = await mainAgent.decideFirstStep(firstStepContext, availableAgents);

    // ========== 第一步决策处理 ==========
    // 先确定 workContextId（如果第一步就能确定的话）
    let earlyWorkContextId: string | undefined;
    if (firstStepDecision.candidateWorkContextId) {
      earlyWorkContextId = firstStepDecision.candidateWorkContextId;
    }

    if (firstStepDecision.action === "respond") {
      await updateMainAgentRun(mainRunId, firstStepDecision.response || "我已收到您的消息", "success", earlyWorkContextId);
      return;
    }

    if (firstStepDecision.action === "clarify") {
      await updateMainAgentRun(mainRunId, firstStepDecision.response || "请提供更多详细信息", "success", earlyWorkContextId);
      return;
    }

    // ===== 第二步：基于详细信息做最终决策 =====
    let workContextDetail;

    if (firstStepDecision.confidence === "high" && firstStepDecision.candidateWorkContextId) {
      workContextDetail = await contextBuilder.getWorkContextDetail(firstStepDecision.candidateWorkContextId);
      if (!workContextDetail) {
        const newWorkContext = await createWorkContext(sessionId, message.slice(0, 50), message);
        workContextDetail = (await contextBuilder.getWorkContextDetail(newWorkContext.workContextUid))!;
      }
    } else if (firstStepDecision.confidence === "medium" && firstStepDecision.candidateWorkContextId) {
      workContextDetail = await contextBuilder.getWorkContextDetail(firstStepDecision.candidateWorkContextId);
      if (!workContextDetail) {
        const newWorkContext = await createWorkContext(sessionId, message.slice(0, 50), message);
        workContextDetail = (await contextBuilder.getWorkContextDetail(newWorkContext.workContextUid))!;
      }
    } else {
      const newWorkContext = await createWorkContext(sessionId, message.slice(0, 50), message);
      workContextDetail = (await contextBuilder.getWorkContextDetail(newWorkContext.workContextUid))!;
    }

    finalWorkContextId = workContextDetail.workContextId;

    const secondStepContext = await contextBuilder.buildMainAgentContext({
      sessionId,
      userMessage: message,
      workContextId: finalWorkContextId,
    });

    const finalDecision = await mainAgent.decideSecondStep(secondStepContext, workContextDetail, availableAgents);
    finalDecision.workContextId = finalWorkContextId;

    // 根据最终决策执行不同操作
    switch (finalDecision.action) {
      case "delegate": {
        await updateMainAgentRun(mainRunId, "正在委派任务给子 Agent...", "running");
        await handleDelegateChainAsync(finalDecision, sessionId, message, selectedAgentId, availableAgents, mainRunId);
        return;
      }

      case "clarify": {
        await updateMainAgentRun(mainRunId, finalDecision.response || "请提供更多详细信息", "success", finalWorkContextId);
        return;
      }

      case "respond":
      default: {
        await updateMainAgentRun(mainRunId, finalDecision.response || "我已收到您的消息", "success", finalWorkContextId);
        return;
      }
    }
  } catch (error) {
    console.error("[processChatAsyncOld] Error:", error);
    await updateMainAgentRun(mainRunId, `处理失败：${error instanceof Error ? error.message : "未知错误"}`, "failed", finalWorkContextId);
  }
}

// 处理链式委派
async function handleDelegateChain(
  decision: OrchestrationDecision,
  sessionId: string,
  userMessage: string,
  selectedAgentId: string | undefined,
  availableAgents: AgentCapabilitySummary[],
  depth: number = 0,
  previousResults: Array<{ agentId: string; result: string }> = []
): Promise<ChatResponse> {
  // 防止无限循环
  if (depth >= MAX_DELEGATION_DEPTH) {
    return {
      message: `已达到最大委派深度(${MAX_DELEGATION_DEPTH})，任务执行结束。\n\n执行链路：\n${previousResults.map((r, i) => `${i + 1}. ${r.agentId}: ${r.result.slice(0, 100)}...`).join("\n")}`,
      workContextId: decision.workContextId || "",
    };
  }

  // 确定目标 Agent
  const targetAgentId = decision.targetAgentId || selectedAgentId;
  if (!targetAgentId) {
    return {
      message: "我需要知道应该由哪个 Agent 来处理这个任务。请选择一个 Agent。",
      workContextId: decision.workContextId || "",
    };
  }

  // 获取或创建 WorkContext
  let workContextId = decision.workContextId;
  if (!workContextId) {
    const workContext = await createWorkContext(
      sessionId,
      userMessage.slice(0, 50),
      userMessage
    );
    workContextId = workContext.workContextUid;
  }

  // 执行子 Agent
  let runResult: { runUid: string; resultSummary: string | null; status: string };
  try {
    console.log(`[SubAgent] 开始执行: ${targetAgentId}, depth=${depth}, workContext=${workContextId}`);
    console.log(`[SubAgent] HandoffNote: ${decision.handoffNote?.slice(0, 200)}...`);

    const { agent, version } = await getCurrentAgentVersion(targetAgentId);

    const run = await runtime.run({
      agentRecord: agent,
      versionRecord: version,
      userMessage,
      handoffNote: decision.handoffNote || `请处理用户的请求：${userMessage}`,
      sessionId,
      workContextId,
      mode: "subagent",
    });

    runResult = {
      runUid: run.runUid,
      resultSummary: run.summary,
      status: run.status,
    };

    // 打印子 Agent 返回结果
    console.log(`[SubAgent] 执行完成: ${targetAgentId}`);
    console.log(`[SubAgent] RunID: ${runResult.runUid}`);
    console.log(`[SubAgent] Status: ${runResult.status}`);
    console.log(`[SubAgent] ResultSummary: ${runResult.resultSummary?.slice(0, 500) || "无摘要"}`);

    // 记录执行结果
    previousResults.push({
      agentId: targetAgentId,
      result: run.summary || "执行完成",
    });
  } catch (error) {
    console.error(`[SubAgent] 执行失败: ${targetAgentId}`, error);
    return {
      message: `委派执行失败：${error instanceof Error ? error.message : "未知错误"}`,
      workContextId,
    };
  }

  // 子 Agent 执行完成后，主 Agent 再次判断是否需要继续委派
  const followUpMessage = `子 Agent ${targetAgentId} 执行完成，结果：${runResult.resultSummary || "无摘要"}。\n\n用户原始请求：${userMessage}`;
  
  const followUpContext = await contextBuilder.buildMainAgentContext({
    sessionId,
    userMessage: followUpMessage,
    workContextId,
  });

  // 添加执行历史到上下文
  followUpContext.executionHistory = previousResults;

  const followUpDecision = await mainAgent.decideFollowUp(followUpContext, availableAgents);

  // 根据后续决策处理
  switch (followUpDecision.action) {
    case "delegate":
      // 继续委派给下一个 Agent
      return handleDelegateChain(
        followUpDecision,
        sessionId,
        followUpMessage,
        undefined, // 使用决策中的 targetAgentId
        availableAgents,
        depth + 1,
        previousResults
      );

    case "clarify":
      return {
        message: followUpDecision.response || "需要进一步澄清",
        workContextId,
        runId: runResult.runUid,
        agentId: targetAgentId,
      };

    case "respond":
    default:
      // 汇总所有执行结果，生成最终回复
      const finalMessage = buildFinalResponse(previousResults, followUpDecision.response);
      return {
        message: finalMessage,
        workContextId,
        runId: runResult.runUid,
        agentId: targetAgentId,
      };
  }
}

// 异步处理链式委派（不阻塞 HTTP 响应）
async function handleDelegateChainAsync(
  decision: OrchestrationDecision,
  sessionId: string,
  userMessage: string,
  selectedAgentId: string | undefined,
  availableAgents: AgentCapabilitySummary[],
  mainRunId: string,
  depth: number = 0,
  previousResults: Array<{ agentId: string; result: string }> = []
): Promise<void> {
  // 防止无限循环
  if (depth >= MAX_DELEGATION_DEPTH) {
    await updateMainAgentRun(mainRunId, 
      `已达到最大委派深度(${MAX_DELEGATION_DEPTH})，任务执行结束。`, 
      "success",
      decision.workContextId
    );
    return;
  }

  // 确定目标 Agent
  const targetAgentId = decision.targetAgentId || selectedAgentId;
  if (!targetAgentId) {
    await updateMainAgentRun(mainRunId, 
      "我需要知道应该由哪个 Agent 来处理这个任务。请选择一个 Agent。", 
      "failed",
      decision.workContextId
    );
    return;
  }

  // 获取或创建 WorkContext
  let workContextId = decision.workContextId;
  if (!workContextId) {
    const workContext = await createWorkContext(
      sessionId,
      userMessage.slice(0, 50),
      userMessage
    );
    workContextId = workContext.workContextUid;
  }

  // 查询主 Agent run 的 id
  const [mainRun] = await db.select({ id: agentRuns.id }).from(agentRuns).where(eq(agentRuns.runUid, mainRunId));
  if (!mainRun) {
    console.error(`[handleDelegateChainAsync] Main run not found: ${mainRunId}`);
    return;
  }

  // 执行子 Agent
  let runResult: { runUid: string; resultSummary: string | null; status: string };
  try {
    console.log(`[SubAgent] 开始执行: ${targetAgentId}, depth=${depth}, workContext=${workContextId}, parentRunId=${mainRun.id}`);

    const { agent, version } = await getCurrentAgentVersion(targetAgentId);

    const run = await runtime.run({
      agentRecord: agent,
      versionRecord: version,
      userMessage,
      handoffNote: decision.handoffNote || `请处理用户的请求：${userMessage}`,
      sessionId,
      workContextId,
      parentRunId: mainRun.id,
      mode: "subagent",
    });

    runResult = {
      runUid: run.runUid,
      resultSummary: run.summary,
      status: run.status,
    };

    console.log(`[SubAgent] 执行完成: ${targetAgentId}, RunID: ${runResult.runUid}`);

    // 记录执行结果
    previousResults.push({
      agentId: targetAgentId,
      result: run.summary || "执行完成",
    });
  } catch (error) {
    console.error(`[SubAgent] 执行失败: ${targetAgentId}`, error);
    await updateMainAgentRun(mainRunId, 
      `委派执行失败：${error instanceof Error ? error.message : "未知错误"}`, 
      "failed",
      workContextId
    );
    return;
  }

  // 子 Agent 执行完成后，主 Agent 再次判断是否需要继续委派
  const followUpMessage = `子 Agent ${targetAgentId} 执行完成，结果：${runResult.resultSummary || "无摘要"}。\n\n用户原始请求：${userMessage}`;

  const followUpContext = await contextBuilder.buildMainAgentContext({
    sessionId,
    userMessage: followUpMessage,
    workContextId,
  });

  // 添加执行历史到上下文
  followUpContext.executionHistory = previousResults;

  const followUpDecision = await mainAgent.decideFollowUp(followUpContext, availableAgents);

  // 根据后续决策处理
  switch (followUpDecision.action) {
    case "delegate":
      // 继续委派给下一个 Agent
      await handleDelegateChainAsync(
        followUpDecision,
        sessionId,
        followUpMessage,
        undefined,
        availableAgents,
        mainRunId,
        depth + 1,
        previousResults
      );
      break;

    case "clarify":
      await updateMainAgentRun(mainRunId, 
        followUpDecision.response || "需要进一步澄清", 
        "success",
        workContextId
      );
      break;

    case "respond":
    default: {
      // 汇总所有执行结果，生成最终回复
      console.log(`[MainAgent] Building final response, results count: ${previousResults.length}, response: ${followUpDecision.response?.slice(0, 100)}`);
      const finalMessage = buildFinalResponse(previousResults, followUpDecision.response);
      console.log(`[MainAgent] Final message length: ${finalMessage.length}, content: ${finalMessage.slice(0, 100)}`);
      await updateMainAgentRun(mainRunId, finalMessage, "success", workContextId);
      break;
    }
  }
}

// 更新主 Agent 的 run 记录
async function updateMainAgentRun(runUid: string, resultSummary: string, status: string, workContextId?: string) {
  const now = nowIso();
  await db
    .update(agentRuns)
    .set({
      resultSummary,
      status,
      updatedAt: now,
      finishedAt: status === 'success' || status === 'failed' ? now : undefined,
    })
    .where(eq(agentRuns.runUid, runUid));
  
  // 发布状态更新事件，让 SSE 推送给前端
  runEventBus.emitRunStatus(runUid, {
    runId: runUid,
    status,
    resultSummary,
    updatedAt: now,
  });
  
  // 如果提供了 workContextId，更新 workContext 的 current_run_id 绑定
  if (workContextId && (status === 'success' || status === 'failed')) {
    try {
      await updateWorkContextRunBinding(workContextId, runUid, resultSummary);
    } catch (error) {
      console.error(`[updateMainAgentRun] Failed to update workContext binding:`, error);
    }
  }
  
  console.log(`[MainAgent] Run updated: ${runUid}, status=${status}${workContextId ? `, workContext=${workContextId}` : ''}`);
}

// 构建最终响应
function buildFinalResponse(results: Array<{ agentId: string; result: string }>, summary?: string): string {
  if (results.length === 1) {
    return summary || results[0].result;
  }

  const executionChain = results
    .map((r, i) => `${i + 1}. **${r.agentId}**\n   ${r.result.slice(0, 200)}...`)
    .join("\n\n");

  return `${summary || "多 Agent 协作完成"}\n\n**执行链路：**\n\n${executionChain}`;
}

function extractTouchedRefsFromAgentResults(
  results: Array<Record<string, unknown>>
): Array<{ refId: string; title?: string }> {
  return Array.from(
    new Set(
      results.flatMap((result) => {
        const resources = Array.isArray(result.touchedResources)
          ? result.touchedResources
          : [];

        return resources
          .map((resource) => {
            if (!resource || typeof resource !== "object") return null;

            const item = resource as {
              type?: string;
              uri?: string;
              operation?: string;
              verified?: boolean;
            };

            if (!item.uri) return null;

            if (item.type === "file") return `file:${item.uri}`;
            if (item.type === "artifact") {
              return item.uri.startsWith("artifact:")
                ? item.uri
                : `artifact:${item.uri}`;
            }
            if (item.type === "url") return `url:${item.uri}`;
            if (item.type === "db_record") return `db:${item.uri}`;

            return `resource:${item.uri}`;
          })
          .filter((ref): ref is string => Boolean(ref));
      })
    )
  )
    .slice(0, 20)
    .map((refId) => ({ refId }));
}

function extractOpenIssuesFromAgentResults(
  results: Array<Record<string, unknown>>
): Array<{
  type?: string;
  message: string;
  severity?: string;
}> {
  const allIssues = results.flatMap((result) => {
    const issues = Array.isArray(result.openIssues)
      ? result.openIssues
      : [];

    return issues
      .map((issue) => {
        if (!issue || typeof issue !== "object") return null;

        const item = issue as {
          refId?: string;
          type?: string;
          message?: string;
          summary?: string;
          severity?: "low" | "medium" | "high";
        };

        const message =
          item.message ||
          item.summary ||
          (item.type ? `执行问题：${item.type}` : "执行过程中出现问题");

        return {
          type: item.type,
          message,
          severity: item.severity ?? "medium",
        };
      })
      .filter((issue): issue is NonNullable<typeof issue> => Boolean(issue));
  });

  return allIssues.slice(0, 10);
}


