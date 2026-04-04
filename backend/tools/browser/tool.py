"""
浏览器控制工具类（新架构）
使用 TaskBrowserManager 每个任务独立管理 Browser
"""

import base64
from typing import Dict, Any, Optional

from ..tool_result import ToolResult
from ..tool_operation import ToolOperation
from ..tool_registry import tool
from ..base import BaseTool

from .task_browser_manager import get_task_browser_manager


@tool("browser")
class BrowserTool(BaseTool):
    """
    浏览器控制工具类，包含：
    - launch_browser: 启动浏览器会话（获取/创建 context + page）
    - navigate: 导航到指定 URL
    - click: 点击元素
    - fill: 填充输入框
    - type: 模拟键盘输入
    - get_text: 获取元素文本
    - screenshot: 截图
    - get_page_info: 获取页面信息
    - close_session: 关闭会话（关闭 page）
    """

    category = "browser"
    description = "浏览器自动化控制工具，支持 Chrome/Edge 等浏览器"

    def __init__(self):
        super().__init__()
        self._task_browser_manager = get_task_browser_manager()

    def _register_operations(self):
        """注册工具操作"""
        self.operations = {
            "launch_browser": ToolOperation(
                name="launch_browser",
                description="启动浏览器会话（获取或复用 context，创建 page）",
                parameters=[
                    {
                        "name": "browser_session_id",
                        "type": "string",
                        "required": True,
                        "description": "浏览器会话 ID（由系统传入）",
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
            "navigate": ToolOperation(
                name="navigate",
                description="导航到指定 URL",
                parameters=[
                    {
                        "name": "session_id",
                        "type": "string",
                        "required": True,
                        "description": "会话 ID",
                    },
                    {
                        "name": "url",
                        "type": "string",
                        "required": True,
                        "description": "目标 URL",
                    },
                ],
                func=self.navigate,
            ),
            "click": ToolOperation(
                name="click",
                description="点击页面元素",
                parameters=[
                    {
                        "name": "session_id",
                        "type": "string",
                        "required": True,
                        "description": "会话 ID",
                    },
                    {
                        "name": "selector",
                        "type": "string",
                        "required": True,
                        "description": "CSS 选择器",
                    },
                ],
                func=self.click,
            ),
            "fill": ToolOperation(
                name="fill",
                description="填充输入框",
                parameters=[
                    {
                        "name": "session_id",
                        "type": "string",
                        "required": True,
                        "description": "会话 ID",
                    },
                    {
                        "name": "selector",
                        "type": "string",
                        "required": True,
                        "description": "CSS 选择器",
                    },
                    {
                        "name": "text",
                        "type": "string",
                        "required": True,
                        "description": "输入文本",
                    },
                ],
                func=self.fill,
            ),
            "type": ToolOperation(
                name="type",
                description="模拟键盘输入（带延迟）",
                parameters=[
                    {
                        "name": "session_id",
                        "type": "string",
                        "required": True,
                        "description": "会话 ID",
                    },
                    {
                        "name": "selector",
                        "type": "string",
                        "required": True,
                        "description": "CSS 选择器",
                    },
                    {
                        "name": "text",
                        "type": "string",
                        "required": True,
                        "description": "输入文本",
                    },
                    {
                        "name": "delay",
                        "type": "integer",
                        "required": False,
                        "description": "按键延迟（毫秒，默认 50）",
                    },
                ],
                func=self.type,
            ),
            "press": ToolOperation(
                name="press",
                description="按下按键",
                parameters=[
                    {
                        "name": "session_id",
                        "type": "string",
                        "required": True,
                        "description": "会话 ID",
                    },
                    {
                        "name": "selector",
                        "type": "string",
                        "required": True,
                        "description": "CSS 选择器",
                    },
                    {
                        "name": "key",
                        "type": "string",
                        "required": True,
                        "description": "按键名称，如 'Enter', 'Tab', 'Escape'",
                    },
                ],
                func=self.press,
            ),
            "get_text": ToolOperation(
                name="get_text",
                description="获取元素文本内容",
                parameters=[
                    {
                        "name": "session_id",
                        "type": "string",
                        "required": True,
                        "description": "会话 ID",
                    },
                    {
                        "name": "selector",
                        "type": "string",
                        "required": True,
                        "description": "CSS 选择器",
                    }
                ],
                func=self.get_text,
            ),
            "get_page_info": ToolOperation(
                name="get_page_info",
                description="获取当前页面信息（标题、URL）",
                parameters=[
                    {
                        "name": "session_id",
                        "type": "string",
                        "required": True,
                        "description": "会话 ID",
                    }
                ],
                func=self.get_page_info,
            ),
            # "screenshot": ToolOperation(
            #     name="screenshot",
            #     description="截取页面截图",
            #     parameters=[
            #         {
            #             "name": "session_id",
            #             "type": "string",
            #             "required": True,
            #             "description": "会话 ID",
            #         },
            #         {
            #             "name": "path",
            #             "type": "string",
            #             "required": False,
            #             "description": "保存路径（可选，默认返回 base64）",
            #         },
            #         {
            #             "name": "full_page",
            #             "type": "boolean",
            #             "required": False,
            #             "description": "是否截取整个页面（默认 true）",
            #         },
            #     ],
            #     func=self.screenshot,
            # ),
            "close_session": ToolOperation(
                name="close_session",
                description="关闭浏览器会话（关闭 page）",
                parameters=[
                    {
                        "name": "session_id",
                        "type": "string",
                        "required": True,
                        "description": "会话 ID",
                    }
                ],
                func=self.close_session,
            ),
            "get_interactive_elements": ToolOperation(
                name="get_interactive_elements",
                description="获取页面所有可交互元素（可点击、可输入）",
                parameters=[
                    {
                        "name": "session_id",
                        "type": "string",
                        "required": True,
                        "description": "会话 ID",
                    },
                    {
                        "name": "include_text",
                        "type": "boolean",
                        "required": False,
                        "description": "是否包含元素文本内容（默认 true）",
                    },
                ],
                func=self.get_interactive_elements,
            ),
            "execute_script": ToolOperation(
                name="execute_script",
                description="在页面中执行 JavaScript 脚本",
                parameters=[
                    {
                        "name": "session_id",
                        "type": "string",
                        "required": True,
                        "description": "会话 ID",
                    },
                    {
                        "name": "script",
                        "type": "string",
                        "required": True,
                        "description": "要执行的 JavaScript 代码",
                    },
                ],
                func=self.execute_script,
            ),
            "hover": ToolOperation(
                name="hover",
                description="鼠标悬停在元素上",
                parameters=[
                    {
                        "name": "session_id",
                        "type": "string",
                        "required": True,
                        "description": "会话 ID",
                    },
                    {
                        "name": "selector",
                        "type": "string",
                        "required": True,
                        "description": "CSS 选择器",
                    },
                ],
                func=self.hover,
            ),
            "select_option": ToolOperation(
                name="select_option",
                description="选择下拉框选项",
                parameters=[
                    {
                        "name": "session_id",
                        "type": "string",
                        "required": True,
                        "description": "会话 ID",
                    },
                    {
                        "name": "selector",
                        "type": "string",
                        "required": True,
                        "description": "下拉框 CSS 选择器",
                    },
                    {
                        "name": "value",
                        "type": "string",
                        "required": True,
                        "description": "选项值",
                    },
                ],
                func=self.select_option,
            ),
            "upload_file": ToolOperation(
                name="upload_file",
                description="上传文件到文件输入框",
                parameters=[
                    {
                        "name": "session_id",
                        "type": "string",
                        "required": True,
                        "description": "会话 ID",
                    },
                    {
                        "name": "selector",
                        "type": "string",
                        "required": True,
                        "description": "文件输入框 CSS 选择器",
                    },
                    {
                        "name": "file_path",
                        "type": "string",
                        "required": True,
                        "description": "文件路径",
                    },
                ],
                func=self.upload_file,
            ),
            "download_file": ToolOperation(
                name="download_file",
                description="下载文件",
                parameters=[
                    {
                        "name": "session_id",
                        "type": "string",
                        "required": True,
                        "description": "会话 ID",
                    },
                    {
                        "name": "url",
                        "type": "string",
                        "required": True,
                        "description": "文件下载 URL",
                    },
                    {
                        "name": "save_path",
                        "type": "string",
                        "required": True,
                        "description": "保存路径",
                    },
                ],
                func=self.download_file,
            ),
            "get_page_markdown": ToolOperation(
                name="get_page_markdown",
                description="获取页面内容并转换为 Markdown 格式,可用于页面信息获取",
                parameters=[
                    {
                        "name": "session_id",
                        "type": "string",
                        "required": True,
                        "description": "会话 ID",
                    },
                    {
                        "name": "selector",
                        "type": "string",
                        "required": False,
                        "description": "CSS 选择器，指定要转换的区域（默认整个页面）",
                    },
                ],
                func=self.get_page_markdown,
            ),
        }

    # ==================== 浏览器控制（异步操作）====================

    async def launch_browser(
        self,
        browser_session_id: Optional[str] = None,
        url: Optional[str] = None
    ) -> ToolResult:
        """
        启动浏览器会话
        每个任务独立启动 Browser
        """
        try:
            if not browser_session_id:
                return ToolResult(False, error="browser_session_id 不能为空")

            # 创建新的浏览器会话（任务级）
            session = await self._task_browser_manager.create_session(
                session_id=browser_session_id,
                headless=False  # 有头模式
            )

            # 如果指定了 URL，导航到该页面
            if url:
                await session.page.goto(url, wait_until="networkidle")

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

    async def close_session(self, session_id: str) -> ToolResult:
        """关闭浏览器会话"""
        try:
            await self._task_browser_manager.close_session(session_id)
            return ToolResult(
                True,
                meta={"message": f"Session '{session_id}' 已关闭"}
            )
        except Exception as e:
            return ToolResult(False, error=str(e))

    # ==================== 页面操作（异步，需要 session_id）====================

    async def _get_page(self, session_id: str):
        """获取页面（内部辅助方法）"""
        session = await self._task_browser_manager.get_session(session_id)
        if not session:
            return None
        return session.page

    async def navigate(self, session_id: str, url: str) -> ToolResult:
        """导航到指定 URL"""
        try:
            page = await self._get_page(session_id)
            if not page:
                return ToolResult(False, error=f"Session '{session_id}' 不存在或已关闭")

            await page.goto(url, wait_until="networkidle")
            return ToolResult(True, data={"url": url}, meta={"message": f"已导航到: {url}"})
        except Exception as e:
            return ToolResult(False, error=str(e))

    async def click(self, session_id: str, selector: str) -> ToolResult:
        """点击元素"""
        try:
            page = await self._get_page(session_id)
            if not page:
                return ToolResult(False, error=f"Session '{session_id}' 不存在")

            await page.click(selector)
            return ToolResult(True, meta={"message": f"已点击: {selector}"})
        except Exception as e:
            return ToolResult(False, error=str(e))

    async def fill(self, session_id: str, selector: str, text: str) -> ToolResult:
        """填充输入框"""
        try:
            page = await self._get_page(session_id)
            if not page:
                return ToolResult(False, error=f"Session '{session_id}' 不存在")

            await page.fill(selector, text)
            return ToolResult(True, meta={"message": f"已填充: {selector}"})
        except Exception as e:
            return ToolResult(False, error=str(e))

    async def type(
        self,
        session_id: str,
        selector: str,
        text: str,
        delay: int = 50
    ) -> ToolResult:
        """模拟键盘输入"""
        try:
            page = await self._get_page(session_id)
            if not page:
                return ToolResult(False, error=f"Session '{session_id}' 不存在")

            await page.type(selector, text, delay=delay)
            return ToolResult(True, meta={"message": f"已输入: {text[:20]}..."})
        except Exception as e:
            return ToolResult(False, error=str(e))

    async def press(self, session_id: str, selector: str, key: str) -> ToolResult:
        """按下按键"""
        try:
            page = await self._get_page(session_id)
            if not page:
                return ToolResult(False, error=f"Session '{session_id}' 不存在")

            await page.press(selector, key)
            return ToolResult(True, meta={"message": f"已按下: {key}"})
        except Exception as e:
            return ToolResult(False, error=str(e))

    async def get_text(self, session_id: str, selector: str) -> ToolResult:
        """获取元素文本"""
        try:
            page = await self._get_page(session_id)
            if not page:
                return ToolResult(False, error=f"Session '{session_id}' 不存在")

            text = await page.inner_text(selector)
            return ToolResult(True, data=text, meta={"selector": selector})
        except Exception as e:
            return ToolResult(False, error=str(e))

    async def get_page_info(self, session_id: str) -> ToolResult:
        """获取页面信息"""
        try:
            page = await self._get_page(session_id)
            if not page:
                return ToolResult(False, error=f"Session '{session_id}' 不存在")

            title = await page.title()
            url = page.url
            return ToolResult(
                True,
                data={"title": title, "url": url},
                meta={"message": "页面信息获取成功"},
            )
        except Exception as e:
            return ToolResult(False, error=str(e))

    async def get_interactive_elements(self, session_id: str, include_text: bool = True) -> ToolResult:
        """获取页面所有可交互元素"""
        try:
            page = await self._get_page(session_id)
            if not page:
                return ToolResult(False, error=f"Session '{session_id}' 不存在")

            # JavaScript 脚本获取可交互元素
            script = """
            () => {
                const elements = [];
                
                // 可点击元素
                const clickableSelectors = 'a, button, input[type="submit"], input[type="button"], [role="button"], [onclick]';
                document.querySelectorAll(clickableSelectors).forEach((el, index) => {
                    if (el.offsetParent !== null) {  // 可见元素
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
                
                // 可输入元素
                const inputSelectors = 'input:not([type="submit"]):not([type="button"]), textarea, select, [contenteditable="true"]';
                document.querySelectorAll(inputSelectors).forEach((el, index) => {
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
            
            # 如果不需要文本，移除文本字段
            if not include_text:
                for el in elements:
                    el.pop('text', None)
                    el.pop('placeholder', None)
            
            return ToolResult(
                True,
                data=elements,
                meta={"count": len(elements), "message": f"找到 {len(elements)} 个可交互元素"}
            )
        except Exception as e:
            return ToolResult(False, error=str(e))

    async def execute_script(self, session_id: str, script: str) -> ToolResult:
        """在页面中执行 JavaScript 脚本"""
        try:
            page = await self._get_page(session_id)
            if not page:
                return ToolResult(False, error=f"Session '{session_id}' 不存在")

            result = await page.evaluate(script)
            return ToolResult(
                True,
                data=result,
                meta={"message": "脚本执行成功"}
            )
        except Exception as e:
            return ToolResult(False, error=f"脚本执行失败: {str(e)}")

    async def hover(self, session_id: str, selector: str) -> ToolResult:
        """鼠标悬停在元素上"""
        try:
            page = await self._get_page(session_id)
            if not page:
                return ToolResult(False, error=f"Session '{session_id}' 不存在")

            await page.hover(selector)
            return ToolResult(True, meta={"message": f"已悬停: {selector}"})
        except Exception as e:
            return ToolResult(False, error=str(e))

    async def select_option(self, session_id: str, selector: str, value: str) -> ToolResult:
        """选择下拉框选项"""
        try:
            page = await self._get_page(session_id)
            if not page:
                return ToolResult(False, error=f"Session '{session_id}' 不存在")

            await page.select_option(selector, value)
            return ToolResult(True, meta={"message": f"已选择: {value}"})
        except Exception as e:
            return ToolResult(False, error=str(e))

    async def upload_file(self, session_id: str, selector: str, file_path: str) -> ToolResult:
        """上传文件"""
        try:
            page = await self._get_page(session_id)
            if not page:
                return ToolResult(False, error=f"Session '{session_id}' 不存在")

            await page.set_input_files(selector, file_path)
            return ToolResult(True, meta={"message": f"已上传文件: {file_path}"})
        except Exception as e:
            return ToolResult(False, error=str(e))

    async def download_file(self, session_id: str, url: str, save_path: str) -> ToolResult:
        """下载文件"""
        try:
            page = await self._get_page(session_id)
            if not page:
                return ToolResult(False, error=f"Session '{session_id}' 不存在")

            import aiohttp
            import os
            
            async with aiohttp.ClientSession() as session:
                async with session.get(url) as response:
                    if response.status == 200:
                        # 确保目录存在
                        os.makedirs(os.path.dirname(save_path), exist_ok=True)
                        with open(save_path, 'wb') as f:
                            f.write(await response.read())
                        return ToolResult(
                            True,
                            data={"path": save_path},
                            meta={"message": f"文件已下载: {save_path}"}
                        )
                    else:
                        return ToolResult(False, error=f"下载失败，状态码: {response.status}")
        except Exception as e:
            return ToolResult(False, error=str(e))

    async def get_page_markdown(self, session_id: str, selector: Optional[str] = None) -> ToolResult:
        """获取页面内容并转换为 Markdown 格式"""
        try:
            page = await self._get_page(session_id)
            if not page:
                return ToolResult(False, error=f"Session '{session_id}' 不存在")

            # 获取页面 HTML
            if selector:
                # 获取指定元素的 HTML
                element = await page.query_selector(selector)
                if not element:
                    return ToolResult(False, error=f"未找到元素: {selector}")
                html = await element.inner_html()
            else:
                # 获取整个页面的 body HTML
                html = await page.inner_html("body")

            # 使用 markdownify 转换为 Markdown
            try:
                from markdownify import markdownify as md
                markdown_content = md(html, heading_style="ATX")
            except ImportError:
                return ToolResult(
                    False, 
                    error="未安装 markdownify，请运行: pip install markdownify"
                )

            # 限制返回内容长度（避免 token 过多）
            max_length = 10000
            if len(markdown_content) > max_length:
                markdown_content = markdown_content[:max_length] + "\n\n... (内容已截断)"

            return ToolResult(
                True,
                data=markdown_content,
                meta={
                    "url": page.url,
                    "length": len(markdown_content),
                    "message": f"页面已转换为 Markdown，共 {len(markdown_content)} 字符"
                }
            )
        except Exception as e:
            return ToolResult(False, error=f"获取页面 Markdown 失败: {str(e)}")
