from __future__ import annotations

from celery.utils.log import get_task_logger
from sqlalchemy import text

from core.config import get_settings
from models.database import SessionLocal
from workers.celery_app import celery_app

from services.checkpoint_cleanup_service import (
    CheckpointCleanupConfig,
    cleanup_langgraph_checkpoints,
)

logger = get_task_logger(__name__)


@celery_app.task(bind=True, name="workers.maintenance_tasks.cleanup_maintenance")
def cleanup_maintenance(self):
    """
    Periodic maintenance cleanup:
    - Prune agent_execution_steps by age.
    - Prune LangGraph checkpoints by (keep_per_thread, retention_days) when possible.
    """
    settings = get_settings()

    result: dict = {
        "execution_steps_deleted": 0,
        "checkpoint_cleanup": None,
    }

    # 1) Clean execution steps (main DB)
    # Disabled by default since it can be useful for debugging / audit.
    if bool(getattr(settings, "EXECUTION_STEPS_CLEANUP_ENABLED", False)):
        steps_days = int(getattr(settings, "EXECUTION_STEPS_RETENTION_DAYS", 30))
        db = SessionLocal()
        try:
            if settings.DATABASE_URL.startswith("sqlite"):
                # SQLite datetime arithmetic
                sql = text(
                    "delete from agent_execution_steps "
                    "where created_at < datetime('now', '-' || :days || ' days')"
                )
            else:
                # Postgres interval arithmetic
                sql = text(
                    "delete from agent_execution_steps "
                    "where created_at < now() - (:days || ' days')::interval"
                )

            res = db.execute(sql, {"days": steps_days})
            db.commit()
            result["execution_steps_deleted"] = int(getattr(res, "rowcount", 0) or 0)
            logger.info(
                "maintenance: deleted %s execution steps older than %s days",
                result["execution_steps_deleted"],
                steps_days,
            )
        finally:
            db.close()

    # 2) Clean checkpoints (checkpoint DB)
    checkpoint_url = getattr(settings, "CHECKPOINT_DATABASE_URL", None)
    if checkpoint_url:
        keep_per_thread = int(getattr(settings, "CHECKPOINT_KEEP_PER_THREAD", 50))
        retention_days = int(getattr(settings, "CHECKPOINT_RETENTION_DAYS", 30))
        cfg = CheckpointCleanupConfig(
            database_url=checkpoint_url,
            keep_per_thread=keep_per_thread,
            retention_days=retention_days,
        )
        try:
            result["checkpoint_cleanup"] = cleanup_langgraph_checkpoints(cfg)
            logger.info(
                "maintenance: checkpoint cleanup done (base_table=%s, deleted_tables=%s)",
                result["checkpoint_cleanup"].get("base_table"),
                len(result["checkpoint_cleanup"].get("deleted_by_table", {}) or {}),
            )
        except Exception as e:
            logger.warning("maintenance: checkpoint cleanup failed: %s", e)
            result["checkpoint_cleanup"] = {"error": str(e)}

    return result
