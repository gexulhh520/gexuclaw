"""
验证 PlannerAgentV2 调用 llm_client_instance.chat() 时使用项目内部约定的 dict 消息格式。

执行方式：
    python backend/test_scripts/validate_planner_agent_message_format.py
"""

from __future__ import annotations

import asyncio
from pathlib import Path
import sys

CURRENT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = CURRENT_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import agents.planner_agent as planner_agent_module  # noqa: E402
from agents.planner_agent import PlannerAgentV2  # noqa: E402


def assert_true(condition, message: str):
    if not condition:
        raise AssertionError(message)


async def _run_validation():
    captured = {}

    async def fake_chat(messages, provider=None, model=None, temperature=None, system_prompt=None, **kwargs):
        captured["messages"] = messages
        captured["provider"] = provider
        captured["model"] = model
        captured["system_prompt"] = system_prompt
        return {
            "content": (
                '{"title":"测试任务","description":"测试描述","schedule_text":"每天早上9点",'
                '"cron_expression":"","timezone":"Asia/Shanghai","strategy":{"goal":"测试目标",'
                '"execution_strategy":"根据目标自行规划和调用工具","tool_hints":["browser__launch_browser"],'
                '"success_criteria":["任务完成目标"],"risk_notes":["无"],"reference_steps":[]},'
                '"feasibility":{"is_feasible":true,"reasons":["可以执行"],"missing_requirements":[]},'
                '"tool_whitelist":["browser__launch_browser"]}'
            )
        }

    original_chat = planner_agent_module.llm_client_instance.chat
    try:
        planner_agent_module.llm_client_instance.chat = fake_chat
        agent = PlannerAgentV2(provider="kimi", model="moonshot-v1-auto")
        result = await agent.execute(
            {
                "trace_context": {"recent_messages": [], "execution_items": []},
                "intent_text": "把刚才成功的招聘网站投递流程转成定时任务",
                "schedule_text": "每天早上9点",
                "timezone": "Asia/Shanghai",
                "goal": "每天自动投递并通知",
                "draft_content": None,
            }
        )
        messages = captured.get("messages")
        assert_true(isinstance(messages, list) and len(messages) == 1, "planner agent 未正确传递 messages")
        assert_true(isinstance(messages[0], dict), "planner agent 传入的 message 不是 dict")
        assert_true(messages[0].get("role") == "user", "planner agent message role 不正确")
        assert_true("执行轨迹上下文" in (messages[0].get("content") or ""), "planner agent prompt 内容不正确")
        assert_true(captured.get("provider") == "kimi", "provider 未透传")
        assert_true(captured.get("model") == "moonshot-v1-auto", "model 未透传")
        assert_true("合法 JSON" in (captured.get("system_prompt") or ""), "system_prompt 未设置")
        assert_true(result.get("draft_content") is not None, "draft_content 未生成")
    finally:
        planner_agent_module.llm_client_instance.chat = original_chat


def main():
    asyncio.run(_run_validation())
    print("[done] planner agent message format validation passed")


if __name__ == "__main__":
    main()
