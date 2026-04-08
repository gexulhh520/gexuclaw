# 前端 Chat 多模态上传功能实现计划

## 目标
在前端 Chat 聊天界面实现图片和音频上传功能，上传后返回的路径随用户聊天内容一起发送。

---

## 当前状态分析

### Chat.vue 现有功能
- 文本输入框
- 语音输入按钮（使用浏览器 SpeechRecognition API）
- 发送按钮
- 消息显示区域

### 需要新增功能
1. 图片上传按钮 + 预览
2. 音频上传按钮 + 预览
3. 已上传文件列表管理
4. 发送消息时包含文件路径

---

## 实施方案

### 1. 修改 Chat.vue

#### 1.1 添加上传按钮（在输入框旁边）

```vue
<el-footer class="chat-input">
  <!-- 已上传文件预览 -->
  <div v-if="uploadedFiles.length > 0" class="uploaded-preview">
    <div v-for="(file, index) in uploadedFiles" :key="index" class="preview-item">
      <img v-if="file.type === 'image'" :src="file.url" />
      <audio v-else-if="file.type === 'audio'" :src="file.url" controls></audio>
      <el-icon class="remove-btn" @click="removeFile(index)"><Close /></el-icon>
    </div>
  </div>
  
  <el-input ... />
  
  <!-- 新增：图片上传按钮 -->
  <el-upload
    :show-file-list="false"
    :before-upload="beforeImageUpload"
    :http-request="handleImageUpload"
    accept="image/*"
  >
    <el-button :disabled="isLoading" circle>
      <el-icon><Picture /></el-icon>
    </el-button>
  </el-upload>
  
  <!-- 新增：音频上传按钮 -->
  <el-upload
    :show-file-list="false"
    :before-upload="beforeAudioUpload"
    :http-request="handleAudioUpload"
    accept="audio/*"
  >
    <el-button :disabled="isLoading" circle>
      <el-icon><Headset /></el-icon>
    </el-button>
  </el-upload>
  
  <el-button type="primary" @click="sendMessage" :loading="isLoading">
    发送
  </el-button>
</el-footer>
```

#### 1.2 新增状态和方法

```typescript
// 新增状态
const uploadedFiles = ref<Array<{ type: string; path: string; url: string }>>([])

// 上传图片
async function handleImageUpload(options: any) {
  const formData = new FormData()
  formData.append('file', options.file)
  
  try {
    const response = await httpClient.post('/upload/image', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
    uploadedFiles.value.push({
      type: 'image',
      path: response.data.path,
      url: response.data.url
    })
    ElMessage.success('图片上传成功')
  } catch (error) {
    ElMessage.error('图片上传失败')
  }
}

// 上传音频
async function handleAudioUpload(options: any) {
  const formData = new FormData()
  formData.append('file', options.file)
  
  try {
    const response = await httpClient.post('/upload/audio', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
    uploadedFiles.value.push({
      type: 'audio',
      path: response.data.path,
      url: response.data.url
    })
    ElMessage.success('音频上传成功')
  } catch (error) {
    ElMessage.error('音频上传失败')
  }
}

// 移除已上传文件
function removeFile(index: number) {
  uploadedFiles.value.splice(index, 1)
}

// 修改 sendMessage
async function sendMessage() {
  if ((!inputMessage.value.trim() && uploadedFiles.value.length === 0) || chatStore.isLoading) return
  
  const content = inputMessage.value
  const files = [...uploadedFiles.value]
  
  // 清空输入
  inputMessage.value = ''
  uploadedFiles.value = []
  
  // 构建多模态消息
  const multimodalContent = buildMultimodalContent(content, files)
  
  // 发送...
}

// 构建多模态消息内容
function buildMultimodalContent(text: string, files: Array<{ type: string; path: string }>) {
  const content = []
  
  if (text) {
    content.push({ type: 'text', content: text })
  }
  
  for (const file of files) {
    content.push({
      type: file.type,
      content: file.path
    })
  }
  
  return content
}
```

### 2. 修改 chat.ts (Store)

```typescript
// 修改 sendMessage 支持多模态
async function sendMessage(
  content: string | Array<{ type: string; content: string }>,
  msgProvider?: LLMProvider,
  msgModel?: string
) {
  // ...
  
  // 添加用户消息（支持多模态显示）
  messages.value.push({
    role: 'user',
    content: typeof content === 'string' ? content : formatMultimodalContent(content),
    timestamp: new Date().toISOString(),
  })
  
  // 发送到后端
  await api.sendMessage(sessionId.value, content, useProvider, useModel)
}
```

### 3. 修改 api/client.ts

```typescript
// 修改 sendMessage 支持多模态
async sendMessage(
  sessionId: string,
  content: string | Array<{ type: string; content: string }>,
  provider?: LLMProvider,
  model?: string
): Promise<{...}> {
  const response = await apiClient.post('/chat', {
    session_id: sessionId,
    content,  // 可以是字符串或数组
    provider,
    model,
  })
  return response.data
}
```

### 4. 修改后端 api/v1.py

```python
class MessageCreate(BaseModel):
    session_id: str
    content: Union[str, List[Dict[str, Any]]]  # 支持字符串或多模态数组
    provider: Optional[str] = "openai"
    model: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
```

---

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `frontend/src/views/Chat.vue` | 修改 | 添加上传按钮、预览、发送逻辑 |
| `frontend/src/stores/chat.ts` | 修改 | 支持多模态消息 |
| `frontend/src/api/client.ts` | 修改 | content 类型支持数组 |
| `backend/api/v1.py` | 修改 | MessageCreate 支持多模态 |

---

## UI 设计

### 输入区域布局
```
┌─────────────────────────────────────────────────────┐
│ [已上传预览区]                                        │
│ ┌─────┐ ┌─────┐ ┌─────────┐                         │
│ │ img │ │ img │ │ audio ▶ │  [x]                    │
│ └─────┘ └─────┘ └─────────┘                         │
├─────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────┐ │
│ │ 输入消息...                                      │ │
│ └─────────────────────────────────────────────────┘ │
│ [📷] [🎧] [🎤] [发送]                               │
└─────────────────────────────────────────────────────┘
```

---

## 实施步骤

1. **修改 Chat.vue** - 添加上传按钮和预览组件
2. **修改 chat.ts** - 支持多模态消息发送
3. **修改 api/client.ts** - content 类型支持数组
4. **修改 backend/api/v1.py** - MessageCreate 支持多模态
5. **测试验证** - 图片上传、音频上传、发送消息
