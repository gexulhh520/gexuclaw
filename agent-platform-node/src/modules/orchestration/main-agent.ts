import { ModelClient } from "../../runtime/model-client.js";
import { makeUid } from "../../shared/ids.js";
import type { OrchestrationDecision, DelegateEnvelope } from "./orchestration.schema.js";
import type { PromptContext, AgentCapabilitySummary, WorkContextDetail } from "./context-builder.js";
import { mainDecisionSchema } from "./main-decision.schema.js";
import type { SessionRuntimeSnapshot, SessionContextIndex, MainDecision, MainDecisionInput } from "./orchestration.types.js";
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
   * 基于 SessionRuntimeSnapshot + SessionContextIndex 做结构化决策
   * 输出 MainDecision JSON
   */
  async decideWithSessionIndex(input: {
    userMessage: string;
    snapshot: SessionRuntimeSnapshot;
    contextIndex: SessionContextIndex;
  }): Promise<MainDecision> {
    console.log(`[MainAgent] decideWithSessionIndex 开始`);
    console.log(`[MainAgent] 用户消息: ${input.userMessage.slice(0, 100)}...`);
    console.log(`[MainAgent] WorkContext数量: ${input.snapshot.workContexts.length}`);
    console.log(`[MainAgent] Refs数量: ${input.contextIndex.refs.length}`);

    const systemPrompt = this.buildMainDecisionSystemPrompt();
    const decisionInput = this.buildMainDecisionInput(input);

    const raw = await this.modelClient.complete({
      systemPrompt,
      userMessage: JSON.stringify(decisionInput, null, 2),
      temperature: 0.1,
    });

    const decision = await this.parseMainDecision(raw.content);

    console.log(`[MainAgent] 决策完成: ${decision.decisionType}`);
    console.log(`[MainAgent] Confidence: ${decision.confidence}`);
    console.log(`[MainAgent] Reasoning: ${decision.reasoning.slice(0, 200)}...`);
    console.log(`[MainAgent] 完整决策结果:\n${JSON.stringify(decision, null, 2)}`);

    return decision;
  }

  private buildMainDecisionInput(input: {
    userMessage: string;
    snapshot: SessionRuntimeSnapshot;
    contextIndex: SessionContextIndex;
  }): MainDecisionInput {
    return {
      userMessage: input.userMessage,
      selectedWorkContextUid: input.snapshot.selectedWorkContextUid ?? null,
      workContexts: input.snapshot.workContexts.map((wc) => ({
        workContextUid: wc.workContextUid,
        title: this.truncateText(wc.title, 100),
        summary: this.truncateText(wc.summary || wc.goal || "", 300),
        currentStage: wc.currentStage,
        progressSummary: this.truncateText(wc.progressSummary, 300),
        currentFocus: wc.currentFocus ?? null,
        recentRefs: wc.recentRefs ?? wc.topRefs?.map((r) => r.refId) ?? [],
        openIssues: wc.openIssues ?? [],
        signals: {
          selectedInUI: wc.signals.selectedInUI,
          recentlyActive: wc.signals.recentlyActive,
          hasFailedRun: wc.signals.hasFailedRun,
          hasOpenIssue: wc.signals.hasOpenIssue,
          hasRecentArtifact: wc.signals.hasRecentArtifact,
          hasUnverifiedSideEffect: wc.signals.hasUnverifiedSideEffect,
        },
      })),
      refs: this.truncateRefsForDecision(input.contextIndex.refs),
      relations: input.contextIndex.relations,
      availableAgents: input.snapshot.availableAgents.map((agent) => ({
        agentUid: agent.agentUid,
        name: agent.name,
        description: this.truncateText(agent.description, 200),
        capabilities: agent.capabilities,
      })),
    };
  }

  private truncateRefsForDecision(refs: SessionContextIndex["refs"]): SessionContextIndex["refs"] {
    const MAX_SUMMARY_LENGTH = 300;
    const MAX_TITLE_LENGTH = 100;

    return refs.map((ref) => ({
      ...ref,
      title: this.truncateText(ref.title, MAX_TITLE_LENGTH),
      summary: this.truncateText(ref.summary, MAX_SUMMARY_LENGTH),
    }));
  }

  private truncateText(text: string | undefined | null, maxLength: number): string {
    if (!text) return "";
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + "...";
  }

  private getMainDecisionJsonContract(): string {
    return `MainDecision JSON 必须包含以下所有顶层字段：

{
  "decisionType": "answer_directly | create_work_context | use_existing_work_context | switch_work_context | delegate | multi_step_plan | ask_user | explain_trace | verify_execution | recover_execution",
  "targetWorkContextUid": "string or null",
  "createWorkContext": {
    "title": "string",
    "goal": "string"
  } 或 null,
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
    "candidateWorkContextUids": ["string"],
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
4. targetWorkContextUid 如果不为 null，必须来自输入 workContexts。
5. createWorkContext 只有在需要新建 WorkContext 时填写，否则为 null。
6. plan 只有执行型决策填写，否则为 null。
7. response 只有 answer_directly 填写，否则为 null。
8. ambiguity 只有 ask_user 填写，否则为 null。
9. 不要创造额外字段。`;
  }

  private getAskUserFallbackExample(): string {
    return `{
  "decisionType": "ask_user",
  "targetWorkContextUid": null,
  "createWorkContext": null,
  "primaryRefs": [],
  "secondaryRefs": [],
  "targetAgentUid": null,
  "plan": null,
  "response": null,
  "ambiguity": {
    "candidateWorkContextUids": [],
    "candidateRefIds": [],
    "question": "请确认你要继续处理哪一项。"
  },
  "confidence": "low",
  "reasoning": "需要用户澄清。"
}`;
  }

  private buildMainDecisionSystemPrompt(): string {
    const contract = this.getMainDecisionJsonContract();
    const fallbackExample = this.getAskUserFallbackExample();

    return `你是主 Agent 的结构化决策器，不是执行器。

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

${contract}

如果无法确定意图，输出这个 ask_user fallback 结构：

${fallbackExample}

createWorkContext 为 null 的示例（使用已有 WorkContext）：
{
  "createWorkContext": null
}

createWorkContext 有值的示例（新建 WorkContext）：
{
  "createWorkContext": {
    "title": "查看项目登录逻辑",
    "goal": "搜索并解释项目登录入口、认证流程、token 生成和鉴权中间件"
  }
}

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
15. create_work_context 允许 plan 为 null，表示只创建上下文、不立即执行。
16. reasoning 只写简短内部理由，不要超过 300 字。
17. 你不能生成新的 workContextUid。
18. targetWorkContextUid 只能来自输入 workContexts[].workContextUid。
19. 如果这是新任务，或者输入 workContexts 中没有合适对象：
    - targetWorkContextUid 必须为 null
    - createWorkContext 必须填写 title 和 goal
    - decisionType 可以是 create_work_context、delegate 或 multi_step_plan
    - 真实 workContextUid 由系统代码创建，不由你生成
20. 任何形如 wc_xxx、work_context_xxx 的新 ID 都禁止由你生成。
21. 如果需要执行任务但 targetWorkContextUid 为 null，必须填写 createWorkContext。
22. 如果用户任务需要执行，但 availableAgents 中没有任何 Agent 能完成该任务，可以输出 decisionType=create_work_context，targetWorkContextUid=null，createWorkContext 填写 title/goal，plan=null，并在 reasoning 中说明缺少合适执行器。
23. **多步骤计划的关键规则**：
    - 如果 plan 中有多个 steps，后续步骤依赖前面步骤的结果时：
      - 前面步骤执行后会生成 run ref（格式：run:run_xxx）和可能的 artifact ref（格式：artifact:artifact_xxx）
      - 后续步骤的 inputRefIds 应该引用这些执行结果，而不是引用 Agent 本身
    - 示例：步骤1生成文案 → 步骤2保存文案
      - 错误：步骤2 inputRefIds: ["agent:agent_xxx"]（引用Agent，无法获取内容）
      - 正确：步骤2 inputRefIds: ["run:run_xxx"] 或 ["artifact:artifact_xxx"]（引用执行结果）
    - **首次规划时的特殊处理**：
      - 如果前面步骤还没有执行（没有 run/artifact 可用），可以引用目标 Agent 的 refId（格式：agent:agent_xxx）
      - 系统会自动将该 Agent 最近执行的 run 和 artifact 作为上下文传递给后续步骤
      - 这是一种 fallback 机制，优先使用 run/artifact refId，没有时才使用 agent refId`
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
      targetWorkContextUid: null,
      createWorkContext: null,
      primaryRefs: [],
      secondaryRefs: [],
      targetAgentUid: null,
      plan: null,
      response: null,
      ambiguity: {
        candidateWorkContextUids: [],
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
    console.log(`[MainAgent] 可用WorkContext数量: ${promptContext.workContexts.length}`);

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
    const workContextsInfo = context.workContexts
      .map(
        (ctx) => `- ${ctx.workContextId}: ${ctx.title}
    目标: ${ctx.goal}
    状态: ${ctx.status}`
      )
      .join("\n");

    // 会话协作描述
    const sessionCollaboration = context.sessionDescription
      ? `## 当前会话的协作目标\n${context.sessionDescription}\n`
      : "";

    return `## 用户消息
"""${context.userMessage}"""

${sessionCollaboration}
## 当前 Session 的 WorkContext 列表
${workContextsInfo || "暂无 WorkContext"}

## 当前选中的 WorkContext
${context.selectedWorkContext ? `- ${context.selectedWorkContext.workContextId}: ${context.selectedWorkContext.title}` : "无"}

请做初步匹配判断：用户意图与哪个 WorkContext 相关？置信度如何？`;
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
你必须以 JSON 格式输出决策：

{\n  "action": "delegate | clarify | respond",\n  "reasoning": "详细思考过程：任务分析、分工策略、Agent选择理由",\n  "workContextId": "确认使用的 WorkContext ID",\n  "targetAgentId": "选中的 Agent ID",\n  "handoffNote": "给子 Agent 的详细交接说明，包含上下文和期望",\n  "response": "当 action=respond 或 clarify 时的回复内容",\n  "nextSteps": "可选，预判的后续步骤"\n}

## 决策规则

### 何时 delegate（委派）
- 任务明确且需要特定技能
- 当前 Agent 可以推进任务
- 是多步骤任务中的一环

### 何时 clarify（追问）
- 用户意图不明确
- 缺少关键参数（如 URL、时间、范围）
- 多个 Agent 都可能适合，需要用户确认

### 何时 respond（直接回复）
- 简单问候或系统操作
- 任务已全部完成
- 需要向用户汇报执行结果

## WorkContext 管理
- 同一工作目标复用同一个 WorkContext
- 不同目标创建新的 WorkContext
- 通过 title/goal 判断相关性
- 记录执行历史便于追溯`;
  }

  // 构建第二步的 User Prompt
  private buildSecondStepUserPrompt(context: PromptContext, workContextDetail: WorkContextDetail): string {
    const recentRunsInfo = workContextDetail.recentRuns
      .map(
        (run) => `- Run ${run.runId}: Agent=${run.agentId}, 状态=${run.status}
    摘要: ${run.resultSummary || "无"}`
      )
      .join("\n") || "无最近执行记录";

    const artifactsInfo = workContextDetail.recentArtifacts
      .map(
        (art) => `- ${art.artifactType}: ${art.title}
    摘要: ${art.summary || "无"}`
      )
      .join("\n") || "无产物";

    // 会话协作描述
    const sessionCollaboration = context.sessionDescription
      ? `## 当前会话的协作目标\n${context.sessionDescription}\n`
      : "";

    return `## 用户消息
"""${context.userMessage}"""

${sessionCollaboration}## 确认的 WorkContext 详情
- ID: ${workContextDetail.workContextId}
- 标题: ${workContextDetail.title}
- 目标: ${workContextDetail.goal}
- 状态: ${workContextDetail.status}
- 当前阶段: ${workContextDetail.currentStage || "未设置"}
- 进度摘要: ${workContextDetail.progressSummary || "无"}
- 下一步: ${workContextDetail.nextAction || "未设置"}
- 总执行次数: ${workContextDetail.runCount}
- 创建时间: ${workContextDetail.createdAt}
- 更新时间: ${workContextDetail.updatedAt}

## 该 WorkContext 的最近执行记录
${recentRunsInfo}

## 该 WorkContext 的最近产物
${artifactsInfo}

基于以上详细信息，请做最终决策：
1. 确认是否使用此 WorkContext？
2. 选择哪个子 Agent 执行任务？
3. 如何分工和交接？`;
  }

  // 构建系统 Prompt
  private buildSystemPrompt(availableAgents: AgentCapabilitySummary[]): string {
    const agentDescriptions = availableAgents
      .map(
        (agent) => `- ${agent.agentId}: ${agent.name}
    描述: ${agent.description}
    能力: ${agent.capabilities.join(", ")}`
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

**分工示例：**
用户："访问百度并分析页面内容"
→ 分析：需要 浏览器操作 + 内容分析
→ 分工：browser_agent（访问）→ research_agent（分析）

用户："爬取商品信息并生成定时任务"
→ 分析：需要 数据采集 + 任务调度
→ 分工：browser_agent（爬取）→ scheduled_task_agent（生成定时任务）

### 3. 执行监控
- 跟踪每个子 Agent 的执行状态
- 判断子 Agent 返回结果是否满足预期
- 决定：继续下一步 / 重试 / 换 Agent / 向用户汇报

### 4. 结果整合
- 汇总多 Agent 执行结果
- 生成连贯的用户回复
- 记录执行链路便于追溯

## 输出格式
你必须以 JSON 格式输出决策：

{\n  "action": "delegate | clarify | respond",\n  "reasoning": "详细思考过程：任务分析、分工策略、Agent选择理由",\n  "workContextId": "复用的 WorkContext ID 或空",\n  "targetAgentId": "选中的 Agent ID",\n  "handoffNote": "给子 Agent 的详细交接说明，包含上下文和期望",\n  "response": "当 action=respond 或 clarify 时的回复内容",\n  "nextSteps": "可选，预判的后续步骤"\n}

## 决策规则

### 何时 delegate（委派）
- 任务明确且需要特定技能
- 当前 Agent 可以推进任务
- 是多步骤任务中的一环

### 何时 clarify（追问）
- 用户意图不明确
- 缺少关键参数（如 URL、时间、范围）
- 多个 Agent 都可能适合，需要用户确认

### 何时 respond（直接回复）
- 简单问候或系统操作
- 任务已全部完成
- 需要向用户汇报执行结果

## WorkContext 管理
- 同一工作目标复用同一个 WorkContext
- 不同目标创建新的 WorkContext
- 通过 title/goal 判断相关性
- 记录执行历史便于追溯`;
  }

  // 构建用户 Prompt
  private buildUserPrompt(context: PromptContext): string {
    const workContextsInfo = context.workContexts
      .map(
        (ctx) => `- ${ctx.workContextId}: ${ctx.title}
    目标: ${ctx.goal}
    状态: ${ctx.status}
    更新时间: ${ctx.updatedAt}`
      )
      .join("\n");

    const recentRunsInfo = context.recentRuns
      ?.map(
        (run) => `- Run ${run.runId}: Agent=${run.agentId}, 状态=${run.status}
    摘要: ${run.resultSummary || "无"}`
      )
      .join("\n") || "无最近执行记录";

    return `当前 Session: ${context.sessionId}

## 用户消息
"""${context.userMessage}"""

## 当前 Session 的 WorkContext 列表
${workContextsInfo || "暂无 WorkContext"}

## 最近的执行记录
${recentRunsInfo}

## 当前选中的 WorkContext
${context.selectedWorkContext ? `- ${context.selectedWorkContext.workContextId}: ${context.selectedWorkContext.title}` : "无"}

请根据以上信息，判断应该如何响应用户。`;
  }

  // 解析 LLM 决策响应
  private parseDecision(content: string, context: PromptContext): OrchestrationDecision {
    try {
      // 尝试提取 JSON
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const decision = JSON.parse(jsonMatch[0]) as OrchestrationDecision;
        return {
          ...decision,
          // 如果没有指定 workContextId 但有选中的，使用选中的
          workContextId: decision.workContextId || context.selectedWorkContext?.workContextId,
        };
      }
    } catch {
      // JSON 解析失败，使用默认决策
    }

    // 默认决策：直接回复
    return {
      action: "respond",
      reasoning: "无法解析决策，默认直接回复",
      response: content.slice(0, 500),
    };
  }

  // 生成 DelegateEnvelope
  createDelegateEnvelope(
    decision: OrchestrationDecision,
    sessionId: string,
    userMessage: string
  ): DelegateEnvelope {
    if (decision.action !== "delegate" || !decision.targetAgentId) {
      throw new Error("Cannot create DelegateEnvelope for non-delegate action");
    }

    return {
      delegateId: makeUid("delegate"),
      sourceAgentId: "main_agent",
      targetAgentId: decision.targetAgentId,
      mode: "subagent",
      workContextId: decision.workContextId || makeUid("work_context"),
      userMessage,
      handoffNote: decision.handoffNote || "请完成用户请求的任务",
      authority: {
        scope: "work_context",
        canRead: ["work_context", "run_trace", "artifact"],
        canWrite: ["agent_run", "agent_run_step", "artifact"],
      },
      expectedResult: "task_completion_or_clarification",
    };
  }

  // 子 Agent 执行完成后，主 Agent 判断是否继续委派
  async decideFollowUp(
    promptContext: PromptContext & { executionHistory?: Array<{ agentId: string; result: string }> },
    availableAgents: AgentCapabilitySummary[]
  ): Promise<OrchestrationDecision> {
    console.log(`[MainAgent] FollowUp决策开始`);
    console.log(`[MainAgent] 执行历史数量: ${promptContext.executionHistory?.length || 0}`);
    if (promptContext.executionHistory && promptContext.executionHistory.length > 0) {
      const lastResult = promptContext.executionHistory[promptContext.executionHistory.length - 1];
      console.log(`[MainAgent] 最新执行: ${lastResult.agentId}`);
      console.log(`[MainAgent] 最新结果: ${lastResult.result.slice(0, 100)}...`);
    }

    const systemPrompt = this.buildFollowUpSystemPrompt(availableAgents);
    const userPrompt = this.buildFollowUpUserPrompt(promptContext);

    const response = await this.modelClient.complete({
      systemPrompt,
      userMessage: userPrompt,
      temperature: 0.3,
    });

    const decision = this.parseDecision(response.content, promptContext);

    console.log(`[MainAgent] FollowUp决策完成`);
    console.log(`[MainAgent] FollowUpAction: ${decision.action}`);
    console.log(`[MainAgent] TargetAgentId: ${decision.targetAgentId || "无"}`);
    console.log(`[MainAgent] Reasoning: ${decision.reasoning?.slice(0, 200)}...`);

    return decision;
  }

  // 构建后续判断的 System Prompt
  private buildFollowUpSystemPrompt(availableAgents: AgentCapabilitySummary[]): string {
    const agentDescriptions = availableAgents
      .map(
        (agent) => `- ${agent.agentId}: ${agent.name}
    描述: ${agent.description}
    能力: ${agent.capabilities.join(", ")}`
      )
      .join("\n");

    return `你是 AI Agent OS 的主 Agent（Orchestrator），拥有上帝视角，负责分析子 Agent 执行结果并决定下一步行动。

## 可用子 Agent 及其技能
${agentDescriptions}

## 你的核心职责

### 1. 结果评估（关键）
深度分析子 Agent 返回的结果：
- **任务完成度**：结果是否满足用户原始需求？
- **质量评估**：结果是否完整、准确、可用？
- **阻塞识别**：是否遇到错误、异常或无法处理的情况？

### 2. 智能决策
基于评估结果，选择最优路径：

**路径 A: respond（直接回复）**
- 任务已完全满足用户需求
- 结果是最终答案，无需进一步处理
- 示例：browser_agent 成功访问百度并返回内容，用户只是要求"访问百度"

**路径 B: delegate（继续委派）**
- 当前结果只是中间产物，需要其他 Agent 继续处理
- 根据剩余任务选择最合适的 Agent
- 示例：browser_agent 获取页面 → research_agent 分析内容 → report_agent 生成报告

**路径 C: clarify（追问用户）**
- 执行结果不明确，需要用户确认
- 遇到错误或异常，需要用户决策
- 多个可能的下一步，需要用户选择

### 3. 分工优化
- 根据剩余任务选择技能最匹配的 Agent
- 避免重复委派同类 Agent
- 预判可能的后续步骤

## 输出格式
你必须以 JSON 格式输出决策：

{\n  "action": "delegate | clarify | respond",\n  "reasoning": "详细分析：任务完成度评估、结果质量、下一步决策理由",\n  "targetAgentId": "继续委派的目标 Agent ID",\n  "handoffNote": "详细的交接说明，包含当前结果摘要和下一步期望",\n  "response": "当 action=respond 或 clarify 时的回复内容",\n  "taskCompletion": "任务完成度评估：completed(完成) / partial(部分) / failed(失败)",\n  "nextSteps": "预判的后续步骤"\n}

## 决策规则

### 何时 respond（任务完成）
- 子 Agent 返回的结果完全满足用户原始需求
- 用户要求的是简单操作且已成功执行
- 所有必要的步骤都已完成

### 何时 delegate（继续分工）
- 当前只是数据/信息采集，还需要分析处理
- 需要转换格式（如原始数据→报告）
- 需要生成衍生产物（如定时任务、文档等）
- 有明显的前后依赖关系

### 何时 clarify（需要确认）
- 执行失败或返回错误
- 结果不符合预期，需要用户确认如何处理
- 缺少必要信息无法继续

## 示例场景

场景1：用户"访问百度"
- browser_agent 返回：已访问百度，页面内容...
- 评估：任务已完成
- 决策：respond "已成功访问百度，页面包含搜索框、热搜榜..."

场景2：用户"访问百度并分析热搜"
- browser_agent 返回：已访问百度，获取页面HTML
- 评估：需要提取和分析热搜内容
- 决策：delegate → research_agent "从页面中提取热搜榜单并分析"

场景3：用户"爬取商品信息并生成定时任务"
- browser_agent 返回：已爬取商品数据
- 评估：需要生成定时任务配置
- 决策：delegate → scheduled_task_agent "基于爬取的数据生成定时任务"`;
  }

  // 构建后续判断的 User Prompt
  private buildFollowUpUserPrompt(
    context: PromptContext & { executionHistory?: Array<{ agentId: string; result: string }> }
  ): string {
    const executionHistory = context.executionHistory
      ?.map(
        (item, index) => `${index + 1}. **${item.agentId}**\n   结果: ${item.result.slice(0, 400)}...`
      )
      .join("\n\n") || "无执行记录";

    const lastResult = context.executionHistory?.[context.executionHistory.length - 1];

    return `## 执行历史
${executionHistory}

## 最新执行结果（重点分析）
Agent: ${lastResult?.agentId || "无"}
结果: ${lastResult?.result.slice(0, 500) || "无"}...

## 当前 WorkContext
${context.selectedWorkContext
        ? `- 标题: ${context.selectedWorkContext.title}
- 目标: ${context.selectedWorkContext.goal}
- 状态: ${context.selectedWorkContext.status}
- 当前阶段: ${context.selectedWorkContext.currentStage || "未设置"}`
        : "无选中 WorkContext"
      }

## 用户原始请求
"""${context.userMessage}"""

## 请分析并决策

1. **结果评估**：最新执行结果的质量如何？是否满足用户需求？
2. **完成度判断**：任务完成了多少？还需要哪些步骤？
3. **下一步决策**：
   - 如果已完成 → respond 汇总结果
   - 如果需要其他 Agent → delegate 并说明选择理由
   - 如果不确定 → clarify 向用户确认

请给出详细的 reasoning 说明你的分析过程。`;
  }

  async reviewStepOutcome(input: {
    originalUserMessage: string;
    currentPlan: ExecutionPlan;
    currentStep: ExecutionPlan["steps"][0];
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
    const systemPrompt = this.buildStepOutcomeReviewSystemPrompt();

    const reviewInput = {
      originalUserMessage: input.originalUserMessage,
      currentStep: {
        stepUid: input.currentStep.stepUid,
        targetAgentUid: input.currentStep.targetAgentUid,
        objective: input.currentStep.objective,
        expectedResultKind: input.currentStep.expectedResultKind,
        requireVerification: input.currentStep.requireVerification,
        inputRefIds: input.currentStep.inputRefIds,
        dependsOn: input.currentStep.dependsOn,
      },
      taskEnvelope: {
        objective: input.taskEnvelope.objective,
        retryContext: input.taskEnvelope.retryContext ?? null,
        selectedContext: {
          refs: input.taskEnvelope.selectedContext.refs.map((ref) => ({
            refId: ref.refId,
            kind: ref.kind,
            title: ref.title,
            status: ref.status,
            summary: ref.summary,
          })),
          artifacts: input.taskEnvelope.selectedContext.artifacts.map((art) => ({
            refId: art.refId,
            title: art.title,
            artifactRole: art.artifactRole,
            summary: art.summary,
            contentPreview:
              art.contentText?.slice(0, 500) ??
              (art.contentJson ? JSON.stringify(art.contentJson).slice(0, 500) : undefined),
          })),
          files: input.taskEnvelope.selectedContext.files.map((file) => ({
            refId: file.refId,
            path: file.path,
            status: file.lastKnownStatus,
            operation: file.lastKnownOperation,
            summary: file.summary,
          })),
          resources: input.taskEnvelope.selectedContext.resources.map((resource) => ({
            refId: resource.refId,
            kind: resource.kind,
            uri: resource.uri,
            status: resource.lastKnownStatus,
            operation: resource.lastKnownOperation,
            summary: resource.summary,
          })),
        },
        expectedResult: input.taskEnvelope.expectedResult,
        constraints: input.taskEnvelope.constraints,
      },
      ruleEvaluation: input.ruleEvaluation,
      agentResult: {
        status: input.agentResult.status,
        summary: input.agentResult.summary,
        operations: input.agentResult.operations,
        producedArtifacts: input.agentResult.producedArtifacts,
        touchedResources: input.agentResult.touchedResources,
        openIssues: input.agentResult.openIssues,
        retryAdvice: input.agentResult.retryAdvice,
      },
      stepResultsSoFar: input.stepResultsSoFar,
    };

    const raw = await this.modelClient.complete({
      systemPrompt,
      userMessage: JSON.stringify(reviewInput, null, 2),
      temperature: 0,
    });

    const json = this.extractJsonObject(raw.content);
    const parsed = stepOutcomeReviewSchema.safeParse(json);

    if (parsed.success) {
      return parsed.data;
    }

    console.warn("[MainAgent] StepOutcomeReview parse failed:", parsed.error.message);

    return {
      decision: input.ruleEvaluation.status === "success" ? "continue" : "fail",
      confidence: "low",
      safeToUseProducedRefs: input.ruleEvaluation.status === "success",
      issues: [
        "StepOutcomeReview parse failed.",
        ...input.ruleEvaluation.issues,
      ],
      finalMessage:
        input.ruleEvaluation.status === "success"
          ? undefined
          : "步骤执行结果无法通过主 Agent 验收。",
      reasoning: "Fallback decision because StepOutcomeReview JSON parsing failed.",
    };
  }

  private buildStepOutcomeReviewSystemPrompt(): string {
    return `你是主 Agent 的 Step Outcome Reviewer，不是执行器。

你会收到：
1. 原始用户任务
2. 当前执行计划中的当前 step
3. 当前 TaskEnvelope
4. 子 Agent 执行后的 AgentResult
5. 系统基础规则验收 ruleEvaluation
6. 已完成 step 的简要结果

你的任务：
判断当前 step 是否可以被接受，以及下一步应该怎么做。

你必须只输出严格 JSON，不要 Markdown，不要代码块，不要解释性文字。

输出 JSON 格式：
{
  "decision": "continue | retry_same_agent | replan_remaining | ask_user | fail",
  "confidence": "high | medium | low",
  "safeToUseProducedRefs": true,
  "issues": ["string"],
  "retryInstruction": "string optional",
  "replanInstruction": "string optional",
  "userQuestion": "string optional",
  "finalMessage": "string optional",
  "reasoning": "string"
}

决策含义：
- continue：当前 step 可以接受，可以继续执行后续 step。
- retry_same_agent：当前 step 目标没有完成，但问题局部可修复，可以让同一个子 Agent 只修复当前 Objective。
- replan_remaining：当前计划、输入 refs、上下文或结果不可靠，需要重新规划当前 step 或剩余步骤。
- ask_user：缺少必须由用户确认的信息。
- fail：不可恢复失败。

核心判断规则：
1. 不要只相信子 Agent 的 final answer，必须优先相信工具事实、AgentResult、touchedResources、producedArtifacts、openIssues。
2. 如果 ruleEvaluation 有问题，必须结合语义判断是否真的影响后续。
3. 如果 expectedResultKind=artifact，但没有 producedArtifacts：
   - 如果只是忘记声明 artifact，且业务内容可靠，可以 retry_same_agent。
   - 如果业务内容本身不可靠或来源污染，replan_remaining。
4. 如果 expectedResultKind=file_change：
   - 工具事实证明目标资源被正确修改且 verified=true，可以 continue。
   - 如果只是日志结构缺失但工具事实足够明确，可以 continue，但 safeToUseProducedRefs 必须谨慎判断。
5. 如果子 Agent 使用了 TaskEnvelope 明确输入之外的资源替代指定输入，通常必须 replan_remaining，safeToUseProducedRefs=false。
6. 如果指定输入 refs 缺失、失效、读取失败，且子 Agent 又寻找其他文件替代，必须 replan_remaining，safeToUseProducedRefs=false。
7. 如果结果可能被错误上下文污染，必须 safeToUseProducedRefs=false。
8. retry_same_agent 只能用于局部格式修复或轻微遗漏，不能用于让 Agent 扩展任务范围。
9. retryInstruction 必须明确约束：只修复当前 Objective，不要执行其他 step，不要使用未指定资源替代。
10. replan_remaining 时，必须给出 replanInstruction，说明从哪里重新规划、哪些 refs 不可信。
11. 如果可以继续，safeToUseProducedRefs 必须为 true。
12. 如果 safeToUseProducedRefs=false，不应该 decision=continue。
13. reasoning 简短说明，不超过 300 字。`;
  }

  async summarizeFinalResult(input: {
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
    producedArtifacts: Array<{
      artifactUid: string;
      title: string;
    }>;
    touchedRefs: Array<{
      refId: string;
      title?: string;
    }>;
    openIssues: Array<{
      type?: string;
      message: string;
      severity?: string;
    }>;
  }): Promise<FinalResultSummary> {
    const systemPrompt = this.buildFinalResultSummarySystemPrompt();

    const summaryInput = {
      originalUserMessage: input.originalUserMessage,
      plan: {
        mode: input.plan.mode,
        steps: input.plan.steps.map((step) => ({
          stepUid: step.stepUid,
          targetAgentUid: step.targetAgentUid,
          objective: step.objective,
          expectedResultKind: step.expectedResultKind,
        })),
      },
      stepResults: input.stepResults.map((result) => ({
        stepUid: result.stepUid,
        agentUid: result.agentUid,
        runUid: result.runUid,
        status: result.status,
        summary: result.summary,
        issues: result.issues ?? [],
        producedArtifacts: result.agentResult?.producedArtifacts ?? [],
        touchedResources: result.agentResult?.touchedResources ?? [],
        openIssues: result.agentResult?.openIssues ?? [],
      })),
      producedArtifacts: input.producedArtifacts,
      touchedRefs: input.touchedRefs,
      openIssues: input.openIssues,
    };

    const raw = await this.modelClient.complete({
      systemPrompt,
      userMessage: JSON.stringify(summaryInput, null, 2),
      temperature: 0.2,
    });

    const json = this.extractJsonObject(raw.content);
    const parsed = finalResultSummarySchema.safeParse(json);

    if (parsed.success) {
      return parsed.data;
    }

    console.warn("[MainAgent] FinalResultSummary parse failed:", parsed.error.message);

    const hasFailed = input.stepResults.some((item) => item.status === "failed");
    const hasPartial = input.stepResults.some((item) => item.status === "partial_success");

    return {
      status: hasFailed ? "failed" : hasPartial ? "partial_success" : "success",
      finalAnswer: input.stepResults.length > 0
        ? input.stepResults[input.stepResults.length - 1].summary || "任务执行完成。"
        : "任务执行完成。",
      openIssues: input.openIssues.map((issue) => issue.message),
      reasoning: "Fallback summary because FinalResultSummary JSON parsing failed.",
    };
  }

  private buildFinalResultSummarySystemPrompt(): string {
    return `你是主 Agent 的最终回复生成器。

你会收到：
1. 用户原始任务
2. 执行计划
3. 每个 step 的执行结果
4. 产物、资源变更、open issues

你的任务：
生成给用户看的最终回复。

要求：
1. 只输出严格 JSON，不要 Markdown 代码块，不要解释性文字。
2. 不要简单拼接每个子 Agent 的 summary。
3. 要从用户视角总结最终结果。
4. 如果任务成功，说明完成了什么，必要时列出关键文件或产物。
5. 如果部分成功，说明已完成部分和待处理问题。
6. 如果失败，说明失败原因和下一步需要用户或系统做什么。
7. 不要输出完整 tool logs。
8. 不要输出冗长执行过程。

输出 JSON：
{
  "status": "success | partial_success | failed",
  "finalAnswer": "给用户看的最终回复",
  "openIssues": ["string"],
  "reasoning": "string optional"
}`;
  }
}
