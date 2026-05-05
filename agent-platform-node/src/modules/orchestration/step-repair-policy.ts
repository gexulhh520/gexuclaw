import type { AgentResult } from "../../runtime/agent-result.js";
import type { ExecutionPlan } from "./orchestration.types.js";
import type { StepEvaluation } from "./step-result-evaluator.js";

export const MAX_STEP_RETRIES = 1;
export const MAX_TOTAL_REPAIRS = 3;

export type AutoRepairAction =
  | "continue"
  | "retry_same_agent"
  | "replan"
  | "ask_user"
  | "fail";

export type StepRetryState = {
  attemptsByStepUid: Map<string, number>;
  lastFailureFingerprintByStepUid: Map<string, string>;
  totalRepairAttempts: number;
};

export function createStepRetryState(): StepRetryState {
  return {
    attemptsByStepUid: new Map(),
    lastFailureFingerprintByStepUid: new Map(),
    totalRepairAttempts: 0,
  };
}

export function buildFailureFingerprint(issues: string[]): string {
  return issues
    .map((issue) => issue.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join("|");
}

export function decideAutoRepair(input: {
  step: ExecutionPlan["steps"][0];
  evaluation: StepEvaluation;
  agentResult: AgentResult;
  retryState: StepRetryState;
}): {
  action: AutoRepairAction;
  nextAttempt: number;
  reason: string;
} {
  const { step, evaluation, agentResult, retryState } = input;

  if (evaluation.status === "success") {
    return {
      action: "continue",
      nextAttempt: retryState.attemptsByStepUid.get(step.stepUid) ?? 0,
      reason: "Step passed evaluation.",
    };
  }

  const currentAttempts = retryState.attemptsByStepUid.get(step.stepUid) ?? 0;

  if (currentAttempts >= MAX_STEP_RETRIES) {
    return {
      action: "replan",
      nextAttempt: currentAttempts,
      reason: "Step retry limit reached.",
    };
  }

  if (retryState.totalRepairAttempts >= MAX_TOTAL_REPAIRS) {
    return {
      action: "replan",
      nextAttempt: currentAttempts,
      reason: "Total repair limit reached.",
    };
  }

  const fingerprint = buildFailureFingerprint(evaluation.issues);
  const lastFingerprint = retryState.lastFailureFingerprintByStepUid.get(step.stepUid);

  if (lastFingerprint && lastFingerprint === fingerprint) {
    return {
      action: "replan",
      nextAttempt: currentAttempts,
      reason: "Same failure fingerprint repeated.",
    };
  }

  const issueText = evaluation.issues.join("\n").toLowerCase();

  if (
    issueText.includes("permission") ||
    issueText.includes("unauthorized") ||
    issueText.includes("access denied")
  ) {
    return {
      action: "ask_user",
      nextAttempt: currentAttempts,
      reason: "Permission or authorization issue requires user input.",
    };
  }

  if (
    issueText.includes("tool not found") ||
    issueText.includes("unknown tool") ||
    issueText.includes("capability")
  ) {
    return {
      action: "replan",
      nextAttempt: currentAttempts,
      reason: "Tool or capability mismatch requires replanning.",
    };
  }

  if (
    issueText.includes("expected artifact output") ||
    issueText.includes("no artifact was produced") ||
    issueText.includes("expected file change") ||
    issueText.includes("no file resource was touched") ||
    issueText.includes("unverified file") ||
    issueText.includes("unverified operations") ||
    issueText.includes("verification operation")
  ) {
    return {
      action: "retry_same_agent",
      nextAttempt: currentAttempts + 1,
      reason: "Issue is likely repairable by retrying the same step.",
    };
  }

  if (agentResult.retryAdvice?.retryable === true) {
    return {
      action: "retry_same_agent",
      nextAttempt: currentAttempts + 1,
      reason: agentResult.retryAdvice.reason || "AgentResult indicates retryable failure.",
    };
  }

  return {
    action: "fail",
    nextAttempt: currentAttempts,
    reason: "Failure is not classified as auto-repairable.",
  };
}

export function recordRetryAttempt(input: {
  stepUid: string;
  issues: string[];
  retryState: StepRetryState;
}) {
  const { stepUid, issues, retryState } = input;
  const currentAttempts = retryState.attemptsByStepUid.get(stepUid) ?? 0;

  retryState.attemptsByStepUid.set(stepUid, currentAttempts + 1);
  retryState.totalRepairAttempts += 1;
  retryState.lastFailureFingerprintByStepUid.set(
    stepUid,
    buildFailureFingerprint(issues)
  );
}
