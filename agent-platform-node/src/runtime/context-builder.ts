import type { ToolDefinition } from "../tools/tool-types.js";

export type PromptContext = {
  // contextRole 用来区分上下文视角：
  // standalone_execution 是第一阶段单 Agent 执行；
  // main_orchestration / subagent_execution 留给后续主 Agent 和子 Agent 协作。
  contextRole: "standalone_execution" | "main_orchestration" | "subagent_execution";
  systemPrompt: string;
  skillText: string;
  userMessage: string;
  handoffNote?: string;
  toolManifest: ToolDefinition[];
  contextPolicy: Record<string, unknown>;
  tokenBudget: {
    maxContextTokens: number;
    reservedOutputTokens: number;
  };
};

export type PromptContextBuildInput = {
  systemPrompt: string;
  skillText: string;
  userMessage: string;
  handoffNote?: string;
  toolManifest: ToolDefinition[];
  contextPolicy: Record<string, unknown>;
  maxContextTokens: number;
};

export function buildPromptContext(input: PromptContextBuildInput): PromptContext {
  // 第一阶段还没有 WorkContext、chat_messages 和 Memory 表。
  // 这里先把入口固定住，后续加入最近消息、RunTrace refs、Artifact refs 时，
  // AgentRuntime 不需要重写主流程。
  return {
    contextRole: "standalone_execution",
    systemPrompt: input.systemPrompt,
    skillText: input.skillText,
    userMessage: input.userMessage,
    handoffNote: input.handoffNote,
    toolManifest: input.toolManifest,
    contextPolicy: input.contextPolicy,
    tokenBudget: {
      maxContextTokens: input.maxContextTokens,
      reservedOutputTokens: 1024,
    },
  };
}

export function summarizePromptContext(context: PromptContext) {
  // model_invocations 只记录上下文摘要，不记录完整 prompt。
  // 这份摘要用于回答“这次模型调用大概看到了什么”。
  return {
    contextRole: context.contextRole,
    hasSkillText: context.skillText.length > 0,
    hasHandoffNote: Boolean(context.handoffNote),
    toolCount: context.toolManifest.length,
    toolNames: context.toolManifest.map((tool) => tool.name),
    tokenBudget: context.tokenBudget,
  };
}

export function selectedContextRefsForFirstPhase() {
  // 第一阶段还没有可选入上下文的结构化资源，所以 refs 先保持空壳。
  // 后续接入 chat_messages / WorkContext / RunTrace / Artifact / Memory 时补齐。
  return {
    messageIds: [],
    workContextId: null,
    runTraceIds: [],
    artifactIds: [],
    memoryIds: [],
  };
}
