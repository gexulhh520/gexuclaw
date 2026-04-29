/**
 * Orchestration 核心类型定义
 * 用于结构化 Agent 决策与执行链路
 */

/* -------------------------------------------------------------------------- */
/*                                   ContextRef                               */
/* -------------------------------------------------------------------------- */

export type ContextRefKind =
  | "work_context"
  | "run"
  | "step"
  | "artifact"
  | "file"
  | "agent"
  | "tool";

export type ContextRef = {
  refId: string;
  kind: ContextRefKind;

  title: string;
  summary: string;

  workContextUid?: string;
  status?: string;

  source: {
    table?: "work_contexts" | "agent_runs" | "agent_run_steps" | "agent_artifacts";
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
    | "derived_from";
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
  workContextUid?: string;
  parentRunId?: number;

  userMessage: string;
  resultSummary?: string;
  errorMessage?: string;

  steps: RuntimeStepTrace[];

  createdAt: string;
};

/* -------------------------------------------------------------------------- */
/*                               WorkContextCard                              */
/* -------------------------------------------------------------------------- */

export type WorkContextCard = {
  workContextUid: string;
  title: string;
  goal: string;
  status: string;

  summary?: string;
  progressSummary?: string;
  currentStage?: string;
  nextAction?: string;

  currentFocus?: {
    refId: string;
    kind: string;
    title: string;
  } | null;

  recentRefs?: string[];

  openIssues?: Array<{
    refId?: string;
    summary: string;
    severity?: "low" | "medium" | "high";
    status: "open" | "resolved";
  }>;

  updatedAt: string;

  latestRun?: {
    runUid: string;
    agentUid: string;
    agentName?: string;
    status: string;
    summary?: string;
    errorMessage?: string;
  };

  latestArtifact?: {
    artifactUid: string;
    title: string;
    artifactType: string;
    summary?: string;
  };

  signals: {
    selectedInUI: boolean;
    recentlyActive: boolean;
    hasFailedRun: boolean;
    hasOpenIssue: boolean;
    hasRecentArtifact: boolean;
    hasUnverifiedSideEffect?: boolean;
  };

  topRefs?: ContextRef[];
};

/* -------------------------------------------------------------------------- */
/*                             SessionRuntimeSnapshot                         */
/* -------------------------------------------------------------------------- */

export type SessionRuntimeSnapshot = {
  userMessage: string;

  session: {
    sessionUid: string;
    title?: string;
    description?: string;
  };

  selectedWorkContextUid?: string;

  workContexts: WorkContextCard[];

  globalRecentRuns: RuntimeRunTrace[];

  globalRecentArtifacts: Array<{
    artifactUid: string;
    workContextUid?: string;
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
  selectedWorkContextUid?: string | null;

  workContexts: WorkContextDecisionCard[];

  refs: ContextRef[];
  relations: ContextRelation[];

  availableAgents: AgentDecisionCard[];
};

export type WorkContextDecisionCard = {
  workContextUid: string;
  title: string;
  summary?: string;

  currentStage?: string;
  progressSummary?: string;
  currentFocus?: {
    refId: string;
    kind: string;
    title: string;
  } | null;
  recentRefs?: string[];
  openIssues?: Array<{
    refId?: string;
    summary: string;
    severity?: "low" | "medium" | "high";
    status: "open" | "resolved";
  }>;

  signals: {
    selectedInUI: boolean;
    recentlyActive: boolean;
    hasFailedRun: boolean;
    hasOpenIssue: boolean;
    hasRecentArtifact: boolean;
    hasUnverifiedSideEffect?: boolean;
  };
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
    | "create_work_context"
    | "use_existing_work_context"
    | "switch_work_context"
    | "delegate"
    | "multi_step_plan"
    | "ask_user"
    | "explain_trace"
    | "verify_execution"
    | "recover_execution";

  targetWorkContextUid: string | null;

  createWorkContext: {
    title: string;
    goal: string;
  } | null;

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
    candidateWorkContextUids: string[];
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

  workContextUid?: string;

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
