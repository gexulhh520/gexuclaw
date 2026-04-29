/**
 * TaskEnvelopeBuilder
 * 把 ExecutionPlan.step 转成 TaskEnvelope，不调用 LLM
 */

import { makeUid } from "../../shared/ids.js";
import type { ExecutionPlan, SessionContextIndex } from "./orchestration.types.js";
import type { TaskEnvelope, LedgerSlice, ArtifactSlice, FileSlice } from "../../runtime/task-envelope.js";

export class TaskEnvelopeBuilder {
  build(input: {
    step: ExecutionPlan["steps"][0];
    plan: ExecutionPlan;
    contextIndex: SessionContextIndex;
    parentRunUid: string;
    originalUserMessage: string;
  }): TaskEnvelope {
    const { step, plan, contextIndex, parentRunUid, originalUserMessage } = input;

    // 从 inputRefIds 展开 refs
    const refs = step.inputRefIds
      .map((refId) => contextIndex.refs.find((r) => r.refId === refId))
      .filter(Boolean) as SessionContextIndex["refs"];

    // 展开 ledger slices
    const ledgerSlices: LedgerSlice[] = [];
    const artifactSlices: ArtifactSlice[] = [];
    const fileSlices: FileSlice[] = [];

    for (const ref of refs) {
      if (ref.kind === "run") {
        ledgerSlices.push({
          refId: ref.refId,
          runUid: ref.source?.uid || "",
          agentUid: "",
          status: ref.status || "unknown",
          steps: [],
        });
      } else if (ref.kind === "artifact") {
        artifactSlices.push({
          refId: ref.refId,
          artifactUid: ref.source?.uid || "",
          title: ref.title,
          artifactType: "text",
          artifactRole: ref.status === "pending_write" ? "pending_write" : "reference",
          summary: ref.summary,
        });
      } else if (ref.kind === "file") {
        fileSlices.push({
          refId: ref.refId,
          uri: ref.source?.uri || "",
          path: ref.source?.uri || "",
          lastKnownStatus: ref.status === "write_failed" ? "failed" : "unknown",
          summary: ref.summary,
        });
      }
    }

    // constraints
    const constraints: string[] = [];
    if (step.requireVerification) {
      constraints.push("你必须验证所有副作用");
    }
    if (step.expectedResultKind === "file_change") {
      constraints.push("你必须确认文件写入成功");
    }
    if (step.expectedResultKind === "verification") {
      constraints.push("你必须提供验证结果和证据");
    }

    return {
      envelopeUid: makeUid("envelope"),
      parentRunUid,
      workContextUid: plan.workContextUid || "",
      targetAgentUid: step.targetAgentUid,
      objective: step.objective,
      originalUserMessage,
      selectedContext: {
        refs,
        ledgerSlices,
        artifacts: artifactSlices,
        files: fileSlices,
      },
      constraints,
      allowedTools: step.allowedTools,
      expectedResult: {
        kind: step.expectedResultKind,
        requireVerification: step.requireVerification,
      },
      outputContract: {
        format: "agent_result",
        mustIncludeOperations: true,
        mustIncludeOpenIssues: true,
      },
    };
  }
}
