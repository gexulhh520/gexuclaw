import asyncio
import selectors
import sys
from datetime import datetime
from typing import Optional

from models.database import SessionLocal
from services.planner_service_v2 import planner_service_v2
from services.scheduled_task_service import scheduled_task_service
from websocket.manager import connection_manager
from workers.celery_app import celery_app


def _run_async(coro):
    if sys.platform == "win32":
        try:
            asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
        except Exception:
            pass
    run_params = asyncio.run.__code__.co_varnames
    if sys.platform == "win32" and "loop_factory" in run_params:
        return asyncio.run(
            coro,
            loop_factory=lambda: asyncio.SelectorEventLoop(selectors.SelectSelector()),
        )
    return asyncio.run(coro)


def _emit(session_id: str, payload: dict):
    from websocket.redis_pubsub import ws_pubsub
    payload['_session_id'] = session_id
    ws_pubsub.publish(session_id, payload)


@celery_app.task(bind=True)
def generate_planner_draft_task(
    self,
    session_id: str,
    user_id: int,
    intent_text: str,
    schedule_text: str,
    timezone: str = "Asia/Shanghai",
    trigger_message_id: Optional[int] = None,
    goal: Optional[str] = None,
    provider: Optional[str] = None,
    model: Optional[str] = None,
    request_id: Optional[str] = None,
):
    return _run_async(
        _generate(
            session_id=session_id,
            user_id=user_id,
            intent_text=intent_text,
            schedule_text=schedule_text,
            timezone=timezone,
            trigger_message_id=trigger_message_id,
            goal=goal,
            provider=provider,
            model=model,
            request_id=request_id,
        )
    )


async def _generate(
    session_id: str,
    user_id: int,
    intent_text: str,
    schedule_text: str,
    timezone: str = "Asia/Shanghai",
    trigger_message_id: Optional[int] = None,
    goal: Optional[str] = None,
    provider: Optional[str] = None,
    model: Optional[str] = None,
    request_id: Optional[str] = None,
):
    db = SessionLocal()
    try:
        task, _ = await planner_service_v2.build_draft_v2(
            db=db,
            user_id=user_id,
            session_id=session_id,
            intent_text=intent_text,
            trigger_message_id=trigger_message_id,
            schedule_text=schedule_text,
            timezone=timezone,
            provider=provider,
            model=model,
            goal=goal,
        )

        payload = {
            "type": "planner_draft_ready",
            "request_id": request_id,
            "draft_id": task.id,
            "title": task.title,
            "analysis_status": task.analysis_status,
            "summary_markdown": task.draft_summary_markdown or "",
            "goal": goal,
            "session_id": session_id,
            "timestamp": datetime.utcnow().isoformat(),
        }
        _emit(session_id, payload)
        scheduled_task_service.create_notification(
            db=db,
            task=task,
            run=None,
            channel="in_app",
            payload=payload,
            status_value="sent",
        )
        return {"success": True, "draft_id": task.id}
    except Exception as e:
        _emit(
            session_id,
            {
                "type": "planner_draft_failed",
                "request_id": request_id,
                "intent_text": intent_text,
                "schedule_text": schedule_text,
                "error_message": str(e),
                "timestamp": datetime.utcnow().isoformat(),
            },
        )
        raise
    finally:
        db.close()
