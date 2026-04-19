import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api, Message, LLMProvider } from '@/api/client'

interface WebSocketMessage {
  type: 'chunk' | 'done' | 'error' | 'ack' | 'tool_start' | 'tool_end' | 'thinking_start' | 'thinking_ing' | 'thinking_end' | 'context_trimmed' | 'scheduled_task_suggestion'
  content?: string
  received?: any
  message?: string
  tool_name?: string
  tool_status?: string
  timestamp?: string
  intent_text?: string
  source_message_id?: number
  draft_id?: number
  draft_title?: string
  summary_markdown?: string
  analysis_status?: string
}

interface ExecutionStep {
  type: string
  content?: string
  tool_name?: string
  tool_status?: string
  timestamp: string
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
  const executionSteps = ref<ExecutionStep[]>([])
  const isExecutingTools = ref(false)
  const currentToolName = ref('')
  const pendingScheduledTaskSuggestion = ref<{
    content: string
    intentText: string
    sourceMessageId?: number
    draftId?: number
    draftTitle?: string
    summaryMarkdown?: string
    analysisStatus?: string
  } | null>(null)

  const hasSession = computed(() => !!sessionId.value)

  async function createSession(knowledgeBaseIds: number[] = []) {
    const result = await api.createSession(provider.value, model.value, knowledgeBaseIds)
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
    const timestamp = new Date().toISOString()
    
    switch (data.type) {
      case 'chunk':
        console.log('[WebSocket Debug] Chunk received, content:', data.content)
        currentResponse.value += data.content || ''
        console.log('[WebSocket Debug] currentResponse updated:', currentResponse.value)
        break
      case 'done':
        console.log('[WebSocket Debug] Done received, content:', data.content)
        const thinkingEndStep = executionSteps.value.find(s => s.type === 'thinking_end' && s.content)
        const finalContent = thinkingEndStep?.content || data.content
        const thinkingSteps = [...executionSteps.value]
        if (finalContent) {
          messages.value.push({
            role: 'assistant',
            content: finalContent,
            timestamp: new Date().toISOString(),
            thinkingSteps,
            thinkingExpanded: false,
          })
        }
        currentResponse.value = ''
        executionSteps.value = []
        isLoading.value = false
        isExecutingTools.value = false
        currentToolName.value = ''
        break
      case 'error':
        console.error('[WebSocket Debug] Error:', data.content)
        messages.value.push({
          role: 'assistant',
          content: `❌ 服务出错：${data.content || '未知错误'}\n\n请稍后重试或联系管理员。`,
          timestamp: new Date().toISOString(),
        })
        currentResponse.value = ''
        isLoading.value = false
        isExecutingTools.value = false
        currentToolName.value = ''
        break
      case 'tool_start':
        isExecutingTools.value = true
        currentToolName.value = data.tool_name || ''
        executionSteps.value.push({
          type: 'tool_start',
          tool_name: data.tool_name,
          content: `开始执行工具: ${data.tool_name}`,
          timestamp,
        })
        break
      case 'tool_end':
        executionSteps.value.push({
          type: 'tool_end',
          tool_name: data.tool_name,
          tool_status: data.tool_status,
          content: `工具执行完成: ${data.tool_name}`,
          timestamp,
        })
        isExecutingTools.value = false
        currentToolName.value = ''
        break
      case 'thinking_start':
        executionSteps.value.push({
          type: 'thinking_start',
          content: '开始思考...',
          timestamp,
        })
        break
      case 'thinking_ing':
        executionSteps.value.push({
          type: 'thinking_ing',
          content: data.content || '...',
          timestamp,
        })
        break
      case 'thinking_end':
        executionSteps.value.push({
          type: 'thinking_end',
          content: data.content || '思考完成',
          timestamp,
        })
        break
      case 'scheduled_task_suggestion':
        pendingScheduledTaskSuggestion.value = {
          content: data.content || '检测到可能的定时任务意图',
          intentText: data.intent_text || '',
          sourceMessageId: data.source_message_id,
          draftId: data.draft_id,
          draftTitle: data.draft_title,
          summaryMarkdown: data.summary_markdown,
          analysisStatus: data.analysis_status,
        }
        break
      // context_trimmed 不显示也不记录
    }
  }

  async function sendMessage(
    content: string | MultimodalContent,
    msgProvider?: LLMProvider,
    msgModel?: string,
    knowledgeBaseIds: number[] = []
  ) {
    if (!sessionId.value) {
      await createSession(knowledgeBaseIds)
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
    executionSteps.value = []

    // 使用传入的参数或 store 中的默认值
    const useProvider = msgProvider || provider.value
    const useModel = msgModel || model.value || undefined

    await api.sendMessage(sessionId.value, content, useProvider, useModel, knowledgeBaseIds)
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

  function clearScheduledTaskSuggestion() {
    pendingScheduledTaskSuggestion.value = null
  }

  return {
    sessionId,
    messages,
    isLoading,
    currentResponse,
    hasSession,
    provider,
    model,
    executionSteps,
    isExecutingTools,
    currentToolName,
    pendingScheduledTaskSuggestion,
    createSession,
    loadSession,
    sendMessage,
    disconnect,
    setProvider,
    setModel,
    connectWebSocket,
    clearScheduledTaskSuggestion,
  }
})
