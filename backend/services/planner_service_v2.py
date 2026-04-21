from datetime import datetime, timedelta
from typing import Any, Dict, Optional, Tuple

from sqlalchemy.orm import Session

from agents.planner_agent import PlannerAgentState, PlannerAgentV2
from llm.client import llm_client_instance
from models.scheduled_task import ScheduledTask
from schemas.scheduled_task_v2 import ExecutionStrategyV2, ScheduledTaskDraftContentV2
from services.chat_session_service import chat_session_service
from services.scheduled_task_planner_service import scheduled_task_planner_service
from services.user_service import user_service


class PlannerServiceV2:
    async def build_draft_v2(
        self,
        db: Session,
        user_id: int,
        session_id: str,
        intent_text: str,
        trigger_message_id: Optional[int] = None,
        schedule_text: Optional[str] = None,
        timezone: Optional[str] = None,
        provider: Optional[str] = None,
        model: Optional[str] = None,
        goal: Optional[str] = None,
    ) -> Tuple[ScheduledTask, ScheduledTaskDraftContentV2]:
        session = chat_session_service.get_user_session(db, user_id, session_id)
        if not session:
            raise ValueError("聊天会话不存在")

        user = user_service.get_user_by_id(db, user_id)
        timezone = timezone or getattr(user, "timezone", None) or "Asia/Shanghai"
        schedule_text = schedule_text or await self._resolve_schedule_text(
            intent_text,
            provider=provider or session.provider,
            model=model or session.model,
        )

        trace_context, latest_message_id = await scheduled_task_planner_service._build_trace_context(
            db,
            user_id=user_id,
            session_db_id=session.id,
            intent_text=intent_text,
        )

        task = ScheduledTask(
            user_id=user_id,
            source_session_id=session_id,
            source_message_id=trigger_message_id or latest_message_id,
            title=scheduled_task_planner_service._build_title(intent_text),
            description=scheduled_task_planner_service._build_description(
                scheduled_task_planner_service._build_title(intent_text), schedule_text
            ),
            intent_text=intent_text,
            schedule_type="natural_language",
            schedule_text=schedule_text,
            cron_expression="",
            timezone=timezone,
            status="analysis_running",
            analysis_status="analysis_running",
            preview_status="pending",
            dedupe_key=scheduled_task_planner_service._build_dedupe_key(
                user_id, session_id, intent_text, schedule_text
            ),
            planner_version="v2",
            notification_targets_json=scheduled_task_planner_service._build_notification_targets(user),
            draft_expires_at=datetime.utcnow() + timedelta(days=7),
        )
        db.add(task)
        db.commit()
        db.refresh(task)

        agent = PlannerAgentV2(provider=provider or "openai", model=model)
        state = PlannerAgentState(
            trace_context=trace_context,
            intent_text=intent_text,
            schedule_text=schedule_text,
            timezone=timezone,
            goal=goal,
            draft_content=None,
        )
        final_state = await agent.execute(state)
        draft_content = final_state.get("draft_content")

        if not draft_content:
            raise ValueError("Planner Agent V2 未能生成有效的草案内容")

        cron_expression, next_run_at = scheduled_task_planner_service._compute_schedule(
            draft_content.schedule_text or schedule_text,
            draft_content.timezone or timezone,
            draft_content.cron_expression or None,
        )
        draft_content.cron_expression = cron_expression
        draft_content.timezone = draft_content.timezone or timezone
        draft_content.title = scheduled_task_planner_service._normalize_title(draft_content.title, intent_text)

        task.title = draft_content.title
        task.description = draft_content.description
        task.schedule_text = draft_content.schedule_text
        task.cron_expression = cron_expression
        task.timezone = draft_content.timezone
        task.status = "draft"
        task.analysis_status = "draft"
        task.draft_summary_markdown = draft_content.summary_markdown
        task.delivery_channels = draft_content.delivery_channels

        execution_steps = self._build_execution_steps_from_reference_steps(draft_content.strategy.reference_steps)
        if not execution_steps:
            execution_steps = self._build_execution_steps_from_strategy(draft_content.strategy)

        task.plan_json = {
            "version": "v2",
            "strategy": draft_content.strategy.model_dump(),
            "execution_steps": execution_steps,
        }
        task.raw_trace_json = {
            **trace_context,
            "planner_runtime": {
                "provider": provider or session.provider or "openai",
                "model": model or session.model,
            },
        }
        task.feasibility_json = draft_content.feasibility.model_dump()
        task.retry_policy_json = draft_content.retry_policy
        task.budget_policy_json = draft_content.budget_policy
        task.tool_whitelist_json = draft_content.tool_whitelist
        task.next_run_at = next_run_at

        db.commit()
        db.refresh(task)
        return task, draft_content

    async def _resolve_schedule_text(
        self,
        intent_text: str,
        provider: Optional[str] = None,
        model: Optional[str] = None,
    ) -> str:
        schedule_text = scheduled_task_planner_service._extract_schedule_text(intent_text)
        if schedule_text and schedule_text != "每天 09:00":
            return schedule_text

        inferred = await self._infer_schedule_text_with_llm(
            intent_text=intent_text,
            provider=provider,
            model=model,
        )
        return inferred or schedule_text

    async def _infer_schedule_text_with_llm(
        self,
        intent_text: str,
        provider: Optional[str] = None,
        model: Optional[str] = None,
    ) -> Optional[str]:
        prompt = (
            "请从用户意图中提取一个自然语言调度描述，只返回一行文本，不要解释，不要 JSON。\n"
            "如果能识别出明确时间，就返回类似“每天 09:00”“每周一 10:30”“每月1号 08:00”；"
            "如果识别不出，返回最合理的建议，但不要固定写 09:00。\n"
            f"用户意图：{intent_text}\n"
        )
        try:
            response = await llm_client_instance.chat(
                messages=[{"role": "user", "content": prompt}],
                provider=provider or "openai",
                model=model,
                temperature=0.0,
                system_prompt="你是调度文本提取器，只输出一行自然语言调度描述。",
            )
            text = (response.get("content") or "").strip()
            if not text:
                return None
            text = text.splitlines()[0].strip()
            return text[:120] or None
        except Exception:
            return None

    def _build_execution_steps_from_reference_steps(
        self,
        reference_steps: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        execution_steps: list[dict[str, Any]] = []
        for index, ref in enumerate(reference_steps or [], start=1):
            tool_name = (ref or {}).get("tool_name")
            if not tool_name:
                continue

            params = (ref or {}).get("key_parameters") or (ref or {}).get("params") or {}
            if not isinstance(params, dict):
                params = {}

            execution_steps.append(
                {
                    "step_index": index,
                    "title": self._build_step_title(tool_name, params),
                    "tool_name": tool_name,
                    "params": params,
                    "action": self._build_step_action(tool_name, params),
                    "success_condition": (ref or {}).get("success_condition")
                    or f"{tool_name} 调用成功并返回有效结果",
                    "failure_handler": (ref or {}).get("failure_handler")
                    or "记录失败原因并根据重试策略重试或降级处理",
                    "execution_context": (ref or {}).get("execution_context"),
                }
            )
        return execution_steps

    def _build_execution_steps_from_strategy(self, strategy: ExecutionStrategyV2) -> list[dict[str, Any]]:
        execution_steps: list[dict[str, Any]] = []
        for index, tool_name in enumerate(strategy.tool_hints or [], start=1):
            execution_steps.append(
                {
                    "step_index": index,
                    "title": self._build_step_title(tool_name, {}),
                    "tool_name": tool_name,
                    "params": {},
                    "action": self._build_step_action(tool_name, {}),
                    "success_condition": f"{tool_name} 调用成功并返回有效结果",
                    "failure_handler": "记录失败原因并根据重试策略重试或降级处理",
                }
            )
        return execution_steps

    def _build_step_title(self, tool_name: str, params: Dict[str, Any]) -> str:
        if tool_name == "browser__launch_browser":
            url = params.get("url")
            if url:
                return f"打开 {url}"
        if tool_name == "network__http_get":
            url = params.get("url")
            if url:
                return f"请求 {url}"
        return f"执行 {tool_name}"

    def _build_step_action(self, tool_name: str, params: Dict[str, Any]) -> str:
        if params:
            return f"调用工具 {tool_name}，参数：{params}"
        return f"调用工具 {tool_name}"


planner_service_v2 = PlannerServiceV2()
