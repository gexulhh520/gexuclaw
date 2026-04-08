import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api, Message, LLMProvider } from '@/api/client'

interface WebSocketMessage {
  type: 'chunk' | 'done' | 'error' | 'ack'
  content?: string
  received?: any
  message?: string
}

export type MultimodalContent = Array<{ type: string; content: string }>

export const useChatStore = defineStore('chat', () => {
  const sessionId = ref<string>('')
  const messages = ref<Message[]>([])
  const isLoading = ref(false)
  const currentResponse = ref('')
  const ws = ref<WebSocket | null>(null)
  const provider = ref<LLMProvider>('kimi')
  const model = ref<string>('')

  const hasSession = computed(() => !!sessionId.value)

  async function createSession() {
    const result = await api.createSession(provider.value, model.value)
    sessionId.value = result.session_id
    connectWebSocket()
    return result.session_id
  }

  async function loadSession(sid: string) {
    sessionId.value = sid
    const result = await api.getSession(sid)
    messages.value = result.messages
    connectWebSocket()
  }

  function connectWebSocket() {
    if (ws.value) {
      ws.value.close()
    }

    // 使用相对路径，让 Vite 代理处理 WebSocket
    const wsUrl = `/ws/chat/${sessionId.value}`
    ws.value = new WebSocket(wsUrl)

    ws.value.onopen = () => {
      console.log('[WebSocket Debug] Connected to', wsUrl)
    }

    ws.value.onmessage = (event) => {
     // console.log('[WebSocket Debug] Received:', event.data)
      const data: WebSocketMessage = JSON.parse(event.data)
      handleWebSocketMessage(data)
    }

    ws.value.onclose = () => {
      console.log('[WebSocket Debug] Disconnected')
      // 如果正在加载中，说明连接异常断开
      if (isLoading.value) {
        messages.value.push({
          role: 'assistant',
          content: '❌ 连接已断开，请稍后重试。',
          timestamp: new Date().toISOString(),
        })
        currentResponse.value = ''
        isLoading.value = false
      }
      // 清理 WebSocket 引用
      ws.value = null
    }

    ws.value.onerror = (error) => {
      console.error('[WebSocket Debug] Error:', error)
      // WebSocket 错误时给用户提示
      messages.value.push({
        role: 'assistant',
        content: '❌ 连接出错，请检查网络后重试。',
        timestamp: new Date().toISOString(),
      })
      currentResponse.value = ''
      isLoading.value = false
    }
  }

  function handleWebSocketMessage(data: WebSocketMessage) {
    console.log('[WebSocket Debug] Handling message:', data)
    switch (data.type) {
      case 'chunk':
        console.log('[WebSocket Debug] Chunk received, content:', data.content)
        currentResponse.value += data.content || ''
        console.log('[WebSocket Debug] currentResponse updated:', currentResponse.value)
        break
      case 'done':
        console.log('[WebSocket Debug] Done received, content:', data.content)
        messages.value.push({
          role: 'assistant',
          content: data.content || '',
          timestamp: new Date().toISOString(),
        })
        currentResponse.value = ''
        isLoading.value = false
        break
      case 'error':
        console.error('[WebSocket Debug] Error:', data.content)
        // 添加错误消息到对话，让用户知道发生了什么
        messages.value.push({
          role: 'assistant',
          content: `❌ 服务出错：${data.content || '未知错误'}\n\n请稍后重试或联系管理员。`,
          timestamp: new Date().toISOString(),
        })
        currentResponse.value = ''
        isLoading.value = false
        break
    }
  }

  async function sendMessage(content: string | MultimodalContent, msgProvider?: LLMProvider, msgModel?: string) {
    if (!sessionId.value) {
      await createSession()
    }

    // 检查 WebSocket 连接状态
    // WebSocket.CONNECTING = 0, WebSocket.OPEN = 1, WebSocket.CLOSING = 2, WebSocket.CLOSED = 3
    if (!ws.value) {
      // 完全没有连接，创建新连接
      console.log('[WebSocket Debug] No WebSocket, creating new connection...')
      connectWebSocket()
    } else if (ws.value.readyState === WebSocket.CLOSING || ws.value.readyState === WebSocket.CLOSED) {
      // 连接已关闭，需要重新连接
      console.log('[WebSocket Debug] WebSocket closed, reconnecting...')
      connectWebSocket()
    } else if (ws.value.readyState === WebSocket.CONNECTING) {
      // 连接中，等待连接完成
      console.log('[WebSocket Debug] WebSocket connecting, waiting...')
    }
    
    // 等待连接建立（最多 5 秒）
    let attempts = 0
    const maxAttempts = 50 // 5 秒 / 100ms
    while (ws.value && ws.value.readyState !== WebSocket.OPEN && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 100))
      attempts++
    }
    
    // 检查连接是否成功
    if (!ws.value || ws.value.readyState !== WebSocket.OPEN) {
      console.error('[WebSocket Debug] Failed to connect after 5s')
      messages.value.push({
        role: 'assistant',
        content: '❌ 连接超时，请稍后重试。',
        timestamp: new Date().toISOString(),
      })
      isLoading.value = false
      return
    }

    messages.value.push({
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
    })

    isLoading.value = true
    currentResponse.value = ''

    // 使用传入的参数或 store 中的默认值
    const useProvider = msgProvider || provider.value
    const useModel = msgModel || model.value || undefined

    await api.sendMessage(sessionId.value, content, useProvider, useModel)
  }

  function setProvider(newProvider: LLMProvider) {
    provider.value = newProvider
  }

  function setModel(newModel: string) {
    model.value = newModel
  }

  function disconnect() {
    if (ws.value) {
      ws.value.close()
      ws.value = null
    }
  }

  return {
    sessionId,
    messages,
    isLoading,
    currentResponse,
    hasSession,
    provider,
    model,
    createSession,
    loadSession,
    sendMessage,
    disconnect,
    setProvider,
    setModel,
    connectWebSocket,
  }
})
