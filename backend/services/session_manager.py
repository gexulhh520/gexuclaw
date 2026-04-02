import uuid
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta
from core.redis_client import redis_client


class SessionManager:
    SESSION_PREFIX = "session:"
    CONTEXT_PREFIX = "context:"
    SESSION_TTL = 86400 * 7  # 7 days

    @classmethod
    def create_session(cls, user_id: Optional[str] = None) -> str:
        session_id = str(uuid.uuid4())
        session_data = {
            "session_id": session_id,
            "user_id": user_id,
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
            "messages": [],
            "metadata": {},
        }
        redis_client.set(
            f"{cls.SESSION_PREFIX}{session_id}",
            session_data,
            expire=cls.SESSION_TTL,
        )
        return session_id

    @classmethod
    def get_session(cls, session_id: str) -> Optional[Dict[str, Any]]:
        return redis_client.get(f"{cls.SESSION_PREFIX}{session_id}")

    @classmethod
    def update_session(cls, session_id: str, data: Dict[str, Any]) -> bool:
        session = cls.get_session(session_id)
        if not session:
            return False

        session.update(data)
        session["updated_at"] = datetime.now().isoformat()

        redis_client.set(
            f"{cls.SESSION_PREFIX}{session_id}",
            session,
            expire=cls.SESSION_TTL,
        )
        return True

    @classmethod
    def add_message(cls, session_id: str, role: str, content: str, metadata: Dict = None) -> bool:
        session = cls.get_session(session_id)
        if not session:
            return False

        message = {
            "role": role,
            "content": content,
            "timestamp": datetime.now().isoformat(),
            "metadata": metadata or {},
        }

        session["messages"].append(message)
        session["updated_at"] = datetime.now().isoformat()

        redis_client.set(
            f"{cls.SESSION_PREFIX}{session_id}",
            session,
            expire=cls.SESSION_TTL,
        )
        return True

    @classmethod
    def get_messages(cls, session_id: str, limit: int = None) -> List[Dict[str, Any]]:
        session = cls.get_session(session_id)
        if not session:
            return []
        messages = session.get("messages", [])
        if limit:
            return messages[-limit:]
        return messages

    @classmethod
    def set_context(cls, session_id: str, key: str, value: Any) -> bool:
        context_key = f"{cls.CONTEXT_PREFIX}{session_id}:{key}"
        return redis_client.set(context_key, value, expire=cls.SESSION_TTL)

    @classmethod
    def get_context(cls, session_id: str, key: str) -> Optional[Any]:
        context_key = f"{cls.CONTEXT_PREFIX}{session_id}:{key}"
        return redis_client.get(context_key)

    @classmethod
    def delete_session(cls, session_id: str) -> bool:
        redis_client.delete(f"{cls.SESSION_PREFIX}{session_id}")
        return True
