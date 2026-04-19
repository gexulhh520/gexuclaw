from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from core.auth import get_current_active_user
from models.database import get_db
from models.user import User
from schemas.scheduled_task import (
    ScheduledTaskCreate,
    ScheduledTaskDraftResponse,
    ScheduledTaskListResponse,
    ScheduledTaskNotificationResponse,
    ScheduledTaskPreviewResponse,
    ScheduledTaskResponse,
    ScheduledTaskRunResponse,
    ScheduledTaskUpdate,
)
from schemas.scheduled_task_planner import (
    ScheduledTaskDraftContent,
    ScheduledTaskDraftRequest,
    ScheduledTaskExecutionStep,
    ScheduledTaskFeasibility,
)
from services.scheduled_task_planner_service import scheduled_task_planner_service
from services.scheduled_task_runtime_service import scheduled_task_runtime_service
from services.scheduled_task_service import scheduled_task_service
from workers.scheduled_task_executor import execute_scheduled_task

router = APIRouter(tags=["定时任务"])


def _build_draft_response(task) -> ScheduledTaskDraftResponse:
    plan = task.plan_json or {}
    execution_steps = []
    for index, step in enumerate(plan.get("execution_steps") or [], start=1):
        tool_name = step.get("tool_name")
        params = step.get("params") or {}
        execution_steps.append(
            ScheduledTaskExecutionStep(
                step_index=step.get("step_index") or index,
                title=step.get("title") or (f"执行 {tool_name}" if tool_name else f"步骤 {index}"),
                tool_name=tool_name,
                action=step.get("action") or (
                    f"调用工具 {tool_name}，参数：{params}" if tool_name else f"执行步骤 {index}"
                ),
                params=params,
                success_condition=step.get("success_condition"),
                failure_handler=step.get("failure_handler"),
            )
        )
    content = ScheduledTaskDraftContent(
        title=task.title,
        description=task.description or "",
        schedule_text=task.schedule_text,
        cron_expression=task.cron_expression,
        timezone=task.timezone,
        delivery_channels=task.delivery_channels or ["in_app"],
        execution_steps=execution_steps,
        success_criteria=plan.get("success_criteria") or [],
        failure_handlers=(task.retry_policy_json or {}).get("failure_handlers") or [],
        feasibility=ScheduledTaskFeasibility(**(task.feasibility_json or {})),
        retry_policy=task.retry_policy_json or {},
        budget_policy=task.budget_policy_json or {},
        tool_whitelist=task.tool_whitelist_json or [],
        summary_markdown=task.draft_summary_markdown or "",
        raw_trace_summary=task.raw_trace_json or {},
    )
    return ScheduledTaskDraftResponse(
        id=task.id,
        title=task.title,
        description=task.description,
        schedule_text=task.schedule_text,
        cron_expression=task.cron_expression,
        timezone=task.timezone,
        status=task.status,
        analysis_status=task.analysis_status,
        summary_markdown=task.draft_summary_markdown or plan.get("summary_markdown") or "",
        content=content,
        created_at=task.created_at,
    )


@router.post("/drafts", response_model=ScheduledTaskDraftResponse)
async def create_scheduled_task_draft(
    payload: ScheduledTaskDraftRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    task, _ = await scheduled_task_planner_service.build_draft(
        db,
        user_id=current_user.id,
        session_id=payload.session_id,
        intent_text=payload.intent_text,
        trigger_message_id=payload.trigger_message_id,
        schedule_text=payload.schedule_text,
        timezone=payload.timezone,
    )
    return _build_draft_response(task)


@router.get("/drafts/{draft_id}", response_model=ScheduledTaskDraftResponse)
def get_scheduled_task_draft(
    draft_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    task = scheduled_task_service.get_user_task_or_404(db, current_user.id, draft_id)
    return _build_draft_response(task)


@router.post("/drafts/{draft_id}/preview", response_model=ScheduledTaskPreviewResponse)
def preview_scheduled_task_draft(
    draft_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    task = scheduled_task_service.get_user_task_or_404(db, current_user.id, draft_id)
    run = scheduled_task_runtime_service.preview_task(db, task)
    return {
        "success": run.status == "success",
        "run": run,
        "message": run.result_summary or run.error_message or "",
        "checks": (run.preflight_result_json or {}).get("checks") or [],
        "warnings": (run.preflight_result_json or {}).get("warnings") or [],
        "blockers": (run.preflight_result_json or {}).get("blockers") or [],
        "suggested_fixes": (run.preflight_result_json or {}).get("suggested_fixes") or [],
    }


@router.post("", response_model=ScheduledTaskResponse)
def create_scheduled_task(
    payload: ScheduledTaskCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    task = scheduled_task_service.create_task_from_draft(db, current_user.id, payload)
    return task


@router.get("", response_model=ScheduledTaskListResponse)
def list_scheduled_tasks(
    status_value: Optional[str] = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    tasks = scheduled_task_service.list_user_tasks(db, current_user.id, status_value=status_value)
    return {
        "tasks": tasks,
        "total": len(tasks),
    }


@router.get("/{task_id}", response_model=ScheduledTaskResponse)
def get_scheduled_task(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    return scheduled_task_service.get_user_task_or_404(db, current_user.id, task_id)


@router.patch("/{task_id}", response_model=ScheduledTaskResponse)
def update_scheduled_task(
    task_id: int,
    payload: ScheduledTaskUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    task = scheduled_task_service.get_user_task_or_404(db, current_user.id, task_id)
    return scheduled_task_service.update_task(db, task, payload)


@router.post("/{task_id}/pause", response_model=ScheduledTaskResponse)
def pause_scheduled_task(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    task = scheduled_task_service.get_user_task_or_404(db, current_user.id, task_id)
    return scheduled_task_service.pause_task(db, task)


@router.post("/{task_id}/resume", response_model=ScheduledTaskResponse)
def resume_scheduled_task(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    task = scheduled_task_service.get_user_task_or_404(db, current_user.id, task_id)
    return scheduled_task_service.resume_task(db, task)


@router.post("/{task_id}/run-now")
def run_scheduled_task_now(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    task = scheduled_task_service.get_user_task_or_404(db, current_user.id, task_id)
    job = execute_scheduled_task.delay(task.id)
    return {"success": True, "task_id": task.id, "job_id": job.id}


@router.get("/{task_id}/runs", response_model=list[ScheduledTaskRunResponse])
def list_scheduled_task_runs(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    task = scheduled_task_service.get_user_task_or_404(db, current_user.id, task_id)
    return scheduled_task_service.list_task_runs(db, task.id)


@router.get("/{task_id}/notifications", response_model=list[ScheduledTaskNotificationResponse])
def list_scheduled_task_notifications(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    task = scheduled_task_service.get_user_task_or_404(db, current_user.id, task_id)
    return scheduled_task_service.list_task_notifications(db, task.id)


@router.get("/runs/{run_id}", response_model=ScheduledTaskRunResponse)
def get_scheduled_task_run(
    run_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    run = scheduled_task_service.get_run_or_404(db, run_id)
    if run.task.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权查看该执行记录")
    return run
