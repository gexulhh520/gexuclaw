# 前端音频录制功能实现计划

## 需求分析

用户希望前端的音频上传支持两种方式：

1. **保留现有功能**：通过文件选择器上传音频文件
2. **新增功能**：直接录制音频文件（最长 60 秒）

同时需要：

* 支持音频预览（播放功能）

* 修复图片预览无法显示的问题

## 问题诊断

### 图片预览问题

**原因**：前端 vite 代理配置缺少 `/uploads` 路径

当前配置只代理了 `/api` 和 `/ws`，但图片 URL 是 `/uploads/images/...`，请求没有被代理到后端。

**解决方案**：在 `vite.config.ts` 中添加 `/uploads` 代理配置。

## 实现方案

### 1. 修复图片预览问题

修改 `frontend/vite.config.ts`，添加 `/uploads` 代理：

```typescript
proxy: {
  '/api': {
    target: 'http://127.0.0.1:8000',
    changeOrigin: true,
  },
  '/uploads': {
    target: 'http://127.0.0.1:8000',
    changeOrigin: true,
  },
  '/ws': {
    target: 'ws://127.0.0.1:8000',
    ws: true,
  },
}
```

### 2. 修改音频按钮为下拉菜单

将现有的单个音频上传按钮改为下拉菜单，包含两个选项：

* **上传音频文件**：保留现有的文件上传功能

* **录制音频**：新增录制功能（最长 60 秒）

### 3. 实现音频录制功能

使用 MediaRecorder API 实现音频录制：

* 点击"录制音频"开始录制

* 录制过程中显示录制状态和剩余时间

* 最长录制 60 秒，自动停止

* 再次点击可手动停止

* 录制完成后自动生成音频文件（webm 格式）

* 自动上传录制的音频文件

### 4. 添加预览功能

**图片预览**：

* 修复后正常显示图片缩略图

**音频预览**：

* 显示音频播放器

* 支持播放/暂停

* 显示音频时长

## 具体实现步骤

### 步骤 1：修复 vite.config.ts

添加 `/uploads` 代理配置。

### 步骤 2：修改 Chat.vue 模板部分

#### 2.1 修改预览区域，支持音频播放

```vue
<!-- 已上传文件预览 -->
<div v-if="uploadedFiles.length > 0" class="uploaded-preview">
  <div v-for="(file, index) in uploadedFiles" :key="index" class="preview-item">
    <!-- 图片预览 -->
    <img v-if="file.type === 'image'" :src="file.url" class="preview-image" />
    <!-- 音频预览 - 带播放器 -->
    <div v-else-if="file.type === 'audio'" class="preview-audio">
      <el-icon class="audio-icon"><Headset /></el-icon>
      <audio :src="file.url" controls class="audio-player"></audio>
    </div>
    <el-icon class="remove-btn" @click="removeFile(index)"><Close /></el-icon>
  </div>
</div>
```

#### 2.2 修改音频按钮为下拉菜单

```vue
<!-- 音频功能下拉菜单 -->
<el-dropdown @command="handleAudioCommand" :disabled="isLoading || isRecordingAudio">
  <el-button 
    :disabled="isLoading" 
    :type="isRecordingAudio ? 'danger' : 'default'"
    :class="isRecordingAudio ? 'recording-btn' : ''"
    circle 
    title="音频功能"
  >
    <el-icon><Headset /></el-icon>
  </el-button>
  <template #dropdown>
    <el-dropdown-menu>
      <el-dropdown-item command="upload" :disabled="isRecordingAudio">
        <el-icon><Upload /></el-icon>
        上传音频文件
      </el-dropdown-item>
      <el-dropdown-item command="record">
        <el-icon v-if="!isRecordingAudio"><Microphone /></el-icon>
        <el-icon v-else><VideoPause /></el-icon>
        {{ isRecordingAudio ? `停止录制 (${recordingTime}s/60s)` : '录制音频' }}
      </el-dropdown-item>
    </el-dropdown-menu>
  </template>
</el-dropdown>

<!-- 隐藏的文件上传输入 -->
<el-upload
  ref="audioUploadRef"
  :show-file-list="false"
  :before-upload="beforeAudioUpload"
  :http-request="handleAudioUpload"
  accept="audio/*"
  style="display: none;"
/>
```

### 步骤 3：添加录制相关状态和方法

```typescript
import { Upload, VideoPause } from '@element-plus/icons-vue'

// 录制相关状态
const isRecordingAudio = ref(false)
const recordingTime = ref(0)
const maxRecordingTime = 60  // 最大录制时长 60 秒
let mediaRecorder: MediaRecorder | null = null
let audioChunks: Blob[] = []
let recordingTimer: number | null = null
const audioUploadRef = ref()

// 处理音频下拉菜单命令
function handleAudioCommand(command: string) {
  if (command === 'upload') {
    audioUploadRef.value?.$el?.querySelector('input')?.click()
  } else if (command === 'record') {
    toggleAudioRecording()
  }
}

// 切换音频录制状态
async function toggleAudioRecording() {
  if (isRecordingAudio.value) {
    stopAudioRecording()
  } else {
    await startAudioRecording()
  }
}

// 开始录制音频
async function startAudioRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    
    const mimeType = MediaRecorder.isTypeSupported('audio/webm') 
      ? 'audio/webm' 
      : 'audio/mp4'
    
    mediaRecorder = new MediaRecorder(stream, { mimeType })
    audioChunks = []
    
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data)
      }
    }
    
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(track => track.stop())
      
      const audioBlob = new Blob(audioChunks, { type: mimeType })
      const ext = mimeType === 'audio/webm' ? 'webm' : 'm4a'
      const filename = `recording_${Date.now()}.${ext}`
      const audioFile = new File([audioBlob], filename, { type: mimeType })
      
      await uploadRecordedAudio(audioFile)
    }
    
    mediaRecorder.start()
    isRecordingAudio.value = true
    recordingTime.value = 0
    
    // 开始计时，60秒后自动停止
    recordingTimer = window.setInterval(() => {
      recordingTime.value++
      if (recordingTime.value >= maxRecordingTime) {
        stopAudioRecording()
        ElMessage.warning('已达到最大录制时长 60 秒')
      }
    }, 1000)
    
    ElMessage.success('开始录制音频...')
  } catch (error: any) {
    console.error('录制音频失败:', error)
    if (error.name === 'NotAllowedError') {
      ElMessage.error('请允许麦克风权限')
    } else {
      ElMessage.error('无法访问麦克风，请检查设备')
    }
  }
}

// 停止录制音频
function stopAudioRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop()
  }
  
  if (recordingTimer) {
    clearInterval(recordingTimer)
    recordingTimer = null
  }
  
  isRecordingAudio.value = false
}

// 上传录制的音频文件
async function uploadRecordedAudio(file: File) {
  const formData = new FormData()
  formData.append('file', file)
  
  try {
    const response = await httpClient.post('/upload/audio', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
    uploadedFiles.value.push({
      type: 'audio',
      path: response.data.path,
      url: response.data.url,
      filename: response.data.filename
    })
    ElMessage.success(`音频录制成功 (${recordingTime.value}秒)`)
    recordingTime.value = 0
  } catch (error: any) {
    ElMessage.error(error.response?.data?.detail || '音频上传失败')
  }
}
```

### 步骤 4：添加音频预览样式

```css
.preview-audio {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #f0f2f5;
  padding: 8px;
}

.audio-icon {
  font-size: 20px;
  color: #606266;
  margin-bottom: 4px;
}

.audio-player {
  width: 100%;
  height: 28px;
  font-size: 12px;
}

/* 隐藏音频播放器默认下载按钮 */
.audio-player::-webkit-media-controls-enclosure {
  display: flex;
}

.audio-player::-webkit-media-controls-download-button {
  display: none;
}
```

### 步骤 5：清理资源

```typescript
onUnmounted(() => {
  chatStore.disconnect()
  
  // 清理音频录制
  if (mediaRecorder && isRecordingAudio.value) {
    mediaRecorder.stop()
  }
  if (recordingTimer) {
    clearInterval(recordingTimer)
  }
})
```

## 文件修改清单

| 文件                            | 修改内容                                                        |
| ----------------------------- | ----------------------------------------------------------- |
| `frontend/vite.config.ts`     | 添加 `/uploads` 代理配置                                          |
| `frontend/src/views/Chat.vue` | 1. 添加下拉菜单组件2. 添加录制相关状态和方法3. 修改预览区域支持音频播放4. 添加录制和预览样式5. 清理资源 |

## 测试要点

1. **图片预览**：确保图片能正常显示
2. **文件上传功能**：确保原有的文件上传功能正常工作
3. **录制功能**：

   * 点击"录制音频"开始录制

   * 录制过程中显示时长（如 "15s/60s"）

   * 60 秒后自动停止

   * 手动点击可提前停止

   * 录制完成后自动上传
4. **音频预览**：

   * 上传/录制后显示音频播放器

   * 可以播放/暂停

   * 显示音频时长
5. **权限处理**：正确处理麦克风权限被拒绝的情况

