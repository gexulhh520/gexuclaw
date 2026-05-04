/**
 * SessionContextIndexBuilder
 * 把 SessionRuntimeSnapshot 中的 WorkContext / Run / Step / Artifact / Agent / File 转成 refs
 * 不判断用户意图
 */

import type {
  SessionRuntimeSnapshot,
  SessionContextIndex,
  ContextRef,
  ContextRelation,
  ContextRefKind,
} from "./orchestration.types.js";

export class SessionContextIndexBuilder {
  build(snapshot: SessionRuntimeSnapshot): SessionContextIndex {
    const refs: ContextRef[] = [];
    const relations: ContextRelation[] = [];

    // 1. WorkContext refs
    for (const wc of snapshot.workContexts) {
      const refId = `wc:${wc.workContextUid}`;
      refs.push({
        refId,
        kind: "work_context",
        title: wc.title,
        summary: wc.summary || wc.goal || "",
        workContextUid: wc.workContextUid,
        status: wc.status,
        source: { table: "work_contexts", uid: wc.workContextUid },
        tags: ["work_context", wc.status],
        evidence: {
          selectedInUI: wc.signals.selectedInUI,
          statusSignals: this.buildWorkContextStatusSignals(wc),
        },
        updatedAt: wc.updatedAt,
      });

      // topRefs 也加入
      if (wc.topRefs) {
        for (const topRef of wc.topRefs) {
          if (!refs.find((r) => r.refId === topRef.refId)) {
            refs.push(topRef);
          }
        }
      }
    }

    // 2. Run refs + Step refs
    for (const run of snapshot.globalRecentRuns) {
      const runRefId = `run:${run.runUid}`;
      refs.push({
        refId: runRefId,
        kind: "run",
        title: `${run.agentName} run`,
        summary: run.resultSummary || run.userMessage.slice(0, 100),
        workContextUid: run.workContextUid,
        status: run.status,
        source: { table: "agent_runs", uid: run.runUid, runUid: run.runUid },
        tags: ["run", run.status, run.mode],
        evidence: {
          statusSignals: run.status === "failed" ? ["failed"] : [],
        },
        updatedAt: run.createdAt,
      });

      // relation: run belongs_to work_context
      if (run.workContextUid) {
        relations.push({
          fromRefId: runRefId,
          toRefId: `wc:${run.workContextUid}`,
          relation: "belongs_to",
        });
      }

      // relation: run executed_by agent
      relations.push({
        fromRefId: runRefId,
        toRefId: `agent:${run.agentUid}`,
        relation: "executed_by",
      });

      // Step refs
      for (const step of run.steps) {
        const stepRefId = `step:${run.runUid}:${step.stepIndex}`;
        const isFailed = step.toolStatus === "failed" || step.toolStatus === "error";
        const isToolWrite = step.toolName && this.isWriteTool(step.toolName);

        refs.push({
          refId: stepRefId,
          kind: "step",
          title: step.toolName
            ? `${step.toolName} ${isFailed ? "失败" : step.stepType}`
            : `${step.stepType}`,
          summary: this.buildStepSummary(step),
          workContextUid: run.workContextUid,
          status: step.toolStatus || step.stepType,
          source: {
            table: "agent_run_steps",
            uid: `${run.runUid}:${step.stepIndex}`,
            runUid: run.runUid,
            stepIndex: step.stepIndex,
          },
          tags: ["step", step.stepType, step.toolName || "", isFailed ? "failed" : ""].filter(Boolean),
          evidence: {
            statusSignals: isFailed ? ["failed", "tool_error"] : [],
            semanticSignals: isToolWrite ? ["写入", "文件"] : [],
          },
          updatedAt: step.createdAt,
        });

        // relation: step belongs_to run
        relations.push({
          fromRefId: stepRefId,
          toRefId: runRefId,
          relation: "belongs_to",
        });

        // relation: step belongs_to work_context
        if (run.workContextUid) {
          relations.push({
            fromRefId: stepRefId,
            toRefId: `wc:${run.workContextUid}`,
            relation: "belongs_to",
          });
        }

        // relation: step attempted_write file (从 metadata 中提取)
        if (isToolWrite && step.metadataJson) {
          const metadata = step.metadataJson as Record<string, unknown>;
          const targetPath = metadata.targetPath || metadata.path;
          if (typeof targetPath === "string") {
            const fileRefId = `file:${targetPath}`;
            if (!refs.find((r) => r.refId === fileRefId)) {
              refs.push({
                refId: fileRefId,
                kind: "file",
                title: targetPath.split("/").pop() || targetPath,
                summary: `目标文件${isFailed ? "，最近写入失败" : ""}`,
                workContextUid: run.workContextUid,
                status: isFailed ? "write_failed" : "ok",
                source: { table: "agent_run_steps", uri: targetPath },
                tags: ["file", isFailed ? "write_failed" : ""].filter(Boolean),
              });
            }
            relations.push({
              fromRefId: stepRefId,
              toRefId: fileRefId,
              relation: "attempted_write",
            });
          }
        }
      }
    }

    // 3. Artifact refs
    for (const art of snapshot.globalRecentArtifacts) {
      const refId = `artifact:${art.artifactUid}`;
      refs.push({
        refId,
        kind: "artifact",
        title: art.title,
        summary: art.summary || `${art.artifactType} artifact`,
        workContextUid: art.workContextUid,
        status: art.artifactRole === "pending_write" ? "pending_write" : "ready",
        source: { table: "agent_artifacts", uid: art.artifactUid },
        tags: ["artifact", art.artifactType, art.artifactRole || ""].filter(Boolean),
        updatedAt: art.createdAt,
      });

      // relation: artifact belongs_to work_context
      if (art.workContextUid) {
        relations.push({
          fromRefId: refId,
          toRefId: `wc:${art.workContextUid}`,
          relation: "belongs_to",
        });
      }
    }

    // 4. Agent refs
    for (const agent of snapshot.availableAgents) {
      const refId = `agent:${agent.agentUid}`;
      if (!refs.find((r) => r.refId === refId)) {
        refs.push({
          refId,
          kind: "agent",
          title: agent.name,
          summary: agent.description || `${agent.name} Agent`,
          status: agent.status,
          source: { table: "work_contexts", uid: agent.agentUid },
          tags: ["agent", ...(agent.capabilities || [])],
        });
      }
    }

    console.log(`[ContextIndexBuilder] Refs数量: ${refs.length}, Relations数量: ${relations.length}`);
    console.log(`[ContextIndexBuilder] Refs详情:\n${JSON.stringify(refs.map(r => ({ refId: r.refId, kind: r.kind, title: r.title, status: r.status,summary: r.summary })), null, 2)}`);

    return { refs, relations };
  }

  private buildWorkContextStatusSignals(wc: SessionRuntimeSnapshot["workContexts"][0]): string[] {
    const signals: string[] = [];
    if (wc.signals.hasFailedRun) signals.push("failed_run");
    if (wc.signals.hasOpenIssue) signals.push("open_issue");
    if (wc.signals.hasRecentArtifact) signals.push("recent_artifact");
    if (wc.signals.hasUnverifiedSideEffect) signals.push("unverified_side_effect");
    return signals;
  }

  private buildStepSummary(step: SessionRuntimeSnapshot["globalRecentRuns"][0]["steps"][0]): string {
    if (step.toolName) {
      const status = step.toolStatus || step.stepType;
      return `${step.toolName} 调用，状态: ${status}`;
    }
    return `${step.stepType}`;
  }

  private isWriteTool(toolName: string): boolean {
    const writeTools = ["fs_write", "fs_append", "fs_edit", "fs_apply_patch"];
    return writeTools.some((w) => toolName.includes(w));
  }
}
