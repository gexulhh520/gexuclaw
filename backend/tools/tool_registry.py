"""
工具注册中心
提供装饰器和注册表功能，支持显式注册和自动发现
"""

from typing import Dict, Any, Type, Optional, Callable
import inspect


class ToolRegistry:
    """
    工具注册表 - 单例模式
    用于管理所有工具类别的注册
    """

    _instance: Optional["ToolRegistry"] = None
    _tools: Dict[str, Any] = {}
    _tool_classes: Dict[str, Type] = {}

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def register(self, category: str, tool_class: Type = None, instance: Any = None):
        """
        注册工具

        方式1：直接注册实例
            registry.register("文件系统", instance=FileSystemTool())

        方式2：注册类（延迟实例化）
            registry.register("文件系统", FileSystemTool)

        方式3：作为装饰器
            @registry.register("文件系统")
            class FileSystemTool:
                ...
        """
        if instance is not None:
            # 直接注册实例
            self._tools[category] = instance
            self._tool_classes[category] = instance.__class__
            return instance

        if tool_class is not None:
            # 注册类，延迟实例化
            self._tool_classes[category] = tool_class
            return tool_class

        # 作为装饰器使用
        def decorator(cls: Type):
            self._tool_classes[category] = cls
            return cls

        return decorator

    def get_tool(self, category: str) -> Optional[Any]:
        """获取工具实例（延迟加载）"""
        # 如果已有实例，直接返回
        if category in self._tools:
            return self._tools[category]

        # 如果有类定义，实例化并缓存
        if category in self._tool_classes:
            tool_class = self._tool_classes[category]
            try:
                instance = tool_class()
                self._tools[category] = instance
                return instance
            except Exception as e:
                print(f"实例化工具 [{category}] 失败: {e}")
                return None

        return None

    def get_all_tools(self) -> Dict[str, Any]:
        """获取所有已实例化的工具"""
        return self._tools.copy()

    def get_all_categories(self) -> list:
        """获取所有已注册的类别"""
        return list(self._tool_classes.keys())

    def instantiate_all(self) -> Dict[str, Any]:
        """实例化所有已注册但未实例化的工具"""
        for category in self._tool_classes:
            if category not in self._tools:
                self.get_tool(category)
        return self._tools.copy()

    def clear(self):
        """清空注册表（主要用于测试）"""
        self._tools.clear()
        self._tool_classes.clear()


# 全局注册表实例
registry = ToolRegistry()


# 便捷装饰器
def tool(category: str):
    """
    工具装饰器
    自动设置类的 category 属性，并注册到 registry

    用法：
        @tool("文件系统")
        class FileSystemTool:
            ...
    """
    def decorator(cls: Type):
        # 设置 category 属性，供自动发现使用
        cls.category = category
        # 注册到 registry
        registry.register(category, cls)
        return cls

    return decorator


def register_tool(category: str, tool_class: Type = None, instance: Any = None):
    """
    注册工具的函数接口

    用法：
        # 注册类
        register_tool("文件系统", FileSystemTool)

        # 注册实例
        register_tool("文件系统", instance=FileSystemTool())
    """
    return registry.register(category, tool_class=tool_class, instance=instance)
