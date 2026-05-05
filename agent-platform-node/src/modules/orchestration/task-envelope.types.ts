/**
 * TaskEnvelope 类型定义
 * 统一来源，避免 runtime 和 orchestration 各自维护
 */

import type { ContextRef } from "./orchestration.types.js";
import type { RuntimeStepTrace } from "./orchestration.types.js";

export type LedgerSlice = {
  refId: string;
  runUid: string;
  agentUid: string;
  agentName?: string;
  status: string;
  summary?: string;
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

export type ResourceSlice = {
  refId: string;
  kind: "url" | "resource";
  uri: string;
  title: string;
  lastKnownOperation?: string;
  lastKnownStatus?: "success" | "failed" | "unverified" | "unknown";
  summary?: string;
};

export type LedgerRenderMode = "none" | "summary" | "critical_steps" | "full";

export type RetryContext = {
  retryAttempt: number;
  previousRunUid: string;
  validationIssues: string[];
  instruction?: string;
};

export type TaskEnvelope = {
  envelopeUid: string;

  parentRunUid: string;
  workContextUid: string;
  targetAgentUid: string;

  objective: string;
  originalUserMessage?: string;

  retryContext?: RetryContext;

  selectedContext: {
    refs: ContextRef[];
    ledgerSlices: LedgerSlice[];
    artifacts: ArtifactSlice[];
    files: FileSlice[];
    resources: ResourceSlice[];
  };

  constraints: string[];

  allowedTools: string[];

  expectedResult: {
    kind: "answer" | "file_change" | "artifact" | "diagnosis" | "verification";
    requireVerification: boolean;
  };

  outputContract: {
    format: "final_answer";
  };

  contextRenderPolicy?: {
    renderSelectedRefs?: boolean;
    ledgerMode?: LedgerRenderMode;
    maxArtifactContentChars?: number;
    maxLedgerSteps?: number;
  };
};
