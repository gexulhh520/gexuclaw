<template>
  <div class="scheduled-tasks-page">
    <div class="page-header">
      <div>
        <h2>我的任务</h2>
        <p>查看定时任务、执行记录和通知明细。</p>
      </div>
      <div class="page-actions">
        <el-select v-model="statusFilter" placeholder="筛选状态" clearable style="width: 160px;">
          <el-option label="全部" value="" />
          <el-option label="草案" value="draft" />
          <el-option label="启用中" value="active" />
          <el-option label="已暂停" value="paused" />
          <el-option label="分析中" value="analysis_running" />
        </el-select>
        <el-button @click="loadTasks">刷新</el-button>
        <el-button @click="router.push('/chat')">返回聊天</el-button>
      </div>
    </div>

    <el-empty v-if="!loading && tasks.length === 0" description="暂无定时任务" />

    <div v-else class="task-grid">
      <el-card v-for="task in tasks" :key="task.id" shadow="hover" class="task-card">
        <template #header>
          <div class="task-header">
            <span>{{ task.title }}</span>
            <el-tag :type="task.status === 'active' ? 'success' : task.status === 'paused' ? 'warning' : 'info'">
              {{ task.status }}
            </el-tag>
          </div>
        </template>
        <div class="task-meta">频率：{{ task.schedule_text }}</div>
        <div class="task-meta">时区：{{ task.timezone }}</div>
        <div class="task-meta">通知：{{ (task.delivery_channels || []).join('、') || '站内' }}</div>
        <div class="task-meta">失败次数：{{ task.failure_count }}</div>
        <div class="task-actions">
          <el-button size="small" @click="openTask(task)">详情</el-button>
          <el-button size="small" type="primary" @click="runNow(task)">立即执行</el-button>
          <el-button v-if="task.status === 'active'" size="small" type="warning" @click="pauseTask(task)">暂停</el-button>
          <el-button v-else size="small" type="success" @click="resumeTask(task)">恢复</el-button>
        </div>
      </el-card>
    </div>

    <el-drawer v-model="detailVisible" title="任务详情" size="720px">
      <template v-if="currentTask">
        <el-descriptions :column="1" border>
          <el-descriptions-item label="名称">{{ currentTask.title }}</el-descriptions-item>
          <el-descriptions-item label="描述">{{ currentTask.description || '暂无' }}</el-descriptions-item>
          <el-descriptions-item label="频率">{{ currentTask.schedule_text }}</el-descriptions-item>
          <el-descriptions-item label="Cron">{{ currentTask.cron_expression }}</el-descriptions-item>
          <el-descriptions-item label="时区">{{ currentTask.timezone }}</el-descriptions-item>
          <el-descriptions-item label="通知">{{ (currentTask.delivery_channels || []).join('、') }}</el-descriptions-item>
        </el-descriptions>

        <el-divider content-position="left">执行记录</el-divider>
        <el-timeline>
          <el-timeline-item v-for="run in taskRuns" :key="run.id" :timestamp="run.created_at" :type="run.status === 'success' ? 'success' : 'warning'">
            <div>{{ run.run_type }} / {{ run.status }}</div>
            <div class="task-meta">{{ run.result_summary || run.error_message || '无摘要' }}</div>
          </el-timeline-item>
        </el-timeline>

        <el-divider content-position="left">通知记录</el-divider>
        <el-table :data="taskNotifications" size="small">
          <el-table-column prop="channel" label="通道" />
          <el-table-column prop="status" label="状态" />
          <el-table-column prop="target" label="目标" />
          <el-table-column prop="error_message" label="错误信息" />
        </el-table>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useRouter } from 'vue-router'
import { scheduledTaskApi, ScheduledTaskResponse } from '@/api/scheduledTasks'

const router = useRouter()
const loading = ref(false)
const statusFilter = ref('')
const tasks = ref<ScheduledTaskResponse[]>([])
const detailVisible = ref(false)
const currentTask = ref<ScheduledTaskResponse | null>(null)
const taskRuns = ref<any[]>([])
const taskNotifications = ref<any[]>([])

async function loadTasks() {
  loading.value = true
  try {
    const response = await scheduledTaskApi.listTasks(statusFilter.value || undefined)
    tasks.value = response.tasks
  } catch (error: any) {
    ElMessage.error(error.response?.data?.detail || '获取任务列表失败')
  } finally {
    loading.value = false
  }
}

async function openTask(task: ScheduledTaskResponse) {
  currentTask.value = await scheduledTaskApi.getTask(task.id)
  detailVisible.value = true
  taskRuns.value = await scheduledTaskApi.listTaskRuns(task.id)
  taskNotifications.value = await scheduledTaskApi.listTaskNotifications(task.id)
}

async function runNow(task: ScheduledTaskResponse) {
  try {
    await scheduledTaskApi.runTaskNow(task.id)
    ElMessage.success('任务已投递执行')
    await loadTasks()
  } catch (error: any) {
    ElMessage.error(error.response?.data?.detail || '立即执行失败')
  }
}

async function pauseTask(task: ScheduledTaskResponse) {
  try {
    await scheduledTaskApi.pauseTask(task.id)
    ElMessage.success('任务已暂停')
    await loadTasks()
  } catch (error: any) {
    ElMessage.error(error.response?.data?.detail || '暂停失败')
  }
}

async function resumeTask(task: ScheduledTaskResponse) {
  try {
    await scheduledTaskApi.resumeTask(task.id)
    ElMessage.success('任务已恢复')
    await loadTasks()
  } catch (error: any) {
    ElMessage.error(error.response?.data?.detail || '恢复失败')
  }
}

watch(statusFilter, () => {
  loadTasks()
})

onMounted(() => {
  loadTasks()
})
</script>

<style scoped>
.scheduled-tasks-page {
  padding: 24px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
}

.page-actions {
  display: flex;
  gap: 10px;
}

.task-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.task-card {
  min-height: 220px;
}

.task-header,
.task-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.task-meta {
  color: #606266;
  margin-bottom: 8px;
}
</style>
