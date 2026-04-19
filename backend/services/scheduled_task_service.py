from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from models.scheduled_task import ScheduledTask, ScheduledTaskRun, ScheduledTaskNotification
from schemas.scheduled_task import ScheduledTaskCreate, ScheduledTaskUpdate


class ScheduledTaskService:
    @staticmethod
    def get_task_by_id(db: Session, task_id: int) -> Optional[ScheduledTask]:
        return db.query(ScheduledTask).filter(ScheduledTask.id == task_id).first()

    @staticmethod
    def get_user_task(db: Session, user_id: int, task_id: int) -> Optional[ScheduledTask]:
        return db.query(ScheduledTask).filter(
            ScheduledTask.id == task_id,
            ScheduledTask.user_id == user_id,
        ).first()

    @staticmethod
    def get_user_task_or_404(db: Session, user_id: int, task_id: int) -> ScheduledTask:
        task = ScheduledTaskService.get_user_task(db, user_id, task_id)
        if not task:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="定时任务不存在")
        return task

    @staticmethod
    def list_user_tasks(db: Session, user_id: int, status_value: Optional[str] = None) -> List[ScheduledTask]:
        query = db.query(ScheduledTask).filter(ScheduledTask.user_id == user_id)
        if status_value:
            query = query.filter(ScheduledTask.status == status_value)
        return query.order_by(ScheduledTask.created_at.desc(), ScheduledTask.id.desc()).all()

    @staticmethod
    def create_task_from_draft(
        db: Session,
        user_id: int,
        payload: ScheduledTaskCreate,
    ) -> ScheduledTask:
        draft = ScheduledTaskService.get_user_task_or_404(db, user_id, payload.draft_id)
        if draft.status != "draft":
            raise HTTPException(status_code=400, detail="仅草案任务可确认创建")
        if draft.preview_status == "blocked":
            raise HTTPException(status_code=400, detail="请先修复预检查阻塞项后再创建任务")

        draft.title = payload.title
        draft.description = payload.description
        draft.schedule_text = payload.schedule_text
        draft.cron_expression = payload.cron_expression
        draft.timezone = payload.timezone
        draft.delivery_channels = payload.delivery_channels
        draft.notification_targets_json = payload.notification_targets_json
        draft.intent_text = payload.intent_text
        draft.source_session_id = payload.source_session_id
        draft.source_message_id = payload.source_message_id
        draft.status = "active"
        draft.analysis_status = "confirmed"
        draft.preview_status = "confirmed"
        draft.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(draft)
        return draft

    @staticmethod
    def mark_analysis_running(db: Session, task: ScheduledTask) -> ScheduledTask:
        task.status = "analysis_running"
        task.analysis_status = "analysis_running"
        task.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(task)
        return task

    @staticmethod
    def mark_draft_ready(
        db: Session,
        task: ScheduledTask,
        summary_markdown: str,
        notification_targets_json: Optional[dict] = None,
    ) -> ScheduledTask:
        task.status = "draft"
        task.analysis_status = "draft"
        task.preview_status = "pending"
        task.draft_summary_markdown = summary_markdown
        task.notification_targets_json = notification_targets_json or task.notification_targets_json or {}
        task.draft_expires_at = datetime.utcnow() + timedelta(days=7)
        task.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(task)
        return task

    @staticmethod
    def update_task(db: Session, task: ScheduledTask, payload: ScheduledTaskUpdate) -> ScheduledTask:
        data = payload.model_dump(exclude_unset=True)
        for key, value in data.items():
            setattr(task, key, value)
        task.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(task)
        return task

    @staticmethod
    def pause_task(db: Session, task: ScheduledTask) -> ScheduledTask:
        task.status = "paused"
        task.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(task)
        return task

    @staticmethod
    def resume_task(db: Session, task: ScheduledTask) -> ScheduledTask:
        task.status = "active"
        task.auto_pause_reason = None
        task.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(task)
        return task

    @staticmethod
    def list_task_runs(db: Session, task_id: int) -> List[ScheduledTaskRun]:
        return db.query(ScheduledTaskRun).filter(
            ScheduledTaskRun.scheduled_task_id == task_id
        ).order_by(ScheduledTaskRun.created_at.desc(), ScheduledTaskRun.id.desc()).all()

    @staticmethod
    def list_task_notifications(db: Session, task_id: int) -> List[ScheduledTaskNotification]:
        return db.query(ScheduledTaskNotification).filter(
            ScheduledTaskNotification.scheduled_task_id == task_id
        ).order_by(ScheduledTaskNotification.created_at.desc(), ScheduledTaskNotification.id.desc()).all()

    @staticmethod
    def get_run_or_404(db: Session, run_id: int) -> ScheduledTaskRun:
        run = db.query(ScheduledTaskRun).filter(ScheduledTaskRun.id == run_id).first()
        if not run:
            raise HTTPException(status_code=404, detail="任务执行记录不存在")
        return run

    @staticmethod
    def create_run(
        db: Session,
        task: ScheduledTask,
        status_value: str = "queued",
        execution_plan_snapshot: Optional[dict] = None,
        run_type: str = "scheduled",
        trigger_source: Optional[str] = None,
        preflight_result_json: Optional[dict] = None,
    ) -> ScheduledTaskRun:
        run = ScheduledTaskRun(
            scheduled_task_id=task.id,
            status=status_value,
            run_type=run_type,
            trigger_source=trigger_source,
            triggered_at=datetime.utcnow(),
            execution_plan_snapshot=execution_plan_snapshot or {},
            preflight_result_json=preflight_result_json or {},
        )
        db.add(run)
        db.commit()
        db.refresh(run)
        return run

    @staticmethod
    def update_run_status(
        db: Session,
        run: ScheduledTaskRun,
        status_value: str,
        result_summary: Optional[str] = None,
        error_message: Optional[str] = None,
        steps_json: Optional[list] = None,
        preflight_result_json: Optional[dict] = None,
        cost_metrics_json: Optional[dict] = None,
        notification_status_json: Optional[dict] = None,
    ) -> ScheduledTaskRun:
        run.status = status_value
        if status_value == "running":
            run.started_at = datetime.utcnow()
        if status_value in {"success", "failed", "cancelled", "skipped"}:
            if not run.started_at:
                run.started_at = datetime.utcnow()
            run.finished_at = datetime.utcnow()
        if result_summary is not None:
            run.result_summary = result_summary
        if error_message is not None:
            run.error_message = error_message
        if steps_json is not None:
            run.steps_json = steps_json
        if preflight_result_json is not None:
            run.preflight_result_json = preflight_result_json
        if cost_metrics_json is not None:
            run.cost_metrics_json = cost_metrics_json
        if notification_status_json is not None:
            run.notification_status_json = notification_status_json
        db.commit()
        db.refresh(run)
        return run

    @staticmethod
    def create_notification(
        db: Session,
        task: ScheduledTask,
        run: Optional[ScheduledTaskRun],
        channel: str,
        payload: dict,
        target: Optional[str] = None,
        status_value: str = "sent",
        provider: Optional[str] = None,
        provider_message_id: Optional[str] = None,
        error_message: Optional[str] = None,
        retry_count: int = 0,
    ) -> ScheduledTaskNotification:
        notification = ScheduledTaskNotification(
            scheduled_task_id=task.id,
            scheduled_task_run_id=run.id if run else None,
            channel=channel,
            target=target,
            provider=provider,
            provider_message_id=provider_message_id,
            payload=payload,
            status=status_value,
            error_message=error_message,
            retry_count=retry_count,
        )
        db.add(notification)
        db.commit()
        db.refresh(notification)
        return notification


scheduled_task_service = ScheduledTaskService()
