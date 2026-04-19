<template>
  <el-dialog :model-value="modelValue" title="确认定时任务" width="880px" @close="$emit('update:modelValue', false)">
    <div v-if="draft" class="task-confirm-layout">
      <div class="task-confirm-left">
        <el-card shadow="never">
          <template #header>评估摘要</template>
          <div class="summary-markdown" v-html="formattedSummary"></div>
        </el-card>
        <el-card shadow="never" class="task-card-spacer">
          <template #header>执行步骤</template>
          <el-timeline>
            <el-timeline-item
              v-for="step in draft.content.execution_steps || []"
              :key="step.step_index"
              :timestamp="step.tool_name || 'planner'"
            >
              <div>{{ step.title }}</div>
              <div class="task-step-desc">{{ step.action }}</div>
            </el-timeline-item>
          </el-timeline>
        </el-card>
      </div>

      <div class="task-confirm-right">
        <el-form label-position="top">
          <el-form-item label="任务名称">
            <el-input :model-value="form.title" @update:model-value="updateField('title', $event)" />
          </el-form-item>
          <el-form-item label="任务描述">
            <el-input
              type="textarea"
              :rows="3"
              :model-value="form.description"
              @update:model-value="updateField('description', $event)"
            />
          </el-form-item>
          <el-form-item label="执行频率">
            <el-input :model-value="form.schedule_text" @update:model-value="updateField('schedule_text', $event)" />
          </el-form-item>
          <el-form-item label="Cron">
            <el-input :model-value="form.cron_expression" disabled />
          </el-form-item>
          <el-form-item label="时区">
            <el-input :model-value="form.timezone" @update:model-value="updateField('timezone', $event)" />
          </el-form-item>
          <el-form-item label="通知方式">
            <el-checkbox-group :model-value="form.delivery_channels" @change="updateField('delivery_channels', $event)">
              <el-checkbox label="in_app">站内</el-checkbox>
              <el-checkbox label="email">邮件</el-checkbox>
              <el-checkbox label="wechat">微信</el-checkbox>
            </el-checkbox-group>
          </el-form-item>
        </el-form>

        <el-alert
          v-if="preview"
          :title="preview.message || (preview.success ? '预检查通过' : '预检查未通过')"
          :type="preview.success ? 'success' : 'warning'"
          :closable="false"
          show-icon
        />

        <el-card v-if="preview" shadow="never" class="task-card-spacer">
          <template #header>预检查结果</template>
          <div class="preview-section">
            <div><strong>检查项：</strong>{{ (preview.checks || []).join('；') || '无' }}</div>
            <div><strong>警告：</strong>{{ (preview.warnings || []).join('；') || '无' }}</div>
            <div><strong>阻塞项：</strong>{{ (preview.blockers || []).join('；') || '无' }}</div>
            <div><strong>建议：</strong>{{ (preview.suggested_fixes || []).join('；') || '无' }}</div>
          </div>
        </el-card>
      </div>
    </div>

    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">取消</el-button>
      <el-button type="warning" :loading="previewLoading" @click="$emit('preview')">预览执行</el-button>
      <el-button type="primary" :loading="submitLoading" :disabled="!!(preview && preview.blockers?.length)" @click="$emit('confirm')">
        确认创建
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  modelValue: boolean
  draft: any | null
  form: Record<string, any>
  preview: any | null
  previewLoading?: boolean
  submitLoading?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'preview'): void
  (e: 'confirm'): void
  (e: 'update:form', value: Record<string, any>): void
}>()

const formattedSummary = computed(() => {
  const raw = props.draft?.summary_markdown || ''
  return raw
    .replace(/\n/g, '<br />')
    .replace(/###\s(.+)/g, '<h3>$1</h3>')
    .replace(/####\s(.+)/g, '<h4>$1</h4>')
    .replace(/- /g, '&bull; ')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
})

function updateField(key: string, value: any) {
  emit('update:form', {
    ...props.form,
    [key]: value,
  })
}
</script>

<style scoped>
.task-confirm-layout {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 16px;
}

.task-card-spacer {
  margin-top: 16px;
}

.task-step-desc,
.preview-section {
  color: #606266;
  line-height: 1.7;
}

.summary-markdown :deep(h3),
.summary-markdown :deep(h4) {
  margin: 8px 0;
}
</style>
