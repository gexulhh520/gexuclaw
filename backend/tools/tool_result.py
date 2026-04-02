from typing import Optional, Dict, Any


class ToolResult:
    """
    工具执行结果统一封装
    """

    def __init__(
        self,
        success: bool,
        data: Any = None,
        error: Optional[str] = None,
        meta: Optional[Dict[str, Any]] = None,
    ):
        self.success = success
        self.data = data
        self.error = error
        self.meta = meta or {}

    def to_dict(self) -> Dict[str, Any]:
        return {
            "success": self.success,
            "data": self.data,
            "error": self.error,
            "meta": self.meta,
        }

    def __repr__(self):
        return f"ToolResult(success={self.success}, data={self.data}, error={self.error})"
