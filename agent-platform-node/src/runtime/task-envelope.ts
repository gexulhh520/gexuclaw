/**
 * TaskEnvelope - 主 Agent 给子 Agent 的结构化任务包
 * 替代 handoffNote
 */

import type { ContextRef } from "../modules/orchestration/orchestration.types.js";
import type { RuntimeStepTrace } from "../modules/orchestration/orchestration.types.js";

export type LedgerSlice = {
  refId: string;
  runUid: string;
  agentUid: string;
  agentName?: string;
  status: string;
  steps: RuntimeStepTrace[];
};

export type ArtifactSlice = {
  refId: string;
  artifactUid: string;
  title: string;
  artifactType: string;
  artifactRole?: string;
  summary?: string;
  contentText?: string;
  contentJson?: unknown;
};

export type FileSlice = {
  refId: string;
  uri: string;
  path: string;
  lastKnownOperation?: "read" | "write" | "edit" | "append" | "move" | "delete";
  lastKnownStatus?: "success" | "failed" | "unverified" | "unknown";
  summary?: string;
};

export type TaskEnvelope = {
  envelopeUid: string;

  parentRunUid: string;
  workContextUid: string;
  targetAgentUid: string;

  objective: string;
  originalUserMessage: string;

  selectedContext: {
    refs: ContextRef[];
    ledgerSlices: LedgerSlice[];
    artifacts: ArtifactSlice[];
    files: FileSlice[];
  };

  constraints: string[];

  allowedTools: string[];

  expectedResult: {
    kind: "answer" | "file_change" | "artifact" | "diagnosis" | "verification";
    requireVerification: boolean;
  };

  outputContract: {
    format: "agent_result";
    mustIncludeOperations: boolean;
    mustIncludeOpenIssues: boolean;
  };
};
