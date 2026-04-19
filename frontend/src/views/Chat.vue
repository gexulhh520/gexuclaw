<template>
  <div class="chat-container">
    <el-container>
      <!-- 主内容区 -->
      <el-container>
        <el-header class="chat-header">
          <div class="header-left">
            <span class="logo-text">GexuClaw</span>
          </div>
          <h2 class="header-title">{{ currentSessionTitle || '新会话' }}</h2>
          <div class="header-right">
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
            <el-button circle @click="showSessionList = true" title="历史会话">
              <el-icon><Clock /></el-icon>
            </el-button>
          </div>
        </el-header>

        <el-main class="chat-messages">
          <!-- 悬浮菜单按钮 -->
          <div
            ref="floatingMenuRef"
            class="floating-menu"
            :class="{ dragging: isFloatingDragging }"
            :style="floatingMenuStyle"
            @pointerdown="onDragStart"
            @click="toggleFloatingMenu"
          >
            <el-icon v-if="!showFloatingMenu"><MoreFilled /></el-icon>
            <el-icon v-else><Close /></el-icon>
          </div>

          <!-- 悬浮菜单下拉 -->
          <div v-if="showFloatingMenu" class="floating-dropdown" :style="floatingDropdownStyle">
            <div class="floating-item" @click="handleMenuItem('new')">
              <el-icon><Plus /></el-icon>
              <span>新建会话</span>
            </div>
            <div class="floating-item" @click="handleMenuItem('knowledge-base')">
              <el-icon><Document /></el-icon>
              <span>我的知识库</span>
            </div>
            <div class="floating-item" @click="handleMenuItem('tasks')">
              <el-icon><List /></el-icon>
              <span>我的任务</span>
            </div>
          </div>

          <div v-if="messages.length === 0 && !isLoading && executionSteps.length === 0" class="welcome">
            <el-empty description="开始对话，发送你的消息" />
          </div>

          <div v-for="(msg, index) in messages" :key="index" class="message" :class="msg.role">
            <div class="message-avatar">
              <el-icon v-if="msg.role === 'user'"><User /></el-icon>
              <el-icon v-else><Avatar /></el-icon>
            </div>
            <div class="message-content">
              <div class="message-role">{{ msg.role === 'user' ? '你' : 'AI' }}</div>
              <div class="thinking-badge" v-if="msg.thinkingSteps && msg.thinkingSteps.length > 0" @click="msg.thinkingExpanded = !msg.thinkingExpanded">
                <el-icon><Clock /></el-icon>
                <span>思维过程 ({{ msg.thinkingSteps.length }} 步)</span>
                <el-icon class="expand-icon" :class="{ expanded: msg.thinkingExpanded }"><DArrowRight /></el-icon>
              </div>
              <div v-show="msg.thinkingExpanded" class="thinking-detail">
                <div v-for="(step, idx) in msg.thinkingSteps" :key="idx" class="step-item">
                  <span class="step-type">{{ getStepTypeLabel(step.type) }}</span>
                  <span v-if="step.content">: {{ step.content }}</span>
                </div>
              </div>
              <div class="message-text" v-html="formatMessageContent(msg.content)"></div>
            </div>
          </div>

          <div v-if="isLoading" class="message assistant">
            <div class="message-avatar">
              <el-icon><Avatar /></el-icon>
            </div>
            <div class="message-content">
              <div class="message-role">AI</div>
              <div v-if="executionSteps.length > 0" class="execution-steps">
                <div class="steps-header" @click="stepsExpanded = !stepsExpanded">
                  <el-icon><Monitor /></el-icon>
                  <span>执行过程 ({{ executionSteps.length }} 步)</span>
                  <el-icon class="expand-icon" :class="{ expanded: stepsExpanded }"><DArrowRight /></el-icon>
                </div>
                <div v-show="stepsExpanded" class="steps-list">
                  <div
                    v-for="(step, idx) in executionSteps"
                    :key="idx"
                    class="step-item"
                    :class="getStepClass(step.type)"
                  >
                    <div class="step-content">
                      <span class="step-type">{{ getStepTypeLabel(step.type) }}</span>
                      <span v-if="step.tool_name" class="step-tool">: {{ step.tool_name }}</span>
                      <span v-if="step.content">: {{ step.content }}</span>
                    </div>
                  </div>
                </div>
              </div>
              <div v-else class="message-text">{{ currentResponse || '正在思考...' }}</div>
            </div>
          </div>

        <!-- 历史会话悬浮列表 -->
        <el-drawer v-model="showSessionList" title="历史会话" direction="rtl" size="300px">
          <div class="session-drawer">
            <el-button type="primary" @click="createNewSession" :icon="Plus" style="width: 100%; margin-bottom: 15px;">
              新建会话
            </el-button>
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
            <div class="session-footer">
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
          </div>
        </el-drawer>

        <el-drawer
          v-model="showKnowledgeBaseDrawer"
          title="我的知识库"
          direction="rtl"
          size="720px"
        >
          <div class="knowledge-drawer">
            <div class="knowledge-sidebar">
              <div class="knowledge-sidebar-header">
                <el-form :model="knowledgeBaseForm" label-position="top" class="knowledge-form">
                  <el-form-item label="知识库名称">
                    <el-input v-model="knowledgeBaseForm.name" placeholder="例如：合同审查库" />
                  </el-form-item>
                  <el-form-item label="分类">
                    <el-input v-model="knowledgeBaseForm.category" placeholder="例如：法律业务" />
                  </el-form-item>
                  <el-form-item label="描述">
                    <el-input
                      v-model="knowledgeBaseForm.description"
                      type="textarea"
                      :rows="2"
                      placeholder="可选，简要说明知识库用途"
                    />
                  </el-form-item>
                  <el-button type="primary" :loading="creatingKnowledgeBase" @click="createKnowledgeBase">
                    新建知识库
                  </el-button>
                </el-form>
              </div>

              <div class="knowledge-list">
                <div
                  v-for="kb in knowledgeBases"
                  :key="kb.id"
                  class="knowledge-item"
                  :class="{ active: kb.id === selectedKnowledgeBaseId }"
                  @click="selectKnowledgeBase(kb.id)"
                >
                  <div class="knowledge-item-main">
                    <div class="knowledge-item-title">
                      <span>{{ kb.name }}</span>
                      <el-tag v-if="kb.category" size="small" type="info">{{ kb.category }}</el-tag>
                    </div>
                    <div class="knowledge-item-desc">{{ kb.description || '暂无描述' }}</div>
                    <div class="knowledge-item-meta">
                      <span>{{ kb.document_count || 0 }} 个文档</span>
                      <span>{{ kb.chunk_count || 0 }} 个分块</span>
                    </div>
                  </div>
                  <div class="knowledge-item-actions">
                    <el-checkbox
                      :model-value="currentSessionKnowledgeBaseIds.includes(kb.id)"
                      @change="toggleSessionKnowledgeBase(kb.id)"
                      @click.stop
                    >
                      引入
                    </el-checkbox>
                    <el-button text type="danger" @click.stop="deleteKnowledgeBase(kb)">
                      删除
                    </el-button>
                  </div>
                </div>
              </div>
            </div>

            <div class="knowledge-content">
              <template v-if="selectedKnowledgeBase">
                <div class="knowledge-content-header">
                  <div>
                    <h3>{{ selectedKnowledgeBase.name }}</h3>
                    <p>{{ selectedKnowledgeBase.description || '暂无描述' }}</p>
                  </div>
                  <div class="knowledge-content-actions">
                    <el-button :icon="RefreshRight" @click="refreshSelectedKnowledgeBase">
                      刷新
                    </el-button>
                    <el-upload
                      :show-file-list="false"
                      :before-upload="beforeDocumentUpload"
                      :http-request="handleKnowledgeBaseDocumentUpload"
                      accept=".pdf,.doc,.docx,.zip"
                    >
                      <el-button type="primary" :icon="Upload">
                        上传文档
                      </el-button>
                    </el-upload>
                  </div>
                </div>

                <div class="knowledge-section">
                  <div class="knowledge-section-title">文档列表</div>
                  <el-empty
                    v-if="knowledgeDocuments.length === 0 && !knowledgeDocumentsLoading"
                    description="当前知识库暂无文档"
                  />
                  <div v-else class="knowledge-document-list">
                    <div v-for="doc in knowledgeDocuments" :key="doc.id" class="knowledge-document-item">
                      <div class="knowledge-document-main">
                        <div class="knowledge-document-name">{{ doc.original_filename }}</div>
                        <div class="knowledge-document-meta">
                          <el-tag size="small" :type="getDocumentStatusTagType(doc.status)">
                            {{ getDocumentStatusLabel(doc.status) }}
                          </el-tag>
                          <span>{{ doc.chunks_count || 0 }} 个分块</span>
                        </div>
                        <div v-if="doc.error_message" class="knowledge-document-error">
                          {{ doc.error_message }}
                        </div>
                      </div>
                      <el-button text type="danger" @click="deleteKnowledgeDocument(doc.id)">
                        删除
                      </el-button>
                    </div>
                  </div>
                </div>

                <div class="knowledge-section">
                  <div class="knowledge-section-title">检索测试</div>
                  <div class="knowledge-search-box">
                    <el-input
                      v-model="knowledgeSearchQuery"
                      type="textarea"
                      :rows="3"
                      placeholder="输入问题，测试当前知识库能否命中"
                    />
                    <el-button type="primary" :icon="Search" :loading="knowledgeSearching" @click="runKnowledgeSearch">
                      开始检索
                    </el-button>
                  </div>
                  <div v-if="knowledgeSearchResults.length > 0" class="knowledge-search-results">
                    <div v-for="(result, idx) in knowledgeSearchResults" :key="idx" class="knowledge-search-item">
                      <div class="knowledge-search-source">
                        {{ result.knowledge_base_name || selectedKnowledgeBase.name }} / {{ result.filename }}
                      </div>
                      <div class="knowledge-search-content">{{ result.content }}</div>
                    </div>
                  </div>
                </div>
              </template>

              <el-empty v-else description="请先创建或选择一个知识库" />
            </div>
          </div>
        </el-drawer>
        </el-main>

        <el-footer class="chat-footer">
          <div class="knowledge-session-bar">
            <div class="knowledge-session-info">
              <span class="knowledge-session-label">当前引入知识库</span>
              <template v-if="selectedKnowledgeBaseObjects.length > 0">
                <el-tag
                  v-for="kb in selectedKnowledgeBaseObjects"
                  :key="kb.id"
                  closable
                  size="small"
                  class="knowledge-session-tag"
                  @close="toggleSessionKnowledgeBase(kb.id)"
                >
                  {{ kb.name }}
                </el-tag>
              </template>
              <span v-else class="knowledge-session-empty">当前未引入知识库</span>
            </div>
            <el-button size="small" @click="openKnowledgeBaseDrawer">
              管理知识库
            </el-button>
          </div>

          <TaskIntentCard
            v-if="scheduledTaskSuggestion"
            :suggestion="scheduledTaskSuggestion"
            :loading="scheduledTaskAnalyzing"
            @open-draft="openScheduledTaskDraft"
            @ignore="ignoreScheduledTaskSuggestion"
            @open-settings="router.push('/settings')"
          />

          <!-- 已上传文件预览 -->
          <div v-if="uploadedFiles.length > 0" class="uploaded-preview">
            <div v-for="(file, index) in uploadedFiles" :key="index" class="preview-item" :class="{ 'document-item': file.type === 'document' }">
              <img v-if="file.type === 'image'" :src="file.url" class="preview-image" />
              <div v-else-if="file.type === 'audio'" class="preview-audio">
                <el-icon class="audio-icon"><Headset /></el-icon>
                <audio :src="file.url" controls class="audio-player"></audio>
              </div>
              <div v-else-if="file.type === 'document'" class="preview-document">
                <el-icon class="document-icon"><Document /></el-icon>
                <div class="document-info">
                  <span class="document-name">{{ file.filename }}</span>
                  <span v-if="file.processed" class="document-status success">
                    {{ file.message }}
                  </span>
                  <span v-else-if="file.message" class="document-status error">
                    {{ file.message }}
                  </span>
                </div>
              </div>
              <el-icon class="remove-btn" @click="removeFile(index)"><Close /></el-icon>
            </div>
          </div>
          
          <div class="chat-input">
            <el-input
              v-model="inputMessage"
              type="textarea"
              :rows="2"
              placeholder="输入你的消息..."
              @keydown.enter.prevent="sendMessage"
              :disabled="isLoading"
            />
            
            <div class="input-buttons">
              <!-- 图片上传按钮 -->
              <el-upload
                :show-file-list="false"
                :before-upload="beforeImageUpload"
                :http-request="handleImageUpload"
                accept="image/*"
              >
                <el-button :disabled="isLoading" circle title="上传图片">
                  <el-icon><Picture /></el-icon>
                </el-button>
              </el-upload>

              <!-- 文档上传按钮 -->
              <el-upload
                :show-file-list="false"
                :before-upload="beforeDocumentUpload"
                :http-request="handleDocumentUpload"
                accept=".pdf,.doc,.docx,.zip"
              >
                <el-button :disabled="isLoading" circle title="上传文档 (PDF/Word/ZIP)">
                  <el-icon><Document /></el-icon>
                </el-button>
              </el-upload>

              <!-- 录制中状态：显示停止按钮 -->
              <el-button 
                v-if="isRecordingAudio"
                type="danger"
                class="recording-btn"
                @click="stopAudioRecording"
                circle 
                title="停止录制"
              >
                <el-icon><VideoPause /></el-icon>
              </el-button>
              
              <!-- 非录制状态：显示下拉菜单 -->
              <el-dropdown v-else @command="handleAudioCommand" :disabled="isLoading">
                <el-button 
                  :disabled="isLoading" 
                  circle 
                  title="音频功能"
                >
                  <el-icon><Headset /></el-icon>
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="upload">
                      <el-icon><Upload /></el-icon>
                      上传音频文件
                    </el-dropdown-item>
                    <el-dropdown-item command="record">
                      <el-icon><Microphone /></el-icon>
                      录制音频
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
              
              <!-- 隐藏的文件上传输入 -->
              <el-upload
                ref="audioUploadRef"
                :show-file-list="false"
                :before-upload="beforeAudioUpload"
                :http-request="handleAudioUpload"
                accept="audio/*"
                style="display: none;"
              />
              
              <!-- 语音输入按钮 -->
              <el-button 
                :type="isRecording ? 'danger' : 'default'" 
                :class="isRecording ? 'recording-btn' : ''"
                @click="toggleVoiceInput" 
                :disabled="isLoading"
                circle
                title="语音输入"
              >
                <el-icon><Microphone /></el-icon>
              </el-button>
              
              <!-- 发送按钮 -->
              <el-button type="primary" @click="sendMessage" :loading="isLoading">
                发送
              </el-button>
            </div>
          </div>
        </el-footer>
      </el-container>
    </el-container>

    <TaskConfirmDialog
      v-model="scheduledTaskDialogVisible"
      :draft="scheduledTaskDraft"
      :form="scheduledTaskForm"
      :preview="scheduledTaskPreview"
      :preview-loading="scheduledTaskPreviewLoading"
      :submit-loading="scheduledTaskSubmitting"
      @update:form="scheduledTaskForm = $event"
      @preview="previewScheduledTaskDraft"
      @confirm="confirmScheduledTaskDraft"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onUnmounted, onMounted, watch, computed, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useChatStore } from '@/stores/chat'
import { useUserStore } from '@/stores/user'
import { scheduledTaskApi } from '@/api/scheduledTasks'
import { userSettingsApi } from '@/api/userSettings'
import TaskIntentCard from '@/components/scheduled-task/TaskIntentCard.vue'
import TaskConfirmDialog from '@/components/scheduled-task/TaskConfirmDialog.vue'
import { User, Avatar, Plus, ChatDotRound, Delete, ArrowDown, Microphone, Picture, Headset, Close, Upload, VideoPause, Monitor, Loading, CircleCheck, Message, Connection, DArrowRight, Clock, MoreFilled, List, Document, Search, RefreshRight } from '@element-plus/icons-vue'
import type { LLMProvider } from '@/api/client'
import axios from 'axios'

interface UploadedFile {
  type: 'image' | 'audio' | 'document'
  path: string
  url: string
  filename: string
  processed?: boolean
  chunks_count?: number
  message?: string
  task_id?: string
}

interface KnowledgeBaseItem {
  id: number
  user_id: number
  name: string
  category?: string | null
  description?: string | null
  is_default: boolean
  document_count: number
  chunk_count: number
  created_at: string
  updated_at?: string | null
}

interface KnowledgeDocumentItem {
  id: number
  knowledge_base_id: number
  user_id: number
  original_filename: string
  stored_filename: string
  file_path: string
  file_type: string
  status: string
  chunks_count: number
  error_message?: string | null
  created_at: string
  updated_at?: string | null
}

interface KnowledgeSearchResultItem {
  content: string
  knowledge_base_id?: number
  knowledge_base_name?: string
  category?: string
  document_id?: number
  filename: string
  chunk_index: number
  score?: number
}

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

const router = useRouter()
const chatStore = useChatStore()
const userStore = useUserStore()

const inputMessage = ref('')
const selectedProvider = ref<LLMProvider>('kimi')
const selectedModel = ref('')
const sessions = ref<any[]>([])
const isRecording = ref(false)
const uploadedFiles = ref<UploadedFile[]>([])
let recognition: any = null

const isRecordingAudio = ref(false)
const recordingTime = ref(0)
const maxRecordingTime = 60
let mediaRecorder: MediaRecorder | null = null
let audioChunks: Blob[] = []
let recordingTimer: number | null = null
const audioUploadRef = ref()

const sessionId = computed(() => chatStore.sessionId)
const messages = computed(() => chatStore.messages)
const isLoading = computed(() => chatStore.isLoading)
const currentResponse = computed(() => chatStore.currentResponse)
const executionSteps = computed(() => chatStore.executionSteps)
const isExecutingTools = computed(() => chatStore.isExecutingTools)
const currentToolName = computed(() => chatStore.currentToolName)
const scheduledTaskSuggestion = computed(() => chatStore.pendingScheduledTaskSuggestion)
const stepsExpanded = ref(true)
const showSessionList = ref(false)
const showKnowledgeBaseDrawer = ref(false)
const showFloatingMenu = ref(false)
const floatingButtonSize = 44
const floatingMenuX = ref(20)
const floatingMenuY = ref(0)
const isFloatingDragging = ref(false)
const floatingMenuStyle = computed(() => ({
  transform: `translate3d(${floatingMenuX.value}px, ${floatingMenuY.value}px, 0)`,
}))
const floatingDropdownStyle = computed(() => {
  const left = floatingMenuX.value + floatingButtonSize + 10
  return {
    left: left + 'px',
    top: `${floatingMenuY.value}px`,
  }
})
const { sendMessage: sendToAI, setProvider, setModel } = chatStore

const knowledgeBases = ref<KnowledgeBaseItem[]>([])
const selectedKnowledgeBaseId = ref<number | null>(null)
const knowledgeDocuments = ref<KnowledgeDocumentItem[]>([])
const knowledgeSearchResults = ref<KnowledgeSearchResultItem[]>([])
const knowledgeSearchQuery = ref('')
const currentSessionKnowledgeBaseIds = ref<number[]>([])
const creatingKnowledgeBase = ref(false)
const knowledgeDocumentsLoading = ref(false)
const knowledgeSearching = ref(false)
const knowledgeBaseForm = ref({
  name: '',
  category: '',
  description: '',
})
const userTaskSettings = ref({
  timezone: 'Asia/Shanghai',
  notification_email: '',
  email_notifications_enabled: false,
  wechat_notifications_enabled: false,
  wechat_channel_type: 'clawbot',
  wechat_config_json: {
    base_url: '',
    conversation_id: '',
    token: '',
    send_endpoint: '/message/send',
  },
})
const scheduledTaskAnalyzing = ref(false)
const scheduledTaskDialogVisible = ref(false)
const scheduledTaskDraft = ref<any | null>(null)
const scheduledTaskPreview = ref<any | null>(null)
const scheduledTaskPreviewLoading = ref(false)
const scheduledTaskSubmitting = ref(false)
const scheduledTaskIntentText = ref('')
const scheduledTaskSourceMessageId = ref<number | undefined>(undefined)
const scheduledTaskForm = ref<Record<string, any>>({
  title: '',
  description: '',
  schedule_text: '',
  cron_expression: '',
  timezone: 'Asia/Shanghai',
  delivery_channels: ['in_app'],
  notification_targets_json: {},
})

const floatingMenuRef = ref<HTMLElement | null>(null)
let isDragging = false
let hasDragged = false
let activePointerId: number | null = null
let dragOffsetX = 0
let dragOffsetY = 0
let dragStartX = 0
let dragStartY = 0
let dragFrame = 0
let pendingDragX = 0
let pendingDragY = 0
const dragThreshold = 6

const selectedKnowledgeBase = computed(() =>
  knowledgeBases.value.find(kb => kb.id === selectedKnowledgeBaseId.value) || null
)

const selectedKnowledgeBaseObjects = computed(() =>
  knowledgeBases.value.filter(kb => currentSessionKnowledgeBaseIds.value.includes(kb.id))
)

function toggleFloatingMenu() {
  if (!hasDragged) {
    showFloatingMenu.value = !showFloatingMenu.value
  }
}

function clampFloatingMenuPosition(x: number, y: number) {
  const maxX = Math.max(window.innerWidth - floatingButtonSize - 12, 12)
  const maxY = Math.max(window.innerHeight - floatingButtonSize - 12, 12)
  return {
    x: Math.min(Math.max(12, x), maxX),
    y: Math.min(Math.max(12, y), maxY),
  }
}

function applyFloatingMenuPosition(x: number, y: number) {
  const clamped = clampFloatingMenuPosition(x, y)
  floatingMenuX.value = clamped.x
  floatingMenuY.value = clamped.y
}

function flushDragPosition() {
  dragFrame = 0
  applyFloatingMenuPosition(pendingDragX, pendingDragY)
}

function initializeFloatingMenuPosition() {
  const initialY = window.innerHeight / 2 - floatingButtonSize / 2
  applyFloatingMenuPosition(20, initialY)
}

function onDragStart(e: PointerEvent) {
  if (!floatingMenuRef.value) return
  isDragging = true
  isFloatingDragging.value = false
  hasDragged = false
  activePointerId = e.pointerId
  floatingMenuRef.value.setPointerCapture(e.pointerId)
  const rect = floatingMenuRef.value.getBoundingClientRect()
  dragStartX = e.clientX
  dragStartY = e.clientY
  dragOffsetX = e.clientX - rect.left
  dragOffsetY = e.clientY - rect.top
  pendingDragX = rect.left
  pendingDragY = rect.top
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragEnd)
  window.addEventListener('pointercancel', onDragEnd)
}

function onDragMove(e: PointerEvent) {
  if (!isDragging || !floatingMenuRef.value || e.pointerId !== activePointerId) return

  const distanceX = e.clientX - dragStartX
  const distanceY = e.clientY - dragStartY
  const distance = Math.hypot(distanceX, distanceY)

  if (!hasDragged && distance < dragThreshold) {
    return
  }

  hasDragged = true
  isFloatingDragging.value = true
  pendingDragX = e.clientX - dragOffsetX
  pendingDragY = e.clientY - dragOffsetY

  if (!dragFrame) {
    dragFrame = requestAnimationFrame(flushDragPosition)
  }
}

function onDragEnd(e: PointerEvent) {
  if (!floatingMenuRef.value || e.pointerId !== activePointerId) return
  isDragging = false
  isFloatingDragging.value = false
  activePointerId = null
  if (floatingMenuRef.value.hasPointerCapture(e.pointerId)) {
    floatingMenuRef.value.releasePointerCapture(e.pointerId)
  }
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
  window.removeEventListener('pointercancel', onDragEnd)
  if (dragFrame) {
    cancelAnimationFrame(dragFrame)
    dragFrame = 0
  }
  applyFloatingMenuPosition(pendingDragX, pendingDragY)
  // 延迟重置 hasDragged，避免 click 事件触发
  setTimeout(() => {
    hasDragged = false
  }, 100)
}

function handleMenuItem(action: string) {
  showFloatingMenu.value = false
  if (action === 'new') {
    createNewSession()
  } else if (action === 'knowledge-base') {
    openKnowledgeBaseDrawer()
  } else if (action === 'tasks') {
    router.push('/tasks')
  }
}

function buildNotificationTargets() {
  return {
    in_app: { enabled: true },
    email: {
      enabled: scheduledTaskForm.value.delivery_channels.includes('email'),
      target: userTaskSettings.value.notification_email || userStore.user?.email || '',
    },
    wechat: {
      enabled: scheduledTaskForm.value.delivery_channels.includes('wechat'),
      config: userTaskSettings.value.wechat_config_json || {},
    },
  }
}

async function loadUserTaskSettings() {
  try {
    const settings = await userSettingsApi.getSettings()
    userTaskSettings.value = {
      ...userTaskSettings.value,
      ...settings,
      wechat_config_json: {
        ...userTaskSettings.value.wechat_config_json,
        ...(settings.wechat_config_json || {}),
      },
    }
  } catch (error) {
    console.warn('加载任务设置失败', error)
  }
}

function ignoreScheduledTaskSuggestion() {
  chatStore.clearScheduledTaskSuggestion()
}

async function startScheduledTaskAnalysis() {
  if (!scheduledTaskSuggestion.value || !chatStore.sessionId) {
    return
  }

  scheduledTaskAnalyzing.value = true
  scheduledTaskPreview.value = null
  try {
    scheduledTaskIntentText.value = scheduledTaskSuggestion.value.intentText
    scheduledTaskSourceMessageId.value = scheduledTaskSuggestion.value.sourceMessageId
    const draftId = scheduledTaskSuggestion.value.draftId
    if (!draftId) {
      ElMessage.warning('当前草案尚未生成完成，请稍后再试')
      return
    }
    const draft = await scheduledTaskApi.getDraft(draftId)
    scheduledTaskDraft.value = draft
    scheduledTaskForm.value = {
      title: draft.title,
      description: draft.description || '',
      schedule_text: draft.schedule_text,
      cron_expression: draft.cron_expression,
      timezone: draft.timezone,
      delivery_channels: draft.content?.delivery_channels || ['in_app'],
      notification_targets_json: buildNotificationTargets(),
    }
    scheduledTaskDialogVisible.value = true
    ElMessage.success('已加载子图生成的任务草案')
  } catch (error: any) {
    ElMessage.error(error.response?.data?.detail || '加载任务草案失败')
  } finally {
    scheduledTaskAnalyzing.value = false
  }
}

async function openScheduledTaskDraft() {
  await startScheduledTaskAnalysis()
}

async function previewScheduledTaskDraft() {
  if (!scheduledTaskDraft.value) {
    return
  }
  scheduledTaskPreviewLoading.value = true
  try {
    scheduledTaskPreview.value = await scheduledTaskApi.previewDraft(scheduledTaskDraft.value.id)
    if (scheduledTaskPreview.value.success) {
      ElMessage.success('预检查通过')
    } else {
      ElMessage.warning(scheduledTaskPreview.value.message || '预检查未通过')
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.detail || '预览执行失败')
  } finally {
    scheduledTaskPreviewLoading.value = false
  }
}

async function confirmScheduledTaskDraft() {
  if (!scheduledTaskDraft.value) {
    return
  }
  scheduledTaskSubmitting.value = true
  try {
    const created = await scheduledTaskApi.createTask({
      draft_id: scheduledTaskDraft.value.id,
      title: scheduledTaskForm.value.title,
      description: scheduledTaskForm.value.description,
      schedule_text: scheduledTaskForm.value.schedule_text,
      cron_expression: scheduledTaskForm.value.cron_expression,
      timezone: scheduledTaskForm.value.timezone,
      delivery_channels: scheduledTaskForm.value.delivery_channels,
      notification_targets_json: buildNotificationTargets(),
      source_session_id: chatStore.sessionId,
      source_message_id: scheduledTaskSourceMessageId.value,
      intent_text: scheduledTaskIntentText.value || scheduledTaskDraft.value.title,
    })
    scheduledTaskDialogVisible.value = false
    scheduledTaskDraft.value = null
    scheduledTaskPreview.value = null
    scheduledTaskIntentText.value = ''
    scheduledTaskSourceMessageId.value = undefined
    ElMessage.success(`任务已创建：${created.title}`)
    router.push('/tasks')
  } catch (error: any) {
    ElMessage.error(error.response?.data?.detail || '创建任务失败')
  } finally {
    scheduledTaskSubmitting.value = false
  }
}

function getStepClass(type: string): string {
  switch (type) {
    case 'tool_start': return 'step-tool-start'
    case 'tool_end': return 'step-tool-end'
    case 'thinking_start': return 'step-thinking-start'
    case 'thinking_end': return 'step-thinking-end'
    default: return ''
  }
}

function getStepTypeLabel(type: string): string {
  switch (type) {
    case 'tool_start': return '🔧 工具开始'
    case 'tool_end': return '✅ 工具完成'
    case 'thinking_start': return '🤔 思考中'
    case 'thinking_end': return '💡 思考结果'
    default: return type
  }
}

const currentSessionTitle = computed(() => {
  if (isTempSession.value || !sessionId.value) {
    return '新会话 - 输入内容开始聊天'
  }
  const session = sessions.value.find(s => s.session_id === sessionId.value)
  return session?.title || ''
})

watch(selectedProvider, (newVal) => {
  setProvider(newVal)
})

watch(selectedModel, (newVal) => {
  setModel(newVal)
})

async function fetchSessions() {
  try {
    const response = await httpClient.get('/sessions')
    sessions.value = response.data
    const currentSession = sessions.value.find((s: any) => s.session_id === chatStore.sessionId)
    if (currentSession) {
      currentSessionKnowledgeBaseIds.value = currentSession.knowledge_base_ids || []
    }
  } catch (error) {
    console.error('获取会话列表失败:', error)
  }
}

const isTempSession = ref(false)

async function createNewSession() {
  chatStore.disconnect()
  chatStore.sessionId = ''
  chatStore.messages = []
  currentSessionKnowledgeBaseIds.value = []
  isTempSession.value = true
  nextTick(() => {
    const inputEl = document.querySelector('.chat-input input') as HTMLInputElement
    inputEl?.focus()
  })
}

async function switchSession(newSessionId: string) {
  isTempSession.value = false
  chatStore.disconnect()
  chatStore.sessionId = newSessionId
  chatStore.messages = []
  const session = sessions.value.find((item: any) => item.session_id === newSessionId)
  currentSessionKnowledgeBaseIds.value = session?.knowledge_base_ids || []
  await chatStore.connectWebSocket()
  
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

async function deleteSession(sessionIdToDelete: string) {
  try {
    await ElMessageBox.confirm('确定要删除这个会话吗？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
    
    await httpClient.delete(`/sessions/${sessionIdToDelete}`)
    
    sessions.value = sessions.value.filter(s => s.session_id !== sessionIdToDelete)
    
    if (sessionIdToDelete === sessionId.value) {
      chatStore.disconnect()
      chatStore.sessionId = ''
      chatStore.messages = []
      currentSessionKnowledgeBaseIds.value = []
      isTempSession.value = true
    }
    
    ElMessage.success('会话已删除')
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.response?.data?.detail || '删除会话失败')
    }
  }
}

function formatMessageContent(content: any): string {
  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    return content.map((item: any) => {
      if (item.type === 'text') {
        return item.content
      } else if (item.type === 'image') {
        return `[图片: ${item.content}]`
      } else if (item.type === 'audio') {
        return `[音频: ${item.content}]`
      } else if (item.type === 'document') {
        const fullname = item.content.split('/').pop() || item.content
        // 从格式 "{UUID}_{original_name}.{ext}" 中提取原始文件名
        const originalName = fullname.replace(/^\w{8}_/, '')
        return `[文档: ${originalName}]`
      }
      return ''
    }).join('\n')
  }

  return String(content)
}

function buildMultimodalContent(text: string, files: UploadedFile[]) {
  const content: Array<{ type: string; content: string }> = []
  
  if (text) {
    content.push({ type: 'text', content: text })
  }
  
  for (const file of files) {
    content.push({
      type: file.type,
      content: file.path
    })
  }
  
  return content
}

async function sendMessage() {
  if ((!inputMessage.value.trim() && uploadedFiles.value.length === 0) || chatStore.isLoading) return

  const textContent = inputMessage.value
  const files = [...uploadedFiles.value]
  inputMessage.value = ''
  uploadedFiles.value = []
  
  if (isTempSession.value || !chatStore.sessionId) {
    try {
      const response = await httpClient.post('/v1/sessions', { 
        provider: selectedProvider.value, 
        model: selectedModel.value,
        knowledge_base_ids: currentSessionKnowledgeBaseIds.value,
      })
      const newSessionId = response.data.session_id
      chatStore.sessionId = newSessionId
      isTempSession.value = false
      await fetchSessions()
      await chatStore.connectWebSocket()
    } catch (error: any) {
      ElMessage.error(error.response?.data?.detail || '创建会话失败')
      return
    }
  }
  
  const multimodalContent = buildMultimodalContent(textContent, files)
  await sendToAI(
    multimodalContent,
    selectedProvider.value,
    selectedModel.value || undefined,
    currentSessionKnowledgeBaseIds.value,
  )
}

async function openKnowledgeBaseDrawer() {
  showKnowledgeBaseDrawer.value = true
  await loadKnowledgeBases()
}

async function loadKnowledgeBases() {
  try {
    const response = await httpClient.get('/knowledge-bases')
    knowledgeBases.value = response.data
    if (!selectedKnowledgeBaseId.value && knowledgeBases.value.length > 0) {
      selectedKnowledgeBaseId.value = knowledgeBases.value[0].id
    }
    if (
      selectedKnowledgeBaseId.value &&
      !knowledgeBases.value.some(kb => kb.id === selectedKnowledgeBaseId.value)
    ) {
      selectedKnowledgeBaseId.value = knowledgeBases.value[0]?.id ?? null
    }
    if (selectedKnowledgeBaseId.value) {
      await loadKnowledgeDocuments(selectedKnowledgeBaseId.value)
    } else {
      knowledgeDocuments.value = []
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.detail || '获取知识库列表失败')
  }
}

async function createKnowledgeBase() {
  if (!knowledgeBaseForm.value.name.trim()) {
    ElMessage.warning('请输入知识库名称')
    return
  }

  creatingKnowledgeBase.value = true
  try {
    const response = await httpClient.post('/knowledge-bases', {
      name: knowledgeBaseForm.value.name.trim(),
      category: knowledgeBaseForm.value.category.trim() || null,
      description: knowledgeBaseForm.value.description.trim() || null,
    })
    knowledgeBaseForm.value = { name: '', category: '', description: '' }
    await loadKnowledgeBases()
    selectedKnowledgeBaseId.value = response.data.id
    await loadKnowledgeDocuments(response.data.id)
    ElMessage.success('知识库创建成功')
  } catch (error: any) {
    ElMessage.error(error.response?.data?.detail || '创建知识库失败')
  } finally {
    creatingKnowledgeBase.value = false
  }
}

async function deleteKnowledgeBase(kb: KnowledgeBaseItem) {
  try {
    await ElMessageBox.confirm(`确定删除知识库“${kb.name}”吗？`, '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    })

    await httpClient.delete(`/knowledge-bases/${kb.id}`)
    currentSessionKnowledgeBaseIds.value = currentSessionKnowledgeBaseIds.value.filter(id => id !== kb.id)
    if (chatStore.sessionId) {
      await syncSessionKnowledgeBases()
    }
    if (selectedKnowledgeBaseId.value === kb.id) {
      selectedKnowledgeBaseId.value = null
    }
    await loadKnowledgeBases()
    ElMessage.success('知识库已删除')
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.response?.data?.detail || '删除知识库失败')
    }
  }
}

async function selectKnowledgeBase(knowledgeBaseId: number) {
  selectedKnowledgeBaseId.value = knowledgeBaseId
  knowledgeSearchResults.value = []
  await loadKnowledgeDocuments(knowledgeBaseId)
}

async function loadKnowledgeDocuments(knowledgeBaseId: number) {
  knowledgeDocumentsLoading.value = true
  try {
    const response = await httpClient.get(`/knowledge-bases/${knowledgeBaseId}/documents`)
    knowledgeDocuments.value = response.data
  } catch (error: any) {
    ElMessage.error(error.response?.data?.detail || '获取知识库文档失败')
  } finally {
    knowledgeDocumentsLoading.value = false
  }
}

async function refreshSelectedKnowledgeBase() {
  await loadKnowledgeBases()
}

async function syncSessionKnowledgeBases() {
  if (!chatStore.sessionId) {
    return
  }

  try {
    await httpClient.put(`/sessions/${chatStore.sessionId}/knowledge-bases`, {
      knowledge_base_ids: currentSessionKnowledgeBaseIds.value,
    })

    const targetSession = sessions.value.find((session: any) => session.session_id === chatStore.sessionId)
    if (targetSession) {
      targetSession.knowledge_base_ids = [...currentSessionKnowledgeBaseIds.value]
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.detail || '更新会话知识库失败')
  }
}

async function toggleSessionKnowledgeBase(knowledgeBaseId: number) {
  if (currentSessionKnowledgeBaseIds.value.includes(knowledgeBaseId)) {
    currentSessionKnowledgeBaseIds.value = currentSessionKnowledgeBaseIds.value.filter(id => id !== knowledgeBaseId)
  } else {
    currentSessionKnowledgeBaseIds.value = [...currentSessionKnowledgeBaseIds.value, knowledgeBaseId]
  }

  if (chatStore.sessionId) {
    await syncSessionKnowledgeBases()
  }
}

async function handleKnowledgeBaseDocumentUpload(options: any) {
  if (!selectedKnowledgeBaseId.value) {
    ElMessage.warning('请先选择知识库')
    return
  }

  const formData = new FormData()
  formData.append('file', options.file)

  try {
    const response = await httpClient.post(
      `/knowledge-bases/${selectedKnowledgeBaseId.value}/documents`,
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60000,
      }
    )
    await loadKnowledgeDocuments(selectedKnowledgeBaseId.value)
    await loadKnowledgeBases()
    ElMessage.success(response.data.message || '文档已上传，正在后台处理中...')
    if (response.data.task_id) {
      pollKnowledgeBaseTask(response.data.task_id, selectedKnowledgeBaseId.value)
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.detail || '知识库文档上传失败')
  }
}

async function pollKnowledgeBaseTask(taskId: string, knowledgeBaseId: number) {
  const maxRetries = 300
  let retries = 0

  const checkStatus = async () => {
    if (retries >= maxRetries) {
      return
    }

    try {
      const response = await httpClient.get(`/v1/tasks/${taskId}`)
      const data = response.data
      if (data.status === 'SUCCESS' || data.status === 'FAILURE') {
        if (selectedKnowledgeBaseId.value === knowledgeBaseId) {
          await loadKnowledgeDocuments(knowledgeBaseId)
        }
        await loadKnowledgeBases()
        if (data.status === 'SUCCESS') {
          ElMessage.success('知识库文档处理完成')
        } else {
          ElMessage.error(data.result?.message || '知识库文档处理失败')
        }
        return
      }

      retries++
      setTimeout(checkStatus, 2000)
    } catch (error) {
      retries++
      setTimeout(checkStatus, 3000)
    }
  }

  checkStatus()
}

async function deleteKnowledgeDocument(documentId: number) {
  if (!selectedKnowledgeBaseId.value) {
    return
  }

  try {
    await ElMessageBox.confirm('确定删除这个文档吗？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await httpClient.delete(`/knowledge-bases/${selectedKnowledgeBaseId.value}/documents/${documentId}`)
    await loadKnowledgeDocuments(selectedKnowledgeBaseId.value)
    await loadKnowledgeBases()
    ElMessage.success('文档已删除')
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.response?.data?.detail || '删除文档失败')
    }
  }
}

async function runKnowledgeSearch() {
  if (!selectedKnowledgeBaseId.value) {
    ElMessage.warning('请先选择知识库')
    return
  }
  if (!knowledgeSearchQuery.value.trim()) {
    ElMessage.warning('请输入检索问题')
    return
  }

  knowledgeSearching.value = true
  try {
    const response = await httpClient.post('/knowledge-bases/search', {
      query: knowledgeSearchQuery.value.trim(),
      knowledge_base_ids: [selectedKnowledgeBaseId.value],
      top_k: 8,
    })
    knowledgeSearchResults.value = response.data.results || []
    if (knowledgeSearchResults.value.length === 0) {
      ElMessage.info('未找到相关内容')
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.detail || '知识库检索失败')
  } finally {
    knowledgeSearching.value = false
  }
}

function getDocumentStatusLabel(status: string) {
  switch (status) {
    case 'pending': return '待处理'
    case 'processing': return '处理中'
    case 'success': return '成功'
    case 'failed': return '失败'
    default: return status
  }
}

function getDocumentStatusTagType(status: string): 'info' | 'warning' | 'success' | 'danger' {
  switch (status) {
    case 'pending': return 'info'
    case 'processing': return 'warning'
    case 'success': return 'success'
    case 'failed': return 'danger'
    default: return 'info'
  }
}

function handleCommand(command: string) {
  if (command === 'logout') {
    userStore.logout()
    router.push('/login')
    ElMessage.success('已退出登录')
  }
}

function beforeImageUpload(file: File) {
  const isImage = file.type.startsWith('image/')
  const isLt50M = file.size / 1024 / 1024 < 50
  
  if (!isImage) {
    ElMessage.error('只能上传图片文件!')
    return false
  }
  if (!isLt50M) {
    ElMessage.error('图片大小不能超过 50MB!')
    return false
  }
  return true
}

function beforeAudioUpload(file: File) {
  const isAudio = file.type.startsWith('audio/')
  const isLt50M = file.size / 1024 / 1024 < 50

  if (!isAudio) {
    ElMessage.error('只能上传音频文件!')
    return false
  }
  if (!isLt50M) {
    ElMessage.error('音频大小不能超过 50MB!')
    return false
  }
  return true
}

function beforeDocumentUpload(file: File) {
  const isDocument = file.type === 'application/pdf' ||
                     file.type === 'application/msword' ||
                     file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
                     file.type === 'application/zip' ||
                     file.name.endsWith('.pdf') ||
                     file.name.endsWith('.doc') ||
                     file.name.endsWith('.docx') ||
                     file.name.endsWith('.zip')
  const isLt50M = file.size / 1024 / 1024 < 50

  if (!isDocument) {
    ElMessage.error('只能上传 PDF、Word 或 ZIP 文件!')
    return false
  }
  if (!isLt50M) {
    ElMessage.error('文档大小不能超过 50MB!')
    return false
  }
  return true
}

async function handleImageUpload(options: any) {
  const formData = new FormData()
  formData.append('file', options.file)
  
  try {
    const response = await httpClient.post('/upload/image', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
    uploadedFiles.value.push({
      type: 'image',
      path: response.data.path,
      url: response.data.url,
      filename: response.data.filename
    })
    ElMessage.success('图片上传成功')
  } catch (error: any) {
    ElMessage.error(error.response?.data?.detail || '图片上传失败')
  }
}

async function handleAudioUpload(options: any) {
  const formData = new FormData()
  formData.append('file', options.file)

  try {
    const response = await httpClient.post('/upload/audio', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
    uploadedFiles.value.push({
      type: 'audio',
      path: response.data.path,
      url: response.data.url,
      filename: response.data.filename
    })
    ElMessage.success('音频上传成功')
  } catch (error: any) {
    ElMessage.error(error.response?.data?.detail || '音频上传失败')
  }
}

async function handleDocumentUpload(options: any) {
  const formData = new FormData()
  formData.append('file', options.file)

  try {
    const response = await httpClient.post('/upload/document', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000  // 1分钟超时，只等待上传完成
    })
    const data = response.data
    const fileInfo = {
      type: 'document',
      path: data.path,
      url: data.url,
      filename: data.filename,
      processed: data.processed,
      chunks_count: data.chunks_count,
      message: data.message,
      task_id: data.task_id  // 保存任务ID用于轮询
    }
    uploadedFiles.value.push(fileInfo)

    // 显示上传成功提示
    ElMessage.success('文档上传成功，正在后台处理...')

    // 如果有任务ID，开始轮询处理进度
    if (data.task_id) {
      pollDocumentTask(data.task_id, uploadedFiles.value.length - 1)
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.detail || '文档上传失败')
  }
}

// 轮询文档处理任务状态
async function pollDocumentTask(taskId: string, fileIndex: number) {
  const maxRetries = 300  // 最多轮询300次（约5分钟）
  let retries = 0

  const checkStatus = async () => {
    if (retries >= maxRetries) {
      uploadedFiles.value[fileIndex].message = '处理超时，请稍后查询'
      return
    }

    try {
      const response = await httpClient.get(`/v1/tasks/${taskId}`)
      const data = response.data

      if (data.status === 'SUCCESS') {
        // 处理完成
        uploadedFiles.value[fileIndex].processed = true
        uploadedFiles.value[fileIndex].chunks_count = data.result?.total_chunks || 0
        uploadedFiles.value[fileIndex].message = data.result?.message || '文档处理完成'
        ElMessage.success(`文档处理完成: ${uploadedFiles.value[fileIndex].filename}`)
      } else if (data.status === 'FAILURE') {
        // 处理失败
        uploadedFiles.value[fileIndex].message = `处理失败: ${data.result?.message || '未知错误'}`
        ElMessage.error(`文档处理失败: ${uploadedFiles.value[fileIndex].filename}`)
      } else if (data.status === 'PENDING' || data.status === 'PROCESSING') {
        // 仍在处理中，更新进度信息
        const progress = data.result?.progress || 0
        const message = data.result?.message || '处理中...'
        uploadedFiles.value[fileIndex].message = `${message} (${progress}%)`
        retries++
        setTimeout(checkStatus, 2000)  // 2秒后再次查询
      } else {
        // 其他状态
        retries++
        setTimeout(checkStatus, 2000)
      }
    } catch (error: any) {
      console.error('查询任务状态失败:', error)
      retries++
      setTimeout(checkStatus, 5000)  // 出错后5秒再试
    }
  }

  // 开始轮询
  checkStatus()
}

function removeFile(index: number) {
  uploadedFiles.value.splice(index, 1)
}

function handleAudioCommand(command: string) {
  if (command === 'upload') {
    audioUploadRef.value?.$el?.querySelector('input')?.click()
  } else if (command === 'record') {
    toggleAudioRecording()
  }
}

async function toggleAudioRecording() {
  if (isRecordingAudio.value) {
    stopAudioRecording()
  } else {
    await startAudioRecording()
  }
}

// 将 AudioBuffer 转换为 WAV 格式
function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const numChannels = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate
  const format = 1 // PCM
  const bitDepth = 16
  
  const bytesPerSample = bitDepth / 8
  const blockAlign = numChannels * bytesPerSample
  
  const data = []
  for (let i = 0; i < buffer.length; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      const sample = buffer.getChannelData(channel)[i]
      const intSample = Math.max(-1, Math.min(1, sample))
      data.push(intSample < 0 ? intSample * 0x8000 : intSample * 0x7FFF)
    }
  }
  
  const dataLength = data.length * bytesPerSample
  const bufferLength = 44 + dataLength
  
  const arrayBuffer = new ArrayBuffer(bufferLength)
  const view = new DataView(arrayBuffer)
  
  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeString(view, 8, 'WAVE')
  
  // fmt sub-chunk
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, format, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitDepth, true)
  
  // data sub-chunk
  writeString(view, 36, 'data')
  view.setUint32(40, dataLength, true)
  
  // Write PCM samples
  let offset = 44
  for (const sample of data) {
    view.setInt16(offset, sample, true)
    offset += 2
  }
  
  return arrayBuffer
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i))
  }
}

async function startAudioRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    
    // 使用 AudioContext 录制为 WAV 格式
    const audioContext = new AudioContext()
    const mediaStreamSource = audioContext.createMediaStreamSource(stream)
    const destination = audioContext.createMediaStreamDestination()
    mediaStreamSource.connect(destination)
    
    mediaRecorder = new MediaRecorder(stream)
    audioChunks = []
    
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data)
      }
    }
    
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(track => track.stop())
      audioContext.close()
      
      // 将录制的音频转换为 WAV
      const audioBlob = new Blob(audioChunks)
      const arrayBuffer = await audioBlob.arrayBuffer()
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
      const wavBuffer = audioBufferToWav(audioBuffer)
      const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' })
      
      const filename = `recording_${Date.now()}.wav`
      const audioFile = new File([wavBlob], filename, { type: 'audio/wav' })
      
      console.log('[Audio Recording] WAV file info:', {
        filename,
        size: audioFile.size,
        type: audioFile.type
      })
      
      await uploadRecordedAudio(audioFile)
    }
    
    mediaRecorder.start()
    isRecordingAudio.value = true
    recordingTime.value = 0
    
    recordingTimer = window.setInterval(() => {
      recordingTime.value++
      if (recordingTime.value >= maxRecordingTime) {
        stopAudioRecording()
        ElMessage.warning('已达到最大录制时长 60 秒')
      }
    }, 1000)
    
    ElMessage.success('开始录制音频...')
  } catch (error: any) {
    console.error('录制音频失败:', error)
    if (error.name === 'NotAllowedError') {
      ElMessage.error('请允许麦克风权限')
    } else {
      ElMessage.error('无法访问麦克风，请检查设备')
    }
  }
}

function stopAudioRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop()
  }
  
  if (recordingTimer) {
    clearInterval(recordingTimer)
    recordingTimer = null
  }
  
  isRecordingAudio.value = false
}

async function uploadRecordedAudio(file: File) {
  const formData = new FormData()
  formData.append('file', file)
  
  const currentRecordingTime = recordingTime.value
  
  try {
    const response = await httpClient.post('/upload/audio', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
    uploadedFiles.value.push({
      type: 'audio',
      path: response.data.path,
      url: response.data.url,
      filename: response.data.filename
    })
    ElMessage.success(`音频录制成功 (${currentRecordingTime}秒)`)
    recordingTime.value = 0
  } catch (error: any) {
    ElMessage.error(error.response?.data?.detail || '音频上传失败')
  }
}

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

onMounted(async () => {
  await fetchSessions()
  await loadKnowledgeBases()
  await loadUserTaskSettings()
  initializeFloatingMenuPosition()

  if (sessions.value.length === 0) {
    isTempSession.value = true
  } else if (!sessionId.value) {
    await switchSession(sessions.value[0].session_id)
  } else {
    await chatStore.connectWebSocket()
  }

  window.addEventListener('resize', handleWindowResize)
})

onUnmounted(() => {
  chatStore.disconnect()
  if (recognition && isRecording.value) {
    recognition.stop()
  }
  if (mediaRecorder && isRecordingAudio.value) {
    mediaRecorder.stop()
  }
  if (recordingTimer) {
    clearInterval(recordingTimer)
  }
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
  window.removeEventListener('pointercancel', onDragEnd)
  window.removeEventListener('resize', handleWindowResize)
  if (dragFrame) {
    cancelAnimationFrame(dragFrame)
    dragFrame = 0
  }
})

function handleWindowResize() {
  applyFloatingMenuPosition(floatingMenuX.value, floatingMenuY.value)
}
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
  background: white;
  color: #303133;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  flex-shrink: 0;
  border-bottom: 1px solid #e4e7ed;
  box-shadow: 0 2px 4px rgba(0,0,0,0.05);
}

.chat-header .header-left {
  display: flex;
  align-items: center;
  min-width: 150px;
}

.logo-text {
  font-size: 1.3rem;
  font-weight: bold;
  color: #409eff;
}

.chat-header .header-title {
  flex: 1;
  margin: 0;
  font-size: 1.1rem;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-header .header-right {
  display: flex;
  align-items: center;
  min-width: 350px;
  justify-content: flex-end;
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
  max-height: calc(100vh - 200px);
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

.chat-footer {
  display: flex;
  flex-direction: column;
  padding: 0;
  background: #fff;
  border-top: 1px solid #e4e7ed;
  flex-shrink: 0;
  height: auto;
}

.knowledge-session-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 20px;
  border-bottom: 1px solid #ebeef5;
  background: #fafcff;
}

.knowledge-session-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.knowledge-session-label {
  font-size: 13px;
  color: #606266;
  font-weight: 600;
}

.knowledge-session-empty {
  font-size: 13px;
  color: #909399;
}

.knowledge-session-tag {
  margin-right: 4px;
}

.uploaded-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding: 10px 20px;
  border-bottom: 1px solid #e4e7ed;
  background: #fafafa;
}

.preview-item {
  position: relative;
  width: 80px;
  height: 80px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #e4e7ed;
}

.preview-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.preview-audio {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #f0f2f5;
  padding: 8px;
}

.audio-icon {
  font-size: 20px;
  color: #606266;
  margin-bottom: 4px;
}

.audio-player {
  width: 100%;
  height: 28px;
  font-size: 12px;
}

.remove-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 20px;
  height: 20px;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 50%;
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
}

.remove-btn:hover {
  background: rgba(245, 108, 108, 0.9);
}

.preview-document {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #f0f9eb;
  padding: 8px;
  text-align: center;
}

.document-icon {
  font-size: 24px;
  color: #67c23a;
  margin-bottom: 4px;
}

.document-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: 100%;
}

.document-name {
  font-size: 10px;
  color: #606266;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.document-status {
  font-size: 9px;
  margin-top: 2px;
}

.document-status.success {
  color: #67c23a;
}

.document-status.error {
  color: #f56c6c;
}

.preview-item.document-item {
  width: 120px;
}

.chat-input {
  display: flex;
  gap: 12px;
  padding: 16px 20px;
}

.chat-input .el-input {
  flex: 1;
}

.input-buttons {
  display: flex;
  gap: 8px;
  align-items: flex-end;
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

.thinking-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #909399;
  cursor: pointer;
  padding: 4px 8px;
  background: #f4f4f5;
  border-radius: 4px;
  margin-bottom: 8px;
}

.thinking-badge .expand-icon {
  transition: transform 0.3s;
}

.thinking-badge .expand-icon.expanded {
  transform: rotate(90deg);
}

.thinking-detail {
  background: #f8f9fa;
  border-radius: 6px;
  padding: 8px 12px;
  margin-bottom: 10px;
  font-size: 13px;
  color: #606266;
}

.thinking-detail .step-item {
  padding: 4px 0;
}

.execution-steps {
  margin-top: 16px;
  background: #f8f9fa;
  border-radius: 8px;
  padding: 12px;
  border: 1px solid #e4e7ed;
}

.steps-collapsed {
  font-size: 12px;
  color: #909399;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: #f4f4f5;
  border-radius: 4px;
  width: fit-content;
  margin-top: 8px;
}

.steps-collapsed .expand-icon {
  transition: transform 0.3s;
}

.steps-collapsed .expand-icon.expanded {
  transform: rotate(90deg);
}

.steps-header {
  font-size: 13px;
  font-weight: 600;
  color: #606266;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
}

.steps-header .expand-icon {
  transition: transform 0.3s;
  margin-left: auto;
}

.steps-header .expand-icon.expanded {
  transform: rotate(90deg);
}

.thinking-result {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 12px;
  color: #fff;
}

.thinking-result .result-label {
  font-size: 12px;
  opacity: 0.9;
  margin-bottom: 8px;
}

.thinking-result .result-content {
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
}

.steps-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.step-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 4px;
  background: #fff;
  border: 1px solid #ebeef5;
}

.step-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
}

.step-content {
  flex: 1;
  color: #606266;
}

.step-type {
  font-weight: 500;
}

.step-tool {
  color: #409eff;
  font-weight: 500;
}

.step-status {
  font-size: 11px;
  color: #909399;
}

.thinking-content {
  display: block;
  margin-top: 4px;
  color: #303133;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.step-tool-start {
  background: #ecf5ff;
  border-color: #d9ecff;
}

.step-tool-end {
  background: #f0f9ff;
  border-color: #e1f3f8;
}

.step-thinking-start {
  background: #fef0f0;
  border-color: #fde2e2;
}

.step-thinking-end {
  background: #f0f9eb;
  border-color: #e1f3d8;
}

.session-drawer .session-list {
  flex: 1;
  overflow-y: auto;
}

.session-drawer .session-footer {
  padding-top: 15px;
  border-top: 1px solid #e4e7ed;
}

.knowledge-drawer {
  display: flex;
  gap: 16px;
  height: 100%;
  min-height: 0;
}

.knowledge-sidebar {
  width: 290px;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #ebeef5;
  padding-right: 16px;
}

.knowledge-sidebar-header {
  padding-bottom: 12px;
  border-bottom: 1px solid #ebeef5;
}

.knowledge-form :deep(.el-form-item) {
  margin-bottom: 12px;
}

.knowledge-list {
  flex: 1;
  overflow-y: auto;
  padding-top: 12px;
}

.knowledge-item {
  padding: 12px;
  border: 1px solid #ebeef5;
  border-radius: 10px;
  margin-bottom: 10px;
  cursor: pointer;
  transition: all 0.2s;
}

.knowledge-item:hover,
.knowledge-item.active {
  border-color: #409eff;
  background: #f5faff;
}

.knowledge-item-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 6px;
}

.knowledge-item-desc {
  font-size: 12px;
  color: #606266;
  line-height: 1.5;
  margin-bottom: 8px;
}

.knowledge-item-meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: #909399;
}

.knowledge-item-actions {
  margin-top: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.knowledge-content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding-right: 4px;
}

.knowledge-content-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 16px;
}

.knowledge-content-header h3 {
  margin: 0 0 6px;
}

.knowledge-content-header p {
  margin: 0;
  color: #606266;
  font-size: 13px;
}

.knowledge-content-actions {
  display: flex;
  gap: 8px;
}

.knowledge-section {
  margin-bottom: 20px;
  padding: 14px;
  border: 1px solid #ebeef5;
  border-radius: 12px;
  background: #fff;
}

.knowledge-section-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 12px;
}

.knowledge-document-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.knowledge-document-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  background: #f8fafc;
}

.knowledge-document-name {
  font-weight: 500;
  color: #303133;
  margin-bottom: 6px;
}

.knowledge-document-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #909399;
}

.knowledge-document-error {
  margin-top: 6px;
  font-size: 12px;
  color: #f56c6c;
}

.knowledge-search-box {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.knowledge-search-results {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.knowledge-search-item {
  padding: 12px;
  border-radius: 10px;
  background: #f8fafc;
  border: 1px solid #ebeef5;
}

.knowledge-search-source {
  font-size: 12px;
  color: #409eff;
  margin-bottom: 6px;
  font-weight: 600;
}

.knowledge-search-content {
  font-size: 13px;
  color: #303133;
  line-height: 1.7;
  white-space: pre-wrap;
}

.floating-menu {
  position: fixed;
  left: 0;
  top: 0;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: #409eff;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(64, 158, 255, 0.4);
  z-index: 100;
  transition: box-shadow 0.2s ease, transform 0.2s ease;
  touch-action: none;
  user-select: none;
  will-change: transform;
}

.floating-menu:hover {
  box-shadow: 0 6px 16px rgba(64, 158, 255, 0.5);
}

.floating-menu.dragging {
  transition: none;
  box-shadow: 0 8px 20px rgba(64, 158, 255, 0.35);
}

.floating-dropdown {
  position: fixed;
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  z-index: 100;
  min-width: 140px;
  overflow: hidden;
}

.floating-item {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  cursor: pointer;
  transition: background 0.2s;
}

.floating-item:hover {
  background: #f5f7fa;
}

.floating-item .el-icon {
  margin-right: 8px;
  color: #409eff;
}
</style>
