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
    const { step, plan, contextIndex, parentRunUid, originalUserMessage } = input;

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
      workContextUid: plan.workContextUid || "",
      targetAgentUid: step.targetAgentUid,
      objective: step.objective,
      originalUserMessage: undefined,
      selectedContext: {
        refs,
        ledgerSlices: hydrated.ledgerSlices,
        artifacts: hydrated.artifacts,
        files: hydrated.files,
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
      contextRenderPolicy: {
        renderSelectedRefs: false,
        ledgerMode: determineLedgerMode(step),
        maxArtifactContentChars: 2000,
        maxLedgerSteps: 8,
      },
    };
  }

  /**
   * 解析 inputRefIds，处理特殊类型的 ref：
   * - agent:xxx → 自动查找该 agent 最近的 run 和 artifact
   */
  private resolveRefs(
    inputRefIds: string[],
    contextIndex: SessionContextIndex
  ): SessionContextIndex["refs"] {
    const resolvedRefs: SessionContextIndex["refs"] = [];
    const addedRefIds = new Set<string>();

    console.log(`[resolveRefs] contextIndex.refs total:`, contextIndex.refs.length);
    console.log(`[resolveRefs] contextIndex.refs:`, JSON.stringify(contextIndex.refs.map((r) => ({ refId: r.refId, kind: r.kind, relations: r.tags }))));

    for (const refId of inputRefIds) {
      console.log(`[resolveRefs] processing refId:`, refId);

      // 1. 先直接查找
      const directRef = contextIndex.refs.find((r) => r.refId === refId);
      console.log(`[resolveRefs] directRef found:`, !!directRef, `kind:`, directRef?.kind);

      if (directRef) {
        if (!addedRefIds.has(directRef.refId)) {
          resolvedRefs.push(directRef);
          addedRefIds.add(directRef.refId);
        }

        // 如果是 agent 类型，自动关联该 agent 最近的 run 和 artifact
        if (directRef.kind === "agent") {
          const agentUid = directRef.source?.uid || refId.replace("agent:", "");
          console.log(`[resolveRefs] directRef is agent, agentUid:`, agentUid);
          const relatedRefs = this.findRelatedRefsForAgent(agentUid, contextIndex);
          console.log(`[resolveRefs] findRelatedRefsForAgent returned:`, relatedRefs.length, `refs`);
          for (const relatedRef of relatedRefs) {
            if (!addedRefIds.has(relatedRef.refId)) {
              resolvedRefs.push(relatedRef);
              addedRefIds.add(relatedRef.refId);
            }
          }
        }
      } else {
        // 2. 如果直接找不到，尝试作为 agentUid 查找关联的 run/artifact
        const agentUid = refId.startsWith("agent:") ? refId.replace("agent:", "") : refId;
        console.log(`[resolveRefs] directRef not found, try as agentUid:`, agentUid);
        const relatedRefs = this.findRelatedRefsForAgent(agentUid, contextIndex);
        console.log(`[resolveRefs] findRelatedRefsForAgent returned:`, relatedRefs.length, `refs`);
        for (const relatedRef of relatedRefs) {
          if (!addedRefIds.has(relatedRef.refId)) {
            resolvedRefs.push(relatedRef);
            addedRefIds.add(relatedRef.refId);
          }
        }
      }
    }

    console.log(`[resolveRefs] final resolvedRefs count:`, resolvedRefs.length);
    return resolvedRefs;
  }

  /**
   * 查找与指定 agent 相关的 run 和 artifact refs
   * 按时间倒序，优先返回最近的
   */
  private findRelatedRefsForAgent(
    agentUid: string,
    contextIndex: SessionContextIndex
  ): SessionContextIndex["refs"] {
    const relatedRefs: SessionContextIndex["refs"] = [];

    console.log(`[findRelatedRefsForAgent] agentUid:`, agentUid);
    console.log(`[findRelatedRefsForAgent] all refs:`, JSON.stringify(contextIndex.refs.map((r) => ({ refId: r.refId, kind: r.kind, tags: r.tags }))));
    console.log(`[findRelatedRefsForAgent] all relations:`, JSON.stringify(contextIndex.relations));

    // 通过 relations 查找该 agent 关联的 run refs（按 updatedAt 倒序）
    const agentRefId = `agent:${agentUid}`;
    const runRefIds = contextIndex.relations
      .filter((rel) => rel.toRefId === agentRefId && rel.relation === "executed_by")
      .map((rel) => rel.fromRefId);

    console.log(`[findRelatedRefsForAgent] runRefIds from relations:`, JSON.stringify(runRefIds));

    const runRefs = contextIndex.refs
      .filter((r) => r.kind === "run" && runRefIds.includes(r.refId))
      .sort((a, b) => {
        const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return timeB - timeA;
      });

    console.log(`[findRelatedRefsForAgent] runRefs found:`, runRefs.length, `for agentUid:`, agentUid);
    console.log(`[findRelatedRefsForAgent] runRefs:`, JSON.stringify(runRefs.map((r) => ({ refId: r.refId, tags: r.tags, source: r.source }))));

    // 取最近的一个 run
    if (runRefs.length > 0) {
      relatedRefs.push(runRefs[0]);

      // 查找与该 run 相关的 artifact refs
      const runUid = runRefs[0].source?.runUid || runRefs[0].source?.uid;
      console.log(`[findRelatedRefsForAgent] runUid:`, runUid);
      if (runUid) {
        const artifactRefs = contextIndex.refs.filter(
          (r) =>
            r.kind === "artifact" &&
            (r.refId.includes(runUid) || this.isArtifactRelatedToRun(r, runUid, contextIndex))
        );
        console.log(`[findRelatedRefsForAgent] artifactRefs found:`, artifactRefs.length, `for runUid:`, runUid);
        relatedRefs.push(...artifactRefs);
      }
    }

    // 如果没有找到 run，直接查找该 agent 的 artifact refs
    if (relatedRefs.length === 0) {
      const artifactRefs = contextIndex.refs
        .filter((r) => r.kind === "artifact" && r.tags.some((tag) => tag.includes(agentUid)))
        .sort((a, b) => {
          const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
          const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
          return timeB - timeA;
        });

      console.log(`[findRelatedRefsForAgent] fallback artifactRefs found:`, artifactRefs.length, `for agentUid:`, agentUid);

      if (artifactRefs.length > 0) {
        relatedRefs.push(artifactRefs[0]);
      }
    }

    console.log(`[findRelatedRefsForAgent] final relatedRefs count:`, relatedRefs.length);
    return relatedRefs;
  }

  /**
   * 判断 artifact 是否与指定 run 相关
   */
  private isArtifactRelatedToRun(
    artifactRef: SessionContextIndex["refs"][0],
    runUid: string,
    contextIndex: SessionContextIndex
  ): boolean {
    // 通过 relations 查找关联
    return contextIndex.relations.some(
      (rel) =>
        rel.fromRefId === artifactRef.refId &&
        rel.toRefId === `run:${runUid}` &&
        rel.relation === "produced"
    );
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
