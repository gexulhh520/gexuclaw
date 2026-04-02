# Browser Manager 重构计划：从 CDP 连接到 Playwright 直接启动

## 一、当前架构问题分析

### 当前流程
```
Celery Worker 启动
    └── BrowserController (单例)
            └── 每次任务调用 _ensure_playwright()
                    └── 停止旧实例 → 创建新 Playwright 实例
                            └── connect_over_cdp() 连接到外部 Chrome
                                    └── 创建 BrowserSession (context + page)
```

### 问题
1. **CDP 连接不稳定**：`connect_over_cdp` 经常出现 `'NoneType' object has no attribute 'send'` 错误
2. **Playwright 实例频繁重建**：每次任务都重建，导致性能问题和连接不稳定
3. **依赖外部 Chrome 进程**：需要单独管理 Chrome 进程生命周期
4. **Session 管理复杂**：需要同时管理 Playwright 实例、Browser 连接、Session

## 二、目标架构

### 新流程
```
Celery Worker 启动时
    └── BrowserManager (单例，Worker 生命周期内只初始化一次)
            └── self._playwright = await async_playwright().start()
            └── self._browser = await self._playwright.chromium.launch()
                    
任务执行时
    └── BrowserManager.get_or_create_context(session_id)
            └── 返回 BrowserContext (每个 session_id 一个 context)
                    └── 任务内：context.new_page() → 执行操作 → page.close()
```

### 架构对比

| 组件 | 旧架构 | 新架构 |
|------|--------|--------|
| **Browser 实例** | 通过 CDP 连接外部 Chrome | Playwright 直接启动 |
| **Playwright 生命周期** | 每次任务重建 | Worker 启动时创建，一直复用 |
| **Context 管理** | 每个 Session 创建 | session_id → Context 映射，复用 |
| **Page 管理** | Session 内长期持有 | 每次任务创建/关闭 |
| **Chrome 进程** | 外部管理 | Playwright 内部管理 |

## 三、具体修改步骤

### 步骤 1: 创建 BrowserManager 类（替换 BrowserController）

**文件**: `backend/tools/browser/browser_manager.py` (新建)

```python
"""
Browser Manager 模块
Worker 启动时初始化一个 Browser 实例，管理多个 Session Context
"""

import asyncio
from typing import Dict, Optional, Any
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from playwright.async_api import async_playwright, Browser, BrowserContext, Page


@dataclass
class SessionContext:
    """会话上下文"""
    session_id: str
    context: BrowserContext
    created_at: datetime = field(default_factory=datetime.now)
    last_used_at: datetime = field(default_factory=datetime.now)
    
    def touch(self):
        """更新最后使用时间"""
        self.last_used_at = datetime.now()
    
    @property
    def is_expired(self, timeout_minutes: int = 30) -> bool:
        """检查是否过期（默认30分钟）"""
        return datetime.now() - self.last_used_at > timedelta(minutes=timeout_minutes)


class BrowserManager:
    """
    Browser 管理器（Worker 级别单例）
    - 管理一个 Browser 实例（Worker 生命周期）
    - 管理 session_id → SessionContext 映射
    - 提供 get_or_create_context(session_id) 方法
    - 定期清理过期 context
    """
    
    def __init__(self):
        self._playwright = None
        self._browser: Optional[Browser] = None
        self._contexts: Dict[str, SessionContext] = {}
        self._lock = asyncio.Lock()
        self._initialized = False
    
    async def initialize(self):
        """初始化 Playwright 和 Browser（Worker 启动时调用一次）"""
        if self._initialized:
            return
            
        async with self._lock:
            if self._initialized:
                return
                
            print(f"[BrowserManager] 初始化 Playwright...")
            self._playwright = await async_playwright().start()
            
            print(f"[BrowserManager] 启动 Browser...")
            self._browser = await self._playwright.chromium.launch(
                headless=True,  # 默认无头，可通过参数控制
                args=['--no-sandbox', '--disable-setuid-sandbox']
            )
            
            self._initialized = True
            print(f"[BrowserManager] 初始化完成")
    
    async def get_or_create_context(self, session_id: str) -> BrowserContext:
        """
        获取或创建 Session Context
        
        Args:
            session_id: 会话 ID
            
        Returns:
            BrowserContext: 浏览器上下文
        """
        await self.initialize()
        
        async with self._lock:
            # 检查是否已存在
            if session_id in self._contexts:
                session_ctx = self._contexts[session_id]
                session_ctx.touch()
                print(f"[BrowserManager] 复用已有 Context: {session_id}")
                return session_ctx.context
            
            # 创建新的 context
            print(f"[BrowserManager] 创建新 Context: {session_id}")
            context = await self._browser.new_context(
                viewport={'width': 1920, 'height': 1080},
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            )
            
            session_ctx = SessionContext(
                session_id=session_id,
                context=context
            )
            self._contexts[session_id] = session_ctx
            return context
    
    async def close_context(self, session_id: str):
        """关闭指定 session 的 context"""
        async with self._lock:
            session_ctx = self._contexts.get(session_id)
            if session_ctx:
                try:
                    await session_ctx.context.close()
                    print(f"[BrowserManager] 关闭 Context: {session_id}")
                except Exception as e:
                    print(f"[BrowserManager] 关闭 Context {session_id} 失败: {e}")
                finally:
                    del self._contexts[session_id]
    
    async def cleanup_expired_contexts(self, timeout_minutes: int = 30):
        """清理过期的 contexts"""
        expired_sessions = []
        for session_id, session_ctx in self._contexts.items():
            if session_ctx.is_expired(timeout_minutes):
                expired_sessions.append(session_id)
        
        for session_id in expired_sessions:
            await self.close_context(session_id)
            print(f"[BrowserManager] 清理过期 Context: {session_id}")
    
    async def shutdown(self):
        """关闭 Browser 和 Playwright（Worker 停止时调用）"""
        async with self._lock:
            # 关闭所有 contexts
            for session_id in list(self._contexts.keys()):
                await self.close_context(session_id)
            
            # 关闭 browser
            if self._browser:
                await self._browser.close()
                self._browser = None
            
            # 停止 playwright
            if self._playwright:
                await self._playwright.stop()
                self._playwright = None
            
            self._initialized = False
            print(f"[BrowserManager] 已关闭")


# 全局 BrowserManager 实例
_browser_manager: Optional[BrowserManager] = None


def get_browser_manager() -> BrowserManager:
    """获取全局 BrowserManager 实例"""
    global _browser_manager
    if _browser_manager is None:
        _browser_manager = BrowserManager()
    return _browser_manager
```

### 步骤 2: 修改 BrowserTool 使用 BrowserManager

**文件**: `backend/tools/browser/tool.py`

```python
# 移除旧的导入
# from .browser_controller import get_browser_controller
# 改为新的导入
from .browser_manager import get_browser_manager

class BrowserTool(BaseTool):
    def __init__(self):
        super().__init__()
        self._profile_manager = get_profile_manager()
        # self._browser_controller = get_browser_controller()  # 移除
        self._browser_manager = get_browser_manager()  # 新增
        self._session_manager = get_session_manager()  # 保留用于 session 元数据
    
    async def launch_browser(self, profile_name: str, headless: bool = True, 
                           url: Optional[str] = None, 
                           browser_session_id: Optional[str] = None) -> ToolResult:
        """
        启动浏览器会话
        现在只是获取/创建 context，不实际启动新进程
        """
        try:
            if not browser_session_id:
                return ToolResult(False, error="browser_session_id 不能为空")
            
            # 获取或创建 context（复用机制）
            context = await self._browser_manager.get_or_create_context(browser_session_id)
            
            # 创建新 page（每次任务独立）
            page = await context.new_page()
            
            # 如果指定了 URL，导航到该页面
            if url:
                await page.goto(url, wait_until="networkidle")
            
            # 保存 page 引用（后续操作使用）
            # 这里需要临时存储 page，后续操作通过 session_id 找到 page
            await self._session_manager.create_page_holder(browser_session_id, page)
            
            return ToolResult(
                True,
                data={
                    "session_id": browser_session_id,
                    "url": url or "about:blank",
                },
                meta={"message": f"浏览器会话已启动（Session: {browser_session_id}）"},
            )
        except Exception as e:
            return ToolResult(False, error=str(e))
    
    async def navigate(self, session_id: str, url: str) -> ToolResult:
        """导航到指定 URL"""
        try:
            page = await self._session_manager.get_page(session_id)
            if not page:
                return ToolResult(False, error=f"Session '{session_id}' 不存在或已关闭")
            
            await page.goto(url, wait_until="networkidle")
            return ToolResult(True, data={"url": url})
        except Exception as e:
            return ToolResult(False, error=str(e))
    
    async def click(self, session_id: str, selector: str) -> ToolResult:
        """点击元素"""
        try:
            page = await self._session_manager.get_page(session_id)
            if not page:
                return ToolResult(False, error=f"Session '{session_id}' 不存在")
            
            await page.click(selector)
            return ToolResult(True, data={"action": "click", "selector": selector})
        except Exception as e:
            return ToolResult(False, error=str(e))
    
    # 其他操作类似...
    
    async def close_session(self, session_id: str) -> ToolResult:
        """关闭会话（关闭 page，但不关闭 context）"""
        try:
            # 关闭 page
            page = await self._session_manager.get_page(session_id)
            if page:
                await page.close()
            
            # 从 session_manager 移除
            await self._session_manager.remove_page(session_id)
            
            return ToolResult(True, data={"session_id": session_id})
        except Exception as e:
            return ToolResult(False, error=str(e))
```

### 步骤 3: 修改 SessionManager 支持 Page 管理

**文件**: `backend/tools/browser/session_manager.py`

```python
# 新增 Page 管理功能
class SessionManager:
    def __init__(self):
        self._sessions: Dict[str, BrowserSession] = {}
        self._pages: Dict[str, Page] = {}  # 新增：session_id -> Page 映射
        self._lock = asyncio.Lock()
    
    async def create_page_holder(self, session_id: str, page: Page):
        """临时存储 page 引用（任务期间使用）"""
        async with self._lock:
            self._pages[session_id] = page
    
    async def get_page(self, session_id: str) -> Optional[Page]:
        """获取 page 引用"""
        async with self._lock:
            return self._pages.get(session_id)
    
    async def remove_page(self, session_id: str):
        """移除 page 引用"""
        async with self._lock:
            if session_id in self._pages:
                del self._pages[session_id]
```

### 步骤 4: Celery Worker 启动时初始化 BrowserManager

**文件**: `backend/workers/celery_app.py`

```python
from tools.browser.browser_manager import get_browser_manager

# Worker 启动时初始化 BrowserManager
@worker_init.connect
def init_worker(**kwargs):
    print("[Worker] 初始化 BrowserManager...")
    import asyncio
    browser_manager = get_browser_manager()
    asyncio.run(browser_manager.initialize())
    print("[Worker] BrowserManager 初始化完成")

# Worker 停止时关闭 BrowserManager
@worker_shutdown.connect  
def shutdown_worker(**kwargs):
    print("[Worker] 关闭 BrowserManager...")
    import asyncio
    browser_manager = get_browser_manager()
    asyncio.run(browser_manager.shutdown())
    print("[Worker] BrowserManager 已关闭")
```

### 步骤 5: 移除旧的 ChromeLauncher 和 BrowserController

**删除或废弃的文件**:
- `backend/tools/browser/chrome_launcher.py` (不再需要，Playwright 自己管理 Chrome)
- `backend/tools/browser/browser_controller.py` (被 BrowserManager 替代)

**修改 ProfileManager**:
- 不再需要管理 `cdp_port`（Playwright 自己分配端口）
- 保留 `user_data_dir` 用于持久化（如果需要）

### 步骤 6: 更新工具操作定义

**文件**: `backend/tools/browser/tool.py`

```python
def _register_operations(self):
    self.operations = {
        "launch_browser": ToolOperation(
            name="launch_browser",
            description="启动浏览器会话（获取或复用 context）",
            parameters=[
                {
                    "name": "browser_session_id",
                    "type": "string",
                    "required": True,
                    "description": "浏览器会话 ID（由系统生成）",
                },
                {
                    "name": "url",
                    "type": "string",
                    "required": False,
                    "description": "启动后导航到的 URL",
                },
            ],
            func=self.launch_browser,
        ),
        # 其他操作...
    }
```

## 四、文件修改清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `tools/browser/browser_manager.py` | 新建 | 新的 BrowserManager 类 |
| `tools/browser/browser_controller.py` | 删除 | 被 BrowserManager 替代 |
| `tools/browser/chrome_launcher.py` | 删除 | Playwright 自己管理 Chrome |
| `tools/browser/session_manager.py` | 修改 | 添加 Page 管理功能 |
| `tools/browser/tool.py` | 修改 | 使用 BrowserManager |
| `tools/browser/profile_manager.py` | 修改 | 移除 cdp_port 相关逻辑 |
| `workers/celery_app.py` | 修改 | Worker 启动/停止时管理 BrowserManager |

## 五、使用规范

### 任务执行流程
```python
# 1. 获取 context（自动复用或创建）
context = await browser_manager.get_or_create_context(session_id)

# 2. 创建 page（每个任务独立）
page = await context.new_page()

# 3. 执行操作
try:
    await page.goto(url)
    await page.click(selector)
    # ...
finally:
    # 4. 关闭 page（必须！）
    await page.close()
```

### 生命周期管理
- **Worker 启动**: 初始化 BrowserManager（启动 Playwright + Browser）
- **任务执行**: 获取/复用 Context → 创建 Page → 执行 → 关闭 Page
- **Context 过期**: 30分钟未使用自动清理
- **Worker 停止**: 关闭所有 Context → 关闭 Browser → 停止 Playwright

## 六、预期效果

重构后：
- ✅ **稳定性提升**：不再依赖 CDP 连接，避免 `'NoneType' object has no attribute 'send'` 错误
- ✅ **性能提升**：Playwright 实例只创建一次，Context 可复用
- ✅ **简化架构**：不再需要管理外部 Chrome 进程
- ✅ **资源管理**：自动清理过期 Context，避免内存泄漏
- ✅ **并发支持**：每个 Session 独立 Context，任务间隔离
