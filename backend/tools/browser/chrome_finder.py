"""
Chrome 查找器
跨平台查找本机 Chrome，找不到则使用 Playwright Chromium
"""

import os
import platform
from typing import Optional


class ChromeFinder:
    """跨平台 Chrome 查找器"""

    @staticmethod
    def find() -> Optional[str]:
        """
        查找 Chrome 可执行文件

        Returns:
            str: Chrome 路径，找不到返回 None
        """
        system = platform.system()

        if system == "Windows":
            return ChromeFinder._find_windows()
        elif system == "Darwin":
            return ChromeFinder._find_macos()
        else:  # Linux
            return ChromeFinder._find_linux()

    @staticmethod
    def _find_windows() -> Optional[str]:
        """Windows 下查找 Chrome"""
        paths = [
            # Chrome
            os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), r"Google\Chrome\Application\chrome.exe"),
            os.path.join(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"), r"Google\Chrome\Application\chrome.exe"),
            os.path.join(os.environ.get("LocalAppData", r"C:\Users\%USERNAME%\AppData\Local"), r"Google\Chrome\Application\chrome.exe"),
            # Edge
            os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), r"Microsoft\Edge\Application\msedge.exe"),
            os.path.join(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"), r"Microsoft\Edge\Application\msedge.exe"),
        ]

        for path in paths:
            if os.path.isfile(path):
                print(f"[ChromeFinder] 找到 Windows Chrome: {path}")
                return path

        return None

    @staticmethod
    def _find_macos() -> Optional[str]:
        """macOS 下查找 Chrome"""
        paths = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        ]

        for path in paths:
            if os.path.isfile(path):
                print(f"[ChromeFinder] 找到 macOS Chrome: {path}")
                return path

        return None

    @staticmethod
    def _find_linux() -> Optional[str]:
        """Linux 下查找 Chrome"""
        paths = [
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/usr/bin/microsoft-edge",
            "/usr/bin/brave-browser",
        ]

        for path in paths:
            if os.path.isfile(path):
                print(f"[ChromeFinder] 找到 Linux Chrome: {path}")
                return path

        return None

    @staticmethod
    def get_browser_type(path: str) -> str:
        """根据路径判断浏览器类型"""
        path_lower = path.lower()
        if "chrome" in path_lower:
            return "Chrome"
        elif "edge" in path_lower:
            return "Edge"
        elif "brave" in path_lower:
            return "Brave"
        elif "chromium" in path_lower:
            return "Chromium"
        return "Unknown"
