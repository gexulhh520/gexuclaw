import axios from 'axios'

const apiClient = axios.create({
  baseURL: '/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
})

// 添加请求拦截器，自动添加 Authorization header
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

export interface Session {
  session_id: string
  user_id?: string
  created_at: string
  updated_at: string
  messages: Array<{
    role: string
    content: string
    timestamp: string
    metadata?: any
  }>
}

export interface Message {
  role: string
  content: string
  timestamp: string
  metadata?: any
}

export type LLMProvider = 'openai' | 'deepseek' | 'kimi'

export const api = {
  async createSession(provider?: string, model?: string): Promise<{ session_id: string }> {
    const response = await apiClient.post('/sessions', { provider, model })
    return response.data
  },

  async getSession(sessionId: string): Promise<Session> {
    const response = await apiClient.get(`/sessions/${sessionId}`)
    return response.data
  },

  async deleteSession(sessionId: string): Promise<void> {
    await apiClient.delete(`/sessions/${sessionId}`)
  },

  async getMessages(sessionId: string, limit?: number): Promise<{ messages: Message[] }> {
    const response = await apiClient.get(`/sessions/${sessionId}/messages`, {
      params: { limit },
    })
    return response.data
  },

  async sendMessage(
    sessionId: string,
    content: string,
    provider?: LLMProvider,
    model?: string
  ): Promise<{
    success: boolean
    task_id: string
    session_id: string
    provider?: string
    model?: string
  }> {
    const response = await apiClient.post('/chat', {
      session_id: sessionId,
      content,
      provider,
      model,
    })
    return response.data
  },

  async getTaskStatus(taskId: string): Promise<any> {
    const response = await apiClient.get(`/tasks/${taskId}`)
    return response.data
  },
}
