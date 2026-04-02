"""
工具基础模块
包含所有工具类的抽象基类和通用接口
"""

import os
import asyncio
import inspect
from abc import ABC, abstractmethod
from typing import Dict, Any, List, Optional
from pathlib import Path

from .tool_result import ToolResult
from .tool_operation import ToolOperation


class BaseTool(ABC):
    """
    工具基类
    所有工具必须继承此类
    """

    # 工具类别名称（中文）
    category: str = ""

    # 工具描述
    description: str = ""

    def __init__(self):
        self.operations: Dict[str, ToolOperation] = {}
        self._register_operations()

    @abstractmethod
    def _register_operations(self):
        """
        子类必须实现此方法，注册所有操作
        """
        pass

    def get_operations(self) -> List[ToolOperation]:
        """
        获取所有操作定义
        """
        return list(self.operations.values())

    def execute(self, operation: str, args: Dict[str, Any]) -> ToolResult:
        """
        执行指定操作（同步版本）
        """
        if operation not in self.operations:
            return ToolResult(False, error=f"未知操作: {operation}")

        op = self.operations[operation]
        try:
            if inspect.iscoroutinefunction(op.func):
                # 异步函数 - 在同步环境中无法执行，返回错误
                return ToolResult(False, error="异步操作需要在异步环境中执行，请使用 execute_async")
            else:
                # 同步函数直接调用
                return op.func(**args)
        except Exception as e:
            return ToolResult(False, error=f"执行失败: {str(e)}")

    async def execute_async(self, operation: str, args: Dict[str, Any]) -> ToolResult:
        """
        执行指定操作（异步版本）
        支持同步和异步函数
        """
        if operation not in self.operations:
            return ToolResult(False, error=f"未知操作: {operation}")

        op = self.operations[operation]
        try:
            if inspect.iscoroutinefunction(op.func):
                # 异步函数 - 直接 await
                return await op.func(**args)
            else:
                # 同步函数直接调用
                return op.func(**args)
        except Exception as e:
            return ToolResult(False, error=f"执行失败: {str(e)}")

    def to_dict(self) -> Dict[str, Any]:
        """
        转换为字典，用于序列化
        """
        return {
            "category": self.category,
            "description": self.description,
            "operations": [op.to_dict() for op in self.get_operations()],
        }


class FileSystemToolBase(BaseTool):
    """
    文件系统工具基类
    提供通用的路径安全检查
    """

    # 允许访问整个文件系统（谨慎使用）
    BASE_DIR = Path("/") if os.name != 'nt' else Path("C:/")

    def __init__(self):
        # 确保工作目录存在
        self.BASE_DIR.mkdir(parents=True, exist_ok=True)
        super().__init__()

    def _register_operations(self):
        """
        文件系统工具基类不注册具体操作，由子类实现
        """
        pass

    def _safe_path(self, path: str) -> Path:
        """
        安全路径检查，支持绝对路径和相对路径
        - 相对路径：基于 BASE_DIR
        - 绝对路径：直接使用（Windows 支持 D:\ 等盘符）
        """
        # 如果是绝对路径，直接使用
        if os.path.isabs(path):
            full_path = Path(path).resolve()
        else:
            # 相对路径，基于 BASE_DIR
            full_path = (self.BASE_DIR / path).resolve()
        
        return full_path


class NetworkToolBase(BaseTool):
    """
    网络工具基类
    提供通用的网络请求功能
    """

    timeout: int = 30
    max_retries: int = 3

    def __init__(self, timeout: int = 30):
        self.timeout = timeout
        super().__init__()

    def _register_operations(self):
        """
        网络工具基类不注册具体操作，由子类实现
        """
        pass


class SystemToolBase(BaseTool):
    """
    系统工具基类
    提供系统信息获取等功能
    """

    def _register_operations(self):
        """
        系统工具基类不注册具体操作，由子类实现
        """
        pass
