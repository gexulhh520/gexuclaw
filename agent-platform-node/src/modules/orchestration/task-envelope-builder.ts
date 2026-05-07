/**
 * TaskEnvelopeBuilder
 * 把 ExecutionPlan.step 转成 TaskEnvelope，不调用 LLM
 */

import { makeUid } from "../../shared/ids.js";
import type { ExecutionPlan, SessionContextIndex } from "./orchestration.types.js";
import type { TaskEnvelope, LedgerRenderMode } from "./task-envelope.types.js";
import { hydrateTaskEnvelopeContext } from "./task-envelope-context-hydrator.js";

export class TaskEnvelopeBuilder {
  async build(input: {
    step: ExecutionPlan["steps"][0];
    plan: ExecutionPlan;
    contextIndex: SessionContextIndex;
    parentRunUid: string;
    originalUserMessage: string;
  }): Promise<TaskEnvelope> {
    const { step, plan, contextIndex, parentRunUid } = input;

    // 从 inputRefIds 展开 refs，并处理 agent 类型 ref 的自动关联
    console.log(`[TaskEnvelopeBuilder] step.inputRefIds:`, JSON.stringify(step.inputRefIds));
    const refs = this.resolveRefs(step.inputRefIds, contextIndex);
    console.log(`[TaskEnvelopeBuilder] resolved refs count:`, refs.length, `refs:`, JSON.stringify(refs.map((r) => ({ refId: r.refId, kind: r.kind, title: r.title }))));

    // 使用 hydrator 从数据库查询完整内容
    const hydrated = await hydrateTaskEnvelopeContext(refs);

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
      sessionId: plan.sessionId || "",
      targetAgentUid: step.targetAgentUid,
      objective: step.objective,
      originalUserMessage: undefined,
      selectedContext: {
        refs,
        ledgerSlices: hydrated.ledgerSlices,
        artifacts: hydrated.artifacts,
        files: hydrated.files,
        resources: hydrated.resources,
      },
      constraints,
      allowedTools: step.allowedTools,
      expectedResult: {
        kind: step.expectedResultKind,
        requireVerification: step.requireVerification,
      },
      outputContract: {
        format: "final_answer",
      },
      contextRenderPolicy: {
        renderSelectedRefs: false,
        ledgerMode: determineLedgerMode(step),
        maxArtifactContentChars: 2000,
        maxLedgerSteps: 8,
      },
    };
  }

  /**
   * 解析 inputRefIds。
   * 注意：agent 是执行者，不再作为数据源自动扩散最近 run/artifact。
   * plan 内的数据传递依赖 dependsOn -> producedRefsByStepUid。
   */
  private resolveRefs(
    inputRefIds: string[],
    contextIndex: SessionContextIndex
  ): SessionContextIndex["refs"] {
    const resolvedRefs: SessionContextIndex["refs"] = [];
    const addedRefIds = new Set<string>();

    console.log(`[resolveRefs] contextIndex.refs total:`, contextIndex.refs.length);
    console.log(
      `[resolveRefs] contextIndex.refs:`,
      JSON.stringify(
        contextIndex.refs.map((r) => ({
          refId: r.refId,
          kind: r.kind,
          relations: r.tags,
        }))
      )
    );

    for (const refId of inputRefIds) {
      console.log(`[resolveRefs] processing refId:`, refId);

      const directRef = contextIndex.refs.find((r) => r.refId === refId);
      console.log(`[resolveRefs] directRef found:`, !!directRef, `kind:`, directRef?.kind);

      if (directRef && !addedRefIds.has(directRef.refId)) {
        resolvedRefs.push(directRef);
        addedRefIds.add(directRef.refId);
      }
    }

    console.log(`[resolveRefs] final resolvedRefs count:`, resolvedRefs.length);
    return resolvedRefs;
  }
}

function determineLedgerMode(
  step: ExecutionPlan["steps"][0]
): LedgerRenderMode {
  if (step.expectedResultKind === "diagnosis") return "critical_steps";
  if (step.expectedResultKind === "verification") return "critical_steps";
  if (step.requireVerification) return "critical_steps";
  return "summary";
}
