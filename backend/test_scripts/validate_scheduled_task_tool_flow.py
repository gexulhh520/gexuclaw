"""
验证主图方案1的最小控制流：

1. scheduled_task 工具是否以 `scheduled_task__plan_draft` 暴露
2. AgentExecutor 是否能从 tool_calls 中提取 scheduled task route
3. `_should_continue` 在不同 tool 组合下是否返回预期分支

执行方式：
    python backend/test_scripts/validate_scheduled_task_tool_flow.py
"""

from pathlib import Path
import sys

CURRENT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = CURRENT_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from agents.executor import AgentExecutor  # noqa: E402
from tools.tool_runtime import get_tool_runtime  # noqa: E402


def assert_true(condition, message: str):
    if not condition:
        raise AssertionError(message)


def main():
    runtime = get_tool_runtime()
    operations = runtime.get_all_operations()
    operation_names = [op["function"]["name"] for op in operations]
    assert_true(
        "scheduled_task__plan_draft" in operation_names,
        "工具系统未暴露 scheduled_task__plan_draft",
    )

    executor = AgentExecutor(
        provider="openai",
        model=None,
        browser_session_id="bs_test",
        system_prompt="test",
        user_id=1,
        knowledge_base_ids=[],
        session_id="session_test",
    )

    scheduled_tool_call = {
        "id": "call_1",
        "type": "function",
        "function": {
            "name": "scheduled_task__plan_draft",
            "arguments": '{"intent_text":"把刚才成功的流程设成每天9点执行","schedule_text":"每天 09:00","timezone":"Asia/Shanghai","goal":"每天自动执行并汇总结果"}',
        },
    }
    normal_tool_call = {
        "id": "call_2",
        "type": "function",
        "function": {
            "name": "browser__navigate",
            "arguments": '{"url":"https://example.com"}',
        },
    }

    route = executor._extract_scheduled_task_route([scheduled_tool_call])
    assert_true(route is not None, "未能从 scheduled task tool call 中提取 route")
    assert_true(route["should_enter_subgraph"] is True, "route 未标记 should_enter_subgraph=true")
    assert_true(route["schedule_text"] == "每天 09:00", "schedule_text 解析错误")

    state_only_scheduled = {
        "messages": [],
        "llm_response": {"tool_calls": [scheduled_tool_call]},
        "scheduled_task_route": None,
        "_node_events": [],
    }
    branch = executor._should_continue(state_only_scheduled)
    assert_true(branch == "scheduled_task_subgraph", "仅定时任务 tool 时应直接进入子图")

    state_mixed_tools = {
        "messages": [],
        "llm_response": {"tool_calls": [scheduled_tool_call, normal_tool_call]},
        "scheduled_task_route": None,
        "_node_events": [],
    }
    branch = executor._should_continue(state_mixed_tools)
    assert_true(branch == "continue", "混合 tool 时应先继续执行普通工具")
    assert_true(state_mixed_tools["scheduled_task_route"] is not None, "混合 tool 时应保留 scheduled_task_route")

    state_after_tools = {
        "messages": [],
        "llm_response": {"tool_calls": None},
        "scheduled_task_route": route,
        "_node_events": [],
    }
    branch = executor._should_continue(state_after_tools)
    assert_true(branch == "scheduled_task_subgraph", "普通工具完成后应继续进入子图")

    print("[done] scheduled task tool flow validation passed")


if __name__ == "__main__":
    main()
