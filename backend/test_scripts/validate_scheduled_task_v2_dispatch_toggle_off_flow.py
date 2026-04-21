"""
验证关闭 SCHEDULED_TASK_V2_PLANNER_DISPATCH_ENABLED 后，
V2 命中定时任务意图时不会投递后台 planner job。

执行方式：
    python backend/test_scripts/validate_scheduled_task_v2_dispatch_toggle_off_flow.py
"""

from __future__ import annotations

import asyncio
from pathlib import Path
import sys

CURRENT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = CURRENT_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from agents.executor_v2 import AgentExecutorV2  # noqa: E402
from config.agent_config import get_system_prompt  # noqa: E402
from core.config import get_settings  # noqa: E402


def assert_true(condition, message: str):
    if not condition:
        raise AssertionError(message)


class _FailIfCalledPlannerTask:
    def delay(self, **kwargs):
        raise AssertionError("planner dispatch 已关闭，但仍调用了 delay")

    def apply_async(self, *args, **kwargs):
        raise AssertionError("planner dispatch 已关闭，但仍调用了 apply_async")


async def _run_validation():
    from workers import planner_jobs as planner_jobs_module

    settings = get_settings()
    original_flag = settings.SCHEDULED_TASK_V2_PLANNER_DISPATCH_ENABLED
    original_planner_task = planner_jobs_module.generate_planner_draft_task

    try:
        settings.SCHEDULED_TASK_V2_PLANNER_DISPATCH_ENABLED = False
        planner_jobs_module.generate_planner_draft_task = _FailIfCalledPlannerTask()

        executor = AgentExecutorV2(
            provider="kimi",
            model="moonshot-v1-auto",
            browser_session_id="bs_v2_dispatch_toggle_off_test",
            system_prompt=get_system_prompt("default"),
            user_id=1,
            knowledge_base_ids=[],
            session_id="session_v2_dispatch_toggle_off_test",
        )
        state = {
            "messages": [],
            "session_id": "session_v2_dispatch_toggle_off_test",
            "llm_response": {"content": "", "tool_calls": []},
            "scheduled_task_route": {
                "tool_call_id": "call_plan_v2",
                "intent_text": "把刚才成功的招聘网站投递流程转成定时任务",
                "schedule_text": "每天早上9点",
                "goal": "每天自动投递并通知",
                "timezone": "Asia/Shanghai",
                "reason": "主 agent 调用了 scheduled_task__plan_draft",
            },
        }

        updated_state = await executor._async_dispatch_node(state)
        event_types = [event.get("type") for event in updated_state.get("_node_events", [])]
        assert_true("planner_draft_queued" not in event_types, "关闭 planner dispatch 后不应出现 planner_draft_queued")
        assert_true("thinking_end" in event_types, "关闭 planner dispatch 后仍应返回 thinking_end")
        assert_true(
            "A/B 验证模式" in ((updated_state.get("llm_response") or {}).get("content") or ""),
            "关闭 planner dispatch 后返回文案不正确",
        )
    finally:
        settings.SCHEDULED_TASK_V2_PLANNER_DISPATCH_ENABLED = original_flag
        planner_jobs_module.generate_planner_draft_task = original_planner_task


def main():
    asyncio.run(_run_validation())
    print("[done] scheduled task v2 dispatch toggle-off validation passed")


if __name__ == "__main__":
    main()
