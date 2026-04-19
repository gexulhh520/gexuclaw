from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from core.config import get_settings
from models.scheduled_task import ScheduledTask, ScheduledTaskRun
from services.user_service import user_service
from services.scheduled_task_service import scheduled_task_service


DEFAULT_RUNTIME_WHITELIST = {
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
}


class ScheduledTaskRuntimeService:
    @staticmethod
    def get_due_tasks(db: Session, now: Optional[datetime] = None) -> List[ScheduledTask]:
        now = now or datetime.utcnow()
        return db.query(ScheduledTask).filter(
            ScheduledTask.status == "active",
            ScheduledTask.next_run_at.isnot(None),
            ScheduledTask.next_run_at <= now,
        ).order_by(ScheduledTask.next_run_at.asc(), ScheduledTask.id.asc()).all()

    @staticmethod
    def run_preflight_checks(db: Session, task: ScheduledTask) -> Dict[str, Any]:
        settings = get_settings()
        plan = task.plan_json or {}
        feasibility = task.feasibility_json or {}
        required_tools = set((feasibility.get("required_tools") or []) + (plan.get("tool_whitelist") or []))
        disallowed = [tool for tool in required_tools if tool and tool not in DEFAULT_RUNTIME_WHITELIST]
        user = user_service.get_user_by_id(db, task.user_id)

        blockers: List[str] = []
        warnings: List[str] = []
        suggested_fixes: List[str] = []

        if disallowed:
            blockers.append(f"存在不在白名单内的工具: {', '.join(disallowed)}")
            suggested_fixes.append("删除高风险工具或重新生成草案")

        if "browser__launch_browser" in required_tools and not settings.BROWSER_SERVICE_ENABLED:
            warnings.append("浏览器服务当前未开启，浏览器类步骤可能失败")
            suggested_fixes.append("启用独立浏览器服务并重启 Worker")

        notification_targets = task.notification_targets_json or {}
        if "email" in (task.delivery_channels or []):
            email_target = (notification_targets.get("email") or {}).get("target") or getattr(user, "notification_email", None) or getattr(user, "email", None)
            if not email_target or not getattr(user, "email_notifications_enabled", False):
                blockers.append("邮件通知未配置完成")
                suggested_fixes.append("在用户设置页启用邮件通知并配置默认邮箱")

        if "wechat" in (task.delivery_channels or []):
            wechat_config = (notification_targets.get("wechat") or {}).get("config") or getattr(user, "wechat_config_json", {}) or {}
            if not getattr(user, "wechat_notifications_enabled", False):
                blockers.append("微信通知未启用")
                suggested_fixes.append("在用户设置页启用微信通知")
            if not wechat_config.get("base_url") or not wechat_config.get("conversation_id"):
                blockers.append("微信配置缺少 base_url 或 conversation_id")
                suggested_fixes.append("补全 ClawBot 连接地址与会话 ID")

        if not (plan.get("execution_steps") or []):
            blockers.append("执行步骤为空")
            suggested_fixes.append("重新生成草案以补齐执行步骤")

        is_feasible = bool(feasibility.get("is_feasible", True)) and not blockers
        return {
            "is_feasible": is_feasible,
            "required_tools": sorted(required_tools),
            "disallowed_tools": disallowed,
            "checks": feasibility.get("preflight_checks") or [],
            "warnings": warnings,
            "blockers": blockers,
            "suggested_fixes": suggested_fixes,
            "reasons": feasibility.get("feasibility_reasons") or [],
        }

    @staticmethod
    def preview_task(db: Session, task: ScheduledTask) -> ScheduledTaskRun:
        preflight = ScheduledTaskRuntimeService.run_preflight_checks(db, task)
        run = scheduled_task_service.create_run(
            db,
            task,
            status_value="running",
            execution_plan_snapshot=task.plan_json or {},
            run_type="preview",
            trigger_source="preview",
            preflight_result_json=preflight,
        )

        if not preflight["is_feasible"]:
            task.preview_status = "blocked"
            task.preview_run_id = run.id
            db.commit()
            return scheduled_task_service.update_run_status(
                db,
                run,
                status_value="failed",
                error_message="预检查未通过",
                result_summary="; ".join(preflight.get("reasons") or ["存在不可执行风险"]),
                steps_json=[{"type": "preflight", "result": preflight}],
                preflight_result_json=preflight,
            )

        task.preview_status = "ready"
        task.preview_run_id = run.id
        db.commit()
        return scheduled_task_service.update_run_status(
            db,
            run,
            status_value="success",
            result_summary="预览执行通过，任务可创建",
            steps_json=[{"type": "preflight", "result": preflight}],
            preflight_result_json=preflight,
            cost_metrics_json={"estimated_success_rate": (task.feasibility_json or {}).get("estimated_success_rate")},
        )

    @staticmethod
    def simulate_task_run(db: Session, task: ScheduledTask) -> ScheduledTaskRun:
        plan = task.plan_json or {}
        steps = plan.get("execution_steps") or []
        preflight = ScheduledTaskRuntimeService.run_preflight_checks(db, task)
        run = scheduled_task_service.create_run(
            db,
            task,
            status_value="running",
            execution_plan_snapshot=plan,
            run_type="scheduled",
            trigger_source="dispatcher",
            preflight_result_json=preflight,
        )

        return scheduled_task_service.update_run_status(
            db,
            run,
            status_value="success",
            result_summary="本次为第一版模拟执行记录，已完成计划检查",
            steps_json=steps,
            preflight_result_json=preflight,
            cost_metrics_json={"simulated": True, "steps_count": len(steps)},
        )

    @staticmethod
    def update_task_after_run(db: Session, task: ScheduledTask, run: ScheduledTaskRun) -> ScheduledTask:
        task.last_run_at = datetime.utcnow()
        if run.status == "success":
            task.failure_count = 0
            task.auto_pause_reason = None
        elif run.status == "failed":
            task.failure_count += 1
            if task.failure_count >= 3:
                task.status = "paused"
                task.auto_pause_reason = "连续失败达到阈值，已自动暂停"

        task.next_run_at = ScheduledTaskRuntimeService.compute_next_run_placeholder(task)
        db.commit()
        db.refresh(task)
        return task

    @staticmethod
    def compute_next_run_placeholder(task: ScheduledTask) -> datetime:
        cron_expression = (task.cron_expression or "").strip()
        timezone = task.timezone or "Asia/Shanghai"
        try:
            tz = ZoneInfo(timezone)
        except Exception:
            tz = ZoneInfo("Asia/Shanghai")

        now = datetime.now(tz)
        parts = cron_expression.split()
        if len(parts) != 5:
            base = task.next_run_at or datetime.utcnow()
            return base + timedelta(days=1)

        minute, hour, day_of_month, month, day_of_week = parts
        candidate = now.replace(
            hour=int(hour) if hour.isdigit() else now.hour,
            minute=int(minute) if minute.isdigit() else now.minute,
            second=0,
            microsecond=0,
        )

        for _ in range(370):
            if candidate <= now:
                candidate += timedelta(days=1)
                candidate = candidate.replace(
                    hour=int(hour) if hour.isdigit() else candidate.hour,
                    minute=int(minute) if minute.isdigit() else candidate.minute,
                    second=0,
                    microsecond=0,
                )
                continue
            if day_of_month.isdigit() and candidate.day != int(day_of_month):
                candidate += timedelta(days=1)
                continue
            if month.isdigit() and candidate.month != int(month):
                candidate += timedelta(days=1)
                continue
            if day_of_week in {"*", ""}:
                return candidate.astimezone(ZoneInfo("UTC")).replace(tzinfo=None)
            weekday = int(day_of_week)
            if candidate.weekday() == ((weekday - 1) % 7):
                return candidate.astimezone(ZoneInfo("UTC")).replace(tzinfo=None)
            candidate += timedelta(days=1)

        base = task.next_run_at or datetime.utcnow()
        return base + timedelta(days=1)


scheduled_task_runtime_service = ScheduledTaskRuntimeService()
