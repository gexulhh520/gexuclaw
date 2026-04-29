/**
 * TaskEnvelopeRenderer
 * 将 TaskEnvelope 渲染为子 Agent 可读的 Task Envelope Prompt
 * 这是代码渲染，不是 LLM 调用
 */

import type { TaskEnvelope } from "./task-envelope.types.js";

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

  if (envelope.originalUserMessage && envelope.originalUserMessage !== envelope.objective) {
    lines.push(`## Original User Message`);
    lines.push(envelope.originalUserMessage);
    lines.push("");
  }

  if (envelope.selectedContext.refs.length > 0) {
    lines.push(`## Selected Context (${envelope.selectedContext.refs.length} refs)`);
    for (const ref of envelope.selectedContext.refs) {
      lines.push(`- ${ref.refId}: ${ref.title} (${ref.status || "unknown"})`);
      if (ref.summary) {
        lines.push(`  ${ref.summary.slice(0, 200)}`);
      }
    }
    lines.push("");
  }

  if (envelope.selectedContext.ledgerSlices.length > 0) {
    lines.push(`## Ledger Slices`);
    for (const slice of envelope.selectedContext.ledgerSlices) {
      lines.push(`- ${slice.refId}: ${slice.status}`);
    }
    lines.push("");
  }

  if (envelope.selectedContext.artifacts.length > 0) {
    lines.push(`## Artifacts`);
    for (const art of envelope.selectedContext.artifacts) {
      lines.push(`- ${art.refId}: ${art.title} (${art.artifactRole || "reference"})`);
      if (art.summary) {
        lines.push(`  ${art.summary.slice(0, 200)}`);
      }
    }
    lines.push("");
  }

  if (envelope.selectedContext.files.length > 0) {
    lines.push(`## Files`);
    for (const file of envelope.selectedContext.files) {
      lines.push(`- ${file.refId}: ${file.path} (${file.lastKnownStatus || "unknown"})`);
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
