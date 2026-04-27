<template>
  <div
    class="agent-os-page"
    :class="{
      'sidebar-collapsed-layout': sidebarCollapsed,
      'conversation-collapsed-layout': conversationCollapsed,
      'workspace-hidden-layout': workspaceHidden,
      'workspace-fullscreen-layout': workspaceFullscreen,
    }"
  >
    <aside class="sidebar-shell" :class="{ collapsed: sidebarCollapsed }">
      <div class="brand-card panel-card">
        <div class="brand-mark">AI</div>
        <div>
          <div class="brand-title">AI Agent OS</div>
          <div class="brand-subtitle">多智能体协作操作系统</div>
        </div>
      </div>

      <div class="sidebar-actions">
        <button class="primary-action" @click="openNewSessionDialog">
          <span>+</span>
          <span>新建会话</span>
        </button>
        <button class="secondary-action" @click="newProjectDialogVisible = true">
          <span>+</span>
          <span>新建项目</span>
        </button>
      </div>

      <div class="sidebar-scroll soft-scrollbar">
        <section class="sidebar-section">
          <div class="section-head">
            <span>我的项目</span>
            <span class="section-meta">{{ projectSpaces.length }}</span>
          </div>

          <div class="project-list">
            <button
              v-for="project in projectSpaces"
              :key="project.id"
              class="project-card"
              :class="{ active: selectedProjectId === project.id }"
              @click="selectProject(project.id)"
            >
              <div class="project-card-top">
                <div class="project-title-row">
                  <span class="project-icon">{{ project.icon }}</span>
                  <span class="project-title">{{ project.name }}</span>
                </div>
                <span class="project-count">{{ project.sessions.length }}</span>
              </div>

              <div v-if="selectedProjectId === project.id" class="project-session-list">
                <button
                  v-for="session in project.sessions"
                  :key="session.id"
                  class="session-item"
                  :class="{ active: selectedSessionId === session.id }"
                  @click.stop="selectSession(project.id, session.id)"
                >
                  <span>{{ session.title }}</span>
                  <span class="session-time">{{ session.updatedAt }}</span>
                </button>

                <div v-if="project.sessions.length === 0" class="session-empty-tip">
                  这个项目还没有会话
                </div>
              </div>
            </button>
          </div>
        </section>

        <section class="sidebar-section">
          <div class="section-head">
            <span>我的会话</span>
            <span class="section-meta">{{ personalSessions.length }}</span>
          </div>

          <div class="project-session-list loose">
            <button
              v-for="session in personalSessions"
              :key="session.id"
              class="session-item"
              :class="{ active: selectedSessionId === session.id && !selectedProjectId }"
              @click="selectSession(undefined, session.id)"
            >
              <span>{{ session.title }}</span>
              <span class="session-time">{{ session.updatedAt }}</span>
            </button>
          </div>
        </section>
      </div>

      <div class="profile-card panel-card">
        <div class="profile-avatar">GX</div>
        <div>
          <div class="profile-name">AI Master</div>
          <div class="profile-plan">Pro 全栈席位</div>
        </div>
      </div>
    </aside>

    <div class="layout-divider sidebar-divider">
      <button
        class="divider-toggle"
        :title="sidebarCollapsed ? '展开左侧栏' : '折叠左侧栏'"
        @click="sidebarCollapsed = !sidebarCollapsed"
      >
        {{ sidebarCollapsed ? "›" : "‹" }}
      </button>
    </div>

    <main v-if="!conversationCollapsed" class="conversation-shell">
      <div v-if="!conversationCollapsed && selectedProject" class="project-toolbar panel-card">
        <div class="toolbar-label">当前项目空间</div>
        <el-select
          v-model="selectedProjectId"
          class="project-select"
          popper-class="agent-dark-select-popper"
          placeholder="选择项目空间"
          @change="handleProjectSelect"
        >
          <el-option
            v-for="project in projectSpaces"
            :key="project.id"
            :label="project.name"
            :value="project.id"
          />
        </el-select>
        <button class="ghost-mini">项目空间设置</button>
      </div>

      <section v-if="!conversationCollapsed" class="conversation-panel panel-card">
        <div v-if="selectedProject && !currentSession" class="project-empty-state">
          <div class="empty-icon">+</div>
          <div class="empty-title">这个项目空间还没有会话</div>
          <p>先创建一个会话，并为它选择一个或多个智能体，让后续协作有清晰的工作入口。</p>
          <button class="inline-primary" @click="openNewSessionDialog">创建会话</button>
        </div>

        <template v-else>
          <div class="conversation-scroll soft-scrollbar">
            <article
              v-for="message in currentSession?.messages || []"
              :key="message.id"
              class="message-row"
              :class="message.role"
            >
              <div class="message-avatar">
                {{ message.role === "assistant" ? (message.run?.agentName ? getAgentShortName(message.run.agentName) : primaryAgent.short) : "我" }}
              </div>
              <div class="message-card">
                <div class="message-meta">
                  <span>{{ message.role === "assistant" ? (message.run?.agentName || primaryAgent.name) : "我" }}</span>
                  <span>{{ message.time }}</span>
                </div>
                <div class="message-content">{{ message.content }}</div>

                <!-- 执行摘要和步骤 - 仅在有步骤的 run 时显示（子 Agent 执行） -->
                <section v-if="message.run && message.run.steps && message.run.steps.length > 0" class="execution-summary">
                  <div class="summary-head">
                    <div>
                      <div class="summary-title">
                        <span v-if="message.run.agentName">{{ message.run.agentName }}</span>
                        <span v-else>执行摘要</span>
                        <span class="run-id-badge" @click="copyRunId(message.run.runId)">
                          Run: {{ message.run.runId.slice(0, 8) }}...
                        </span>
                      </div>
                      <div class="summary-subtitle">
                        <span v-if="message.run.status === 'running'">智能体正在执行任务...</span>
                        <span v-else-if="message.run.status === 'success'">执行完成</span>
                        <span v-else>执行失败</span>
                      </div>
                    </div>
                    <button class="ghost-mini" @click="toggleRunExpanded(message.run)">
                      {{ message.run.isExpanded ? "收起步骤" : `查看步骤（${message.run.steps.length}）` }}
                    </button>
                  </div>

                  <div class="summary-progress">
                    <div class="progress-ring" :class="message.run.status">
                      <span v-if="message.run.status === 'running'">
                        <i class="loading-spinner"></i>
                      </span>
                      <span v-else-if="message.run.status === 'success'">✓</span>
                      <span v-else>✗</span>
                    </div>
                    <div>
                      <!-- 对于主 Agent 直接回复的消息，不显示 resultSummary 避免与消息内容重复 -->
                      <div v-if="message.run.agentName !== 'AI Assistant'" class="summary-text">
                        {{ message.run.resultSummary || message.run.steps[message.run.steps.length - 1]?.content || '执行中...' }}
                      </div>
                      <div class="summary-progress-meta">
                        {{ getStepTypeSummary(message.run.steps) }}
                      </div>
                    </div>
                  </div>

                  <div v-if="message.run.isExpanded" class="execution-steps">
                    <div
                      v-for="step in message.run.steps"
                      :key="step.stepIndex"
                      class="execution-step"
                      :class="step.stepType"
                    >
                      <div class="execution-step-top">
                        <div class="step-left">
                          <span class="step-type-badge">{{ formatStepType(step.stepType) }}</span>
                          <span v-if="step.agentName" class="step-agent-name">{{ step.agentName }}</span>
                        </div>
                        <span class="step-time">{{ formatTime(step.createdAt) }}</span>
                      </div>
                      <p v-if="step.content" class="step-content">{{ step.content }}</p>
                      <p v-if="step.toolName" class="step-tool">
                        <strong>工具:</strong> {{ step.toolName }}
                        <span v-if="step.toolStatus" :class="['tool-status', step.toolStatus]">
                          {{ step.toolStatus }}
                        </span>
                      </p>
                    </div>
                  </div>
                </section>
              </div>
            </article>
          </div>

          <div v-if="false" class="conversation-collapsed-rail panel-card">
            <div class="collapsed-rail-label">聊天窗口已折叠</div>
            <button class="inline-primary collapsed-rail-action" @click="conversationCollapsed = false">
              展开聊天
            </button>
          </div>

          <div class="composer">
            <div class="composer-tools">
              <button class="tool-chip">+ 附件</button>
              <button class="tool-chip">@ 智能体</button>
              <button class="tool-chip"># 项目上下文</button>
            </div>
            <div class="composer-box">
              <textarea
                v-model="draftMessage"
                placeholder="输入你的需求或问题，让智能体继续写作、改写、润色或分析。"
              />
              <button class="send-button" @click="sendMessage">发送</button>
            </div>
          </div>
        </template>
      </section>
    </main>

    <div v-if="conversationCollapsed" class="floating-composer panel-card">
      <div class="composer-tools">
        <button class="tool-chip">+ 附件</button>
        <button class="tool-chip">@ 智能体</button>
        <button class="tool-chip"># 项目上下文</button>
      </div>
      <div class="composer-box">
        <textarea
          v-model="draftMessage"
          placeholder="输入你的需求或问题，让智能体继续写作、改写、润色或分析。"
        />
        <button class="send-button" @click="sendMessage">发送</button>
      </div>
    </div>
    <div
      v-if="!workspaceHidden && !workspaceFullscreen && !conversationCollapsed"
      class="layout-divider center-divider"
    >
      <button
        class="divider-toggle"
        :title="conversationCollapsed ? '展开聊天窗口' : '折叠聊天窗口'"
        @click="conversationCollapsed = !conversationCollapsed"
      >
        聊
      </button>
      <button
        class="divider-toggle"
        :title="workspaceHidden ? '展开右侧工作台' : '折叠右侧工作台'"
        @click="workspaceHidden = !workspaceHidden"
      >
        右
      </button>
    </div>

    <button
      v-if="conversationCollapsed && !workspaceHidden && !workspaceFullscreen"
      class="conversation-reveal-float"
      :title="'展开聊天窗口'"
      @click="conversationCollapsed = false"
    >
      聊
    </button>

    <section
      v-if="!workspaceHidden"
      class="workspace-host"
      :class="{ fullscreen: workspaceFullscreen }"
    >
      <header class="workspace-header">
        <div class="workspace-header-left">
          <div class="workspace-host-title">{{ selectedWorkContext?.title || '未选择工作上下文' }}</div>
          <div class="workspace-host-subtitle" v-if="selectedWorkContext">
            {{ selectedWorkContext.goal || '暂无目标描述' }}
          </div>
        </div>

        <div class="workspace-header-actions">
          <div class="workspace-tab-group">
            <button
              v-for="tab in workspaceTabs"
              :key="tab"
              class="workspace-tab"
              :class="{ active: activeWorkspaceTab === tab }"
              @click="activeWorkspaceTab = tab"
            >
              {{ tab }}
            </button>
          </div>

          <div class="workspace-window-actions">
            <button class="ghost-mini" @click="toggleWorkspaceFullscreen">
              {{ workspaceFullscreen ? "退出全屏" : "全屏" }}
            </button>
            <button class="ghost-mini" @click="workspaceHidden = true">隐藏</button>
          </div>
        </div>
      </header>

      <div class="workspace-content soft-scrollbar">
        <!-- Tab: 上下文 - WorkContext 结构化展示 -->
        <div v-if="activeWorkspaceTab === '上下文'" class="workspace-tab-panel">
          <div v-if="!selectedWorkContext" class="workspace-empty-state">
            <div class="empty-title">暂无工作上下文</div>
            <div class="empty-desc">发送消息开始工作后会自动创建工作上下文</div>
          </div>
          <div v-else class="workcontext-detail">
            <div class="detail-section">
              <div class="detail-label">目标</div>
              <div class="detail-value">{{ selectedWorkContext.goal || '暂无目标' }}</div>
            </div>
            <div class="detail-row">
              <div class="detail-section half">
                <div class="detail-label">状态</div>
                <div class="detail-value status-badge" :class="selectedWorkContext.status">
                  {{ selectedWorkContext.status || '进行中' }}
                </div>
              </div>
              <div class="detail-section half">
                <div class="detail-label">来源</div>
                <div class="detail-value">{{ selectedWorkContext.source || '手动创建' }}</div>
              </div>
            </div>
            <div class="detail-section">
              <div class="detail-label">进度摘要</div>
              <div class="detail-value progress-summary">{{ getWorkContextProgressSummary(selectedWorkContext) }}</div>
            </div>
            <div class="detail-section">
              <div class="detail-label">最近一次运行</div>
              <div class="detail-value recent-run" v-if="selectedWorkContext.currentRunId">
                Run #{{ selectedWorkContext.currentRunId }}
              </div>
              <div class="detail-value empty" v-else>暂无运行记录</div>
            </div>
            <div class="detail-section">
              <div class="detail-label">最近一次产物</div>
              <div class="detail-value recent-artifact" v-if="selectedWorkContext.latestArtifactId">
                Artifact #{{ selectedWorkContext.latestArtifactId }}
              </div>
              <div class="detail-value empty" v-else>暂无产物</div>
            </div>
            <div class="detail-section">
              <div class="detail-label">更新时间</div>
              <div class="detail-value">{{ formatTime(selectedWorkContext.updatedAt) }}</div>
            </div>
          </div>
        </div>

        <!-- Tab: 产物 - Artifact 列表与详情 -->
        <div v-if="activeWorkspaceTab === '产物'" class="workspace-tab-panel">
          <div class="artifact-split-panel">
            <div class="artifact-list">
              <div class="panel-header">
                <span class="panel-title">产物列表 ({{ workContextArtifacts.length }})</span>
              </div>
              <div class="artifact-items">
                <div
                  v-for="artifact in workContextArtifacts"
                  :key="artifact.artifactUid"
                  class="artifact-item"
                  :class="{ active: selectedArtifact?.artifactUid === artifact.artifactUid }"
                  @click="selectedArtifact = artifact"
                >
                  <div class="artifact-type">{{ artifact.artifactType }}</div>
                  <div class="artifact-title">{{ artifact.title || '未命名产物' }}</div>
                  <div class="artifact-meta">
                    <span>{{ formatTime(artifact.createdAt) }}</span>
                    <span :class="['artifact-status', artifact.status]">{{ artifact.status }}</span>
                  </div>
                </div>
                <div v-if="workContextArtifacts.length === 0" class="empty-list">
                  暂无产物
                </div>
              </div>
            </div>
            <div class="artifact-detail" v-if="selectedArtifact">
              <div class="panel-header">
                <span class="panel-title">产物详情</span>
              </div>
              <div class="artifact-content">
                <div class="detail-row">
                  <span class="detail-label">类型:</span>
                  <span class="detail-value">{{ selectedArtifact.artifactType }}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">标题:</span>
                  <span class="detail-value">{{ selectedArtifact.title }}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">MIME:</span>
                  <span class="detail-value">{{ selectedArtifact.mimeType || '-' }}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">状态:</span>
                  <span class="detail-value">{{ selectedArtifact.status }}</span>
                </div>
                <div class="artifact-preview" v-if="selectedArtifact.contentText">
                  <div class="preview-label">内容预览</div>
                  <pre class="preview-content">{{ selectedArtifact.contentText }}</pre>
                </div>
              </div>
            </div>
            <div class="artifact-detail empty" v-else>
              <div class="empty-state">选择一个产物查看详情</div>
            </div>
          </div>
        </div>

        <!-- Tab: 执行过程 - Run 列表与 Steps -->
        <div v-if="activeWorkspaceTab === '执行过程'" class="workspace-tab-panel">
          <div class="run-split-panel">
            <div class="run-list">
              <div class="panel-header">
                <span class="panel-title">执行记录 ({{ workContextRuns.length }})</span>
              </div>
              <div class="run-items">
                <div
                  v-for="run in workContextRuns"
                  :key="run.runUid"
                  class="run-item"
                  :class="{ active: selectedRun?.runUid === run.runUid, [run.status]: true }"
                  @click="selectRun(run)"
                >
                  <div class="run-header">
                    <span class="run-id">{{ run.runUid.slice(0, 12) }}...</span>
                    <span class="run-status" :class="run.status">{{ run.status }}</span>
                  </div>
                  <div class="run-agent">{{ run.agentName || run.agentId }}</div>
                  <div class="run-summary" v-if="run.resultSummary">{{ run.resultSummary.slice(0, 60) }}...</div>
                  <div class="run-time">{{ formatTime(run.startedAt) }}</div>
                </div>
                <div v-if="workContextRuns.length === 0" class="empty-list">
                  暂无执行记录
                </div>
              </div>
            </div>
            <div class="run-detail" v-if="selectedRun">
              <div class="panel-header">
                <span class="panel-title">执行详情</span>
              </div>
              <div class="run-steps" v-if="selectedRunSteps.length > 0">
                <div
                  v-for="step in selectedRunSteps"
                  :key="step.id"
                  class="run-step-item"
                  :class="step.stepType"
                >
                  <div class="step-header">
                    <span class="step-index">#{{ step.stepIndex }}</span>
                    <span class="step-type">{{ step.stepType }}</span>
                    <span class="step-time">{{ formatTime(step.createdAt) }}</span>
                  </div>
                  <div class="step-content" v-if="step.content">{{ step.content }}</div>
                  <div class="step-tool" v-if="step.toolName">
                    <span class="tool-name">{{ step.toolName }}</span>
                    <span class="tool-status" :class="step.toolStatus">{{ step.toolStatus }}</span>
                  </div>
                </div>
              </div>
              <div class="run-info" v-else>
                <div class="info-row">
                  <span class="info-label">Agent:</span>
                  <span class="info-value">{{ selectedRun.agentName || selectedRun.agentId }}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">状态:</span>
                  <span class="info-value" :class="selectedRun.status">{{ selectedRun.status }}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">消息:</span>
                  <span class="info-value">{{ selectedRun.userMessage }}</span>
                </div>
                <div class="info-row" v-if="selectedRun.resultSummary">
                  <span class="info-label">结果:</span>
                  <span class="info-value">{{ selectedRun.resultSummary }}</span>
                </div>
              </div>
            </div>
            <div class="run-detail empty" v-else>
              <div class="empty-state">选择一个执行记录查看详情</div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <button v-if="workspaceHidden" class="workspace-reveal" @click="workspaceHidden = false">
      打开工作台
    </button>

    <el-dialog v-model="newSessionDialogVisible" title="新建会话" width="760px" destroy-on-close>
      <div class="dialog-body session-dialog-body">
        <div class="dialog-intro">
          <div class="dialog-intro-title">选择本次会话要启用的智能体</div>
          <div class="dialog-intro-desc">
            你可以只选一个，也可以多选。后续主智能体可以根据已选智能体做协同调度。
          </div>
        </div>

        <div class="agent-choice-grid">
          <button
            v-for="agent in agentList"
            :key="agent.id"
            class="agent-choice-card"
            @click="togglePendingAgent(agent.id)"
          >
            <div class="agent-choice-top">
              <div class="agent-avatar" :style="{ background: agent.avatar }">
                {{ agent.short }}
              </div>
              <div class="agent-choice-check" :class="{ active: pendingAgentIds.includes(agent.id) }">
                ✓
              </div>
            </div>
            <div class="agent-choice-name">{{ agent.name }}</div>
            <div class="agent-choice-desc">{{ agent.description }}</div>
            <div class="agent-choice-meta">
              <span class="status-inline dialog-status">
                <span class="status-dot" :class="agent.status"></span>
                {{ statusLabelMap[agent.status] }}
              </span>
            </div>
          </button>
        </div>

        <div>
          <div class="dialog-label">会话标题</div>
          <input
            v-model="pendingSessionTitle"
            class="dialog-input"
            placeholder="例如：课程大纲撰写"
          />
        </div>

        <div>
          <div class="dialog-label">保存位置</div>
          <div class="dialog-target-row">
            <button
              class="target-card"
              :class="{ active: pendingSessionLocation === 'project' }"
              @click="pendingSessionLocation = 'project'"
            >
              <div class="target-title">项目空间</div>
              <div class="target-desc">归档到某个项目下，方便按项目继续协作。</div>
            </button>
            <button
              class="target-card"
              :class="{ active: pendingSessionLocation === 'personal' }"
              @click="pendingSessionLocation = 'personal'"
            >
              <div class="target-title">我的会话</div>
              <div class="target-desc">不归属项目空间，直接作为个人会话保留。</div>
            </button>
          </div>
        </div>

        <div>
          <div class="dialog-label">协作描述</div>
          <textarea
            v-model="pendingSessionDescription"
            class="dialog-textarea"
            placeholder="例如：研究 Agent 先查资料，写作 Agent 再成稿，主 Agent 最后汇总。"
          />
        </div>

        <div v-if="pendingSessionLocation === 'project'">
          <div class="dialog-label">选择项目空间</div>
          <el-select
            v-model="pendingProjectTargetId"
            class="dialog-select"
            popper-class="agent-dark-select-popper"
            placeholder="选择项目空间"
          >
            <el-option
              v-for="project in projectSpaces"
              :key="project.id"
              :label="project.name"
              :value="project.id"
            />
          </el-select>
        </div>
      </div>

      <template #footer>
        <div class="dialog-footer">
          <button class="ghost-button" @click="newSessionDialogVisible = false">取消</button>
          <button class="primary-action compact" @click="createSession">创建会话</button>
        </div>
      </template>
    </el-dialog>

    <el-dialog v-model="newProjectDialogVisible" title="新建项目" width="520px" destroy-on-close>
      <div class="dialog-body">
        <div>
          <div class="dialog-label">项目名称</div>
          <input
            v-model="pendingProjectTitle"
            class="dialog-input"
            placeholder="例如：教育内容创作项目"
          />
        </div>
      </div>

      <template #footer>
        <div class="dialog-footer">
          <button class="ghost-button" @click="newProjectDialogVisible = false">取消</button>
          <button class="primary-action compact" @click="createProject">创建项目</button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { useRoute } from "vue-router";

import { agentPlatformApi, type AgentRecord, type ProjectRecord, type AgentRunRecord, type WorkContextRecord, type AgentArtifactRecord, type AgentRunStepRecord } from "@/api/agentPlatform";

type AgentStatus = "online" | "busy" | "idle";
type WorkspaceType = "writing" | "browser" | "research" | "video";

interface SidebarAgent {
  id: string;
  name: string;
  short: string;
  avatar: string;
  description: string;
  status: AgentStatus;
  workspaceType: WorkspaceType;
}

interface RunStep {
  stepIndex: number;
  stepType: string;
  content?: string;
  toolName?: string;
  toolStatus?: string;
  input?: unknown;
  output?: unknown;
  createdAt: string;
  agentName?: string;
}

interface RunInfo {
  runId: string;
  agentId: string;
  agentName?: string;
  status: 'running' | 'success' | 'failed';
  resultSummary?: string;
  steps: RunStep[];
  isExpanded: boolean;
  isSubscribed: boolean;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  time: string;
  run?: RunInfo;
}

interface SessionItem {
  id: string;
  title: string;
  description?: string;
  updatedAt: string;
  agentIds: string[];
  messages: ChatMessage[];
}

interface ProjectSpace {
  id: string;
  name: string;
  icon: string;
  sessions: SessionItem[];
}

const route = useRoute();

const statusLabelMap: Record<AgentStatus, string> = {
  online: "运行中",
  busy: "协作中",
  idle: "空闲",
};

const fallbackAgents: SidebarAgent[] = [
  {
    id: "browser_agent",
    name: "浏览器 Agent",
    short: "浏",
    avatar: "linear-gradient(135deg, #0ea5e9, #2563eb)",
    description: "负责网页访问、信息采集与自动操作。",
    status: "online",
    workspaceType: "browser",
  },
  {
    id: "research_agent",
    name: "文档研究 Agent",
    short: "研",
    avatar: "linear-gradient(135deg, #14b8a6, #10b981)",
    description: "负责资料阅读、检索总结与知识整合。",
    status: "idle",
    workspaceType: "research",
  },
  {
    id: "writing_agent",
    name: "文档写作 Agent",
    short: "写",
    avatar: "linear-gradient(135deg, #7c3aed, #5b6dff)",
    description: "负责写作、改写、润色与结构优化。",
    status: "busy",
    workspaceType: "writing",
  },
  {
    id: "video_agent",
    name: "视频剪辑 Agent",
    short: "剪",
    avatar: "linear-gradient(135deg, #f97316, #ef4444)",
    description: "负责镜头剪辑、素材整理与节奏处理。",
    status: "idle",
    workspaceType: "video",
  },
];

const projectSpaces = ref<ProjectSpace[]>([]);
const personalSessions = ref<SessionItem[]>([]);
const isLoadingProjects = ref(false);
const isLoadingSessions = ref(false);

const executionSummary =
  "正在协调文档写作智能体与研究智能体，准备补足结构、案例与表达细节。";

const executionSteps = [
  {
    id: "step-1",
    title: "生成初始大纲",
    status: "已完成",
    detail: "完成章节结构与写作方向梳理，形成可继续扩写的主干。",
  },
  {
    id: "step-2",
    title: "补充案例素材",
    status: "进行中",
    detail: "正在为 3.2 节补充更贴合团队协作场景的案例与建议。",
  },
  {
    id: "step-3",
    title: "优化语句表达",
    status: "排队中",
    detail: "将对生成内容做一轮语言润色与逻辑压缩，提升可读性。",
  },
];

const workspaceTemplateMap: Record<
  WorkspaceType,
  {
    name: string;
    short: string;
    avatar: string;
    subtitle: string;
    description: string;
    panelIntro: string;
    features: { title: string; description: string }[];
  }
> = {
  writing: {
    name: "文档写作工作台",
    short: "写",
    avatar: "linear-gradient(135deg, #7c3aed, #5b6dff)",
    subtitle: "面向长文撰写、章节编辑与结构优化",
    description: "这里会承载文档编辑器、大纲、建议批注、版本记录等写作工作能力。",
    panelIntro: "当前是写作工作台宿主壳子，后续会接入真正的文档编辑与版本对比视图。",
    features: [
      { title: "正文编辑", description: "用于承载主文档内容、段落编排与实时修改。" },
      { title: "结构大纲", description: "显示标题层级、章节导航与整体结构调整入口。" },
      { title: "AI 批注", description: "用于展示润色建议、改写提示与高亮反馈。" },
      { title: "版本对比", description: "追踪不同写作阶段的内容变化与修订记录。" },
    ],
  },
  browser: {
    name: "浏览器工作台",
    short: "浏",
    avatar: "linear-gradient(135deg, #0ea5e9, #2563eb)",
    subtitle: "面向网页浏览、页面操作与采集整理",
    description: "这里会承载浏览器视图、网页任务状态、页面抓取结果与自动化步骤。",
    panelIntro: "当前是浏览器工作台宿主壳子，后续会接入真实网页视图与浏览动作记录。",
    features: [
      { title: "网页视图", description: "显示当前访问页面与页面上下文。" },
      { title: "操作面板", description: "承载点击、输入、采集等浏览动作。" },
      { title: "结果抽取", description: "整理网页结构化信息与抓取内容。" },
      { title: "任务回放", description: "回看自动操作路径与关键步骤。" },
    ],
  },
  research: {
    name: "研究工作台",
    short: "研",
    avatar: "linear-gradient(135deg, #14b8a6, #10b981)",
    subtitle: "面向资料研读、摘要整理与知识沉淀",
    description: "这里会承载资料列表、摘录、高亮、知识图谱与研究结论产出。",
    panelIntro: "当前是研究工作台宿主壳子，后续会接入文档阅读器与引用整理能力。",
    features: [
      { title: "资料列表", description: "管理来源文档、网页摘录与引用材料。" },
      { title: "重点摘录", description: "沉淀高价值片段，支持摘要与标签归类。" },
      { title: "知识图谱", description: "组织概念关系与主题脉络。" },
      { title: "研究结论", description: "输出结构化结论与可复用见解。" },
    ],
  },
  video: {
    name: "视频剪辑工作台",
    short: "剪",
    avatar: "linear-gradient(135deg, #f97316, #ef4444)",
    subtitle: "面向素材整理、剪辑时间线与镜头编排",
    description: "这里会承载素材管理、时间线、剪辑建议与导出设置。",
    panelIntro: "当前是视频工作台宿主壳子，后续会接入时间线与镜头管理视图。",
    features: [
      { title: "素材区", description: "整理镜头、音频、字幕与附件素材。" },
      { title: "时间线", description: "承载剪辑片段排序、节奏编辑与标记。" },
      { title: "建议面板", description: "展示节奏优化、转场与叙事建议。" },
      { title: "导出配置", description: "配置分辨率、比例与输出版本。" },
    ],
  },
};

const agentList = ref<SidebarAgent[]>(fallbackAgents);
const selectedProjectId = ref<string>(projectSpaces.value[0]?.id || "");
const selectedSessionId = ref<string>(projectSpaces.value[0]?.sessions[0]?.id || "");
const selectedAgentId = ref<string>("writing_agent");
const draftMessage = ref("");
const sidebarCollapsed = ref(false);
const conversationCollapsed = ref(false);
const workspaceHidden = ref(false);
const workspaceFullscreen = ref(false);

// WorkContext 和 Artifact 相关状态
const sessionWorkContexts = ref<WorkContextRecord[]>([]);
const selectedWorkContext = ref<WorkContextRecord | null>(null);
const workContextArtifacts = ref<AgentArtifactRecord[]>([]);
const sessionRuns = ref<AgentRunRecord[]>([]);
const workContextRuns = ref<AgentRunRecord[]>([]);

// 右侧工作台 Tab：围绕 WorkContext & Artifact 组织
const activeWorkspaceTab = ref("上下文");
const newSessionDialogVisible = ref(false);
const newProjectDialogVisible = ref(false);
const pendingAgentIds = ref<string[]>(["writing_agent"]);
const pendingSessionDescription = ref("");
const pendingSessionTitle = ref("新的创作会话");
const pendingSessionLocation = ref<"project" | "personal">("project");
const pendingProjectTargetId = ref<string>(projectSpaces.value[0]?.id || "");
const pendingProjectTitle = ref("");

// 右侧工作台 Tab：围绕 WorkContext & Artifact 组织
const workspaceTabs = ["上下文", "产物", "执行过程"];

// 右侧选中的状态
const selectedArtifact = ref<AgentArtifactRecord | null>(null);
const selectedRun = ref<AgentRunRecord | null>(null);
const selectedRunSteps = ref<AgentRunStepRecord[]>([]);

const selectedProject = computed(() =>
  projectSpaces.value.find((project) => project.id === selectedProjectId.value),
);

const currentSession = computed(() => {
  if (selectedProject.value) {
    return selectedProject.value.sessions.find((session) => session.id === selectedSessionId.value);
  }
  return personalSessions.value.find((session) => session.id === selectedSessionId.value);
});

const currentSessionAgents = computed(() => {
  const ids = currentSession.value?.agentIds || [];
  const matched = agentList.value.filter((agent) => ids.includes(agent.id));
  return matched.length ? matched : [agentList.value[0]];
});

const primaryAgent = computed(() => {
  if (selectedAgentId.value) {
    const explicit = agentList.value.find((agent) => agent.id === selectedAgentId.value);
    if (explicit) return explicit;
  }
  return currentSessionAgents.value[0] || agentList.value[0];
});

const workspaceTemplate = computed(
  () => workspaceTemplateMap[primaryAgent.value.workspaceType] || workspaceTemplateMap.writing,
);

function selectProject(projectId: string) {
  selectedProjectId.value = projectId;
  const project = projectSpaces.value.find((item) => item.id === projectId);
  const latestSession = project?.sessions[0];

  if (latestSession) {
    selectedSessionId.value = latestSession.id;
    selectedAgentId.value = latestSession.agentIds[0] || selectedAgentId.value;
  } else {
    selectedSessionId.value = "";
  }
}

function handleProjectSelect(projectId: string) {
  selectProject(projectId);
}

async function selectSession(projectId: string | undefined, sessionId: string) {
  selectedProjectId.value = projectId || "";
  selectedSessionId.value = sessionId;

  const sourceSession = projectId
    ? projectSpaces.value
        .find((project) => project.id === projectId)
        ?.sessions.find((session) => session.id === sessionId)
    : personalSessions.value.find((session) => session.id === sessionId);

  if (sourceSession?.agentIds?.length) {
    selectedAgentId.value = sourceSession.agentIds[0];
  }

  // 加载会话的消息历史
  if (sourceSession) {
    await loadSessionMessages(sourceSession);
  }

  // 加载并选中该会话的 WorkContext
  await loadAndSelectSessionWorkContext(sessionId);
}

// 加载并选中会话的 WorkContext
async function loadAndSelectSessionWorkContext(sessionId: string) {
  try {
    console.log(`[loadAndSelectSessionWorkContext] Loading work contexts for session: ${sessionId}`);
    const workContexts = await agentPlatformApi.listWorkContexts({ sessionId, limit: 10 });
    console.log(`[loadAndSelectSessionWorkContext] Loaded ${workContexts.length} work contexts`);

    sessionWorkContexts.value = workContexts;

    if (workContexts.length > 0) {
      // 选择最近更新的 workContext
      const sorted = [...workContexts].sort((a, b) => {
        const timeA = new Date(a.updatedAt || a.createdAt).getTime();
        const timeB = new Date(b.updatedAt || b.createdAt).getTime();
        return timeB - timeA;
      });
      selectedWorkContext.value = sorted[0];
      console.log(`[loadAndSelectSessionWorkContext] Selected work context: ${sorted[0].workContextUid}`);

      // 加载该 workContext 的 artifacts 和 runs
      await reloadArtifactsForSelectedWorkContext();
      await loadWorkContextRuns(sorted[0].workContextUid);
    } else {
      selectedWorkContext.value = null;
      workContextArtifacts.value = [];
      workContextRuns.value = [];
    }
  } catch (error) {
    console.error('[loadAndSelectSessionWorkContext] Failed to load work contexts:', error);
  }
}

async function loadSessionMessages(session: SessionItem) {
  try {
    console.log(`[loadSessionMessages] Loading messages for session: ${session.id}`);
    // 获取该会话的所有 runs
    const runs = await agentPlatformApi.listRuns({ sessionId: session.id, limit: 50 });
    console.log(`[loadSessionMessages] Loaded ${runs.length} runs for session: ${session.id}`, runs);

    // 将 runs 转换为消息
    const messages: MessageItem[] = [];
    for (const run of runs.reverse()) { // 按时间正序排列
      // 添加用户消息
      messages.push({
        id: `msg-${run.runUid}-user`,
        role: "user",
        content: run.userMessage,
        time: formatRunTime(run.createdAt),
      });

      // 添加助手消息（如果有结果）
      if (run.resultSummary) {
        // 加载该 run 的步骤（包括子 Agent 的步骤）
        let steps: RunStep[] = [];
        try {
          const runWithSteps = await agentPlatformApi.getRunWithSteps(run.runUid);
          steps = runWithSteps.steps.map(s => ({
            stepIndex: s.stepIndex,
            stepType: s.stepType,
            content: s.content || undefined,
            toolName: s.toolName || undefined,
            toolStatus: s.toolStatus || undefined,
            input: s.inputJson,
            output: s.outputJson,
            createdAt: s.createdAt,
            agentName: s.agentName,
          }));
          console.log(`[loadSessionMessages] Loaded ${steps.length} steps for run: ${run.runUid}`);
        } catch (e) {
          console.warn(`[loadSessionMessages] Failed to load steps for run: ${run.runUid}`, e);
        }

        messages.push({
          id: `msg-${run.runUid}-assistant`,
          role: "assistant",
          content: run.resultSummary,
          time: formatRunTime(run.updatedAt || run.createdAt),
          run: {
            runId: run.runUid,
            agentId: String(run.agentId),
            agentName: run.agentName || primaryAgent.value?.name || 'AI Assistant',
            status: run.status as 'running' | 'success' | 'failed',
            resultSummary: run.resultSummary,
            steps: steps,
            isExpanded: false,
            isSubscribed: false,
          },
        });
      }
    }

    session.messages = messages;
  } catch (error) {
    console.error("Failed to load session messages:", error);
    ElMessage.error("加载聊天记录失败");
  }
}

function openNewSessionDialog() {
  newSessionDialogVisible.value = true;
  pendingSessionLocation.value = selectedProjectId.value ? "project" : "personal";
  pendingProjectTargetId.value = selectedProjectId.value || projectSpaces.value[0]?.id || "";
  pendingAgentIds.value = primaryAgent.value ? [primaryAgent.value.id] : ["writing_agent"];
  pendingSessionDescription.value = "";
}

function togglePendingAgent(agentId: string) {
  if (pendingAgentIds.value.includes(agentId)) {
    if (pendingAgentIds.value.length === 1) return;
    pendingAgentIds.value = pendingAgentIds.value.filter((id) => id !== agentId);
    return;
  }
  pendingAgentIds.value = [...pendingAgentIds.value, agentId];
}

function toggleWorkspaceFullscreen() {
  workspaceFullscreen.value = !workspaceFullscreen.value;
}

const activeSubscriptions = new Map<string, () => void>();

async function sendMessage() {
  if (!draftMessage.value.trim() || !currentSession.value) return;

  const messageContent = draftMessage.value.trim();

  // 添加用户消息到界面
  currentSession.value.messages.push({
    id: `message-${Date.now()}`,
    role: "user",
    content: messageContent,
    time: "刚刚",
  });

  currentSession.value.updatedAt = "刚刚";
  draftMessage.value = "";

  // 调用主 Agent 智能委派接口
  try {
    console.log("[sendMessage] Sending chat request:", { sessionId: currentSession.value.id, message: messageContent });
    const response = await agentPlatformApi.chat({
      sessionId: currentSession.value.id,
      message: messageContent,
      selectedAgentId: selectedAgentId.value,
    });
    console.log("[sendMessage] Chat response:", response);

    // 创建助手回复消息
    const assistantMessage: Message = {
      id: `message-${Date.now()}-response`,
      role: "assistant",
      content: response.message || "正在处理您的请求...",
      time: "刚刚",
    };

    // 如果有 runId，初始化 run 信息并订阅 SSE
    if (response.runId) {
      console.log("[sendMessage] Agent run started:", response.runId, "agentId:", response.agentId);

      assistantMessage.run = {
        runId: response.runId,
        agentId: response.agentId || 'unknown',
        agentName: response.agentId ? getAgentNameById(response.agentId) : undefined,
        status: 'running',
        steps: [],
        isExpanded: false,
        isSubscribed: true,
      };

      // 订阅 SSE 实时推送
      subscribeToRunSteps(response.runId, assistantMessage.run, assistantMessage);
    }

    currentSession.value.messages.push(assistantMessage);
  } catch (error) {
    console.error("Failed to send message:", error);
    currentSession.value.messages.push({
      id: `message-${Date.now()}-error`,
      role: "assistant",
      content: "抱歉，处理您的请求时出现错误，请稍后重试。",
      time: "刚刚",
    });
  }
}

// 订阅 Run 的 SSE 实时推送
function subscribeToRunSteps(runId: string, runInfo: RunInfo) {
  // 如果已有订阅，先取消
  if (activeSubscriptions.has(runId)) {
    activeSubscriptions.get(runId)!();
  }

  const unsubscribe = agentPlatformApi.subscribeRunSteps(runId, {
    onStep: (step) => {
      console.log(`[SSE] Step received for ${runId}:`, step);
      // 添加新步骤 - 使用新数组触发响应式更新
      runInfo.steps = [...runInfo.steps, step].sort((a, b) => a.stepIndex - b.stepIndex);
    },
    onStatus: (status) => {
      console.log(`[SSE] Status update for ${runId}:`, status);
      runInfo.status = status.status as 'running' | 'success' | 'failed';
      if (status.resultSummary) {
        runInfo.resultSummary = status.resultSummary || undefined;
        // 每次收到状态更新都更新消息内容
        updateMessageContentByRunId(runId, status.resultSummary);
      }
    },
    onComplete: async (data) => {
      console.log(`[SSE] Complete event for ${runId}:`, data);
      runInfo.status = data.status as 'running' | 'success' | 'failed';
      runInfo.isSubscribed = false;
      activeSubscriptions.delete(runId);
      console.log(`[SSE] Run ${runId} completed with status: ${data.status}`);
      
      // Run 完成后刷新工作上下文和产物
      await onRunCompleted(runId);
    },
    onError: (error) => {
      console.error(`[SSE] Run ${runId} error:`, error);
      runInfo.isSubscribed = false;
      activeSubscriptions.delete(runId);
    },
  });

  activeSubscriptions.set(runId, unsubscribe);
}

// 根据 runId 更新消息内容
function updateMessageContentByRunId(runId: string, content: string) {
  console.log(`[updateMessageContentByRunId] Looking for runId: ${runId}`);
  if (!currentSession.value) return;
  
  for (const message of currentSession.value.messages) {
    if (message.run?.runId === runId) {
      console.log(`[updateMessageContentByRunId] Found message, updating content`);
      message.content = content;
      return;
    }
  }
  console.log(`[updateMessageContentByRunId] Message not found for runId: ${runId}`);
}

// 切换 Run 步骤展开/收起
function toggleRunExpanded(runInfo: RunInfo) {
  runInfo.isExpanded = !runInfo.isExpanded;
}

// 复制 Run ID
async function copyRunId(runId: string) {
  try {
    await navigator.clipboard.writeText(runId);
    ElMessage.success('Run ID 已复制');
  } catch {
    ElMessage.error('复制失败');
  }
}

// 选择 Run 并加载 Steps
async function selectRun(run: AgentRunRecord) {
  selectedRun.value = run;
  try {
    const steps = await agentPlatformApi.listRunSteps(run.runUid);
    selectedRunSteps.value = steps || [];
  } catch (error) {
    console.error('[selectRun] Failed to load run steps:', error);
    selectedRunSteps.value = [];
  }
}

// 获取 WorkContext 进度摘要
function getWorkContextProgressSummary(workContext: WorkContextRecord): string {
  try {
    const metadata = JSON.parse(workContext.metadataJson || '{}');
    return metadata.progressSummary || '暂无进度摘要';
  } catch {
    return '暂无进度摘要';
  }
}

// 格式化时间
function formatTime(time: string | Date | undefined | null): string {
  if (!time) return '-';
  const date = new Date(time);
  return date.toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Run 完成后的刷新收口逻辑
async function onRunCompleted(runId: string) {
  console.log(`[onRunCompleted] Run ${runId} completed, refreshing data...`);
  
  if (!currentSession.value) {
    console.warn('[onRunCompleted] No current session');
    return;
  }
  
  const sessionId = currentSession.value.id;
  
  try {
    // 1. 刷新会话的 runs
    console.log('[onRunCompleted] Reloading session runs...');
    await loadSessionRuns(sessionId);
    
    // 2. 刷新会话的 workContexts
    console.log('[onRunCompleted] Reloading session work contexts...');
    await reloadSessionWorkContexts(sessionId);
    
    // 3. 重新选中当前 workContext
    console.log('[onRunCompleted] Reselecting current work context...');
    await reselectCurrentWorkContext(sessionId, runId);
    
    // 4. 刷新选中 workContext 的 runs（workContext 维度）
    if (selectedWorkContext.value) {
      console.log('[onRunCompleted] Reloading runs for selected work context...');
      await loadWorkContextRuns(selectedWorkContext.value.workContextUid);
      
      // 5. 刷新选中 workContext 的 artifacts
      console.log('[onRunCompleted] Reloading artifacts for selected work context...');
      await reloadArtifactsForSelectedWorkContext();
    }
    
    console.log('[onRunCompleted] Data refresh completed');
  } catch (error) {
    console.error('[onRunCompleted] Error refreshing data:', error);
  }
}

// 刷新会话的 runs（session 维度）
async function loadSessionRuns(sessionId: string) {
  try {
    const runs = await agentPlatformApi.listRuns({ sessionId, limit: 50 });
    console.log(`[loadSessionRuns] Loaded ${runs.length} runs for session ${sessionId}`);
    // 更新当前会话的 runs（如果需要）
    sessionRuns.value = runs;
  } catch (error) {
    console.error('[loadSessionRuns] Failed to load runs:', error);
  }
}

// 刷新选中 workContext 的 runs（workContext 维度）
async function loadWorkContextRuns(workContextId: string) {
  try {
    const runs = await agentPlatformApi.listRuns({ workContextId, limit: 50 });
    console.log(`[loadWorkContextRuns] Loaded ${runs.length} runs for workContext ${workContextId}`);
    workContextRuns.value = runs;
  } catch (error) {
    console.error('[loadWorkContextRuns] Failed to load runs:', error);
  }
}

// 刷新会话的 work contexts
async function reloadSessionWorkContexts(sessionId: string) {
  try {
    const workContexts = await agentPlatformApi.listWorkContexts({ sessionId, limit: 50 });
    console.log(`[reloadSessionWorkContexts] Loaded ${workContexts.length} work contexts`);
    sessionWorkContexts.value = workContexts;
  } catch (error) {
    console.error('[reloadSessionWorkContexts] Failed to load work contexts:', error);
  }
}

// 重新选中当前 work context
async function reselectCurrentWorkContext(sessionId: string, runId: string) {
  try {
    // 优先选择：
    // 1. current_run_id 对应此 run 的 workContext
    // 2. 最近更新的 workContext
    // 3. 第一个 workContext
    
    const workContexts = await agentPlatformApi.listWorkContexts({ sessionId, limit: 50 });
    
    // 查找 current_run_id 匹配的 workContext
    const matchedByRun = workContexts.find(wc => wc.currentRunId === runId);
    if (matchedByRun) {
      console.log(`[reselectCurrentWorkContext] Found work context by runId: ${matchedByRun.workContextUid}`);
      selectedWorkContext.value = matchedByRun;
      return;
    }
    
    // 按 updatedAt 排序，选择最近更新的
    const sortedByUpdate = [...workContexts].sort((a, b) => {
      const timeA = new Date(a.updatedAt || a.createdAt).getTime();
      const timeB = new Date(b.updatedAt || b.createdAt).getTime();
      return timeB - timeA;
    });
    
    if (sortedByUpdate.length > 0) {
      console.log(`[reselectCurrentWorkContext] Selecting most recent work context: ${sortedByUpdate[0].workContextUid}`);
      selectedWorkContext.value = sortedByUpdate[0];
    }
  } catch (error) {
    console.error('[reselectCurrentWorkContext] Failed to reselect work context:', error);
  }
}

// 刷新选中 workContext 的 artifacts
async function reloadArtifactsForSelectedWorkContext() {
  if (!selectedWorkContext.value) {
    console.warn('[reloadArtifactsForSelectedWorkContext] No selected work context');
    return;
  }
  
  try {
    const workContextUid = selectedWorkContext.value.workContextUid;
    const artifacts = await agentPlatformApi.listArtifacts(workContextUid);
    console.log(`[reloadArtifactsForSelectedWorkContext] Loaded ${artifacts.length} artifacts`);
    workContextArtifacts.value = artifacts;
  } catch (error) {
    console.error('[reloadArtifactsForSelectedWorkContext] Failed to load artifacts:', error);
  }
}

// 获取 Agent 名称
function getAgentNameById(agentId: string): string {
  // 处理主 Agent
  if (agentId === "main_agent") {
    return "AI Assistant";
  }
  const agent = agentList.value.find(a => a.id === agentId);
  return agent?.name || agentId;
}

// 根据 Agent 名称获取短名称
function getAgentShortName(agentName: string): string {
  if (agentName === "AI Assistant" || agentName === "main_agent") {
    return "AI";
  }
  if (agentName.includes("Browser") || agentName.includes("浏览器")) {
    return "浏";
  }
  if (agentName.includes("Research") || agentName.includes("研究")) {
    return "研";
  }
  if (agentName.includes("Video") || agentName.includes("视频")) {
    return "剪";
  }
  if (agentName.includes("Writing") || agentName.includes("写作")) {
    return "写";
  }
  return agentName.slice(0, 1);
}

// 格式化步骤类型
function formatStepType(stepType: string): string {
  const typeMap: Record<string, string> = {
    'model_call': '模型调用',
    'tool_start': '工具开始',
    'tool_end': '工具完成',
    'observation': '观察',
    'final': '完成',
    'error': '错误',
  };
  return typeMap[stepType] || stepType;
}

// 获取步骤类型摘要
function getStepTypeSummary(steps: RunStep[]): string {
  const counts: Record<string, number> = {};
  steps.forEach(step => {
    counts[step.stepType] = (counts[step.stepType] || 0) + 1;
  });

  const parts: string[] = [];
  if (counts['model_call']) parts.push(`${counts['model_call']} 次模型调用`);
  if (counts['tool_start']) parts.push(`${counts['tool_start']} 次工具调用`);
  if (counts['final']) parts.push('已完成');

  return parts.join('、') || '执行中...';
}

async function createSession() {
  if (!pendingSessionTitle.value.trim()) {
    ElMessage.warning("请先填写会话标题");
    return;
  }

  if (pendingAgentIds.value.length === 0) {
    ElMessage.warning("至少选择一个智能体");
    return;
  }

  try {
    const isProjectLocation = pendingSessionLocation.value === "project";
    const targetProjectId = isProjectLocation ? pendingProjectTargetId.value : undefined;

    if (isProjectLocation && !targetProjectId) {
      ElMessage.warning("请选择项目空间");
      return;
    }

    // 使用新的 createSession API
    const sessionRecord = await agentPlatformApi.createSession({
      title: pendingSessionTitle.value.trim(),
      description: pendingSessionDescription.value.trim() || undefined,
      projectId: targetProjectId,
      agentIds: [...pendingAgentIds.value],
    });

    const newSession: SessionItem = {
      id: sessionRecord.sessionUid,
      title: sessionRecord.title,
      description: sessionRecord.description || undefined,
      updatedAt: "刚刚",
      agentIds: [...pendingAgentIds.value],
      messages: [
        {
          id: `msg-${sessionRecord.sessionUid}-welcome`,
          role: "assistant",
          content: "会话已创建，我们可以开始协作了。你可以直接描述目标，我来帮你拆解和推进。",
          time: "刚刚",
        },
      ],
    };

    if (isProjectLocation && targetProjectId) {
      const targetProject = projectSpaces.value.find(
        (project) => project.id === targetProjectId,
      );
      if (targetProject) {
        targetProject.sessions.unshift(newSession);
      }
      selectedProjectId.value = targetProjectId;
    } else {
      personalSessions.value.unshift(newSession);
      selectedProjectId.value = "";
    }

    selectedSessionId.value = newSession.id;
    selectedAgentId.value = newSession.agentIds[0];
    newSessionDialogVisible.value = false;
    pendingSessionTitle.value = "新的创作会话";
    pendingSessionDescription.value = "";

    ElMessage.success("会话创建成功");
  } catch (error) {
    ElMessage.error("创建会话失败");
    console.error("Failed to create session:", error);
  }
}

async function createProject() {
  if (!pendingProjectTitle.value.trim()) {
    ElMessage.warning("请填写项目名称");
    return;
  }

  try {
    // 使用新的 createProject API
    const projectRecord = await agentPlatformApi.createProject({
      name: pendingProjectTitle.value.trim(),
    });

    const project = mapProjectRecordToProject(projectRecord);
    projectSpaces.value.unshift(project);
    selectedProjectId.value = project.id;
    selectedSessionId.value = "";
    pendingProjectTargetId.value = project.id;
    pendingProjectTitle.value = "";
    newProjectDialogVisible.value = false;
    ElMessage.success("项目创建成功");
  } catch (error) {
    ElMessage.error("创建项目失败");
    console.error("Failed to create project:", error);
  }
}

async function loadAgentProfiles() {
  try {
    const response = await agentPlatformApi.listAgents();
    const mapped = response.map(mapAgentRecord);
    if (mapped.length > 0) {
      agentList.value = mapped;
    }
  } catch {
    agentList.value = fallbackAgents;
  }
}

async function loadProjects() {
  isLoadingProjects.value = true;
  try {
    const projects = await agentPlatformApi.listProjects();
    projectSpaces.value = projects.map(mapProjectRecordToProject);
  } catch (error) {
    ElMessage.error("加载项目空间失败");
    console.error("Failed to load projects:", error);
    projectSpaces.value = [];
  } finally {
    isLoadingProjects.value = false;
  }
}

function mapProjectRecordToProject(pr: ProjectRecord): ProjectSpace {
  return {
    id: pr.projectUid,
    name: pr.name,
    icon: pr.icon || "📁",
    sessions: [],
  };
}

function getProjectIcon(source: string): string {
  const iconMap: Record<string, string> = {
    project: "📁",
    session: "💬",
    default: "📄",
  };
  return iconMap[source] || iconMap.default;
}

async function loadPersonalSessions() {
  isLoadingSessions.value = true;
  try {
    const sessions = await agentPlatformApi.listSessions({ personal: true, limit: 50 });
    personalSessions.value = sessions.map(mapSessionRecordToSessionItem);
  } catch (error) {
    ElMessage.error("加载会话失败");
    console.error("Failed to load sessions:", error);
    personalSessions.value = [];
  } finally {
    isLoadingSessions.value = false;
  }
}

function mapSessionRecordToSessionItem(session: import("../api/agentPlatform").SessionRecord): SessionItem {
  const agentIds = parseAgentIds(session.agentIdsJson);
  return {
    id: session.sessionUid,
    title: session.title,
    description: session.description || undefined,
    updatedAt: formatRunTime(session.createdAt),
    agentIds,
    messages: [], // 会话初始时没有消息，需要通过其他方式加载
  };
}

function mapRunToSession(run: AgentRunRecord): SessionItem {
  const agentIds = parseAgentIds(run.snapshotJson);
  return {
    id: run.runUid,
    title: run.userMessage.slice(0, 30) + (run.userMessage.length > 30 ? "..." : ""),
    description: run.resultSummary || undefined,
    updatedAt: formatRunTime(run.createdAt),
    agentIds,
    messages: [
      {
        id: `msg-${run.runUid}`,
        role: "user",
        content: run.userMessage,
        time: formatRunTime(run.createdAt),
      },
    ],
  };
}

function parseAgentIds(snapshotJson: string): string[] {
  try {
    const snapshot = JSON.parse(snapshotJson);
    if (snapshot.agent?.agentUid) {
      return [snapshot.agent.agentUid];
    }
  } catch {
    // ignore
  }
  return ["writing_agent"];
}

function formatRunTime(isoTime: string): string {
  const date = new Date(isoTime);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;
  return date.toLocaleDateString("zh-CN");
}

function mapAgentRecord(agent: AgentRecord): SidebarAgent {
  const lowerUid = agent.agentUid.toLowerCase();

  if (lowerUid.includes("browser")) {
    return {
      id: agent.agentUid,
      name: agent.name,
      short: "浏",
      avatar: "linear-gradient(135deg, #0ea5e9, #2563eb)",
      description: agent.description || "负责网页访问、信息采集与自动操作。",
      status: "online",
      workspaceType: "browser",
    };
  }

  if (lowerUid.includes("research") || lowerUid.includes("doc")) {
    return {
      id: agent.agentUid,
      name: agent.name,
      short: "研",
      avatar: "linear-gradient(135deg, #14b8a6, #10b981)",
      description: agent.description || "负责资料阅读、检索总结与知识整合。",
      status: "idle",
      workspaceType: "research",
    };
  }

  if (lowerUid.includes("video")) {
    return {
      id: agent.agentUid,
      name: agent.name,
      short: "剪",
      avatar: "linear-gradient(135deg, #f97316, #ef4444)",
      description: agent.description || "负责镜头剪辑、素材整理与节奏处理。",
      status: "idle",
      workspaceType: "video",
    };
  }

  return {
    id: agent.agentUid,
    name: agent.name,
    short: "写",
    avatar: "linear-gradient(135deg, #7c3aed, #5b6dff)",
    description: agent.description || "负责写作、改写、润色与结构优化。",
    status: "busy",
    workspaceType: "writing",
  };
}

onMounted(async () => {
  await Promise.all([
    loadAgentProfiles(),
    loadProjects(),
    loadPersonalSessions(),
  ]);

  const preferredAgent = route?.query?.agent && typeof route.query.agent === "string" ? route.query.agent : "";
  if (!preferredAgent) return;

  const matched = agentList.value.find((agent) => agent.id === preferredAgent);
  if (matched) {
    selectedAgentId.value = matched.id;
  }
});
</script>

<style scoped>
.agent-os-page {
  display: grid;
  --sidebar-column: 280px;
  --sidebar-divider-column: 14px;
  --conversation-column: minmax(0, 1fr);
  --center-divider-column: 14px;
  --workspace-column: minmax(420px, 0.96fr);
  --workspace-offset: 448px;
  grid-template-columns:
    var(--sidebar-column)
    var(--sidebar-divider-column)
    var(--conversation-column)
    var(--center-divider-column)
    var(--workspace-column);
  height: 100vh;
  overflow: hidden;
  box-sizing: border-box;
  padding-right: 14px;
  background:
    radial-gradient(circle at top left, rgba(91, 109, 255, 0.16), transparent 30%),
    radial-gradient(circle at top right, rgba(14, 165, 233, 0.12), transparent 26%),
    linear-gradient(180deg, #111827 0%, #162033 100%);
  color: #f8fbff;
}

.agent-os-page.workspace-hidden-layout,
.agent-os-page.workspace-fullscreen-layout {
  --workspace-column: 0px;
  --center-divider-column: 0px;
  --workspace-offset: 24px;
}

.agent-os-page.sidebar-collapsed-layout {
  --sidebar-column: 88px;
}

.agent-os-page.conversation-collapsed-layout {
  --conversation-column: 0px;
  --center-divider-column: 0px;
}

.layout-divider {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  position: relative;
  z-index: 2;
}

.layout-divider::before {
  content: "";
  position: absolute;
  inset: 18px 6px;
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(91, 109, 255, 0.22), rgba(71, 85, 105, 0.14));
  opacity: 0.85;
}

.divider-toggle {
  position: relative;
  z-index: 1;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid rgba(113, 128, 150, 0.18);
  border-radius: 999px;
  background: rgba(24, 35, 56, 0.96);
  color: #e5ecfb;
  font-size: 14px;
  line-height: 1;
  box-shadow: 0 10px 22px rgba(0, 0, 0, 0.18);
}

.sidebar-divider {
  grid-column: 2;
  align-self: stretch;
}

.center-divider {
  grid-column: 4;
  align-self: stretch;
  flex-direction: column;
}

.center-divider .divider-toggle {
  width: 34px;
  height: 34px;
}

.conversation-reveal-float {
  position: fixed;
  left: calc(var(--sidebar-column) + var(--sidebar-divider-column) + 8px);
  top: 50%;
  z-index: 46;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 1px solid rgba(113, 128, 150, 0.18);
  border-radius: 999px;
  background: rgba(24, 35, 56, 0.96);
  color: #e5ecfb;
  transform: translateY(-50%);
  box-shadow: 0 10px 22px rgba(0, 0, 0, 0.18);
}

.soft-scrollbar {
  scrollbar-width: thin;
  scrollbar-color: rgba(122, 138, 168, 0.55) rgba(10, 15, 26, 0.28);
}

.soft-scrollbar::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

.soft-scrollbar::-webkit-scrollbar-track {
  background: rgba(7, 12, 22, 0.18);
  border-radius: 999px;
}

.soft-scrollbar::-webkit-scrollbar-thumb {
  border: 2px solid transparent;
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(128, 145, 177, 0.68), rgba(84, 97, 128, 0.78));
  background-clip: padding-box;
}

.soft-scrollbar::-webkit-scrollbar-thumb:hover {
  background: linear-gradient(180deg, rgba(154, 168, 196, 0.86), rgba(96, 110, 142, 0.92));
  background-clip: padding-box;
}

.panel-card {
  border: 1px solid rgba(113, 128, 150, 0.14);
  border-radius: 20px;
  background: rgba(24, 34, 52, 0.88);
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(20px);
}

.sidebar-shell,
.conversation-shell,
.workspace-host {
  min-height: 0;
}

.sidebar-shell {
  grid-column: 1;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  gap: 16px;
  padding: 20px 18px;
  border-right: 1px solid rgba(113, 128, 150, 0.14);
  background: rgba(16, 24, 39, 0.72);
}

.sidebar-shell.collapsed {
  gap: 12px;
  padding: 16px 12px;
  overflow: hidden;
}

.sidebar-shell.collapsed .sidebar-actions,
.sidebar-shell.collapsed .sidebar-scroll,
.sidebar-shell.collapsed .profile-card {
  display: none;
}

.sidebar-shell.collapsed .brand-card {
  justify-content: center;
  padding: 12px;
}

.sidebar-shell.collapsed .brand-title,
.sidebar-shell.collapsed .brand-subtitle {
  display: none;
}

.brand-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
}

.brand-mark {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 16px;
  background: linear-gradient(135deg, #5b6dff, #7c3aed);
  color: #fff;
  font-size: 18px;
  font-weight: 700;
}

.brand-title {
  font-size: 24px;
  font-weight: 700;
}

.brand-subtitle {
  margin-top: 6px;
  color: #90a0bb;
  font-size: 13px;
}

.sidebar-actions {
  display: grid;
  gap: 12px;
}

.primary-action,
.secondary-action,
.ghost-button,
.ghost-mini,
.inline-primary,
.tool-chip,
.workspace-tab,
.workspace-reveal {
  border: 0;
  cursor: pointer;
  font: inherit;
}

.primary-action,
.secondary-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 48px;
  border-radius: 16px;
  font-weight: 600;
  transition: transform 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
}

.primary-action {
  color: #fff;
  background: linear-gradient(135deg, #5b6dff, #7c3aed);
  box-shadow: 0 16px 32px rgba(91, 109, 255, 0.28);
}

.primary-action:hover,
.secondary-action:hover,
.inline-primary:hover {
  transform: translateY(-1px);
}

.primary-action.compact {
  height: 42px;
  min-width: 126px;
}

.secondary-action {
  color: #d6def1;
  background: rgba(25, 37, 58, 0.84);
  border: 1px solid rgba(113, 128, 150, 0.14);
}

.sidebar-scroll {
  min-height: 0;
  overflow: auto;
  display: grid;
  align-content: start;
  gap: 18px;
  padding-right: 4px;
}

.sidebar-section {
  display: grid;
  gap: 12px;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #c7d2e7;
  font-size: 13px;
  font-weight: 600;
}

.section-meta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 24px;
  padding: 0 8px;
  border-radius: 999px;
  background: rgba(29, 41, 64, 0.9);
  color: #8ea0bd;
}

.project-list,
.project-session-list {
  display: grid;
  gap: 10px;
}

.project-card,
.session-item {
  width: 100%;
  border: 1px solid rgba(113, 128, 150, 0.14);
  background: rgba(24, 35, 56, 0.92);
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.18s ease, background 0.18s ease, transform 0.18s ease;
}

.project-card {
  padding: 14px;
  border-radius: 18px;
}

.project-card:hover,
.session-item:hover {
  transform: translateY(-1px);
  border-color: rgba(91, 109, 255, 0.35);
}

.project-card.active,
.session-item.active {
  border-color: rgba(91, 109, 255, 0.5);
  background: linear-gradient(180deg, rgba(39, 54, 83, 0.96), rgba(27, 39, 60, 0.96));
}

.target-card.active {
  border-color: rgba(91, 109, 255, 0.32);
  background: linear-gradient(180deg, rgba(232, 239, 255, 0.98), rgba(243, 246, 255, 0.98));
  box-shadow: 0 10px 22px rgba(91, 109, 255, 0.12);
}

.target-card.active .target-title {
  color: #22314d;
}

.target-card.active .target-desc {
  color: #5c6f8f;
}

.project-card-top,
.project-title-row,
.project-toolbar,
.summary-head,
.summary-progress,
.execution-step-top,
.profile-card,
.workspace-header,
.workspace-header-actions,
.workspace-header-left,
.agent-choice-top,
.message-meta {
  display: flex;
  align-items: center;
}

.project-card-top,
.summary-head,
.profile-card {
  justify-content: space-between;
}

.project-title-row {
  gap: 10px;
}

.project-title {
  font-weight: 600;
}

.project-count {
  color: #8ea0bd;
}

.project-session-list {
  margin-top: 12px;
}

.session-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 14px;
}

.session-time,
.session-empty-tip {
  color: #7f90ad;
  font-size: 12px;
}

.session-empty-tip {
  padding: 8px 4px 0;
}

.profile-card {
  gap: 12px;
  padding: 16px;
}

.profile-avatar {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 14px;
  background: linear-gradient(135deg, #475569, #1f2937);
  font-weight: 700;
}

.profile-name {
  font-weight: 600;
}

.profile-plan {
  margin-top: 6px;
  color: #8ea0bd;
  font-size: 12px;
}

.conversation-shell {
  grid-column: 3;
  min-width: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 16px;
  padding: 20px;
  border-right: 1px solid rgba(113, 128, 150, 0.14);
}

.conversation-shell.collapsed {
  padding-bottom: 0;
}

.conversation-collapsed-rail {
  min-height: 100%;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 12px;
  padding: 18px;
  text-align: center;
}

.collapsed-rail-label {
  color: #dbe6fb;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.collapsed-rail-action {
  width: 100%;
  max-width: 180px;
}

.floating-composer {
  position: fixed;
  left: 50%;
  right: auto;
  bottom: 24px;
  z-index: 45;
  width: min(760px, calc(100vw - 64px));
  transform: translateX(-50%);
  margin: 0;
  padding: 14px;
}

.conversation-shell.collapsed .composer {
  display: none;
}

.project-toolbar {
  gap: 14px;
  padding: 14px;
}

.toolbar-label {
  color: #90a0bb;
  font-size: 13px;
  font-weight: 600;
}

.project-select {
  width: 280px;
}

.ghost-button,
.ghost-mini,
.tool-chip,
.workspace-tab {
  color: #dbe6fb;
  background: rgba(29, 41, 64, 0.9);
  border: 1px solid rgba(113, 128, 150, 0.14);
}

.ghost-button {
  height: 42px;
  padding: 0 16px;
  border-radius: 14px;
}

.ghost-mini {
  height: 36px;
  padding: 0 14px;
  border-radius: 14px;
  font-size: 13px;
}

.conversation-panel {
  min-height: 0;
  display: grid;
  grid-template-rows: 1fr auto;
  overflow: hidden;
  padding: 18px;
}

.conversation-scroll {
  min-height: 0;
  overflow: auto;
  display: grid;
  align-content: start;
  gap: 14px;
  padding-right: 6px;
}

.project-empty-state {
  display: grid;
  place-items: center;
  align-content: center;
  gap: 14px;
  min-height: 100%;
  text-align: center;
  color: #b8c4da;
}

.empty-icon {
  display: grid;
  place-items: center;
  width: 68px;
  height: 68px;
  border-radius: 20px;
  background: linear-gradient(135deg, rgba(91, 109, 255, 0.25), rgba(124, 58, 237, 0.18));
  color: #fff;
  font-size: 28px;
}

.empty-title {
  color: #f6f8ff;
  font-size: 22px;
  font-weight: 700;
}

.inline-primary {
  height: 42px;
  padding: 0 18px;
  border-radius: 14px;
  background: linear-gradient(135deg, #5b6dff, #7c3aed);
  color: #fff;
  font-weight: 600;
}

.message-row {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  gap: 12px;
}

.message-avatar {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 14px;
  background: rgba(34, 48, 73, 0.9);
  color: #dbe6fb;
  font-weight: 700;
}

.message-card {
  padding: 14px 16px;
  border-radius: 18px;
  background: rgba(24, 35, 54, 0.94);
  border: 1px solid rgba(113, 128, 150, 0.14);
}

.message-row.user .message-card {
  background: rgba(30, 42, 63, 0.98);
}

.message-meta {
  justify-content: space-between;
  gap: 12px;
  color: #8ea0bd;
  font-size: 12px;
}

.message-content {
  margin-top: 10px;
  line-height: 1.85;
  color: #edf3ff;
}

.execution-summary {
  margin-top: 6px;
  padding: 18px;
  border: 1px solid rgba(113, 128, 150, 0.14);
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(26, 37, 57, 0.94), rgba(21, 31, 48, 0.96));
}

.simple-run-info {
  display: flex;
  justify-content: flex-end;
  padding-top: 8px;
  border-top: 1px solid rgba(113, 128, 150, 0.1);
  margin-top: 8px;
}

.simple-run-info .run-id-badge {
  font-size: 11px;
  color: #8ea0bd;
  opacity: 0.7;
  cursor: pointer;
  transition: opacity 0.2s;
}

.simple-run-info .run-id-badge:hover {
  opacity: 1;
  color: #5b6dff;
}

.summary-head {
  gap: 16px;
}

.summary-title {
  font-size: 16px;
  font-weight: 700;
}

.summary-subtitle,
.summary-progress-meta {
  margin-top: 6px;
  color: #8ea0bd;
  font-size: 13px;
}

.summary-progress {
  gap: 16px;
  margin-top: 16px;
}

.progress-ring {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  border-radius: 999px;
  background:
    radial-gradient(circle at center, #162133 56%, transparent 57%),
    conic-gradient(#7c3aed 0 65%, rgba(124, 58, 237, 0.16) 65% 100%);
  color: #f8fbff;
  font-size: 12px;
  font-weight: 700;
}

.summary-text {
  color: #f3f6ff;
  font-weight: 600;
}

.execution-steps {
  display: grid;
  gap: 10px;
  margin-top: 16px;
}

.execution-step {
  padding: 14px;
  border-radius: 16px;
  background: rgba(29, 41, 64, 0.72);
  border: 1px solid rgba(113, 128, 150, 0.14);
}

.execution-step-top {
  justify-content: space-between;
  gap: 12px;
  font-weight: 600;
}

.execution-step p {
  margin: 10px 0 0;
  color: #8ea0bd;
  line-height: 1.7;
}

/* Run 步骤相关样式 */
.run-id-badge {
  display: inline-flex;
  align-items: center;
  margin-left: 10px;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(91, 109, 255, 0.15);
  color: #8ea0bd;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s ease;
}

.run-id-badge:hover {
  background: rgba(91, 109, 255, 0.25);
}

.progress-ring.running {
  background:
    radial-gradient(circle at center, #162133 56%, transparent 57%),
    conic-gradient(#5b6dff 0 100%, rgba(91, 109, 255, 0.16) 100% 100%);
  animation: spin 2s linear infinite;
}

.progress-ring.success {
  background:
    radial-gradient(circle at center, #162133 56%, transparent 57%),
    conic-gradient(#22c55e 0 100%, rgba(34, 197, 94, 0.16) 100% 100%);
}

.progress-ring.failed {
  background:
    radial-gradient(circle at center, #162133 56%, transparent 57%),
    conic-gradient(#ef4444 0 100%, rgba(239, 68, 68, 0.16) 100% 100%);
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.loading-spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid rgba(91, 109, 255, 0.3);
  border-top-color: #5b6dff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.step-type-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(91, 109, 255, 0.15);
  color: #c7d2e7;
  font-size: 11px;
  font-weight: 500;
}

.step-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.step-agent-name {
  font-size: 11px;
  color: #8ea0bd;
  opacity: 0.8;
}

.step-time {
  color: #6b7a90;
  font-size: 11px;
}

.step-content {
  color: #dbe6fb;
  font-size: 13px;
}

.step-tool {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.tool-status {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 500;
}

.tool-status.success {
  background: rgba(34, 197, 94, 0.2);
  color: #22c55e;
}

.tool-status.failed {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

.tool-status.running {
  background: rgba(91, 109, 255, 0.2);
  color: #5b6dff;
}

.execution-step.model_call {
  border-left: 3px solid rgba(91, 109, 255, 0.5);
}

.execution-step.tool_start,
.execution-step.tool_end {
  border-left: 3px solid rgba(14, 165, 233, 0.5);
}

.execution-step.final {
  border-left: 3px solid rgba(34, 197, 94, 0.5);
}

.execution-step.error {
  border-left: 3px solid rgba(239, 68, 68, 0.5);
  background: rgba(239, 68, 68, 0.1);
}

.composer {
  display: grid;
  gap: 12px;
  padding-top: 14px;
}

.floating-composer {
  display: grid;
  gap: 12px;
  border-radius: 20px;
  background: rgba(24, 34, 52, 0.96);
  border: 1px solid rgba(113, 128, 150, 0.18);
  box-shadow: 0 22px 48px rgba(0, 0, 0, 0.38);
  backdrop-filter: blur(20px);
}

.composer-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.tool-chip {
  height: 34px;
  padding: 0 12px;
  border-radius: 12px;
}

.composer-box {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  padding: 14px;
  border-radius: 18px;
  background: rgba(24, 34, 52, 0.92);
  border: 1px solid rgba(113, 128, 150, 0.14);
}

.composer-box textarea {
  min-height: 92px;
  max-height: 180px;
  resize: vertical;
  border: 0;
  outline: 0;
  color: #f8fbff;
  background: transparent;
  font: inherit;
  line-height: 1.75;
}

.composer-box textarea::placeholder {
  color: #72809a;
}

.send-button {
  align-self: end;
  height: 44px;
  min-width: 84px;
  padding: 0 16px;
  border: 0;
  border-radius: 14px;
  background: linear-gradient(135deg, #5b6dff, #7c3aed);
  color: #fff;
  cursor: pointer;
  font: inherit;
  font-weight: 600;
}

.status-inline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #b7c4dd;
}

.dialog-status {
  color: #50627b;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
}

.status-dot.online {
  background: #22c55e;
  box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.14);
}

.status-dot.busy {
  background: #8b5cf6;
  box-shadow: 0 0 0 4px rgba(139, 92, 246, 0.14);
}

.status-dot.idle {
  background: #94a3b8;
  box-shadow: 0 0 0 4px rgba(148, 163, 184, 0.14);
}

.workspace-host {
  grid-column: 5;
  min-width: 0;
  width: 100%;
  max-width: 100%;
  justify-self: stretch;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 14px;
  padding: 20px 14px 20px 8px;
  overflow: hidden;
  box-sizing: border-box;
}

.workspace-host.fullscreen {
  position: fixed;
  inset: 12px;
  z-index: 44;
  padding: 18px;
  border-radius: 28px;
  background:
    linear-gradient(180deg, rgba(29, 41, 64, 0.985), rgba(21, 31, 48, 0.985)),
    rgba(20, 29, 45, 0.98);
  border: 1px solid rgba(163, 179, 203, 0.26);
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.04),
    0 30px 90px rgba(0, 0, 0, 0.5);
}

.workspace-header {
  display: flex;
  align-items: center;
  gap: 14px;
  justify-content: space-between;
  padding: 14px 16px;
  border-radius: 20px;
  background: rgba(24, 35, 56, 0.88);
  border: 1px solid rgba(113, 128, 150, 0.14);
}

.workspace-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.workspace-host-title {
  font-size: 18px;
  font-weight: 700;
}

.workspace-host-subtitle {
  margin-top: 4px;
  color: #8ea0bd;
  font-size: 13px;
}

.workspace-header-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
  margin-left: auto;
}

.workspace-tab-group,
.workspace-window-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.workspace-window-actions {
  margin-left: auto;
  flex-shrink: 0;
}

.workspace-tab {
  height: 36px;
  padding: 0 14px;
  border-radius: 14px;
}

.workspace-tab.active {
  color: #fff;
  border-color: rgba(91, 109, 255, 0.45);
  background: linear-gradient(135deg, rgba(91, 109, 255, 0.22), rgba(124, 58, 237, 0.18));
}

.workspace-content {
  min-height: 0;
  overflow: auto;
  display: grid;
  align-content: start;
  gap: 14px;
  padding-right: 8px;
}

.workspace-template-card {
  padding: 18px;
}

.workspace-template-icon {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border-radius: 16px;
  margin-bottom: 14px;
  color: #fff;
  font-weight: 700;
}

.workspace-template-title {
  font-size: 20px;
  font-weight: 700;
}

.workspace-template-desc {
  margin-top: 8px;
  color: #90a0bb;
  line-height: 1.7;
}

.workspace-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.workspace-pane {
  padding: 16px;
}

.workspace-pane.full {
  grid-column: 1 / -1;
}

.workspace-pane-title {
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 10px;
}

.workspace-pane p,
.workspace-pane li {
  color: #8ea0bd;
  line-height: 1.7;
}

.mode-grid,
.placeholder-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 12px;
}

.mode-card,
.placeholder-card {
  padding: 14px;
  border-radius: 14px;
  background: #1d2940;
  color: #eef4ff;
  text-align: left;
  border: 1px solid rgba(114, 128, 150, 0.14);
}

.mode-title,
.placeholder-name {
  font-weight: 700;
}

.mode-desc,
.placeholder-desc {
  margin-top: 6px;
  color: #8ea0bd;
  line-height: 1.6;
  font-size: 13px;
}

.workspace-reveal {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 20;
  height: 44px;
  padding: 0 16px;
  border-radius: 14px;
  background: rgba(24, 35, 56, 0.96);
  color: #f8fbff;
  box-shadow: 0 18px 36px rgba(0, 0, 0, 0.35);
}

/* 右侧工作台 Tab 面板样式 */
.workspace-tab-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
}

.workspace-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  text-align: center;
  color: #8ea0bd;
}

.empty-title {
  font-size: 18px;
  font-weight: 600;
  color: #eef4ff;
  margin-bottom: 8px;
}

.empty-desc {
  font-size: 14px;
  color: #8ea0bd;
}

/* WorkContext 详情 */
.workcontext-detail {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.detail-section {
  padding: 16px;
  background: #1d2940;
  border-radius: 14px;
  border: 1px solid rgba(114, 128, 150, 0.14);
}

.detail-row {
  display: flex;
  gap: 12px;
}

.detail-section.half {
  flex: 1;
}

.detail-label {
  font-size: 12px;
  font-weight: 600;
  color: #8ea0bd;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

.detail-value {
  font-size: 14px;
  color: #eef4ff;
  line-height: 1.6;
}

.detail-value.empty {
  color: #5a6a85;
  font-style: italic;
}

.status-badge {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
}

.status-badge.active,
.status-badge.running {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}

.status-badge.success,
.status-badge.completed {
  background: rgba(59, 130, 246, 0.15);
  color: #3b82f6;
}

.status-badge.failed,
.status-badge.error {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.progress-summary {
  font-size: 13px;
  color: #c8d4e8;
  line-height: 1.7;
}

/* 产物双栏布局 */
.artifact-split-panel,
.run-split-panel {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 16px;
  height: 100%;
  min-height: 0;
}

.artifact-list,
.run-list {
  display: flex;
  flex-direction: column;
  background: #1d2940;
  border-radius: 14px;
  border: 1px solid rgba(114, 128, 150, 0.14);
  overflow: hidden;
}

.panel-header {
  padding: 14px 16px;
  border-bottom: 1px solid rgba(114, 128, 150, 0.14);
  background: rgba(0, 0, 0, 0.15);
}

.panel-title {
  font-size: 14px;
  font-weight: 600;
  color: #eef4ff;
}

.artifact-items,
.run-items {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.artifact-item,
.run-item {
  padding: 12px;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-bottom: 8px;
}

.artifact-item:hover,
.run-item:hover {
  background: rgba(91, 109, 255, 0.1);
}

.artifact-item.active,
.run-item.active {
  background: rgba(91, 109, 255, 0.2);
  border: 1px solid rgba(91, 109, 255, 0.3);
}

.artifact-type {
  font-size: 11px;
  font-weight: 600;
  color: #5b6dff;
  text-transform: uppercase;
  margin-bottom: 4px;
}

.artifact-title {
  font-size: 14px;
  font-weight: 500;
  color: #eef4ff;
  margin-bottom: 6px;
}

.artifact-meta {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #8ea0bd;
}

.artifact-status {
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 500;
}

.artifact-status.ready {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}

.artifact-status.processing {
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
}

.artifact-detail,
.run-detail {
  display: flex;
  flex-direction: column;
  background: #1d2940;
  border-radius: 14px;
  border: 1px solid rgba(114, 128, 150, 0.14);
  overflow: hidden;
}

.artifact-detail.empty,
.run-detail.empty {
  align-items: center;
  justify-content: center;
}

.artifact-content,
.run-info {
  padding: 16px;
  overflow-y: auto;
}

.artifact-preview {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid rgba(114, 128, 150, 0.14);
}

.preview-label {
  font-size: 12px;
  font-weight: 600;
  color: #8ea0bd;
  margin-bottom: 8px;
}

.preview-content {
  background: #141d2e;
  padding: 12px;
  border-radius: 8px;
  font-size: 13px;
  color: #c8d4e8;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.empty-list {
  padding: 24px;
  text-align: center;
  color: #5a6a85;
  font-size: 13px;
}

.empty-state {
  color: #5a6a85;
  font-size: 14px;
}

/* Run 列表样式 */
.run-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.run-id {
  font-size: 12px;
  font-family: monospace;
  color: #8ea0bd;
}

.run-status {
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 500;
}

.run-status.success {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}

.run-status.failed {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.run-status.running {
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
}

.run-agent {
  font-size: 13px;
  font-weight: 500;
  color: #eef4ff;
  margin-bottom: 4px;
}

.run-summary {
  font-size: 12px;
  color: #8ea0bd;
  line-height: 1.5;
  margin-bottom: 6px;
}

.run-time {
  font-size: 11px;
  color: #5a6a85;
}

/* Run Steps 样式 */
.run-steps {
  padding: 16px;
  overflow-y: auto;
}

.run-step-item {
  padding: 12px;
  background: #141d2e;
  border-radius: 10px;
  margin-bottom: 10px;
  border-left: 3px solid #5b6dff;
}

.run-step-item.tool {
  border-left-color: #f59e0b;
}

.run-step-item.model {
  border-left-color: #3b82f6;
}

.run-step-item.final {
  border-left-color: #22c55e;
}

.step-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.step-index {
  font-size: 12px;
  font-weight: 700;
  color: #5b6dff;
  font-family: monospace;
}

.step-type {
  font-size: 11px;
  font-weight: 600;
  color: #8ea0bd;
  text-transform: uppercase;
  padding: 2px 8px;
  background: rgba(91, 109, 255, 0.1);
  border-radius: 4px;
}

.step-time {
  font-size: 11px;
  color: #5a6a85;
  margin-left: auto;
}

.step-content {
  font-size: 13px;
  color: #c8d4e8;
  line-height: 1.6;
}

.step-tool {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(114, 128, 150, 0.14);
}

.tool-name {
  font-size: 12px;
  font-weight: 600;
  color: #f59e0b;
}

.tool-status {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 12px;
}

.tool-status.pending {
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
}

.tool-status.success {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}

.tool-status.failed {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

/* Run Info 样式 */
.run-info .info-row {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
}

.run-info .info-label {
  font-size: 12px;
  font-weight: 600;
  color: #8ea0bd;
  min-width: 60px;
}

.run-info .info-value {
  font-size: 13px;
  color: #c8d4e8;
  flex: 1;
  line-height: 1.6;
}

.run-info .info-value.success {
  color: #22c55e;
}

.run-info .info-value.failed {
  color: #ef4444;
}

.dialog-body {
  display: grid;
  gap: 12px;
}

.session-dialog-body {
  gap: 18px;
}

.dialog-intro {
  padding: 14px 16px;
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(91, 109, 255, 0.08), rgba(91, 109, 255, 0.02));
  border: 1px solid rgba(91, 109, 255, 0.14);
}

.dialog-intro-title {
  color: #101828;
  font-size: 16px;
  font-weight: 700;
}

.dialog-intro-desc {
  margin-top: 6px;
  color: #526279;
  line-height: 1.6;
}

.dialog-label {
  color: #344054;
  font-size: 13px;
  font-weight: 600;
}

.agent-choice-grid,
.dialog-target-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 10px;
}

.agent-choice-card,
.target-card {
  padding: 14px;
  text-align: left;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 14px;
  background: #f8fafc;
  color: #10203b;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
}

.agent-choice-card:hover,
.target-card:hover {
  transform: translateY(-1px);
  border-color: rgba(91, 109, 255, 0.34);
  box-shadow: 0 10px 22px rgba(15, 23, 42, 0.08);
}

.agent-choice-top {
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}

.agent-avatar {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 14px;
  color: #fff;
  font-weight: 700;
}

.agent-choice-check {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  color: transparent;
  background: #fff;
}

.agent-choice-check.active {
  border-color: transparent;
  background: linear-gradient(135deg, #5b6dff, #7c3aed);
  color: #fff;
}

.agent-choice-name,
.target-title {
  font-size: 14px;
  font-weight: 700;
  color: #0f172a;
}

.agent-choice-desc,
.target-desc {
  margin-top: 6px;
  color: #607089;
  line-height: 1.5;
  font-size: 12px;
}

.agent-choice-meta {
  margin-top: 10px;
}

.dialog-select {
  width: 100%;
  margin-top: 10px;
}

.dialog-input {
  width: 100%;
  height: 42px;
  margin-top: 10px;
  padding: 0 12px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 12px;
  color: #0f172a;
  background: #fff;
  font: inherit;
  box-sizing: border-box;
}

.dialog-textarea {
  width: 100%;
  min-height: 96px;
  margin-top: 10px;
  padding: 12px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 12px;
  color: #0f172a;
  background: #fff;
  font: inherit;
  line-height: 1.6;
  box-sizing: border-box;
  resize: vertical;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

:deep(.project-select .el-select__wrapper) {
  min-height: 46px;
  border-radius: 16px;
  background: linear-gradient(180deg, rgba(29, 41, 64, 0.96), rgba(24, 35, 56, 0.96));
  box-shadow: inset 0 0 0 1px rgba(106, 124, 156, 0.16), 0 12px 28px rgba(0, 0, 0, 0.18);
}

:deep(.dialog-select .el-select__wrapper) {
  min-height: 46px;
  border-radius: 16px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(248, 250, 255, 0.98));
  box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.22), 0 10px 22px rgba(15, 23, 42, 0.08);
}

:deep(.project-select .el-select__wrapper.is-focused) {
  box-shadow:
    inset 0 0 0 1px rgba(91, 109, 255, 0.52),
    0 0 0 4px rgba(91, 109, 255, 0.12),
    0 18px 34px rgba(0, 0, 0, 0.24);
}

:deep(.dialog-select .el-select__wrapper.is-focused) {
  box-shadow:
    inset 0 0 0 1px rgba(91, 109, 255, 0.52),
    0 0 0 4px rgba(91, 109, 255, 0.12),
    0 14px 28px rgba(15, 23, 42, 0.12);
}

:deep(.project-select .el-select__placeholder),
:deep(.project-select .el-select__selected-item),
:deep(.project-select .el-input__inner) {
  color: #edf3ff;
}

:deep(.dialog-select .el-select__placeholder),
:deep(.dialog-select .el-select__selected-item),
:deep(.dialog-select .el-input__inner) {
  color: #1f2a44;
}

:deep(.project-select .el-select__caret) {
  color: #8ea0bd;
}

:deep(.dialog-select .el-select__caret) {
  color: #6b7a90;
}

:deep(.project-select .el-select__wrapper:hover) {
  box-shadow: inset 0 0 0 1px rgba(124, 143, 176, 0.22), 0 14px 28px rgba(0, 0, 0, 0.22);
}

:deep(.dialog-select .el-select__wrapper:hover) {
  box-shadow: inset 0 0 0 1px rgba(124, 143, 176, 0.28), 0 12px 24px rgba(15, 23, 42, 0.1);
}

:deep(.agent-dark-select-popper.el-popper) {
  border: 1px solid rgba(113, 128, 150, 0.18);
  border-radius: 18px;
  background: rgba(20, 29, 45, 0.98);
  box-shadow: 0 24px 56px rgba(0, 0, 0, 0.44);
}

:deep(.agent-dark-select-popper .el-select-dropdown__wrap) {
  padding: 8px;
}

:deep(.agent-dark-select-popper .el-select-dropdown__item) {
  margin: 4px 0;
  border-radius: 12px;
  color: #dbe6fb;
}

:deep(.agent-dark-select-popper .el-select-dropdown__item.hover),
:deep(.agent-dark-select-popper .el-select-dropdown__item:hover) {
  background: rgba(91, 109, 255, 0.14);
}

:deep(.agent-dark-select-popper .el-select-dropdown__item.selected) {
  color: #fff;
  background: linear-gradient(135deg, rgba(91, 109, 255, 0.22), rgba(124, 58, 237, 0.18));
}

@media (max-width: 1600px) {
  .agent-os-page {
    --sidebar-column: 260px;
    --workspace-column: minmax(360px, 0.92fr);
    --workspace-offset: 392px;
  }
}

@media (max-width: 1360px) {
  .agent-os-page {
    grid-template-columns: 1fr;
    --sidebar-column: 1fr;
    --sidebar-divider-column: 0px;
    --conversation-column: 1fr;
    --center-divider-column: 0px;
    --workspace-column: 1fr;
    --workspace-offset: 24px;
  }

  .layout-divider {
    display: none;
  }

  .sidebar-shell,
  .conversation-shell {
    border-right: 0;
    border-bottom: 1px solid rgba(113, 128, 150, 0.16);
  }

  .workspace-host {
    padding: 0 20px 20px;
  }

  .floating-composer {
    position: static;
    width: 100%;
    left: auto;
    right: auto;
    bottom: auto;
  }

  .conversation-shell.collapsed .composer {
    position: static;
    width: 100%;
    left: auto;
    right: auto;
    bottom: auto;
    z-index: auto;
    padding-top: 14px;
  }
}

@media (max-width: 900px) {
  .project-toolbar,
  .workspace-header {
    flex-direction: column;
    align-items: stretch;
  }

  .workspace-header-actions {
    justify-content: flex-start;
  }

  .project-select {
    width: 100%;
  }

  .agent-choice-grid,
  .dialog-target-row,
  .workspace-grid,
  .mode-grid,
  .placeholder-grid {
    grid-template-columns: 1fr;
  }

  .workspace-host.fullscreen {
    inset: 8px;
    padding: 14px;
  }
}
</style>
