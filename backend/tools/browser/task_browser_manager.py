"""
Task-level Browser Manager
每个任务独立管理 Browser 生命周期，避免跨任务共享问题
"""

import asyncio
from typing import Dict, Optional, Any
from dataclasses import dataclass, field
from datetime import datetime

try:
    from playwright.async_api import async_playwright, Browser, BrowserContext, Page
except ImportError:
    raise ImportError("请安装 playwright: pip install playwright && playwright install")

from .chrome_finder import ChromeFinder


@dataclass
class TaskBrowserSession:
    """任务级浏览器会话"""
    session_id: str
    browser: Browser
    context: BrowserContext
    page: Page
    playwright: Any
    created_at: datetime = field(default_factory=datetime.now)


class TaskBrowserManager:
    """
    任务级 Browser 管理器
    - 每个任务独立启动 Browser
    - 任务结束时关闭 Browser
    - 不共享状态，避免跨任务问题
    """

    def __init__(self):
        self._sessions: Dict[str, TaskBrowserSession] = {}
        self._lock = asyncio.Lock()

    async def create_session(self, session_id: str, headless: bool = False) -> TaskBrowserSession:
        """
        创建新的浏览器会话

        Args:
            session_id: 会话 ID
            headless: 是否无头模式

        Returns:
            TaskBrowserSession: 浏览器会话
        """
        async with self._lock:
            # 如果已存在，先关闭
            if session_id in self._sessions:
                await self._close_session_internal(session_id)

            print(f"[TaskBrowserManager] 启动 Browser for session: {session_id}")

            # 1. 查找本机 Chrome
            chrome_path = ChromeFinder.find()

            # 2. 启动 Playwright
            playwright = await async_playwright().start()

            # 3. 启动 Browser
            if chrome_path:
                browser_type = ChromeFinder.get_browser_type(chrome_path)
                print(f"[TaskBrowserManager] 使用本机 {browser_type}: {chrome_path}")

                browser = await playwright.chromium.launch(
                    executable_path=chrome_path,
                    headless=headless,
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
                browser_type = "Playwright Chromium"
                print(f"[TaskBrowserManager] 使用 Playwright Chromium")

                browser = await playwright.chromium.launch(
                    headless=headless,
                    args=[
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                    ]
                )

            # 4. 创建 Context
            context = await browser.new_context(
                viewport={'width': 1920, 'height': 1080},
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            )

            # 5. 创建 Page
            page = await context.new_page()

            # 6. 保存会话
            session = TaskBrowserSession(
                session_id=session_id,
                browser=browser,
                context=context,
                page=page,
                playwright=playwright
            )
            self._sessions[session_id] = session

            print(f"[TaskBrowserManager] Session 创建成功: {session_id}")
            return session

    async def get_session(self, session_id: str) -> Optional[TaskBrowserSession]:
        """获取会话"""
        async with self._lock:
            return self._sessions.get(session_id)

    async def close_session(self, session_id: str):
        """关闭会话"""
        async with self._lock:
            await self._close_session_internal(session_id)

    async def _close_session_internal(self, session_id: str):
        """内部关闭方法（必须在锁内调用）"""
        session = self._sessions.pop(session_id, None)
        if not session:
            return

        print(f"[TaskBrowserManager] 关闭 Session: {session_id}")

        # 关闭 page
        try:
            await session.page.close()
        except Exception as e:
            print(f"[TaskBrowserManager] 关闭 page 失败: {e}")

        # 关闭 context
        try:
            await session.context.close()
        except Exception as e:
            print(f"[TaskBrowserManager] 关闭 context 失败: {e}")

        # 关闭 browser
        try:
            await session.browser.close()
        except Exception as e:
            print(f"[TaskBrowserManager] 关闭 browser 失败: {e}")

        # 停止 playwright
        try:
            await session.playwright.stop()
        except Exception as e:
            print(f"[TaskBrowserManager] 停止 playwright 失败: {e}")

        print(f"[TaskBrowserManager] Session 已关闭: {session_id}")

    async def close_all(self):
        """关闭所有会话"""
        async with self._lock:
            for session_id in list(self._sessions.keys()):
                await self._close_session_internal(session_id)


# 全局 TaskBrowserManager 实例（只管理引用，不共享 Browser）
_task_browser_manager: Optional[TaskBrowserManager] = None


def get_task_browser_manager() -> TaskBrowserManager:
    """获取全局 TaskBrowserManager 实例"""
    global _task_browser_manager
    if _task_browser_manager is None:
        _task_browser_manager = TaskBrowserManager()
    return _task_browser_manager
