from typing import Any, Dict, Optional

from markdownify import markdownify as md

try:
    from tools.tool_result import ToolResult
    from tools.browser.task_browser_manager import get_task_browser_manager
except ModuleNotFoundError:
    from backend.tools.tool_result import ToolResult
    from backend.tools.browser.task_browser_manager import get_task_browser_manager


class BrowserServiceRuntime:
    """
    浏览器服务端运行时。

    该类运行在独立 FastAPI 进程中，直接持有 Playwright 会话，
    避免在 Agent Worker 进程内启动浏览器子进程。
    """

    def __init__(self):
        self._task_browser_manager = get_task_browser_manager()
        self._operations = {
            "launch_browser": self.launch_browser,
            "navigate": self.navigate,
            "click": self.click,
            "fill": self.fill,
            "type": self.type,
            "press": self.press,
            "get_text": self.get_text,
            "get_page_info": self.get_page_info,
            "close_session": self.close_session,
            "get_interactive_elements": self.get_interactive_elements,
            "execute_script": self.execute_script,
            "hover": self.hover,
            "select_option": self.select_option,
            "upload_file": self.upload_file,
            "download_file": self.download_file,
            "get_page_markdown": self.get_page_markdown,
        }

    async def execute(self, operation: str, args: Dict[str, Any]) -> ToolResult:
        handler = self._operations.get(operation)
        if not handler:
            return ToolResult(False, error=f"未知浏览器操作: {operation}")
        try:
            return await handler(**args)
        except TypeError as exc:
            return ToolResult(False, error=f"浏览器操作参数错误: {str(exc)}")
        except Exception as exc:
            return ToolResult(False, error=str(exc))

    async def shutdown(self):
        await self._task_browser_manager.close_all()

    async def _get_page(self, session_id: str):
        session = await self._task_browser_manager.get_session(session_id)
        if not session:
            return None
        return session.page

    async def launch_browser(
        self,
        browser_session_id: Optional[str] = None,
        url: Optional[str] = None,
    ) -> ToolResult:
        if not browser_session_id:
            return ToolResult(False, error="browser_session_id 不能为空")

        session = await self._task_browser_manager.create_session(
            session_id=browser_session_id,
            headless=False,
        )
        if url:
            await session.page.goto(url, wait_until="networkidle")

        return ToolResult(
            True,
            data={"session_id": browser_session_id, "url": url or "about:blank"},
            meta={"message": f"浏览器会话已启动（Session: {browser_session_id}）"},
        )

    async def close_session(self, session_id: str) -> ToolResult:
        await self._task_browser_manager.close_session(session_id)
        return ToolResult(True, meta={"message": f"Session '{session_id}' 已关闭"})

    async def navigate(self, session_id: str, url: str) -> ToolResult:
        page = await self._get_page(session_id)
        if not page:
            return ToolResult(False, error=f"Session '{session_id}' 不存在或已关闭")
        await page.goto(url, wait_until="networkidle")
        return ToolResult(True, data={"url": url}, meta={"message": f"已导航到: {url}"})

    async def click(self, session_id: str, selector: str) -> ToolResult:
        page = await self._get_page(session_id)
        if not page:
            return ToolResult(False, error=f"Session '{session_id}' 不存在")
        await page.click(selector)
        return ToolResult(True, meta={"message": f"已点击: {selector}"})

    async def fill(self, session_id: str, selector: str, text: str) -> ToolResult:
        page = await self._get_page(session_id)
        if not page:
            return ToolResult(False, error=f"Session '{session_id}' 不存在")
        await page.fill(selector, text)
        return ToolResult(True, meta={"message": f"已填充: {selector}"})

    async def type(self, session_id: str, selector: str, text: str, delay: int = 50) -> ToolResult:
        page = await self._get_page(session_id)
        if not page:
            return ToolResult(False, error=f"Session '{session_id}' 不存在")
        await page.type(selector, text, delay=delay)
        return ToolResult(True, meta={"message": f"已输入: {text[:20]}..."})

    async def press(self, session_id: str, selector: str, key: str) -> ToolResult:
        page = await self._get_page(session_id)
        if not page:
            return ToolResult(False, error=f"Session '{session_id}' 不存在")
        await page.press(selector, key)
        return ToolResult(True, meta={"message": f"已按下: {key}"})

    async def get_text(self, session_id: str, selector: str) -> ToolResult:
        page = await self._get_page(session_id)
        if not page:
            return ToolResult(False, error=f"Session '{session_id}' 不存在")
        text = await page.inner_text(selector)
        return ToolResult(True, data=text, meta={"selector": selector})

    async def get_page_info(self, session_id: str) -> ToolResult:
        page = await self._get_page(session_id)
        if not page:
            return ToolResult(False, error=f"Session '{session_id}' 不存在")
        title = await page.title()
        return ToolResult(
            True,
            data={"title": title, "url": page.url},
            meta={"message": "页面信息获取成功"},
        )

    async def get_interactive_elements(self, session_id: str, include_text: bool = True) -> ToolResult:
        page = await self._get_page(session_id)
        if not page:
            return ToolResult(False, error=f"Session '{session_id}' 不存在")

        script = """
        () => {
            const elements = [];
            const clickableSelectors = 'a, button, input[type="submit"], input[type="button"], [role="button"], [onclick]';
            document.querySelectorAll(clickableSelectors).forEach((el) => {
                if (el.offsetParent !== null) {
                    elements.push({
                        type: 'clickable',
                        tag: el.tagName.toLowerCase(),
                        selector: el.id ? `#${el.id}` : el.className ? `.${el.className.split(' ')[0]}` : el.tagName.toLowerCase(),
                        text: el.innerText?.substring(0, 50) || el.value?.substring(0, 50) || '',
                        id: el.id,
                        class: el.className
                    });
                }
            });

            const inputSelectors = 'input:not([type="submit"]):not([type="button"]), textarea, select, [contenteditable="true"]';
            document.querySelectorAll(inputSelectors).forEach((el) => {
                if (el.offsetParent !== null) {
                    elements.push({
                        type: 'input',
                        tag: el.tagName.toLowerCase(),
                        inputType: el.type || 'text',
                        selector: el.id ? `#${el.id}` : el.name ? `[name="${el.name}"]` : el.tagName.toLowerCase(),
                        placeholder: el.placeholder?.substring(0, 50) || '',
                        name: el.name,
                        id: el.id
                    });
                }
            });
            return elements;
        }
        """

        elements = await page.evaluate(script)
        if not include_text:
            for el in elements:
                el.pop("text", None)
                el.pop("placeholder", None)

        return ToolResult(
            True,
            data=elements,
            meta={"count": len(elements), "message": f"找到 {len(elements)} 个可交互元素"},
        )

    async def execute_script(self, session_id: str, script: str) -> ToolResult:
        page = await self._get_page(session_id)
        if not page:
            return ToolResult(False, error=f"Session '{session_id}' 不存在")
        result = await page.evaluate(script)
        return ToolResult(True, data=result, meta={"message": "脚本执行成功"})

    async def hover(self, session_id: str, selector: str) -> ToolResult:
        page = await self._get_page(session_id)
        if not page:
            return ToolResult(False, error=f"Session '{session_id}' 不存在")
        await page.hover(selector)
        return ToolResult(True, meta={"message": f"已悬停: {selector}"})

    async def select_option(self, session_id: str, selector: str, value: str) -> ToolResult:
        page = await self._get_page(session_id)
        if not page:
            return ToolResult(False, error=f"Session '{session_id}' 不存在")
        await page.select_option(selector, value)
        return ToolResult(True, meta={"message": f"已选择: {value}"})

    async def upload_file(self, session_id: str, selector: str, file_path: str) -> ToolResult:
        page = await self._get_page(session_id)
        if not page:
            return ToolResult(False, error=f"Session '{session_id}' 不存在")
        await page.set_input_files(selector, file_path)
        return ToolResult(True, meta={"message": f"已上传文件: {file_path}"})

    async def download_file(self, session_id: str, url: str, save_path: str) -> ToolResult:
        import aiohttp
        import os

        page = await self._get_page(session_id)
        if not page:
            return ToolResult(False, error=f"Session '{session_id}' 不存在")

        async with aiohttp.ClientSession() as session:
            async with session.get(url) as response:
                if response.status != 200:
                    return ToolResult(False, error=f"下载失败，状态码: {response.status}")
                os.makedirs(os.path.dirname(save_path), exist_ok=True)
                with open(save_path, "wb") as f:
                    f.write(await response.read())
        return ToolResult(True, data={"path": save_path}, meta={"message": f"文件已下载: {save_path}"})

    async def get_page_markdown(self, session_id: str, selector: Optional[str] = None) -> ToolResult:
        page = await self._get_page(session_id)
        if not page:
            return ToolResult(False, error=f"Session '{session_id}' 不存在")

        if selector:
            element = await page.query_selector(selector)
            if not element:
                return ToolResult(False, error=f"未找到元素: {selector}")
            html = await element.inner_html()
        else:
            html = await page.inner_html("body")

        markdown_content = md(html, heading_style="ATX")
        max_length = 10000
        if len(markdown_content) > max_length:
            markdown_content = markdown_content[:max_length] + "\n\n... (内容已截断)"

        return ToolResult(
            True,
            data=markdown_content,
            meta={
                "url": page.url,
                "length": len(markdown_content),
                "message": f"页面已转换为 Markdown，共 {len(markdown_content)} 字符",
            },
        )
