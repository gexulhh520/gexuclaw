import axios from 'axios'

const httpClient = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
})

httpClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

export interface ScheduledTaskDraftRequest {
  session_id: string
  intent_text: string
  trigger_message_id?: number
  schedule_text?: string
  timezone?: string
}

export interface ScheduledTaskDraftResponse {
  id: number
  title: string
  description?: string
  schedule_text: string
  cron_expression: string
  timezone: string
  status: string
  analysis_status: string
  summary_markdown: string
  content: any
  created_at: string
  next_run_at?: string
}

export interface ScheduledTaskPreviewResponse {
  success: boolean
  run: any
  message: string
  checks: string[]
  warnings: string[]
  blockers: string[]
  suggested_fixes: string[]
}

export interface ScheduledTaskResponse {
  id: number
  title: string
  description?: string
  schedule_text: string
  cron_expression: string
  timezone: string
  status: string
  analysis_status: string
  preview_status: string
  delivery_channels: string[]
  notification_targets_json?: Record<string, any>
  draft_summary_markdown?: string
  next_run_at?: string
  last_run_at?: string
  failure_count: number
  auto_pause_reason?: string
}

export const scheduledTaskApi = {
  async createDraft(payload: ScheduledTaskDraftRequest): Promise<ScheduledTaskDraftResponse> {
    const response = await httpClient.post('/scheduled-tasks/drafts', payload)
    return response.data
  },

  async getDraft(draftId: number): Promise<ScheduledTaskDraftResponse> {
    const response = await httpClient.get(`/scheduled-tasks/drafts/${draftId}`)
    return response.data
  },

  async previewDraft(draftId: number): Promise<ScheduledTaskPreviewResponse> {
    const response = await httpClient.post(`/scheduled-tasks/drafts/${draftId}/preview`)
    return response.data
  },

  async createTask(payload: any): Promise<ScheduledTaskResponse> {
    const response = await httpClient.post('/scheduled-tasks', payload)
    return response.data
  },

  async listTasks(status?: string): Promise<{ tasks: ScheduledTaskResponse[]; total: number }> {
    const response = await httpClient.get('/scheduled-tasks', {
      params: status ? { status } : undefined,
    })
    return response.data
  },

  async getTask(taskId: number): Promise<ScheduledTaskResponse> {
    const response = await httpClient.get(`/scheduled-tasks/${taskId}`)
    return response.data
  },

  async updateTask(taskId: number, payload: any): Promise<ScheduledTaskResponse> {
    const response = await httpClient.patch(`/scheduled-tasks/${taskId}`, payload)
    return response.data
  },

  async pauseTask(taskId: number): Promise<ScheduledTaskResponse> {
    const response = await httpClient.post(`/scheduled-tasks/${taskId}/pause`)
    return response.data
  },

  async resumeTask(taskId: number): Promise<ScheduledTaskResponse> {
    const response = await httpClient.post(`/scheduled-tasks/${taskId}/resume`)
    return response.data
  },

  async runTaskNow(taskId: number): Promise<any> {
    const response = await httpClient.post(`/scheduled-tasks/${taskId}/run-now`)
    return response.data
  },

  async listTaskRuns(taskId: number): Promise<any[]> {
    const response = await httpClient.get(`/scheduled-tasks/${taskId}/runs`)
    return response.data
  },

  async listTaskNotifications(taskId: number): Promise<any[]> {
    const response = await httpClient.get(`/scheduled-tasks/${taskId}/notifications`)
    return response.data
  },
}
