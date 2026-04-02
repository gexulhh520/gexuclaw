# GexuLaw Agent 智能体系统

一个完整的 Agent 智能体系统，基于现代技术栈构建。

## 架构概览

```
Vue3 客户端（Web / App）
         ↓
 API Gateway（鉴权 / 限流 / 路由）
         ↓
 FastAPI（入口层）
         ↓
 Session Manager（上下文 / 会话）
         ↓
 Task Queue（Celery）
         ↓
 Worker（Agent执行引擎）
         ↓
 LangGraph（核心编排）
         ↓
 ┌────────────────────────────┐
 │   LLM Client（统一入口）     │
 │  chat / stream / embedding │
 └────────────┬───────────────┘
              ↓
      Provider（OpenAI等）
              ↓
           大模型
```

## 技术栈

### 后端
- **FastAPI**: API 网关和入口层
- **Celery**: 任务队列
- **Redis**: 缓存、会话、消息队列
- **LangGraph**: Agent 编排
- **SQLAlchemy**: ORM
- **PostgreSQL**: 持久化存储
- **Qdrant/Chroma**: 向量数据库

### 前端
- **Vue 3**: 前端框架
- **TypeScript**: 类型安全
- **Pinia**: 状态管理
- **Vue Router**: 路由管理
- **Axios**: HTTP 客户端
- **WebSocket**: 实时通信

## 项目结构

```
gexuclaw/
├── backend/              # 后端代码
│   ├── api/             # FastAPI 路由
│   ├── core/            # 核心配置
│   ├── models/          # 数据模型
│   ├── schemas/         # Pydantic 模式
│   ├── services/        # 业务逻辑
│   ├── agents/          # LangGraph Agents
│   ├── llm/             # LLM 客户端
│   ├── workers/         # Celery Workers
│   └── websocket/       # WebSocket 处理
├── frontend/            # 前端代码
│   ├── src/
│   │   ├── components/
│   │   ├── views/
│   │   ├── stores/
│   │   └── api/
└── docker/              # Docker 配置
```

## 快速开始

### 后端启动

```bash
cd backend
pip install -r requirements.txt

# 安装浏览器自动化依赖（如需使用浏览器工具）
python -m playwright install chromium

uvicorn main:app --reload
```

### 前端启动

```bash
cd frontend
npm install
npm run dev
```

## 浏览器自动化工具

系统内置浏览器自动化工具，支持 Chrome/Edge 浏览器控制。

### 安装浏览器依赖

```bash
# 安装 Playwright 和 Chromium
pip install playwright
python -m playwright install chromium
```

### 浏览器工具功能

- **Profile 管理**: 创建、删除、列出浏览器配置文件
- **浏览器控制**: 启动、停止浏览器（支持无头模式）
- **页面操作**: 导航、点击、输入、获取文本
- **截图**: 页面截图（支持 base64 或保存文件）
- **JavaScript 执行**: 在页面中执行自定义脚本

### 使用示例

AI Agent 可以调用以下操作：
1. `browser.create_profile` - 创建浏览器 Profile
2. `browser.launch_browser` - 启动浏览器
3. `browser.navigate` - 访问网页
4. `browser.fill` / `browser.click` - 填写表单/点击按钮
5. `browser.screenshot` - 截图保存证据
