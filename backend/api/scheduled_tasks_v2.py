import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from core.auth import get_current_active_user
from models.database import get_db
from models.user import User
from schemas.scheduled_task_v2 import PlannerDraftQueueRequest, PlannerDraftQueueResponse
from services.chat_session_service import chat_session_service
from websocket.manager import connection_manager
from workers.planner_jobs import generate_planner_draft_task

router = APIRouter(tags=["瀹氭椂浠诲姟V2"])


@router.post("/drafts", response_model=PlannerDraftQueueResponse)
def queue_planner_draft(
    payload: PlannerDraftQueueRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    session = chat_session_service.get_user_session(db, current_user.id, payload.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="浼氳瘽涓嶅瓨鍦?")

    request_id = payload.request_id or str(uuid.uuid4())
    job = generate_planner_draft_task.delay(
        session_id=payload.session_id,
        user_id=current_user.id,
        intent_text=payload.intent_text,
        schedule_text=payload.schedule_text,
        timezone=payload.timezone,
        trigger_message_id=payload.trigger_message_id,
        goal=payload.goal,
        request_id=request_id,
    )

    connection_manager.send_to_session(
        payload.session_id,
        {
            "type": "planner_draft_queued",
            "request_id": request_id,
            "intent_text": payload.intent_text,
            "schedule_text": payload.schedule_text,
            "queued_at": datetime.utcnow().isoformat(),
        },
    )

    return PlannerDraftQueueResponse(
        success=True,
        status="queued",
        request_id=request_id,
        job_id=job.id,
        session_id=payload.session_id,
    )


@router.get("/drafts/{draft_id}")
def get_planner_draft(
    draft_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    from services.scheduled_task_service import scheduled_task_service

    task = scheduled_task_service.get_task_by_id(db, draft_id)
    if not task or task.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="鑽夋涓嶅瓨鍦?")
    return task


@router.post("/drafts/{draft_id}/preview")
def preview_planner_draft(
    draft_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    from services.scheduled_task_service import scheduled_task_service

    task = scheduled_task_service.get_task_by_id(db, draft_id)
    if not task or task.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="鑽夋涓嶅瓨鍦?")

    # 异步触发预执行。这里要保证“已触发/触发失败”都有明确反馈，
    # 否则前端会表现成“点了没反应”。
    from workers.scheduled_task_executor import execute_scheduled_task

    task.preview_status = "running"
    db.commit()

    try:
        job = execute_scheduled_task.delay(task.id)
    except Exception as exc:
        task.preview_status = "pending"
        db.commit()
        raise HTTPException(status_code=503, detail=f"预执行任务投递失败: {exc}")

    if task.source_session_id:
        connection_manager.send_to_session(
            task.source_session_id,
            {
                "type": "scheduled_task_preview_queued",
                "draft_id": task.id,
                "task_id": task.id,
                "draft_title": task.title,
                "schedule_text": task.schedule_text,
                "analysis_status": task.analysis_status,
                "job_id": job.id,
                "queued_at": datetime.utcnow().isoformat(),
            },
        )

    return {"success": True, "message": "预执行已触发", "job_id": job.id}


@router.post("/drafts/{draft_id}/confirm")
def confirm_planner_draft(
    draft_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    from services.scheduled_task_service import scheduled_task_service

    task = scheduled_task_service.get_task_by_id(db, draft_id)
    if not task or task.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="鑽夋涓嶅瓨鍦?")

    task.status = "active"
    db.commit()
    return {"success": True, "message": "鑽夋宸茬‘璁ゅ苟婵€娲?"}


@router.post("/drafts/{draft_id}/replan")
def replan_planner_draft(
    draft_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    from services.scheduled_task_service import scheduled_task_service

    task = scheduled_task_service.get_task_by_id(db, draft_id)
    if not task or task.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="鑽夋涓嶅瓨鍦?")

    request_id = str(uuid.uuid4())
    job = generate_planner_draft_task.delay(
        session_id=task.source_session_id,
        user_id=current_user.id,
        intent_text=task.intent_text,
        schedule_text=task.schedule_text,
        timezone=task.timezone,
        trigger_message_id=task.source_message_id,
        goal=task.title,
        request_id=request_id,
    )
    return {"success": True, "status": "queued", "job_id": job.id, "request_id": request_id}
