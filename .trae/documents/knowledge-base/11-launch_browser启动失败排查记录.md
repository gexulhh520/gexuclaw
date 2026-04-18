# launch_browser 启动失败排查记录

## 文档信息

- 文档编号：`KB-11`
- 文档类型：问题排查记录
- 所属目录：`.trae/documents/knowledge-base/`
- 创建时间：`2026-04-18`
- 最近更新时间：`2026-04-18`

## 时间线

### 2026-04-18 12:00:00

- 接到 `launch_browser` 启动浏览器失败反馈
- 读取浏览器工具、TaskBrowserManager、ChromeFinder 实现
- 使用现有浏览器测试脚本在后端环境直接复现
- 结果显示 `launch_browser` 在当前机器和当前环境下可以正常启动

### 2026-04-18 12:22:25

- 收到 Celery Worker 内的真实报错堆栈
- 定位到 `playwright -> asyncio.create_subprocess_exec -> NotImplementedError`
- 确认根因是 Windows Worker 使用了 `SelectorEventLoop`，不支持浏览器子进程
- 完成修复：Windows 下 Agent Worker 改为 Proactor 事件循环，并跳过 AsyncPostgresSaver

## 关联文档

- [00-知识库文档导航.md](file:///d:/戈旭接的项目/gexuclaw/.trae/documents/knowledge-base/00-知识库文档导航.md)
- [04-知识库实现记录.md](file:///d:/戈旭接的项目/gexuclaw/.trae/documents/knowledge-base/04-知识库实现记录.md)

## 一、排查范围

本次重点检查：

1. `backend/tools/browser/tool.py`
2. `backend/tools/browser/task_browser_manager.py`
3. `backend/tools/browser/chrome_finder.py`
4. `backend/tools/browser/test_markdown.py`

---

## 二、排查结果

### 2.1 launch_browser 实现

当前 `launch_browser` 的流程为：

1. 调用 `TaskBrowserManager.create_session()`
2. 优先查找本机 Chrome/Edge
3. 若找到则使用本机浏览器启动
4. 若找不到则回退到 Playwright Chromium

### 2.2 本地环境复现结果

使用现有脚本：

- `python tools/browser/test_markdown.py`

复现结果：

1. 成功找到本机 Chrome
2. 成功启动浏览器 session
3. 成功导航页面
4. 成功获取页面 Markdown
5. 成功关闭浏览器 session

因此可以确认：

- `launch_browser` 在当前本机环境下是可用的

### 2.3 真实根因

新的 Worker 日志显示失败点不是 Chrome 查找，也不是 Playwright 安装缺失，而是：

- `asyncio.create_subprocess_exec(...)`
- `NotImplementedError`

这在 Windows 上通常表示：

- 当前事件循环不支持 subprocess

进一步结合 `backend/workers/tasks.py` 可确认：

- Agent Worker 之前强制使用了 `WindowsSelectorEventLoopPolicy`
- 而 Playwright 启动浏览器需要可创建子进程的事件循环
- 两者冲突，导致 `launch_browser` 在 Celery Worker 里失败

---

## 三、当前判断

当前已经确认：

1. `launch_browser` 底层实现本身不是“完全不可用”
2. 真正问题出在 Windows Celery Worker 的事件循环策略
3. 浏览器子进程和 AsyncPostgresSaver 在同一事件循环策略下存在兼容冲突

---

## 四、建议

本次修复方案：

1. Windows 下 `execute_agent_task` 改为使用 Proactor 事件循环
2. Windows Worker 中跳过 `AsyncPostgresSaver`，回退为 `MemorySaver`
3. 优先保证浏览器工具可正常启动
