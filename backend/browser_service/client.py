from typing import Any, Dict, Optional

import httpx

try:
    from tools.tool_result import ToolResult
except ModuleNotFoundError:
    from backend.tools.tool_result import ToolResult


class BrowserServiceClient:
    def __init__(self, base_url: str, timeout: float = 120.0):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    async def healthcheck(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(f"{self.base_url}/health")
                response.raise_for_status()
                data = response.json()
                return data.get("status") == "ok"
        except Exception:
            return False

    async def execute(self, operation: str, args: Optional[Dict[str, Any]] = None) -> ToolResult:
        payload = {
            "operation": operation,
            "args": args or {},
        }
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(f"{self.base_url}/browser/execute", json=payload)
                response.raise_for_status()
                data = response.json()
                return ToolResult(
                    success=bool(data.get("success")),
                    data=data.get("data"),
                    error=data.get("error"),
                    meta=data.get("meta") or {},
                )
        except Exception as exc:
            return ToolResult(False, error=f"浏览器服务调用失败: {str(exc)}")
