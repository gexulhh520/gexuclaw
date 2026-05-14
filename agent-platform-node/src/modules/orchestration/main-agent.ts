import { ModelClient } from "../../runtime/model-client.js";
import type { ChatMessage } from "../../runtime/model-client.js";
import { makeUid } from "../../shared/ids.js";
import type { OrchestrationDecision, DelegateEnvelope } from "./orchestration.schema.js";
import type { PromptContext, AgentCapabilitySummary, WorkContextDetail } from "./context-builder.js";
import { mainDecisionSchema } from "./main-decision.schema.js";
import type { SessionRuntimeSnapshot, SessionContextIndex, MainDecision } from "./orchestration.types.js";
import { stepOutcomeReviewSchema, type StepOutcomeReview } from "./step-outcome-review.schema.js";
import { finalResultSummarySchema, type FinalResultSummary } from "./final-result-summary.schema.js";
import type { ExecutionPlan } from "./orchestration.types.js";
import type { TaskEnvelope } from "./task-envelope.types.js";
import type { AgentResult } from "../../runtime/agent-result.js";
import type { StepEvaluation } from "./step-result-evaluator.js";

// 主 Agent - 负责编排和委派
export class MainAgent {
  private modelClient: ModelClient;

  constructor() {
    this.modelClient = new ModelClient();
  }

  /**
   * 基于 SessionRuntimeSnapshot + 主对话历史 做结构化决策
   * 输出 MainDecision JSON
   */
  async decideWithSessionIndex(input: {
    userMessage: string;
    snapshot: SessionRuntimeSnapshot;
    mainHistoryMessages?: ChatMessage[];
  }): Promise<MainDecision> {
    console.log(`[MainAgent] decideWithSessionIndex 开始`);
    console.log(`[MainAgent] 用户消息: ${input.userMessage.slice(0, 100)}...`);
    console.log(`[MainAgent] SessionId: ${input.snapshot.session.sessionUid}`);
    console.log(`[MainAgent] 历史消息数: ${input.mainHistoryMessages?.length ?? 0}`);

    const systemPrompt = this.buildMainDecisionSystemPrompt(
      input.snapshot.availableAgents
    );

    const currentInput = this.buildCurrentMainDecisionInput(input);

    console.log(`[MainAgent] 当前决策输入: ${JSON.stringify(currentInput, null, 2)}`);

    const raw = await this.modelClient.complete({
      systemPrompt,
      messages: [
        ...(input.mainHistoryMessages ?? []),
        {
          role: "user",
          content: JSON.stringify(currentInput, null, 2),
        },
      ],
      temperature: 0.3,
    });

    const decision = await this.parseMainDecision(raw.content);

    console.log(`[MainAgent] 决策完成: ${decision.decisionType}`);
    console.log(`[MainAgent] Confidence: ${decision.confidence}`);
    console.log(`[MainAgent] Reasoning: ${decision.reasoning.slice(0, 200)}...`);
    console.log(`[MainAgent] 完整决策结果:\n${JSON.stringify(decision, null, 2)}`);

    return decision;
  }

  private buildCurrentMainDecisionInput(input: {
    userMessage: string;
    snapshot: SessionRuntimeSnapshot;
  }) {
    const sessionState = input.snapshot.sessionState;

    return {
      userMessage: input.userMessage,
      effectiveUserMessage: input.snapshot.effectiveUserMessage,
      sessionState: {
        currentStage: sessionState.currentStage,
        recoverable: sessionState.recoverable,
        lastRecoverableRunUid: sessionState.lastRecoverableRunUid,
        lastFailedRunUid: sessionState.lastFailedRunUid,
        lastSuccessfulRunUid: sessionState.lastSuccessfulRunUid,
        recentRefs: sessionState.recentRefs?.slice(0, 5) ?? [],
        openIssues: sessionState.openIssues?.slice(0, 5) ?? [],
      },
    };
  }

  private truncateText(text: string | undefined | null, maxLength: number): string {
    if (!text) return "";
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + "...";
  }

  private getMainDecisionJsonContract(): string {
    return `MainDecision JSON 必须包含以下所有顶层字段：

{
  "decisionType": "answer_directly | delegate | multi_step_plan | ask_user | explain_trace | verify_execution | recover_execution",
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
4. 当前常规决策不提供 refs / relations，所以 primaryRefs、secondaryRefs、plan.steps[].inputRefIds 默认输出 []。
5. targetAgentUid、plan.steps[].targetAgentUid 必须来自系统提示中的可用子 Agent 列表。
6. plan 只有执行型决策填写，否则为 null。
7. response 只有 answer_directly 填写，否则为 null。
8. ambiguity 只有 ask_user 填写，否则为 null。
9. 不要输出额外字段。
10. 不要输出 WorkContext 相关字段。`;
  }

  private getAskUserFallbackExample(): string {
    return `{
  "decisionType": "ask_user",
  "primaryRefs": [],
  "secondaryRefs": [],
  "targetAgentUid": null,
  "plan": null,
  "response": null,
  "ambiguity": {
    "candidateRefIds": [],
    "question": "请确认你要继续处理哪一项。"
  },
  "confidence": "low",
  "reasoning": "需要用户澄清。"
}`;
  }

  private buildMainDecisionSystemPrompt(
    availableAgents: SessionRuntimeSnapshot["availableAgents"]
  ): string {
    const contract = this.getMainDecisionJsonContract();
    const fallbackExample = this.getAskUserFallbackExample();

    const agentDescriptions = availableAgents
      .map((agent) => {
        const capabilities = agent.capabilities?.length
          ? agent.capabilities.join(", ")
          : "无";
        const description = this.truncateText(agent.description, 200);

        return `- ${agent.agentUid}: ${agent.name}
  描述: ${description}
  能力: ${capabilities}`;
      })
      .join("\n");

    return `你是主 Agent 的结构化决策器，不是执行器。

你会收到：
1. 历史 messages：最近几轮用户与主 Agent 的对话
2. 当前 userMessage：用户本轮原始消息
3. 当前 effectiveUserMessage：系统恢复后的真实任务消息；如果用户说"继续/重试"，这里可能是上一轮失败任务
4. 当前 sessionState：极简会话状态

可用子 Agent：
${agentDescriptions || "无可用子 Agent"}

你必须输出一个合法 MainDecision JSON。
不要输出 Markdown。
不要输出代码块。
不要输出解释性文字。
不要编造不存在的 agentUid。
当前常规决策不提供 refs / relations，因此 primaryRefs、secondaryRefs、plan.steps[].inputRefIds 通常应为空数组。

${contract}

如果无法确定意图，输出这个 ask_user fallback 结构：

${fallbackExample}

决策规则：
1. 如果用户只是问候、普通问答，使用 answer_directly。
2. 如果任务明确且单个 Agent 可以完成，使用 delegate。
3. 如果任务需要多个步骤，使用 multi_step_plan。
4. 如果 userMessage 是"继续/重试/接着"，要优先参考 effectiveUserMessage 和 sessionState。
5. 如果 sessionState.currentStage=blocked 或 recoverable=true，优先考虑 recover_execution。
6. targetAgentUid、plan.steps[].targetAgentUid 必须来自上面的可用子 Agent 列表。
7. 当前常规决策没有加载 refs / relations，所以 primaryRefs、secondaryRefs、plan.steps[].inputRefIds 默认输出 []。
8. answer_directly 必须填写 response。
9. ask_user 必须填写 ambiguity.question。
10. delegate、recover_execution、verify_execution、multi_step_plan 必须填写 plan.steps。
11. reasoning 只写简短内部理由，不超过 300 字。`;
  }

  private async parseMainDecision(content: string): Promise<MainDecision> {
    const json = this.extractJsonObject(content);
    const parsed = mainDecisionSchema.safeParse(json);

    if (parsed.success) {
      return parsed.data;
    }

    console.warn(`[MainAgent] MainDecision 解析失败，尝试 repair: ${parsed.error.message}`);

    return this.repairMainDecision(content, parsed.error);
  }

  private extractJsonObject(content: string): unknown {
    const trimmed = content.trim();
    if (trimmed.startsWith("{")) {
      try {
        return JSON.parse(trimmed);
      } catch {
        // 尝试提取 JSON 块
      }
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        // 解析失败
      }
    }

    return null;
  }

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
      primaryRefs: [],
      secondaryRefs: [],
      targetAgentUid: null,
      plan: null,
      response: null,
      ambiguity: {
        candidateRefIds: [],
        question: "我需要确认一下你要继续处理哪一项。",
      },
      confidence: "low",
      reasoning: "MainDecision JSON parse failed after repair.",
    };
  }

  // 第一步：初步判断用户意图和可能匹配的 WorkContext
  async decideFirstStep(
    promptContext: PromptContext,
    availableAgents: AgentCapabilitySummary[]
  ): Promise<{
    action: "delegate" | "clarify" | "respond";
    reasoning: string;
    candidateWorkContextId?: string;  // 可能匹配的 WorkContext ID
    confidence: "high" | "medium" | "low";  // 匹配置信度
    response?: string;
  }> {
    console.log(`[MainAgent] 第一步决策开始`);
    console.log(`[MainAgent] 用户消息: ${promptContext.userMessage.slice(0, 100)}...`);

    const systemPrompt = this.buildFirstStepSystemPrompt(availableAgents);
    const userPrompt = this.buildFirstStepUserPrompt(promptContext);

    const response = await this.modelClient.complete({
      systemPrompt,
      userMessage: userPrompt,
      temperature: 0.3,
    });

    const decision = this.parseFirstStepDecision(response.content);

    console.log(`[MainAgent] 第一步决策完成`);
    console.log(`[MainAgent] Action: ${decision.action}`);
    console.log(`[MainAgent] Confidence: ${decision.confidence}`);
    console.log(`[MainAgent] CandidateWorkContextId: ${decision.candidateWorkContextId || "无"}`);
    console.log(`[MainAgent] Reasoning: ${decision.reasoning.slice(0, 200)}...`);

    return decision;
  }

  // 第二步：基于详细信息做最终决策
  async decideSecondStep(
    promptContext: PromptContext,
    workContextDetail: WorkContextDetail,
    availableAgents: AgentCapabilitySummary[]
  ): Promise<OrchestrationDecision> {
    console.log(`[MainAgent] 第二步决策开始`);
    console.log(`[MainAgent] 确认WorkContext: ${workContextDetail.workContextId}`);
    console.log(`[MainAgent] WorkContext标题: ${workContextDetail.title}`);
    console.log(`[MainAgent] 历史执行次数: ${workContextDetail.runCount}`);

    const systemPrompt = this.buildSecondStepSystemPrompt(availableAgents);
    const userPrompt = this.buildSecondStepUserPrompt(promptContext, workContextDetail);

    const response = await this.modelClient.complete({
      systemPrompt,
      userMessage: userPrompt,
      temperature: 0.3,
    });

    const decision = this.parseDecision(response.content, promptContext);

    console.log(`[MainAgent] 第二步决策完成`);
    console.log(`[MainAgent] FinalAction: ${decision.action}`);
    console.log(`[MainAgent] TargetAgentId: ${decision.targetAgentId || "无"}`);
    console.log(`[MainAgent] WorkContextId: ${decision.workContextId || "无"}`);
    console.log(`[MainAgent] Reasoning: ${decision.reasoning?.slice(0, 200)}...`);

    return decision;
  }

  // 构建第一步的 System Prompt
  private buildFirstStepSystemPrompt(availableAgents: AgentCapabilitySummary[]): string {
    const agentDescriptions = availableAgents
      .map(
        (agent) => {
          const pluginsInfo = agent.plugins && agent.plugins.length > 0
            ? `\n    拥有插件: ${agent.plugins.map((p) => `${p.name}(${p.pluginId})`).join(", ")}`
            : "";
          return `- ${agent.agentId}: ${agent.name}
    描述: ${agent.description}
    能力: ${agent.capabilities.join(", ")}${pluginsInfo}`;
        }
      )
      .join("\n");

    return `你是 AI Agent OS 的主 Agent（Orchestrator），负责初步分析用户意图并判断应该使用哪个 WorkContext。

## 可用子 Agent
${agentDescriptions}

## 你的任务
基于用户消息和 WorkContext 列表，做初步匹配判断：

1. **分析用户意图**：用户想做什么？
2. **匹配 WorkContext**：用户消息与哪个 WorkContext 最相关？
3. **评估置信度**：
   - high: 用户明确提到了 WorkContext 的标题或目标
   - medium: 语义相关，但需要进一步确认
   - low: 不确定，可能是新的工作

## 输出格式
{\n  "action": "delegate | clarify | respond",\n  "reasoning": "分析过程：用户意图、匹配理由",\n  "candidateWorkContextId": "匹配的 WorkContext ID 或空",\n  "confidence": "high | medium | low",\n  "response": "当 action=respond 或 clarify 时的回复内容"\n}

## 判断规则
- confidence=high → 直接返回 candidateWorkContextId，进入第二步确认
- confidence=medium → 返回 candidateWorkContextId，但需要查询详情确认
- confidence=low 或没有匹配 → candidateWorkContextId 为空，创建新的 WorkContext
- action=respond → 简单问候或系统操作，不需要 WorkContext
- action=clarify → 用户意图不明确，需要追问`;
  }

  // 构建第一步的 User Prompt
  private buildFirstStepUserPrompt(context: PromptContext): string {
    // 会话协作描述
    const sessionCollaboration = context.sessionDescription
      ? `## 当前会话的协作目标\n${context.sessionDescription}\n`
      : "";

    return `## 用户消息
"""${context.userMessage}"""

${sessionCollaboration}

请做初步匹配判断：用户意图是什么？置信度如何？`;
  }

  // 解析第一步决策
  private parseFirstStepDecision(content: string): {
    action: "delegate" | "clarify" | "respond";
    reasoning: string;
    candidateWorkContextId?: string;
    confidence: "high" | "medium" | "low";
    response?: string;
  } {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const decision = JSON.parse(jsonMatch[0]);
        return {
          action: decision.action || "respond",
          reasoning: decision.reasoning || "无分析",
          candidateWorkContextId: decision.candidateWorkContextId,
          confidence: decision.confidence || "low",
          response: decision.response,
        };
      }
    } catch {
      // JSON 解析失败
    }

    return {
      action: "respond",
      reasoning: "无法解析决策",
      confidence: "low",
      response: content.slice(0, 500),
    };
  }

  // 构建第二步的 System Prompt
  private buildSecondStepSystemPrompt(availableAgents: AgentCapabilitySummary[]): string {
    const agentDescriptions = availableAgents
      .map(
        (agent) => {
          const pluginsInfo = agent.plugins && agent.plugins.length > 0
            ? `\n    拥有插件: ${agent.plugins.map((p) => `${p.name}(${p.pluginId}) - ${p.description}`).join("\n             ")}`
            : "";
          return `- ${agent.agentId}: ${agent.name}
    描述: ${agent.description}
    能力: ${agent.capabilities.join(", ")}${pluginsInfo}`;
        }
      )
      .join("\n");

    return `你是 AI Agent OS 的主 Agent（Orchestrator），拥有上帝视角，负责理解用户意图并智能协调多个子 Agent 完成复杂任务。

## 可用子 Agent 及其技能
${agentDescriptions}

## 你的核心职责

### 1. 任务分析
- 深度理解用户意图，识别显性和隐性需求
- 判断任务复杂度：单 Agent 可完成 vs 需要多 Agent 协作
- 识别任务依赖关系：哪些步骤必须串行，哪些可以并行

### 2. 智能分工（关键）
基于子 Agent 的技能进行最优分工：

**分工原则：**
- 专业匹配：根据 Agent 的 capabilities 选择最擅长的
- 能力互补：复杂任务拆分给不同 Agent，各取所长
- 依赖排序：有依赖关系的任务按顺序委派
- 避免重复：同一类任务尽量交给同一个 Agent

### 3. 执行监控
- 跟踪每个子 Agent 的执行状态
- 判断子 Agent 返回结果是否满足预期
- 决定：继续下一步 / 重试 / 换 Agent / 向用户汇报

### 4. 结果整合
- 汇总多 Agent 执行结果
- 生成连贯的用户回复
- 记录执行链路便于追溯

## 输出格式
你必须以 JSON 格式输出决策：`;
  }

  // 构建第二步的 User Prompt
  private buildSecondStepUserPrompt(
    context: PromptContext,
    workContextDetail: WorkContextDetail
  ): string {
    // 构建执行历史摘要
    const executionHistory = workContextDetail.recentRuns
      .map(
        (run, index) =>
          `${index + 1}. ${run.runId} (${run.status}): ${run.resultSummary?.slice(0, 100) || "无结果"}...`
      )
      .join("\n");

    return `## 用户消息
"""${context.userMessage}"""

## 确认的 WorkContext
- ID: ${workContextDetail.workContextId}
- 标题: ${workContextDetail.title}
- 目标: ${workContextDetail.goal}
- 状态: ${workContextDetail.status}
- 创建时间: ${workContextDetail.createdAt}

## 执行历史（最近 ${workContextDetail.recentRuns.length} 次）
${executionHistory || "暂无执行记录"}

## 当前上下文
${context.sessionDescription ? `会话目标: ${context.sessionDescription}\n` : ""}

请做最终决策：如何执行这个任务？`;
  }

  // 解析决策
  private parseDecision(content: string, context: PromptContext): OrchestrationDecision {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const decision = JSON.parse(jsonMatch[0]);
        return {
          action: decision.action || "respond",
          reasoning: decision.reasoning || "无分析",
          targetAgentId: decision.targetAgentId,
          workContextId: decision.workContextId,
          handoffNote: decision.handoffNote,
          response: decision.response,
        };
      }
    } catch {
      // JSON 解析失败
    }

    // 如果解析失败，返回一个默认的 respond 决策
    return {
      action: "respond",
      reasoning: "无法解析决策",
      response: content.slice(0, 500),
    };
  }

  // 决策后续行动（子 Agent 执行完成后）
  async decideFollowUp(
    promptContext: PromptContext,
    availableAgents: AgentCapabilitySummary[]
  ): Promise<{
    action: "delegate" | "clarify" | "respond";
    reasoning: string;
    targetAgentId?: string;
    handoffNote?: string;
    response?: string;
  }> {
    console.log(`[MainAgent] 后续决策开始`);
    console.log(`[MainAgent] 执行历史数: ${promptContext.executionHistory?.length || 0}`);

    const systemPrompt = this.buildFollowUpSystemPrompt(availableAgents);
    const userPrompt = this.buildFollowUpUserPrompt(promptContext);

    const response = await this.modelClient.complete({
      systemPrompt,
      userMessage: userPrompt,
      temperature: 0.3,
    });

    const decision = this.parseFollowUpDecision(response.content);

    console.log(`[MainAgent] 后续决策完成`);
    console.log(`[MainAgent] Action: ${decision.action}`);
    console.log(`[MainAgent] TargetAgentId: ${decision.targetAgentId || "无"}`);

    return decision;
  }

  // 构建后续决策的 System Prompt
  private buildFollowUpSystemPrompt(availableAgents: AgentCapabilitySummary[]): string {
    const agentDescriptions = availableAgents
      .map(
        (agent) => `- ${agent.agentId}: ${agent.name}
    描述: ${agent.description}
    能力: ${agent.capabilities.join(", ")}`
      )
      .join("\n");

    return `你是 AI Agent OS 的主 Agent（Orchestrator），负责判断子 Agent 执行完成后是否需要进一步行动。

## 可用子 Agent
${agentDescriptions}

## 你的任务
基于执行历史和用户原始请求，判断：
1. 任务是否已完成？
2. 是否需要继续委派给其他 Agent？
3. 是否需要向用户确认或澄清？

## 输出格式
{\n  "action": "delegate | clarify | respond",\n  "reasoning": "分析过程",\n  "targetAgentId": "下一个 Agent ID（action=delegate 时）",\n  "handoffNote": "传递给下一个 Agent 的说明",\n  "response": "当 action=respond 或 clarify 时的回复内容"\n}

## 判断规则
- action=delegate → 任务未完成，需要继续委派
- action=clarify → 需要用户确认或提供更多信息
- action=respond → 任务已完成或需要向用户汇报结果`;
  }

  // 构建后续决策的 User Prompt
  private buildFollowUpUserPrompt(context: PromptContext): string {
    const executionHistory = context.executionHistory
      ?.map(
        (item, index) =>
          `${index + 1}. ${item.agentId}: ${item.result.slice(0, 150)}...`
      )
      .join("\n");

    return `## 用户原始请求
"""${context.userMessage}"""

## 已执行的子 Agent
${executionHistory || "暂无执行记录"}

## 当前会话目标
${context.sessionDescription || "无特定目标"}

请判断：接下来应该做什么？`;
  }

  // 解析后续决策
  private parseFollowUpDecision(content: string): {
    action: "delegate" | "clarify" | "respond";
    reasoning: string;
    targetAgentId?: string;
    handoffNote?: string;
    response?: string;
  } {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const decision = JSON.parse(jsonMatch[0]);
        return {
          action: decision.action || "respond",
          reasoning: decision.reasoning || "无分析",
          targetAgentId: decision.targetAgentId,
          handoffNote: decision.handoffNote,
          response: decision.response,
        };
      }
    } catch {
      // JSON 解析失败
    }

    return {
      action: "respond",
      reasoning: "无法解析决策",
      response: content.slice(0, 500),
    };
  }

  // 构建委派信封
  async buildDelegateEnvelope(params: {
    targetAgentId: string;
    userMessage: string;
    handoffNote?: string;
    executionHistory?: Array<{ agentId: string; result: string }>;
  }): Promise<{ targetAgentId: string; userMessage: string; handoffNote?: string; executionHistory?: Array<{ agentId: string; result: string }> }> {
    console.log(`[MainAgent] 构建委派信封: target=${params.targetAgentId}`);

    return {
      targetAgentId: params.targetAgentId,
      userMessage: params.userMessage,
      handoffNote: params.handoffNote,
      executionHistory: params.executionHistory,
    };
  }

  /**
   * 审查步骤执行结果
   */
  async reviewStepOutcome(input: {
    originalUserMessage: string;
    currentPlan: ExecutionPlan;
    currentStep: ExecutionPlan["steps"][number];
    taskEnvelope: TaskEnvelope;
    agentResult: AgentResult;
    ruleEvaluation: StepEvaluation;
    stepResultsSoFar: Array<{
      stepUid: string;
      agentUid: string;
      runUid: string;
      status: string;
      summary: string;
      issues?: string[];
    }>;
  }): Promise<StepOutcomeReview> {
    const systemPrompt = this.buildStepReviewSystemPrompt();
    const userPrompt = JSON.stringify(
      {
        originalUserMessage: input.originalUserMessage,
        currentPlan: {
          planUid: input.currentPlan.planUid,
          mode: input.currentPlan.mode,
          stepsCount: input.currentPlan.steps.length,
        },
        currentStep: {
          stepUid: input.currentStep.stepUid,
          targetAgentUid: input.currentStep.targetAgentUid,
          objective: input.currentStep.objective,
          expectedResultKind: input.currentStep.expectedResultKind,
          requireVerification: input.currentStep.requireVerification,
        },
        taskEnvelope: {
          objective: input.taskEnvelope.objective,
          expectedResult: input.taskEnvelope.expectedResult,
        },
        agentResult: {
          status: input.agentResult.status,
          summary: input.agentResult.summary,
          openIssues: input.agentResult.openIssues,
          touchedResources: input.agentResult.touchedResources,
        },
        ruleEvaluation: input.ruleEvaluation,
        stepResultsSoFar: input.stepResultsSoFar,
      },
      null,
      2
    );

    console.log(`[MainAgent][reviewStepOutcome] userPrompt length=${userPrompt.length}`);
    console.log(`[MainAgent][reviewStepOutcome] userPrompt content: ${userPrompt.substring(0, 3000)}`);

    const response = await this.modelClient.complete({
      systemPrompt,
      userMessage: userPrompt,
      temperature: 0.3,
    });

    console.log(`[MainAgent][reviewStepOutcome] model response length=${response.content.length}`);
    console.log(`[MainAgent][reviewStepOutcome] model response content: ${response.content.substring(0, 3000)}`);

    return this.parseStepOutcomeReview(response.content);
  }

  private buildStepReviewSystemPrompt(): string {
    return `你是步骤执行结果审查器。

你的任务是基于规则引擎的评估结果，决定如何处理当前步骤的执行结果。

## 输入信息
1. originalUserMessage: 用户的原始请求
2. currentPlan: 当前执行计划概览
3. currentStep: 当前步骤信息
4. taskEnvelope: 任务信封内容
5. agentResult: 子 Agent 的执行结果
6. ruleEvaluation: 规则引擎的评估结果（issues, shouldRetry, canContinue）
7. stepResultsSoFar: 之前步骤的执行结果

## 输出格式（JSON）
{
  "decision": "continue | retry_same_agent | replan_remaining | ask_user | fail",
  "safeToUseProducedRefs": true | false,
  "issues": ["问题1", "问题2"],
  "confidence": "high | medium | low",
  "reasoning": "分析理由",
  "retryInstruction": "重试时的具体指示（decision=retry_same_agent 时）",
  "replanInstruction": "重新规划时的指示（decision=replan_remaining 时）",
  "userQuestion": "询问用户的问题（decision=ask_user 时）",
  "finalMessage": "最终返回给用户的消息（decision=fail 时）"
}

## 决策规则
1. decision=continue: 步骤执行成功，可以继续下一步
   - 当 ruleEvaluation.shouldRetry=false 且结果满足预期
   - safeToUseProducedRefs=true

2. decision=retry_same_agent: 需要重试当前步骤
   - 当 ruleEvaluation.shouldRetry=true 且未达到最大重试次数
   - 提供具体的 retryInstruction 说明如何修复

3. decision=replan_remaining: 需要重新规划剩余步骤
   - 当当前步骤成功但后续计划需要调整
   - 或当前步骤失败但可以通过调整计划继续

4. decision=ask_user: 向用户询问，暂停执行
   - 当需要用户确认或提供额外信息
   - 提供清晰的 userQuestion

5. decision=fail: 停止执行，向用户报告失败
   - 当重试次数已达上限
   - 当问题无法自动解决，需要用户介入
   - 提供清晰的 finalMessage 说明情况

## 安全判断
- safeToUseProducedRefs=true: 步骤结果可信，可以传递给后续步骤
- safeToUseProducedRefs=false: 步骤结果有问题，不应传递给后续步骤

## 注意事项
- 如果 agentResult.status=failed，优先考虑 retry 或 stop
- 如果存在 openIssues，需要评估是否影响后续步骤
- 如果 touchedResources 包含未验证的写入操作，需要谨慎`;
  }

  private parseStepOutcomeReview(content: string): StepOutcomeReview {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const jsonStr = jsonMatch[0];
        console.log(`[MainAgent][parseStepOutcomeReview] extracted JSON length=${jsonStr.length}`);
        console.log(`[MainAgent][parseStepOutcomeReview] JSON content: ${jsonStr.substring(0, 2000)}`);

        const parsed = JSON.parse(jsonStr);
        console.log(`[MainAgent][parseStepOutcomeReview] JSON parsed successfully`);

        const validated = stepOutcomeReviewSchema.safeParse(parsed);
        if (validated.success) {
          console.log(`[MainAgent][parseStepOutcomeReview] schema validation passed`);
          return validated.data;
        } else {
          console.warn(`[MainAgent][parseStepOutcomeReview] schema validation failed:`, validated.error);
        }
      } else {
        console.warn(`[MainAgent][parseStepOutcomeReview] no JSON match found in content`);
        console.log(`[MainAgent][parseStepOutcomeReview] raw content: ${content.substring(0, 2000)}`);
      }
    } catch (error) {
      console.error(`[MainAgent][parseStepOutcomeReview] JSON parse error:`, error);
      console.log(`[MainAgent][parseStepOutcomeReview] raw content: ${content.substring(0, 2000)}`);
    }

    // 返回默认的保守决策
    return {
      decision: "fail",
      safeToUseProducedRefs: false,
      issues: ["无法解析审查结果"],
      confidence: "low",
      reasoning: "StepOutcomeReview JSON parse failed.",
      finalMessage: "步骤审查失败，请检查执行结果。",
    };
  }

  /**
   * 生成最终结果摘要
   */
  async generateFinalResultSummary(input: {
    originalUserMessage: string;
    plan: ExecutionPlan;
    stepResults: Array<{
      stepUid: string;
      agentUid: string;
      runUid: string;
      status: string;
      summary: string;
      issues?: string[];
      agentResult?: AgentResult;
    }>;
    allProducedArtifacts: Array<{ artifactUid: string; title: string }>;
  }): Promise<FinalResultSummary> {
    const systemPrompt = this.buildFinalSummarySystemPrompt();
    const userPrompt = JSON.stringify(
      {
        originalUserMessage: input.originalUserMessage,
        planMode: input.plan.mode,
        stepsCount: input.plan.steps.length,
        stepResults: input.stepResults.map((s) => ({
          stepUid: s.stepUid,
          agentUid: s.agentUid,
          status: s.status,
          summary: s.summary,
          issues: s.issues,
        })),
        producedArtifacts: input.allProducedArtifacts,
      },
      null,
      2
    );

    const response = await this.modelClient.complete({
      systemPrompt,
      userMessage: userPrompt,
      temperature: 0.5,
    });

    return this.parseFinalResultSummary(response.content);
  }

  private buildFinalSummarySystemPrompt(): string {
    return `你是执行结果汇总器。

你的任务是基于多步骤执行的结果，生成一个清晰、完整的最终回复。

## 输入信息
1. originalUserMessage: 用户的原始请求
2. planMode: 执行计划模式
3. stepsCount: 总步骤数
4. stepResults: 每个步骤的执行结果
5. producedArtifacts: 产生的所有产物

## 输出格式（JSON）
{
  "status": "success | partial_success | failed",
  "finalAnswer": "给用户的最终回复（支持 Markdown）",
  "openIssues": ["问题1", "问题2"],
  "reasoning": "生成摘要的内部理由"
}

## 汇总原则
1. finalAnswer 应该：
   - 直接回答用户的原始请求
   - 总结所有步骤的执行结果
   - 提及产生的关键产物
   - 说明任何遗留问题

2. status 判断：
   - success: 所有步骤都成功，结果完整
   - partial_success: 大部分成功，有小问题
   - failed: 有失败步骤或重要问题未解决

3. openIssues 应该：
   - 列出所有未解决的问题或需要注意的事项
   - 如果没有问题，使用空数组`;
  }

  private parseFinalResultSummary(content: string): FinalResultSummary {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const validated = finalResultSummarySchema.safeParse(parsed);
        if (validated.success) {
          return validated.data;
        }
      }
    } catch {
      // 解析失败
    }

    // 返回默认结果
    return {
      status: "partial_success",
      finalAnswer: "执行完成，但无法生成详细摘要。",
      openIssues: ["无法解析最终结果摘要"],
      reasoning: "FinalResultSummary JSON parse failed.",
    };
  }
}
