"""
Session 管理模块
简化为 Page 管理，每个 session_id 对应一个 Page
"""

import asyncio
from typing import Dict, Optional

try:
    from playwright.async_api import Page
except ImportError:
    raise ImportError("请安装 playwright: pip install playwright && playwright install")


class SessionManager:
    """
    Session 管理器（简化为 Page 管理）
    负责临时存储和获取 Page 引用
    """

    def __init__(self):
        # session_id -> Page 映射
        self._pages: Dict[str, Page] = {}
        self._lock = asyncio.Lock()

    async def create_page_holder(self, session_id: str, page: Page):
        """
        临时存储 page 引用（任务期间使用）
        如果该 session_id 已有 page，先关闭旧的
        """
        async with self._lock:
            # 如果已有 page，先关闭
            old_page = self._pages.get(session_id)
            if old_page:
                try:
                    await old_page.close()
                except:
                    pass
            self._pages[session_id] = page
            print(f"[SessionManager] 保存 Page: {session_id}")

    async def get_page(self, session_id: str) -> Optional[Page]:
        """获取 page 引用"""
        async with self._lock:
            return self._pages.get(session_id)

    async def remove_page(self, session_id: str):
        """移除 page 引用"""
        async with self._lock:
            if session_id in self._pages:
                del self._pages[session_id]
                print(f"[SessionManager] 移除 Page: {session_id}")

    async def close_page(self, session_id: str):
        """关闭指定 session 的 page"""
        async with self._lock:
            page = self._pages.get(session_id)
            if page:
                try:
                    await page.close()
                    print(f"[SessionManager] 关闭 Page: {session_id}")
                except Exception as e:
                    print(f"[SessionManager] 关闭 Page {session_id} 失败: {e}")
                finally:
                    del self._pages[session_id]


# 全局 Session 管理器实例
_session_manager: Optional[SessionManager] = None


def get_session_manager() -> SessionManager:
    """获取全局 Session 管理器实例"""
    global _session_manager
    if _session_manager is None:
        _session_manager = SessionManager()
    return _session_manager
