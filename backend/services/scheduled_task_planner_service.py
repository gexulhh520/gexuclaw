import json
import re
import hashlib
import traceback
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from llm.client import llm_client_instance
from models.chat_session import ChatMessage, ChatSession
from models.scheduled_task import ScheduledTask
from schemas.scheduled_task_planner import (
    ScheduledTaskDraftContent,
    ScheduledTaskExecutionStep,
    ScheduledTaskFeasibility,
)
from services.chat_session_service import chat_session_service
from services.agent_execution_service import get_execution_steps_by_message
from services.memory_retrieval_service import memory_retrieval_service
from services.user_service import user_service


DEFAULT_TOOL_WHITELIST = [
    "browser__launch_browser",
    "browser__navigate",
    "browser__click",
    "browser__fill",
    "browser__type",
    "browser__press",
    "browser__get_text",
    "browser__get_page_info",
    "browser__get_page_markdown",
    "browser__close_session",
    "network__fetch",
    "network__fetch_url",
    "network__http_get",
    "network__http_post",
    "knowledge__search",
]


class ScheduledTaskPlannerService:
    async def build_draft(
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
    ) -> Tuple[ScheduledTask, ScheduledTaskDraftContent]:
        session = chat_session_service.get_user_session(db, user_id, session_id)
        if not session:
            raise ValueError("聊天会话不存在")

        user = user_service.get_user_by_id(db, user_id)
        timezone = timezone or getattr(user, "timezone", None) or "Asia/Shanghai"
        schedule_text = schedule_text or await self._resolve_schedule_text(
            intent_text,
            provider=provider,
            model=model,
        )
        trace_context, latest_message_id = await self._build_trace_context(
            db,
            user_id=user_id,
            session_db_id=session.id,
            intent_text=intent_text,
        )

        task = ScheduledTask(
            user_id=user_id,
            source_session_id=session_id,
            source_message_id=trigger_message_id or latest_message_id,
            title=self._build_title(intent_text),
            description=self._build_description(self._build_title(intent_text), schedule_text),
            intent_text=intent_text,
            schedule_type="natural_language",
            schedule_text=schedule_text,
            cron_expression="",
            timezone=timezone,
            status="analysis_running",
            analysis_status="analysis_running",
            preview_status="pending",
            dedupe_key=self._build_dedupe_key(user_id, session_id, intent_text, schedule_text),
            planner_version="v1",
            notification_targets_json=self._build_notification_targets(user),
            draft_expires_at=datetime.utcnow() + timedelta(days=7),
        )
        db.add(task)
        db.commit()
        db.refresh(task)

        draft_content = await self._generate_draft_content(
            trace_context=trace_context,
            intent_text=intent_text,
            schedule_text=schedule_text,
            timezone=timezone,
            provider=provider,
            model=model,
        )

        cron_expression, next_run_at = self._compute_schedule(
            draft_content.schedule_text or schedule_text,
            draft_content.timezone or timezone,
            draft_content.cron_expression or None,
        )
        draft_content.cron_expression = cron_expression
        draft_content.timezone = draft_content.timezone or timezone
        draft_content.title = self._normalize_title(draft_content.title, intent_text)
        draft_content.description = self._normalize_description(
            draft_content.description,
            draft_content.title,
            draft_content.schedule_text,
        )
        draft_content.summary_markdown = self._build_summary_markdown(draft_content)

        task.title = draft_content.title
        task.description = draft_content.description
        task.schedule_text = draft_content.schedule_text
        task.cron_expression = cron_expression
        task.timezone = draft_content.timezone
        task.status = "draft"
        task.analysis_status = "draft"
        task.draft_summary_markdown = draft_content.summary_markdown
        task.delivery_channels = draft_content.delivery_channels
        task.plan_json = self._build_execution_plan(draft_content)
        task.raw_trace_json = trace_context
        task.feasibility_json = draft_content.feasibility.model_dump()
        task.retry_policy_json = draft_content.retry_policy
        task.budget_policy_json = draft_content.budget_policy
        task.tool_whitelist_json = draft_content.tool_whitelist or DEFAULT_TOOL_WHITELIST
        task.next_run_at = next_run_at
        db.commit()
        db.refresh(task)
        return task, draft_content

    async def _build_trace_context(
        self,
        db: Session,
        user_id: int,
        session_db_id: int,
        intent_text: str,
    ) -> Tuple[Dict[str, Any], Optional[int]]:
        session = db.query(ChatSession).filter(ChatSession.id == session_db_id).first()
        if not session:
            raise ValueError(f"session_db_id={session_db_id} 对应会话不存在")

        messages = chat_session_service.get_session_messages_with_contents(db, session_db_id)
        latest_assistant_message_id: Optional[int] = None
        execution_items: List[Dict[str, Any]] = []
        memory_bundle = {"recent_context": [], "retrieved_context": []}
        try:
            memory_bundle = memory_retrieval_service.build_context_bundle(
                db=db,
                user_id=user_id,
                session_db_id=session_db_id,
                query=intent_text,
                recent_limit=4,
                top_k=5,
            )
        except Exception as exc:
            print(
                "[Planner Warn] build_context_bundle failed, fallback to empty memory bundle | "
                f"session_db_id={session_db_id} user_id={user_id} error={exc}\n"
                f"{traceback.format_exc()}"
            )

        for message in messages:
            if message.get("role") == "assistant":
                latest_assistant_message_id = message["id"]
                try:
                    steps = await get_execution_steps_by_message(db, message["id"])
                except Exception as exc:
                    print(
                        "[Planner Warn] get_execution_steps_by_message failed, skip message steps | "
                        f"message_id={message['id']} error={exc}"
                    )
                    steps = []
                if steps:
                    execution_items.extend(
                        [
                            {
                                "message_id": message["id"],
                                "step_type": step.step_type,
                                "content": step.content,
                                "tool_name": step.tool_name,
                                "tool_status": step.tool_status,
                                "metadata": getattr(step, "extra_data", None) or {},
                            }
                            for step in steps
                        ]
                    )

        compact_messages = []
        for message in messages[-12:]:
            text_parts = []
            for item in message.get("content", []):
                if item.get("type") == "text" and item.get("content"):
                    text_parts.append(item.get("content"))
            compact_messages.append(
                {
                    "id": message.get("id"),
                    "role": message.get("role"),
                    "text": "\n".join(text_parts)[:1000],
                }
            )

        return {
            "messages": compact_messages,
            "execution_steps": execution_items,
            "replayable_steps": self._merge_execution_steps(execution_items),
            "recent_context": memory_bundle.get("recent_context", []),
            "retrieved_context": memory_bundle.get("retrieved_context", []),
            "knowledge_base_ids": list(getattr(session, "knowledge_base_ids", []) or []),
        }, latest_assistant_message_id

    async def _generate_draft_content(
        self,
        trace_context: Dict[str, Any],
        intent_text: str,
        schedule_text: str,
        timezone: str,
        provider: Optional[str] = None,
        model: Optional[str] = None,
    ) -> ScheduledTaskDraftContent:
        fallback = self._build_fallback_draft(trace_context, intent_text, schedule_text, timezone)
        prompt = self._build_planner_prompt(trace_context, intent_text, schedule_text, timezone)

        try:
            response = await llm_client_instance.chat(
                messages=[{"role": "user", "content": prompt}],
                provider=provider or "openai",
                model=model,
                temperature=0.2,
                system_prompt=(
                    "你是定时任务规划器。输出必须是合法 JSON，不要输出 markdown，不要输出解释。"
                ),
            )
            content = response.get("content") or ""
            data = self._parse_json(content)
            if not data:
                return fallback

            if "feasibility" not in data:
                data["feasibility"] = fallback.feasibility.model_dump()
            if "tool_whitelist" not in data:
                data["tool_whitelist"] = DEFAULT_TOOL_WHITELIST
            if "delivery_channels" not in data:
                data["delivery_channels"] = ["in_app"]
            if "raw_trace_summary" not in data:
                data["raw_trace_summary"] = trace_context
            if "summary_markdown" not in data:
                data["summary_markdown"] = self._build_summary_markdown(fallback)
            return ScheduledTaskDraftContent(**data)
        except Exception:
            return fallback

    def _build_planner_prompt(
        self,
        trace_context: Dict[str, Any],
        intent_text: str,
        schedule_text: str,
        timezone: str,
    ) -> str:
        return (
            "请将以下聊天与执行轨迹总结为一个可确认的定时任务草案。\n"
            "要求：\n"
            "1. 只输出 JSON。\n"
            "2. 优先保留最终成功路径，剔除明显失败或冗余步骤。\n"
            "3. 给出可行性评估、风险、预检查和失败处理。\n"
            "4. delivery_channels 第一版默认包含 in_app。\n"
            "5. tool_whitelist 只填写真正需要的工具。\n\n"
            "6. 优先参考 recent_context 中的最近轮次摘要，必要时结合 retrieved_context 中的历史召回记忆。\n"
            "7. 如果 retrieved_context 与最近上下文冲突，优先选择更符合用户当前意图且结果明确成功的候选。\n\n"
            f"用户意图：{intent_text}\n"
            f"调度描述：{schedule_text}\n"
            f"时区：{timezone}\n"
            f"执行轨迹上下文：{json.dumps(trace_context, ensure_ascii=False)}\n\n"
            "输出字段："
            "{title,description,schedule_text,cron_expression,timezone,delivery_channels,"
            "execution_steps,success_criteria,failure_handlers,feasibility,retry_policy,"
            "budget_policy,tool_whitelist,summary_markdown,raw_trace_summary}"
        )

    def _build_fallback_draft(
        self,
        trace_context: Dict[str, Any],
        intent_text: str,
        schedule_text: str,
        timezone: str,
    ) -> ScheduledTaskDraftContent:
        execution_steps = trace_context.get("replayable_steps") or self._merge_execution_steps(
            trace_context.get("execution_steps", [])
        )
        successful_tools = []
        failure_tools = []
        plan_steps: List[ScheduledTaskExecutionStep] = []

        for idx, step in enumerate(execution_steps):
            tool_name = step.get("tool_name")
            status = step.get("tool_status")
            if tool_name and status == "success":
                successful_tools.append(tool_name)
                params = step.get("params") or {}
                plan_steps.append(
                    ScheduledTaskExecutionStep(
                        step_index=len(plan_steps) + 1,
                        title=self._build_step_title(tool_name, params),
                        tool_name=tool_name,
                        action=self._build_step_action(tool_name, params),
                        params=params,
                        success_condition="工具调用成功并返回有效结果",
                        failure_handler="记录失败并根据重试策略重试，连续失败则暂停任务",
                    )
                )
            elif tool_name and status == "failed":
                failure_tools.append(tool_name)

        if not plan_steps:
            plan_steps.append(
                ScheduledTaskExecutionStep(
                    step_index=1,
                    title="重新规划执行任务",
                    action="根据用户目标重新生成执行计划",
                    success_condition="得到可执行计划并通过预检查",
                    failure_handler="通知用户人工修正任务",
                )
            )

        return ScheduledTaskDraftContent(
            title=self._build_title(intent_text),
            description=self._build_description(self._build_title(intent_text), schedule_text),
            schedule_text=schedule_text,
            cron_expression="",
            timezone=timezone,
            delivery_channels=["in_app"],
            execution_steps=plan_steps,
            success_criteria=["任务按计划执行并产生有效结果"],
            failure_handlers=["连续失败超过阈值自动暂停并发送站内通知"],
            feasibility=ScheduledTaskFeasibility(
                is_feasible=True,
                estimated_success_rate=0.75 if successful_tools else 0.45,
                estimated_cost="medium",
                risks=[f"历史失败工具: {', '.join(sorted(set(failure_tools)))}"] if failure_tools else [],
                feasibility_reasons=["已基于历史执行轨迹提炼可执行路径"],
                required_tools=sorted(set(successful_tools)) or ["planner"],
                required_permissions=[],
                preflight_checks=["检查登录态", "检查关键工具可用性"],
            ),
            retry_policy={"max_retries": 3, "backoff": "exponential"},
            budget_policy={"max_llm_calls": 5, "kill_switch": True},
            tool_whitelist=sorted(set(successful_tools)) or DEFAULT_TOOL_WHITELIST,
            summary_markdown="",
            raw_trace_summary=trace_context,
        )

    def _extract_schedule_text(self, intent_text: str) -> str:
        match = re.search(r"(每天.*|每周.*|每月.*|工作日.*|今天.*|明天.*)", intent_text)
        return match.group(1) if match else "每天 09:00"

    async def _resolve_schedule_text(
        self,
        intent_text: str,
        provider: Optional[str] = None,
        model: Optional[str] = None,
    ) -> str:
        schedule_text = self._extract_schedule_text(intent_text)
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
            text = re.sub(r"^```(?:json)?", "", text).strip("` ").strip()
            return text[:120] or None
        except Exception:
            return None

    def _compute_schedule(
        self,
        schedule_text: str,
        timezone: str,
        cron_expression: Optional[str] = None,
    ) -> Tuple[str, datetime]:
        tz = ZoneInfo(timezone)
        now = datetime.now(tz)
        if cron_expression:
            return cron_expression, self._next_run_from_text(schedule_text, now)
        normalized_cron = self._natural_language_to_cron(schedule_text)
        return normalized_cron, self._next_run_from_text(schedule_text, now)

    def _natural_language_to_cron(self, schedule_text: str) -> str:
        hour, minute = self._extract_time(schedule_text)
        if "工作日" in schedule_text:
            return f"{minute} {hour} * * 1-5"
        if "每周" in schedule_text:
            weekday_map = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 0, "天": 0}
            weekday = 1
            for key, value in weekday_map.items():
                if f"周{key}" in schedule_text or f"星期{key}" in schedule_text:
                    weekday = value
                    break
            return f"{minute} {hour} * * {weekday}"
        if "每月" in schedule_text:
            day = re.search(r"(\d{1,2})[号日]", schedule_text)
            day_num = int(day.group(1)) if day else 1
            return f"{minute} {hour} {day_num} * *"
        if "明天" in schedule_text or "今天" in schedule_text:
            return f"{minute} {hour} * * *"
        return f"{minute} {hour} * * *"

    def _next_run_from_text(self, schedule_text: str, now: datetime) -> datetime:
        hour, minute = self._extract_time(schedule_text)
        candidate = now.replace(hour=hour, minute=minute, second=0, microsecond=0)

        if "明天" in schedule_text:
            return candidate + timedelta(days=1)

        if "工作日" in schedule_text:
            while candidate.weekday() > 4 or candidate <= now:
                candidate += timedelta(days=1)
                candidate = candidate.replace(hour=hour, minute=minute, second=0, microsecond=0)
            return candidate

        if "每周" in schedule_text:
            weekday_map = {"一": 0, "二": 1, "三": 2, "四": 3, "五": 4, "六": 5, "日": 6, "天": 6}
            target = 0
            for key, value in weekday_map.items():
                if f"周{key}" in schedule_text or f"星期{key}" in schedule_text:
                    target = value
                    break
            delta = (target - candidate.weekday()) % 7
            if delta == 0 and candidate <= now:
                delta = 7
            return candidate + timedelta(days=delta)

        if candidate <= now:
            candidate += timedelta(days=1)
        return candidate

    def _extract_time(self, schedule_text: str) -> Tuple[int, int]:
        match = re.search(r"(\d{1,2})[:点时](\d{1,2})?", schedule_text)
        hour = 9
        minute = 0
        if match:
            hour = int(match.group(1))
            minute = int(match.group(2) or 0)
        if "下午" in schedule_text and hour < 12:
            hour += 12
        if "晚上" in schedule_text and hour < 12:
            hour += 12
        return hour, minute

    def _build_title(self, intent_text: str) -> str:
        cleaned = re.sub(r"\s+", " ", intent_text).strip()
        cleaned = re.sub(r"^(把|将|请|帮我|帮忙|麻烦把)", "", cleaned).strip()
        cleaned = re.sub(r"(设成|设置为|改成|变成|加入).*(定时任务|自动执行.*|每天.*执行|每周.*执行|每月.*执行)$", "", cleaned).strip(" ，。,.")
        cleaned = re.sub(r"(并在完成后.*|并发送通知.*)$", "", cleaned).strip(" ，。,.")
        return cleaned[:40] or "定时任务"

    def _build_description(self, title: str, schedule_text: str) -> str:
        return f"按 {schedule_text} 定时执行“{title}”，并复用已验证的工具路径。"

    def _normalize_title(self, title: str, intent_text: str) -> str:
        normalized = re.sub(r"\s+", " ", (title or "")).strip()
        if not normalized or normalized == intent_text.strip() or len(normalized) > 50:
            return self._build_title(intent_text)
        return normalized[:40]

    def _normalize_description(self, description: str, title: str, schedule_text: str) -> str:
        normalized = re.sub(r"\s+", " ", (description or "")).strip()
        if not normalized or normalized == title or normalized.endswith(title):
            return self._build_description(title, schedule_text)
        return normalized[:240]

    def _build_execution_plan(self, draft: ScheduledTaskDraftContent) -> Dict[str, Any]:
        return {
            "version": "v1",
            "execution_steps": [
                {
                    "step_index": step.step_index,
                    "title": step.title,
                    "tool_name": step.tool_name,
                    "params": step.params or {},
                    "success_condition": step.success_condition,
                    "failure_handler": step.failure_handler,
                }
                for step in draft.execution_steps
            ],
            "success_criteria": draft.success_criteria,
        }

    def _merge_execution_steps(self, execution_steps: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        merged: Dict[str, Dict[str, Any]] = {}
        fallback_index = 0
        for step in execution_steps:
            metadata = step.get("metadata") or {}
            tool_call_id = metadata.get("tool_call_id")
            if not tool_call_id:
                fallback_index += 1
                tool_call_id = f"fallback_{step.get('message_id')}_{step.get('tool_name')}_{fallback_index}"
            current = merged.setdefault(
                tool_call_id,
                {
                    "tool_call_id": tool_call_id,
                    "tool_name": step.get("tool_name"),
                    "tool_status": None,
                    "params": {},
                    "content": None,
                },
            )
            if step.get("tool_name"):
                current["tool_name"] = step.get("tool_name")
            if step.get("step_type") == "tool_start":
                metadata_payload = metadata.get("metadata") or {}
                raw_params = metadata_payload.get("executed_arguments") or metadata_payload.get("raw_arguments")
                if isinstance(raw_params, dict):
                    current["params"] = raw_params
            if step.get("step_type") == "tool_end":
                current["tool_status"] = step.get("tool_status")
                current["content"] = step.get("content")
            elif not current.get("content") and step.get("content"):
                current["content"] = step.get("content")
            if not current.get("tool_status") and step.get("tool_status"):
                current["tool_status"] = step.get("tool_status")
        return list(merged.values())

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
            return f"调用工具 {tool_name}，参数：{json.dumps(params, ensure_ascii=False)}"
        return f"调用工具 {tool_name}"

    def _build_summary_markdown(self, draft: ScheduledTaskDraftContent) -> str:
        steps = "\n".join(
            [f"- {step.step_index}. {step.title}" for step in draft.execution_steps[:5]]
        ) or "- 暂无步骤"
        risks = "\n".join([f"- {item}" for item in draft.feasibility.risks[:5]]) or "- 暂无显著风险"
        channels = ", ".join(draft.delivery_channels or ["in_app"])
        return (
            f"### {draft.title}\n\n"
            f"- 频率：{draft.schedule_text}\n"
            f"- Cron：`{draft.cron_expression or '待计算'}`\n"
            f"- 时区：`{draft.timezone}`\n"
            f"- 通知：{channels}\n"
            f"- 成功率预估：{draft.feasibility.estimated_success_rate or 0:.2f}\n\n"
            f"#### 执行步骤\n{steps}\n\n"
            f"#### 风险\n{risks}"
        )

    def _build_notification_targets(self, user) -> Dict[str, Any]:
        return {
            "in_app": {"enabled": True},
            "email": {
                "enabled": bool(getattr(user, "email_notifications_enabled", False)),
                "target": getattr(user, "notification_email", None) or getattr(user, "email", None),
            },
            "wechat": {
                "enabled": bool(getattr(user, "wechat_notifications_enabled", False)),
                "config": getattr(user, "wechat_config_json", None) or {},
                "channel_type": getattr(user, "wechat_channel_type", "clawbot"),
            },
        }

    def _build_dedupe_key(self, user_id: int, session_id: str, intent_text: str, schedule_text: str) -> str:
        raw = f"{user_id}:{session_id}:{intent_text}:{schedule_text}"
        return hashlib.sha1(raw.encode("utf-8")).hexdigest()

    def _parse_json(self, content: str) -> Optional[Dict[str, Any]]:
        if not content:
            return None
        cleaned = content.strip()
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```(?:json)?", "", cleaned)
            cleaned = re.sub(r"```$", "", cleaned).strip()
        try:
            return json.loads(cleaned)
        except Exception:
            match = re.search(r"\{[\s\S]*\}", cleaned)
            if not match:
                return None
            try:
                return json.loads(match.group(0))
            except Exception:
                return None


scheduled_task_planner_service = ScheduledTaskPlannerService()
