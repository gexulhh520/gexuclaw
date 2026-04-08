# 修复音频录制无法手动停止的问题

## 问题分析

**根本原因**：下拉菜单在录制时被禁用了

```vue
<el-dropdown @command="handleAudioCommand" :disabled="isLoading || isRecordingAudio">
```

当 `isRecordingAudio` 为 `true` 时，整个下拉菜单被禁用，导致用户无法点击"停止录制"选项。

## 解决方案

**方案**：录制时，按钮直接变成"停止录制"按钮，点击即可停止录制，不需要展开下拉菜单。

这样用户体验更好：
- 非录制状态：点击展开下拉菜单，选择"上传音频文件"或"录制音频"
- 录制状态：按钮直接显示录制时长，点击即可停止录制

## 实现步骤

### 修改模板部分

将音频功能按钮改为条件渲染：

```vue
<!-- 录制中状态：显示停止按钮 -->
<el-button 
  v-if="isRecordingAudio"
  type="danger"
  class="recording-btn"
  @click="stopAudioRecording"
  circle 
  title="停止录制"
>
  <el-icon><VideoPause /></el-icon>
  <span class="recording-time">{{ recordingTime }}s</span>
</el-button>

<!-- 非录制状态：显示下拉菜单 -->
<el-dropdown v-else @command="handleAudioCommand" :disabled="isLoading">
  <el-button 
    :disabled="isLoading" 
    circle 
    title="音频功能"
  >
    <el-icon><Headset /></el-icon>
  </el-button>
  <template #dropdown>
    <el-dropdown-menu>
      <el-dropdown-item command="upload">
        <el-icon><Upload /></el-icon>
        上传音频文件
      </el-dropdown-item>
      <el-dropdown-item command="record">
        <el-icon><Microphone /></el-icon>
        录制音频
      </el-dropdown-item>
    </el-dropdown-menu>
  </template>
</el-dropdown>
```

### 添加录制时长样式

```css
.recording-time {
  font-size: 12px;
  margin-left: 4px;
}
```

## 文件修改清单

| 文件 | 修改内容 |
|------|----------|
| `frontend/src/views/Chat.vue` | 1. 条件渲染录制按钮和下拉菜单<br>2. 添加录制时长显示样式 |
