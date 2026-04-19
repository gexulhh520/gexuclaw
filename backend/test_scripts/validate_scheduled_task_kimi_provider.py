"""
使用真实 Kimi provider 验证 scheduled_task__plan_draft 的触发情况。

执行方式：
    python backend/test_scripts/validate_scheduled_task_kimi_provider.py
"""

from __future__ import annotations

import asyncio
from pathlib import Path
import sys

CURRENT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = CURRENT_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from config.agent_config import get_system_prompt  # noqa: E402
from llm.client import llm_client_instance  # noqa: E402
from tools.tool_runtime import get_tool_runtime  # noqa: E402


async def _run_case(label: str, message: str):
    runtime = get_tool_runtime()
    tools = runtime.get_all_operations()
    response = await llm_client_instance.chat(
        messages=[{"role": "user", "content": message}],
        provider="kimi",
        tools=tools,
        system_prompt=get_system_prompt("default"),
        temperature=0.1,
    )
    tool_calls = response.get("tool_calls") or []
    scheduled_tool_calls = [
        tc for tc in tool_calls
        if (tc.get("function", {}) or {}).get("name") == "scheduled_task__plan_draft"
    ]
    print(f"\n=== {label} ===")
    print(f"user: {message}")
    print(f"content: {response.get('content')}")
    print(f"tool_calls_count: {len(tool_calls)}")
    print(f"scheduled_tool_calls_count: {len(scheduled_tool_calls)}")
    if scheduled_tool_calls:
        print(f"scheduled_tool_call: {scheduled_tool_calls[0]}")


async def main():
    await _run_case(
        "positive_case",
        "把刚才成功的招聘网站投递流程设成每天早上9点自动执行，并在完成后发通知",
    )
    await _run_case(
        "negative_case",
        "定时任务是什么意思，先给我解释一下概念，不要帮我创建任何东西",
    )


if __name__ == "__main__":
    asyncio.run(main())
