import { eq, inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import { agentArtifacts, agentRuns } from "../../db/schema.js";
import { jsonParse, jsonStringify } from "../../shared/json.js";
import { makeUid } from "../../shared/ids.js";
import { nowIso } from "../../shared/time.js";
import type { ToolArtifactCandidate, ToolResult } from "../../tools/tool-types.js";
import type { CreateArtifactInput } from "../work-contexts/work-context.schema.js";
import type { AgentArtifactDecision, AgentDeclaredArtifact } from "./artifact-directives.js";
import { buildArtifactInputFromToolCandidate } from "./artifact-builder.js";
import { createArtifact as createArtifactWithWorkContext } from "../work-contexts/work-context.service.js";

export type PendingArtifactCandidate = {
  candidateId: string;
  toolName: string;
  toolCallId: string;
  candidate: ToolArtifactCandidate;
};

export function attachCandidateIdsToToolResult(params: {
  toolName: string;
  toolCallId: string;
  toolResult: ToolResult;
}): {
  toolResult: ToolResult;
  pendingCandidates: PendingArtifactCandidate[];
} {
  const { toolName, toolCallId, toolResult } = params;

  if (!toolResult.artifactCandidates?.length) {
    return { toolResult, pendingCandidates: [] };
  }

  const pendingCandidates = toolResult.artifactCandidates.map((candidate, index) => {
    const candidateId = candidate.candidateId || `${toolCallId}:artifact:${index + 1}`;
    return {
      candidateId,
      toolName,
      toolCallId,
      candidate: {
        ...candidate,
        candidateId,
      },
    };
  });

  return {
    toolResult: {
      ...toolResult,
      artifactCandidates: pendingCandidates.map((item) => item.candidate),
    },
    pendingCandidates,
  };
}

/**
 * 创建 Artifact（不依赖 WorkContext，直接归属 Session）
 */
async function createArtifactDirect(params: {
  sessionId: string;
  runId: number;
  input: CreateArtifactInput;
}) {
  const { sessionId, runId, input } = params;
  const now = nowIso();

  const [artifact] = await db
    .insert(agentArtifacts)
    .values({
      artifactUid: makeUid("artifact"),
      sessionId,
      runId,
      artifactType: input.artifactType,
      artifactRole: input.artifactRole,
      title: input.title,
      mimeType: input.mimeType,
      contentText: input.contentText,
      contentJson: jsonStringify(input.contentJson),
      uri: input.uri,
      status: input.status,
      sourceRunId: input.sourceRunId,
      sourceArtifactIdsJson: jsonStringify(input.sourceArtifactIds),
      metadataJson: jsonStringify(input.metadata),
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return artifact;
}

export async function persistArtifactsFromToolResult(params: {
  sessionId: string;
  workContextUid?: string;
  runId: number;
  toolResult: ToolResult;
}) {
  const { sessionId, workContextUid, runId, toolResult } = params;

  if (!toolResult.success) return [];
  if (!toolResult.artifactCandidates?.length) return [];

  const created = [];

  for (const candidate of toolResult.artifactCandidates) {
    const input = buildArtifactInputFromToolCandidate({
      candidate,
      runId,
      sourceRunId: runId,
    });

    let artifact;
    if (workContextUid) {
      // 兼容旧逻辑：如果提供了 workContextUid，使用旧方式创建
      artifact = await createArtifactWithWorkContext(workContextUid, input);
    } else {
      // 新逻辑：直接归属 Session
      artifact = await createArtifactDirect({ sessionId, runId, input });
    }
    created.push(artifact);
  }

  if (created.length > 0) {
    await appendRunOutputArtifactIds(
      runId,
      created.map((artifact) => artifact.artifactUid),
    );
  }

  return created;
}

export async function persistArtifactsFromAgentDecisions(params: {
  sessionId: string;
  workContextUid?: string;
  runId: number;
  pendingCandidates: PendingArtifactCandidate[];
  decisions: AgentArtifactDecision[];
}) {
  const { sessionId, workContextUid, runId, pendingCandidates, decisions } = params;

  if (pendingCandidates.length === 0) {
    return {
      createdArtifacts: [],
      consumedCandidateIds: [] as string[],
    };
  }

  const decisionMap = new Map(decisions.map((decision) => [decision.candidateId, decision]));
  const matchedCandidates = pendingCandidates.filter((item) => decisionMap.has(item.candidateId));

  if (matchedCandidates.length === 0) {
    return {
      createdArtifacts: [],
      consumedCandidateIds: [] as string[],
    };
  }

  const createdArtifacts = [];
  const consumedCandidateIds: string[] = [];

  for (const pending of matchedCandidates) {
    const decision = decisionMap.get(pending.candidateId)!;
    consumedCandidateIds.push(pending.candidateId);

    if (!decision.keep) {
      continue;
    }

    const input = buildArtifactInputFromToolCandidate({
      candidate: {
        ...pending.candidate,
        defaultRole: decision.artifactRole ?? pending.candidate.defaultRole,
        title: decision.title ?? pending.candidate.title,
      },
      runId,
      sourceRunId: runId,
    });

    let artifact;
    if (workContextUid) {
      artifact = await createArtifactWithWorkContext(workContextUid, input);
    } else {
      artifact = await createArtifactDirect({ sessionId, runId, input });
    }
    createdArtifacts.push(artifact);
  }

  if (createdArtifacts.length > 0) {
    await appendRunOutputArtifactIds(
      runId,
      createdArtifacts.map((artifact) => artifact.artifactUid),
    );
  }

  return {
    createdArtifacts,
    consumedCandidateIds,
  };
}

export async function persistDeclaredArtifacts(params: {
  sessionId: string;
  workContextUid?: string;
  runId: number;
  declaredArtifacts: AgentDeclaredArtifact[];
}) {
  const { sessionId, workContextUid, runId, declaredArtifacts } = params;

  if (declaredArtifacts.length === 0) {
    return [];
  }

  const createdArtifacts = [];

  for (const declaredArtifact of declaredArtifacts) {
    const input: CreateArtifactInput = {
      runId,
      sourceRunId: runId,
      sourceArtifactIds: declaredArtifact.sourceArtifactIds ?? [],
      artifactType: declaredArtifact.artifactType,
      artifactRole: declaredArtifact.artifactRole,
      title: declaredArtifact.title,
      mimeType: declaredArtifact.mimeType,
      contentText: declaredArtifact.contentText ?? "",
      contentJson: declaredArtifact.contentJson ?? {},
      uri: declaredArtifact.uri,
      status: "ready",
      metadata: declaredArtifact.metadata ?? {},
    };

    let artifact;
    if (workContextUid) {
      artifact = await createArtifactWithWorkContext(workContextUid, input);
    } else {
      artifact = await createArtifactDirect({ sessionId, runId, input });
    }
    createdArtifacts.push(artifact);
  }

  if (createdArtifacts.length > 0) {
    await appendRunOutputArtifactIds(
      runId,
      createdArtifacts.map((artifact) => artifact.artifactUid),
    );
  }

  return createdArtifacts;
}

/**
 * 写入失败时保存 pending_write artifact
 * 用于保留待写入的内容，后续可以重试
 */
export async function savePendingWriteArtifact(params: {
  sessionId: string;
  workContextUid?: string;
  runId: number;
  targetPath: string;
  content: string;
  failedRunUid?: string;
  failedStepRef?: string;
}) {
  const { sessionId, workContextUid, runId, targetPath, content, failedRunUid, failedStepRef } = params;

  const input: CreateArtifactInput = {
    runId,
    sourceRunId: runId,
    sourceArtifactIds: [],
    artifactType: "file",
    artifactRole: "pending_write",
    title: `Pending write: ${targetPath.split("/").pop() || targetPath}`,
    mimeType: "text/plain",
    contentText: content,
    contentJson: {},
    uri: targetPath,
    status: "pending_write",
    metadata: {
      targetPath,
      failedRunUid,
      failedStepRef,
      savedAt: new Date().toISOString(),
    },
  };

  let artifact;
  if (workContextUid) {
    artifact = await createArtifactWithWorkContext(workContextUid, input);
  } else {
    artifact = await createArtifactDirect({ sessionId, runId, input });
  }

  await appendRunOutputArtifactIds(runId, [artifact.artifactUid]);

  console.log(`[ArtifactCoordinator] Saved pending_write artifact: ${artifact.artifactUid} for ${targetPath}`);

  return artifact;
}

export async function loadRunOutputArtifacts(runId: number) {
  const [run] = await db
    .select({ outputArtifactIdsJson: agentRuns.outputArtifactIdsJson })
    .from(agentRuns)
    .where(eq(agentRuns.id, runId));

  if (!run) return [];

  const artifactUids = jsonParse<string[]>(run.outputArtifactIdsJson, []);
  if (artifactUids.length === 0) return [];

  return db
    .select()
    .from(agentArtifacts)
    .where(inArray(agentArtifacts.artifactUid, artifactUids));
}

async function appendRunOutputArtifactIds(runId: number, artifactUids: string[]) {
  const [run] = await db
    .select({ outputArtifactIdsJson: agentRuns.outputArtifactIdsJson })
    .from(agentRuns)
    .where(eq(agentRuns.id, runId));

  if (!run) return;

  const existing = jsonParse<string[]>(run.outputArtifactIdsJson, []);
  const merged = Array.from(new Set([...existing, ...artifactUids]));

  await db
    .update(agentRuns)
    .set({
      outputArtifactIdsJson: jsonStringify(merged),
    })
    .where(eq(agentRuns.id, runId));
}
