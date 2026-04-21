import asyncio
from typing import Any, Dict, Optional, Tuple

from core.config import get_settings
from services.chat_session_service import chat_session_service
from services.notification_service import notification_service
from services.scheduled_task_runtime_service import scheduled_task_runtime_service
from services.scheduled_task_service import scheduled_task_service
from services.user_service import user_service
from agents.task_executor_agent import TaskExecutorAgentV2, TaskExecutorState
from schemas.scheduled_task_v2 import ExecutionStrategyV2


class TaskExecutionServiceV2:
    def _resolve_provider_and_model(self, db, task) -> Tuple[str, Optional[str]]:
        settings = get_settings()

        session = None
        source_session_id = getattr(task, "source_session_id", None)
        if source_session_id:
            session = chat_session_service.get_session_by_id(db, source_session_id)

        session_provider = (getattr(session, "provider", None) or "").strip().lower()
        session_model = getattr(session, "model", None) if session else None

        provider_candidates = [
            ("kimi", getattr(settings, "KIMI_API_KEY", "")),
            ("deepseek", getattr(settings, "DEEPSEEK_API_KEY", "")),
            ("openai", getattr(settings, "OPENAI_API_KEY", "")),
        ]

        if session_provider in {"kimi", "deepseek", "openai"}:
            for provider_name, api_key in provider_candidates:
                if provider_name == session_provider and api_key:
                    return provider_name, session_model

        for provider_name, api_key in provider_candidates:
            if api_key:
                model_name = getattr(settings, f"{provider_name.upper()}_MODEL", None)
                return provider_name, model_name

        raise ValueError("未配置可用的 LLM API key，请先配置 KIMI、DeepSeek 或 OpenAI 中至少一种")

    async def execute_task(self, db, task) -> Dict[str, Any]:
        plan = task.plan_json or {}
        strategy_dict = plan.get("strategy") or {}

        if not strategy_dict:
            strategy_dict = {
                "goal": task.title,
                "execution_strategy": "使用工具完成任务",
                "tool_hints": [],
                "success_criteria": [],
                "risk_notes": [],
                "reference_steps": [],
            }

        strategy = ExecutionStrategyV2(**strategy_dict)
        browser_session_id = f"scheduled_bs_{task.id}"
        provider, model = self._resolve_provider_and_model(db, task)

        agent = TaskExecutorAgentV2(
            provider=provider,
            model=model,
            session_id=browser_session_id,
        )

        state = TaskExecutorState(
            messages=[],
            browser_session_id=browser_session_id,
            user_id=task.user_id,
            knowledge_base_ids=(task.raw_trace_json or {}).get("knowledge_base_ids") or [],
            tool_whitelist=task.tool_whitelist_json or [],
            max_steps=10,
            current_step=0,
            strategy=strategy,
            llm_response=None,
            _node_events=[],
        )

        result_state = await agent.execute(state)

        events = result_state.get("_node_events", [])
        tool_messages = [e for e in events if e.get("role") == "tool" or e.get("type") == "tool_end"]
        final_response = result_state.get("llm_response", {}).get("content", "")
        success = "失败" not in final_response and len(tool_messages) > 0

        return {
            "success": success,
            "tool_messages": events,
            "final_response": final_response,
            "steps_count": result_state.get("current_step", 0),
            "provider": provider,
            "model": model,
        }


task_execution_service_v2 = TaskExecutionServiceV2()
