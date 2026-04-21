from datetime import datetime
from typing import Any, Dict, List, Optional, Union

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.auth import get_current_active_user
from models.database import get_db
from models.user import User
from services.chat_session_service import chat_session_service
from services.knowledge_base_service import knowledge_base_service
from services.session_manager import SessionManager
from workers.tasks_v2 import execute_agent_task_v2

router = APIRouter(tags=["聊天V2"])


class MessageCreateV2(BaseModel):
    session_id: str
    content: Union[str, List[Dict[str, Any]]]
    provider: Optional[str] = "openai"
    model: Optional[str] = None
    knowledge_base_ids: List[int] = []


def _validate_knowledge_base_ids(db: Session, user_id: int, knowledge_base_ids: List[int]) -> List[int]:
    unique_ids = list(dict.fromkeys(knowledge_base_ids))
    for knowledge_base_id in unique_ids:
        knowledge_base_service.get_user_knowledge_base_or_404(db, user_id, knowledge_base_id)
    return unique_ids


@router.post("/chat")
def send_message_v2(
    data: MessageCreateV2,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    session = chat_session_service.get_user_session(db, current_user.id, data.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    request_knowledge_base_ids = _validate_knowledge_base_ids(db, current_user.id, data.knowledge_base_ids)
    if request_knowledge_base_ids:
        chat_session_service.update_session_knowledge_bases(db, session.id, request_knowledge_base_ids)
        knowledge_base_ids = request_knowledge_base_ids
    else:
        knowledge_base_ids = session.knowledge_base_ids or []

    redis_session = SessionManager.get_session(data.session_id)
    if not redis_session:
        from core.redis_client import redis_client

        redis_client.set(
            f"session:{data.session_id}",
            {
                "session_id": data.session_id,
                "user_id": str(current_user.id),
                "created_at": datetime.now().isoformat(),
                "updated_at": datetime.now().isoformat(),
                "messages": [],
                "metadata": {},
                "knowledge_base_ids": knowledge_base_ids,
            },
            expire=86400 * 7,
        )
    else:
        SessionManager.update_session(data.session_id, {"knowledge_base_ids": knowledge_base_ids})

    turn = chat_session_service.create_turn(db, session.id, current_user.id, trigger_type="normal")
    user_message = chat_session_service.add_message(db, session.id, "user", data.content, turn_id=turn.id)
    SessionManager.add_message(data.session_id, "user", data.content)

    task = execute_agent_task_v2.delay(
        data.session_id,
        [{"role": "user", "content": data.content}],
        data.provider or "openai",
        data.model,
        current_user.id,
        knowledge_base_ids,
        turn.id,
        user_message.id,
    )

    return {
        "success": True,
        "task_id": task.id,
        "session_id": data.session_id,
        "provider": data.provider,
        "model": data.model,
        "mode": "v2",
    }
