/**
 * WorkContextProjectionService
 * 从 ledger/artifacts 更新 WorkContext 的投影字段
 * Phase 2 可选
 */

import { eq, desc } from "drizzle-orm";
import { db } from "../../db/client.js";
import { workContexts, agentRuns, agentArtifacts } from "../../db/schema.js";
import { jsonParse, jsonStringify } from "../../shared/json.js";
import { nowIso } from "../../shared/time.js";

export class WorkContextProjectionService {
  /**
   * 更新 WorkContext 的投影字段
   */
  async project(workContextUid: string): Promise<void> {
    const [workContext] = await db
      .select()
      .from(workContexts)
      .where(eq(workContexts.workContextUid, workContextUid))
      .limit(1);

    if (!workContext) return;

    const runs = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.workContextId, workContextUid))
      .orderBy(desc(agentRuns.id))
      .limit(10);

    const lastRun = runs[0];
    const lastSuccessfulRun = runs.find((r) => r.status === "success");
    const lastFailedRun = runs.find((r) => r.status === "failed");

    const artifacts = await db
      .select()
      .from(agentArtifacts)
      .where(eq(agentArtifacts.workContextId, workContext.id))
      .orderBy(desc(agentArtifacts.id))
      .limit(5);

    const metadata = jsonParse<Record<string, unknown>>(workContext.metadataJson, {});

    // 计算 currentStage
    let currentStage = metadata.currentStage as string | undefined;
    if (lastRun) {
      if (lastRun.status === "running") {
        currentStage = "executing";
      } else if (lastRun.status === "failed") {
        currentStage = "recovering";
      } else if (lastRun.status === "partial_success") {
        currentStage = "recovering";
      } else if (lastRun.status === "success") {
        currentStage = "completed";
      }
    }

    // 计算 openIssues
    const openIssues: Array<{ type: string; message: string; severity: "low" | "medium" | "high" }> = [];
    if (lastFailedRun) {
      openIssues.push({
        type: "run_failed",
        message: lastFailedRun.errorMessage || "Run failed",
        severity: "high",
      });
    }

    // 计算 progressSummary
    const progressSummary = this.buildProgressSummary(runs, artifacts);

    // 计算 recentRefs
    const recentRefs = runs.slice(0, 3).map((r) => `run:${r.runUid}`);
    if (artifacts.length > 0) {
      recentRefs.push(`artifact:${artifacts[0].artifactUid}`);
    }

    const updatedMetadata = {
      ...metadata,
      currentStage,
      progressSummary,
      recentRefs,
      currentFocus: lastRun?.resultSummary || metadata.currentFocus,
      openIssues: openIssues.length > 0 ? openIssues : metadata.openIssues,
      lastRunUid: lastRun?.runUid,
      lastSuccessfulRunUid: lastSuccessfulRun?.runUid,
      lastFailedRunUid: lastFailedRun?.runUid,
      projectedAt: nowIso(),
    };

    await db
      .update(workContexts)
      .set({
        metadataJson: jsonStringify(updatedMetadata),
        updatedAt: nowIso(),
      })
      .where(eq(workContexts.id, workContext.id));

    console.log(`[WorkContextProjection] Updated: ${workContextUid}, stage: ${currentStage}`);
  }

  private buildProgressSummary(
    runs: typeof agentRuns.$inferSelect[],
    artifacts: typeof agentArtifacts.$inferSelect[]
  ): string {
    const totalRuns = runs.length;
    const successRuns = runs.filter((r) => r.status === "success").length;
    const failedRuns = runs.filter((r) => r.status === "failed").length;
    const totalArtifacts = artifacts.length;

    return `共 ${totalRuns} 次运行，${successRuns} 成功，${failedRuns} 失败，${totalArtifacts} 个产物`;
  }
}
