import { computed, ref, type Ref } from "vue";
import { ElMessage } from "element-plus";

import type { ProjectSpace, SessionCoordinationConfig, SessionItem } from "@/types/agent-platform";

type SessionLocation = "project" | "personal";

interface UseAgentPlatformSessionOptions {
  projectSpaces: Ref<ProjectSpace[]>;
  personalSessions: Ref<SessionItem[]>;
  getPrimaryAgentId: () => string | undefined;
  selectedAgentId: Ref<string>;
  defaultAgentId: string;
  defaultSessionTitle: string;
}

export function useAgentPlatformSession(options: UseAgentPlatformSessionOptions) {
  const {
    projectSpaces,
    personalSessions,
    getPrimaryAgentId,
    selectedAgentId,
    defaultAgentId,
    defaultSessionTitle,
  } = options;

  const selectedProjectId = ref<string>(projectSpaces.value[0]?.id || "");
  const selectedSessionId = ref<string>(projectSpaces.value[0]?.sessions[0]?.id || "");

  const newSessionDialogVisible = ref(false);
  const newProjectDialogVisible = ref(false);
  const pendingAgentIds = ref<string[]>([defaultAgentId]);
  const pendingSessionDescription = ref("");
  const pendingSessionTitle = ref(defaultSessionTitle);
  const pendingSessionLocation = ref<SessionLocation>("project");
  const pendingProjectTargetId = ref<string>(projectSpaces.value[0]?.id || "");
  const pendingProjectTitle = ref("");

  const selectedProject = computed(() =>
    projectSpaces.value.find((project) => project.id === selectedProjectId.value),
  );

  const currentSession = computed(() => {
    if (selectedProject.value) {
      return selectedProject.value.sessions.find((session) => session.id === selectedSessionId.value);
    }

    return personalSessions.value.find((session) => session.id === selectedSessionId.value);
  });

  function syncSelectedAgent(session: SessionItem | undefined) {
    if (session?.agentIds?.length) {
      selectedAgentId.value = session.agentIds[0];
    }
  }

  function selectProject(projectId: string) {
    selectedProjectId.value = projectId;

    const project = projectSpaces.value.find((item) => item.id === projectId);
    const latestSession = project?.sessions[0];

    if (latestSession) {
      selectedSessionId.value = latestSession.id;
      syncSelectedAgent(latestSession);
      return;
    }

    selectedSessionId.value = "";
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

    syncSelectedAgent(sourceSession);
  }

  function openNewSessionDialog() {
    newSessionDialogVisible.value = true;
    pendingSessionLocation.value = selectedProjectId.value ? "project" : "personal";
    pendingProjectTargetId.value = selectedProjectId.value || projectSpaces.value[0]?.id || "";
    pendingAgentIds.value = [getPrimaryAgentId() || defaultAgentId];
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

  function buildSessionCoordination(): SessionCoordinationConfig {
    return {
      mode: "auto",
      leadAgentId: null,
      allowOverlap: false,
      finalResponder: "main_agent",
      userNote: pendingSessionDescription.value.trim(),
    };
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
      coordination: buildSessionCoordination(),
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
    syncSelectedAgent(session);
    newSessionDialogVisible.value = false;
    pendingSessionTitle.value = defaultSessionTitle;
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

  return {
    currentSession,
    newProjectDialogVisible,
    newSessionDialogVisible,
    openNewSessionDialog,
    pendingAgentIds,
    pendingProjectTargetId,
    pendingProjectTitle,
    pendingSessionDescription,
    pendingSessionLocation,
    pendingSessionTitle,
    selectedProject,
    selectedProjectId,
    selectedSessionId,
    selectProject,
    selectSession,
    handleProjectSelect,
    togglePendingAgent,
    createSession,
    createProject,
  };
}
