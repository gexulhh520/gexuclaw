/**
 * AgentResult - 子 Agent run 的标准结果
 * 由 AgentRuntime 基于工具事实合成，不是由 LLM 输出完整 JSON
 */

export type AgentResult = {
  status: "success" | "partial_success" | "failed" | "needs_clarification";

  summary: string;

  operations: Array<{
    toolName?: string;
    operationType?: string;
    target?: string;
    status: "success" | "failed" | "skipped";
    errorCode?: string;
    errorMessage?: string;
    verification?: {
      required: boolean;
      status: "verified" | "unverified" | "failed" | "not_applicable";
      method?: string;
      evidence?: unknown;
    };
  }>;

  producedArtifacts: Array<{
    artifactUid?: string;
    title: string;
    role?: string;
  }>;

  touchedResources: Array<{
    type: "file" | "artifact" | "url" | "db_record" | "external_resource";
    uri: string;
    operation: string;
    verified: boolean;
  }>;

  openIssues: Array<{
    type: string;
    message: string;
    severity: "low" | "medium" | "high";
  }>;

  retryAdvice?: {
    retryable: boolean;
    retryMode?: "same_agent" | "different_agent" | "human_needed";
    reason?: string;
  };
};
