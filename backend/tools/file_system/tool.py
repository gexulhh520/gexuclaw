import shutil
from pathlib import Path
from typing import Dict, Any, List

from ..tool_result import ToolResult
from ..tool_operation import ToolOperation
from ..tool_registry import tool
from ..base import FileSystemToolBase


@tool("filesystem")
class FileSystemTool(FileSystemToolBase):
    """
    文件系统操作工具类，包含：
    - read_file: 读取文件内容
    - write_file: 写入文件内容
    - list_dir: 列出目录内容
    - remove_file: 删除文件或目录
    """

    category = "filesystem"
    description = "文件系统操作工具，支持读写文件、目录管理等"

    def _register_operations(self):
        """
        注册所有文件系统操作
        """
        self.operations = {
            "read_file": ToolOperation(
                name="read_file",
                description="读取指定文件内容",
                parameters=[
                    {
                        "name": "path",
                        "type": "string",
                        "required": True,
                        "description": "文件路径,可以指定绝对路径或相对路径",
                    }
                ],
                func=self.read_file,
            ),
            "write_file": ToolOperation(
                name="write_file",
                description="写入内容到指定文件",
                parameters=[
                    {
                        "name": "path",
                        "type": "string",
                        "required": True,
                        "description": "文件路径,可以指定绝对路径或相对路径",
                    },
                    {
                        "name": "content",
                        "type": "string",
                        "required": True,
                        "description": "写入的内容",
                    },
                ],
                func=self.write_file,
            ),
            "list_dir": ToolOperation(
                name="list_dir",
                description="列出指定目录下的文件和子目录",
                parameters=[
                    {
                        "name": "path",
                        "type": "string",
                        "required": False,
                        "description": "目录路径，可以指定绝对路径或相对路径",
                    }
                ],
                func=self.list_dir,
            ),
            "remove_file": ToolOperation(
                name="remove_file",
                description="删除指定文件或目录",
                parameters=[
                    {
                        "name": "path",
                        "type": "string",
                        "required": True,
                        "description": "文件或目录路径",
                    }
                ],
                func=self.remove_file,
            ),
        }

    # ====== 操作实现 ======

    def read_file(self, path: str) -> ToolResult:
        """读取文件内容"""
        try:
            full_path = self._safe_path(path)

            if not full_path.exists():
                return ToolResult(False, error=f"文件不存在: {path}")

            if not full_path.is_file():
                return ToolResult(False, error=f"路径不是文件: {path}")

            content = full_path.read_text(encoding="utf-8")
            return ToolResult(
                True,
                data=content,
                meta={"path": str(full_path), "size": len(content)},
            )
        except Exception as e:
            return ToolResult(False, error=str(e))

    def write_file(self, path: str, content: str) -> ToolResult:
        """写入文件内容"""
        try:
            full_path = self._safe_path(path)

            # 自动创建父目录
            full_path.parent.mkdir(parents=True, exist_ok=True)

            full_path.write_text(content, encoding="utf-8")
            return ToolResult(
                True,
                data=f"已写入: {path}",
                meta={
                    "path": str(full_path),
                    "size": len(content),
                },
            )
        except Exception as e:
            return ToolResult(False, error=str(e))

    def list_dir(self, path: str = "") -> ToolResult:
        """列出目录内容"""
        try:
            full_path = self._safe_path(path)

            if not full_path.exists():
                return ToolResult(False, error=f"目录不存在: {path}")

            if not full_path.is_dir():
                return ToolResult(False, error=f"路径不是目录: {path}")

            items = []
            for p in full_path.iterdir():
                item_type = "directory" if p.is_dir() else "file"
                # 如果是绝对路径，显示完整路径；否则显示相对路径
                try:
                    rel_path = str(p.relative_to(self.BASE_DIR))
                except ValueError:
                    # 不在 BASE_DIR 下，使用绝对路径
                    rel_path = str(p)
                items.append({
                    "name": p.name,
                    "type": item_type,
                    "path": rel_path,
                })

            return ToolResult(
                True,
                data=items,
                meta={"path": str(full_path), "count": len(items)},
            )
        except Exception as e:
            return ToolResult(False, error=str(e))

    def remove_file(self, path: str) -> ToolResult:
        """删除文件或目录"""
        try:
            full_path = self._safe_path(path)

            if not full_path.exists():
                return ToolResult(False, error=f"路径不存在: {path}")

            if full_path.is_file():
                full_path.unlink()
            elif full_path.is_dir():
                shutil.rmtree(full_path)
            else:
                return ToolResult(False, error=f"未知路径类型: {path}")

            return ToolResult(True, data=f"已删除: {path}")
        except Exception as e:
            return ToolResult(False, error=str(e))
