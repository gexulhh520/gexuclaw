"""
验证 V2 定时任务异步投递链路会透传当前会话使用的 provider / model。

覆盖链路：
1. 构造命中 `scheduled_task__plan_draft` 后的 `scheduled_task_route`
2. 直接执行 `AgentExecutorV2._async_dispatch_node()`
3. 拦截 `generate_planner_draft_task.delay(...)`
4. 断言异步任务收到正确的 `provider / model`

执行方式：
    python backend/test_scripts/validate_scheduled_task_v2_dispatch_provider_flow.py
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


def assert_true(condition, message: str):
    if not condition:
        raise AssertionError(message)


class _FakeDelayResult:
    id = "job_test_v2_dispatch"


class _FakePlannerTask:
    def __init__(self, captured_kwargs: dict):
        self._captured_kwargs = captured_kwargs

    def delay(self, **kwargs):
        self._captured_kwargs.update(kwargs)
        return _FakeDelayResult()


async def _run_validation():
    captured_kwargs = {}

    # `generate_planner_draft_task` 在节点内局部导入，这里直接 patch 源模块对象。
    from workers import planner_jobs as planner_jobs_module

    original_planner_task = planner_jobs_module.generate_planner_draft_task

    try:
        planner_jobs_module.generate_planner_draft_task = _FakePlannerTask(captured_kwargs)

        executor = AgentExecutorV2(
            provider="kimi",
            model="moonshot-v1-auto",
            browser_session_id="bs_v2_dispatch_test",
            system_prompt=get_system_prompt("default"),
            user_id=1,
            knowledge_base_ids=[],
            session_id="session_v2_dispatch_test",
        )
        state = {
            "messages": [
                {
                    "role": "assistant",
                    "tool_calls": [
                        {
                            "id": "call_plan_v2",
                            "type": "function",
                            "function": {
                                "name": "scheduled_task__plan_draft",
                                "arguments": (
                                    '{"intent_text":"把刚才成功的招聘网站投递流程转成定时任务",'
                                    '"schedule_text":"每天早上9点","goal":"每天自动投递并通知"}'
                                ),
                            },
                        }
                    ],
                }
            ],
            "session_id": "session_v2_dispatch_test",
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

        assert_true(captured_kwargs.get("provider") == "kimi", "异步草案任务未透传 provider")
        assert_true(captured_kwargs.get("model") == "moonshot-v1-auto", "异步草案任务未透传 model")
        assert_true(captured_kwargs.get("session_id") == "session_v2_dispatch_test", "session_id 不正确")
        assert_true(captured_kwargs.get("intent_text"), "intent_text 为空")

        event_types = [event.get("type") for event in updated_state.get("_node_events", [])]
        assert_true("planner_draft_queued" in event_types, "缺少 planner_draft_queued 事件")
        assert_true("thinking_end" in event_types, "缺少 thinking_end 事件")
    finally:
        planner_jobs_module.generate_planner_draft_task = original_planner_task


def main():
    asyncio.run(_run_validation())
    print("[done] scheduled task v2 dispatch provider flow validation passed")


if __name__ == "__main__":
    main()
