<template>
  <el-card class="task-intent-card" shadow="never">
    <div class="task-intent-header">
      <span class="task-intent-title">{{ suggestion.draftId ? '已生成定时任务草案' : '检测到定时任务意图' }}</span>
      <el-tag size="small" :type="suggestion.draftId ? 'success' : 'warning'">
        {{ suggestion.draftId ? '草案就绪' : '待分析' }}
      </el-tag>
    </div>
    <div v-if="suggestion.draftTitle" class="task-intent-name">草案名称：{{ suggestion.draftTitle }}</div>
    <div class="task-intent-content">{{ suggestion.content }}</div>
    <div class="task-intent-intent">原始意图：{{ suggestion.intentText }}</div>
    <div class="task-intent-actions">
      <el-button type="primary" :loading="loading" @click="$emit('open-draft')">
        {{ suggestion.draftId ? '查看草案' : '开始分析' }}
      </el-button>
      <el-button @click="$emit('ignore')">忽略</el-button>
      <el-button text @click="$emit('open-settings')">通知设置</el-button>
    </div>
  </el-card>
</template>

<script setup lang="ts">
defineProps<{
  suggestion: {
    content: string
    intentText: string
    sourceMessageId?: number
    draftId?: number
    draftTitle?: string
    summaryMarkdown?: string
    analysisStatus?: string
  }
  loading?: boolean
}>()

defineEmits<{
  (e: 'open-draft'): void
  (e: 'ignore'): void
  (e: 'open-settings'): void
}>()
</script>

<style scoped>
.task-intent-card {
  margin: 12px 0;
  border: 1px solid #f3d19e;
  background: #fffaf3;
}

.task-intent-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.task-intent-title {
  font-weight: 600;
}

.task-intent-content,
.task-intent-intent,
.task-intent-name {
  color: #606266;
  line-height: 1.6;
}

.task-intent-name {
  font-weight: 500;
}

.task-intent-intent {
  margin-top: 6px;
  font-size: 13px;
}

.task-intent-actions {
  margin-top: 12px;
  display: flex;
  gap: 8px;
}
</style>
