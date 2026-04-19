"""
验证定时任务方案1的 execute_stream 联调控制流（使用 mock，不依赖真实 LLM / DB）：

1. mock LLM 返回 scheduled_task__plan_draft tool call
2. mock 子图返回草案 payload
3. 执行 AgentExecutor.execute_stream()
4. 校验事件流中是否包含 scheduled_task_suggestion 与最终 thinking_end

执行方式：
    python backend/test_scripts/validate_scheduled_task_stream_flow.py
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


def assert_true(condition, message: str):
    if not condition:
        raise AssertionError(message)


class MockLLMClient:
    async def chat(self, messages, provider=None, model=None, temperature=0.7, max_tokens=None, tools=None, system_prompt=None):
        return {
            "content": "",
            "role": "assistant",
            "tool_calls": [
                {
                    "id": "call_scheduled_task",
                    "type": "function",
                    "function": {
                        "name": "scheduled_task__plan_draft",
                        "arguments": (
                            '{"intent_text":"把刚才成功的招聘网站投递流程设成每天9点执行",'
                            '"schedule_text":"每天 09:00",'
                            '"timezone":"Asia/Shanghai",'
                            '"goal":"每天自动执行并生成结果摘要"}'
                        ),
                    },
                }
            ],
            "reasoning_content": "用户明确表达了把成功流程改成定时任务的意图。",
        }


class MockSubgraph:
    async def ainvoke(self, state):
        state["task_id"] = 123
        state["draft_payload"] = {
            "id": 123,
            "title": "招聘网站投递定时任务",
            "summary_markdown": "### 招聘网站投递定时任务\n- 频率：每天 09:00",
            "intent_text": state.get("route_decision", {}).get("intent_text") or "",
            "analysis_status": "draft",
            "schedule_text": "每天 09:00",
            "timezone": "Asia/Shanghai",
        }
        return state


async def _collect_events():
    original_llm_client = executor_module.llm_client_instance
    original_subgraph = executor_module.scheduled_task_planner_subgraph

    executor_module.llm_client_instance = MockLLMClient()
    executor_module.scheduled_task_planner_subgraph = MockSubgraph()

    try:
        executor = AgentExecutor(
            provider="openai",
            model=None,
            browser_session_id="bs_test",
            system_prompt="test",
            user_id=1,
            knowledge_base_ids=[],
            session_id="session_test",
        )
        executor.checkpointer = None
        executor.graph = executor._build_graph(checkpointer=None)

        events = []
        async for event in executor.execute_stream(
            messages=[{"role": "user", "content": "把刚才成功的招聘网站投递流程设成每天早上9点执行"}],
            thread_id="thread_test",
        ):
            events.append(event)
        return events
    finally:
        executor_module.llm_client_instance = original_llm_client
        executor_module.scheduled_task_planner_subgraph = original_subgraph


def main():
    events = asyncio.run(_collect_events())
    event_types = [event.get("type") for event in events]
    assert_true("scheduled_task_suggestion" in event_types, "事件流中缺少 scheduled_task_suggestion")
    assert_true("thinking_end" in event_types, "事件流中缺少 thinking_end")

    suggestion_event = next(event for event in events if event.get("type") == "scheduled_task_suggestion")
    assert_true(suggestion_event.get("draft_id") == 123, "draft_id 不正确")
    assert_true(suggestion_event.get("draft_title") == "招聘网站投递定时任务", "draft_title 不正确")

    final_event = next(event for event in events if event.get("type") == "thinking_end")
    assert_true("定时任务草案" in (final_event.get("content") or ""), "最终回复未提示定时任务草案已生成")

    print("[done] scheduled task stream flow validation passed")


if __name__ == "__main__":
    main()
