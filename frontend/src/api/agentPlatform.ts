import axios from 'axios'

const httpClient = axios.create({
  baseURL: '/api/agent-platform',
  timeout: 120000,
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
  agentName?: string  // Agent 名称
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

export type ProjectRecord = {
  id: number
  projectUid: string
  userId: string | null
  name: string
  description: string
  icon: string
  status: string
  metadataJson: string
  createdAt: string
  updatedAt: string
}

export type SessionRecord = {
  id: number
  sessionUid: string
  projectId: number | null
  userId: string | null
  title: string
  description: string
  agentIdsJson: string
  status: string
  metadataJson: string
  createdAt: string
  updatedAt: string
}

export type WorkContextRecord = {
  id: number
  workContextUid: string
  title: string
  goal: string
  userId: string | null
  sessionId: string | null
  projectId: string | null
  source: string
  status: string
  currentStage: string
  currentRunId: number | null
  latestArtifactId: number | null
  runRefsJson: string
  artifactRefsJson: string
  metadataJson: string
  createdAt: string
  updatedAt: string
}

export type AgentArtifactRecord = {
  id: number
  artifactUid: string
  workContextId: number
  runId: number | null
  artifactType: string
  title: string
  mimeType: string | null
  contentText: string
  contentJson: string
  uri: string | null
  status: string
  createdAt: string
  updatedAt: string
}

export type CreateProjectInput = {
  name: string
  description?: string
  icon?: string
  metadata?: Record<string, unknown>
}

export type CreateSessionInput = {
  title: string
  description?: string
  projectId?: string
  agentIds: string[]
  metadata?: Record<string, unknown>
}

export type CreateWorkContextInput = {
  title: string
  goal?: string
  userId?: string
  sessionId?: string
  projectId?: string
  source?: string
  metadata?: Record<string, unknown>
}

// Orchestration Types
export type ChatRequestInput = {
  sessionId: string
  message: string
  workContextId?: string
  selectedAgentId?: string
}

export type ChatResponse = {
  message: string
  workContextId: string
  runId?: string
  agentId?: string
  artifacts?: Array<{
    id: string
    type: string
    title: string
  }>
}

export type CreateArtifactInput = {
  runId?: number
  artifactType: string
  title: string
  mimeType?: string
  contentText?: string
  contentJson?: Record<string, unknown>
  uri?: string
  status?: string
}

export type CreateModelProfileInput = {
  profileUid?: string
  name: string
  provider?: string
  modelName: string
  baseUrl?: string
  capability?: Record<string, unknown>
  defaultParams?: Record<string, unknown>
  maxContextTokens?: number
}

export type CreateAgentInput = {
  agentUid?: string
  name: string
  type?: 'custom' | 'builtin' | 'main'
  description?: string
  capabilities?: string[]
  ownerUserId?: string
  standaloneEnabled?: boolean
  subagentEnabled?: boolean
  uiMode?: 'generic' | 'custom'
  uiRoute?: string
}

export type CreateAgentVersionInput = {
  modelProfileUid: string
  systemPrompt: string
  skillText?: string
  allowedTools?: string[]
  contextPolicy?: Record<string, unknown>
  modelParamsOverride?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  maxSteps?: number
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

  async createAgent(input: CreateAgentInput) {
    const { data } = await httpClient.post<ApiEnvelope<AgentRecord>>('/agents', input)
    return unwrap(data)
  },

  async listModelProfiles() {
    const { data } = await httpClient.get<ApiEnvelope<ModelProfileRecord[]>>('/model-profiles')
    return unwrap(data)
  },

  async createModelProfile(input: CreateModelProfileInput) {
    const { data } = await httpClient.post<ApiEnvelope<ModelProfileRecord>>('/model-profiles', input)
    return unwrap(data)
  },

  async listAgentVersions(agentUid: string) {
    const { data } = await httpClient.get<ApiEnvelope<AgentVersionRecord[]>>(`/agents/${agentUid}/versions`)
    return unwrap(data)
  },

  async createAgentVersion(agentUid: string, input: CreateAgentVersionInput) {
    const { data } = await httpClient.post<ApiEnvelope<AgentVersionRecord>>(
      `/agents/${agentUid}/versions`,
      input
    )
    return unwrap(data)
  },

  async runAgent(
    agentUid: string,
    userMessage: string,
    options: {
      handoffNote?: string
      mode?: 'standalone' | 'subagent' | 'main'
      sessionId?: string
      userId?: string
      workContextId?: string
    } = {}
  ) {
    const { data } = await httpClient.post<ApiEnvelope<{ runUid: string; status: string; summary: string; stepsCount: number }>>(
      `/agents/${agentUid}/runs`,
      { userMessage, ...options }
    )
    return unwrap(data)
  },

  async listRuns(agentUid?: string, limit = 20, sessionId?: string) {
    const { data } = await httpClient.get<ApiEnvelope<AgentRunRecord[]>>('/runs', {
      params: { agentUid, limit, sessionId },
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

  // 查询 Run 详情和步骤（新接口）
  async getRunWithSteps(runUid: string) {
    const { data } = await httpClient.get<ApiEnvelope<{
      run: {
        runId: string
        agentId: string
        status: string
        resultSummary: string | null
        userMessage: string
        createdAt: string
        updatedAt: string
      }
      steps: Array<{
        stepIndex: number
        stepType: string
        content: string | null
        toolName: string | null
        toolStatus: string | null
        input: unknown
        output: unknown
        createdAt: string
        agentName: string | null
      }>
    }>>(`/runs/${runUid}/details`)
    return unwrap(data)
  },

  // SSE 订阅 Run 实时步骤
  subscribeRunSteps(
    runUid: string,
    callbacks: {
      onStep?: (step: {
        stepIndex: number
        stepType: string
        content?: string
        toolName?: string
        toolStatus?: string
        input?: unknown
        output?: unknown
        createdAt: string
      }) => void
      onStatus?: (status: {
        runId: string
        status: string
        resultSummary?: string | null
        updatedAt: string
      }) => void
      onComplete?: (status: { status: string }) => void
      onHeartbeat?: (data: { time: string }) => void
      onError?: (error: Event) => void
    }
  ): () => void {
    const eventSource = new EventSource(`/api/agent-platform/runs/${runUid}/stream`)

    eventSource.addEventListener('step', (event) => {
      try {
        const step = JSON.parse(event.data)
        callbacks.onStep?.(step)
      } catch (e) {
        console.error('Failed to parse step event:', e)
      }
    })

    eventSource.addEventListener('status', (event) => {
      try {
        const status = JSON.parse(event.data)
        callbacks.onStatus?.(status)
      } catch (e) {
        console.error('Failed to parse status event:', e)
      }
    })

    eventSource.addEventListener('complete', (event) => {
      try {
        const data = JSON.parse(event.data)
        callbacks.onComplete?.(data)
        eventSource.close()
      } catch (e) {
        console.error('Failed to parse complete event:', e)
      }
    })

    eventSource.addEventListener('heartbeat', (event) => {
      try {
        const data = JSON.parse(event.data)
        callbacks.onHeartbeat?.(data)
      } catch (e) {
        console.error('Failed to parse heartbeat event:', e)
      }
    })

    eventSource.onerror = (error) => {
      console.error('SSE connection error:', error)
      callbacks.onError?.(error)
      eventSource.close()
    }

    // 返回取消订阅函数
    return () => {
      eventSource.close()
    }
  },

  async listRunModelInvocations(runUid: string) {
    const { data } = await httpClient.get<ApiEnvelope<ModelInvocationRecord[]>>(`/runs/${runUid}/model-invocations`)
    return unwrap(data)
  },

  // Orchestration API - 主 Agent 智能委派
  async chat(input: ChatRequestInput) {
    const { data } = await httpClient.post<ApiEnvelope<ChatResponse>>('/orchestration/chat', input)
    return unwrap(data)
  },

  // Projects API
  async listProjects() {
    const { data } = await httpClient.get<ApiEnvelope<ProjectRecord[]>>('/projects')
    return unwrap(data)
  },

  async createProject(input: CreateProjectInput) {
    const { data } = await httpClient.post<ApiEnvelope<ProjectRecord>>('/projects', input)
    return unwrap(data)
  },

  async getProject(projectUid: string) {
    const { data } = await httpClient.get<ApiEnvelope<ProjectRecord>>(`/projects/${projectUid}`)
    return unwrap(data)
  },

  // Sessions API
  async listSessions(params: { projectUid?: string; personal?: boolean; limit?: number } = {}) {
    const { data } = await httpClient.get<ApiEnvelope<SessionRecord[]>>('/sessions', {
      params,
    })
    return unwrap(data)
  },

  async createSession(input: CreateSessionInput) {
    const { data } = await httpClient.post<ApiEnvelope<SessionRecord>>('/sessions', input)
    return unwrap(data)
  },

  async getSession(sessionUid: string) {
    const { data } = await httpClient.get<ApiEnvelope<SessionRecord>>(`/sessions/${sessionUid}`)
    return unwrap(data)
  },

  // WorkContexts API
  async listWorkContexts(params: { sessionId?: string; projectId?: string; limit?: number } = {}) {
    const { data } = await httpClient.get<ApiEnvelope<WorkContextRecord[]>>('/work-contexts', {
      params,
    })
    return unwrap(data)
  },

  async createWorkContext(input: CreateWorkContextInput) {
    const { data } = await httpClient.post<ApiEnvelope<WorkContextRecord>>('/work-contexts', input)
    return unwrap(data)
  },

  async getWorkContext(workContextUid: string) {
    const { data } = await httpClient.get<ApiEnvelope<WorkContextRecord>>(`/work-contexts/${workContextUid}`)
    return unwrap(data)
  },

  // Artifacts API
  async listArtifacts(workContextUid: string) {
    const { data } = await httpClient.get<ApiEnvelope<AgentArtifactRecord[]>>(
      `/work-contexts/${workContextUid}/artifacts`
    )
    return unwrap(data)
  },

  async createArtifact(workContextUid: string, input: CreateArtifactInput) {
    const { data } = await httpClient.post<ApiEnvelope<AgentArtifactRecord>>(
      `/work-contexts/${workContextUid}/artifacts`,
      input
    )
    return unwrap(data)
  },
}
