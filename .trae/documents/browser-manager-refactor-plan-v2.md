# Browser Manager 重构计划 V2：使用外部 Chrome 但改为 launch 方式

## 一、当前架构问题分析

### 当前流程（问题版本）
```
Celery Worker 启动
    └── BrowserController (单例)
            └── 每次任务调用 _ensure_playwright()
                    └── 停止旧实例 → 创建新 Playwright 实例
                            └── connect_over_cdp() 连接到外部 Chrome
                                    └── 创建 BrowserSession (context + page)
```

**问题**：`connect_over_cdp` 连接不稳定，出现 `'NoneType' object has no attribute 'send'`

### 新架构（解决方案）
```
Celery Worker 启动时
    └── BrowserManager (单例，Worker 生命周期内只初始化一次)
            └── self._playwright = await async_playwright().start()
            └── self._browser = await self._playwright.chromium.launch(
                    executable_path="C:\Program Files\Google\Chrome\Application\chrome.exe",
                    args=['--remote-debugging-port=0']  # 让 Playwright 自己管理
                )
                    
任务执行时
    └── BrowserManager.get_or_create_context(session_id)
            └── 返回 BrowserContext (每个 session_id 一个 context)
                    └── 任务内：context.new_page() → 执行操作 → page.close()
```

**关键区别**：
- 旧：`connect_over_cdp()` - 通过 CDP 协议连接到已运行的 Chrome
- 新：`chromium.launch()` - Playwright 启动并管理 Chrome 进程

## 二、具体修改步骤

### 步骤 1: 创建 BrowserManager 类

**文件**: `backend/tools/browser/browser_manager.py` (新建)

```python
"""
Browser Manager 模块
Worker 启动时初始化 Playwright 并启动外部 Chrome，管理多个 Session Context
"""

import asyncio
import platform
import os
from typing import Dict, Optional, Any, List
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
    - 启动并管理一个外部 Chrome 进程（通过 Playwright）
    - 管理 session_id → SessionContext 映射
    - 提供 get_or_create_context(session_id) 方法
    """
    
    def __init__(self):
        self._playwright = None
        self._browser: Optional[Browser] = None
        self._contexts: Dict[str, SessionContext] = {}
        self._lock = asyncio.Lock()
        self._initialized = False
        self._chrome_path: Optional[str] = None
    
    def _find_chrome(self) -> Optional[str]:
        """查找系统中的 Chrome 可执行文件（复用 ChromeLauncher 的逻辑）"""
        system = platform.system()
        
        if system == "Windows":
            paths = [
                os.path.join(os.environ.get("ProgramFiles", "C:\\Program Files"), "Google\\Chrome\\Application\\chrome.exe"),
                os.path.join(os.environ.get("ProgramFiles(x86)", "C:\\Program Files (x86)"), "Google\\Chrome\\Application\\chrome.exe"),
                os.path.join(os.environ.get("LocalAppData", "C:\\Users\\%USERNAME%\\AppData\\Local"), "Google\\Chrome\\Application\\chrome.exe"),
                os.path.join(os.environ.get("ProgramFiles", "C:\\Program Files"), "Microsoft\\Edge\\Application\\msedge.exe"),
            ]
        elif system == "Darwin":
            paths = [
                "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            ]
        else:  # Linux
            paths = [
                "/usr/bin/google-chrome",
                "/usr/bin/google-chrome-stable",
                "/usr/bin/chromium",
                "/usr/bin/microsoft-edge",
            ]
        
        for path in paths:
            if os.path.isfile(path):
                return path
        
        return None
    
    async def initialize(self):
        """初始化 Playwright 并启动外部 Chrome（Worker 启动时调用一次）"""
        if self._initialized:
            return
            
        async with self._lock:
            if self._initialized:
                return
            
            # 查找 Chrome
            self._chrome_path = self._find_chrome()
            if not self._chrome_path:
                raise RuntimeError("未找到 Chrome 浏览器，请安装 Chrome 或 Edge")
            
            print(f"[BrowserManager] 找到 Chrome: {self._chrome_path}")
            
            # 启动 Playwright
            print(f"[BrowserManager] 初始化 Playwright...")
            self._playwright = await async_playwright().start()
            
            # 启动 Chrome（Playwright 管理进程）
            print(f"[BrowserManager] 启动 Chrome...")
            self._browser = await self._playwright.chromium.launch(
                executable_path=self._chrome_path,
                headless=True,  # 默认无头模式
                args=[
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--no-first-run',
                    '--no-default-browser-check',
                    '--disable-sync',
                ]
            )
            
            self._initialized = True
            print(f"[BrowserManager] 初始化完成，Chrome PID: {self._browser.process.pid if self._browser.process else 'N/A'}")
    
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
            
            # 关闭 browser（Playwright 会自动终止 Chrome 进程）
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
# from .chrome_launcher import get_chrome_launcher
# 改为新的导入
from .browser_manager import get_browser_manager

class BrowserTool(BaseTool):
    def __init__(self):
        super().__init__()
        self._profile_manager = get_profile_manager()
        self._browser_manager = get_browser_manager()  # 新增
        self._session_manager = get_session_manager()  # 保留用于 page 管理
    
    async def launch_browser(self, profile_name: str = "default", 
                           url: Optional[str] = None, 
                           browser_session_id: Optional[str] = None) -> ToolResult:
        """
        启动浏览器会话
        获取/创建 context，创建 page
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
            
            # 保存 page 引用
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
    
    # 其他操作类似，都通过 session_manager.get_page() 获取 page...
    
    async def close_session(self, session_id: str) -> ToolResult:
        """关闭会话（关闭 page）"""
        try:
            page = await self._session_manager.get_page(session_id)
            if page:
                await page.close()
            
            await self._session_manager.remove_page(session_id)
            
            return ToolResult(True, data={"session_id": session_id})
        except Exception as e:
            return ToolResult(False, error=str(e))
```

### 步骤 3: 修改 SessionManager 支持 Page 管理

**文件**: `backend/tools/browser/session_manager.py`

```python
class SessionManager:
    def __init__(self):
        self._sessions: Dict[str, BrowserSession] = {}  # 保留，用于兼容
        self._pages: Dict[str, Page] = {}  # 新增：session_id -> Page 映射
        self._lock = asyncio.Lock()
    
    async def create_page_holder(self, session_id: str, page: Page):
        """临时存储 page 引用（任务期间使用）"""
        async with self._lock:
            # 如果已有 page，先关闭
            old_page = self._pages.get(session_id)
            if old_page:
                try:
                    await old_page.close()
                except:
                    pass
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
    try:
        asyncio.run(browser_manager.initialize())
        print("[Worker] BrowserManager 初始化完成")
    except Exception as e:
        print(f"[Worker] BrowserManager 初始化失败: {e}")
        raise

# Worker 停止时关闭 BrowserManager
@worker_shutdown.connect  
def shutdown_worker(**kwargs):
    print("[Worker] 关闭 BrowserManager...")
    import asyncio
    browser_manager = get_browser_manager()
    asyncio.run(browser_manager.shutdown())
    print("[Worker] BrowserManager 已关闭")
```

### 步骤 5: 删除旧文件

**删除**:
- `backend/tools/browser/browser_controller.py`
- `backend/tools/browser/chrome_launcher.py`

**修改**:
- `backend/tools/browser/profile_manager.py` - 移除 cdp_port 相关逻辑（不再需要）

## 三、架构对比

| 特性 | 旧架构 (CDP) | 新架构 (launch) |
|------|-------------|----------------|
| **Chrome 启动** | ChromeLauncher 启动，Playwright 通过 CDP 连接 | Playwright 直接启动并管理 |
| **连接稳定性** | ❌ 不稳定，经常出现 `NoneType` 错误 | ✅ Playwright 内部管理，稳定 |
| **进程管理** | 需要手动管理 Chrome 进程 | Playwright 自动管理 |
| **Playwright 实例** | 每次任务重建 | Worker 生命周期内只创建一次 |
| **Context 复用** | 每次创建 | session_id 级别复用 |
| **Page 管理** | Session 长期持有 | 每次任务创建/关闭 |

## 四、关键优势

1. **稳定性**：`chromium.launch()` 比 `connect_over_cdp()` 更稳定
2. **简化**：不再需要 ChromeLauncher，Playwright 自己管理 Chrome
3. **性能**：Playwright 实例只创建一次
4. **资源管理**：自动清理过期 Context

## 五、注意事项

1. **Chrome 路径**：需要确保 Chrome 安装在标准位置，或配置自定义路径
2. **端口占用**：Playwright 会自动分配端口，不需要手动指定
3. **进程终止**：Worker 停止时 Playwright 会自动终止 Chrome 进程
