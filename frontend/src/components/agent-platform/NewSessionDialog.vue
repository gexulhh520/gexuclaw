<template>
  <el-dialog :model-value="modelValue" title="新建会话" width="760px" destroy-on-close @update:model-value="emit('update:modelValue', $event)">
    <div class="dialog-body session-dialog-body">
      <div class="dialog-intro">
        <div class="dialog-intro-title">选择本次会话要启用的智能体</div>
        <div class="dialog-intro-desc">
          你可以只选一个，也可以多选。后续主智能体可以根据已选智能体做协同调度。
        </div>
      </div>

      <div class="agent-choice-grid">
        <button
          v-for="agent in agents"
          :key="agent.id"
          class="agent-choice-card"
          @click="emit('toggle-agent', agent.id)"
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
          :value="pendingSessionTitle"
          class="dialog-input"
          placeholder="例如：课程大纲撰写"
          @input="emit('update:pendingSessionTitle', ($event.target as HTMLInputElement).value)"
        />
      </div>

      <div>
        <div class="dialog-label">保存位置</div>
        <div class="dialog-target-row">
          <button
            class="target-card"
            :class="{ active: pendingSessionLocation === 'project' }"
            @click="emit('update:pendingSessionLocation', 'project')"
          >
            <div class="target-title">项目空间</div>
            <div class="target-desc">归档到某个项目下，方便按项目继续协作。</div>
          </button>
          <button
            class="target-card"
            :class="{ active: pendingSessionLocation === 'personal' }"
            @click="emit('update:pendingSessionLocation', 'personal')"
          >
            <div class="target-title">我的会话</div>
            <div class="target-desc">不归属项目空间，直接作为个人会话保留。</div>
          </button>
        </div>
      </div>

      <div>
        <div class="dialog-label">协作描述</div>
        <textarea
          :value="pendingSessionDescription"
          class="dialog-textarea"
          placeholder="例如：研究 Agent 先查资料，写作 Agent 再成稿，主 Agent 最后汇总。"
          @input="emit('update:pendingSessionDescription', ($event.target as HTMLTextAreaElement).value)"
        />
      </div>

      <div v-if="pendingSessionLocation === 'project'">
        <div class="dialog-label">选择项目空间</div>
        <el-select
          :model-value="pendingProjectTargetId"
          class="dialog-select"
          popper-class="agent-dark-select-popper"
          placeholder="选择项目空间"
          @update:model-value="emit('update:pendingProjectTargetId', $event)"
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
        <button class="ghost-button" @click="emit('update:modelValue', false)">取消</button>
        <button class="primary-action compact" @click="emit('create-session')">创建会话</button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import type { AgentStatus, ProjectSpace, SidebarAgent } from "@/types/agent-platform";

defineProps<{
  agents: SidebarAgent[];
  modelValue: boolean;
  pendingAgentIds: string[];
  pendingProjectTargetId: string;
  pendingSessionDescription: string;
  pendingSessionLocation: "project" | "personal";
  pendingSessionTitle: string;
  projectSpaces: ProjectSpace[];
  statusLabelMap: Record<AgentStatus, string>;
}>();

const emit = defineEmits<{
  (e: "create-session"): void;
  (e: "toggle-agent", agentId: string): void;
  (e: "update:modelValue", value: boolean): void;
  (e: "update:pendingProjectTargetId", value: string): void;
  (e: "update:pendingSessionDescription", value: string): void;
  (e: "update:pendingSessionLocation", value: "project" | "personal"): void;
  (e: "update:pendingSessionTitle", value: string): void;
}>();
</script>

<style scoped>
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
  display: flex;
  align-items: center;
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

.ghost-button,
.primary-action {
  border: 0;
  cursor: pointer;
  font: inherit;
}

.ghost-button {
  height: 42px;
  padding: 0 16px;
  border-radius: 14px;
  color: #dbe6fb;
  background: rgba(29, 41, 64, 0.9);
  border: 1px solid rgba(113, 128, 150, 0.14);
}

.primary-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 48px;
  border-radius: 16px;
  font-weight: 600;
  color: #fff;
  background: linear-gradient(135deg, #5b6dff, #7c3aed);
  box-shadow: 0 16px 32px rgba(91, 109, 255, 0.28);
  transition: transform 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
}

.primary-action:hover {
  transform: translateY(-1px);
}

.primary-action.compact {
  height: 42px;
  min-width: 126px;
}

:deep(.dialog-select .el-select__wrapper) {
  min-height: 46px;
  border-radius: 16px;
  background: linear-gradient(180deg, rgba(250, 252, 255, 0.98), rgba(244, 247, 252, 0.98));
  box-shadow: inset 0 0 0 1px rgba(106, 124, 156, 0.14);
}
</style>
