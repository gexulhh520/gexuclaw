<template>
  <div class="chat-container">
    <el-container>
      <!-- 侧边栏：历史会话 -->
      <el-aside width="260px" class="sidebar">
        <div class="sidebar-header">
          <el-button type="primary" @click="createNewSession" :icon="Plus">
            新建会话
          </el-button>
        </div>
        
        <div class="session-list">
          <div
            v-for="session in sessions"
            :key="session.session_id"
            class="session-item"
            :class="{ active: session.session_id === sessionId }"
            @click="switchSession(session.session_id)"
          >
            <el-icon><ChatDotRound /></el-icon>
            <span class="session-title">{{ session.title }}</span>
            <el-icon class="delete-btn" @click.stop="deleteSession(session.session_id)">
              <Delete />
            </el-icon>
          </div>
        </div>
        
        <div class="sidebar-footer">
          <el-dropdown @command="handleCommand">
            <span class="user-info">
              <el-icon><User /></el-icon>
              {{ userStore.user?.username }}
              <el-icon><ArrowDown /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="logout">退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-aside>

      <el-container>
        <el-header class="chat-header">
          <h2>{{ currentSessionTitle || 'GexuLaw Agent 智能体' }}</h2>
          <div class="header-controls">
            <el-select v-model="selectedProvider" placeholder="选择服务商" size="small" style="width: 120px; margin-right: 10px;">
              <el-option label="OpenAI" value="openai" />
              <el-option label="DeepSeek" value="deepseek" />
              <el-option label="Kimi" value="kimi" />
              <el-option label="Gemma4" value="gemma4" />
            </el-select>
            <el-input
              v-model="selectedModel"
              placeholder="模型名称（可选）"
              size="small"
              style="width: 150px; margin-right: 10px;"
              clearable
            />
          </div>
        </el-header>

        <el-main class="chat-messages">
          <div v-if="messages.length === 0" class="welcome">
            <el-empty description="开始对话，发送你的消息" />
          </div>

          <div v-for="(msg, index) in messages" :key="index" class="message" :class="msg.role">
            <div class="message-avatar">
              <el-icon v-if="msg.role === 'user'"><User /></el-icon>
              <el-icon v-else><Avatar /></el-icon>
            </div>
            <div class="message-content">
              <div class="message-role">{{ msg.role === 'user' ? '你' : 'AI' }}</div>
              <div class="message-text">{{ msg.content }}</div>
            </div>
          </div>

          <div v-if="isLoading" class="message assistant">
            <div class="message-avatar">
              <el-icon><Avatar /></el-icon>
            </div>
            <div class="message-content">
              <div class="message-role">AI</div>
              <div class="message-text">{{ currentResponse || '正在思考...' }}</div>
            </div>
          </div>
        </el-main>

        <el-footer class="chat-input">
          <el-input
            v-model="inputMessage"
            type="textarea"
            :rows="2"
            placeholder="输入你的消息..."
            @keydown.enter.prevent="sendMessage"
            :disabled="isLoading"
          />
          <el-button 
            :type="isRecording ? 'danger' : 'default'" 
            :class="isRecording ? 'recording-btn' : ''"
            @click="toggleVoiceInput" 
            :disabled="isLoading"
            circle
          >
            <el-icon><Microphone /></el-icon>
          </el-button>
          <el-button type="primary" @click="sendMessage" :loading="isLoading">
            发送
          </el-button>
        </el-footer>
      </el-container>
    </el-container>
  </div>
</template>

<script setup lang="ts">
import { ref, onUnmounted, onMounted, watch, computed, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useChatStore } from '@/stores/chat'
import { useUserStore } from '@/stores/user'
import { User, Avatar, Plus, ChatDotRound, Delete, ArrowDown, Microphone } from '@element-plus/icons-vue'
import type { LLMProvider } from '@/api/client'
import axios from 'axios'

// 创建 axios 实例，启用 keep-alive
const httpClient = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// 请求拦截器添加 token
httpClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

const router = useRouter()
const chatStore = useChatStore()
const userStore = useUserStore()

const inputMessage = ref('')
const selectedProvider = ref<LLMProvider>('kimi')
const selectedModel = ref('')
const sessions = ref<any[]>([])
const isRecording = ref(false)
let recognition: any = null

// 使用 computed 来获取响应式 store 属性
const sessionId = computed(() => chatStore.sessionId)
const messages = computed(() => chatStore.messages)
const isLoading = computed(() => chatStore.isLoading)
const currentResponse = computed(() => chatStore.currentResponse)
const { sendMessage: sendToAI, setProvider, setModel } = chatStore

const currentSessionTitle = computed(() => {
  if (isTempSession.value || !sessionId.value) {
    return '新会话 - 输入内容开始聊天'
  }
  const session = sessions.value.find(s => s.session_id === sessionId.value)
  return session?.title || ''
})

// 同步选择到 store
watch(selectedProvider, (newVal) => {
  setProvider(newVal)
})

watch(selectedModel, (newVal) => {
  setModel(newVal)
})

// 获取历史会话列表
async function fetchSessions() {
  try {
    const response = await httpClient.get('/sessions')
    sessions.value = response.data
  } catch (error) {
    console.error('获取会话列表失败:', error)
  }
}

// 是否是临时新会话（未创建）
const isTempSession = ref(false)

// 创建新会话 - 现在只是切换到临时状态
async function createNewSession() {
  // 断开当前连接
  chatStore.disconnect()
  // 清空当前会话ID和消息
  chatStore.sessionId = ''
  chatStore.messages = []
  isTempSession.value = true
  // 聚焦输入框
  nextTick(() => {
    const inputEl = document.querySelector('.chat-input input') as HTMLInputElement
    inputEl?.focus()
  })
}

// 切换会话
async function switchSession(newSessionId: string) {
  isTempSession.value = false
  chatStore.disconnect()
  chatStore.sessionId = newSessionId
  chatStore.messages = []
  await chatStore.connectWebSocket()
  
  // 加载历史消息
  try {
    const response = await httpClient.get(`/sessions/${newSessionId}/messages`)
    chatStore.messages = response.data.map((msg: any) => ({
      role: msg.role,
      content: msg.content
    }))
  } catch (error) {
    console.error('加载历史消息失败:', error)
  }
}

// 删除会话
async function deleteSession(sessionIdToDelete: string) {
  try {
    await ElMessageBox.confirm('确定要删除这个会话吗？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
    
    await httpClient.delete(`/sessions/${sessionIdToDelete}`)
    
    // 直接在前端过滤掉已删除的会话，不用重新请求
    sessions.value = sessions.value.filter(s => s.session_id !== sessionIdToDelete)
    
    // 如果删除的是当前会话，显示临时状态
    if (sessionIdToDelete === sessionId.value) {
      chatStore.disconnect()
      chatStore.sessionId = ''
      chatStore.messages = []
      isTempSession.value = true
    }
    
    ElMessage.success('会话已删除')
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.response?.data?.detail || '删除会话失败')
    }
  }
}

// 发送消息
async function sendMessage() {
  if (!inputMessage.value.trim() || chatStore.isLoading) return

  const content = inputMessage.value
  inputMessage.value = ''
  
  // 如果是临时会话，先创建会话
  if (isTempSession.value || !chatStore.sessionId) {
    try {
      const response = await httpClient.post('/v1/sessions', { 
        provider: selectedProvider.value, 
        model: selectedModel.value 
      })
      const newSessionId = response.data.session_id
      chatStore.sessionId = newSessionId
      isTempSession.value = false
      // 刷新会话列表
      await fetchSessions()
      // 连接 WebSocket
      await chatStore.connectWebSocket()
    } catch (error: any) {
      ElMessage.error(error.response?.data?.detail || '创建会话失败')
      return
    }
  }
  
  await sendToAI(content, selectedProvider.value, selectedModel.value || undefined)
}

// 用户菜单命令
function handleCommand(command: string) {
  if (command === 'logout') {
    userStore.logout()
    router.push('/login')
    ElMessage.success('已退出登录')
  }
}

// 语音输入功能
function initSpeechRecognition() {
  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  if (!SpeechRecognition) {
    return false
  }
  
  recognition = new SpeechRecognition()
  recognition.continuous = false
  recognition.interimResults = true
  recognition.lang = 'zh-CN'
  
  recognition.onresult = (event: any) => {
    const transcript = event.results[0][0].transcript
    inputMessage.value = transcript
  }
  
  recognition.onerror = (event: any) => {
    console.error('语音识别错误:', event.error)
    isRecording.value = false
    if (event.error === 'not-allowed') {
      ElMessage.error('请允许麦克风权限')
    } else {
      ElMessage.error('语音识别失败，请重试')
    }
  }
  
  recognition.onend = () => {
    isRecording.value = false
  }
  
  return true
}

function toggleVoiceInput() {
  if (!recognition) {
    const supported = initSpeechRecognition()
    if (!supported) {
      ElMessage.warning('您的浏览器不支持语音识别，请使用 Chrome 浏览器')
      return
    }
  }
  
  if (isRecording.value) {
    recognition.stop()
    isRecording.value = false
  } else {
    recognition.start()
    isRecording.value = true
    ElMessage.success('开始录音，请说话...')
  }
}

// 页面加载
onMounted(async () => {
  await fetchSessions()
  
  // 如果没有会话，显示临时状态
  if (sessions.value.length === 0) {
    isTempSession.value = true
  } else if (!sessionId.value) {
    // 切换到第一个会话
    await switchSession(sessions.value[0].session_id)
  } else {
    await chatStore.connectWebSocket()
  }
})

// 页面关闭时断开 WebSocket
onUnmounted(() => {
  chatStore.disconnect()
  if (recognition && isRecording.value) {
    recognition.stop()
  }
})
</script>

<style scoped>
.chat-container {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

:deep(.el-container) {
  height: 100vh;
  overflow: hidden;
}

:deep(.el-main) {
  overflow: hidden;
}

.sidebar {
  background: #f5f7fa;
  border-right: 1px solid #e4e7ed;
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.sidebar-header {
  padding: 16px;
  border-bottom: 1px solid #e4e7ed;
}

.sidebar-header .el-button {
  width: 100%;
}

.session-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  min-height: 0;
  max-height: calc(100vh - 140px);
}

.session-item {
  display: flex;
  align-items: center;
  padding: 12px;
  margin-bottom: 4px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s;
}

.session-item:hover {
  background: #e4e7ed;
}

.session-item.active {
  background: #409eff;
  color: white;
}

.session-item .el-icon {
  margin-right: 8px;
  flex-shrink: 0;
}

.session-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.delete-btn {
  opacity: 0;
  transition: opacity 0.2s;
}

.session-item:hover .delete-btn {
  opacity: 1;
}

.sidebar-footer {
  padding: 16px;
  border-top: 1px solid #e4e7ed;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  color: #606266;
}

.chat-header {
  background: #409eff;
  color: white;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  flex-shrink: 0;
}

.chat-header h2 {
  margin: 0;
  font-size: 1.2rem;
}

.header-controls {
  display: flex;
  align-items: center;
  gap: 10px;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  background: #ffffff;
  min-height: 0;
  max-height: calc(100vh - 140px);
}

.welcome {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
}

.message {
  display: flex;
  margin-bottom: 20px;
  max-width: 80%;
}

.message.user {
  margin-left: auto;
  flex-direction: row-reverse;
}

.message.assistant {
  margin-right: auto;
}

.message-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: #409eff;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  flex-shrink: 0;
}

.message.user .message-avatar {
  background: #67c23a;
}

.message-content {
  margin: 0 15px;
}

.message-role {
  font-size: 0.8rem;
  color: #909399;
  margin-bottom: 4px;
}

.message.user .message-role {
  text-align: right;
}

.message-text {
  background: #f4f4f5;
  padding: 12px 16px;
  border-radius: 8px;
  line-height: 1.6;
  white-space: pre-wrap;
}

.message.user .message-text {
  background: #409eff;
  color: white;
}

.chat-input {
  display: flex;
  gap: 12px;
  padding: 20px;
  background: #fff;
  border-top: 1px solid #e4e7ed;
  flex-shrink: 0;
}

.chat-input .el-input {
  flex: 1;
}

.recording-btn {
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(245, 108, 108, 0.7);
  }
  70% {
    box-shadow: 0 0 0 10px rgba(245, 108, 108, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(245, 108, 108, 0);
  }
}
</style>
