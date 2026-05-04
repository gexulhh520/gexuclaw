<template>
  <div class="plugin-manager-page">
    <header class="plugin-manager-header">
      <h2>插件管理</h2>
      <button class="primary-action" @click="openCreateDialog">
        <span>+</span>
        <span>新建插件</span>
      </button>
    </header>

    <div class="plugin-list-container">
      <el-table :data="plugins" v-loading="loading" style="width: 100%">
        <el-table-column prop="name" label="名称" min-width="150">
          <template #default="{ row }">
            <div class="plugin-name-cell">
              <span class="plugin-name">{{ row.name }}</span>
              <span class="plugin-id">{{ row.pluginId }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="pluginType" label="类型" width="100">
          <template #default="{ row }">
            <el-tag :type="row.pluginType === 'builtin' ? 'primary' : 'success'" size="small">
              {{ row.pluginType === 'builtin' ? '内置' : '外部' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="providerType" label="提供者" width="120">
          <template #default="{ row }">
            <el-tag :type="getProviderTagType(row.providerType)" size="small">
              {{ getProviderLabel(row.providerType) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="installed" label="已安装" width="80">
          <template #default="{ row }">
            <el-tag :type="row.installed ? 'success' : 'info'" size="small">
              {{ row.installed ? '是' : '否' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="enabled" label="已启用" width="80">
          <template #default="{ row }">
            <el-switch
              v-model="row.enabled"
              :disabled="row.pluginType === 'builtin'"
              @change="(val: boolean) => handleEnableChange(row, val)"
            />
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="getStatusTagType(row.status)" size="small">
              {{ getStatusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="lastError" label="错误信息" min-width="150">
          <template #default="{ row }">
            <span v-if="row.lastError" class="error-text">{{ row.lastError }}</span>
            <span v-else class="empty-text">-</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="viewPluginDetail(row)">
              详情
            </el-button>
            <el-button link type="primary" size="small" @click="reloadPlugin(row.pluginId)">
              刷新
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 创建插件对话框 -->
    <el-dialog v-model="createDialogVisible" title="新建插件" width="600px" destroy-on-close>
      <el-form :model="createForm" label-width="100px">
        <el-form-item label="插件ID" required>
          <el-input v-model="createForm.pluginId" placeholder="唯一标识，如 my-plugin" />
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="createForm.name" placeholder="插件显示名称" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="createForm.description" type="textarea" placeholder="插件功能描述" />
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="createForm.pluginType" placeholder="选择类型">
            <el-option label="外部插件" value="external" />
          </el-select>
        </el-form-item>
        <el-form-item label="提供者">
          <el-select v-model="createForm.providerType" placeholder="选择提供者类型">
            <el-option label="Manifest" value="manifest" />
            <el-option label="MCP" value="mcp" />
          </el-select>
        </el-form-item>
        <el-form-item label="版本">
          <el-input v-model="createForm.version" placeholder="1.0.0" />
        </el-form-item>
        <el-form-item label="Manifest">
          <el-input
            v-model="createForm.manifestJsonStr"
            type="textarea"
            :rows="6"
            placeholder="插件定义 JSON（tools/resources/prompts 等）"
          />
        </el-form-item>
        <el-form-item label="配置">
          <el-input
            v-model="createForm.configJsonStr"
            type="textarea"
            :rows="4"
            placeholder="插件运行配置 JSON"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="createDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="submitCreate">创建</el-button>
        </div>
      </template>
    </el-dialog>

    <!-- 插件详情对话框 -->
    <el-dialog v-model="detailDialogVisible" title="插件详情" width="700px" destroy-on-close>
      <div v-if="selectedPlugin" class="plugin-detail">
        <div class="detail-section">
          <div class="detail-label">基本信息</div>
          <div class="detail-grid">
            <div class="detail-item">
              <span class="item-label">ID:</span>
              <span class="item-value">{{ selectedPlugin.pluginId }}</span>
            </div>
            <div class="detail-item">
              <span class="item-label">名称:</span>
              <span class="item-value">{{ selectedPlugin.name }}</span>
            </div>
            <div class="detail-item">
              <span class="item-label">类型:</span>
              <span class="item-value">{{ selectedPlugin.pluginType }}</span>
            </div>
            <div class="detail-item">
              <span class="item-label">提供者:</span>
              <span class="item-value">{{ selectedPlugin.providerType }}</span>
            </div>
            <div class="detail-item">
              <span class="item-label">版本:</span>
              <span class="item-value">{{ selectedPlugin.version }}</span>
            </div>
            <div class="detail-item">
              <span class="item-label">状态:</span>
              <span class="item-value">
                <el-tag :type="getStatusTagType(selectedPlugin.status)" size="small">
                  {{ getStatusLabel(selectedPlugin.status) }}
                </el-tag>
              </span>
            </div>
          </div>
        </div>

        <div class="detail-section">
          <div class="detail-label">Manifest</div>
          <pre class="json-preview">{{ formatJson(selectedPlugin.manifestJson) }}</pre>
        </div>

        <div class="detail-section">
          <div class="detail-label">Config</div>
          <pre class="json-preview">{{ formatJson(selectedPlugin.configJson) }}</pre>
        </div>

        <div v-if="selectedPlugin.lastError" class="detail-section">
          <div class="detail-label">错误信息</div>
          <div class="error-box">{{ selectedPlugin.lastError }}</div>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { agentPlatformApi, type PluginRecord } from '@/api/agentPlatform'

const plugins = ref<PluginRecord[]>([])
const loading = ref(false)
const createDialogVisible = ref(false)
const detailDialogVisible = ref(false)
const selectedPlugin = ref<PluginRecord | null>(null)

const createForm = ref({
  pluginId: '',
  name: '',
  description: '',
  pluginType: 'external',
  providerType: 'manifest',
  version: '1.0.0',
  manifestJsonStr: '{}',
  configJsonStr: '{}',
})

function getProviderLabel(providerType: string): string {
  const map: Record<string, string> = {
    builtin_code: '内置代码',
    manifest: 'Manifest',
    mcp: 'MCP',
  }
  return map[providerType] || providerType
}

function getProviderTagType(providerType: string): string {
  const map: Record<string, string> = {
    builtin_code: 'primary',
    manifest: 'success',
    mcp: 'warning',
  }
  return map[providerType] || 'info'
}

function getStatusLabel(status: string): string {
  const map: Record<string, string> = {
    registered: '已注册',
    active: '激活',
    disabled: '已禁用',
    error: '错误',
    unavailable: '不可用',
  }
  return map[status] || status
}

function getStatusTagType(status: string): string {
  const map: Record<string, string> = {
    registered: 'info',
    active: 'success',
    disabled: 'warning',
    error: 'danger',
    unavailable: 'info',
  }
  return map[status] || 'info'
}

function formatJson(jsonStr: string): string {
  try {
    const obj = JSON.parse(jsonStr)
    return JSON.stringify(obj, null, 2)
  } catch {
    return jsonStr
  }
}

async function loadPlugins() {
  loading.value = true
  try {
    const data = await agentPlatformApi.listPlugins()
    plugins.value = data
  } catch (error) {
    ElMessage.error('加载插件列表失败')
    console.error('Failed to load plugins:', error)
  } finally {
    loading.value = false
  }
}

function openCreateDialog() {
  createForm.value = {
    pluginId: '',
    name: '',
    description: '',
    pluginType: 'external',
    providerType: 'manifest',
    version: '1.0.0',
    manifestJsonStr: '{}',
    configJsonStr: '{}',
  }
  createDialogVisible.value = true
}

async function submitCreate() {
  try {
    const manifestJson = JSON.parse(createForm.value.manifestJsonStr)
    const configJson = JSON.parse(createForm.value.configJsonStr)

    await agentPlatformApi.createPlugin({
      pluginId: createForm.value.pluginId,
      name: createForm.value.name,
      description: createForm.value.description,
      pluginType: createForm.value.pluginType,
      providerType: createForm.value.providerType,
      version: createForm.value.version,
      manifestJson,
      configJson,
    })

    ElMessage.success('插件创建成功')
    createDialogVisible.value = false
    await loadPlugins()
  } catch (error) {
    if (error instanceof SyntaxError) {
      ElMessage.error('JSON 格式错误，请检查 Manifest 或 Config')
    } else {
      ElMessage.error('创建插件失败')
    }
    console.error('Failed to create plugin:', error)
  }
}

function viewPluginDetail(plugin: PluginRecord) {
  selectedPlugin.value = plugin
  detailDialogVisible.value = true
}

async function handleEnableChange(plugin: PluginRecord, enabled: boolean) {
  try {
    if (enabled) {
      await agentPlatformApi.enablePlugin(plugin.pluginId)
      ElMessage.success('插件已启用')
    } else {
      await agentPlatformApi.disablePlugin(plugin.pluginId)
      ElMessage.success('插件已禁用')
    }
    await loadPlugins()
  } catch (error) {
    ElMessage.error('操作失败')
    console.error('Failed to toggle plugin:', error)
    plugin.enabled = !enabled
  }
}

async function reloadPlugin(pluginId: string) {
  try {
    await agentPlatformApi.reloadPlugin(pluginId)
    ElMessage.success('插件已重新加载')
    await loadPlugins()
  } catch (error) {
    ElMessage.error('重新加载失败')
    console.error('Failed to reload plugin:', error)
  }
}

onMounted(() => {
  loadPlugins()
})
</script>

<style scoped>
.plugin-manager-page {
  padding: 24px;
  max-width: 1400px;
  margin: 0 auto;
}

.plugin-manager-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.plugin-manager-header h2 {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
}

.plugin-list-container {
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
}

.plugin-name-cell {
  display: flex;
  flex-direction: column;
}

.plugin-name {
  font-weight: 500;
  color: #303133;
}

.plugin-id {
  font-size: 12px;
  color: #909399;
  margin-top: 2px;
}

.error-text {
  color: #f56c6c;
  font-size: 13px;
}

.empty-text {
  color: #909399;
}

.plugin-detail {
  max-height: 600px;
  overflow-y: auto;
}

.detail-section {
  margin-bottom: 20px;
}

.detail-label {
  font-weight: 600;
  color: #303133;
  margin-bottom: 12px;
  font-size: 16px;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.detail-item {
  display: flex;
  gap: 8px;
}

.item-label {
  color: #606266;
  font-weight: 500;
  min-width: 60px;
}

.item-value {
  color: #303133;
}

.json-preview {
  background: #f5f7fa;
  padding: 12px;
  border-radius: 4px;
  font-family: 'Courier New', monospace;
  font-size: 13px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

.error-box {
  background: #fef0f0;
  border: 1px solid #fde2e2;
  color: #f56c6c;
  padding: 12px;
  border-radius: 4px;
  font-size: 13px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
</style>
