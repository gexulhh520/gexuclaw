/**
 * Orchestration 核心类型定义
 * 用于结构化 Agent 决策与执行链路
 */

/* -------------------------------------------------------------------------- */
/*                                   ContextRef                               */
/* -------------------------------------------------------------------------- */

export type ContextRefKind =
  | "session"
  | "run"
  | "step"
  | "artifact"
  | "file"
  | "url"
  | "resource"
  | "agent"
  | "tool";

export type ContextRef = {
  refId: string;
  kind: ContextRefKind;

  title: string;
  summary: string;

  sessionId?: string;
  status?: string;

  source: {
    table?: "sessions" | "agent_runs" | "agent_run_steps" | "agent_artifacts";
    uid?: string;
    runUid?: string;
    stepIndex?: number;
    uri?: string;
  };

  tags: string[];

  evidence?: {
    selectedInUI?: boolean;
    recencyRank?: number;
    statusSignals?: string[];
    semanticSignals?: string[];
  };

  updatedAt?: string;
};

/* -------------------------------------------------------------------------- */
/*                                 ContextRelation                            */
/* -------------------------------------------------------------------------- */

export type ContextRelation = {
  fromRefId: string;
  toRefId: string;
  relation:
    | "belongs_to"
    | "created_by"
    | "executed_by"
    | "attempted_write"
    | "attempted_write_artifact"
    | "intended_for"
    | "produced"
    | "used_by"
    | "derived_from"

    // 新增：资源操作关系
    | "touched"
    | "read"
    | "wrote"
    | "modified"
    | "deleted";
};

/* -------------------------------------------------------------------------- */
/*                               SessionContextIndex                          */
/* -------------------------------------------------------------------------- */

export type SessionContextIndex = {
  refs: ContextRef[];
  relations: ContextRelation[];
};

/* -------------------------------------------------------------------------- */
/*                                RuntimeRunTrace                             */
/* -------------------------------------------------------------------------- */

export type RuntimeStepTrace = {
  stepIndex: number;
  stepType: string;
  content?: string;
  toolName?: string;
  toolCallId?: string;
  toolStatus?: string;
  inputJson?: unknown;
  outputJson?: unknown;
  metadataJson?: unknown;
  createdAt: string;
};

export type RuntimeRunTrace = {
  runUid: string;
  agentUid: string;
  agentName: string;
  mode: string;
  status: string;

  sessionId?: string;
  parentRunId?: number;

  userMessage: string;
  resultSummary?: string;
  errorMessage?: string;

  steps: RuntimeStepTrace[];

  createdAt: string;
};

/* -------------------------------------------------------------------------- */
/*                             SessionRuntimeSnapshot                         */
/* -------------------------------------------------------------------------- */

export type SessionRuntimeSnapshot = {
  userMessage: string;
  effectiveUserMessage: string;

  session: {
    sessionUid: string;
    title?: string;
    description?: string;
    metadata?: Record<string, unknown>;
  };

  sessionState: {
    currentStage?: string;
    recoverable?: boolean;
    lastEffectiveUserMessage?: string;
    lastRecoverableRunUid?: string;
    lastFailedRunUid?: string;
    lastSuccessfulRunUid?: string;
    recentRefs?: string[];
    openIssues?: Array<{
      refId?: string;
      summary: string;
      severity?: "low" | "medium" | "high";
      status: "open" | "resolved";
    }>;
  };

  globalRecentRuns: RuntimeRunTrace[];

  globalRecentArtifacts: Array<{
    artifactUid: string;
    sessionId?: string;
    title: string;
    artifactType: string;
    artifactRole?: string;
    summary?: string;
    createdAt?: string;
  }>;

  availableAgents: Array<{
    agentUid: string;
    name: string;
    description?: string;
    capabilities?: string[];
    status?: string;
  }>;
};

/* -------------------------------------------------------------------------- */
/*                               MainDecisionInput                            */
/* -------------------------------------------------------------------------- */

export type MainDecisionInput = {
  userMessage: string;
  effectiveUserMessage: string;
  sessionState: SessionRuntimeSnapshot["sessionState"];

  refs: ContextRef[];
  relations: ContextRelation[];

  availableAgents: AgentDecisionCard[];
};

export type AgentDecisionCard = {
  agentUid: string;
  name: string;
  description?: string;
  capabilities?: string[];
  toolHints?: string[];
};

/* -------------------------------------------------------------------------- */
/*                                MainDecision                                */
/* -------------------------------------------------------------------------- */

export type MainDecision = {
  decisionType:
    | "answer_directly"
    | "delegate"
    | "multi_step_plan"
    | "ask_user"
    | "explain_trace"
    | "verify_execution"
    | "recover_execution";

  primaryRefs: string[];
  secondaryRefs: string[];

  targetAgentUid: string | null;

  plan: {
    steps: Array<{
      targetAgentUid: string;
      objective: string;
      inputRefIds: string[];
      expectedResultKind: "answer" | "artifact" | "file_change" | "diagnosis" | "verification";
      requireVerification: boolean;
    }>;
  } | null;

  response: string | null;

  ambiguity: {
    candidateRefIds: string[];
    question: string;
  } | null;

  confidence: "high" | "medium" | "low";
  reasoning: string;
};

/* -------------------------------------------------------------------------- */
/*                                ExecutionPlan                               */
/* -------------------------------------------------------------------------- */

export type ExecutionPlan = {
  planUid: string;

  mode:
    | "direct_response"
    | "single_agent"
    | "sequential_agents"
    | "parallel_agents";

  sessionId: string;

  selectedRefs: string[];

  steps: Array<{
    stepUid: string;
    targetAgentUid: string;
    objective: string;
    inputRefIds: string[];
    dependsOn: string[];
    expectedResultKind: "answer" | "artifact" | "file_change" | "diagnosis" | "verification";
    requireVerification: boolean;
    allowedTools: string[];
  }>;

  finalResponseStrategy:
    | "use_direct_response"
    | "compose_from_agent_results"
    | "compose_from_ledger";
};
