import asyncio
import inspect
import selectors
import sys
from typing import Any, Dict, List, Optional

from agents.executor_v2 import AgentExecutorV2
from config.agent_config import get_system_prompt
from models.database import SessionLocal
from services.agent_execution_service import save_execution_step
from services.chat_session_service import chat_session_service
from services.session_manager import SessionManager
from tools.tool_runtime import get_tool_runtime
from websocket.manager import connection_manager
from workers.celery_app import celery_app

_tool_runtime = get_tool_runtime()


def _run_async(coro):
    if sys.platform == "win32":
        try:
            asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
        except Exception:
            pass
    try:
        run_params = inspect.signature(asyncio.run).parameters
    except Exception:
        run_params = {}
    if sys.platform == "win32" and "loop_factory" in run_params:
        return asyncio.run(coro, loop_factory=lambda: asyncio.SelectorEventLoop(selectors.SelectSelector()))
    return asyncio.run(coro)


@celery_app.task(bind=True)
def execute_agent_task_v2(
    self,
    session_id: str,
    user_messages: List[dict],
    provider: str = "openai",
    model: str = None,
    user_id: int = None,
    knowledge_base_ids: Optional[List[int]] = None,
    turn_id: Optional[int] = None,
    user_message_id: Optional[int] = None,
):
    return _run_async(_execute_v2(session_id, user_messages, provider, model, user_id, knowledge_base_ids, turn_id, user_message_id))


async def _send_to_session(session_id: str, message: dict):
    from websocket.redis_pubsub import ws_pubsub
    message['_session_id'] = session_id
    ws_pubsub.publish(session_id, message)


async def _execute_v2(
    session_id: str,
    user_messages: List[dict],
    provider: str = "openai",
    model: str = None,
    user_id: int = None,
    knowledge_base_ids: Optional[List[int]] = None,
    turn_id: Optional[int] = None,
    user_message_id: Optional[int] = None,
):
    db = SessionLocal()
    try:
        session = chat_session_service.get_user_session(db, user_id, session_id)
        if not session:
            raise ValueError("Session not found")

        executor = AgentExecutorV2(
            provider=provider,
            model=model,
            browser_session_id=f"bs_{session_id[:12]}",
            system_prompt=get_system_prompt("default"),
            user_id=user_id,
            knowledge_base_ids=knowledge_base_ids or [],
            session_id=session_id,
        )

        collected_steps: List[Dict[str, Any]] = []
        result = ""
        step_count = 0

        async for event in executor.execute_stream(user_messages, thread_id=session_id):
            step_count += 1
            if event.get("type") == "context_trimmed":
                continue
            await _send_to_session(session_id, event)
            collected_steps.append(
                {
                    "step_type": event.get("type"),
                    "content": event.get("content"),
                    "tool_name": event.get("tool_name"),
                    "tool_status": event.get("tool_status"),
                    "metadata": {
                        "tool_call_id": event.get("tool_call_id"),
                        "metadata": event.get("metadata"),
                        "timestamp": event.get("timestamp"),
                        "draft_id": event.get("draft_id"),
                        "draft_title": event.get("draft_title"),
                        "analysis_status": event.get("analysis_status"),
                        "intent_text": event.get("intent_text"),
                        "request_id": event.get("request_id"),
                        "job_id": event.get("job_id"),
                    },
                }
            )
            if event.get("type") == "thinking_end" and event.get("content"):
                result = event.get("content") or result

        if not result:
            result = "我已在后台开始生成定时任务草案，生成完成后会通知你。"

        assistant_message = chat_session_service.add_message(
            db, session_id=session.id, role="assistant", content=result, turn_id=turn_id
        )

        for idx, step in enumerate(collected_steps):
            await save_execution_step(
                db=db,
                message_id=assistant_message.id,
                turn_id=turn_id,
                step_type=step.get("step_type") or "thinking",
                content=step.get("content"),
                tool_name=step.get("tool_name"),
                tool_status=step.get("tool_status"),
                metadata=step.get("metadata"),
                sort_order=idx,
            )

        if turn_id:
            chat_session_service.complete_turn(
                db,
                turn_id=turn_id,
                assistant_message_id=assistant_message.id,
                source_user_message_id=user_message_id,
            )
            from workers.turn_memory_tasks import build_turn_memory_task

            build_turn_memory_task.delay(turn_id)

        SessionManager.add_message(session_id, "assistant", result)

        await _send_to_session(session_id, {"type": "done", "content": result, "total_steps": step_count})
        return {"success": True, "result": result, "provider": provider, "model": model}
    except Exception as e:
        if turn_id:
            try:
                chat_session_service.fail_turn(db, turn_id=turn_id)
            except Exception:
                pass
        await _send_to_session(session_id, {"type": "error", "content": str(e)})
        return {"success": False, "error": str(e)}
    finally:
        db.close()
