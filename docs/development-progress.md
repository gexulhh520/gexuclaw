# Agent Platform 开发进度文档

## 项目概述
Agent Platform 是一个多智能体协作平台，支持主 Agent 智能委派、子 Agent 执行、实时步骤追踪等功能。

## 开发进度

### ✅ 已完成功能

#### 1. 数据库架构
- [x] 创建 `projects` 表 - 项目管理
- [x] 创建 `sessions` 表 - 会话管理
- [x] 修改 `work_contexts` 表 - 关联 projects/sessions
- [x] 创建 `agent_runs` 表 - 运行记录
- [x] 创建 `agent_run_steps` 表 - 执行步骤记录

#### 2. 后端 API
- [x] Projects API (CRUD)
- [x] Sessions API (CRUD)
- [x] WorkContexts API (CRUD)
- [x] Agents API (列表、创建、版本管理)
- [x] Model Profiles API
- [x] Runs API (查询运行记录)
- [x] Run Steps API (查询步骤详情)
- [x] SSE 实时推送 Run 步骤

#### 3. 主 Agent 智能委派
- [x] 两步确认机制
  - 第一步：初步判断（候选 WorkContext + 置信度）
  - 第二步：查询详情后最终决策
- [x] 支持 action 类型：delegate / clarify / respond
- [x] 链式委派（子 Agent 返回后主 Agent 继续判断）
- [x] 最大委派深度限制（防止无限循环）

#### 4. Agent Runtime
- [x] 模型调用（支持 OpenAI-compatible API）
- [x] 工具调用框架
- [x] 步骤追踪和记录
- [x] 事件总线（Event Bus）用于实时推送

#### 5. 前端界面
- [x] 项目空间管理
- [x] 会话列表和创建
- [x] 对话界面
- [x] 执行摘要和步骤展示
- [x] SSE 客户端接收实时更新
- [x] Agent 选择和管理

### 🚧 进行中功能

#### 1. 工作台细化
- [ ] 根据 `workspaceType` 动态切换右栏内容
  - browser: 浏览器预览
  - research: 文档阅读器
  - writing: 文档编辑器
  - video: 视频预览

#### 2. 优化和增强
- [ ] 历史 Run 记录查看
- [ ] 执行步骤详情展开
- [ ] 错误处理和重试机制
- [ ] 性能优化

### 📋 待开发功能

#### 1. 记忆系统
- [ ] 长期记忆存储
- [ ] 上下文压缩
- [ ] 记忆检索

#### 2. 工具生态
- [ ] 浏览器自动化工具
- [ ] 文档处理工具
- [ ] 代码执行工具
- [ ] 外部 API 集成

#### 3. 多模态支持
- [ ] 图片处理
- [ ] 视频处理
- [ ] 文件上传/下载

#### 4. 部署和运维
- [ ] Docker 容器化
- [ ] 生产环境配置
- [ ] 监控和日志
- [ ] 备份和恢复

## 技术栈

### 后端
- **框架**: Fastify + TypeScript
- **数据库**: SQLite (Drizzle ORM)
- **AI 模型**: OpenAI-compatible API (Kimi/OpenAI)
- **实时通信**: Server-Sent Events (SSE)

### 前端
- **框架**: Vue 3 + TypeScript
- **UI 库**: Element Plus
- **状态管理**: Vue Composition API
- **HTTP 客户端**: Axios
- **实时通信**: EventSource (SSE)

## API 接口列表

### Projects
- `GET /api/agent-platform/projects` - 列表
- `POST /api/agent-platform/projects` - 创建
- `GET /api/agent-platform/projects/:id` - 详情

### Sessions
- `GET /api/agent-platform/sessions` - 列表
- `POST /api/agent-platform/sessions` - 创建
- `GET /api/agent-platform/sessions/:id` - 详情

### WorkContexts
- `GET /api/agent-platform/work-contexts` - 列表
- `POST /api/agent-platform/work-contexts` - 创建
- `GET /api/agent-platform/work-contexts/:id` - 详情

### Agents
- `GET /api/agent-platform/agents` - 列表
- `POST /api/agent-platform/agents` - 创建
- `GET /api/agent-platform/agents/:id/versions` - 版本列表
- `POST /api/agent-platform/agents/:id/versions` - 创建版本

### Runs
- `GET /api/agent-platform/runs` - 列表
- `GET /api/agent-platform/runs/:id` - 详情（包含步骤）
- `GET /api/agent-platform/runs/:id/stream` - SSE 实时推送

### Orchestration
- `POST /api/agent-platform/orchestration/chat` - 主 Agent 智能委派

## 测试指南

### 1. 启动后端
```bash
cd agent-platform-node
npm install
npm run dev
```

### 2. 启动前端
```bash
cd frontend
npm install
npm run dev
```

### 3. 测试流程
1. 打开前端页面 (http://localhost:5173)
2. 创建一个项目或选择已有项目
3. 创建一个会话
4. 发送消息，例如："帮我写一篇关于人工智能的文章"
5. 观察执行摘要和步骤的实时更新

### 4. 预期结果
- 用户消息显示在对话中
- 助手回复包含 LLM 的回复内容
- 执行摘要卡片显示 Run ID、状态、步骤数
- 点击"查看步骤"可展开查看详细执行步骤
- 如果 Run 正在执行，步骤会实时推送并显示

## 项目结构

```
gexuclaw/
├── agent-platform-node/      # 后端
│   ├── src/
│   │   ├── db/              # 数据库配置和 schema
│   │   ├── modules/         # 业务模块
│   │   │   ├── agents/      # Agent 管理
│   │   │   ├── orchestration/  # 主 Agent 编排
│   │   │   ├── projects/    # 项目管理
│   │   │   ├── sessions/    # 会话管理
│   │   │   └── runs/        # 运行记录
│   │   ├── runtime/         # Agent 运行时
│   │   ├── shared/          # 共享工具
│   │   └── app.ts           # 应用入口
│   └── package.json
├── frontend/                 # 前端
│   ├── src/
│   │   ├── api/             # API 接口
│   │   ├── views/           # 页面视图
│   │   │   └── AgentPlatform.vue
│   │   └── ...
│   └── package.json
└── docs/                    # 文档
    └── development-progress.md
```

## 最近更新

### 2024-04-26
- ✅ 实现前端 SSE 接收
- ✅ 优化执行摘要和步骤展示
- ✅ 修复类型错误
- ✅ 完成类型检查

### 2024-04-25
- ✅ 实现后端 SSE 实时推送
- ✅ 实现事件总线系统
- ✅ 添加 Run Steps API

### 2024-04-24
- ✅ 实现主 Agent 两步确认机制
- ✅ 实现链式委派
- ✅ 添加详细日志

## 下一步计划

1. **细化右栏工作台** - 根据 workspaceType 动态切换内容
2. **历史记录查看** - 支持查看历史 Run 详情
3. **错误处理优化** - 完善错误提示和重试机制
4. **性能优化** - 优化大数据量下的渲染性能

## 注意事项

1. 当前使用 mock provider 进行测试，需要配置真实 API key 才能使用真实模型
2. SSE 连接在页面刷新后会断开，需要重新订阅
3. 数据库使用 SQLite，适合开发和测试，生产环境建议切换到 PostgreSQL
