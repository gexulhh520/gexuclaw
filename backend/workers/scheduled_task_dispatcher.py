from datetime import datetime

from models.database import SessionLocal
from models.scheduled_task import ScheduledTaskRun
from services.scheduled_task_runtime_service import scheduled_task_runtime_service
from workers.celery_app import celery_app
from workers.scheduled_task_executor import execute_scheduled_task


@celery_app.task(bind=True)
def dispatch_due_scheduled_tasks(self):
    db = SessionLocal()
    try:
        tasks = scheduled_task_runtime_service.get_due_tasks(db, datetime.utcnow())
        dispatched_ids = []
        for task in tasks:
            existing_running = db.query(ScheduledTaskRun).filter(
                ScheduledTaskRun.scheduled_task_id == task.id,
                ScheduledTaskRun.status.in_(["queued", "running"]),
            ).first()
            if existing_running:
                continue
            execute_scheduled_task.delay(task.id)
            dispatched_ids.append(task.id)
        return {
            "success": True,
            "count": len(dispatched_ids),
            "task_ids": dispatched_ids,
        }
    finally:
        db.close()
