/**
 * TaskEnvelopeRenderer
 * 将 TaskEnvelope 渲染为子 Agent 可读的 Task Envelope Prompt
 * 这是代码渲染，不是 LLM 调用
 */

import type { TaskEnvelope } from "./task-envelope.types.js";
import type { RuntimeStepTrace } from "./orchestration.types.js";

export function renderTaskEnvelopeForAgent(envelope: TaskEnvelope): string {
  const lines: string[] = [];

  lines.push(`# Task Envelope`);
  lines.push(`"""`);
  lines.push(`envelopeUid: ${envelope.envelopeUid}`);
  lines.push(`parentRunUid: ${envelope.parentRunUid}`);
  lines.push(`workContextUid: ${envelope.workContextUid}`);
  lines.push(`targetAgentUid: ${envelope.targetAgentUid}`);
  lines.push(`"""`);
  lines.push("");

  lines.push(`## Objective`);
  lines.push(envelope.objective);
  lines.push("");

  if (envelope.retryContext) {
    lines.push(`## Retry Context`);
    lines.push(`retryAttempt: ${envelope.retryContext.retryAttempt}`);
    lines.push(`previousRunUid: ${envelope.retryContext.previousRunUid}`);
    lines.push("");

    if (envelope.retryContext.validationIssues.length > 0) {
      lines.push(`## Validation Issues`);
      for (const issue of envelope.retryContext.validationIssues) {
        lines.push(`- ${issue}`);
      }
      lines.push("");
    }

    lines.push(`## Retry Instruction`);
    lines.push(
      envelope.retryContext.instruction ||
        "只修复当前 Objective，不要扩展任务范围，不要执行其他步骤。本次必须补齐上一次缺失的结果。"
    );
    lines.push("");
  }

  const renderSelectedRefs =
    envelope.contextRenderPolicy?.renderSelectedRefs === true;

  if (renderSelectedRefs && envelope.selectedContext.refs.length > 0) {
    lines.push(`## Selected Context (${envelope.selectedContext.refs.length} refs)`);
    for (const ref of envelope.selectedContext.refs) {
      lines.push(`- ${ref.refId}: ${ref.title} (${ref.status || "unknown"})`);
      if (ref.summary) {
        lines.push(`  ${ref.summary}`);
      }
    }
    lines.push("");
  }

  const ledgerMode = envelope.contextRenderPolicy?.ledgerMode ?? "summary";

  if (ledgerMode !== "none" && envelope.selectedContext.ledgerSlices.length > 0) {
    lines.push(`## Previous Runs`);

    for (const slice of envelope.selectedContext.ledgerSlices) {
      lines.push(`- ${slice.refId}`);
      if (slice.agentUid) lines.push(`  agent: ${slice.agentUid}`);
      if (slice.agentName) lines.push(`  agentName: ${slice.agentName}`);
      lines.push(`  status: ${slice.status}`);
      if (slice.summary) {
        lines.push(`  summary: ${slice.summary.slice(0, 500)}`);
      }

      if (ledgerMode === "critical_steps" || ledgerMode === "full") {
        const steps = selectLedgerSteps(
          slice.steps,
          ledgerMode,
          envelope.contextRenderPolicy?.maxLedgerSteps ?? 8
        );
        for (const step of steps) {
          lines.push(`  - step#${step.stepIndex} ${step.stepType}`);
          if (step.toolName) lines.push(`    tool: ${step.toolName}`);
          if (step.toolStatus) lines.push(`    status: ${step.toolStatus}`);
          if (step.content) lines.push(`    content: ${step.content.slice(0, 300)}`);
        }
      }
    }

    lines.push("");
  }

  if (envelope.selectedContext.artifacts.length > 0) {
    lines.push(`## Artifacts`);
    const maxChars = envelope.contextRenderPolicy?.maxArtifactContentChars ?? 2000;

    for (const art of envelope.selectedContext.artifacts) {
      lines.push(`- ${art.refId}: ${art.title} (${art.artifactRole || "reference"})`);

      if (art.summary) {
        lines.push(`  summary: ${art.summary.slice(0, 300)}`);
      }

      if (art.contentText) {
        lines.push(`  content:`);
        lines.push(indentBlock(art.contentText.slice(0, maxChars), "  "));
      }

      if (art.contentJson) {
        lines.push(`  json:`);
        lines.push(indentBlock(JSON.stringify(art.contentJson, null, 2).slice(0, maxChars), "  "));
      }
    }

    lines.push("");
  }

  if (envelope.selectedContext.files.length > 0) {
    lines.push(`## Files`);
    for (const file of envelope.selectedContext.files) {
      lines.push(`- ${file.refId}`);
      lines.push(`  path: ${file.path}`);
      lines.push(`  status: ${file.lastKnownStatus || "unknown"}`);
      if (file.lastKnownOperation) lines.push(`  lastOperation: ${file.lastKnownOperation}`);
      if (file.summary) lines.push(`  summary: ${file.summary.slice(0, 300)}`);
    }
    lines.push("");
  }

  if (envelope.selectedContext.resources?.length > 0) {
    lines.push(`## Resources`);
    for (const res of envelope.selectedContext.resources) {
      lines.push(`- ${res.refId}`);
      lines.push(`  kind: ${res.kind}`);
      lines.push(`  uri: ${res.uri}`);
      if (res.lastKnownStatus) lines.push(`  status: ${res.lastKnownStatus}`);
      if (res.lastKnownOperation) lines.push(`  lastOperation: ${res.lastKnownOperation}`);
      if (res.summary) lines.push(`  summary: ${res.summary.slice(0, 300)}`);
    }
    lines.push("");
  }

  if (envelope.constraints.length > 0) {
    lines.push(`## Constraints`);
    for (const constraint of envelope.constraints) {
      lines.push(`- ${constraint}`);
    }
    lines.push("");
  }

  if (envelope.allowedTools.length > 0) {
    lines.push(`## Allowed Tools`);
    lines.push(envelope.allowedTools.join(", "));
    lines.push("");
  }

  lines.push(`## Expected Result`);
  lines.push(`kind: ${envelope.expectedResult.kind}`);
  lines.push(`requireVerification: ${envelope.expectedResult.requireVerification ? "yes" : "no"}`);
  lines.push("");

  lines.push(`## Output Contract`);
  lines.push(`format: ${envelope.outputContract.format}`);
  lines.push(`mustIncludeOperations: ${envelope.outputContract.mustIncludeOperations ? "yes" : "no"}`);
  lines.push(`mustIncludeOpenIssues: ${envelope.outputContract.mustIncludeOpenIssues ? "yes" : "no"}`);

  return lines.join("\n");
}

function selectLedgerSteps(
  steps: RuntimeStepTrace[],
  mode: "summary" | "critical_steps" | "full",
  maxSteps: number
): RuntimeStepTrace[] {
  if (mode === "summary") return [];

  if (mode === "full") {
    return steps.slice(-maxSteps);
  }

  return steps
    .filter(
      (s) =>
        s.stepType === "tool_end" ||
        s.stepType === "error" ||
        s.toolStatus === "failed" ||
        s.toolStatus === "error"
    )
    .slice(-maxSteps);
}

function indentBlock(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}
