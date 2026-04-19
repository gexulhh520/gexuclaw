"""
使用真实 Kimi provider 验证 execute_stream 事件流是否能产出定时任务草案事件。

说明：
- 使用真实 Kimi provider
- 不走真实数据库持久化子图，改为 mock 子图返回草案
- 目标是验证：真实模型会触发 `scheduled_task__plan_draft`，并且事件流中能产出
  `scheduled_task_suggestion` 和最终 `thinking_end`

执行方式：
    python backend/test_scripts/validate_scheduled_task_kimi_stream_flow.py
"""

from __future__ import annotations

import asyncio
from pathlib import Path
import sys

CURRENT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = CURRENT_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import agents.executor as executor_module  # noqa: E402
from agents.executor import AgentExecutor  # noqa: E402
from config.agent_config import get_system_prompt  # noqa: E402


def assert_true(condition, message: str):
    if not condition:
        raise AssertionError(message)


class MockSubgraph:
    async def ainvoke(self, state):
        state["task_id"] = 456
        state["draft_payload"] = {
            "id": 456,
            "title": "招聘网站投递自动化任务",
            "summary_markdown": "### 招聘网站投递自动化任务\n- 频率：每天早上9点",
            "intent_text": state.get("route_decision", {}).get("intent_text") or "",
            "analysis_status": "draft",
            "schedule_text": state.get("route_decision", {}).get("schedule_text") or "每天早上9点",
            "timezone": state.get("route_decision", {}).get("timezone") or "Asia/Shanghai",
        }
        return state


async def _collect_events():
    original_subgraph = executor_module.scheduled_task_planner_subgraph
    executor_module.scheduled_task_planner_subgraph = MockSubgraph()

    try:
        executor = AgentExecutor(
            provider="kimi",
            model=None,
            browser_session_id="bs_kimi_stream_test",
            system_prompt=get_system_prompt("default"),
            user_id=1,
            knowledge_base_ids=[],
            session_id="session_kimi_stream_test",
        )
        executor.checkpointer = None
        executor.graph = executor._build_graph(checkpointer=None)

        events = []
        async for event in executor.execute_stream(
            messages=[{"role": "user", "content": "把刚才成功的招聘网站投递流程设成每天早上9点自动执行，并在完成后发通知"}],
            thread_id="thread_kimi_stream_test",
        ):
            events.append(event)
        return events
    finally:
        executor_module.scheduled_task_planner_subgraph = original_subgraph


def main():
    events = asyncio.run(_collect_events())
    event_types = [event.get("type") for event in events]
    assert_true("scheduled_task_suggestion" in event_types, "真实 kimi 事件流中缺少 scheduled_task_suggestion")
    assert_true("thinking_end" in event_types, "真实 kimi 事件流中缺少 thinking_end")

    suggestion_event = next(event for event in events if event.get("type") == "scheduled_task_suggestion")
    assert_true(suggestion_event.get("draft_id") == 456, "draft_id 不正确")
    assert_true(suggestion_event.get("draft_title") == "招聘网站投递自动化任务", "draft_title 不正确")

    final_event = next(event for event in events if event.get("type") == "thinking_end")
    assert_true("定时任务草案" in (final_event.get("content") or ""), "最终回复未提示定时任务草案已生成")

    print("[done] scheduled task kimi stream flow validation passed")


if __name__ == "__main__":
    main()
