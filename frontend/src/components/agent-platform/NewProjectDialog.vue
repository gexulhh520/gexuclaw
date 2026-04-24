<template>
  <el-dialog :model-value="modelValue" title="新建项目" width="520px" destroy-on-close @update:model-value="emit('update:modelValue', $event)">
    <div class="dialog-body">
      <div>
        <div class="dialog-label">项目名称</div>
        <input
          :value="pendingProjectTitle"
          class="dialog-input"
          placeholder="例如：教育内容创作项目"
          @input="emit('update:pendingProjectTitle', ($event.target as HTMLInputElement).value)"
        />
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <button class="ghost-button" @click="emit('update:modelValue', false)">取消</button>
        <button class="primary-action compact" @click="emit('create-project')">创建项目</button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
const emit = defineEmits<{
  (e: "create-project"): void;
  (e: "update:modelValue", value: boolean): void;
  (e: "update:pendingProjectTitle", value: string): void;
}>();

defineProps<{
  modelValue: boolean;
  pendingProjectTitle: string;
}>();
</script>

<style scoped>
.dialog-body {
  display: grid;
  gap: 12px;
}

.dialog-label {
  color: #344054;
  font-size: 13px;
  font-weight: 600;
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
</style>
