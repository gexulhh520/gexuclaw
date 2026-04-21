import asyncio
import json

from agents.executor import run_tool
from models.database import SessionLocal
from services.notification_service import notification_service
from services.scheduled_task_runtime_service import scheduled_task_runtime_service
from services.scheduled_task_service import scheduled_task_service
from services.user_service import user_service
from workers.celery_app import celery_app


def _format_notification_content(task, run) -> str:
    return (
        f"定时任务：{task.title}\n"
        f"状态：{run.status}\n"
        f"结果：{run.result_summary or run.error_message or '无'}"
    )


async def _execute_plan_steps(task):
    plan = task.plan_json or {}
    execution_steps = plan.get("execution_steps") or []
    tool_calls = []
    for step in execution_steps:
        tool_name = step.get("tool_name")
        if not tool_name:
            continue
        tool_calls.append(
            {
                "id": f"scheduled_{task.id}_{step.get('step_index', len(tool_calls) + 1)}",
                "type": "function",
                "function": {
                    "name": tool_name,
                    "arguments": json.dumps(step.get("params") or {}, ensure_ascii=False),
                },
            }
        )

    browser_session_id = f"scheduled_bs_{task.id}"
    return await run_tool(
        tool_calls,
        browser_session_id=browser_session_id,
        user_id=task.user_id,
        knowledge_base_ids=(task.raw_trace_json or {}).get("knowledge_base_ids") or [],
    )


@celery_app.task(bind=True)
def execute_scheduled_task(self, task_id: int):
    db = SessionLocal()
    try:
        task = scheduled_task_service.get_task_by_id(db, task_id)
        if not task:
            return {"success": False, "message": "定时任务不存在"}

        preflight = scheduled_task_runtime_service.run_preflight_checks(db, task)
        run = scheduled_task_service.create_run(
            db,
            task,
            status_value="running",
            execution_plan_snapshot=task.plan_json or {},
            run_type="scheduled",
            trigger_source="dispatcher",
            preflight_result_json=preflight,
        )
        if not preflight["is_feasible"]:
            run = scheduled_task_service.update_run_status(
                db,
                run,
                status_value="failed",
                error_message="预检查未通过",
                result_summary="; ".join(preflight.get("blockers") or ["任务不可执行"]),
                preflight_result_json=preflight,
                steps_json=[{"type": "preflight", "result": preflight}],
            )
        else:
            if task.planner_version == "v2":
                from services.task_execution_service_v2 import task_execution_service_v2
                v2_result = asyncio.run(task_execution_service_v2.execute_task(db, task))
                success = v2_result.get("success", False)
                tool_messages = v2_result.get("tool_messages", [])
                task.raw_trace_json = {
                    **(task.raw_trace_json or {}),
                    "execution_runtime": {
                        "provider": v2_result.get("provider"),
                        "model": v2_result.get("model"),
                    },
                }
                run = scheduled_task_service.update_run_status(
                    db,
                    run,
                    status_value="success" if success else "failed",
                    result_summary=v2_result.get("final_response", "任务执行完成" if success else "任务执行失败"),
                    error_message=None if success else "执行未达预期",
                    preflight_result_json=preflight,
                    steps_json=tool_messages,
                    cost_metrics_json={
                        "steps_count": v2_result.get("steps_count", 0),
                        "provider": v2_result.get("provider"),
                        "model": v2_result.get("model"),
                    },
                )
            else:
                tool_messages = asyncio.run(_execute_plan_steps(task))
                success = all("执行成功" in (item.get("content") or "") for item in tool_messages) if tool_messages else False
                run = scheduled_task_service.update_run_status(
                    db,
                    run,
                    status_value="success" if success else "failed",
                    result_summary="任务执行完成" if success else "任务执行存在失败步骤",
                    error_message=None if success else "部分步骤执行失败",
                    preflight_result_json=preflight,
                    steps_json=tool_messages,
                    cost_metrics_json={"steps_count": len(tool_messages)},
                )
        scheduled_task_runtime_service.update_task_after_run(db, task, run)

        user = user_service.get_user_by_id(db, task.user_id)
        targets = notification_service.build_targets(user, task)
        notification_status = {}

        scheduled_task_service.create_notification(
            db,
            task=task,
            run=run,
            channel="in_app",
            payload={
                "title": f"定时任务执行完成：{task.title}",
                "summary": run.result_summary,
                "status": run.status,
            },
        )
        notification_status["in_app"] = {"success": True}

        if targets["email"]["enabled"]:
            email_result = notification_service.send_email(
                targets["email"]["target"],
                f"定时任务执行结果：{task.title}",
                _format_notification_content(task, run),
            )
            scheduled_task_service.create_notification(
                db,
                task=task,
                run=run,
                channel="email",
                target=targets["email"]["target"],
                provider="smtp",
                payload={"summary": run.result_summary, "status": run.status},
                status_value="sent" if email_result["success"] else "failed",
                error_message=email_result.get("error"),
            )
            notification_status["email"] = email_result

        if targets["wechat"]["enabled"]:
            wechat_result = asyncio.run(
                notification_service.send_wechat_personal(
                    targets["wechat"]["config"],
                    _format_notification_content(task, run),
                )
            )
            scheduled_task_service.create_notification(
                db,
                task=task,
                run=run,
                channel="wechat",
                target=(targets["wechat"]["config"] or {}).get("conversation_id"),
                provider="clawbot",
                provider_message_id=wechat_result.get("provider_message_id"),
                payload={"summary": run.result_summary, "status": run.status},
                status_value="sent" if wechat_result["success"] else "failed",
                error_message=wechat_result.get("error"),
            )
            notification_status["wechat"] = wechat_result

        run = scheduled_task_service.update_run_status(
            db,
            run,
            status_value=run.status,
            notification_status_json=notification_status,
        )

        return {
            "success": run.status == "success",
            "task_id": task.id,
            "run_id": run.id,
            "status": run.status,
            "message": run.result_summary,
        }
    finally:
        db.close()
