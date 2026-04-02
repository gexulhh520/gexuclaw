"""
Browser Manager 模块
Worker 启动时初始化 Playwright，优先使用本机 Chrome，管理多个 Session Context
"""

import asyncio
from typing import Dict, Optional, Any
from dataclasses import dataclass, field
from datetime import datetime, timedelta

try:
    from playwright.async_api import async_playwright, Browser, BrowserContext, Page
except ImportError:
    raise ImportError("请安装 playwright: pip install playwright && playwright install")

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
        self._lock: Optional[asyncio.Lock] = None
        self._initialized = False
        self._chrome_path: Optional[str] = None
        self._browser_type: str = "Unknown"

    def _get_lock(self) -> asyncio.Lock:
        """获取或创建锁（确保在当前事件循环中创建）"""
        if self._lock is None:
            self._lock = asyncio.Lock()
        return self._lock

    async def initialize(self):
        """初始化 Playwright 和 Browser（任务执行时调用）"""
        # 如果已经初始化，检查 browser 是否仍然有效
        if self._initialized and self._browser:
            try:
                # 简单检查 browser 是否还有效
                self._browser.browser_type
                return
            except:
                # browser 已失效，需要重新初始化
                print(f"[BrowserManager] Browser 已失效，重新初始化...")
                self._initialized = False
                self._browser = None
                self._playwright = None

        async with self._get_lock():
            # 双重检查
            if self._initialized and self._browser:
                try:
                    self._browser.browser_type
                    return
                except:
                    self._initialized = False
                    self._browser = None
                    self._playwright = None

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
                    headless=False,  # 有头模式
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
                    headless=False,  # 有头模式
                    args=[
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                    ]
                )

            self._initialized = True
            # 获取进程 PID（Playwright 的 Browser 对象可能没有 process 属性）
            try:
                pid = self._browser.process.pid if hasattr(self._browser, 'process') and self._browser.process else 'N/A'
            except:
                pid = 'N/A'
            print(f"[BrowserManager] 初始化完成，Browser: {self._browser_type}, PID: {pid}")

    async def get_or_create_context(self, session_id: str) -> BrowserContext:
        """
        获取或创建 Session Context

        Args:
            session_id: 会话 ID

        Returns:
            BrowserContext: 浏览器上下文
        """
        print(f"[BrowserManager] get_or_create_context 开始: {session_id}")
        
        # 确保已初始化
        if not self._initialized:
            print(f"[BrowserManager] 需要初始化...")
            await self.initialize()

        # 检查 browser 是否成功初始化
        if not self._browser:
            raise RuntimeError("Browser 未初始化，请先确保 Worker 启动时 BrowserManager 初始化成功")

        print(f"[BrowserManager] 获取锁...")
        async with self._get_lock():
            print(f"[BrowserManager] 锁获取成功")
            # 检查是否已存在
            if session_id in self._contexts:
                session_ctx = self._contexts[session_id]
                session_ctx.touch()
                print(f"[BrowserManager] 复用已有 Context: {session_id}")
                return session_ctx.context

            # 创建新的 context
            print(f"[BrowserManager] 创建新 Context: {session_id}")
            print(f"[BrowserManager] browser 状态: {self._browser}")
            try:
                context = await self._browser.new_context(
                    viewport={'width': 1920, 'height': 1080},
                    user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                )
                print(f"[BrowserManager] Context 创建成功: {session_id}")
            except Exception as e:
                print(f"[BrowserManager] Context 创建失败: {e}")
                raise

            session_ctx = SessionContext(
                session_id=session_id,
                context=context
            )
            self._contexts[session_id] = session_ctx
            print(f"[BrowserManager] SessionContext 保存成功: {session_id}")
            return context

    async def close_context(self, session_id: str):
        """关闭指定 session 的 context"""
        async with self._get_lock():
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
        async with self._get_lock():
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
