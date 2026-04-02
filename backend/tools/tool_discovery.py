"""
工具自动发现模块
自动扫描 tools 目录及其子目录下的所有工具类并注册
"""

import os
import sys
import importlib
import inspect
from pathlib import Path
from typing import Dict, Any, Type, List

from .tool_registry import registry


def discover_tools(tools_dir: str = None, package_name: str = "tools") -> Dict[str, Any]:
    """
    自动发现 tools 目录及其子目录下的所有工具类

    扫描规则：
    1. 扫描所有子目录下的 tool.py 文件（如 file_system/tool.py）
    2. 查找文件中所有继承自 BaseTool 的类
    3. 检查类是否有 get_operations 方法（工具类特征）
    4. 自动注册到 registry

    返回：
        发现的工具类别字典 {category: tool_class}
    """
    if tools_dir is None:
        # 默认使用当前文件所在目录
        tools_dir = Path(__file__).parent

    tools_path = Path(tools_dir)
    discovered = {}

    # 方法1: 扫描子目录下的 tool.py
    discovered.update(_scan_subdirectories(tools_path, package_name))

    # 方法2: 扫描根目录下的 *_tool.py（向后兼容）
    discovered.update(_scan_root_directory(tools_path, package_name))

    return discovered


def _scan_subdirectories(tools_path: Path, package_name: str) -> Dict[str, Any]:
    """
    扫描子目录下的 tool.py 文件
    例如: tools/file_system/tool.py
    """
    discovered = {}

    # 获取所有子目录
    for subdir in tools_path.iterdir():
        if not subdir.is_dir():
            continue

        # 跳过特殊目录
        if subdir.name.startswith("_") or subdir.name.startswith("."):
            continue

        # 查找 tool.py
        tool_file = subdir / "tool.py"
        if not tool_file.exists():
            continue

        module_name = f"{subdir.name}.tool"
        full_module_name = f"{package_name}.{module_name}"

        try:
            # 动态导入模块
            if full_module_name in sys.modules:
                del sys.modules[full_module_name]

            module = importlib.import_module(full_module_name)

            # 查找模块中的工具类
            for name, obj in inspect.getmembers(module, inspect.isclass):
                # 跳过内部类和导入的类
                if name.startswith("_"):
                    continue
                
                # 跳过基类（名称以 Base 结尾的类）
                if name.endswith("Base"):
                    continue
                
                # 确保类定义在当前模块中，而不是从其他模块导入的
                if obj.__module__ != full_module_name:
                    continue

                # 检查是否是工具类（有 get_operations 方法且不是基类）
                if hasattr(obj, "get_operations") and callable(getattr(obj, "get_operations")):
                    # 从目录名或类属性推断类别名
                    category = _extract_category(obj, subdir.name)

                    # 注册到 registry
                    registry.register(category, obj)
                    discovered[category] = obj

                    print(f"[ToolDiscovery] 发现工具: {category} -> {name} (来自 {subdir.name}/tool.py)")

        except Exception as e:
            print(f"[ToolDiscovery] 加载模块 {full_module_name} 失败: {e}")

    return discovered


def _scan_root_directory(tools_path: Path, package_name: str) -> Dict[str, Any]:
    """
    扫描根目录下的 *_tool.py 文件（向后兼容）
    例如: tools/file_system_tool.py
    """
    discovered = {}

    # 获取所有以 _tool.py 结尾的文件
    tool_files = list(tools_path.glob("*_tool.py"))

    for file_path in tool_files:
        module_name = file_path.stem  # 如: file_system_tool

        try:
            # 动态导入模块
            full_module_name = f"{package_name}.{module_name}"

            # 如果模块已导入，先移除缓存以重新加载
            if full_module_name in sys.modules:
                del sys.modules[full_module_name]

            module = importlib.import_module(full_module_name)

            # 查找模块中的工具类
            for name, obj in inspect.getmembers(module, inspect.isclass):
                # 跳过内部类和非工具类
                if name.startswith("_"):
                    continue
                
                # 跳过基类（名称以 Base 结尾的类）
                if name.endswith("Base"):
                    continue
                
                # 确保类定义在当前模块中，而不是从其他模块导入的
                if obj.__module__ != full_module_name:
                    continue

                # 检查是否是工具类（有 get_operations 方法且不是基类）
                if hasattr(obj, "get_operations") and callable(getattr(obj, "get_operations")):
                    # 从类名或文件名推断类别名
                    category = _extract_category_from_filename(name, module_name)

                    # 注册到 registry
                    registry.register(category, obj)
                    discovered[category] = obj

                    print(f"[ToolDiscovery] 发现工具: {category} -> {name} (来自 {module_name}.py)")

        except Exception as e:
            print(f"[ToolDiscovery] 加载模块 {module_name} 失败: {e}")

    return discovered


def _extract_category(tool_class: Type, dir_name: str) -> str:
    """
    从工具类和目录名提取类别名

    优先级：
    1. 工具类的 category 属性
    2. 目录名转换
    """
    # 优先使用类属性
    if hasattr(tool_class, "category") and tool_class.category:
        return tool_class.category

    # 从目录名转换
    return _dir_name_to_category(dir_name)


def _extract_category_from_filename(class_name: str, module_name: str) -> str:
    """
    从类名和模块名提取类别名（向后兼容）
    """
    # 优先使用模块名转换
    if "_tool" in module_name:
        # file_system_tool -> 文件系统
        category = module_name.replace("_tool", "").replace("_", " ")
    else:
        # FileSystemTool -> 文件系统
        category = _camel_to_chinese(class_name)

    return category


def _dir_name_to_category(dir_name: str) -> str:
    """
    将目录名转换为中文类别名

    例如：
        file_system -> 文件系统
        network -> 网络
        system -> 系统
    """
    # 简单的映射表
    mapping = {
        "file_system": "文件系统",
        "network": "网络",
        "system": "系统",
        "database": "数据库",
        "search": "搜索",
        "code": "代码",
        "math": "数学",
        "time": "时间",
        "weather": "天气",
        "web": "网页",
        "api": "API",
    }

    if dir_name in mapping:
        return mapping[dir_name]

    # 默认转换：下划线替换为空格，首字母大写
    return dir_name.replace("_", " ").title()


def _camel_to_chinese(name: str) -> str:
    """
    将驼峰命名转换为中文类别名（简化版）
    """
    # 移除 Tool 后缀
    name = name.replace("Tool", "")

    # 简单的映射
    mapping = {
        "FileSystem": "文件系统",
        "Network": "网络",
        "System": "系统",
        "Database": "数据库",
        "Search": "搜索",
        "Code": "代码",
        "Math": "数学",
        "Time": "时间",
        "Weather": "天气",
        "Web": "网页",
    }

    for en, cn in mapping.items():
        if en in name:
            return cn

    # 默认返回原名
    return name


def auto_discover_and_register():
    """
    自动发现并注册所有工具（便捷函数）

    在应用启动时调用：
        from tools.tool_discovery import auto_discover_and_register
        auto_discover_and_register()
    """
    discovered = discover_tools()

    if discovered:
        print(f"[ToolDiscovery] 共发现 {len(discovered)} 个工具类别")
        # 实例化所有工具
        registry.instantiate_all()
    else:
        print("[ToolDiscovery] 未发现任何工具")

    return discovered


# 预定义的类别映射（可扩展）
CATEGORY_MAPPING = {
    "file_system": "文件系统",
    "database": "数据库",
    "network": "网络",
    "search": "搜索",
    "code": "代码",
    "math": "数学计算",
    "time": "时间日期",
    "weather": "天气查询",
    "web": "网页操作",
    "api": "API调用",
    "system": "系统",
}


def register_from_mapping():
    """
    从映射表注册工具（另一种方式）
    适用于工具类名遵循规范的情况
    """
    for module_key, category in CATEGORY_MAPPING.items():
        # 尝试子目录方式
        module_name = f"{module_key}.tool"
        class_name = f"{module_key.title().replace('_', '')}Tool"

        try:
            module = importlib.import_module(f"tools.{module_name}")
            tool_class = getattr(module, class_name)
            registry.register(category, tool_class)
            print(f"[ToolDiscovery] 从映射注册: {category}")
            continue
        except (ImportError, AttributeError):
            pass

        # 尝试根目录方式（向后兼容）
        module_name = f"{module_key}_tool"
        class_name = f"{module_key.title().replace('_', '')}Tool"

        try:
            module = importlib.import_module(f"tools.{module_name}")
            tool_class = getattr(module, class_name)
            registry.register(category, tool_class)
            print(f"[ToolDiscovery] 从映射注册: {category}")
        except (ImportError, AttributeError):
            # 模块或类不存在，跳过
            pass
