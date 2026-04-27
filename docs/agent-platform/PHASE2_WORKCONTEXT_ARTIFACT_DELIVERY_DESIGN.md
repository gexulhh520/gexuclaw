# Phase 2 落地设计：WorkContext、Artifact 与右侧工作台

## 1. 文档目标

本文档基于当前仓库里的已有实现，明确下一阶段如何把 `WorkContext & Artifact` 从“已有表和 API”推进到“真实可用的前端工作台”。

本文档重点回答四个问题：

1. 当前已经实现了什么，哪些地方还是过渡态。
2. `WorkContext / Run / Artifact` 在产品和实现上的边界是什么。
3. 前端界面应该如何调整，尤其是右侧工作台如何收敛成真实工作面。
4. 后端、前端、状态流和验收标准分别如何分阶段落地。

本文档不覆盖：

- Scoped Memory
- ProjectContext 升级
- Artifact Version
- 并行多 Agent 高级编排
- 知识图谱可视化

这些都不是当前阶段的主路径。

## 2. 当前实现盘点

### 2.1 后端已具备的基础

当前 `agent-platform-node` 已经具备以下基础对象和接口：

- `projects`
- `sessions`
- `work_contexts`
- `agent_artifacts`
- `agent_runs`
- `agent_run_steps`
- `orchestration/chat`
- `runs/:runId/stream` SSE

相关实现位置：

- [agent-platform-node/src/db/schema.ts](D:/戈旭接的项目/gexuclaw/agent-platform-node/src/db/schema.ts)
- [agent-platform-node/src/modules/work-contexts/work-context.service.ts](D:/戈旭接的项目/gexuclaw/agent-platform-node/src/modules/work-contexts/work-context.service.ts)
- [agent-platform-node/src/modules/orchestration/orchestration.service.ts](D:/戈旭接的项目/gexuclaw/agent-platform-node/src/modules/orchestration/orchestration.service.ts)
- [agent-platform-node/src/modules/runs/run.routes.ts](D:/戈旭接的项目/gexuclaw/agent-platform-node/src/modules/runs/run.routes.ts)

当前已经确认的关键事实：

- `chat` 接口是“立即返回 + 异步执行”模型。
- 前端不能等待 `chat` 首包拿到最终 `message / artifacts / workContextId`。
- 正确主链路是：`chat -> runId -> SSE -> run 完成 -> 刷新 workContexts / runs / artifacts`。

### 2.2 前端已具备的基础

当前前端主页面已经做了第一轮过渡接入：

- 左侧：项目 / 会话导航
- 中间：聊天消息、run 摘要、SSE 订阅
- 右侧：已经有 `workspaceTabs = ["上下文", "产物", "执行过程"]`
- 已有 `selectedWorkContext / selectedArtifact / selectedRun / selectedRunSteps`
- 已有 `listWorkContexts / listArtifacts / listRuns / listRunSteps` 的调用点

相关实现位置：

- [frontend/src/views/AgentPlatform.vue](D:/戈旭接的项目/gexuclaw/frontend/src/views/AgentPlatform.vue)
- [frontend/src/api/agentPlatform.ts](D:/戈旭接的项目/gexuclaw/frontend/src/api/agentPlatform.ts)

### 2.3 当前主要问题

虽然对象和接口已经在，但当前页面仍然是“过渡态”：

1. 右侧工作台仍残留明显的说明页思路，真实工作对象感不够稳定。
2. WorkContext 的字段语义还不够完整，很多进度信息仍散落在 `metadataJson`。
3. Artifact 只有最小字段，缺少 `artifactRole` 和来源血缘字段。
4. 前端状态逻辑大部分写在一个大页面里，虽能跑，但不利于 Phase 2 持续迭代。
5. `chat` 首包返回的 `workContextId` 不可靠，前端必须以 run 完成后的重选逻辑为准。

## 3. 核心对象边界

### 3.1 WorkContext

一句话定义：

**WorkContext 是用户当前正在推进的一件工作。**

它负责承接：

- 当前工作标题
- 当前目标
- 当前状态
- 当前阶段
- 进度摘要
- 下一步动作
- 最近一次运行
- 最近一个产物

它不是聊天全文，也不是完整日志。

### 3.2 Run

一句话定义：

**Run 是某个 Agent 为推进这件工作而发生的一次执行轮次。**

它负责承接：

- 谁执行了
- 在什么上下文下执行
- 输入了什么
- 结果如何
- 具体步骤是什么

Run 是过程记录，不是结果容器。

### 3.3 Artifact

一句话定义：

**Artifact 是一次工作过程中，被系统显式保存下来、可被后续继续读取和复用的产物对象。**

它负责承接：

- 文本
- 结构化结果
- 页面对象
- 图片
- 链接
- 文件
- 结果集合

Artifact 不是聊天消息，不是运行步骤，也不是临时模型输出。

## 4. Artifact 设计约束

### 4.1 `artifactType`

`artifactType` 解决对象形态，第一阶段统一使用受控枚举：

- `text`
- `structured_data`
- `page`
- `image`
- `link`
- `file`
- `collection`

### 4.2 `artifactRole`

`artifactRole` 解决业务语义，必须提前定义成固定枚举，不允许各个子 Agent 自由发明。

第一阶段建议枚举：

- `input`
- `reference`
- `intermediate`
- `draft`
- `final`
- `output`

### 4.3 判定原则

判定优先级：

1. 工具层显式知道类型时，由工具层写入。
2. 子 Agent 可声明 `artifactRole`，但必须落在平台允许的枚举里。
3. 平台在落库前做兜底归类。

约束：

- `artifactType` 尽量由工具和平台规则先判。
- `artifactRole` 可由 Agent 声明，但平台必须校验。
- 同一内容的 `role` 可以变化，`type` 一般更稳定。

## 5. 右侧工作台的目标形态

根据当前页面和本阶段目标，页面三栏分工保持不变：

- 左侧：导航
- 中间：会话与执行中的交流
- 右侧：当前 WorkContext 的工作面

这里明确约束：

- `WorkContext` 放在右侧，不放到左侧导航树。
- `Artifact` 放在右侧，不放到中间聊天流里承担主展示。
- 中间区保留聊天和 run 摘要，不承担完整工作对象管理。

### 5.1 左侧职责

左侧只回答：

**“我现在在哪个项目、哪个会话里？”**

保留：

- 项目列表
- 会话列表
- 新建会话
- 新建项目

不新增：

- WorkContext 列表树
- Artifact 列表

### 5.2 中间职责

中间只回答：

**“我和系统正在如何沟通、这一轮执行发生了什么？”**

保留：

- 用户消息
- 助手回复
- run 摘要卡
- 查看步骤入口
- 输入框

中间区展示 run 摘要，但不承担完整的 WorkContext 和 Artifact 管理。

### 5.3 右侧职责

右侧只回答：

**“当前这件工作是什么、做到哪、产出了什么、怎么继续操作？”**

因此右侧必须围绕以下三个选中对象组织：

- `selectedWorkContext`
- `selectedArtifact`
- `selectedRun`

## 6. 右侧 UI 结构设计

### 6.1 顶部头部

右侧顶部从“工作台说明头”改成“当前 WorkContext 头部”。

头部显示：

- WorkContext 标题
- goal 简述
- status
- current stage
- progress summary
- next action
- 全屏 / 隐藏

说明：

- 右侧顶部不再放大段说明文案。
- 顶部是状态型头部，不是介绍型横幅。

### 6.2 Tabs

右侧 tab 固定为：

- `上下文`
- `产物`
- `执行过程`

当前前端已经有这一组 tab，应继续沿用，不再回到“说明页型卡片布局”。

### 6.3 上下文 Tab

该 tab 围绕 `selectedWorkContext` 展示：

- 标题
- goal
- status
- source
- current stage
- progress summary
- next action
- current run
- latest artifact
- updatedAt

这个 tab 的职责不是可视化所有历史，而是把“当前工作状态”讲清楚。

### 6.4 产物 Tab

该 tab 围绕 `listArtifacts(selectedWorkContextUid)` 组织成双栏：

- 左：Artifact 列表
- 右：Artifact 详情

列表项至少显示：

- type
- role
- title
- createdAt
- status
- source run

详情区根据 `artifactType` 选择渲染：

- `text` -> 文本预览 / 编辑器入口
- `structured_data` -> JSON/表格
- `page` -> URL + 标题 + 摘要
- `image` -> 图片预览
- `link` -> 链接卡片
- `file` -> 文件卡片
- `collection` -> 子项列表

### 6.5 执行过程 Tab

该 tab 围绕：

- `listRuns(workContextId)`
- `getRunWithSteps(runId)` 或 `listRunSteps(runId)`

组织成双栏：

- 左：Run 列表
- 右：Run 详情 / Step 时间线

左栏显示：

- runUid
- agent name
- status
- startedAt
- result summary 摘要

右栏显示：

- 基础信息
- step timeline
- tool name / tool status / content / createdAt

## 7. 基于现有实现的数据流设计

### 7.1 进入会话

进入一个 session 时，前端执行：

1. 加载 session 消息历史
2. 加载 session 维度的 runs
3. 加载 session 维度的 workContexts
4. 默认选中最近活跃的 WorkContext
5. 加载该 WorkContext 的 artifacts
6. 加载该 WorkContext 的 runs

当前页面中已经有这类逻辑雏形，应抽离成统一工作台数据流。

### 7.2 发送消息

发送消息时必须遵循当前后端的真实行为：

1. 用户消息先入聊天列表
2. 调用 `chat`
3. `chat` 立即返回 `runId`
4. 前端订阅 `runs/:runId/stream`
5. 中间区实时更新 run 摘要和步骤

注意：

- 不依赖 `chat` 首包拿到最终 workContextId
- 不依赖 `chat` 首包拿到最终 artifacts

### 7.3 Run 完成

run 完成后触发统一收口逻辑：

1. 重新加载当前 session 的 runs
2. 重新加载当前 session 的 workContexts
3. 根据 `runId -> currentRunId` 或最近更新时间重选 `selectedWorkContext`
4. 重新加载该 WorkContext 的 artifacts
5. 重新加载该 WorkContext 的 runs
6. 如有需要，刷新 `selectedRunSteps`

当前前端已经有 `onRunCompleted`、`reselectCurrentWorkContext`、`reloadArtifactsForSelectedWorkContext` 的雏形，应保留方向并收敛成统一流程。

### 7.4 点击产物

点击 Artifact 列表项时：

- 设置 `selectedArtifact`
- 右侧详情刷新
- 不影响当前聊天区

### 7.5 点击执行记录

点击 Run 列表项时：

- 设置 `selectedRun`
- 加载 `selectedRunSteps`
- 右侧切到执行过程详情

中间聊天区的“查看步骤”按钮应支持联动到右侧 `执行过程` tab。

## 8. 需要补齐的后端设计

### 8.1 WorkContext 字段收口

当前 `work_contexts` 主要字段是：

- `title`
- `goal`
- `status`
- `source`
- `currentRunId`
- `latestArtifactId`
- `metadataJson`

建议本阶段继续允许 `metadataJson` 承载灵活字段，但在协议层收口以下字段语义：

- `currentStage`
- `progressSummary`
- `nextAction`

要求：

- 所有 WorkContext 摘要接口都按这三个语义字段返回
- 即便仍存 `metadataJson`，前端不再随意猜字段名

### 8.2 Artifact 字段扩展

建议在现有 `agent_artifacts` 表上新增：

- `artifactRole`
- `sourceRunId`
- `sourceArtifactIdsJson`
- `metadataJson`

说明：

- `runId` 可继续保留，但 `sourceRunId` 语义更明确
- `sourceArtifactIdsJson` 用于派生产物血缘
- `metadataJson` 承载 subtype、文件信息、页面信息、图片尺寸等

### 8.3 聚合接口

为了减少前端碎片请求，建议新增一个 workbench 聚合接口。

建议接口：

- `GET /api/agent-platform/sessions/:sessionUid/workbench`

返回：

- session summary
- workContexts
- selectedWorkContext summary（可选）
- recent session runs

以及一个 workContext 详情接口：

- `GET /api/agent-platform/work-contexts/:workContextUid/workbench`

返回：

- workContext detail
- artifacts
- runs
- latest run steps summary（可选）

目标不是替代原子接口，而是让前端首屏和刷新更稳。

## 9. 需要补齐的前端设计

### 9.1 页面拆分

当前 [frontend/src/views/AgentPlatform.vue](D:/戈旭接的项目/gexuclaw/frontend/src/views/AgentPlatform.vue) 承担了过多职责。

建议拆分为以下组件：

- `AgentPlatformSidebar`
- `AgentConversationPane`
- `WorkContextHeader`
- `WorkContextOverviewPanel`
- `ArtifactPanel`
- `RunTracePanel`

### 9.2 状态收口

建议新增一个 composable 或 store，例如：

- `useAgentWorkbenchState`

负责管理：

- `selectedProjectId`
- `selectedSessionId`
- `selectedWorkContext`
- `selectedArtifact`
- `selectedRun`
- `selectedRunSteps`
- `workContextArtifacts`
- `workContextRuns`
- `activeWorkspaceTab`

避免 WorkContext、Artifact、Run 选择逻辑散落在页面各处。

### 9.3 Workbench 刷新动作

建议统一以下动作函数：

- `loadSessionWorkbench(sessionId)`
- `loadWorkContextWorkbench(workContextUid)`
- `handleRunStarted(runId)`
- `handleRunStep(runId, step)`
- `handleRunCompleted(runId)`
- `selectArtifact(artifactUid)`
- `selectRun(runUid)`

这些动作应由工作台状态层负责，而不是在模板附近拼接调用。

## 10. 分阶段实施计划

### 阶段 A：对象和协议收口

目标：

- 把字段语义和右侧骨架定稳

范围：

- 定义 `artifactType`
- 定义 `artifactRole`
- 明确 WorkContext 元数据语义
- 新增聚合接口设计

完成标准：

- 前后端对 `type / role / stage / progress / nextAction` 语义一致

### 阶段 B：右侧工作台收成真实结构

目标：

- 右侧不再是说明页，而是 WorkContext 面

范围：

- 改造右侧头部
- 固定三 tab
- 删除说明型大卡片
- 落地双栏的产物和执行过程

完成标准：

- 切会话能看到真实 WorkContext
- 切 tab 能看到真实 Artifact 和 Run

### 阶段 C：异步 run 链路稳定化

目标：

- 让 `chat -> SSE -> run 完成 -> workbench 刷新` 成为稳定主链路

范围：

- 收口 `onRunCompleted`
- 收口 `reselectCurrentWorkContext`
- 联动中间消息和右侧执行过程

完成标准：

- 新工作自动出现 WorkContext
- 产物与 run 会在完成后稳定出现在右侧

### 阶段 D：产物类型化展示

目标：

- 让右侧产物区开始具备真正可操作性

范围：

- 文本预览
- JSON 预览
- 页面卡片
- 图片预览
- 文件卡片

完成标准：

- 至少 `text / structured_data / page / image` 四类可用

## 11. 验收标准

### 11.1 会话与工作上下文

- 切换 session 后，右侧自动切换到该 session 最近活跃的 WorkContext
- 发送新任务后，run 完成会自动创建或复用 WorkContext
- 右侧头部始终显示当前 WorkContext 信息

### 11.2 产物

- 产物列表只展示当前 `selectedWorkContext` 下的 artifacts
- 产物列表支持按 `artifactRole` 分组或标识
- 点击产物可稳定查看详情

### 11.3 执行过程

- run 列表只展示当前 `selectedWorkContext` 相关 runs
- 点击 run 可查看 steps
- 中间聊天区的 run 摘要可联动右侧执行过程 tab

### 11.4 异步链路

- `chat` 首包不依赖最终结果
- SSE 完成后 workbench 自动刷新
- 失败场景下也能正确挂回当前 WorkContext

## 12. 推荐开发顺序

按当前代码基础，推荐顺序如下：

1. 扩展 Artifact 字段与协议
2. 统一 WorkContext 元数据语义
3. 抽离 `useAgentWorkbenchState`
4. 改造右侧头部和 tab body
5. 收口 `onRunCompleted` 刷新链路
6. 落地 Artifact 类型化预览
7. 新增聚合接口做性能与复杂度优化

## 13. 结论

当前代码已经不是从零开始，而是已经具备了：

- WorkContext 表
- Artifact 表
- 异步 run + SSE
- 右侧三 tab 雏形

因此下一阶段的正确方向不是重做页面，而是把现有“过渡态实现”收敛成稳定的工作对象模型：

- 左侧保持导航
- 中间保持会话
- 右侧成为当前 WorkContext 的真实工作面

其中：

- `WorkContext` 负责承接工作状态
- `Artifact` 负责承接工作成果
- `Run` 负责承接推进过程

这三者收稳之后，后续无论接写作编辑器、浏览器视图、导出文档，还是多 Agent 复用，都能沿着同一套骨架继续演进。
