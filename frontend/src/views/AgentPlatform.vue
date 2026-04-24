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
                {{ message.role === "assistant" ? primaryAgent.short : "我" }}
              </div>
              <div class="message-card">
                <div class="message-meta">
                  <span>{{ message.role === "assistant" ? primaryAgent.name : "我" }}</span>
                  <span>{{ message.time }}</span>
                </div>
                <div class="message-content">{{ message.content }}</div>
              </div>
            </article>

            <section class="execution-summary">
              <div class="summary-head">
                <div>
                  <div class="summary-title">执行摘要</div>
                  <div class="summary-subtitle">智能体正在拆解任务、执行协作并持续推进</div>
                </div>
                <button class="ghost-mini" @click="executionExpanded = !executionExpanded">
                  {{ executionExpanded ? "收起步骤" : `查看步骤（${executionSteps.length}）` }}
                </button>
              </div>

              <div class="summary-progress">
                <div class="progress-ring">
                  <span>65%</span>
                </div>
                <div>
                  <div class="summary-text">{{ executionSummary }}</div>
                  <div class="summary-progress-meta">
                    正在生成大纲、撰写正文、优化语句与结构表达
                  </div>
                </div>
              </div>

              <div v-if="executionExpanded" class="execution-steps">
                <div v-for="step in executionSteps" :key="step.id" class="execution-step">
                  <div class="execution-step-top">
                    <span>{{ step.title }}</span>
                    <span>{{ step.status }}</span>
                  </div>
                  <p>{{ step.detail }}</p>
                </div>
              </div>
            </section>
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
          <div class="workspace-host-title">工作台</div>
          <div class="workspace-host-subtitle">{{ workspaceTemplate.subtitle }}</div>
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
        <div class="workspace-template-card panel-card">
          <div class="workspace-template-icon" :style="{ background: workspaceTemplate.avatar }">
            {{ workspaceTemplate.short }}
          </div>
          <div class="workspace-template-title">{{ workspaceTemplate.name }}</div>
          <div class="workspace-template-desc">{{ workspaceTemplate.description }}</div>
        </div>

        <div class="workspace-grid">
          <div class="workspace-pane panel-card">
            <div class="workspace-pane-title">当前模式</div>
            <div class="mode-grid">
              <div
                v-for="feature in workspaceTemplate.features"
                :key="feature.title"
                class="mode-card"
              >
                <div class="mode-title">{{ feature.title }}</div>
                <div class="mode-desc">{{ feature.description }}</div>
              </div>
            </div>
          </div>

          <div class="workspace-pane panel-card">
            <div class="workspace-pane-title">面板说明</div>
            <p>{{ workspaceTemplate.panelIntro }}</p>
          </div>

          <div class="workspace-pane full panel-card">
            <div class="workspace-pane-title">预留插槽</div>
            <div class="placeholder-grid">
              <div class="placeholder-card">
                <div class="placeholder-name">智能体专属工作区</div>
                <div class="placeholder-desc">
                  后续会根据当前智能体类型挂载不同的工作台组件，而不是固定一种右栏内容。
                </div>
              </div>
              <div class="placeholder-card">
                <div class="placeholder-name">沉浸工作模式</div>
                <div class="placeholder-desc">
                  支持右侧工作台在桌面嵌入与全屏模式之间切换，适合长时间专注处理任务。
                </div>
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

import { agentPlatformApi, type AgentRecord } from "@/api/agentPlatform";

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

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  time: string;
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

const projectSpaces = ref<ProjectSpace[]>([
  {
    id: "project-edu",
    name: "教育内容创作项目",
    icon: "📘",
    sessions: [
      {
        id: "session-outline",
        title: "课程大纲撰写",
        updatedAt: "10:42",
        agentIds: ["writing_agent", "research_agent"],
        messages: [
          {
            id: "m1",
            role: "user",
            content: "帮我先搭一个课程大纲，主题是团队协作与高效沟通。",
            time: "10:30",
          },
          {
            id: "m2",
            role: "assistant",
            content: "可以，我们先从受众、场景和章节结构入手，再逐步展开。",
            time: "10:31",
          },
          {
            id: "m3",
            role: "user",
            content: "把 3.2 部分展开，增加案例和行动建议。",
            time: "10:32",
          },
        ],
      },
      {
        id: "session-content",
        title: "课程内容创作",
        updatedAt: "昨天",
        agentIds: ["writing_agent"],
        messages: [
          {
            id: "m4",
            role: "assistant",
            content: "我已经整理好了章节结构，可以继续写正文。",
            time: "昨天",
          },
        ],
      },
    ],
  },
  {
    id: "project-brand",
    name: "产品官网升级项目",
    icon: "🚀",
    sessions: [
      {
        id: "session-copy",
        title: "产品文案撰写",
        updatedAt: "09:15",
        agentIds: ["writing_agent", "browser_agent"],
        messages: [
          {
            id: "m5",
            role: "user",
            content: "主页需要更专业一点，强调多智能体协作价值。",
            time: "09:10",
          },
          {
            id: "m6",
            role: "assistant",
            content: "收到，我会从品牌表达、结构层次和行动引导三方面一起调整。",
            time: "09:15",
          },
        ],
      },
    ],
  },
  {
    id: "project-knowledge",
    name: "个人知识库构建",
    icon: "🧠",
    sessions: [],
  },
]);

const personalSessions = ref<SessionItem[]>([
  {
    id: "personal-seo",
    title: "SEO 优化方案",
    updatedAt: "5天前",
    agentIds: ["writing_agent", "research_agent"],
    messages: [
      {
        id: "m7",
        role: "user",
        content: "给我一个更偏内容策略的 SEO 优化方案。",
        time: "5天前",
      },
    ],
  },
  {
    id: "personal-notes",
    title: "读书笔记整理",
    updatedAt: "昨天",
    agentIds: ["research_agent"],
    messages: [
      {
        id: "m8",
        role: "assistant",
        content: "我已经先按主题和概念做了第一轮拆分。",
        time: "昨天",
      },
    ],
  },
]);

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
const executionExpanded = ref(true);
const activeWorkspaceTab = ref("工作区");
const sidebarCollapsed = ref(false);
const conversationCollapsed = ref(false);
const workspaceHidden = ref(false);
const workspaceFullscreen = ref(false);

const newSessionDialogVisible = ref(false);
const newProjectDialogVisible = ref(false);
const pendingAgentIds = ref<string[]>(["writing_agent"]);
const pendingSessionDescription = ref("");
const pendingSessionTitle = ref("新的创作会话");
const pendingSessionLocation = ref<"project" | "personal">("project");
const pendingProjectTargetId = ref<string>(projectSpaces.value[0]?.id || "");
const pendingProjectTitle = ref("");

const workspaceTabs = ["工作区", "执行过程", "知识图谱"];

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

function selectSession(projectId: string | undefined, sessionId: string) {
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

function sendMessage() {
  if (!draftMessage.value.trim() || !currentSession.value) return;

  currentSession.value.messages.push({
    id: `message-${Date.now()}`,
    role: "user",
    content: draftMessage.value.trim(),
    time: "刚刚",
  });

  currentSession.value.updatedAt = "刚刚";
  draftMessage.value = "";
}

function createSession() {
  if (!pendingSessionTitle.value.trim()) {
    ElMessage.warning("请先填写会话标题");
    return;
  }

  if (pendingAgentIds.value.length === 0) {
    ElMessage.warning("至少选择一个智能体");
    return;
  }

  const session: SessionItem = {
    id: `session-${Date.now()}`,
    title: pendingSessionTitle.value.trim(),
    description: pendingSessionDescription.value.trim(),
    updatedAt: "刚刚",
    agentIds: [...pendingAgentIds.value],
    messages: [
      {
        id: `message-${Date.now()}-welcome`,
        role: "assistant",
        content: "会话已创建，我们可以开始协作了。你可以直接描述目标，我来帮你拆解和推进。",
        time: "刚刚",
      },
    ],
  };

  if (pendingSessionLocation.value === "project") {
    const targetProject = projectSpaces.value.find(
      (project) => project.id === pendingProjectTargetId.value,
    );
    if (!targetProject) {
      ElMessage.warning("请选择项目空间");
      return;
    }
    targetProject.sessions.unshift(session);
    selectedProjectId.value = targetProject.id;
  } else {
    personalSessions.value.unshift(session);
    selectedProjectId.value = "";
  }

  selectedSessionId.value = session.id;
  selectedAgentId.value = session.agentIds[0];
  newSessionDialogVisible.value = false;
  pendingSessionTitle.value = "新的创作会话";
}

function createProject() {
  if (!pendingProjectTitle.value.trim()) {
    ElMessage.warning("请填写项目名称");
    return;
  }

  const project: ProjectSpace = {
    id: `project-${Date.now()}`,
    name: pendingProjectTitle.value.trim(),
    icon: "📁",
    sessions: [],
  };

  projectSpaces.value.unshift(project);
  selectedProjectId.value = project.id;
  selectedSessionId.value = "";
  pendingProjectTargetId.value = project.id;
  pendingProjectTitle.value = "";
  newProjectDialogVisible.value = false;
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
  await loadAgentProfiles();

  const preferredAgent = typeof route.query.agent === "string" ? route.query.agent : "";
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
  grid-template-rows: minmax(0, 1fr) auto;
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
