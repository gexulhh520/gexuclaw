import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { agents, agentRuns, agentVersions, modelProfiles, sessions, workContexts } from "../../db/schema.js";
import { notFound } from "../../shared/errors.js";
import { makeUid } from "../../shared/ids.js";
import { jsonStringify } from "../../shared/json.js";
import { nowIso } from "../../shared/time.js";
import { getCurrentAgentVersion } from "../agents/agent.service.js";
import { AgentRuntime } from "../../runtime/agent-runtime.js";
import { ContextBuilder } from "./context-builder.js";
import { MainAgent } from "./main-agent.js";
import { runEventBus } from "../../shared/event-bus.js";
import { updateWorkContextRunBinding } from "../work-contexts/work-context.service.js";
import { pluginRegistry } from "../plugins/plugin-registry-instance.js";
import { SessionRuntimeSnapshotBuilder } from "./session-runtime-snapshot-builder.js";
import { SessionContextIndexBuilder } from "./session-context-index-builder.js";
import { DecisionContractValidator } from "./decision-contract-validator.js";
import { ExecutionPlanCompiler } from "./execution-plan-compiler.js";
import { TaskEnvelopeBuilder } from "./task-envelope-builder.js";
import { renderTaskEnvelopeForAgent } from "./task-envelope-renderer.js";
import type { ChatRequestInput, ChatResponse, OrchestrationDecision, DelegateEnvelope } from "./orchestration.schema.js";
import type { AgentCapabilitySummary } from "./context-builder.js";

const runtime = new AgentRuntime({ pluginRegistry });
const contextBuilder = new ContextBuilder();
const mainAgent = new MainAgent();
const snapshotBuilder = new SessionRuntimeSnapshotBuilder();
const contextIndexBuilder = new SessionContextIndexBuilder();
const decisionValidator = new DecisionContractValidator();
const planCompiler = new ExecutionPlanCompiler();
const taskEnvelopeBuilder = new TaskEnvelopeBuilder();

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

    const plan = planCompiler.compile({
      decision: validation.normalizedDecision,
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
        // fallback 到旧流程
        console.log("[processChatAsync] Plan mode not handled, fallback to old flow");
        await processChatAsyncOld(input, mainRunId);
        return;
      }
    }
  } catch (error) {
    console.error("[processChatAsync] New flow error:", error);
    // fallback 到旧流程
    console.log("[processChatAsync] Fallback to old flow due to error");
    await processChatAsyncOld(input, mainRunId);
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

  for (const step of plan.steps) {
    try {
      console.log(`[executePlanAsync] Executing step: ${step.stepUid}, agent: ${step.targetAgentUid}`);

      const { agent, version } = await getCurrentAgentVersion(step.targetAgentUid);

      const taskEnvelope = taskEnvelopeBuilder.build({
        step,
        plan,
        contextIndex,
        parentRunUid: mainRunId,
        originalUserMessage,
      });

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

      console.log(`[executePlanAsync] Step completed: ${run.runUid}, status: ${run.status}`);

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

  // 所有步骤完成
  await updateMainAgentRun(
    mainRunId,
    "任务执行完成",
    "success",
    finalWorkContextId
  );
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

// 辅助函数：安全解析 JSON
function jsonParse<T>(json: string, defaultValue: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return defaultValue;
  }
}
