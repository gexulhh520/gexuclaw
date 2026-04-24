import axios from 'axios'

const httpClient = axios.create({
  baseURL: '/api/agent-platform',
  timeout: 15000,
})

export type AgentRecord = {
  id: number
  agentUid: string
  name: string
  type: string
  description: string
  capabilitiesJson: string
  currentVersionId: number | null
  standaloneEnabled: boolean
  subagentEnabled: boolean
  uiMode: string
  uiRoute: string | null
  status: string
  createdAt: string
  updatedAt: string
}

export type AgentVersionRecord = {
  id: number
  agentId: number
  version: number
  modelProfileId: number
  systemPrompt: string
  skillText: string
  allowedToolsJson: string
  contextPolicyJson: string
  modelParamsOverrideJson: string
  outputSchemaJson: string
  maxSteps: number
  status: string
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}

export type ModelProfileRecord = {
  id: number
  profileUid: string
  name: string
  provider: string
  modelName: string
  baseUrl: string | null
  capabilityJson: string
  defaultParamsJson: string
  maxContextTokens: number
  status: string
  createdAt: string
  updatedAt: string
}

export type AgentRunRecord = {
  id: number
  runUid: string
  agentId: number
  agentVersionId: number
  userId: string | null
  sessionId: string | null
  workContextId: string | null
  parentOrchestrationEventId: string | null
  parentRunId: number | null
  mode: string
  status: string
  userMessage: string
  handoffNote: string | null
  delegateEnvelopeJson: string
  inputArtifactIdsJson: string
  outputArtifactIdsJson: string
  snapshotJson: string
  contextPackageSummaryJson: string
  resultSummary: string | null
  outputJson: string
  errorMessage: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  updatedAt: string
}

export type AgentRunStepRecord = {
  id: number
  runId: number
  stepIndex: number
  stepType: string
  content: string | null
  toolName: string | null
  toolCallId: string | null
  toolStatus: string | null
  inputJson: string
  outputJson: string
  metadataJson: string
  createdAt: string
}

export type ModelInvocationRecord = {
  id: number
  invocationUid: string
  runId: number
  stepId: number | null
  modelProfileId: number
  provider: string
  modelName: string
  paramsJson: string
  requestSummaryJson: string
  responseSummaryJson: string
  rawPayloadRef: string | null
  promptContextSummaryJson: string
  selectedContextRefsJson: string
  inputTokens: number | null
  outputTokens: number | null
  latencyMs: number | null
  status: string
  errorMessage: string | null
  createdAt: string
}

type ApiEnvelope<T> = {
  success: boolean
  data: T
  error?: {
    code: string
    message: string
    details?: unknown
  }
}

function unwrap<T>(payload: ApiEnvelope<T>): T {
  if (!payload.success) {
    throw new Error(payload.error?.message || 'Agent Platform 请求失败')
  }
  return payload.data
}

export const agentPlatformApi = {
  async listAgents() {
    const { data } = await httpClient.get<ApiEnvelope<AgentRecord[]>>('/agents')
    return unwrap(data)
  },

  async listModelProfiles() {
    const { data } = await httpClient.get<ApiEnvelope<ModelProfileRecord[]>>('/model-profiles')
    return unwrap(data)
  },

  async listAgentVersions(agentUid: string) {
    const { data } = await httpClient.get<ApiEnvelope<AgentVersionRecord[]>>(`/agents/${agentUid}/versions`)
    return unwrap(data)
  },

  async runAgent(agentUid: string, userMessage: string) {
    const { data } = await httpClient.post<ApiEnvelope<{ runUid: string; status: string; summary: string; stepsCount: number }>>(
      `/agents/${agentUid}/runs`,
      { userMessage }
    )
    return unwrap(data)
  },

  async listRuns(agentUid?: string, limit = 20) {
    const { data } = await httpClient.get<ApiEnvelope<AgentRunRecord[]>>('/runs', {
      params: { agentUid, limit },
    })
    return unwrap(data)
  },

  async getRun(runUid: string) {
    const { data } = await httpClient.get<ApiEnvelope<AgentRunRecord>>(`/runs/${runUid}`)
    return unwrap(data)
  },

  async listRunSteps(runUid: string) {
    const { data } = await httpClient.get<ApiEnvelope<AgentRunStepRecord[]>>(`/runs/${runUid}/steps`)
    return unwrap(data)
  },

  async listRunModelInvocations(runUid: string) {
    const { data } = await httpClient.get<ApiEnvelope<ModelInvocationRecord[]>>(`/runs/${runUid}/model-invocations`)
    return unwrap(data)
  },
}
