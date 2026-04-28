import { ModelClient } from "../../runtime/model-client.js";
import { makeUid } from "../../shared/ids.js";
import type { OrchestrationDecision, DelegateEnvelope } from "./orchestration.schema.js";
import type { PromptContext, AgentCapabilitySummary, WorkContextDetail } from "./context-builder.js";

// 主 Agent - 负责编排和委派
export class MainAgent {
  private modelClient: ModelClient;

  constructor() {
    this.modelClient = new ModelClient();
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
}
