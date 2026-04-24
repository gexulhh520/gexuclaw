<template>
  <aside class="sidebar-shell" :class="{ collapsed }">
    <div class="brand-card panel-card">
      <div class="brand-mark">AI</div>
      <div>
        <div class="brand-title">AI Agent OS</div>
        <div class="brand-subtitle">多智能体协作操作系统</div>
      </div>
    </div>

    <div class="sidebar-actions">
      <button class="primary-action" @click="$emit('open-session')">
        <span>+</span>
        <span>新建会话</span>
      </button>
      <button class="secondary-action" @click="$emit('open-project')">
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
            @click="$emit('select-project', project.id)"
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
                @click.stop="$emit('select-session', project.id, session.id)"
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
            @click="$emit('select-session', undefined, session.id)"
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
</template>

<script setup lang="ts">
import type { ProjectSpace, SessionItem } from "@/types/agent-platform";

defineProps<{
  collapsed: boolean;
  personalSessions: SessionItem[];
  projectSpaces: ProjectSpace[];
  selectedProjectId: string;
  selectedSessionId: string;
}>();

defineEmits<{
  (e: "open-project"): void;
  (e: "open-session"): void;
  (e: "select-project", projectId: string): void;
  (e: "select-session", projectId: string | undefined, sessionId: string): void;
}>();
</script>

<style scoped>
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

.sidebar-shell {
  min-height: 0;
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
.secondary-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 48px;
  border: 0;
  border-radius: 16px;
  cursor: pointer;
  font: inherit;
  font-weight: 600;
  transition: transform 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
}

.primary-action {
  color: #fff;
  background: linear-gradient(135deg, #5b6dff, #7c3aed);
  box-shadow: 0 16px 32px rgba(91, 109, 255, 0.28);
}

.secondary-action {
  color: #d6def1;
  background: rgba(25, 37, 58, 0.84);
  border: 1px solid rgba(113, 128, 150, 0.14);
}

.primary-action:hover,
.secondary-action:hover {
  transform: translateY(-1px);
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

.project-card-top,
.project-title-row,
.profile-card {
  display: flex;
  align-items: center;
}

.project-card-top,
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
</style>
