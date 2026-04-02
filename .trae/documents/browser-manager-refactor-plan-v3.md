# Browser Manager 重构计划 V3：优先使用本机 Chrome，跨平台支持

## 一、核心设计

### Chrome 查找策略（优先级）
1. **第一优先级**：用户本机安装的 Chrome / Edge
2. **第二优先级**：Playwright 自带的 Chromium（自动下载）
3. **跨平台**：Windows / macOS / Linux 自动适配

## 二、具体实现

### 步骤 1: 创建 ChromeFinder 工具类

**文件**: `backend/tools/browser/chrome_finder.py` (新建)

```python
"""
Chrome 查找器
跨平台查找本机 Chrome，找不到则使用 Playwright Chromium
"""

import os
import platform
from typing import Optional, List
from pathlib import Path


class ChromeFinder:
    """跨平台 Chrome 查找器"""
    
    @staticmethod
    def find() -> Optional[str]:
        """
        查找 Chrome 可执行文件
        
        Returns:
            str: Chrome 路径，找不到返回 None
        """
        system = platform.system()
        
        if system == "Windows":
            return ChromeFinder._find_windows()
        elif system == "Darwin":
            return ChromeFinder._find_macos()
        else:  # Linux
            return ChromeFinder._find_linux()
    
    @staticmethod
    def _find_windows() -> Optional[str]:
        """Windows 下查找 Chrome"""
        paths = [
            # Chrome
            os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), r"Google\Chrome\Application\chrome.exe"),
            os.path.join(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"), r"Google\Chrome\Application\chrome.exe"),
            os.path.join(os.environ.get("LocalAppData", r"C:\Users\%USERNAME%\AppData\Local"), r"Google\Chrome\Application\chrome.exe"),
            # Edge
            os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), r"Microsoft\Edge\Application\msedge.exe"),
            os.path.join(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"), r"Microsoft\Edge\Application\msedge.exe"),
        ]
        
        for path in paths:
            if os.path.isfile(path):
                print(f"[ChromeFinder] 找到 Windows Chrome: {path}")
                return path
        
        return None
    
    @staticmethod
    def _find_macos() -> Optional[str]:
        """macOS 下查找 Chrome"""
        paths = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        ]
        
        for path in paths:
            if os.path.isfile(path):
                print(f"[ChromeFinder] 找到 macOS Chrome: {path}")
                return path
        
        return None
    
    @staticmethod
    def _find_linux() -> Optional[str]:
        """Linux 下查找 Chrome"""
        paths = [
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/usr/bin/microsoft-edge",
            "/usr/bin/brave-browser",
        ]
        
        for path in paths:
            if os.path.isfile(path):
                print(f"[ChromeFinder] 找到 Linux Chrome: {path}")
                return path
        
        return None
    
    @staticmethod
    def get_browser_type(path: str) -> str:
        """根据路径判断浏览器类型"""
        path_lower = path.lower()
        if "chrome" in path_lower:
            return "Chrome"
        elif "edge" in path_lower:
            return "Edge"
        elif "brave" in path_lower:
            return "Brave"
        elif "chromium" in path_lower:
            return "Chromium"
        return "Unknown"
```

### 步骤 2: 创建 BrowserManager 类

**文件**: `backend/tools/browser/browser_manager.py` (新建)

```python
"""
Browser Manager 模块
Worker 启动时初始化 Playwright，优先使用本机 Chrome，管理多个 Session Context
"""

import asyncio
from typing import Dict, Optional, Any
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from playwright.async_api import async_playwright, Browser, BrowserContext, Page
from .chrome_finder import ChromeFinder


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
    - 优先使用本机 Chrome/Edge，找不到用 Playwright Chromium
    - 管理一个 Browser 实例（Worker 生命周期）
    - 管理 session_id → SessionContext 映射
    """
    
    def __init__(self):
        self._playwright = None
        self._browser: Optional[Browser] = None
        self._contexts: Dict[str, SessionContext] = {}
        self._lock = asyncio.Lock()
        self._initialized = False
        self._chrome_path: Optional[str] = None
        self._browser_type: str = "Unknown"
    
    async def initialize(self):
        """初始化 Playwright 和 Browser（Worker 启动时调用一次）"""
        if self._initialized:
            return
            
        async with self._lock:
            if self._initialized:
                return
            
            # 1. 查找本机 Chrome
            self._chrome_path = ChromeFinder.find()
            
            # 2. 启动 Playwright
            print(f"[BrowserManager] 初始化 Playwright...")
            self._playwright = await async_playwright().start()
            
            # 3. 启动 Browser
            if self._chrome_path:
                # 使用本机 Chrome
                self._browser_type = ChromeFinder.get_browser_type(self._chrome_path)
                print(f"[BrowserManager] 使用本机 {self._browser_type}: {self._chrome_path}")
                
                self._browser = await self._playwright.chromium.launch(
                    executable_path=self._chrome_path,
                    headless=True,
                    args=[
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-gpu',
                        '--no-first-run',
                        '--no-default-browser-check',
                        '--disable-sync',
                        '--disable-background-networking',
                    ]
                )
            else:
                # 使用 Playwright Chromium
                self._browser_type = "Playwright Chromium"
                print(f"[BrowserManager] 未找到本机 Chrome，使用 Playwright Chromium")
                
                self._browser = await self._playwright.chromium.launch(
                    headless=True,
                    args=[
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                    ]
                )
            
            self._initialized = True
            pid = self._browser.process.pid if self._browser.process else 'N/A'
            print(f"[BrowserManager] 初始化完成，Browser: {self._browser_type}, PID: {pid}")
    
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

### 步骤 3: 修改其他文件

**BrowserTool** (`tool.py`):
```python
from .browser_manager import get_browser_manager

class BrowserTool(BaseTool):
    def __init__(self):
        super().__init__()
        self._browser_manager = get_browser_manager()
        self._session_manager = get_session_manager()
    
    async def launch_browser(self, browser_session_id: Optional[str] = None, 
                           url: Optional[str] = None) -> ToolResult:
        try:
            if not browser_session_id:
                return ToolResult(False, error="browser_session_id 不能为空")
            
            # 获取或创建 context
            context = await self._browser_manager.get_or_create_context(browser_session_id)
            
            # 创建新 page
            page = await context.new_page()
            
            if url:
                await page.goto(url, wait_until="networkidle")
            
            # 保存 page
            await self._session_manager.create_page_holder(browser_session_id, page)
            
            return ToolResult(
                True,
                data={"session_id": browser_session_id, "url": url or "about:blank"},
                meta={"message": f"浏览器已启动（Session: {browser_session_id}）"},
            )
        except Exception as e:
            return ToolResult(False, error=str(e))
```

**SessionManager** (`session_manager.py`):
```python
class SessionManager:
    def __init__(self):
        self._pages: Dict[str, Page] = {}  # session_id -> Page
        self._lock = asyncio.Lock()
    
    async def create_page_holder(self, session_id: str, page: Page):
        async with self._lock:
            old_page = self._pages.get(session_id)
            if old_page:
                try:
                    await old_page.close()
                except:
                    pass
            self._pages[session_id] = page
    
    async def get_page(self, session_id: str) -> Optional[Page]:
        async with self._lock:
            return self._pages.get(session_id)
    
    async def remove_page(self, session_id: str):
        async with self._lock:
            if session_id in self._pages:
                del self._pages[session_id]
```

**Celery Worker** (`celery_app.py`):
```python
from tools.browser.browser_manager import get_browser_manager

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

@worker_shutdown.connect  
def shutdown_worker(**kwargs):
    print("[Worker] 关闭 BrowserManager...")
    import asyncio
    browser_manager = get_browser_manager()
    asyncio.run(browser_manager.shutdown())
    print("[Worker] BrowserManager 已关闭")
```

### 步骤 4: 删除旧文件

- `backend/tools/browser/chrome_launcher.py` → 被 `chrome_finder.py` 替代
- `backend/tools/browser/browser_controller.py` → 被 `browser_manager.py` 替代
- `backend/tools/browser/profile_manager.py` → 不再需要（移除 cdp_port 相关逻辑）

## 三、文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `chrome_finder.py` | 新建 | 跨平台 Chrome 查找器 |
| `browser_manager.py` | 新建 | Browser 管理器 |
| `chrome_launcher.py` | 删除 | 被替代 |
| `browser_controller.py` | 删除 | 被替代 |
| `profile_manager.py` | 删除/简化 | 移除 cdp_port 逻辑 |
| `session_manager.py` | 修改 | 简化为 Page 管理 |
| `tool.py` | 修改 | 使用新架构 |
| `celery_app.py` | 修改 | Worker 生命周期管理 |

## 四、特性总结

- ✅ **优先本机 Chrome**：Windows/macOS/Linux 自动查找
- ✅ **自动降级**：找不到用 Playwright Chromium
- ✅ **跨平台**：自动适配不同操作系统
- ✅ **稳定连接**：`launch()` 方式比 `connect_over_cdp()` 更稳定
- ✅ **资源复用**：Context 按 session_id 复用
- ✅ **生命周期管理**：Worker 启动/停止时自动管理
