<template>
  <el-dialog
    :model-value="modelValue"
    title="新建 Agent"
    width="680px"
    destroy-on-close
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="dialog-body">
      <!-- Agent 名称 -->
      <div class="form-section">
        <div class="dialog-label">
          Agent 名称
          <span class="label-required">*</span>
        </div>
        <input
          v-model="form.agentName"
          class="dialog-input"
          placeholder="输入 Agent 名称，例如：文档助手"
          @blur="checkAgentNameDuplicate"
        />
        <div v-if="nameError" class="error-text">{{ nameError }}</div>
      </div>

      <!-- Agent 描述 -->
      <div class="form-section">
        <div class="dialog-label">Agent 描述</div>
        <input
          v-model="form.agentDescription"
          class="dialog-input"
          placeholder="简要描述该 Agent 的用途..."
        />
      </div>

      <!-- 能力标签 -->
      <div class="form-section">
        <div class="dialog-label">
          能力标签
          <span class="label-hint">（按回车添加）</span>
        </div>
        <div class="capability-input-wrapper">
          <input
            v-model="capabilityInput"
            class="dialog-input"
            placeholder="输入能力标签，例如：代码分析、文档生成..."
            @keydown.enter.prevent="addCapability"
          />
          <button class="capability-add-btn" @click="addCapability">+</button>
        </div>
        <div v-if="form.capabilities.length > 0" class="capability-tags">
          <span
            v-for="(cap, index) in form.capabilities"
            :key="index"
            class="capability-tag"
          >
            {{ cap }}
            <button class="capability-remove" @click="removeCapability(index)">×</button>
          </span>
        </div>
      </div>

      <!-- 模型配置 -->
      <div class="form-section">
        <div class="dialog-label">
          模型配置
          <span class="label-required">*</span>
        </div>
        <el-select
          v-model="form.modelProfileUid"
          class="dialog-select"
          popper-class="agent-dark-select-popper"
          placeholder="选择模型配置"
        >
          <el-option
            v-for="profile in modelProfiles"
            :key="profile.profileUid"
            :label="profile.name"
            :value="profile.profileUid"
          />
        </el-select>
      </div>

      <!-- 系统提示词 -->
      <div class="form-section">
        <div class="dialog-label">
          系统提示词
          <span class="label-required">*</span>
        </div>
        <textarea
          v-model="form.systemPrompt"
          class="dialog-textarea"
          placeholder="输入系统提示词，定义 Agent 的行为和角色..."
        />
      </div>

      <!-- 技能描述 -->
      <div class="form-section">
        <div class="dialog-label">技能描述</div>
        <textarea
          v-model="form.skillText"
          class="dialog-textarea"
          placeholder="描述该 Agent 具备的技能和能力..."
        />
      </div>

      <!-- 插件选择 -->
      <div class="form-section">
        <div class="dialog-label">
          允许使用的插件
          <span class="label-hint">（多选）</span>
        </div>
        <div v-if="pluginsLoading" class="plugins-loading">加载插件列表...</div>
        <div v-else-if="plugins.length === 0" class="plugins-empty">暂无可用插件</div>
        <div v-else class="plugin-choice-grid">
          <button
            v-for="plugin in plugins"
            :key="plugin.pluginId"
            class="plugin-choice-card"
            :class="{ active: form.allowedPluginIds.includes(plugin.pluginId), disabled: !plugin.enabled }"
            :disabled="!plugin.enabled"
            @click="togglePlugin(plugin.pluginId)"
          >
            <div class="plugin-choice-top">
              <div class="plugin-icon">{{ getPluginIcon(plugin.pluginType) }}</div>
              <div class="plugin-choice-check" :class="{ active: form.allowedPluginIds.includes(plugin.pluginId) }">
                ✓
              </div>
            </div>
            <div class="plugin-choice-name">{{ plugin.name }}</div>
            <div class="plugin-choice-desc">{{ plugin.description || '暂无描述' }}</div>
            <div class="plugin-choice-meta">
              <span class="plugin-badge" :class="plugin.providerType">{{ plugin.providerType }}</span>
              <span class="plugin-tools">{{ plugin.pluginType }}</span>
            </div>
          </button>
        </div>
      </div>

      <!-- 最大步数 -->
      <div class="form-section">
        <div class="dialog-label">最大执行步数</div>
        <input
          v-model.number="form.maxSteps"
          type="number"
          class="dialog-input"
          min="1"
          max="100"
          placeholder="例如：10"
        />
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <button class="ghost-button" @click="emit('update:modelValue', false)">取消</button>
        <button 
          class="primary-action compact" 
          :disabled="!isFormValid || isSubmitting" 
          @click="handleSubmit"
        >
          {{ isSubmitting ? '创建中...' : '创建' }}
        </button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import { ElMessage } from "element-plus";
import { agentPlatformApi, type ModelProfileRecord, type PluginRecord, type CreateAgentInput } from "@/api/agentPlatform";

const props = defineProps<{
  modelValue: boolean;
  existingAgents: { agentUid: string; name: string }[];
  modelProfiles: ModelProfileRecord[];
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: boolean): void;
  (e: "created", agent: { agentUid: string; name: string }): void;
}>();

const plugins = ref<PluginRecord[]>([]);
const pluginsLoading = ref(false);
const isSubmitting = ref(false);
const nameError = ref("");

const form = ref({
  agentName: "",
  agentDescription: "",
  capabilities: [] as string[],
  modelProfileUid: "",
  systemPrompt: "",
  skillText: "",
  allowedPluginIds: [] as string[],
  maxSteps: 10,
});

const capabilityInput = ref("");

const isFormValid = computed(() => {
  return (
    form.value.agentName.trim() &&
    !nameError.value &&
    form.value.modelProfileUid.trim() &&
    form.value.systemPrompt.trim()
  );
});

// 监听对话框打开状态，加载插件列表
watch(
  () => props.modelValue,
  (visible) => {
    if (visible) {
      loadPlugins();
      resetForm();
    }
  }
);

function resetForm() {
  form.value = {
    agentName: "",
    agentDescription: "",
    capabilities: [],
    modelProfileUid: "",
    systemPrompt: "",
    skillText: "",
    allowedPluginIds: [],
    maxSteps: 10,
  };
  capabilityInput.value = "";
  nameError.value = "";
}

function checkAgentNameDuplicate() {
  const name = form.value.agentName.trim();
  if (!name) {
    nameError.value = "";
    return;
  }
  
  const isDuplicate = props.existingAgents.some(
    (agent) => agent.name.toLowerCase() === name.toLowerCase()
  );
  
  if (isDuplicate) {
    nameError.value = "该 Agent 名称已存在";
  } else {
    nameError.value = "";
  }
}

async function loadPlugins() {
  pluginsLoading.value = true;
  try {
    // 使用 listPlugins 从数据库获取所有插件（包括外部插件）
    const pluginList = await agentPlatformApi.listPlugins();
    plugins.value = pluginList;
  } catch (error) {
    console.error("Failed to load plugins:", error);
    ElMessage.error("加载插件列表失败");
    plugins.value = [];
  } finally {
    pluginsLoading.value = false;
  }
}

function togglePlugin(pluginId: string) {
  const index = form.value.allowedPluginIds.indexOf(pluginId);
  if (index > -1) {
    form.value.allowedPluginIds = form.value.allowedPluginIds.filter((id) => id !== pluginId);
  } else {
    form.value.allowedPluginIds = [...form.value.allowedPluginIds, pluginId];
  }
}

function addCapability() {
  const value = capabilityInput.value.trim();
  if (!value) return;
  
  // 检查是否已存在
  if (form.value.capabilities.includes(value)) {
    ElMessage.warning("该能力标签已存在");
    return;
  }
  
  form.value.capabilities.push(value);
  capabilityInput.value = "";
}

function removeCapability(index: number) {
  form.value.capabilities.splice(index, 1);
}

function getPluginIcon(pluginType: string): string {
  const iconMap: Record<string, string> = {
    builtin: "🔌",
    external: "🧩",
  };
  return iconMap[pluginType] || "🔧";
}

async function handleSubmit() {
  if (!isFormValid.value) {
    ElMessage.warning("请填写必填项");
    return;
  }

  // 再次检查名称重复
  checkAgentNameDuplicate();
  if (nameError.value) {
    return;
  }

  isSubmitting.value = true;
  try {
    // 1. 先创建 Agent
    const createAgentInput: CreateAgentInput = {
      name: form.value.agentName.trim(),
      description: form.value.agentDescription.trim(),
      type: "custom",
      capabilities: form.value.capabilities,
      standaloneEnabled: true,
      subagentEnabled: false,
      uiMode: "generic",
    };

    const newAgent = await agentPlatformApi.createAgent(createAgentInput);
    
    // 2. 再创建 AgentVersion
    await agentPlatformApi.createAgentVersion(newAgent.agentUid, {
      modelProfileUid: form.value.modelProfileUid,
      systemPrompt: form.value.systemPrompt.trim(),
      skillText: form.value.skillText.trim(),
      allowedPluginIds: form.value.allowedPluginIds,
      maxSteps: form.value.maxSteps,
    });

    ElMessage.success("Agent 创建成功");
    emit("created", { agentUid: newAgent.agentUid, name: newAgent.name });
    emit("update:modelValue", false);
  } catch (error) {
    console.error("Failed to create Agent:", error);
    ElMessage.error("创建 Agent 失败");
  } finally {
    isSubmitting.value = false;
  }
}

onMounted(() => {
  if (props.modelValue) {
    loadPlugins();
  }
});
</script>

<style scoped>
.dialog-body {
  display: grid;
  gap: 16px;
  max-height: 60vh;
  overflow-y: auto;
  padding-right: 4px;
}

.form-section {
  display: grid;
  gap: 8px;
}

.dialog-label {
  color: #344054;
  font-size: 13px;
  font-weight: 600;
}

.label-hint {
  color: #8b9ab0;
  font-weight: 400;
  font-size: 12px;
  margin-left: 4px;
}

.label-required {
  color: #ef4444;
  margin-left: 4px;
}

.error-text {
  color: #ef4444;
  font-size: 12px;
  margin-top: 4px;
}

.dialog-select {
  width: 100%;
}

.dialog-input {
  width: 100%;
  height: 42px;
  padding: 0 12px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 12px;
  color: #0f172a;
  background: #fff;
  font: inherit;
  box-sizing: border-box;
}

.dialog-input:focus {
  outline: none;
  border-color: rgba(91, 109, 255, 0.5);
}

.dialog-textarea {
  width: 100%;
  min-height: 80px;
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

.dialog-textarea:focus {
  outline: none;
  border-color: rgba(91, 109, 255, 0.5);
}

.plugins-loading,
.plugins-empty {
  padding: 16px;
  text-align: center;
  color: #8b9ab0;
  font-size: 13px;
}

.plugin-choice-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.plugin-choice-card {
  padding: 12px;
  text-align: left;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 12px;
  background: #f8fafc;
  color: #10203b;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
  cursor: pointer;
}

.plugin-choice-card:hover:not(.disabled) {
  transform: translateY(-1px);
  border-color: rgba(91, 109, 255, 0.34);
  box-shadow: 0 10px 22px rgba(15, 23, 42, 0.08);
}

.plugin-choice-card.active {
  border-color: rgba(91, 109, 255, 0.5);
  background: linear-gradient(180deg, rgba(232, 239, 255, 0.98), rgba(243, 246, 255, 0.98));
}

.plugin-choice-card.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.plugin-choice-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.plugin-icon {
  font-size: 20px;
}

.plugin-choice-check {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  color: transparent;
  background: #fff;
  font-size: 12px;
}

.plugin-choice-check.active {
  border-color: transparent;
  background: linear-gradient(135deg, #5b6dff, #7c3aed);
  color: #fff;
}

.plugin-choice-name {
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
}

.plugin-choice-desc {
  margin-top: 4px;
  color: #607089;
  line-height: 1.4;
  font-size: 11px;
}

.plugin-choice-meta {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.plugin-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 500;
}

.plugin-badge.builtin_code {
  background: rgba(34, 197, 94, 0.1);
  color: #16a34a;
}

.plugin-badge.manifest {
  background: rgba(91, 109, 255, 0.1);
  color: #4f46e5;
}

.plugin-badge.mcp {
  background: rgba(249, 115, 22, 0.1);
  color: #ea580c;
}

.plugin-tools {
  color: #8b9ab0;
  font-size: 11px;
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

.primary-action:hover:not(:disabled) {
  transform: translateY(-1px);
}

.primary-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.primary-action.compact {
  height: 42px;
  min-width: 126px;
}

:deep(.dialog-select .el-select__wrapper) {
  min-height: 42px;
  border-radius: 12px;
  background: linear-gradient(180deg, rgba(250, 252, 255, 0.98), rgba(244, 247, 252, 0.98));
  box-shadow: inset 0 0 0 1px rgba(106, 124, 156, 0.14);
}

/* 能力标签样式 */
.capability-input-wrapper {
  display: flex;
  gap: 8px;
  align-items: center;
}

.capability-input-wrapper .dialog-input {
  flex: 1;
}

.capability-add-btn {
  width: 42px;
  height: 42px;
  border: 1px solid rgba(91, 109, 255, 0.5);
  border-radius: 12px;
  background: linear-gradient(135deg, #5b6dff, #7c3aed);
  color: #fff;
  font-size: 20px;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}

.capability-add-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 8px 16px rgba(91, 109, 255, 0.28);
}

.capability-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.capability-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 20px;
  background: linear-gradient(135deg, rgba(91, 109, 255, 0.1), rgba(124, 58, 237, 0.1));
  border: 1px solid rgba(91, 109, 255, 0.2);
  color: #4f46e5;
  font-size: 13px;
  font-weight: 500;
}

.capability-remove {
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 50%;
  background: rgba(91, 109, 255, 0.2);
  color: #4f46e5;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: background 0.18s ease, color 0.18s ease;
}

.capability-remove:hover {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}
</style>
