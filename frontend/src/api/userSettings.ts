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

export interface UserSettings {
  timezone: string
  notification_email?: string
  email_notifications_enabled: boolean
  wechat_notifications_enabled: boolean
  wechat_channel_type: string
  wechat_config_json: Record<string, any>
  task_settings_json: Record<string, any>
}

export const userSettingsApi = {
  async getSettings(): Promise<UserSettings> {
    const response = await httpClient.get('/user-settings')
    return response.data
  },

  async updateSettings(payload: Partial<UserSettings>): Promise<UserSettings> {
    const response = await httpClient.put('/user-settings', payload)
    return response.data
  },

  async validateChannel(channel: string, configOverride?: Record<string, any>) {
    const response = await httpClient.post('/user-settings/validate-channel', {
      channel,
      config_override: configOverride,
    })
    return response.data
  },
}
