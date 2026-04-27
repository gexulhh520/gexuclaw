import { eq, inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import { agentArtifacts, agentRuns } from "../../db/schema.js";
import { jsonParse, jsonStringify } from "../../shared/json.js";
import type { ToolArtifactCandidate, ToolResult } from "../../tools/tool-types.js";
import type { CreateArtifactInput } from "../work-contexts/work-context.schema.js";
import type { AgentArtifactDecision, AgentDeclaredArtifact } from "./artifact-directives.js";
import { buildArtifactInputFromToolCandidate } from "./artifact-builder.js";
import { createArtifact } from "../work-contexts/work-context.service.js";

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

export async function persistArtifactsFromToolResult(params: {
  workContextUid?: string;
  runId: number;
  toolResult: ToolResult;
}) {
  const { workContextUid, runId, toolResult } = params;

  if (!workContextUid) return [];
  if (!toolResult.success) return [];
  if (!toolResult.artifactCandidates?.length) return [];

  const created = [];

  for (const candidate of toolResult.artifactCandidates) {
    const input = buildArtifactInputFromToolCandidate({
      candidate,
      runId,
      sourceRunId: runId,
    });

    const artifact = await createArtifact(workContextUid, input);
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
  workContextUid?: string;
  runId: number;
  pendingCandidates: PendingArtifactCandidate[];
  decisions: AgentArtifactDecision[];
}) {
  const { workContextUid, runId, pendingCandidates, decisions } = params;

  if (!workContextUid || pendingCandidates.length === 0) {
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

    const artifact = await createArtifact(
      workContextUid,
      buildArtifactInputFromToolCandidate({
        candidate: {
          ...pending.candidate,
          defaultRole: decision.artifactRole ?? pending.candidate.defaultRole,
          title: decision.title ?? pending.candidate.title,
        },
        runId,
        sourceRunId: runId,
      }),
    );

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
  workContextUid?: string;
  runId: number;
  declaredArtifacts: AgentDeclaredArtifact[];
}) {
  const { workContextUid, runId, declaredArtifacts } = params;

  if (!workContextUid || declaredArtifacts.length === 0) {
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

    const artifact = await createArtifact(workContextUid, input);
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
