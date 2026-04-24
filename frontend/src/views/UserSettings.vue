<template>
  <div class="settings-page">
    <div class="page-header">
      <div>
        <h2>用户设置</h2>
        <p>维护默认时区、邮件通知和个人微信 ClawBot 配置。</p>
      </div>
      <div class="header-actions">
        <el-button @click="router.push('/agent-platform')">Agent Platform</el-button>
        <el-button @click="router.push('/chat')">返回聊天</el-button>
      </div>
    </div>

    <el-card shadow="never">
      <el-form label-position="top">
        <el-form-item label="默认时区">
          <el-input v-model="form.timezone" placeholder="例如 Asia/Shanghai" />
        </el-form-item>
        <el-form-item label="默认邮箱">
          <el-input v-model="form.notification_email" placeholder="用于任务结果通知" />
          <el-checkbox v-model="form.email_notifications_enabled">启用邮件通知</el-checkbox>
        </el-form-item>
        <el-form-item label="微信通道">
          <el-checkbox v-model="form.wechat_notifications_enabled">启用个人微信通知</el-checkbox>
        </el-form-item>
        <el-form-item label="ClawBot Base URL">
          <el-input v-model="form.wechat_config_json.base_url" placeholder="例如 http://127.0.0.1:9000" />
        </el-form-item>
        <el-form-item label="Conversation ID">
          <el-input v-model="form.wechat_config_json.conversation_id" placeholder="目标会话 ID" />
        </el-form-item>
        <el-form-item label="Token">
          <el-input v-model="form.wechat_config_json.token" placeholder="可选" />
        </el-form-item>
        <el-form-item label="发送接口">
          <el-input v-model="form.wechat_config_json.send_endpoint" placeholder="/message/send" />
        </el-form-item>
      </el-form>

      <div class="settings-actions">
        <el-button :loading="validatingEmail" @click="validateChannel('email')">校验邮件</el-button>
        <el-button :loading="validatingWechat" @click="validateChannel('wechat')">校验微信</el-button>
        <el-button type="primary" :loading="saving" @click="saveSettings">保存设置</el-button>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useRouter } from 'vue-router'
import { userSettingsApi, UserSettings } from '@/api/userSettings'

const router = useRouter()
const saving = ref(false)
const validatingEmail = ref(false)
const validatingWechat = ref(false)
const form = ref<UserSettings>({
  timezone: 'Asia/Shanghai',
  notification_email: '',
  email_notifications_enabled: false,
  wechat_notifications_enabled: false,
  wechat_channel_type: 'clawbot',
  wechat_config_json: {
    base_url: '',
    conversation_id: '',
    token: '',
    send_endpoint: '/message/send',
  },
  task_settings_json: {},
})

async function loadSettings() {
  try {
    const data = await userSettingsApi.getSettings()
    form.value = {
      ...form.value,
      ...data,
      wechat_config_json: {
        ...form.value.wechat_config_json,
        ...(data.wechat_config_json || {}),
      },
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.detail || '获取用户设置失败')
  }
}

async function saveSettings() {
  saving.value = true
  try {
    form.value = await userSettingsApi.updateSettings(form.value)
    ElMessage.success('设置已保存')
  } catch (error: any) {
    ElMessage.error(error.response?.data?.detail || '保存设置失败')
  } finally {
    saving.value = false
  }
}

async function validateChannel(channel: string) {
  const loadingRef = channel === 'email' ? validatingEmail : validatingWechat
  loadingRef.value = true
  try {
    const result = await userSettingsApi.validateChannel(channel, channel === 'wechat' ? form.value.wechat_config_json : undefined)
    if (result.valid) {
      ElMessage.success(result.message)
    } else {
      ElMessage.warning(result.message)
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.detail || '校验失败')
  } finally {
    loadingRef.value = false
  }
}

onMounted(() => {
  loadSettings()
})
</script>

<style scoped>
.settings-page {
  padding: 24px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
}

.header-actions {
  display: flex;
  gap: 10px;
}

.settings-actions {
  display: flex;
  gap: 12px;
}
</style>
