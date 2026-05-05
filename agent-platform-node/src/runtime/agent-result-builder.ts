/**
 * AgentResultBuilder
 * 从 run 的 steps 和 artifacts 合成标准 AgentResult
 */

import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { agentRunSteps, agentArtifacts } from "../db/schema.js";
import { jsonParse } from "../shared/json.js";
import type { AgentResult } from "./agent-result.js";

export async function buildAgentResult(input: {
  runId: number;
  runUid: string;
  summary: string;
  status: "success" | "partial_success" | "failed";
}): Promise<AgentResult> {
  // 1. 查询所有 steps
  const steps = await db
    .select()
    .from(agentRunSteps)
    .where(eq(agentRunSteps.runId, input.runId))
    .orderBy(agentRunSteps.stepIndex);

  // 2. 查询所有 artifacts
  const artifacts = await db
    .select()
    .from(agentArtifacts)
    .where(eq(agentArtifacts.runId, input.runId));

  // 3. 从 tool_end steps 生成 operations
  const toolEndSteps = steps.filter((s) => s.stepType === "tool_end");

  const operations: AgentResult["operations"] = toolEndSteps.map((step) => {
    const output = jsonParse<Record<string, unknown>>(step.outputJson, {});
    const metadata = jsonParse<Record<string, unknown>>(step.metadataJson, {});

    const operationMeta = (metadata.operation || output.operation) as
      | Record<string, unknown>
      | undefined;

    const verificationMeta = (metadata.verification || output.verification) as
      | Record<string, unknown>
      | undefined;

    return {
      toolName: step.toolName ?? undefined,
      operationType: (operationMeta?.type as string) ?? "unknown",
      target: (operationMeta?.target as string) ?? undefined,
      status:
        step.toolStatus === "failed"
          ? "failed"
          : step.toolStatus === "skipped"
            ? "skipped"
            : "success",
      errorCode: ((output.error as Record<string, unknown> | undefined)?.code as string) ?? undefined,
      errorMessage:
        ((output.error as Record<string, unknown> | undefined)?.message as string) ??
        (output.error as string) ??
        undefined,
      verification: verificationMeta
        ? {
            required: (verificationMeta.required as boolean) ?? false,
            status:
              (verificationMeta.status as
                | "verified"
                | "unverified"
                | "failed"
                | "not_applicable") ?? "unverified",
            method: (verificationMeta.method as string) ?? undefined,
            evidence: verificationMeta.evidence ?? undefined,
          }
        : undefined,
    };
  });

  // 4. 从 artifacts 生成 producedArtifacts
  const producedArtifacts: AgentResult["producedArtifacts"] = artifacts.map(
    (artifact) => ({
      artifactUid: artifact.artifactUid,
      title: artifact.title,
      role: artifact.artifactRole ?? undefined,
    })
  );

  // 5. 从 operation / output.touchedResources / sideEffects / outputRefs 生成 touchedResources
  const touchedResources: AgentResult["touchedResources"] = [];

  for (const step of toolEndSteps) {
    const output = jsonParse<Record<string, unknown>>(step.outputJson, {});
    const metadata = jsonParse<Record<string, unknown>>(step.metadataJson, {});

    const operationMeta = (metadata.operation || output.operation) as
      | Record<string, unknown>
      | undefined;

    const verificationMeta = (metadata.verification || output.verification) as
      | Record<string, unknown>
      | undefined;

    const operationTouchedResource = createTouchedResourceFromOperation({
      operation: operationMeta,
      verification: verificationMeta,
    });

    if (operationTouchedResource) {
      touchedResources.push(operationTouchedResource);
    }

    const operationType =
      typeof operationMeta?.type === "string" && operationMeta.type.trim()
        ? operationMeta.type.trim()
        : "unknown";

    // 从 output.touchedResources 提取
    const touched = output.touchedResources as
      | Array<{
          type?: string;
          uri?: string;
          operation?: string;
          verified?: boolean;
        }>
      | undefined;
    if (touched) {
      for (const t of touched) {
        if (t.uri) {
          touchedResources.push({
            type: (t.type as AgentResult["touchedResources"][0]["type"]) ?? "unknown",
            uri: t.uri,
            operation: t.operation ?? operationType,
            verified: t.verified ?? false,
          });
        }
      }
    }

    // 从 metadata.sideEffects 提取
    const sideEffects = metadata.sideEffects as
      | Array<{
          type?: string;
          uri?: string;
          operation?: string;
          verified?: boolean;
        }>
      | undefined;
    if (sideEffects) {
      for (const se of sideEffects) {
        if (se.uri) {
          touchedResources.push({
            type: (se.type as AgentResult["touchedResources"][0]["type"]) ?? "unknown",
            uri: se.uri,
            operation: se.operation ?? operationType,
            verified: se.verified ?? false,
          });
        }
      }
    }

    // 从 output.outputRefs 提取
    const outputRefs = output.outputRefs as
      | Array<{
          type?: string;
          uri?: string;
          operation?: string;
          verified?: boolean;
        }>
      | undefined;
    if (outputRefs) {
      for (const ref of outputRefs) {
        if (ref.uri) {
          touchedResources.push({
            type: (ref.type as AgentResult["touchedResources"][0]["type"]) ?? "unknown",
            uri: ref.uri,
            operation: ref.operation ?? operationType,
            verified: ref.verified ?? false,
          });
        }
      }
    }
  }

  // 6. 从 failed operations 生成 openIssues
  const openIssues: AgentResult["openIssues"] = operations
    .filter((op) => op.status === "failed")
    .map((op) => ({
      type: op.operationType ?? "tool_execution",
      message: `${op.toolName || "tool"} 执行失败：${op.errorMessage || "未知错误"}`,
      severity: "high" as const,
    }));

  // 7. 生成 retryAdvice
  const retryAdvice: AgentResult["retryAdvice"] = {
    retryable: input.status === "failed" && openIssues.length > 0,
    retryMode: openIssues.some((i) => i.type === "permission")
      ? "human_needed"
      : "same_agent",
    reason:
      input.status === "failed"
        ? `存在 ${openIssues.length} 个失败操作`
        : undefined,
  };

  return {
    status: input.status,
    summary: input.summary,
    operations,
    producedArtifacts,
    touchedResources,
    openIssues,
    retryAdvice,
  };
}

function normalizeTouchedResourceType(
  targetKind?: unknown
): AgentResult["touchedResources"][0]["type"] {
  if (targetKind === "file") return "file";
  if (targetKind === "artifact") return "artifact";
  if (targetKind === "url") return "url";
  if (targetKind === "db_record") return "db_record";
  if (targetKind === "external_resource") return "external_resource";
  return "unknown";
}

function normalizeVerificationStatus(
  verification?: Record<string, unknown>
): boolean {
  return verification?.status === "verified";
}

function createTouchedResourceFromOperation(input: {
  operation?: Record<string, unknown>;
  verification?: Record<string, unknown>;
}): AgentResult["touchedResources"][0] | null {
  const { operation, verification } = input;

  if (!operation) return null;

  const target = typeof operation.target === "string" ? operation.target.trim() : "";
  if (!target) return null;

  const operationType =
    typeof operation.type === "string" && operation.type.trim()
      ? operation.type.trim()
      : "unknown";

  return {
    type: normalizeTouchedResourceType(operation.targetKind),
    uri: target,
    operation: operationType,
    verified: normalizeVerificationStatus(verification),
  };
}
