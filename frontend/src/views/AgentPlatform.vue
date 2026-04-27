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
            <!-- 左侧：产物列表 -->
            <div class="artifact-list">
              <div class="panel-header">
                <span class="panel-title">产物列表 ({{ workContextArtifacts.length }})</span>
                <div class="panel-filters">
                  <select v-model="artifactRoleFilter" class="filter-select">
                    <option value="">全部角色</option>
                    <option value="input">输入</option>
                    <option value="reference">参考</option>
                    <option value="intermediate">中间产物</option>
                    <option value="draft">草稿</option>
                    <option value="final">终稿</option>
                    <option value="output">输出</option>
                  </select>
                </div>
              </div>
              <div class="artifact-items">
                <div
                  v-for="artifact in filteredArtifacts"
                  :key="artifact.artifactUid"
                  class="artifact-item"
                  :class="{ active: selectedArtifact?.artifactUid === artifact.artifactUid }"
                  @click="selectedArtifact = artifact"
                >
                  <div class="artifact-header">
                    <span class="artifact-type-badge" :class="artifact.artifactType">
                      {{ getArtifactTypeLabel(artifact.artifactType) }}
                    </span>
                    <span class="artifact-role-badge" :class="artifact.artifactRole">
                      {{ getArtifactRoleLabel(artifact.artifactRole) }}
                    </span>
                  </div>
                  <div class="artifact-title">{{ artifact.title || '未命名产物' }}</div>
                  <div class="artifact-meta">
                    <span class="meta-time">{{ formatTime(artifact.createdAt) }}</span>
                    <span :class="['artifact-status', artifact.status]">{{ artifact.status }}</span>
                  </div>
                </div>
                <div v-if="filteredArtifacts.length === 0" class="empty-list">
                  {{ workContextArtifacts.length === 0 ? '暂无产物' : '没有符合筛选条件的产物' }}
                </div>
              </div>
            </div>

            <!-- 右侧：产物详情 -->
            <div class="artifact-detail" v-if="selectedArtifact">
              <div class="panel-header">
                <span class="panel-title">产物详情</span>
                <div class="panel-actions">
                  <button class="ghost-mini" @click="copyArtifactContent(selectedArtifact)">
                    复制内容
                  </button>
                </div>
              </div>
              <div class="artifact-content">
                <!-- 基本信息 -->
                <div class="detail-section">
                  <div class="detail-header">
                    <h4>{{ selectedArtifact.title }}</h4>
                    <div class="detail-badges">
                      <span class="badge type" :class="selectedArtifact.artifactType">
                        {{ getArtifactTypeLabel(selectedArtifact.artifactType) }}
                      </span>
                      <span class="badge role" :class="selectedArtifact.artifactRole">
                        {{ getArtifactRoleLabel(selectedArtifact.artifactRole) }}
                      </span>
                    </div>
                  </div>

                  <div class="detail-grid">
                    <div class="detail-item">
                      <span class="detail-label">状态</span>
                      <span class="detail-value" :class="selectedArtifact.status">{{ selectedArtifact.status }}</span>
                    </div>
                    <div class="detail-item">
                      <span class="detail-label">MIME 类型</span>
                      <span class="detail-value">{{ selectedArtifact.mimeType || '-' }}</span>
                    </div>
                    <div class="detail-item">
                      <span class="detail-label">创建时间</span>
                      <span class="detail-value">{{ formatTime(selectedArtifact.createdAt) }}</span>
                    </div>
                    <div class="detail-item">
                      <span class="detail-label">更新时间</span>
                      <span class="detail-value">{{ formatTime(selectedArtifact.updatedAt) }}</span>
                    </div>
                  </div>
                </div>

                <!-- 类型化内容展示 -->
                <div class="detail-section artifact-content-display">
                  <div class="section-header">
                    <span class="section-title">{{ getArtifactContentTitle(selectedArtifact.artifactType) }}</span>
                    <div class="content-actions">
                      <button
                        v-if="selectedArtifact.artifactType === 'text'"
                        class="action-btn"
                        :class="{ active: textViewMode === 'rendered' }"
                        @click="textViewMode = textViewMode === 'raw' ? 'rendered' : 'raw'"
                      >
                        {{ textViewMode === 'raw' ? '渲染' : '原始' }}
                      </button>
                      <span class="content-length">{{ getArtifactContentLength(selectedArtifact) }} 字符</span>
                    </div>
                  </div>

                  <!-- 文本类型 -->
                  <template v-if="selectedArtifact.artifactType === 'text'">
                    <div v-if="textViewMode === 'rendered' && isMarkdown(selectedArtifact.contentText)" class="markdown-preview">
                      <div class="markdown-body" v-html="renderMarkdown(selectedArtifact.contentText)"></div>
                    </div>
                    <pre v-else class="preview-content text">{{ selectedArtifact.contentText }}</pre>
                  </template>

                  <!-- 结构化数据类型 -->
                  <template v-else-if="selectedArtifact.artifactType === 'structured_data'">
                    <div class="structured-data-view">
                      <div class="data-table-container" v-if="parseStructuredData(selectedArtifact).isTable">
                        <table class="data-table">
                          <thead>
                            <tr>
                              <th v-for="col in parseStructuredData(selectedArtifact).columns" :key="col">{{ col }}</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr v-for="(row, idx) in parseStructuredData(selectedArtifact).rows" :key="idx">
                              <td v-for="col in parseStructuredData(selectedArtifact).columns" :key="col">
                                {{ row[col] }}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                      <pre v-else class="preview-content json">{{ formatJson(selectedArtifact.contentJson) }}</pre>
                    </div>
                  </template>

                  <!-- 页面类型 -->
                  <template v-else-if="selectedArtifact.artifactType === 'page'">
                    <div class="page-preview">
                      <div class="page-meta" v-if="getPageMeta(selectedArtifact)">
                        <div class="page-url">{{ getPageMeta(selectedArtifact)?.url }}</div>
                        <div class="page-title">{{ getPageMeta(selectedArtifact)?.title }}</div>
                      </div>
                      <iframe
                        v-if="selectedArtifact.uri"
                        :src="selectedArtifact.uri"
                        class="page-iframe"
                        sandbox="allow-scripts allow-same-origin"
                      ></iframe>
                      <div v-else-if="selectedArtifact.contentText" class="page-content">
                        <div class="html-preview" v-html="sanitizeHtml(selectedArtifact.contentText)"></div>
                      </div>
                      <div v-else class="empty-content">无可预览内容</div>
                    </div>
                  </template>

                  <!-- 图片类型 -->
                  <template v-else-if="selectedArtifact.artifactType === 'image'">
                    <div class="image-preview">
                      <img
                        v-if="selectedArtifact.uri"
                        :src="selectedArtifact.uri"
                        :alt="selectedArtifact.title"
                        class="preview-image"
                        @error="onImageError"
                      />
                      <div v-else-if="isBase64Image(selectedArtifact.contentText)" class="base64-image-container">
                        <img :src="selectedArtifact.contentText" :alt="selectedArtifact.title" class="preview-image" />
                      </div>
                      <div v-else class="image-placeholder">
                        <div class="placeholder-icon">🖼️</div>
                        <div class="placeholder-text">图片数据</div>
                        <div v-if="getImageMeta(selectedArtifact)" class="image-meta">
                          <span>{{ getImageMeta(selectedArtifact)?.width }} x {{ getImageMeta(selectedArtifact)?.height }}</span>
                          <span>{{ getImageMeta(selectedArtifact)?.format }}</span>
                        </div>
                      </div>
                    </div>
                  </template>

                  <!-- 链接类型 -->
                  <template v-else-if="selectedArtifact.artifactType === 'link'">
                    <div class="link-preview">
                      <a
                        :href="selectedArtifact.uri || selectedArtifact.contentText"
                        target="_blank"
                        class="link-card"
                      >
                        <div class="link-icon">🔗</div>
                        <div class="link-info">
                          <div class="link-title">{{ selectedArtifact.title }}</div>
                          <div class="link-url">{{ selectedArtifact.uri || selectedArtifact.contentText }}</div>
                        </div>
                        <div class="link-arrow">→</div>
                      </a>
                      <div v-if="getLinkMeta(selectedArtifact)" class="link-meta">
                        <span class="meta-item">{{ getLinkMeta(selectedArtifact)?.siteName }}</span>
                        <span class="meta-item" v-if="getLinkMeta(selectedArtifact)?.description">
                          {{ getLinkMeta(selectedArtifact)?.description?.slice(0, 100) }}...
                        </span>
                      </div>
                    </div>
                  </template>

                  <!-- 文件类型 -->
                  <template v-else-if="selectedArtifact.artifactType === 'file'">
                    <div class="file-preview">
                      <div class="file-card">
                        <div class="file-icon">{{ getFileIcon(selectedArtifact.mimeType) }}</div>
                        <div class="file-info">
                          <div class="file-name">{{ selectedArtifact.title }}</div>
                          <div class="file-meta">
                            <span class="file-type">{{ selectedArtifact.mimeType || '未知类型' }}</span>
                            <span v-if="getFileSize(selectedArtifact)" class="file-size">{{ getFileSize(selectedArtifact) }}</span>
                          </div>
                        </div>
                        <a
                          v-if="selectedArtifact.uri"
                          :href="selectedArtifact.uri"
                          target="_blank"
                          class="file-download"
                          download
                        >
                          下载
                        </a>
                      </div>
                      <div v-if="isTextFile(selectedArtifact.mimeType) && selectedArtifact.contentText" class="file-content">
                        <pre class="preview-content">{{ selectedArtifact.contentText.slice(0, 5000) }}</pre>
                        <div v-if="selectedArtifact.contentText.length > 5000" class="content-truncated">
                          内容已截断，共 {{ selectedArtifact.contentText.length }} 字符
                        </div>
                      </div>
                    </div>
                  </template>

                  <!-- 集合类型 -->
                  <template v-else-if="selectedArtifact.artifactType === 'collection'">
                    <div class="collection-preview">
                      <div class="collection-header">
                        <span class="collection-count">{{ getCollectionItems(selectedArtifact).length }} 项</span>
                      </div>
                      <div class="collection-items">
                        <div
                          v-for="(item, idx) in getCollectionItems(selectedArtifact)"
                          :key="idx"
                          class="collection-item"
                        >
                          <span class="item-index">{{ idx + 1 }}</span>
                          <span class="item-type">{{ item.type }}</span>
                          <span class="item-title">{{ item.title }}</span>
                        </div>
                      </div>
                    </div>
                  </template>

                  <!-- 默认类型 -->
                  <template v-else>
                    <pre class="preview-content">{{ selectedArtifact.contentText }}</pre>
                  </template>
                </div>

                <!-- JSON 内容（如果存在且不是结构化数据类型） -->
                <div class="detail-section" v-if="selectedArtifact.contentJson && selectedArtifact.contentJson !== '{}' && selectedArtifact.artifactType !== 'structured_data'">
                  <div class="section-header">
                    <span class="section-title">结构化数据</span>
                  </div>
                  <pre class="preview-content json">{{ formatJson(selectedArtifact.contentJson) }}</pre>
                </div>

                <!-- URI 链接 -->
                <div class="detail-section" v-if="selectedArtifact.uri && selectedArtifact.artifactType !== 'link' && selectedArtifact.artifactType !== 'page'">
                  <div class="section-header">
                    <span class="section-title">外部链接</span>
                  </div>
                  <a :href="selectedArtifact.uri" target="_blank" class="external-link">
                    {{ selectedArtifact.uri }}
                  </a>
                </div>

                <!-- 元数据 -->
                <div class="detail-section" v-if="selectedArtifact.metadataJson && selectedArtifact.metadataJson !== '{}'">
                  <div class="section-header">
                    <span class="section-title">元数据</span>
                  </div>
                  <pre class="preview-content json">{{ formatJson(selectedArtifact.metadataJson) }}</pre>
                </div>
              </div>
            </div>
            <div class="artifact-detail empty" v-else>
              <div class="empty-state">
                <div class="empty-icon">📄</div>
                <div class="empty-text">选择一个产物查看详情</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Tab: 执行过程 - Run 列表与 Steps -->
        <div v-if="activeWorkspaceTab === '执行过程'" class="workspace-tab-panel">
          <div class="run-split-panel">
            <!-- 左侧：Run 列表 -->
            <div class="run-list">
              <div class="panel-header">
                <span class="panel-title">执行记录 ({{ workContextRuns.length }})</span>
                <div class="panel-filters">
                  <select v-model="runStatusFilter" class="filter-select">
                    <option value="">全部状态</option>
                    <option value="success">成功</option>
                    <option value="failed">失败</option>
                    <option value="running">运行中</option>
                    <option value="queued">排队中</option>
                  </select>
                </div>
              </div>
              <div class="run-items">
                <div
                  v-for="run in filteredRuns"
                  :key="run.runUid"
                  class="run-item"
                  :class="{ active: selectedRun?.runUid === run.runUid, [run.status]: true }"
                  @click="selectRun(run)"
                >
                  <div class="run-header">
                    <span class="run-id">{{ run.runUid.slice(0, 12) }}...</span>
                    <span class="run-status-badge" :class="run.status">{{ getRunStatusLabel(run.status) }}</span>
                  </div>
                  <div class="run-agent-row">
                    <span class="agent-avatar">{{ getAgentShortName(run.agentName || String(run.agentId)) }}</span>
                    <span class="agent-name">{{ run.agentName || run.agentId }}</span>
                  </div>
                  <div class="run-message" v-if="run.userMessage">{{ run.userMessage.slice(0, 50) }}...</div>
                  <div class="run-summary" v-if="run.resultSummary">{{ run.resultSummary.slice(0, 60) }}...</div>
                  <div class="run-meta">
                    <span class="meta-time">{{ formatTime(run.startedAt) }}</span>
                    <span v-if="run.finishedAt" class="meta-duration">
                      {{ getRunDuration(run.startedAt!, run.finishedAt!) }}
                    </span>
                  </div>
                </div>
                <div v-if="filteredRuns.length === 0" class="empty-list">
                  {{ workContextRuns.length === 0 ? '暂无执行记录' : '没有符合筛选条件的记录' }}
                </div>
              </div>
            </div>

            <!-- 右侧：Run 详情 -->
            <div class="run-detail" v-if="selectedRun">
              <div class="panel-header">
                <span class="panel-title">执行详情</span>
                <div class="panel-actions">
                  <button class="ghost-mini" @click="copyRunId(selectedRun.runUid)">
                    复制 ID
                  </button>
                </div>
              </div>

              <div class="run-detail-content">
                <!-- Run 基本信息 -->
                <div class="detail-section">
                  <div class="detail-header">
                    <div class="run-status-indicator" :class="selectedRun.status">
                      <span class="status-icon">{{ getRunStatusIcon(selectedRun.status) }}</span>
                      <span class="status-text">{{ getRunStatusLabel(selectedRun.status) }}</span>
                    </div>
                    <div class="run-id-display">
                      <code>{{ selectedRun.runUid }}</code>
                    </div>
                  </div>

                  <div class="detail-grid">
                    <div class="detail-item">
                      <span class="detail-label">执行 Agent</span>
                      <span class="detail-value">{{ selectedRun.agentName || selectedRun.agentId }}</span>
                    </div>
                    <div class="detail-item">
                      <span class="detail-label">执行模式</span>
                      <span class="detail-value">{{ selectedRun.mode || 'standalone' }}</span>
                    </div>
                    <div class="detail-item">
                      <span class="detail-label">开始时间</span>
                      <span class="detail-value">{{ formatTime(selectedRun.startedAt) }}</span>
                    </div>
                    <div class="detail-item">
                      <span class="detail-label">结束时间</span>
                      <span class="detail-value">{{ formatTime(selectedRun.finishedAt) || '运行中...' }}</span>
                    </div>
                    <div class="detail-item" v-if="selectedRun.startedAt && selectedRun.finishedAt">
                      <span class="detail-label">执行时长</span>
                      <span class="detail-value">{{ getRunDuration(selectedRun.startedAt, selectedRun.finishedAt) }}</span>
                    </div>
                  </div>
                </div>

                <!-- 用户消息 -->
                <div class="detail-section" v-if="selectedRun.userMessage">
                  <div class="section-header">
                    <span class="section-title">用户输入</span>
                  </div>
                  <div class="message-box user">
                    {{ selectedRun.userMessage }}
                  </div>
                </div>

                <!-- 执行结果 -->
                <div class="detail-section" v-if="selectedRun.resultSummary">
                  <div class="section-header">
                    <span class="section-title">执行结果</span>
                  </div>
                  <div class="message-box result">
                    {{ selectedRun.resultSummary }}
                  </div>
                </div>

                <!-- 错误信息 -->
                <div class="detail-section" v-if="selectedRun.errorMessage">
                  <div class="section-header">
                    <span class="section-title">错误信息</span>
                  </div>
                  <div class="message-box error">
                    {{ selectedRun.errorMessage }}
                  </div>
                </div>

                <!-- 执行步骤时间线 -->
                <div class="detail-section" v-if="selectedRunSteps.length > 0">
                  <div class="section-header">
                    <span class="section-title">执行步骤 ({{ selectedRunSteps.length }})</span>
                  </div>
                  <div class="steps-timeline">
                    <div
                      v-for="(step, index) in selectedRunSteps"
                      :key="step.id"
                      class="timeline-item"
                      :class="[step.stepType, { last: index === selectedRunSteps.length - 1 }]"
                    >
                      <div class="timeline-marker" :class="step.stepType">
                        <span class="marker-icon">{{ getStepTypeIcon(step.stepType) }}</span>
                      </div>
                      <div class="timeline-content">
                        <div class="step-header-row">
                          <span class="step-type-label">{{ getStepTypeLabel(step.stepType) }}</span>
                          <span class="step-time">{{ formatTime(step.createdAt) }}</span>
                        </div>
                        <div class="step-body" v-if="step.content">
                          <div class="step-content-text">{{ step.content }}</div>
                        </div>
                        <div class="step-tool-info" v-if="step.toolName">
                          <span class="tool-label">工具:</span>
                          <span class="tool-name">{{ step.toolName }}</span>
                          <span class="tool-status-badge" :class="step.toolStatus">{{ step.toolStatus }}</span>
                        </div>
                        <!-- 工具输入输出 -->
                        <div class="step-io" v-if="step.inputJson || step.outputJson">
                          <div class="io-section" v-if="step.inputJson && step.inputJson !== '{}'">
                            <div class="io-label">输入</div>
                            <pre class="io-content">{{ formatStepIo(step.inputJson) }}</pre>
                          </div>
                          <div class="io-section" v-if="step.outputJson && step.outputJson !== '{}'">
                            <div class="io-label">输出</div>
                            <pre class="io-content">{{ formatStepIo(step.outputJson) }}</pre>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- 无步骤提示 -->
                <div class="detail-section empty-steps" v-else>
                  <div class="empty-state">
                    <div class="empty-icon">📋</div>
                    <div class="empty-text">暂无执行步骤记录</div>
                  </div>
                </div>
              </div>
            </div>
            <div class="run-detail empty" v-else>
              <div class="empty-state">
                <div class="empty-icon">▶️</div>
                <div class="empty-text">选择一个执行记录查看详情</div>
              </div>
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
  agentName?: string | null;
}

interface MessageItem {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  time?: string;
  runId?: string;
  agentName?: string;
  agentAvatar?: string;
  steps?: RunStep[];
  isStreaming?: boolean;
  run?: RunInfo;
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
  messages: MessageItem[];
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

// 产物筛选
const artifactRoleFilter = ref<string>('');

// 筛选后的产物列表
const filteredArtifacts = computed(() => {
  if (!artifactRoleFilter.value) return workContextArtifacts.value;
  return workContextArtifacts.value.filter(a => a.artifactRole === artifactRoleFilter.value);
});

// Run 状态筛选
const runStatusFilter = ref<string>('');

// 筛选后的 Run 列表
const filteredRuns = computed(() => {
  if (!runStatusFilter.value) return workContextRuns.value;
  return workContextRuns.value.filter(r => r.status === runStatusFilter.value);
});

// 文本视图模式
const textViewMode = ref<'raw' | 'rendered'>('raw');

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

// 加载并选中会话的 WorkContext（使用聚合接口）
async function loadAndSelectSessionWorkContext(sessionId: string) {
  try {
    console.log(`[loadAndSelectSessionWorkContext] Loading workbench for session: ${sessionId}`);
    const workbench = await agentPlatformApi.getSessionWorkbench(sessionId);
    console.log(`[loadAndSelectSessionWorkContext] Loaded workbench:`, workbench);

    sessionWorkContexts.value = workbench.workContexts;
    sessionRuns.value = workbench.runs;

    if (workbench.selectedWorkContext) {
      selectedWorkContext.value = workbench.selectedWorkContext;
      workContextArtifacts.value = workbench.artifacts;
      selectedArtifact.value = workbench.artifacts[0] || null;
      console.log(`[loadAndSelectSessionWorkContext] Selected work context: ${workbench.selectedWorkContext.workContextUid}`);

      // 加载该 workContext 的 runs
      await loadWorkContextRuns(workbench.selectedWorkContext.workContextUid);
    } else {
      selectedWorkContext.value = null;
      workContextArtifacts.value = [];
      workContextRuns.value = [];
      selectedArtifact.value = null;
      selectedRun.value = null;
    }
  } catch (error) {
    console.error('[loadAndSelectSessionWorkContext] Failed to load workbench:', error);
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
            input: s.input,
            output: s.output,
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
          runId: run.runUid,
          agentName: run.agentName || primaryAgent.value?.name || 'AI Assistant',
          steps: steps,
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
      subscribeToRunSteps(response.runId, assistantMessage.run);
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
  if (runInfo.isExpanded) {
    activeWorkspaceTab.value = "执行过程";
    const matchedRun = workContextRuns.value.find((item) => item.runUid === runInfo.runId);
    if (matchedRun) {
      void selectRun(matchedRun);
    }
  }
}

// 选择 Run 并加载 Steps
async function selectRun(run: AgentRunRecord) {
  selectedRun.value = run;
  activeWorkspaceTab.value = "执行过程";
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
      const latestRun = workContextRuns.value.find((item) => item.runUid === runId);
      if (latestRun) {
        selectedRun.value = latestRun;
      }
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
    if (selectedRun.value) {
      const matchedRun = runs.find((run) => run.runUid === selectedRun.value?.runUid);
      selectedRun.value = matchedRun || runs[0] || null;
    } else {
      selectedRun.value = runs[0] || null;
    }
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
    // currentRunId 是 number，runId 是 string，需要转换后比较
    const matchedByRun = workContexts.find(wc => wc.currentRunId?.toString() === runId);
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
// 刷新选中 WorkContext 的数据（使用聚合接口）
async function reloadArtifactsForSelectedWorkContext() {
  if (!selectedWorkContext.value) {
    console.warn('[reloadArtifactsForSelectedWorkContext] No selected work context');
    return;
  }

  try {
    const workContextUid = selectedWorkContext.value.workContextUid;
    const workbench = await agentPlatformApi.getWorkContextWorkbench(workContextUid);
    console.log(`[reloadArtifactsForSelectedWorkContext] Loaded workbench:`, workbench);

    // 更新 WorkContext（包含展开的元数据字段）
    selectedWorkContext.value = workbench.workContext;
    // 更新产物列表
    workContextArtifacts.value = workbench.artifacts;
    // 更新 runs 列表
    workContextRuns.value = workbench.runs;
    if (selectedArtifact.value) {
      const matchedArtifact = workbench.artifacts.find(
        (artifact) => artifact.artifactUid === selectedArtifact.value?.artifactUid,
      );
      selectedArtifact.value = matchedArtifact || workbench.artifacts[0] || null;
    } else {
      selectedArtifact.value = workbench.artifacts[0] || null;
    }
    if (selectedRun.value) {
      const matchedRun = workbench.runs.find((run) => run.runUid === selectedRun.value?.runUid);
      selectedRun.value = matchedRun || workbench.runs[0] || null;
    } else {
      selectedRun.value = workbench.runs[0] || null;
    }
  } catch (error) {
    console.error('[reloadArtifactsForSelectedWorkContext] Failed to load workbench:', error);
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

// 获取 Artifact 类型标签
function getArtifactTypeLabel(type: string): string {
  const labelMap: Record<string, string> = {
    text: '文本',
    structured_data: '结构化数据',
    page: '页面',
    image: '图片',
    link: '链接',
    file: '文件',
    collection: '集合',
  };
  return labelMap[type] || type;
}

// 获取 Artifact 角色标签
function getArtifactRoleLabel(role: string): string {
  const labelMap: Record<string, string> = {
    input: '输入',
    reference: '参考',
    intermediate: '中间产物',
    draft: '草稿',
    final: '终稿',
    output: '输出',
  };
  return labelMap[role] || role;
}

// 格式化 JSON 显示
function formatJson(jsonStr: string): string {
  try {
    const obj = JSON.parse(jsonStr);
    return JSON.stringify(obj, null, 2);
  } catch {
    return jsonStr;
  }
}

// 复制产物内容
async function copyArtifactContent(artifact: AgentArtifactRecord) {
  try {
    const content = artifact.contentText || artifact.contentJson || '';
    await navigator.clipboard.writeText(content);
    ElMessage.success('内容已复制到剪贴板');
  } catch (error) {
    console.error('Failed to copy:', error);
    ElMessage.error('复制失败');
  }
}

// 获取 Run 状态标签
function getRunStatusLabel(status: string): string {
  const labelMap: Record<string, string> = {
    success: '成功',
    failed: '失败',
    running: '运行中',
    queued: '排队中',
    cancelled: '已取消',
  };
  return labelMap[status] || status;
}

// 获取 Run 状态图标
function getRunStatusIcon(status: string): string {
  const iconMap: Record<string, string> = {
    success: '✓',
    failed: '✗',
    running: '▶',
    queued: '⏳',
    cancelled: '⏹',
  };
  return iconMap[status] || '•';
}

// 获取执行时长
function getRunDuration(startedAt: string, finishedAt: string): string {
  const start = new Date(startedAt).getTime();
  const end = new Date(finishedAt).getTime();
  const duration = end - start;

  if (duration < 1000) {
    return `${duration}ms`;
  } else if (duration < 60000) {
    return `${Math.round(duration / 1000)}s`;
  } else {
    const minutes = Math.floor(duration / 60000);
    const seconds = Math.round((duration % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }
}

// 复制 Run ID
async function copyRunId(runId: string) {
  try {
    await navigator.clipboard.writeText(runId);
    ElMessage.success('Run ID 已复制');
  } catch (error) {
    console.error('Failed to copy:', error);
    ElMessage.error('复制失败');
  }
}

// 获取步骤类型标签
function getStepTypeLabel(stepType: string): string {
  const labelMap: Record<string, string> = {
    thought: '思考',
    tool_call: '工具调用',
    tool_result: '工具结果',
    message: '消息',
    system: '系统',
    error: '错误',
  };
  return labelMap[stepType] || stepType;
}

// 获取步骤类型图标
function getStepTypeIcon(stepType: string): string {
  const iconMap: Record<string, string> = {
    thought: '💭',
    tool_call: '🔧',
    tool_result: '📤',
    message: '💬',
    system: '⚙️',
    error: '⚠️',
  };
  return iconMap[stepType] || '•';
}

// 格式化步骤输入输出
function formatStepIo(io: string): string {
  try {
    const parsed = JSON.parse(io);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return io;
  }
}

// 获取产物内容标题
function getArtifactContentTitle(type: string): string {
  const titleMap: Record<string, string> = {
    text: '文本内容',
    structured_data: '结构化数据',
    page: '页面预览',
    image: '图片预览',
    link: '链接信息',
    file: '文件信息',
    collection: '集合内容',
  };
  return titleMap[type] || '内容预览';
}

// 获取产物内容长度
function getArtifactContentLength(artifact: AgentArtifactRecord): number {
  return (artifact.contentText?.length || 0) + (artifact.contentJson?.length || 0);
}

// 检查是否是 Markdown
function isMarkdown(text: string): boolean {
  if (!text) return false;
  const markdownPatterns = [
    /^#{1,6}\s/m,           // 标题
    /\*\*|__/,              // 粗体
    /\*|_/,                 // 斜体
    /`{1,3}/,               // 代码
    /\[.*?\]\(.*?\)/,       // 链接
    /^\s*[-*+]\s/m,         // 列表
    /^\s*\d+\.\s/m,         // 有序列表
    /^```/m,                // 代码块
    /^\|.*\|.*\|/m,         // 表格
    /^>/m,                  // 引用
  ];
  return markdownPatterns.some(pattern => pattern.test(text));
}

// 简单的 Markdown 渲染（避免引入大型库）
function renderMarkdown(text: string): string {
  if (!text) return '';
  return text
    // 代码块
    .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre class="code-block"><code>$2</code></pre>')
    // 行内代码
    .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
    // 标题
    .replace(/^######\s(.+)$/gm, '<h6>$1</h6>')
    .replace(/^#####\s(.+)$/gm, '<h5>$1</h5>')
    .replace(/^####\s(.+)$/gm, '<h4>$1</h4>')
    .replace(/^###\s(.+)$/gm, '<h3>$1</h3>')
    .replace(/^##\s(.+)$/gm, '<h2>$1</h2>')
    .replace(/^#\s(.+)$/gm, '<h1>$1</h1>')
    // 粗体
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    // 斜体
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    // 链接
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" class="md-link">$1</a>')
    // 无序列表
    .replace(/^\s*[-*+]\s(.+)$/gm, '<li>$1</li>')
    // 有序列表
    .replace(/^\s*\d+\.\s(.+)$/gm, '<li>$1</li>')
    // 引用
    .replace(/^>\s?(.+)$/gm, '<blockquote>$1</blockquote>')
    // 段落
    .replace(/\n\n/g, '</p><p>')
    // 换行
    .replace(/\n/g, '<br>');
}

// 解析结构化数据
function parseStructuredData(artifact: AgentArtifactRecord) {
  try {
    const data = JSON.parse(artifact.contentJson || '{}');
    
    // 检查是否是表格数据（数组且元素是对象）
    if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object') {
      const columns = Object.keys(data[0]);
      return {
        isTable: true,
        columns,
        rows: data.slice(0, 100), // 限制显示100行
      };
    }
    
    // 检查是否是对象数组格式
    if (data.data && Array.isArray(data.data)) {
      const columns = Object.keys(data.data[0] || {});
      return {
        isTable: true,
        columns,
        rows: data.data.slice(0, 100),
      };
    }
    
    return { isTable: false, data };
  } catch {
    return { isTable: false, data: null };
  }
}

// 获取页面元数据
function getPageMeta(artifact: AgentArtifactRecord) {
  try {
    const metadata = JSON.parse(artifact.metadataJson || '{}');
    return {
      url: metadata.url || artifact.uri,
      title: metadata.pageTitle || metadata.title || artifact.title,
    };
  } catch {
    return null;
  }
}

// 检查是否是 Base64 图片
function isBase64Image(text: string): boolean {
  if (!text) return false;
  return /^data:image\/[a-z]+;base64,/.test(text);
}

// 图片加载错误处理
function onImageError(event: Event) {
  const img = event.target as HTMLImageElement;
  img.style.display = 'none';
  // 可以在这里显示占位符
}

// 获取图片元数据
function getImageMeta(artifact: AgentArtifactRecord) {
  try {
    const metadata = JSON.parse(artifact.metadataJson || '{}');
    return {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format || artifact.mimeType?.replace('image/', ''),
    };
  } catch {
    return null;
  }
}

// 获取链接元数据
function getLinkMeta(artifact: AgentArtifactRecord) {
  try {
    const metadata = JSON.parse(artifact.metadataJson || '{}');
    return {
      siteName: metadata.siteName,
      description: metadata.description,
      favicon: metadata.favicon,
    };
  } catch {
    return null;
  }
}

// 获取文件图标
function getFileIcon(mimeType: string | null): string {
  if (!mimeType) return '📄';
  if (mimeType.includes('pdf')) return '📕';
  if (mimeType.includes('word') || mimeType.includes('document')) return '📝';
  if (mimeType.includes('excel') || mimeType.includes('sheet')) return '📊';
  if (mimeType.includes('powerpoint') || mimeType.includes('presentation')) return '📽️';
  if (mimeType.includes('zip') || mimeType.includes('compressed')) return '📦';
  if (mimeType.includes('code') || mimeType.includes('javascript') || mimeType.includes('json')) return '💻';
  if (mimeType.includes('text')) return '📃';
  return '📄';
}

// 获取文件大小
function getFileSize(artifact: AgentArtifactRecord): string {
  try {
    const metadata = JSON.parse(artifact.metadataJson || '{}');
    const bytes = metadata.size || metadata.fileSize;
    if (!bytes) return '';
    
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  } catch {
    return '';
  }
}

// 检查是否是文本文件
function isTextFile(mimeType: string | null): boolean {
  if (!mimeType) return true;
  const textTypes = ['text/', 'application/json', 'application/javascript', 'application/xml'];
  return textTypes.some(type => mimeType.includes(type));
}

// 获取集合项目
function getCollectionItems(artifact: AgentArtifactRecord): Array<{ type: string; title: string }> {
  try {
    const data = JSON.parse(artifact.contentJson || '[]');
    if (Array.isArray(data)) {
      return data.map((item: any) => ({
        type: item.type || 'item',
        title: item.title || item.name || String(item),
      }));
    }
    return [];
  } catch {
    return [];
  }
}

// HTML 净化（简单的 XSS 防护）
function sanitizeHtml(html: string): string {
  if (!html) return '';
  const div = document.createElement('div');
  div.textContent = html;
  return div.innerHTML
    // 允许安全的标签
    .replace(/&lt;(b|i|em|strong|code|pre|br|p|ul|ol|li|h[1-6]|blockquote)&gt;/g, '<$1>')
    .replace(/&lt;\/(b|i|em|strong|code|pre|p|ul|ol|li|h[1-6]|blockquote)&gt;/g, '</$1>');
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

.preview-content.json {
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 12px;
}

.empty-list {
  padding: 24px;
  text-align: center;
  color: #5a6a85;
  font-size: 13px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #5a6a85;
  font-size: 14px;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 12px;
  opacity: 0.5;
}

.empty-text {
  font-size: 14px;
}

/* 产物筛选器 */
.panel-filters {
  margin-top: 8px;
}

.filter-select {
  width: 100%;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid rgba(114, 128, 150, 0.3);
  background: #141d2e;
  color: #c8d4e8;
  font-size: 13px;
  cursor: pointer;
}

.filter-select:focus {
  outline: none;
  border-color: #5b6dff;
}

/* 产物列表项改进 */
.artifact-header {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
}

.artifact-type-badge,
.artifact-role-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
}

.artifact-type-badge {
  background: rgba(91, 109, 255, 0.15);
  color: #5b6dff;
}

.artifact-role-badge {
  background: rgba(124, 58, 237, 0.15);
  color: #a78bfa;
}

.artifact-role-badge.input {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}

.artifact-role-badge.output {
  background: rgba(59, 130, 246, 0.15);
  color: #3b82f6;
}

.artifact-role-badge.final {
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
}

.meta-time {
  font-size: 11px;
  color: #5a6a85;
}

/* 产物详情改进 */
.panel-actions {
  display: flex;
  gap: 8px;
}

.detail-section {
  margin-bottom: 20px;
  padding-bottom: 20px;
  border-bottom: 1px solid rgba(114, 128, 150, 0.14);
}

.detail-section:last-child {
  border-bottom: none;
  margin-bottom: 0;
  padding-bottom: 0;
}

.detail-header {
  margin-bottom: 16px;
}

.detail-header h4 {
  font-size: 16px;
  font-weight: 600;
  color: #eef4ff;
  margin: 0 0 10px 0;
}

.detail-badges {
  display: flex;
  gap: 8px;
}

.badge {
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
}

.badge.type {
  background: rgba(91, 109, 255, 0.15);
  color: #5b6dff;
}

.badge.role {
  background: rgba(124, 58, 237, 0.15);
  color: #a78bfa;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.detail-item .detail-label {
  font-size: 11px;
  color: #8ea0bd;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.detail-item .detail-value {
  font-size: 13px;
  color: #c8d4e8;
}

.detail-value.ready {
  color: #22c55e;
}

.detail-value.processing {
  color: #f59e0b;
}

.detail-value.error {
  color: #ef4444;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  color: #8ea0bd;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.content-length {
  font-size: 11px;
  color: #5a6a85;
}

.external-link {
  display: block;
  padding: 10px 12px;
  background: rgba(91, 109, 255, 0.1);
  border-radius: 8px;
  color: #5b6dff;
  font-size: 13px;
  text-decoration: none;
  word-break: break-all;
  transition: background 0.2s;
}

.external-link:hover {
  background: rgba(91, 109, 255, 0.2);
}

/* 产物类型化展示样式 */
.artifact-content-display {
  min-height: 200px;
}

.content-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.action-btn {
  padding: 4px 12px;
  border-radius: 6px;
  border: 1px solid rgba(114, 128, 150, 0.3);
  background: #141d2e;
  color: #8ea0bd;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.action-btn:hover,
.action-btn.active {
  background: rgba(91, 109, 255, 0.2);
  border-color: #5b6dff;
  color: #5b6dff;
}

/* Markdown 预览 */
.markdown-preview {
  background: #141d2e;
  border-radius: 8px;
  padding: 16px;
  max-height: 500px;
  overflow-y: auto;
}

.markdown-body {
  color: #c8d4e8;
  line-height: 1.8;
}

.markdown-body h1,
.markdown-body h2,
.markdown-body h3,
.markdown-body h4,
.markdown-body h5,
.markdown-body h6 {
  color: #eef4ff;
  margin: 16px 0 12px;
  font-weight: 600;
}

.markdown-body h1 { font-size: 20px; }
.markdown-body h2 { font-size: 18px; }
.markdown-body h3 { font-size: 16px; }
.markdown-body h4 { font-size: 14px; }
.markdown-body h5 { font-size: 13px; }
.markdown-body h6 { font-size: 12px; }

.markdown-body p {
  margin: 12px 0;
}

.markdown-body strong {
  color: #eef4ff;
  font-weight: 600;
}

.markdown-body code {
  background: rgba(91, 109, 255, 0.1);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'Monaco', 'Menlo', monospace;
  font-size: 12px;
  color: #a78bfa;
}

.markdown-body pre {
  background: #0d1420;
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 12px 0;
}

.markdown-body pre code {
  background: none;
  padding: 0;
  color: #c8d4e8;
}

.markdown-body blockquote {
  border-left: 3px solid #5b6dff;
  padding-left: 12px;
  margin: 12px 0;
  color: #8ea0bd;
}

.markdown-body a {
  color: #5b6dff;
  text-decoration: none;
}

.markdown-body a:hover {
  text-decoration: underline;
}

.markdown-body ul,
.markdown-body ol {
  margin: 12px 0;
  padding-left: 24px;
}

.markdown-body li {
  margin: 4px 0;
}

/* 结构化数据表格 */
.structured-data-view {
  background: #141d2e;
  border-radius: 8px;
  overflow: hidden;
}

.data-table-container {
  max-height: 400px;
  overflow: auto;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.data-table th,
.data-table td {
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid rgba(114, 128, 150, 0.2);
}

.data-table th {
  background: rgba(0, 0, 0, 0.2);
  font-weight: 600;
  color: #eef4ff;
  position: sticky;
  top: 0;
}

.data-table td {
  color: #c8d4e8;
}

.data-table tr:hover td {
  background: rgba(91, 109, 255, 0.05);
}

/* 页面预览 */
.page-preview {
  background: #141d2e;
  border-radius: 8px;
  overflow: hidden;
}

.page-meta {
  padding: 12px;
  background: rgba(0, 0, 0, 0.2);
  border-bottom: 1px solid rgba(114, 128, 150, 0.2);
}

.page-url {
  font-size: 11px;
  color: #5b6dff;
  word-break: break-all;
  margin-bottom: 4px;
}

.page-title {
  font-size: 14px;
  font-weight: 600;
  color: #eef4ff;
}

.page-iframe {
  width: 100%;
  height: 400px;
  border: none;
  background: white;
}

.page-content {
  padding: 16px;
  max-height: 400px;
  overflow-y: auto;
}

.html-preview {
  color: #c8d4e8;
  line-height: 1.6;
}

.empty-content {
  padding: 40px;
  text-align: center;
  color: #5a6a85;
}

/* 图片预览 */
.image-preview {
  background: #141d2e;
  border-radius: 8px;
  padding: 16px;
  text-align: center;
}

.preview-image {
  max-width: 100%;
  max-height: 400px;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.base64-image-container {
  display: inline-block;
}

.image-placeholder {
  padding: 40px;
}

.placeholder-icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.placeholder-text {
  font-size: 14px;
  color: #8ea0bd;
  margin-bottom: 8px;
}

.image-meta {
  display: flex;
  justify-content: center;
  gap: 16px;
  font-size: 12px;
  color: #5a6a85;
}

/* 链接预览 */
.link-preview {
  background: #141d2e;
  border-radius: 8px;
  padding: 16px;
}

.link-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: rgba(91, 109, 255, 0.1);
  border-radius: 8px;
  text-decoration: none;
  transition: background 0.2s;
}

.link-card:hover {
  background: rgba(91, 109, 255, 0.2);
}

.link-icon {
  font-size: 24px;
}

.link-info {
  flex: 1;
  min-width: 0;
}

.link-title {
  font-size: 14px;
  font-weight: 600;
  color: #eef4ff;
  margin-bottom: 4px;
}

.link-url {
  font-size: 12px;
  color: #5b6dff;
  word-break: break-all;
}

.link-arrow {
  font-size: 20px;
  color: #5b6dff;
}

.link-meta {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid rgba(114, 128, 150, 0.2);
}

.meta-item {
  display: block;
  font-size: 12px;
  color: #8ea0bd;
  margin: 4px 0;
}

/* 文件预览 */
.file-preview {
  background: #141d2e;
  border-radius: 8px;
  overflow: hidden;
}

.file-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: rgba(0, 0, 0, 0.2);
}

.file-icon {
  font-size: 32px;
}

.file-info {
  flex: 1;
  min-width: 0;
}

.file-name {
  font-size: 14px;
  font-weight: 600;
  color: #eef4ff;
  margin-bottom: 4px;
  word-break: break-all;
}

.file-meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: #8ea0bd;
}

.file-download {
  padding: 6px 12px;
  background: #5b6dff;
  color: white;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
  transition: background 0.2s;
}

.file-download:hover {
  background: #4a5de0;
}

.file-content {
  padding: 16px;
  max-height: 400px;
  overflow-y: auto;
}

.content-truncated {
  padding: 12px;
  text-align: center;
  font-size: 12px;
  color: #8ea0bd;
  background: rgba(0, 0, 0, 0.2);
  border-top: 1px solid rgba(114, 128, 150, 0.2);
}

/* 集合预览 */
.collection-preview {
  background: #141d2e;
  border-radius: 8px;
  padding: 16px;
}

.collection-header {
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(114, 128, 150, 0.2);
}

.collection-count {
  font-size: 12px;
  color: #8ea0bd;
}

.collection-items {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.collection-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 6px;
}

.item-index {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(91, 109, 255, 0.2);
  color: #5b6dff;
  font-size: 11px;
  font-weight: 600;
  border-radius: 4px;
}

.item-type {
  padding: 2px 8px;
  background: rgba(124, 58, 237, 0.2);
  color: #a78bfa;
  font-size: 11px;
  border-radius: 4px;
}

.item-title {
  flex: 1;
  font-size: 13px;
  color: #c8d4e8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Run 列表样式 */
.run-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.run-id {
  font-size: 12px;
  font-family: 'Monaco', 'Menlo', monospace;
  color: #8ea0bd;
}

.run-status-badge {
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
}

.run-status-badge.success {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}

.run-status-badge.failed {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.run-status-badge.running {
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
}

.run-status-badge.queued {
  background: rgba(148, 163, 184, 0.15);
  color: #94a3b8;
}

.run-agent-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.agent-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: linear-gradient(135deg, #5b6dff 0%, #8b5cf6 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  color: white;
}

.agent-name {
  font-size: 13px;
  font-weight: 500;
  color: #eef4ff;
}

.run-message {
  font-size: 12px;
  color: #c8d4e8;
  line-height: 1.5;
  margin-bottom: 6px;
  padding: 8px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 6px;
}

.run-summary {
  font-size: 12px;
  color: #8ea0bd;
  line-height: 1.5;
  margin-bottom: 6px;
}

.run-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.meta-duration {
  font-size: 11px;
  color: #5b6dff;
  font-weight: 500;
}

/* Run 详情样式 */
.run-detail-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.run-status-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  margin-bottom: 12px;
}

.run-status-indicator.success {
  background: rgba(34, 197, 94, 0.1);
}

.run-status-indicator.failed {
  background: rgba(239, 68, 68, 0.1);
}

.run-status-indicator.running {
  background: rgba(245, 158, 11, 0.1);
}

.status-icon {
  font-size: 18px;
}

.status-text {
  font-size: 14px;
  font-weight: 600;
}

.run-status-indicator.success .status-text {
  color: #22c55e;
}

.run-status-indicator.failed .status-text {
  color: #ef4444;
}

.run-status-indicator.running .status-text {
  color: #f59e0b;
}

.run-id-display {
  margin-bottom: 16px;
}

.run-id-display code {
  display: block;
  padding: 10px 12px;
  background: #141d2e;
  border-radius: 6px;
  font-family: 'Monaco', 'Menlo', monospace;
  font-size: 12px;
  color: #8ea0bd;
  word-break: break-all;
}

.message-box {
  padding: 12px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.6;
}

.message-box.user {
  background: rgba(91, 109, 255, 0.1);
  border-left: 3px solid #5b6dff;
  color: #c8d4e8;
}

.message-box.result {
  background: rgba(34, 197, 94, 0.1);
  border-left: 3px solid #22c55e;
  color: #c8d4e8;
}

.message-box.error {
  background: rgba(239, 68, 68, 0.1);
  border-left: 3px solid #ef4444;
  color: #ef4444;
}

/* 步骤时间线样式 */
.steps-timeline {
  position: relative;
}

.timeline-item {
  display: flex;
  gap: 12px;
  padding-bottom: 20px;
  position: relative;
}

.timeline-item:not(.last)::before {
  content: '';
  position: absolute;
  left: 15px;
  top: 32px;
  bottom: 0;
  width: 2px;
  background: rgba(114, 128, 150, 0.3);
}

.timeline-marker {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 14px;
}

.timeline-marker.thought {
  background: rgba(139, 92, 246, 0.2);
}

.timeline-marker.tool_call {
  background: rgba(245, 158, 11, 0.2);
}

.timeline-marker.tool_result {
  background: rgba(59, 130, 246, 0.2);
}

.timeline-marker.message {
  background: rgba(34, 197, 94, 0.2);
}

.timeline-marker.system {
  background: rgba(148, 163, 184, 0.2);
}

.timeline-marker.error {
  background: rgba(239, 68, 68, 0.2);
}

.timeline-content {
  flex: 1;
  min-width: 0;
}

.step-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.step-type-label {
  font-size: 12px;
  font-weight: 600;
  color: #eef4ff;
}

.step-body {
  margin-bottom: 8px;
}

.step-content-text {
  font-size: 13px;
  color: #c8d4e8;
  line-height: 1.6;
}

.step-tool-info {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 6px;
  margin-bottom: 8px;
}

.tool-label {
  font-size: 11px;
  color: #8ea0bd;
}

.tool-name {
  font-size: 12px;
  font-weight: 600;
  color: #f59e0b;
}

.tool-status-badge {
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 10px;
  font-weight: 600;
}

.tool-status-badge.pending {
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
}

.tool-status-badge.success {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}

.tool-status-badge.failed {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.step-io {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.io-section {
  background: #141d2e;
  border-radius: 6px;
  overflow: hidden;
}

.io-label {
  padding: 6px 10px;
  background: rgba(0, 0, 0, 0.2);
  font-size: 10px;
  font-weight: 600;
  color: #8ea0bd;
  text-transform: uppercase;
}

.io-content {
  padding: 10px;
  margin: 0;
  font-family: 'Monaco', 'Menlo', monospace;
  font-size: 11px;
  color: #c8d4e8;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.empty-steps {
  padding: 40px 0;
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
