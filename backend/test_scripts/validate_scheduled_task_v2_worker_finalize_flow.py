"""
验证 V2 worker 收尾逻辑是否补齐：

覆盖链路：
1. 创建临时 user / chat_session / chat_turn / user message
2. mock `AgentExecutorV2.execute_stream()` 返回固定事件流
3. 执行 `workers.tasks_v2._execute_v2()`
4. 校验 assistant message、execution steps、turn 完成状态、source_user_message_id
5. 校验 `build_turn_memory_task.delay(turn_id)` 被触发

执行方式：
    python backend/test_scripts/validate_scheduled_task_v2_worker_finalize_flow.py
"""

from __future__ import annotations

import asyncio
from pathlib import Path
import sys
import uuid

from sqlalchemy import inspect

CURRENT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = CURRENT_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from test_scripts.create_chat_turn_schema import main as ensure_chat_turn_schema  # noqa: E402
from test_scripts.create_turn_memory_schema import main as ensure_turn_memory_schema  # noqa: E402
from models.agent_execution_step import AgentExecutionStep  # noqa: E402
from models.chat_session import ChatSession, ChatMessage, MessageContentItem  # noqa: E402
from models.chat_turn import ChatTurn  # noqa: E402
from models.database import SessionLocal  # noqa: E402
from models.turn_memory import TurnMemory  # noqa: E402
from models.user import User  # noqa: E402
from services.chat_session_service import chat_session_service  # noqa: E402
import workers.tasks_v2 as worker_module  # noqa: E402
from agents.executor_v2 import AgentExecutorV2  # noqa: E402
import workers.turn_memory_tasks as turn_memory_tasks_module  # noqa: E402


def assert_true(condition, message: str):
    if not condition:
        raise AssertionError(message)


async def _fake_execute_stream(self, user_messages, thread_id=None):
    yield {
        "type": "thinking_ing",
        "content": "开始分析定时任务意图",
        "timestamp": "2026-04-20T01:40:00",
    }
    yield {
        "type": "planner_draft_queued",
        "content": "已进入后台队列",
        "intent_text": "把刚才成功的招聘网站投递流程转成定时任务",
        "request_id": "req_v2_worker_test",
        "job_id": "job_v2_worker_test",
        "timestamp": "2026-04-20T01:40:01",
    }
    yield {
        "type": "context_trimmed",
        "timestamp": "2026-04-20T01:40:02",
    }
    yield {
        "type": "scheduled_task_suggestion",
        "content": "已根据当前对话生成定时任务草案：招聘网站投递自动化任务",
        "intent_text": "把刚才成功的招聘网站投递流程转成定时任务",
        "draft_id": 321,
        "draft_title": "招聘网站投递自动化任务",
        "analysis_status": "draft",
        "request_id": "req_v2_worker_test",
        "job_id": "job_v2_worker_test",
        "timestamp": "2026-04-20T01:40:03",
    }
    yield {
        "type": "thinking_end",
        "content": "我已经根据当前对话生成了一个定时任务草案，你可以查看、预览并确认创建。",
        "timestamp": "2026-04-20T01:40:04",
    }


async def _run_worker_flow():
    ensure_chat_turn_schema()
    ensure_turn_memory_schema()
    db = SessionLocal()
    suffix = uuid.uuid4().hex[:8]
    session_uid = f"worker-v2-{suffix}"
    captured_events = []
    turn_memory_calls = []

    original_execute_stream = AgentExecutorV2.execute_stream
    original_send = worker_module._send_to_session
    original_session_add_message = worker_module.SessionManager.add_message
    original_turn_memory_delay = turn_memory_tasks_module.build_turn_memory_task.delay

    try:
        user = User(
            username=f"worker_v2_test_{suffix}",
            email=f"worker_v2_test_{suffix}@example.com",
            hashed_password="not-used",
            is_active=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        session = ChatSession(
            session_id=session_uid,
            user_id=user.id,
            title="worker v2 finalize flow test",
            provider="kimi",
            model="moonshot-v1-auto",
            knowledge_base_ids=[],
        )
        db.add(session)
        db.commit()
        db.refresh(session)

        turn = chat_session_service.create_turn(db, session.id, user.id, trigger_type="normal")
        user_message = chat_session_service.add_message(
            db,
            session.id,
            "user",
            "把刚才成功的招聘网站投递流程设成每天早上9点自动执行，并在完成后发通知",
            turn_id=turn.id,
        )

        AgentExecutorV2.execute_stream = _fake_execute_stream

        async def _fake_send_to_session(session_id: str, message: dict):
            captured_events.append(message)

        worker_module._send_to_session = _fake_send_to_session
        worker_module.SessionManager.add_message = classmethod(lambda cls, *args, **kwargs: True)
        turn_memory_tasks_module.build_turn_memory_task.delay = lambda turn_id: turn_memory_calls.append(turn_id)

        result = await worker_module._execute_v2(
            session_id=session_uid,
            user_messages=[{"role": "user", "content": "把刚才成功的招聘网站投递流程设成每天早上9点自动执行，并在完成后发通知"}],
            provider="kimi",
            model="moonshot-v1-auto",
            user_id=user.id,
            knowledge_base_ids=[],
            turn_id=turn.id,
            user_message_id=user_message.id,
        )

        db.expire_all()
        turn_db = db.query(ChatTurn).filter(ChatTurn.id == turn.id).first()
        assistant_message = db.query(ChatMessage).filter(
            ChatMessage.turn_id == turn.id,
            ChatMessage.role == "assistant",
        ).order_by(ChatMessage.id.desc()).first()
        execution_steps = db.query(AgentExecutionStep).filter(
            AgentExecutionStep.turn_id == turn.id
        ).order_by(AgentExecutionStep.sort_order.asc(), AgentExecutionStep.id.asc()).all()

        return {
            "result": result,
            "captured_events": captured_events,
            "turn_memory_calls": turn_memory_calls,
            "turn": turn_db,
            "assistant_message": assistant_message,
            "execution_steps": execution_steps,
            "db": db,
            "ids": {
                "user_id": user.id,
                "session_id": session.id,
                "turn_id": turn.id,
            },
            "user_message_id": user_message.id,
        }
    except Exception:
        db.close()
        raise
    finally:
        AgentExecutorV2.execute_stream = original_execute_stream
        worker_module._send_to_session = original_send
        worker_module.SessionManager.add_message = original_session_add_message
        turn_memory_tasks_module.build_turn_memory_task.delay = original_turn_memory_delay


def _cleanup(db, ids):
    turn_id = ids["turn_id"]
    session_id = ids["session_id"]
    user_id = ids["user_id"]
    turn = db.query(ChatTurn).filter(ChatTurn.id == turn_id).first()
    if turn:
        turn.source_user_message_id = None
        turn.assistant_message_id = None
        db.commit()
    inspector = inspect(db.bind)
    if "turn_memories" in inspector.get_table_names():
        db.query(TurnMemory).filter(TurnMemory.turn_id == turn_id).delete(synchronize_session=False)
    db.query(AgentExecutionStep).filter(AgentExecutionStep.turn_id == turn_id).delete(synchronize_session=False)
    message_ids = [
        row[0]
        for row in db.query(ChatMessage.id).filter(ChatMessage.turn_id == turn_id).all()
    ]
    if message_ids:
        db.query(MessageContentItem).filter(
            MessageContentItem.message_id.in_(message_ids)
        ).delete(synchronize_session=False)
    db.query(ChatMessage).filter(ChatMessage.turn_id == turn_id).delete(synchronize_session=False)
    db.query(ChatTurn).filter(ChatTurn.id == turn_id).delete(synchronize_session=False)
    db.query(ChatSession).filter(ChatSession.id == session_id).delete(synchronize_session=False)
    db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
    db.commit()
    db.close()


def main():
    payload = asyncio.run(_run_worker_flow())
    try:
        result = payload["result"]
        captured_events = payload["captured_events"]
        turn_memory_calls = payload["turn_memory_calls"]
        turn = payload["turn"]
        assistant_message = payload["assistant_message"]
        execution_steps = payload["execution_steps"]
        user_message_id = payload["user_message_id"]

        assert_true(result.get("success") is True, "worker v2 执行未成功")
        assert_true(result.get("provider") == "kimi", "result 未保留 provider")
        assert_true(result.get("model") == "moonshot-v1-auto", "result 未保留 model")
        assert_true(turn is not None and turn.status == "completed", "turn 未完成")
        assert_true(turn.source_user_message_id == user_message_id, "source_user_message_id 未回写")
        assert_true(assistant_message is not None, "assistant message 未落库")
        assert_true(len(execution_steps) == 4, "execution steps 数量不正确")
        assert_true(execution_steps[0].sort_order == 0, "execution step sort_order 未按顺序保存")

        extra_data = execution_steps[2].extra_data or {}
        assert_true(extra_data.get("draft_id") == 321, "draft_id 未写入 step metadata")
        assert_true(extra_data.get("draft_title") == "招聘网站投递自动化任务", "draft_title 未写入 step metadata")
        assert_true(extra_data.get("analysis_status") == "draft", "analysis_status 未写入 step metadata")
        assert_true(extra_data.get("intent_text"), "intent_text 未写入 step metadata")
        assert_true(extra_data.get("request_id") == "req_v2_worker_test", "request_id 未写入 step metadata")
        assert_true(extra_data.get("job_id") == "job_v2_worker_test", "job_id 未写入 step metadata")

        assert_true(turn_memory_calls == [turn.id], "build_turn_memory_task 未触发")
        done_event = next((event for event in captured_events if event.get("type") == "done"), None)
        assert_true(done_event is not None, "缺少 done 事件")
        assert_true(done_event.get("total_steps") == 5, "done.total_steps 不正确")

        print("[done] scheduled task v2 worker finalize flow validation passed")
    finally:
        _cleanup(payload["db"], payload["ids"])


if __name__ == "__main__":
    main()
