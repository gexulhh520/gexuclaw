# Agent Platform 开发进度记录

本文档用于记录 Agent Platform 每次开发完成后的进度。后续每次实现、调整或验证完成，都在这里追加一条记录。

## 2026-04-23：开发约束建立

本次目标：

- 在正式编码前明确开发约束。
- 区分 Node.js / TypeScript 新 Agent Platform 与旧 Python 后端。
- 明确服务端、前端、注释、文档和进度记录规范。

修改文件：

- `docs/agent-platform/DEVELOPMENT_CONSTRAINTS.md`
- `docs/agent-platform/DEVELOPMENT_PROGRESS.md`

完成内容：

- 新增 Agent Platform 开发约束文档。
- 明确第一阶段只做单 Agent 运行底座。
- 明确第一阶段不做主 Agent 委派、WorkContext 复杂推进、Scoped Memory、ProjectContext 和 Python Worker。
- 明确服务端目录职责、API 规范、数据库规范、Runtime 规范。
- 明确前端页面边界、组件规范、UI 状态规范和视觉规范。
- 明确每次开发完成后必须更新本进度文档。

验证方式：

- 文档已创建。
- 与现有 `IMPLEMENTATION_PLAN.md`、`DEVELOPMENT_ROADMAP.md` 的阶段边界保持一致。

未完成事项：

- 尚未创建 `agent-platform-node/` 代码目录。
- 尚未实现数据库 schema。
- 尚未实现 Runtime。

下一步建议：

- 创建 `agent-platform-node/` 基础工程。
- 实现第一阶段 6 张表的 Drizzle schema。
- 实现 Kimi Provider Adapter 的最小模型调用闭环。

## 2026-04-23：第一阶段 Node 工程骨架

本次目标：

- 创建 `agent-platform-node/`。
- 搭建 Node.js / TypeScript / Fastify / Drizzle / Zod 第一阶段工程骨架。
- 跑通单 Agent 运行闭环的代码结构。

修改文件：

- `agent-platform-node/package.json`
- `agent-platform-node/tsconfig.json`
- `agent-platform-node/drizzle.config.ts`
- `agent-platform-node/.env.example`
- `agent-platform-node/README.md`
- `agent-platform-node/src/app.ts`
- `agent-platform-node/src/server.ts`
- `agent-platform-node/src/db/schema.ts`
- `agent-platform-node/src/db/client.ts`
- `agent-platform-node/src/db/migrate.ts`
- `agent-platform-node/src/modules/agents/*`
- `agent-platform-node/src/modules/model-profiles/*`
- `agent-platform-node/src/modules/runs/*`
- `agent-platform-node/src/runtime/*`
- `agent-platform-node/src/tools/*`
- `agent-platform-node/src/bootstrap/seed-default-agents.ts`
- `docs/agent-platform/IMPLEMENTATION_PLAN.md`
- `docs/agent-platform/DEVELOPMENT_PROGRESS.md`

完成内容：

- 新增 Fastify 服务入口和统一错误处理。
- 新增 6 张第一阶段核心表的 Drizzle schema。
- 新增数据库自动建表函数，方便第一阶段启动。
- 新增 ModelProfile、Agent、AgentVersion、AgentRun API。
- 新增 AgentRuntime 最小执行循环。
- 新增 ContextBuilder，第一阶段只组装 standalone execution PromptContext。
- 新增 ModelClient，支持 mock provider 和 OpenAI-compatible provider。
- 新增 ToolRuntime 和 mock browser tools。
- 新增 bootstrap 脚本，初始化默认模型配置和 `builtin_browser_agent`。

验证方式：

- 已确认 Node.js 可用：`node -v` 返回 v24.14.0。
- 已尝试执行 `npm.cmd install`，但依赖下载超时。
- 因依赖未安装完成，暂未能执行 `npm run typecheck`。
- 超时后已删除不完整的 `node_modules`，避免留下半成品依赖目录。

未完成事项：

- 需要在网络正常时执行 `npm.cmd install`。
- 依赖安装后需要执行 `npm run typecheck`。
- 依赖安装后需要执行 `npm run bootstrap` 和 `npm run dev` 做本地 API 验证。

下一步建议：

- 先完成依赖安装和类型检查。
- 再用 mock provider 跑一次 `builtin_browser_agent`。
- 验证 `agent_runs`、`agent_run_steps`、`model_invocations` 是否按预期写入。

## 2026-04-23：补充核心代码中文注释

本次目标：

- 修正第一版代码中文注释不足的问题。
- 让关键流程符合 `DEVELOPMENT_CONSTRAINTS.md` 中“代码要有注释”的约束。

修改文件：

- `agent-platform-node/src/runtime/agent-runtime.ts`
- `agent-platform-node/src/runtime/context-builder.ts`
- `agent-platform-node/src/runtime/model-client.ts`
- `agent-platform-node/src/runtime/tool-runtime.ts`
- `agent-platform-node/src/tools/tool-registry.ts`
- `agent-platform-node/src/bootstrap/seed-default-agents.ts`
- `agent-platform-node/src/modules/agents/agent.service.ts`
- `agent-platform-node/src/db/migrate.ts`
- `docs/agent-platform/DEVELOPMENT_PROGRESS.md`

完成内容：

- 为 AgentRuntime 主循环补充中文注释，说明快照冻结、运行轨迹、模型调用、工具调用和错误记录边界。
- 为 ContextBuilder 补充中文注释，说明第一阶段为什么只组装 standalone PromptContext。
- 为 ModelClient 补充中文注释，说明 mock provider、OpenAI-compatible provider、API key 和工具参数解析边界。
- 为 ToolRuntime 补充中文注释，说明工具白名单和二次校验。
- 为 bootstrap 补充中文注释，说明默认数据可重复初始化和 mock agent 的用途。
- 为数据库建表函数补充中文注释，说明第一阶段启动与正式 Drizzle 迁移的边界。

## 2026-04-23：数据库切换到 PostgreSQL

本次目标：

- 去掉 `better-sqlite3` 和 SQLite 依赖。
- 统一使用当前环境里的 PostgreSQL。
- 避免 Windows 下原生模块编译问题影响第一阶段开发。

修改文件：

- `agent-platform-node/package.json`
- `agent-platform-node/drizzle.config.ts`
- `agent-platform-node/.env.example`
- `agent-platform-node/README.md`
- `agent-platform-node/src/db/schema.ts`
- `agent-platform-node/src/db/client.ts`
- `agent-platform-node/src/db/migrate.ts`
- `agent-platform-node/src/server.ts`
- `agent-platform-node/src/bootstrap/seed-default-agents.ts`
- `docs/agent-platform/IMPLEMENTATION_PLAN.md`
- `docs/agent-platform/DEVELOPMENT_ROADMAP.md`
- `docs/agent-platform/DEVELOPMENT_PROGRESS.md`

完成内容：

- 删除 `better-sqlite3` 和相关类型依赖。
- 新增 `pg` 和 `@types/pg`。
- Drizzle schema 从 `sqlite-core` 切换到 `pg-core`。
- 数据库客户端从本地 SQLite 文件切换为 `DATABASE_URL` 驱动的 PostgreSQL Pool。
- 自动建表逻辑改成 PostgreSQL `create table if not exists`。
- 启动和 bootstrap 流程改为异步等待数据库初始化。
- 文档统一改为 PostgreSQL 作为第一阶段数据库。

验证方式：

- 静态检查已确认代码中不再引用 `better-sqlite3`、`sqlite-core`、`AGENT_PLATFORM_DB_PATH`。
- 依赖安装仍需在本机重新执行，以拉取新的 PostgreSQL 驱动依赖。

未完成事项：

- 需要设置 `DATABASE_URL`。
- 需要重新执行 `npm.cmd install`。
- 依赖安装后需要执行 `npm.cmd run typecheck`、`npm.cmd run bootstrap`、`npm.cmd run dev`。

下一步建议：

- 填好 PostgreSQL 的 `DATABASE_URL`。
- 重新安装依赖并跑通 bootstrap。
- 用 `builtin_browser_agent` 做一次 mock run 验证。

## 2026-04-23：补充表字段中文说明和 schema 注释

本次目标：

- 修正“表字段没有中文解释”的问题。
- 给数据库 schema 和关键 service 入口补足中文说明。

修改文件：

- `agent-platform-node/src/db/schema.ts`
- `agent-platform-node/src/modules/model-profiles/model-profile.service.ts`
- `agent-platform-node/src/modules/runs/run.service.ts`
- `docs/agent-platform/CORE_TABLE_FIELDS.md`
- `docs/agent-platform/IMPLEMENTATION_PLAN.md`
- `docs/agent-platform/DEVELOPMENT_PROGRESS.md`

完成内容：

- 为 `schema.ts` 的 6 张核心表补充中文用途说明和关键字段注释。
- 为 `model-profile.service.ts`、`run.service.ts` 补充中文注释，说明 profile 绑定和 run 查询边界。
- 新增 `CORE_TABLE_FIELDS.md`，对第一阶段 6 张核心表逐字段给出中文解释。
- 在 `IMPLEMENTATION_PLAN.md` 中加入字段说明文档入口，避免实现文档和表说明脱节。

验证方式：

- 已确认代码中新增了 schema 表级注释和关键字段注释。
- 已确认新增独立字段说明文档，覆盖 6 张第一阶段核心表。

未完成事项：

- 依赖安装与类型检查仍待 PostgreSQL 环境接通后继续。

下一步建议：

- 继续安装依赖并跑通 PostgreSQL 版本的 bootstrap。
- 后续新增表时同步更新 `CORE_TABLE_FIELDS.md`。

## 2026-04-23：补充 PostgreSQL 表和字段 comment

本次目标：

- 让数据库对象本身带中文说明，而不只是代码里有注释。
- 使 PostgreSQL 表结构在数据库工具中可直接查看中文语义。

修改文件：

- `agent-platform-node/src/db/migrate.ts`
- `docs/agent-platform/CORE_TABLE_FIELDS.md`
- `docs/agent-platform/DEVELOPMENT_CONSTRAINTS.md`
- `docs/agent-platform/DEVELOPMENT_PROGRESS.md`

完成内容：

- 为 6 张第一阶段核心表补充 `COMMENT ON TABLE`。
- 为关键字段补充 `COMMENT ON COLUMN`。
- 在开发约束里明确：代码注释、数据库 comment、字段说明文档三层都要保持一致。
- 在字段说明文档中补充说明当前已经同步落了 PostgreSQL comment。

验证方式：

- 已检查 `migrate.ts` 中存在 `comment on table` 和 `comment on column` 语句。
- 已确认 comment 覆盖 6 张核心表。

未完成事项：

- 需要在 PostgreSQL 环境中执行 bootstrap / 启动流程，才能把这些 comment 真正写入数据库。

下一步建议：

- 配好 `DATABASE_URL` 后执行 `npm.cmd run bootstrap`。
- 在数据库工具里检查表和字段 comment 是否可见。

## 2026-04-24：修复 mock browser run 重复 tool call

本次目标：

- 修复 mock provider 在拿到工具结果后仍重复调用同一个工具的问题。
- 记录 Windows PowerShell 下的 UTF-8 调试方式。

修改文件：

- `agent-platform-node/src/runtime/model-client.ts`
- `agent-platform-node/README.md`
- `docs/agent-platform/DEVELOPMENT_PROGRESS.md`

完成内容：

- 调整 `ModelClient.invokeMock()`：如果已经收到 `tool` 消息，则直接返回最终总结，不再重复发起 `browser.open`。
- 补充 PowerShell UTF-8 请求示例，避免中文输入在 `Invoke-RestMethod` / 控制台代码页下被显示成问号。

验证方式：

- 之前的 mock run 会反复执行 `browser.open` 直到打满 `maxSteps`。
- 修复后再次运行应只产生一轮模型调用、一轮工具调用和一轮最终结果。

未完成事项：

- 需要重新发起一次 mock run，确认步数已经收敛。

下一步建议：

- 复测 `builtin_browser_agent`。
- 确认 steps 数量恢复到合理范围后，再决定是先做前端管理页还是继续 Phase 2。

## 2026-04-24：Agent Platform 前端工作台第一版

本次目标：

- 建立 Agent Platform 专用前端规范。
- 实现第一版工作台页面，用于查看 Agent、运行记录、步骤和模型调用。

修改文件：

- `docs/agent-platform/FRONTEND_GUIDELINES.md`
- `frontend/src/api/agentPlatform.ts`
- `frontend/src/views/AgentPlatform.vue`
- `frontend/src/router/index.ts`
- `frontend/vite.config.ts`
- `frontend/src/views/ScheduledTasks.vue`
- `frontend/src/views/UserSettings.vue`
- `agent-platform-node/src/modules/runs/run.service.ts`
- `agent-platform-node/src/modules/runs/run.routes.ts`
- `docs/agent-platform/DEVELOPMENT_PROGRESS.md`

完成内容：

- 新增 Agent Platform 前端规范文档，明确页面风格、布局方式、组件职责和状态要求。
- 新增 `agentPlatform.ts` API 层，统一封装 Agent、Run、Steps、Model Invocations 请求。
- 新增 `/agent-platform` 工作台页面。
- 页面支持：
  - Agent 列表
  - 当前 Agent 版本信息
  - 运行入口
  - 最近 Run 列表
  - Run Steps
  - Model Invocation 摘要
- 为了让页面可用，后端新增 `GET /api/agent-platform/runs` 列表接口。
- 在现有任务页和设置页增加 Agent Platform 入口按钮。
- Vite proxy 新增 `/api/agent-platform -> 3100` 转发。

验证方式：

- 已检查路由、API、视图和 proxy 配置均已写入。
- 需要继续执行前端构建或 dev server 验证页面渲染。

未完成事项：

- 还未实际打开前端页面做视觉和交互验收。
- 还未执行前端构建验证是否存在类型问题。

下一步建议：

- 运行前端构建或开发服务。
- 打开 `/agent-platform` 页面做视觉与交互验收。
- 若通过，再决定继续补页面细节还是进入 Phase 2。

## 2026-04-24：前端工具链适配与页面联通验证

本次目标：

- 让新增的 Agent Platform 前端页面能在当前 Node 22 环境下运行。
- 区分“新页面问题”和“前端项目已有类型问题”。

修改文件：

- `frontend/package.json`
- `frontend/package-lock.json`
- `docs/agent-platform/DEVELOPMENT_PROGRESS.md`

完成内容：

- 将 `vue-tsc` 升级到兼容 Node 22 的版本。
- 重新安装前端依赖。
- 确认新增的 Agent Platform API 能拿到后端数据。
- 启动前端 Vite 开发服务并确认页面入口可访问。

验证方式：

- `npm.cmd install` 已成功完成。
- `npm.cmd run build` 已能真正进入 TypeScript 检查阶段。
- 当前构建仍被项目既有的 `Chat.vue`、`stores/chat.ts`、`Login.vue` 类型错误阻塞，不是本次新增 Agent Platform 页面引入的错误。
- 前端开发服务已启动，`http://127.0.0.1:5173` 返回 200。

未完成事项：

- 需要后续单独清理现有前端项目里的旧类型错误，才能让全量 build 通过。
- 需要打开 `/agent-platform` 页面做最终视觉验收。

下一步建议：

- 先在浏览器中打开 `http://127.0.0.1:5173/agent-platform` 验收页面。
- 如果页面方向满意，再决定是继续细化工作台，还是进入 WorkContext / Artifact 阶段。

## 2026-04-24：移除 Agent Platform 当前体验中的登录页拦截

本次目标：

- 不让 Agent Platform 入口再先落到旧登录页。
- 让首页直接进入 `/agent-platform` 工作台。

修改文件：

- `frontend/src/router/index.ts`
- `docs/agent-platform/DEVELOPMENT_PROGRESS.md`

完成内容：

- 根路由 `/` 由原来的 `/chat` 重定向改为 `/agent-platform`。
- `/login` 当前阶段直接重定向到 `/agent-platform`。
- `/agent-platform` 不再要求登录。
- 已登录用户访问 guest 页时也统一跳到 `/agent-platform`。

验证方式：

- 已确认 `http://127.0.0.1:5173/agent-platform` 可以直接访问，返回 200。

未完成事项：

- 旧登录页、旧聊天页、旧鉴权逻辑仍保留在项目中，但当前阶段不再阻塞 Agent Platform 入口。

下一步建议：

- 直接在工作台页面上继续做视觉和交互细化。
- 或进入 Phase 2 开始做 WorkContext / Artifact。

## 2026-04-24：调整 Agent Platform 入口为独立菜单页

本次目标：

- 不让 Agent Platform 作为一进入应用时的默认页面。
- 提供一个独立菜单页，从菜单中进入各个工作台。

修改文件：

- `frontend/src/views/WorkbenchHome.vue`
- `frontend/src/router/index.ts`
- `frontend/src/views/AgentPlatform.vue`
- `docs/agent-platform/DEVELOPMENT_PROGRESS.md`

完成内容：

- 新增 `/workspace` 菜单首页。
- 根路由 `/` 改为跳转到 `/workspace`。
- `/login` 当前阶段改为跳转到 `/workspace`。
- Agent Platform 页面顶部按钮由“返回聊天”改为“返回菜单”。
- 菜单页中把 Agent Platform 作为单独入口卡片展示。

验证方式：

- 路由已切换为 `/ -> /workspace`。
- Agent Platform 不再作为默认首页，而是作为菜单中的独立入口。

未完成事项：

- 需要浏览器刷新后确认菜单页视觉是否符合预期。

下一步建议：

- 先看 `/workspace` 和 `/agent-platform` 两个页面的衔接体验。
- 如入口形态满意，再继续细化 Agent Platform 工作台视觉与交互。

## 2026-04-24：重构智能体前台入口与执行观察页

本次目标：
- 让前端第一层真正变成“找智能体开工”的入口，而不是直接进入运行监控视图。
- 把 `/agent-platform` 调整为执行观察页，保留过程与模型记录，但不再作为默认首页表达。

修改文件：
- `frontend/src/views/WorkbenchHome.vue`
- `frontend/src/views/AgentPlatform.vue`
- `docs/agent-platform/DEVELOPMENT_PROGRESS.md`

完成内容：
- 重写 `/workspace` 首页，突出推荐智能体、最近工作、直接开始和辅助入口。
- 首页文案统一改成“智能体”，不再让用户先看到 Agent / Run 这类工程术语。
- 支持从首页带 `agent` 和 `run` 查询参数进入 `/agent-platform`。
- 重写 `/agent-platform` 顶部定位与主要文案，把它降级为“执行观察页”。
- `/agent-platform` 支持根据 URL 查询参数自动选中智能体和处理记录。
- 保留处理过程、模型记录、版本配置这类高级信息，但视觉层级后移。

验证方式：
- 通过浏览器访问 `/workspace`，确认首页先提供工作入口而不是调试视图。
- 从首页点击智能体或最近工作，确认可以带参数进入 `/agent-platform`。
- 在 `/agent-platform` 选择智能体、发起处理、查看详情，确认交互链路保持可用。

未完成事项：
- 还没有把“推荐智能体”做成真正的策略引擎，目前先按第一可用智能体展示。
- 还没有在首页加入 Artifact、WorkContext 等第二阶段对象。

下一步建议：
- 继续细化首页卡片信息，让每个智能体更像明确的工作入口。
- 下一阶段接入 WorkContext 与 Artifact 后，再把“继续工作”提升为真正的工作流入口。

## 2026-04-24：切换到 AI 多智能体操作系统桌面形态

本次目标：
- 按照新的产品方向，把主前端从“页面列表 + 观察台”切换成未来感三栏式桌面。
- 在视觉上先建立稳定气质：深色模式、结构化分区、写作工作区作为主视觉。

修改文件：
- `frontend/src/views/AgentPlatform.vue`
- `frontend/src/views/WorkbenchHome.vue`
- `docs/agent-platform/DEVELOPMENT_PROGRESS.md`

完成内容：
- 重写 `/agent-platform`，改为三栏式 AI Agent OS 工作桌面。
- 左侧加入新建会话、新建项目、项目空间、我的会话、智能体列表与状态标识。
- 中间加入聊天窗口、项目空间切换、执行摘要与可折叠执行步骤。
- 右侧重做文档写作工作区，包含大纲、正文编辑、AI 自动补全、建议、版本和引用来源。
- 新建会话时增加“先选择智能体”的前端交互。
- 重写 `/workspace` 首页，使其成为进入智能体桌面的平台首页，而不是乱码旧页。

验证方式：
- 访问 `/workspace`，确认首页可以进入主工作桌面。
- 访问 `/agent-platform`，确认三栏结构与主要模块均能正常渲染。
- 检查新建会话、新建项目、切换项目、切换会话、发送消息等前端交互是否可用。

未完成事项：
- 当前项目空间、会话树、写作内容仍以高保真前端状态为主，尚未正式接入 WorkContext 与 Artifact。
- 当前桌面以“文档写作 Agent”场景为主，其他智能体还没有各自独立的工作区模板。

下一步建议：
- 把左侧项目空间和会话树接到真正的 WorkContext / Session 模型。
- 再给浏览器 Agent、研究 Agent、视频 Agent 分别设计自己的右侧主工作区模板。

## 2026-04-24：收起常驻智能体列表并重做新建会话弹窗

本次目标：
- 把左侧边栏从“项目/会话 + 智能体列表”收敛成更聚焦的项目与会话导航。
- 让智能体选择集中发生在“新建会话”动作里，符合桌面操作系统式入口。

修改文件：
- `frontend/src/views/AgentPlatform.vue`
- `docs/agent-platform/DEVELOPMENT_PROGRESS.md`

完成内容：
- 去掉左侧边栏常驻的智能体列表。
- 把“新建会话”按钮改成先打开设计化弹窗，而不是直接简陋创建。
- 新建会话弹窗新增三部分：
  - 智能体卡片选择
  - 会话标题输入
  - 保存位置选择（项目空间 / 我的会话）
- 当选择“项目空间”时，可继续指定要放入哪个项目。
- 保持当前会话创建后自动切换到对应智能体与对应会话。

验证方式：
- 打开主桌面，确认左侧不再出现常驻智能体列表。
- 点击“新建会话”，确认弹窗可以完成智能体选择、标题输入和保存位置选择。
- 分别在“项目空间”和“我的会话”下创建会话，确认都能正确落位。

未完成事项：
- 新建会话弹窗还没有加入搜索、推荐和最近使用排序。
- 不同智能体的创建表单还没有根据能力做差异化字段。

下一步建议：
- 继续精修新建会话弹窗的层次、图标和状态，让它更接近高保真设计稿。
- 后续接入真实 Session 数据后，再加入“最近使用智能体”和“推荐智能体”策略。

## 2026-04-24：补齐项目空间与会话规则

本次目标：
- 让“项目空间 / 我的会话 / 新建会话”三者关系更符合桌面式多智能体产品。
- 把智能体选择从单选升级为可单选/多选，给后续主智能体调度留入口。

修改文件：
- `frontend/src/views/AgentPlatform.vue`
- `docs/agent-platform/DEVELOPMENT_PROGRESS.md`

完成内容：
- 新建会话弹窗改成可勾选单个或多个智能体。
- 当前项目空间切换改为真正的下拉选择，切换后默认落到该项目最近的一次会话。
- 当项目空间下没有任何会话时，中间聊天区显示“创建会话”空状态入口。
- 点击“我的会话”中的会话时，不再显示项目空间切换控件。
- 会话数据结构从单智能体调整为多智能体数组，右侧协作头像也会跟着变化。

验证方式：
- 打开“新建会话”，确认可以勾选多个智能体。
- 切换不同项目空间，确认会自动进入该项目最近会话；空项目则显示创建入口。
- 点击“我的会话”中的任一会话，确认聊天区顶部不再展示项目空间切换。

未完成事项：
- 多智能体勾选还没有加入“主智能体 / 辅助智能体”的显式角色区分。
- 还没有把多智能体选择后的调度关系写回真实后端数据模型。

下一步建议：
- 在新建会话弹窗中继续加入“主智能体优先级”或“默认主智能体”说明。
- 后续接入真实 Session / WorkContext 后，把多智能体选择正式落库。

## 2026-04-24：把右侧主工作区改为可隐藏、可脱离的预留面板

本次目标：
- 不在右侧先塞入假内容，避免高保真界面被无效信息占满。
- 给右侧工作区加上“隐藏 / 脱离放大”的桌面化行为。

修改文件：
- `frontend/src/views/AgentPlatform.vue`
- `docs/agent-platform/DEVELOPMENT_PROGRESS.md`

完成内容：
- 清空右侧主工作区内容，改成预留型空状态。
- 右侧顶部加入两个动作：
  - 隐藏
  - 脱离放大
- 右侧工作区可以从右栏切换成固定浮层，类似浏览器标签页脱离后的独立查看形态。
- 工作区被隐藏后，右下角会出现“打开工作区”的恢复入口。

验证方式：
- 打开主桌面，确认右侧不再展示预设正文内容。
- 点击“隐藏”，确认右栏消失并出现恢复按钮。
- 点击“脱离放大”，确认右侧工作区变成独立放大的浮层。

未完成事项：
- 脱离放大当前仍然是在同一页面内的浮层模拟，还不是浏览器原生新窗口。
- 右侧预留区还没有根据不同智能体类型切换不同模板。

下一步建议：
- 后续根据智能体类型，把这里分别接入写作编辑器、浏览器视图、研究资料面板等真实工作区。
- 如果需要更强的桌面感，可以再把“脱离放大”继续演进成可拖拽浮窗。

## 2026-04-24：重构右侧为 WorkspaceHost 宿主容器

本次目标：
- 把右侧从“普通内容栏”改成真正的智能体工作台宿主。
- 修正桌面布局，让三栏不再被右侧内容撑高。

修改文件：
- `frontend/src/views/AgentPlatform.vue`
- `docs/agent-platform/DEVELOPMENT_PROGRESS.md`

完成内容：
- 整个桌面改成固定 `100vh` 视口高度。
- 左栏、中栏、右栏全部改为内部滚动，不再让内容把整页拉长。
- 右侧正式抽象成 `WorkspaceHost`，不是具体业务内容栏。
- `WorkspaceHost` 支持三种状态：
  - 嵌入桌面
  - 隐藏
  - 脱离放大
- 根据当前主展示智能体，右侧会切换不同的工作台壳子说明：
  - 写作
  - 浏览器
  - 研究
  - 视频
- 保留项目空间、多智能体会话、聊天区与执行摘要的整体结构。

验证方式：
- 打开主桌面，确认三栏高度稳定，不会因右侧内容增长而把页面撑高。
- 切换不同智能体会话，确认右侧宿主标题与说明跟着切换。
- 使用“隐藏 / 脱离放大”，确认右侧宿主容器可以切换状态。

未完成事项：
- 右侧目前仍是工作台壳子，不是各智能体的真实业务工作区。
- 脱离放大当前还是同页浮层，不是系统级独立窗口。

下一步建议：
- 先针对文档写作 Agent 接入第一套真实工作台模板。  
- 再给浏览器 / 研究 / 视频分别补各自的专用宿主内容。  

## 2026-04-24：重写 AgentPlatform 主桌面页面并修复编译入口

本次目标：
- 解决 `frontend/src/views/AgentPlatform.vue` 因乱码与模板损坏导致的 Vite 编译报错。
- 保留当前产品结构：左侧项目与会话，中间聊天协作，右侧 WorkspaceHost 宿主。

修改文件：
- `frontend/src/views/AgentPlatform.vue`
- `docs/agent-platform/DEVELOPMENT_PROGRESS.md`

完成内容：
- 直接重写 `AgentPlatform.vue`，移除损坏的模板片段与乱码字符串。
- 保留并重新实现多智能体新建会话弹窗。
- 保留项目空间切换、空项目创建会话入口、个人会话不显示项目空间工具栏等规则。
- 保留右侧 WorkspaceHost 的三种状态：
  - 嵌入桌面
  - 隐藏
  - 脱离放大
- 把整页继续保持为固定桌面高度，避免右栏内容把页面撑高。

验证方式：
- 启动前端开发服务并确认 `/agent-platform` 不再出现 `[vue/compiler-sfc] Missing semicolon` 报错。
- 检查新建会话弹窗是否支持单选/多选智能体。
- 检查切换项目空间时是否自动进入该项目最近会话；空项目是否显示创建入口。

未完成事项：
- 右侧仍然是工作台宿主壳子，尚未接入真实的写作编辑器或浏览器工作区。
- 还需要继续做一轮真实浏览器验证，确保页面在运行态视觉稳定。

下一步建议：
- 先把当前页面跑起来做真实验收。  
- 然后开始把写作 Agent 的专属工作台接进右侧宿主容器。  

## 2026-04-24：优化项目空间下拉、深色滚动条与右侧脱离浮窗

本次目标：
- 让当前项目空间下拉框更贴近深色未来感桌面风格。
- 去掉聊天区与右侧工作区刺眼的默认白色滚动条。
- 让右侧脱离后的工作台真正居中，并支持拖动和缩放。

修改文件：
- `frontend/src/views/AgentPlatform.vue`
- `docs/agent-platform/DEVELOPMENT_PROGRESS.md`

完成内容：
- 重做 `el-select` 的深色样式，统一输入框、下拉面板、悬停和选中态。
- 给左侧列表、中间聊天区、右侧工作台统一加了细窄暗色滚动条样式。
- 右侧 `WorkspaceHost` 脱离后默认居中打开。
- 脱离态支持：
  - 拖动标题栏移动
  - 右下角拖拽缩放
  - 窗口尺寸与位置边界约束
- 保留隐藏、收回桌面等原有操作。

验证方式：
- 检查项目空间下拉框是否不再出现明显的浅色原生输入框观感。
- 检查聊天区与右侧工作区滚动条是否与整体深色 UI 风格统一。
- 点击“脱离放大”，确认右侧工作台居中出现，并可拖动、可缩放。

未完成事项：
- 右侧仍然是通用宿主壳子，尚未接入真正的写作编辑器或浏览器画布。
- 脱离态目前仍在同页浮窗内，不是系统级新窗口。

下一步建议：
- 继续把右侧写作工作台做成可编辑的真实工作区。
- 再补一轮桌面细节，比如按钮悬停、投影层次和浮窗过渡动画。

## 2026-04-24：右侧脱离后释放主桌面宽度

本次目标：
- 让右侧工作台脱离后，中间聊天协作区自动扩展，不再给右栏保留空白占位。

修改文件：
- `frontend/src/views/AgentPlatform.vue`
- `docs/agent-platform/DEVELOPMENT_PROGRESS.md`

完成内容：
- 给桌面根节点增加布局状态类：
  - `workspace-detached-layout`
  - `workspace-hidden-layout`
- 当右侧工作台脱离或隐藏时，主桌面从三栏自动切成两栏。
- 中间区域会向右延展，获得更大的聊天与协作空间。

验证方式：
- 点击“脱离放大”，确认右侧变为独立浮窗后，中间区域宽度明显增加。
- 点击“隐藏”，确认主桌面同样变为两栏布局。

下一步建议：
- 继续补浮窗与主桌面之间的切换动效。
- 开始把右侧写作工作台接成真正的可编辑工作区。

## 2026-04-24：整体深色系提亮一档

本次目标：
- 缓解桌面底色和主要面板过深的问题。
- 保留深色专业感，但让界面更通透、更有层次。

修改文件：
- `frontend/src/views/AgentPlatform.vue`
- `docs/agent-platform/DEVELOPMENT_PROGRESS.md`

完成内容：
- 提亮桌面底色，改成更偏深海蓝黑的渐变背景。
- 提亮主要面板、侧栏、消息卡片、执行摘要和右侧宿主容器。
- 提亮下拉框与下拉面板，让其与整体暗色 UI 更协调。
- 保留原有紫蓝主色，不改变整套品牌方向。

验证方式：
- 刷新 `/agent-platform`，确认桌面底色不再像纯黑幕。
- 检查消息区、右侧工作台、侧栏卡片之间的层次是否更柔和。

下一步建议：
- 再做一轮更细的视觉统一，重点看边框透明度、阴影和文字灰阶。
- 开始接入右侧真实写作工作台内容。

## 2026-04-24：把背景收成深海蓝灰

本次目标：
- 避免整体背景继续停留在过黑、过闷的方向。
- 把桌面与主要面板统一到更合适的深海蓝灰色系。

修改文件：
- `frontend/src/views/AgentPlatform.vue`
- `docs/agent-platform/DEVELOPMENT_PROGRESS.md`

完成内容：
- 桌面背景调整为 `#111827 -> #162033` 的轻渐变。
- 主面板、消息卡片、右侧脱离浮窗、下拉面板同步切到更柔和的蓝灰深色。
- 保留原有紫蓝主色按钮和重点交互，不改动品牌识别方向。

验证方式：
- 刷新 `/agent-platform`，确认背景从“纯黑压暗”变成“蓝灰深色”。
- 观察左侧、中间、右侧是否比之前更有层次、更不压抑。

下一步建议：
- 再统一一轮文字层级与边框透明度。
- 开始做右侧真实写作工作台。

## 2026-04-24：去掉中间区域顶部的大头部信息

本次目标：
- 去掉中间主区域顶部那块重复的智能体标题、状态和操作按钮，让界面更直接。

修改文件：
- `frontend/src/views/AgentPlatform.vue`
- `docs/agent-platform/DEVELOPMENT_PROGRESS.md`

完成内容：
- 移除中间顶部的大型智能体信息头部。
- 中间区域现在从项目空间工具条直接开始。
- 同步收掉对应的布局与样式定义，避免页面上方留出多余空高。

验证方式：
- 刷新 `/agent-platform`，确认中间顶部不再显示大号智能体标题条。
- 检查项目空间工具条是否直接贴近主内容区开始显示。

下一步建议：
- 再继续清理一轮“非必要说明性 UI”，让主桌面更克制。
- 开始补右侧真实工作台内容。

## 2026-04-24：右侧工作台增加全屏状态

本次目标：
- 给右侧工作台补齐“全屏”状态，与嵌入、脱离形成完整模式组。

修改文件：
- `frontend/src/views/AgentPlatform.vue`
- `docs/agent-platform/DEVELOPMENT_PROGRESS.md`

完成内容：
- 新增右侧工作台“全屏 / 退出全屏”按钮。
- 全屏时主桌面自动释放右侧原占位，中间区域同步扩展。
- 全屏态使用更强的浮层层级与边框区分。
- 全屏时禁用拖拽与右下角缩放手柄，避免交互冲突。

验证方式：
- 点击“全屏”，确认右侧工作台进入接近铺满视口的状态。
- 再点击“退出全屏”，确认可恢复到普通浮窗状态。

下一步建议：
- 再补一个淡遮罩，让全屏态的沉浸感更完整。
- 开始接入右侧真实写作工作台内容。

## 2026-04-24：修复全屏退出后浮窗尺寸被重置

本次目标：
- 解决右侧工作台从全屏退出后，宽度和位置被重新计算的问题。

修改文件：
- `frontend/src/views/AgentPlatform.vue`
- `docs/agent-platform/DEVELOPMENT_PROGRESS.md`

完成内容：
- 新增脱离浮窗尺寸与位置的记忆状态。
- 进入全屏前先保存当前浮窗宽高与坐标。
- 退出全屏后恢复到进入前的浮窗布局，而不是重新居中生成新尺寸。
- 拖动和缩放过程中也会同步更新这份记忆状态。

验证方式：
- 先把右侧脱离出来并手动调整宽度。
- 点击“全屏”，再点击“退出全屏”。
- 确认浮窗恢复到全屏前的尺寸和位置。

下一步建议：
- 再给浮窗状态切换补过渡动效。
- 开始做右侧真实工作台内容。

## 2026-04-24：修正全屏退出后应回到右侧栏

本次目标：
- 解决右侧工作台全屏退出后没有回收到右侧栏的问题。

修改文件：
- `frontend/src/views/AgentPlatform.vue`
- `docs/agent-platform/DEVELOPMENT_PROGRESS.md`

完成内容：
- 简化全屏状态切换逻辑。
- 现在点击“退出全屏”会直接回到右侧栏嵌入态。
- 不再在退出全屏时回到旧的浮窗态。

验证方式：
- 点击“全屏”进入全屏。
- 再点击“退出全屏”，确认工作台直接回到右侧栏。

下一步建议：
- 继续清理旧的浮窗遗留逻辑。
- 开始接入右侧真实工作台内容。

## 2026-04-24：修复项目空间下拉被内容区遮挡

本次目标：
- 解决项目空间下拉展开后被下面聊天或工作区内容挡住的问题。

修改文件：
- `frontend/src/views/AgentPlatform.vue`
- `docs/agent-platform/DEVELOPMENT_PROGRESS.md`

完成内容：
- 移除两个 `el-select` 上的 `:teleported=\"false\"`。
- 让下拉面板重新挂到顶层，避免被当前页面布局层裁切。
- 保留自定义的深色下拉样式类 `agent-dark-select-popper`。

验证方式：
- 点击“当前项目空间”的下拉框。
- 确认下拉内容浮在内容区之上，不再被下面聊天窗口或工作台挡住。

下一步建议：
- 再检查一轮所有弹层组件的层级策略，避免同类问题反复出现。
- 开始接入右侧真实工作台内容。

## 2026-04-24：后端新增 WorkContext 与 Artifact 最小闭环

本次目标：
- 把 Phase 2 的第一版后端骨架落下来。
- 让工作上下文和运行产物不再只停留在文档里，而是有真实数据表和 API。

修改文件：
- `agent-platform-node/src/db/schema.ts`
- `agent-platform-node/src/db/migrate.ts`
- `agent-platform-node/src/modules/runs/run.schema.ts`
- `agent-platform-node/src/modules/runs/run.service.ts`
- `agent-platform-node/src/runtime/agent-runtime.ts`
- `agent-platform-node/src/modules/work-contexts/work-context.schema.ts`
- `agent-platform-node/src/modules/work-contexts/work-context.service.ts`
- `agent-platform-node/src/modules/work-contexts/work-context.routes.ts`
- `agent-platform-node/src/app.ts`
- `docs/agent-platform/DEVELOPMENT_PROGRESS.md`

完成内容：
- 新增 `work_contexts` 表。
- 新增 `agent_artifacts` 表。
- PostgreSQL 初始化脚本补齐两张表和数据库 comment。
- 新增 WorkContext API：
  - `GET /api/agent-platform/work-contexts`
  - `POST /api/agent-platform/work-contexts`
  - `GET /api/agent-platform/work-contexts/:workContextUid`
  - `GET /api/agent-platform/work-contexts/:workContextUid/artifacts`
  - `POST /api/agent-platform/work-contexts/:workContextUid/artifacts`
- `runAgent` 现在支持传 `workContextId`。
- `agent_runs.work_context_id` 现在可以真实挂到 WorkContext uid。
- 运行开始和结束时会回写 `work_contexts.current_run_id`。
- `runs` 列表新增按 `workContextId` 查询。

验证方式：
- `npm.cmd run typecheck` 通过。
- `npm.cmd run bootstrap` 成功执行，确认新表初始化脚本没有被本轮改动破坏。

下一步建议：
- 开始把 Session / 会话 与 WorkContext 的关系补清楚。
- 再往下做 Artifact 的读取与详情接口。

## 2026-04-24：移除“脱离放大”按钮

本次目标：
- 精简右侧工作台操作区，去掉与“全屏”语义重复的按钮。

修改文件：
- `frontend/src/views/AgentPlatform.vue`
- `docs/agent-platform/DEVELOPMENT_PROGRESS.md`

完成内容：
- 从右侧工作台头部移除“脱离放大”按钮。
- 保留“全屏”和“隐藏”作为更清晰的主操作。

验证方式：
- 刷新 `/agent-platform`，确认右侧头部只保留“全屏 / 隐藏”相关控制。

下一步建议：
- 再继续清理一轮操作按钮优先级。
- 开始做右侧真实工作台内容。

## 2026-04-24：修复右侧头部按钮被挤掉的问题

本次目标：
- 解决右侧工作台头部在宽度受限时，“全屏”按钮被前面标签挤掉的问题。

修改文件：
- `frontend/src/views/AgentPlatform.vue`
- `docs/agent-platform/DEVELOPMENT_PROGRESS.md`

完成内容：
- 把右侧头部拆成两组：
  - 标签组
  - 窗口操作组
- “全屏 / 隐藏”现在固定在窗口操作组中，不再和前面的标签抢位置。

验证方式：
- 刷新 `/agent-platform`，确认右侧头部的“全屏”按钮始终可见。
- 缩窄右侧宽度后，确认按钮不再被挤没。

下一步建议：
- 再继续精简和统一右侧头部交互。
- 开始做右侧真实工作台内容。

## 2026-04-24：修正右侧栏右边缘被挡住的观感

本次目标：
- 解决右侧工作台最右边看起来像被裁掉、被挡住的问题。

修改文件：
- `frontend/src/views/AgentPlatform.vue`
- `docs/agent-platform/DEVELOPMENT_PROGRESS.md`

完成内容：
- 增加右侧工作台容器的安全边距。
- 给右侧容器补上 `overflow: hidden` 和盒模型约束，避免边缘内容贴出外框。
- 右侧滚动区也增加了一点内边距，减轻“滚动条和边框挤在一起”的感觉。

验证方式：
- 刷新 `/agent-platform`，观察右侧整栏的最右边是否还像被吃掉一条。
- 检查右侧工作区边框、滚动条和内容之间是否更舒展。

下一步建议：
- 继续细修右侧宿主的留白和边框层次。
- 开始接右侧真实工作台内容。

## 2026-04-24：给整张桌面右侧增加安全区

本次目标：
- 继续处理右侧整栏看起来被视口右边缘挡住的问题。

修改文件：
- `frontend/src/views/AgentPlatform.vue`
- `docs/agent-platform/DEVELOPMENT_PROGRESS.md`

完成内容：
- 给桌面根容器增加右侧安全边距。
- 让整张主网格不再紧贴浏览器最右边。
- 同步微调右侧栏自身的右内边距，避免两层留白叠加过重。

验证方式：
- 刷新 `/agent-platform`，确认右侧整栏和浏览器右边缘之间有明确缓冲带。
- 观察右侧最外层边框与滚动条是否仍有“被吃掉”的感觉。

下一步建议：
- 如果仍有裁切感，继续缩一点右侧栏列宽并重算三栏比例。
- 开始接右侧真实工作台内容。

## 2026-04-24：收紧 workspace-host 本身的盒模型

本次目标：
- 针对 `workspace-host` 本身处理右边缘疑似被裁切的问题。

修改文件：
- `frontend/src/views/AgentPlatform.vue`
- `docs/agent-platform/DEVELOPMENT_PROGRESS.md`

完成内容：
- 给 `workspace-host` 增加：
  - `width: 100%`
  - `max-width: 100%`
  - `justify-self: stretch`
- 让右侧宿主明确按网格列宽铺满，而不是在某些布局状态下出现额外外溢。

验证方式：
- 刷新 `/agent-platform`，观察右侧宿主最外层是否还像被挤出或裁切。

下一步建议：
- 如果还有问题，继续直接缩右侧列宽比例并重算三栏布局。
- 开始接右侧真实工作台内容。
## 2026-04-24：重写 AgentPlatform.vue，清理乱码与失控状态

本次目标：
- `frontend/src/views/AgentPlatform.vue` 之前经过多轮修改后出现大量乱码、布局状态交织和局部逻辑失控，先整体重写成一份干净、可维护、可继续迭代的版本。

修改文件：
- `frontend/src/views/AgentPlatform.vue`
- `docs/agent-platform/DEVELOPMENT_PROGRESS.md`

完成内容：
- 重新搭建三栏桌面骨架：
  - 左侧项目与会话导航
  - 中间聊天与项目空间切换
  - 右侧工作台宿主
- 清理原先混杂的乱码文本与重复状态，统一为可读的中文文案。
- 保留当前需要的核心交互：
  - 新建会话
  - 新建项目
  - 项目空间切换
  - 会话切换
  - 工作台隐藏 / 全屏
- 右侧工作台改回稳定的宿主结构，先保证页面稳，再继续往真实工作台能力上接。
- 重新整理深色主题样式、滚动区、面板层级与空状态展示。

验证方式：
- 使用 `@vue/compiler-sfc` 对 `AgentPlatform.vue` 做解析与模板编译校验。
- 校验结果：
  - `parseErrors: []`
  - `templateErrors: []`
  - `templateTips: []`

下一步建议：
- 继续把右侧工作台接成真实的“文档写作工作台”。
- 再把会话、项目空间与 WorkContext 的真实数据连接起来。
## 2026-04-24：旧前端剥离后收敛 Agent Platform 第一版入口

本次目标：
- 根据开发文档重新对齐当前阶段范围，不再沿旧聊天、登录、任务页面继续修补。
- 在旧前端代码删除后，让前端入口直接进入 Agent Platform。
- 将 Agent Platform 页面收敛为第一阶段最小工作台：Agent、ModelProfile、Run、Step、ModelInvocation。

修改文件：
- `frontend/src/App.vue`
- `frontend/src/views/AgentPlatform.vue`
- `frontend/src/api/agentPlatform.ts`
- `frontend/src/stores/chat.ts`
- `docs/agent-platform/DEVELOPMENT_PROGRESS.md`

完成内容：
- `App.vue` 不再依赖已删除的 router，直接渲染 `AgentPlatform`。
- 删除旧聊天 store，避免引用已删除的旧聊天 API。
- 重写 `AgentPlatform.vue`，移除会话、项目、复杂右侧工作台等超出第一阶段范围的 UI。
- 新页面支持：
  - Agent 列表与选择
  - ModelProfile 列表
  - 创建 Agent
  - 创建 ModelProfile
  - 发布 AgentVersion
  - 运行当前 Agent
  - 查看最近 Run
  - 查看 Run Steps
  - 查看 Model Invocations
- 补齐 `agentPlatform.ts` 中创建 Agent、创建 ModelProfile、发布 AgentVersion、运行 Agent 的前端 API 封装。

验证方式：
- `agent-platform-node` 执行 `npm.cmd run typecheck` 通过。
- `frontend` 执行 `npm.cmd run build` 通过。
- 首次普通沙箱构建在 Vite 启动 esbuild 子进程时触发 `spawn EPERM`，提升权限重跑后构建成功。

未完成事项：
- 前端当前仍是第一阶段运行调试台，暂未做 WorkContext / Artifact 可视化。
- 生产构建提示单包超过 500 kB，后续可按需做 Element Plus / 页面级 code splitting。

下一步建议：
- 启动 Node 服务和前端 dev server，使用 `builtin_browser_agent` 做一次真实页面验收。
- 若第一阶段验收稳定，再进入 Phase 2 的 WorkContext / Artifact 前端展示。

## 2026-04-27：补充 Phase 2 WorkContext / Artifact 落地设计文档

本次目标：

- 基于当前已经存在的 `projects / sessions / work_contexts / agent_artifacts / orchestration / runs` 实现，明确 Phase 2 下一步怎么落地。
- 把“右侧工作台接真实内容”“会话与 WorkContext 的真实连接”“Artifact 类型与角色”写成一份可直接拆任务的设计文档。

修改文件：

- `docs/agent-platform/PHASE2_WORKCONTEXT_ARTIFACT_DELIVERY_DESIGN.md`
- `docs/agent-platform/DEVELOPMENT_PROGRESS.md`

完成内容：

- 明确当前后端和前端已具备的基础能力与主要缺口。
- 收口 `WorkContext / Run / Artifact` 的职责边界。
- 定义 Artifact 第一阶段的 `artifactType` 与 `artifactRole` 体系。
- 明确右侧工作台应围绕 `selectedWorkContext / selectedArtifact / selectedRun` 组织，而不是继续使用说明页式布局。
- 给出异步链路 `chat -> runId -> SSE -> run completed -> refresh workbench` 的前端真实状态流。
- 给出后端字段扩展、聚合接口、前端状态抽离、组件拆分和分阶段验收标准。

验证方式：

- 对照当前实现确认前端已有 `workspaceTabs = ["上下文", "产物", "执行过程"]` 雏形。
- 对照当前实现确认 `chat` 为立即返回、异步执行、依赖 SSE 追踪进度。
- 对照当前实现确认已有 `listWorkContexts / listArtifacts / listRuns / listRunSteps` 的调用路径可作为 Phase 2 收敛基础。

下一步建议：

- 先扩展 Artifact 字段与协议，新增 `artifactRole` 和来源血缘字段。
- 再抽离工作台状态层，收口 `selectedWorkContext / selectedArtifact / selectedRun`。
- 随后直接改造右侧工作台，让“上下文 / 产物 / 执行过程”三 tab 进入真实渲染阶段。

## 2026-04-27：打通 Tool Candidate -> Agent Decision -> Artifact 沉淀 -> 右侧工作台联动 最小闭环

本次目标：

- 在不新增数据库表和字段的前提下，把现有 `agent_artifacts / work_contexts / agent_runs.outputArtifactIdsJson` 真正用起来。
- 让工具输出不再只停留在 `RunStep.output`，而是能先形成候选产物，再由 Agent 决定是否保留、保留为什么角色，最终沉淀为 Artifact。
- 让前端右侧 `产物 / 执行过程` 两个区域能随着 run 完成后的真实数据刷新，自动看到新产物和最新执行记录。

修改文件：

- `agent-platform-node/src/tools/tool-types.ts`
- `agent-platform-node/src/tools/tool-registry.ts`
- `agent-platform-node/src/modules/work-contexts/work-context.schema.ts`
- `agent-platform-node/src/modules/artifacts/artifact-builder.ts`
- `agent-platform-node/src/modules/artifacts/artifact-coordinator.ts`
- `agent-platform-node/src/modules/artifacts/artifact-directives.ts`
- `agent-platform-node/src/runtime/agent-runtime.ts`
- `agent-platform-node/src/runtime/model-client.ts`
- `frontend/src/views/AgentPlatform.vue`
- `docs/agent-platform/DEVELOPMENT_PROGRESS.md`

完成内容：

- 后端 Tool 层：
  - 为 `ToolResult` 增加 `artifactCandidates` 协议。
  - 为 `ToolArtifactCandidate` 增加 `candidateId`，用于后续 Agent decision 精确引用。
  - 给内置 mock browser 工具补上候选产物输出，先验证 `page/intermediate` 这类浏览类产物链路。

- 后端 Artifact 协调层：
  - 新增 `artifact-builder.ts`，负责把工具候选产物标准化为 `CreateArtifactInput`。
  - 新增 `artifact-coordinator.ts`，负责：
    - 为工具候选产物分配 `candidateId`
    - 按默认规则持久化未被显式处理的候选产物
    - 按 Agent decision 决定候选产物保留 / 丢弃 / 改写 `artifactRole`
    - 持久化 Agent 显式声明的 `declaredArtifacts`
    - 回写 `agent_runs.outputArtifactIdsJson`
  - 保持现有数据库不变，复用已有：
    - `agent_artifacts.artifactType`
    - `agent_artifacts.artifactRole`
    - `agent_artifacts.sourceRunId`
    - `agent_artifacts.sourceArtifactIdsJson`
    - `agent_runs.outputArtifactIdsJson`
    - `work_contexts.latestArtifactId`

- 后端 Agent Runtime：
  - 在 `agent-runtime.ts` 中引入 Artifact directive 解析与协调逻辑。
  - 约定 Agent 可在正常回复中嵌入：
    - `<artifact_directives>...</artifact_directives>`
  - directive 支持两类语义：
    - `artifactDecisions`：决定候选产物是否保留、保留为什么 `artifactRole`、是否改标题
    - `declaredArtifacts`：直接声明新的产物对象，例如 `text/final`
  - Runtime 会自动：
    - 解析 directives
    - 清理用户最终可见的回复内容，避免把机器协议暴露到 UI
    - 在模型结束前处理显式 decision
    - 对未被消费的候选产物按默认规则兜底落库

- 后端 Mock 验证链路：
  - 在 `model-client.ts` 的 mock provider 流程里，补了一个可验证的样例：
    - 工具返回候选页面产物
    - Mock Agent 显式把该候选产物标记为 `reference`
    - 同时声明一个 `text/final` 的摘要产物
  - 这样无需等真实 browser tool 完整接入，就能先验证整条产物沉淀链路。

- 后端 Schema/输入校验：
  - 放宽 `createArtifactSchema.contentJson`，支持对象和数组两种结构，便于后续存放表格行、集合项等结构化内容。

- 前端右侧工作台联动：
  - 在 `AgentPlatform.vue` 中补强右侧状态保持与自动选中逻辑：
    - 加载 session workbench 时自动选中最新 artifact
    - 刷新 `workContextRuns` 后保持已选 run，若不存在则回退到最新 run
    - 刷新 `workbench.artifacts` 后保持已选 artifact，若不存在则回退到最新 artifact
    - 在中间消息区展开 run 步骤时，自动切到右侧 `执行过程`
  - 让 run 完成后的 `onRunCompleted` 刷新链条与右侧工作台形成闭环：
    - `reload session runs`
    - `reload session workContexts`
    - `reselect current workContext`
    - `reload workContext runs`
    - `reload workbench artifacts`

验证方式：

- `agent-platform-node` 执行 `npm.cmd run typecheck` 通过。
- `frontend` 执行 `npm.cmd run build` 通过。
- 前端普通沙箱构建时，Vite / esbuild 启动子进程触发 `spawn EPERM`，提升权限重跑后构建成功。
- 通过 mock browser + mock model 的链路，已经具备以下验证能力：
  - 工具候选产物会出现在 tool result 中
  - Agent decision 能修改候选产物的 `artifactRole`
  - Agent 可声明 `declaredArtifacts`
  - run 的 `outputArtifactIdsJson` 会被写入
  - 前端右侧工作台刷新后可自动选中最新 artifact / run

当前边界说明：

- 本次没有新增数据库字段，也没有新增数据库表。
- 当前 Agent decision 协议已经接通，但真实效果仍取决于后续真实 agent prompt / tool 输出是否继续按该协议补齐。
- 当前验证主要基于 mock browser / mock model，真实 browser tool、writer tool 等还需要继续补 candidate 输出。

下一步建议：

- 把真实 `browser` / `writer` / `extract` 类工具接入 `artifactCandidates`，不再只依赖 mock tool。
- 在主 Agent / 子 Agent 的 system prompt 或版本配置里正式写入 artifact directive 规则，而不只是在 runtime 通用注入说明。
- 在右侧 `执行过程` 中展示 run 与 output artifacts 的关联，让“这次运行产出了什么”可以直接在执行面板里看到。
- 后续若要支持复杂派生链路，再评估是否新增独立的 artifact lineage / version 结构。

## 2026-04-27：将 Artifact Directive 启用方式从 Runtime 全局硬编码收口为 AgentVersion.contextPolicyJson 开关

本次目标：

- 解决 artifact directive 规则由 runtime 对所有 agent 全局注入的问题。
- 让 artifact directive 是否启用，改由各自 `AgentVersion.contextPolicyJson` 控制。
- 保持平台统一解析协议，但把“谁能用、能用到什么程度”的控制权收回到 AgentVersion 配置层。

修改文件：

- `agent-platform-node/src/modules/artifacts/artifact-directives.ts`
- `agent-platform-node/src/runtime/agent-runtime.ts`
- `agent-platform-node/src/runtime/model-client.ts`
- `docs/agent-platform/DEVELOPMENT_PROGRESS.md`

完成内容：

- 在 `artifact-directives.ts` 中新增 `parseArtifactDirectiveConfig(...)`。
- 约定 `contextPolicyJson` 可新增：
  - `artifactDirectives.enabled`
  - `artifactDirectives.mode`
- 当前支持两种 mode：
  - `decision_only`
    - 只允许 Agent 对工具候选产物做 `artifactDecisions`
    - 不允许额外声明 `declaredArtifacts`
  - `full`
    - 允许 `artifactDecisions`
    - 也允许 `declaredArtifacts`

- 在 `agent-runtime.ts` 中：
  - 从 `AgentVersion.contextPolicyJson` 解析 artifact directive 配置。
  - `renderSystemMessage()` 不再无条件注入 artifact directive 协议说明。
  - 只有当：
    - `artifactDirectives.enabled = true`
    才注入协议说明。
  - 并根据：
    - `mode = decision_only`
    - `mode = full`
    决定是否提示 `declaredArtifacts` 能力。

- 在 `model-client.ts` 的 mock provider 中同步对齐：
  - 只有 system message 中明确启用了 artifact directives，mock 才会返回 `<artifact_directives>...</artifact_directives>`。
  - 避免 runtime 关掉开关后，mock 行为仍然继续输出 directive，导致验证结果失真。

配置约定：

- 不启用：

```json
{
  "artifactDirectives": {
    "enabled": false
  }
}
```

- 只允许候选产物决策：

```json
{
  "artifactDirectives": {
    "enabled": true,
    "mode": "decision_only"
  }
}
```

- 允许完整产物声明：

```json
{
  "artifactDirectives": {
    "enabled": true,
    "mode": "full"
  }
}
```

- 与已有 `contextPolicyJson` 合并时，保留原字段不覆盖。例如：

```json
{
  "include_work_context_summary": false,
  "artifactDirectives": {
    "enabled": true,
    "mode": "decision_only"
  }
}
```

验证方式：

- `agent-platform-node` 执行 `npm.cmd run typecheck` 通过。
- 对照 runtime 拼装逻辑确认：
  - 未开启时，不注入 artifact directive 协议说明。
  - 开启 `decision_only` 时，只注入 `artifactDecisions` 提示。
  - 开启 `full` 时，额外注入 `declaredArtifacts` 提示。
- 对照 mock model 逻辑确认：
  - 只有启用时，mock 才输出 directive block。

设计结论：

- artifact directive 的“协议解析能力”继续留在平台 runtime。
- artifact directive 的“启用开关与使用级别”下沉到 `AgentVersion.contextPolicyJson`。
- `skillText` 继续承载业务规则，不再承担开/关控制。
- 当前不需要新增数据库字段，直接复用现有的 `contextPolicyJson` 即可。

下一步建议：

- 给现有 browser / writer / 子 agent version 明确配置默认 `artifactDirectives` 策略。
- Browser / extract 类 agent 优先使用 `decision_only`。
- Writer / summarizer 类 agent 优先使用 `full`。
- 后续如需做后台配置界面，再把该开关暴露到 AgentVersion 配置 UI 中。

## 2026-04-27：收敛 BrowserAgent 能力插件化方向（内置插件 / 外部插件）

本次目标：

- 不再把 Playwright、bb-browser、OpenCLI 这类外部能力直接耦合进 BrowserAgent 本体。
- 明确 BrowserAgent 后续应走“Agent 原生能力 + 插件扩展能力”的组织方式。
- 明确内置插件与外部插件的差异、装载方式，以及插件工具输出必须统一适配到平台 `ToolResult` / Artifact 流程中的原则。

设计结论：

- 子 Agent 最终能力由两部分组成：
  - Agent 自带能力
    - `systemPrompt`
    - `skillText`
    - 原生 `allowedTools`
    - 原生 `contextPolicy`
  - 插件扩展能力
    - 插件自带 `skill`
    - 插件提供的 `tools`
    - 插件补充的 `policy`

- BrowserAgent 后续不应直接绑定具体执行技术，而应通过插件获得浏览器能力。

- 浏览器能力插件后续分成两类：

  - **内置插件（builtin plugins）**
    - 平台自带
    - 默认可信
    - 当前阶段可默认装载到对应 Agent
    - 适合作为基础能力

  - **外部插件（external plugins）**
    - 需要显式安装
    - 需要显式挂载到 Agent / AgentVersion
    - 适合接第三方浏览器生态或专项网站能力

- 当前确定的插件装载策略：
  - **当前阶段**
    - 内置插件可以默认装载
    - 外部插件按需显式挂载
  - **后续后台管理阶段**
    - 新增/编辑 Agent 时，可以选择内置插件或外部插件
    - Agent 的最终能力由“原生能力 + 选中插件”共同决定

浏览器相关插件讨论结论：

- `Playwright`
  - 更适合作为长期服务态、通用自动化、复杂交互与调试兜底能力
  - 更适合做内置浏览器基础执行插件，例如：
    - `builtin-browser-playwright`

- `bb-browser`
  - 更适合作为桌面态、已登录浏览器状态复用、站点 adapter 能力插件
  - 更适合作为外部插件，例如：
    - `browser-bb-browser`

- `OpenCLI`
  - 也可作为外部浏览器能力插件候选
  - 但相较 `bb-browser`，当前对 BrowserAgent 的聚焦度稍弱，可作为备选路线保留

插件命名与工具命名原则：

- 插件名称用于标识能力包，例如：
  - `builtin-browser-core`
  - `builtin-browser-playwright`
  - `browser-bb-browser`
  - `browser-opencli`

- 工具名称用于标识实际能力入口。
- 后续推荐方向：
  - 插件内部可以有 provider 自己的工具实现命名
  - 平台对上应尽量收敛成统一 browser capability 协议
  - 避免让 Agent 直接面对多套高度相似但命名不同的工具集合

统一适配原则（已明确为平台约束）：

- 无论插件是内置还是外部：
  - 插件工具执行后的原始返回
  - **都不能直接进入系统**
  - 必须先适配为平台统一的 `ToolResult`

- 当前统一目标对象为：
  - `ToolResult.success`
  - `ToolResult.data`
  - `ToolResult.error`
  - `ToolResult.meta`
  - `ToolResult.artifactCandidates`

- 任何外部插件如果产生可沉淀结果：
  - 必须通过 `artifactCandidates`
  - 交给平台统一走：
    - `ArtifactBuilder`
    - `ArtifactCoordinator`
    - `WorkContext / Artifact / Run`
  - 外部插件不应直接写库

架构方向（后续实现目标）：

- 平台层：
  - 维护插件池
  - 区分内置插件与外部插件

- Agent / AgentVersion 层：
  - 维护挂载的插件集合
  - Agent 最终运行能力 = 原生能力 + 插件能力

- Runtime 层：
  - 合并 Agent 原生 skill / tools / policy
  - 合并插件 skill / tools / policy
  - 将插件工具返回统一适配为 `ToolResult`

下一步建议：

- 设计插件元数据结构：
  - `pluginId`
  - `pluginType`（builtin / external）
  - `skillText`
  - `tools`
  - `policyPatch`
  - `status`

- 设计 Agent / AgentVersion 的插件挂载关系。
- 设计插件工具适配层，确保 Playwright / bb-browser / OpenCLI 这类能力最终统一回到平台 `ToolResult` 和 Artifact 流程。

## 2026-04-27：新增 MCP 风格插件系统设计草案

本次目标：

- 将前面关于 BrowserAgent 插件化、内置插件 / 外部插件、以及是否遵循 MCP 的讨论收敛成一份正式设计文档。
- 明确插件系统应遵循 MCP 的能力分类思想（tools / resources / prompts），但继续保留平台自有 Runtime、ToolResult 与 Artifact 模型。

修改文件：

- `docs/agent-platform/MCP_STYLE_PLUGIN_SYSTEM_DESIGN.md`
- `docs/agent-platform/DEVELOPMENT_PROGRESS.md`

完成内容：

- 新增《MCP 风格插件系统设计草案》文档。
- 明确插件系统的设计原则：
  - Agent 原生能力与插件扩展能力分离
  - 插件分内置插件与外部插件
  - Runtime 负责最终合并
  - 外部插件结果必须统一适配为平台 `ToolResult`
- 明确 MCP 风格映射：
  - `tools`
  - `resources`
  - `prompts`
- 明确 BrowserAgent 后续的插件定位：
  - `builtin-browser-playwright`
  - `browser-bb-browser`
  - `browser-opencli`
- 明确后台管理的后续方向：
  - 新增/编辑 Agent 时可选择内置插件或外部插件
  - Agent 最终能力 = 原生能力 + 已挂载插件能力

下一步建议：

- 开始细化插件元数据结构与挂载关系。
- 开始设计后端插件注册表与 Runtime 装载流程。
- 开始设计插件工具返回统一适配层，与当前 `ToolResult / artifactCandidates` 流程对接。

## 2026-04-27：新增插件系统分阶段落地计划

本次目标：

- 将插件系统讨论从“概念方向”进一步推进到“按阶段可开发计划”。
- 明确当前插件系统是在优化现有哪块能力，以及应该按什么顺序落地。

修改文件：

- `docs/agent-platform/PLUGIN_SYSTEM_PHASED_IMPLEMENTATION_PLAN.md`
- `docs/agent-platform/DEVELOPMENT_PROGRESS.md`

完成内容：

- 新增《插件系统分阶段落地设计》文档。
- 明确当前插件系统要优化的几块能力：
  - Agent 原生能力与扩展能力仍然混在一起
  - 插件内容无法按需查询
  - 缺少统一插件查询工具
  - Runtime 还没有插件能力合并模型
- 明确分三个阶段推进：
  - Phase 1：定义插件对象模型与目录查询机制
  - Phase 2：接入 Runtime 合并逻辑
  - Phase 3：做最小内置插件验证闭环
- 明确当前建议实现顺序：
  - 定 `AgentPlugin` 正式结构
  - 定插件目录摘要注入格式
  - 定 `plugin.read_item` schema
  - 做 Runtime 合并逻辑
  - 接最小内置插件验证链路

下一步建议：

- 直接开始 Phase 1 的类型定义与 schema 设计。
- 先把 `AgentPlugin / PluginCatalogSummary / plugin.read_item` 这些对象定清楚，再开始写 Runtime 代码。
