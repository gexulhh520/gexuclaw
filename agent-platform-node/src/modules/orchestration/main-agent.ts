import { ModelClient } from "../../runtime/model-client.js";
import type { ChatMessage } from "../../runtime/model-client.js";
import { makeUid } from "../../shared/ids.js";
import {
  mainPlanningDecisionSchema,
  domainAgentPlanSchema,
  type MainPlanningDecision,
  type DomainAgentPlan,
  type DomainPlanStep,
} from "./domain-agent-planning.schema.js";
import {
  domainStepReviewSchema,
  type DomainStepReview,
} from "./domain-step-review.schema.js";
import type { AgentResult } from "../../runtime/agent-result.js";

export type CandidateDomainAgent = {
  agentUid: string;
  name: string;
  description: string;
  capabilities: string[];
  skillSummary: string;
};

export class MainAgent {
  private modelClient: ModelClient;

  constructor() {
    this.modelClient = new ModelClient();
  }

  /**
   * 领域Agent规划决策
   * 基于候选DomainAgent列表，选择最合适的Agent并生成粗粒度计划
   */
  async planWithDomainAgents(input: {
    userMessage: string;
    effectiveUserMessage: string;
    mainHistoryMessages: ChatMessage[];
    candidateAgents: CandidateDomainAgent[];
    sessionState: {
      currentStage?: string;
      recoverable?: boolean;
      lastMainSummary?: string;
      lastSelectedAgentUid?: string;
      lastSubAgentSummary?: string;
    };
  }): Promise<MainPlanningDecision> {
    console.log(`[MainAgent] planWithDomainAgents 开始`);
    console.log(`[MainAgent] 用户消息: ${input.userMessage.slice(0, 100)}...`);
    console.log(`[MainAgent] 候选Agent数量: ${input.candidateAgents.length}`);

    const systemPrompt = this.buildPlanningSystemPrompt(input.candidateAgents);

    const currentInput = {
      userMessage: input.userMessage,
      effectiveUserMessage: input.effectiveUserMessage,
      sessionState: input.sessionState,
    };

    console.log(`[MainAgent] 当前决策输入: ${JSON.stringify(currentInput, null, 2)}`);

    const raw = await this.modelClient.complete({
      systemPrompt,
      messages: [
        ...input.mainHistoryMessages,
        {
          role: "user",
          content: JSON.stringify(currentInput, null, 2),
        },
      ],
      temperature: 0.3,
    });

    const decision = await this.parsePlanningDecision(raw.content);

    console.log(`[MainAgent] 决策完成: ${decision.decisionType}`);
    console.log(`[MainAgent] Confidence: ${decision.confidence}`);
    console.log(`[MainAgent] Reasoning: ${decision.reasoning.slice(0, 200)}...`);

    return decision;
  }

  /**
   * 审查DomainAgent步骤执行结果
   */
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
  }): Promise<DomainStepReview> {
    console.log(`[MainAgent] reviewDomainStep 开始: ${input.currentStep.stepUid}`);

    const systemPrompt = this.buildReviewSystemPrompt();

    const reviewInput = {
      originalUserMessage: input.originalUserMessage,
      selectedAgent: input.selectedAgent,
      plan: {
        objective: input.plan.objective,
        steps: input.plan.steps.map((s) => ({
          stepUid: s.stepUid,
          objective: s.objective,
          expectedResult: s.expectedResult,
          doneCriteria: s.doneCriteria,
        })),
      },
      currentStep: input.currentStep,
      completedSteps: input.completedSteps,
      subAgentReport: input.subAgentReport,
    };

    const raw = await this.modelClient.complete({
      systemPrompt,
      userMessage: JSON.stringify(reviewInput, null, 2),
      temperature: 0.3,
    });

    const review = await this.parseStepReview(raw.content);

    console.log(`[MainAgent] 步骤审查完成: ${review.decision}`);
    console.log(`[MainAgent] 原因: ${review.reason.slice(0, 200)}...`);

    return review;
  }

  /**
   * 汇总DomainAgent计划执行结果
   */
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
  }): Promise<string> {
    console.log(`[MainAgent] summarizeDomainPlanResult 开始`);

    const systemPrompt = `你是主Agent，负责汇总领域Agent的执行结果并生成最终用户回复。

## 你的职责
1. 基于原始用户请求和所有完成的步骤，生成连贯的总结
2. 突出关键成果和产物
3. 如果有未解决的问题，明确告知用户
4. 保持简洁，避免技术细节

## 输出要求
- 直接输出回复文本，不要JSON格式
- 使用用户友好的语言
- 包含执行结果的核心信息`;

    const summaryInput = {
      originalUserMessage: input.originalUserMessage,
      selectedAgent: input.selectedAgent,
      planObjective: input.plan.objective,
      completedSteps: input.completedSteps,
    };

    const raw = await this.modelClient.complete({
      systemPrompt,
      userMessage: JSON.stringify(summaryInput, null, 2),
      temperature: 0.5,
    });

    console.log(`[MainAgent] 汇总完成`);

    return raw.content.trim();
  }

  private buildPlanningSystemPrompt(candidateAgents: CandidateDomainAgent[]): string {
    const agentDescriptions = candidateAgents
      .map((agent) => {
        const capabilities = agent.capabilities?.length
          ? agent.capabilities.join(", ")
          : "无";
        const skillSummary = agent.skillSummary
          ? `技能摘要: ${agent.skillSummary.slice(0, 300)}`
          : "";

        return `- ${agent.agentUid}: ${agent.name}
  描述: ${agent.description.slice(0, 200)}
  能力: ${capabilities}
  ${skillSummary}`;
      })
      .join("\n\n");

    const jsonContract = this.getPlanningJsonContract();

    return `你是主Agent（MainAgent），负责领域路由和任务规划。

## 你的职责
1. 判断用户任务属于哪个领域
2. 从候选DomainAgent中选择一个最合适的
3. 生成粗粒度执行计划（1-6个步骤）
4. 决定是否可以直接回复用户或需要询问用户

## 候选DomainAgent列表
${agentDescriptions || "无可用Agent"}

## 核心原则
- 一次任务只选一个DomainAgent
- 不处理具体工具调用细节
- 不读取refs/relations/artifact内容
- 计划步骤是粗粒度业务步骤，不是具体工具调用

## 决策类型
1. answer_directly: 可以直接回答用户，不需要执行
2. ask_user: 需要用户补充信息
3. execute_plan: 需要执行计划，必须选择DomainAgent并生成plan

## 输出JSON格式
${jsonContract}

## 规则
- answer_directly时response必须有值，plan为null
- ask_user时question必须有值，plan为null
- execute_plan时selectedAgentUid必须来自候选列表，plan必须有效
- plan.steps只能是粗粒度业务步骤，不允许出现具体工具调用细节
- confidence表示决策置信度
- reasoning简要说明决策理由，不超过300字`;
  }

  private getPlanningJsonContract(): string {
    return `{
  "decisionType": "answer_directly | ask_user | execute_plan",
  "selectedAgentUid": "string | null",
  "response": "string | null",
  "question": "string | null",
  "plan": {
    "planUid": "string",
    "selectedAgentUid": "string",
    "objective": "string",
    "steps": [
      {
        "stepUid": "string",
        "objective": "string",
        "expectedResult": "answer | artifact | file_change | diagnosis | verification",
        "doneCriteria": "string",
        "requireReview": true
      }
    ]
  } | null,
  "confidence": "high | medium | low",
  "reasoning": "string"
}`;
  }

  private buildReviewSystemPrompt(): string {
    return `你是主Agent，负责审查DomainAgent步骤执行结果并决定下一步行动。

## 输入信息
- originalUserMessage: 用户原始请求
- selectedAgent: 当前执行的DomainAgent信息
- plan: 完整计划（包含所有步骤）
- currentStep: 当前执行的步骤
- completedSteps: 已完成的步骤摘要
- subAgentReport: DomainAgent的执行报告

## 决策选项
1. step_done: 当前步骤完成，但计划还有后续步骤
2. continue_next_step: 继续执行下一步（当前步骤成功且无阻塞）
3. retry_current_step: 当前步骤需要重试
4. replan_remaining: 需要重新规划剩余步骤
5. ask_user: 需要用户介入/确认
6. fail: 任务失败，无法继续

## 输出JSON格式
{
  "decision": "step_done | continue_next_step | retry_current_step | replan_remaining | ask_user | fail",
  "reason": "string",
  "retryInstruction": "string | null",
  "replanInstruction": "string | null",
  "userQuestion": "string | null"
}

## 规则
- retry_current_step时retryInstruction必须有值，说明如何重试
- replan_remaining时replanInstruction必须有值，说明重新规划的原因和方向
- ask_user时userQuestion必须有值
- reason简要说明决策理由`;
  }

  private async parsePlanningDecision(content: string): Promise<MainPlanningDecision> {
    const json = this.extractJsonObject(content);
    const parsed = mainPlanningDecisionSchema.safeParse(json);

    if (parsed.success) {
      return parsed.data;
    }

    console.warn(`[MainAgent] PlanningDecision解析失败，尝试修复: ${parsed.error.message}`);

    return this.repairPlanningDecision(content, parsed.error);
  }

  private async parseStepReview(content: string): Promise<DomainStepReview> {
    const json = this.extractJsonObject(content);
    const parsed = domainStepReviewSchema.safeParse(json);

    if (parsed.success) {
      return parsed.data;
    }

    console.warn(`[MainAgent] StepReview解析失败，使用默认值`);

    return {
      decision: "ask_user",
      reason: `解析失败: ${parsed.error.message}`,
      retryInstruction: null,
      replanInstruction: null,
      userQuestion: "执行结果解析出现问题，请确认如何继续。",
    };
  }

  private async repairPlanningDecision(
    badOutput: string,
    zodError: import("zod").ZodError
  ): Promise<MainPlanningDecision> {
    const contract = this.getPlanningJsonContract();

    const repairPrompt = `你是JSON修复器。只修复格式，不重新做业务决策。

必须满足以下JSON合约：
${contract}

Zod校验错误：
${zodError.message}

原始输出：
${badOutput}`;

    try {
      const repairResult = await this.modelClient.complete({
        systemPrompt: repairPrompt,
        userMessage: "请返回修复后的JSON。只输出JSON object。",
        temperature: 0,
      });

      const json = this.extractJsonObject(repairResult.content);
      const repaired = mainPlanningDecisionSchema.safeParse(json);

      if (repaired.success) {
        console.log("[MainAgent] PlanningDecision修复成功");
        return repaired.data;
      }

      console.warn("[MainAgent] 修复后仍不合法:", repaired.error.message);
    } catch (error) {
      console.warn("[MainAgent] 修复调用失败:", error);
    }

    return {
      decisionType: "ask_user",
      selectedAgentUid: null,
      response: null,
      question: "我需要确认一下你的意图，请补充更多信息。",
      plan: null,
      confidence: "low",
      reasoning: "PlanningDecision JSON解析失败。",
    };
  }

  private extractJsonObject(content: string): unknown {
    const trimmed = content.trim();
    if (trimmed.startsWith("{")) {
      try {
        return JSON.parse(trimmed);
      } catch {
        // 尝试提取JSON块
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
}
