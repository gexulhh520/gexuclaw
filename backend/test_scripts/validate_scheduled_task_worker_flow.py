"""
验证定时任务方案1的后端 worker 闭环（真实 Kimi + 真实 _execute + mock 子图持久化）。

覆盖链路：
1. 创建临时 user / chat_session / chat_turn / user message
2. 使用真实 Kimi provider 调用 workers.tasks._execute()
3. mock 子图返回草案，mock WebSocket 发送，mock turn memory 异步任务
4. 校验：
   - 事件流包含 scheduled_task_suggestion / done
   - turn 状态变为 completed
   - assistant message 已入库并挂在当前 turn
   - execution steps 已落库

执行方式：
    python backend/test_scripts/validate_scheduled_task_worker_flow.py
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

import agents.executor as executor_module  # noqa: E402
import workers.tasks as worker_module  # noqa: E402
import workers.turn_memory_tasks as turn_memory_tasks_module  # noqa: E402
from test_scripts.create_chat_turn_schema import main as ensure_chat_turn_schema  # noqa: E402
from models.agent_execution_step import AgentExecutionStep  # noqa: E402
from models.chat_session import ChatSession, ChatMessage, MessageContentItem  # noqa: E402
from models.chat_turn import ChatTurn  # noqa: E402
from models.database import SessionLocal  # noqa: E402
from models.turn_memory import TurnMemory  # noqa: E402
from models.user import User  # noqa: E402
from services.chat_session_service import chat_session_service  # noqa: E402


def assert_true(condition, message: str):
    if not condition:
        raise AssertionError(message)


class MockSubgraph:
    async def ainvoke(self, state):
        state["task_id"] = 789
        state["draft_payload"] = {
            "id": 789,
            "title": "招聘网站投递后端联调任务",
            "summary_markdown": "### 招聘网站投递后端联调任务\n- 频率：每天早上9点",
            "intent_text": state.get("route_decision", {}).get("intent_text") or "",
            "analysis_status": "draft",
            "schedule_text": state.get("route_decision", {}).get("schedule_text") or "每天早上9点",
            "timezone": state.get("route_decision", {}).get("timezone") or "Asia/Shanghai",
        }
        return state


async def _run_worker_flow():
    ensure_chat_turn_schema()
    db = SessionLocal()
    suffix = uuid.uuid4().hex[:8]
    session_uid = f"worker-flow-{suffix}"
    captured_events = []

    original_subgraph = executor_module.scheduled_task_planner_subgraph
    original_send = worker_module._send_to_session
    original_session_add_message = worker_module.SessionManager.add_message
    original_turn_memory_delay = turn_memory_tasks_module.build_turn_memory_task.delay

    try:
        user = User(
            username=f"worker_test_{suffix}",
            email=f"worker_test_{suffix}@example.com",
            hashed_password="not-used",
            is_active=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        session = ChatSession(
            session_id=session_uid,
            user_id=user.id,
            title="worker flow test",
            provider="kimi",
            model=None,
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

        executor_module.scheduled_task_planner_subgraph = MockSubgraph()

        async def _fake_send_to_session(session_id: str, message: dict):
            captured_events.append(message)

        worker_module._send_to_session = _fake_send_to_session
        worker_module.SessionManager.add_message = classmethod(lambda cls, *args, **kwargs: True)
        turn_memory_tasks_module.build_turn_memory_task.delay = lambda turn_id: None

        result = await worker_module._execute(
            session_id=session_uid,
            user_messages=[{"role": "user", "content": "把刚才成功的招聘网站投递流程设成每天早上9点自动执行，并在完成后发通知"}],
            provider="kimi",
            model=None,
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
        ).order_by(AgentExecutionStep.id.asc()).all()

        return {
            "result": result,
            "captured_events": captured_events,
            "turn": turn_db,
            "assistant_message": assistant_message,
            "execution_steps": execution_steps,
            "db": db,
            "ids": {
                "user_id": user.id,
                "session_id": session.id,
                "turn_id": turn.id,
            },
        }
    except Exception:
        db.close()
        raise
    finally:
        executor_module.scheduled_task_planner_subgraph = original_subgraph
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
        turn = payload["turn"]
        assistant_message = payload["assistant_message"]
        execution_steps = payload["execution_steps"]

        assert_true(result.get("success") is True, "worker 执行未成功")
        event_types = [event.get("type") for event in captured_events]
        assert_true("scheduled_task_suggestion" in event_types, "缺少 scheduled_task_suggestion 事件")
        assert_true("done" in event_types, "缺少 done 事件")
        assert_true(turn is not None and turn.status == "completed", "turn 未完成")
        assert_true(assistant_message is not None, "assistant message 未落库")
        assert_true("定时任务草案" in chat_session_service.get_message_with_contents(payload["db"], assistant_message.id)["content"][0]["content"], "assistant message 未包含草案提示")
        assert_true(len(execution_steps) > 0, "execution steps 未落库")

        print("[done] scheduled task worker flow validation passed")
    finally:
        _cleanup(payload["db"], payload["ids"])


if __name__ == "__main__":
    main()
