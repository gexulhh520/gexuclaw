<template>
  <div class="workspace-entry">
    <section class="entry-hero">
      <div class="entry-copy">
        <div class="eyebrow">AI Agent OS</div>
        <h1>让用户一进来就能找到智能体，直接开始工作。</h1>
        <p>
          当前桌面已经切到多智能体操作系统的方向。左侧管理项目与会话，中间围绕对话协作，
          右侧直接进入写作工作区。这里保留为平台首页，用来进入主工作桌面和后续其他模块。
        </p>
        <div class="entry-actions">
          <el-button type="primary" size="large" @click="router.push('/agent-platform')">
            进入智能体桌面
          </el-button>
          <el-button size="large" @click="router.push('/tasks')">
            查看定时任务
          </el-button>
        </div>
      </div>

      <div class="entry-preview">
        <div class="preview-badge">桌面工作流</div>
        <div class="preview-title">三栏式 AI 多智能体操作系统</div>
        <ul>
          <li>项目空间、会话树、智能体状态统一放在左侧</li>
          <li>中间用对话协作推进任务，保留执行摘要与步骤折叠</li>
          <li>右侧直接进入文档工作区、版本、建议和批注</li>
        </ul>
      </div>
    </section>

    <section class="entry-grid">
      <button class="entry-card primary" @click="router.push('/agent-platform')">
        <div class="card-kicker">主工作桌面</div>
        <div class="card-title">文档写作 Agent OS</div>
        <p>未来感深色三栏布局，适合直接演示多智能体写作场景。</p>
        <span>立即进入</span>
      </button>

      <button class="entry-card" @click="router.push('/tasks')">
        <div class="card-kicker">辅助模块</div>
        <div class="card-title">定时任务</div>
        <p>查看已有计划任务和执行记录，先保持独立入口。</p>
        <span>打开模块</span>
      </button>

      <button class="entry-card" @click="router.push('/settings')">
        <div class="card-kicker">辅助模块</div>
        <div class="card-title">用户设置</div>
        <p>时区、通知与个人偏好继续放在第二层，不打扰主工作流。</p>
        <span>打开模块</span>
      </button>
    </section>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()
</script>

<style scoped>
.workspace-entry {
  min-height: 100vh;
  padding: 28px;
  background: linear-gradient(180deg, #0a0f17 0%, #0c1220 100%);
  color: #f8fbff;
}

.entry-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) 360px;
  gap: 18px;
  margin-bottom: 18px;
}

.entry-copy,
.entry-preview,
.entry-card {
  border: 1px solid rgba(114, 128, 150, 0.14);
  border-radius: 18px;
  background: #0f1622;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.24);
}

.entry-copy {
  padding: 28px;
}

.eyebrow,
.card-kicker,
.preview-badge {
  font-size: 12px;
  color: #8ea0bd;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.entry-copy h1 {
  max-width: 760px;
  margin: 12px 0 16px;
  font-size: 44px;
  line-height: 1.08;
}

.entry-copy p,
.entry-card p,
.entry-preview li {
  color: #98a8c0;
  line-height: 1.75;
}

.entry-actions {
  display: flex;
  gap: 12px;
  margin-top: 24px;
}

.entry-preview {
  padding: 24px;
}

.preview-title {
  margin: 16px 0 14px;
  font-size: 26px;
  font-weight: 700;
}

.entry-preview ul {
  margin: 0;
  padding-left: 18px;
}

.entry-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.entry-card {
  padding: 22px;
  text-align: left;
  cursor: pointer;
  color: inherit;
  transition: transform 0.18s ease, border-color 0.18s ease;
}

.entry-card:hover {
  transform: translateY(-2px);
  border-color: rgba(91, 109, 255, 0.42);
}

.entry-card.primary {
  background: linear-gradient(135deg, rgba(91, 109, 255, 0.18), rgba(15, 22, 34, 0.96));
}

.card-title {
  margin: 12px 0 10px;
  font-size: 24px;
  font-weight: 700;
}

.entry-card span {
  display: inline-flex;
  align-items: center;
  margin-top: 16px;
  color: #c8d5ea;
}

@media (max-width: 1280px) {
  .entry-hero,
  .entry-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .workspace-entry {
    padding: 18px;
  }

  .entry-copy h1 {
    font-size: 34px;
  }

  .entry-actions {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
