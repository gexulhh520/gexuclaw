import asyncio
import aiohttp
from typing import Dict, Any, List
from urllib.parse import urlparse

from ..tool_result import ToolResult
from ..tool_operation import ToolOperation
from ..tool_registry import tool
from ..base import NetworkToolBase


@tool("network")
class NetworkTool(NetworkToolBase):
    """
    网络操作工具类，包含：
    - http_get: HTTP GET 请求
    - http_post: HTTP POST 请求
    - fetch_url: 获取网页内容
    """

    category = "network"
    description = "网络请求工具，支持 HTTP 请求和网页抓取"

    def _register_operations(self):
        """注册所有网络操作"""
        self.operations = {
            "http_get": ToolOperation(
                name="http_get",
                description="发送 HTTP GET 请求",
                parameters=[
                    {
                        "name": "url",
                        "type": "string",
                        "required": True,
                        "description": "请求 URL",
                    },
                    {
                        "name": "headers",
                        "type": "object",
                        "required": False,
                        "description": "请求头",
                    },
                ],
                func=self.http_get,
            ),
            "http_post": ToolOperation(
                name="http_post",
                description="发送 HTTP POST 请求",
                parameters=[
                    {
                        "name": "url",
                        "type": "string",
                        "required": True,
                        "description": "请求 URL",
                    },
                    {
                        "name": "data",
                        "type": "object",
                        "required": False,
                        "description": "请求数据",
                    },
                    {
                        "name": "headers",
                        "type": "object",
                        "required": False,
                        "description": "请求头",
                    },
                ],
                func=self.http_post,
            ),
            "fetch_url": ToolOperation(
                name="fetch_url",
                description="获取网页内容",
                parameters=[
                    {
                        "name": "url",
                        "type": "string",
                        "required": True,
                        "description": "网页 URL",
                    }
                ],
                func=self.fetch_url,
            ),
        }

    async def http_get(self, url: str, headers: Dict = None) -> ToolResult:
        """发送 HTTP GET 请求"""
        try:
            if not self._is_valid_url(url):
                return ToolResult(False, error=f"无效的 URL: {url}")

            async with aiohttp.ClientSession() as session:
                async with session.get(
                    url, headers=headers, timeout=aiohttp.ClientTimeout(total=self.timeout)
                ) as response:
                    content = await response.text()
                    return ToolResult(
                        True,
                        data={
                            "status": response.status,
                            "content": content,
                            "headers": dict(response.headers),
                        },
                        meta={"url": url},
                    )
        except Exception as e:
            return ToolResult(False, error=str(e))

    async def http_post(
        self, url: str, data: Dict = None, headers: Dict = None
    ) -> ToolResult:
        """发送 HTTP POST 请求"""
        try:
            if not self._is_valid_url(url):
                return ToolResult(False, error=f"无效的 URL: {url}")

            async with aiohttp.ClientSession() as session:
                async with session.post(
                    url,
                    json=data,
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=self.timeout),
                ) as response:
                    content = await response.text()
                    return ToolResult(
                        True,
                        data={
                            "status": response.status,
                            "content": content,
                            "headers": dict(response.headers),
                        },
                        meta={"url": url},
                    )
        except Exception as e:
            return ToolResult(False, error=str(e))

    async def fetch_url(self, url: str) -> ToolResult:
        """获取网页内容（简化版）"""
        return await self.http_get(url)

    def _is_valid_url(self, url: str) -> bool:
        """验证 URL 是否有效"""
        try:
            result = urlparse(url)
            return all([result.scheme, result.netloc])
        except:
            return False

    # 同步包装方法
    def http_get_sync(self, url: str, headers: Dict = None) -> ToolResult:
        """同步版本的 HTTP GET"""
        return asyncio.run(self.http_get(url, headers))

    def http_post_sync(
        self, url: str, data: Dict = None, headers: Dict = None
    ) -> ToolResult:
        """同步版本的 HTTP POST"""
        return asyncio.run(self.http_post(url, data, headers))
