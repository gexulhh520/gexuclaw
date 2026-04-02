from typing import Dict, Any, Optional, List

from .tool_result import ToolResult
from .tool_operation import ToolOperation
from .tool_registry import registry


class ToolRuntime:
    """
    工具运行时管理器
    负责注册、管理和执行所有工具
    """

    def __init__(self, tools: Optional[Dict[str, Any]] = None):
        self.tools: Dict[str, Any] = tools or {}
        self._operation_cache: Optional[List[Dict[str, Any]]] = None

    def register_tool(self, category: str, tool_instance):
        """注册一个新的工具类别"""
        self.tools[category] = tool_instance
        # 清除缓存，下次获取时重新生成
        self._operation_cache = None

    def get_tool(self, category: str) -> Optional[Any]:
        """获取指定类别的工具实例"""
        # 优先从本地缓存获取
        if category in self.tools:
            return self.tools[category]

        # 从 registry 获取（支持自动发现的工具）
        tool = registry.get_tool(category)
        if tool:
            # 缓存到本地
            self.tools[category] = tool
        return tool

    def get_all_operations(self) -> List[Dict[str, Any]]:
        """
        获取所有工具的 operation 定义
        用于传递给 LLM 的 function calling
        """
        # 强制重新生成，避免缓存问题
        self._operation_cache = None
        
        # 确保所有已注册的工具都已实例化
        self._ensure_all_tools_loaded()

        operations = []
        print(f"[Tool Debug] Processing {len(self.tools)} tools: {list(self.tools.keys())}")
        for category, tool in self.tools.items():
            print(f"[Tool Debug] Tool '{category}': type={type(tool)}, has get_operations={hasattr(tool, 'get_operations')}")
            if hasattr(tool, "get_operations"):
                tool_ops = tool.get_operations()
                print(f"[Tool Debug] Tool '{category}' has {len(tool_ops)} operations")
                for op in tool_ops:
                    op_dict = op.to_dict()
                    # 使用类别名__操作名格式
                    original_name = op_dict["function"]["name"]
                    full_name = f"{category}__{original_name}"
                    op_dict["function"]["name"] = full_name
                    print(f"[Tool Debug] Generated function name: {full_name}")
                    operations.append(op_dict)

        self._operation_cache = operations
        print(f"[Tool Debug] Total operations generated: {len(operations)}")
        return operations

    def _ensure_all_tools_loaded(self):
        """确保所有已注册的工具都已加载"""
        for category in registry.get_all_categories():
            if category not in self.tools:
                tool = registry.get_tool(category)
                if tool:
                    self.tools[category] = tool

    def execute(self, action: Dict[str, Any]) -> ToolResult:
        """
        执行工具操作（同步版本）
        """
        try:
            if "category" in action:
                category = action.get("category")
                operation = action.get("operation")
                args = action.get("args", {})
            elif "name" in action:
                full_name = action.get("name", "")
                arguments = action.get("arguments", {})
                if "__" in full_name:
                    category, operation = full_name.split("__", 1)
                else:
                    return ToolResult(False, error=f"Invalid function name format: {full_name}")
                args = arguments
            else:
                return ToolResult(False, error=f"Unknown action format: {action}")

            tool = self.get_tool(category)
            if not tool:
                return ToolResult(False, error=f"Tool category not found: {category}")

            if hasattr(tool, "execute"):
                return tool.execute(operation, args)
            else:
                return ToolResult(False, error=f"Tool {category} does not support execute method")

        except Exception as e:
            return ToolResult(False, error=f"Tool execution failed: {str(e)}")

    async def execute_async(self, action: Dict[str, Any]) -> ToolResult:
        """
        执行工具操作（异步版本）
        支持同步和异步工具
        """
        try:
            if "category" in action:
                category = action.get("category")
                operation = action.get("operation")
                args = action.get("args", {})
            elif "name" in action:
                full_name = action.get("name", "")
                arguments = action.get("arguments", {})
                if "__" in full_name:
                    category, operation = full_name.split("__", 1)
                else:
                    return ToolResult(False, error=f"Invalid function name format: {full_name}")
                args = arguments
            else:
                return ToolResult(False, error=f"Unknown action format: {action}")

            tool = self.get_tool(category)
            if not tool:
                return ToolResult(False, error=f"Tool category not found: {category}")

            if hasattr(tool, "execute_async"):
                return await tool.execute_async(operation, args)
            elif hasattr(tool, "execute"):
                return tool.execute(operation, args)
            else:
                return ToolResult(False, error=f"Tool {category} does not support execute method")

        except Exception as e:
            return ToolResult(False, error=f"Tool execution failed: {str(e)}")

    def execute_by_name(self, full_name: str, args: Dict[str, Any]) -> ToolResult:
        """
        通过完整名称执行操作（同步版本）
        """
        if "__" not in full_name:
            return ToolResult(False, error=f"Invalid function name format: {full_name}")

        category, operation = full_name.split("__", 1)
        return self.execute({"category": category, "operation": operation, "args": args})

    async def execute_by_name_async(self, full_name: str, args: Dict[str, Any]) -> ToolResult:
        """
        通过完整名称执行操作（异步版本）
        """
        if "__" not in full_name:
            return ToolResult(False, error=f"Invalid function name format: {full_name}")

        category, operation = full_name.split("__", 1)
        return await self.execute_async({"category": category, "operation": operation, "args": args})


# ====== 全局单例 ======
_tool_runtime: Optional[ToolRuntime] = None


def get_tool_runtime() -> ToolRuntime:
    """
    获取全局 ToolRuntime 实例（懒加载 + 自动发现）

    首次调用时会：
    1. 自动发现 tools 目录下的所有工具
    2. 实例化所有工具
    3. 返回 ToolRuntime 实例
    """
    global _tool_runtime

    if _tool_runtime is None:
        _tool_runtime = ToolRuntime()

        # 自动发现工具（如果尚未发现）
        from .tool_discovery import auto_discover_and_register

        # 检查 registry 是否为空
        if not registry.get_all_categories():
            auto_discover_and_register()
        else:
            # 从 registry 加载所有工具
            _tool_runtime._ensure_all_tools_loaded()

    return _tool_runtime


def reset_tool_runtime():
    """
    重置全局 ToolRuntime（主要用于测试）
    """
    global _tool_runtime
    _tool_runtime = None
    registry.clear()
