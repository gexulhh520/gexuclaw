# handoffNote 增强方案备忘录

## 背景

当前主 Agent 委派子 Agent 时，`handoffNote` 由主 Agent LLM 生成，但可能缺少历史上下文信息。需要增强 `handoffNote`，让子 Agent 能感知到 WorkContext 的历史执行记录和产物。

## 当前流程

```
用户请求
    ↓
主 Agent LLM 生成 handoffNote
    ↓
orchestration.service.ts 直接传递给子 Agent
    ↓
子 Agent 执行
```

## 问题

- 子 Agent 两次执行之间上下文不共享
- 主 Agent LLM 生成的 handoffNote 可能过于简单
- 子 Agent 无法自动感知 WorkContext 的历史信息

## 推荐方案

### 方案：在 orchestration.service.ts 中组装增强 handoffNote

在调用子 Agent 前，自动将 WorkContext 的历史信息组装到 handoffNote 中。

#### 组装内容

1. **recentRuns** - 最近执行记录（关键）
2. **recentArtifacts** - 最近产物（关键）
3. **runCount** - 执行次数（判断是否是修改请求）
4. **previousResults** - 本次链式执行的历史

#### 实现逻辑

```typescript
function buildEnhancedHandoffNote(
  originalHandoffNote: string,
  workContextDetail: WorkContextDetail,
  targetAgentId: string,
  previousResults: Array<{ agentId: string; result: string }>
): string {
  // 1. 过滤出同类型 Agent 的历史执行
  const sameAgentRuns = workContextDetail.recentRuns
    .filter(run => run.agentId === targetAgentId);
  
  // 2. 本次链式执行的历史
  const chainHistory = previousResults
    .map(r => `- ${r.agentId}: ${r.result.slice(0, 100)}...`)
    .join('\n');

  // 3. 最近产物
  const artifactsInfo = workContextDetail.recentArtifacts
    .map(art => `- [${art.artifactType}] ${art.title}`)
    .join('\n');

  // 4. 判断是否是修改请求（同Agent多次执行）
  const isModification = sameAgentRuns.length > 0;

  if (isModification) {
    return `[任务类型] 修改请求（${targetAgentId} 第${sameAgentRuns.length + 1}次执行）

[该Agent历史执行]
${sameAgentRuns.map(r => `- 第${sameAgentRuns.indexOf(r) + 1}次: ${r.resultSummary?.slice(0, 100)}`).join('\n')}

[本次链式执行历史]
${chainHistory || '无'}

[已有产物]
${artifactsInfo || '无'}

[本次任务]
${originalHandoffNote}`;
  }

  // 新任务或链式执行
  return `[任务类型] ${chainHistory ? '链式执行' : '新任务'}

${chainHistory ? `[前置执行]\n${chainHistory}\n` : ''}
[已有产物]
${artifactsInfo || '无'}

[本次任务]
${originalHandoffNote}`;
}
```

#### 使用位置

```typescript
// orchestration.service.ts
const run = await runtime.run({
  agentRecord: agent,
  versionRecord: version,
  userMessage,
  handoffNote: buildEnhancedHandoffNote(
    decision.handoffNote,
    workContextDetail,
    targetAgentId,
    previousResults
  ),
  sessionId,
  workContextId,
  mode: "subagent",
});
```

## 两种场景示例

### 场景1：修改请求（同 Agent 多次执行）

```
用户: "视频剪得不好，重新剪"

主 Agent → video_editor_agent（第二次）

组装后的 handoffNote:
---
[任务类型] 修改请求（video_editor_agent 第2次执行）

[该Agent历史执行]
- 第1次: 剪掉前10秒片头，添加滤镜，音量增加25%

[已有产物]
- [file] 剪辑完成的视频: /output/final_video.mp4

[本次任务]
请重新剪辑，剪掉20秒片头
```

### 场景2：链式执行（不同 Agent 协作）

```
用户: "访问百度并分析热搜"

主 Agent → browser_agent（第一次）
主 Agent → research_agent（第二次）

组装后的 handoffNote:
---
[任务类型] 链式执行

[前置执行]
- browser_agent: 已访问百度，获取页面HTML（约50KB）

[已有产物]
- [page] 百度首页快照: page_snapshot_001.html

[本次任务]
从页面中提取热搜榜单并分析
```

## 已完成的修改

### main-agent.ts

已更新 System Prompt，要求 LLM 生成结构化的 handoffNote：

```typescript
// buildSecondStepSystemPrompt 和 buildFollowUpSystemPrompt 中添加了：

## handoffNote 格式规范（重要）
当 action=delegate 时，handoffNote 必须包含以下结构化信息...

### 基础任务信息
- [任务类型] 新任务 / 修改请求 / 继续执行
- [任务描述] ...
- [预期输出] ...

### 历史上下文
- [历史执行] ...
- [已有产物] ...
- [用户反馈] ...

### 本次执行要求
- [具体步骤] ...
- [参数配置] ...
- [注意事项] ...
```

## 待实现

- [ ] 在 orchestration.service.ts 中实现 `buildEnhancedHandoffNote` 函数
- [ ] 在调用子 Agent 前组装增强版 handoffNote
- [ ] 测试修改请求场景
- [ ] 测试链式执行场景

## 相关文件

- `src/modules/orchestration/main-agent.ts` - 已修改 System Prompt
- `src/modules/orchestration/orchestration.service.ts` - 待实现组装逻辑
- `src/modules/orchestration/context-builder.ts` - WorkContextDetail 类型定义
