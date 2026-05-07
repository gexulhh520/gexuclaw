import type { AgentResult } from "../../runtime/agent-result.js";
import type { ExecutionPlan } from "./orchestration.types.js";

export type StepEvaluationStatus = "success" | "partial_success" | "failed";

export type StepEvaluation = {
  status: StepEvaluationStatus;
  issues: string[];
};

export function evaluateStepResult(input: {
  step: ExecutionPlan["steps"][0];
  agentResult: AgentResult;
}): StepEvaluation {
  const { step, agentResult } = input;
  const issues: string[] = [];

  const blockingOpenIssues = agentResult.openIssues.filter(
    (issue) => issue.severity === "high" || issue.severity === "medium"
  );

  if (agentResult.status === "failed") {
    issues.push("Agent run failed.");
  }

  for (const issue of blockingOpenIssues) {
    issues.push(issue.message);
  }

  if (step.expectedResultKind === "artifact") {
    if (agentResult.producedArtifacts.length === 0) {
      issues.push("Expected artifact output, but no artifact was produced.");
    }
  }

  if (step.expectedResultKind === "file_change") {
    const fileTouches = agentResult.touchedResources.filter(
      (resource) => resource.type === "file"
    );

    if (fileTouches.length === 0) {
      issues.push("Expected file change, but no file resource was touched.");
    }

    const unverifiedFileTouches = fileTouches.filter(
      (resource) => !resource.verified
    );

    if (unverifiedFileTouches.length > 0) {
      issues.push(`There are ${unverifiedFileTouches.length} unverified file changes.`);
    }
  }

  if (step.expectedResultKind === "verification") {
    const verificationOps = agentResult.operations.filter(
      (op) => op.verification?.required === true
    );

    if (verificationOps.length === 0) {
      issues.push("Expected verification result, but no verification operation was found.");
    }

    const failedVerificationOps = verificationOps.filter(
      (op) =>
        op.verification?.status !== "verified" &&
        op.verification?.status !== "not_applicable"
    );

    if (failedVerificationOps.length > 0) {
      issues.push(
        `There are ${failedVerificationOps.length} failed or unverified verification operations.`
      );
    }
  }

  if (step.requireVerification) {
    const unverifiedOps = agentResult.operations.filter(
      (op) =>
        op.verification?.required === true &&
        op.verification.status !== "verified" &&
        op.verification.status !== "not_applicable"
    );

    if (unverifiedOps.length > 0) {
      issues.push(`There are ${unverifiedOps.length} unverified operations.`);
    }
  }

  if (issues.length === 0) {
    return {
      status: "success",
      issues: [],
    };
  }

  if (agentResult.status === "failed") {
    return {
      status: "failed",
      issues,
    };
  }

  return {
    status: "partial_success",
    issues,
  };
}
