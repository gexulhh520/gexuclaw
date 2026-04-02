import platform
import psutil
import datetime
from typing import Dict, Any, List

from ..tool_result import ToolResult
from ..tool_operation import ToolOperation
from ..tool_registry import tool
from ..base import SystemToolBase


@tool("system")
class SystemTool(SystemToolBase):
    """
    系统信息工具类，包含：
    - get_system_info: 获取系统信息
    - get_cpu_info: 获取 CPU 信息
    - get_memory_info: 获取内存信息
    - get_disk_info: 获取磁盘信息
    - get_current_time: 获取当前时间
    """

    category = "system"
    description = "系统信息查询工具，支持获取硬件和系统状态"

    def _register_operations(self):
        """注册所有系统操作"""
        self.operations = {
            "get_system_info": ToolOperation(
                name="get_system_info",
                description="获取操作系统基本信息",
                parameters=[],
                func=self.get_system_info,
            ),
            "get_cpu_info": ToolOperation(
                name="get_cpu_info",
                description="获取 CPU 使用率和信息",
                parameters=[],
                func=self.get_cpu_info,
            ),
            "get_memory_info": ToolOperation(
                name="get_memory_info",
                description="获取内存使用情况",
                parameters=[],
                func=self.get_memory_info,
            ),
            "get_disk_info": ToolOperation(
                name="get_disk_info",
                description="获取磁盘使用情况",
                parameters=[],
                func=self.get_disk_info,
            ),
            "get_current_time": ToolOperation(
                name="get_current_time",
                description="获取当前系统时间",
                parameters=[
                    {
                        "name": "format",
                        "type": "string",
                        "required": False,
                        "description": "时间格式，如 '%Y-%m-%d %H:%M:%S'",
                    }
                ],
                func=self.get_current_time,
            ),
        }

    def get_system_info(self) -> ToolResult:
        """获取系统信息"""
        try:
            info = {
                "platform": platform.platform(),
                "system": platform.system(),
                "release": platform.release(),
                "version": platform.version(),
                "machine": platform.machine(),
                "processor": platform.processor(),
                "node": platform.node(),
            }
            return ToolResult(True, data=info)
        except Exception as e:
            return ToolResult(False, error=str(e))

    def get_cpu_info(self) -> ToolResult:
        """获取 CPU 信息"""
        try:
            info = {
                "physical_cores": psutil.cpu_count(logical=False),
                "total_cores": psutil.cpu_count(logical=True),
                "cpu_percent": psutil.cpu_percent(interval=1),
                "cpu_freq": psutil.cpu_freq()._asdict() if psutil.cpu_freq() else None,
                "per_cpu_percent": psutil.cpu_percent(interval=1, percpu=True),
            }
            return ToolResult(True, data=info)
        except Exception as e:
            return ToolResult(False, error=str(e))

    def get_memory_info(self) -> ToolResult:
        """获取内存信息"""
        try:
            mem = psutil.virtual_memory()
            info = {
                "total": mem.total,
                "available": mem.available,
                "used": mem.used,
                "free": mem.free,
                "percent": mem.percent,
                "total_gb": round(mem.total / (1024**3), 2),
                "available_gb": round(mem.available / (1024**3), 2),
                "used_gb": round(mem.used / (1024**3), 2),
            }
            return ToolResult(True, data=info)
        except Exception as e:
            return ToolResult(False, error=str(e))

    def get_disk_info(self) -> ToolResult:
        """获取磁盘信息"""
        try:
            partitions = psutil.disk_partitions()
            disk_info = []

            for partition in partitions:
                try:
                    usage = psutil.disk_usage(partition.mountpoint)
                    disk_info.append({
                        "device": partition.device,
                        "mountpoint": partition.mountpoint,
                        "fstype": partition.fstype,
                        "total": usage.total,
                        "used": usage.used,
                        "free": usage.free,
                        "percent": usage.percent,
                        "total_gb": round(usage.total / (1024**3), 2),
                        "used_gb": round(usage.used / (1024**3), 2),
                        "free_gb": round(usage.free / (1024**3), 2),
                    })
                except:
                    continue

            return ToolResult(True, data=disk_info)
        except Exception as e:
            return ToolResult(False, error=str(e))

    def get_current_time(self, format: str = "%Y-%m-%d %H:%M:%S") -> ToolResult:
        """获取当前时间"""
        try:
            now = datetime.datetime.now()
            formatted = now.strftime(format)
            return ToolResult(
                True,
                data={
                    "timestamp": now.timestamp(),
                    "iso": now.isoformat(),
                    "formatted": formatted,
                    "date": now.strftime("%Y-%m-%d"),
                    "time": now.strftime("%H:%M:%S"),
                },
                meta={"format": format},
            )
        except Exception as e:
            return ToolResult(False, error=str(e))
