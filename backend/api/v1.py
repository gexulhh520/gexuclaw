from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List, Dict, Any, Union
from sqlalchemy.orm import Session
from datetime import datetime

from services.session_manager import SessionManager
from services.chat_session_service import chat_session_service
from services.knowledge_base_service import knowledge_base_service
from workers.tasks import execute_agent_task
from models.database import get_db
from models.user import User
from core.auth import get_current_active_user

router = APIRouter()


class SessionCreate(BaseModel):
    user_id: Optional[str] = None
    provider: Optional[str] = "openai"
    model: Optional[str] = None
    knowledge_base_ids: List[int] = []


class MessageCreate(BaseModel):
    session_id: str
    content: Union[str, List[Dict[str, Any]]]
    provider: Optional[str] = "openai"
    model: Optional[str] = None
    knowledge_base_ids: List[int] = []
    metadata: Optional[Dict[str, Any]] = None


class SessionResponse(BaseModel):
    session_id: str
    user_id: Optional[str]
    created_at: str
    updated_at: str
    knowledge_base_ids: List[int] = []
    messages: List[Dict[str, Any]]


def _validate_knowledge_base_ids(db: Session, user_id: int, knowledge_base_ids: List[int]) -> List[int]:
    unique_ids = list(dict.fromkeys(knowledge_base_ids))
    for knowledge_base_id in unique_ids:
        knowledge_base_service.get_user_knowledge_base_or_404(db, user_id, knowledge_base_id)
    return unique_ids


@router.post("/sessions", response_model=dict)
async def create_session(
    data: SessionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """创建新会话（需要登录）"""
    import uuid
    from schemas.chat_session import ChatSessionCreate
    
    session_id = str(uuid.uuid4())

    # 同时在 PostgreSQL 创建会话记录
    session_data = ChatSessionCreate(
        title=datetime.now().strftime("%Y-%m-%d %H:%M") + " 会话",
        provider=data.provider or "openai",
        model=data.model,
        knowledge_base_ids=_validate_knowledge_base_ids(db, current_user.id, data.knowledge_base_ids),
    )
    chat_session_service.create_session(db, current_user.id, session_data, session_id)
    
    # 同时在 Redis 创建会话（用于实时消息）
    from core.redis_client import redis_client
    redis_session_data = {
        "session_id": session_id,
        "user_id": str(current_user.id),
        "created_at": datetime.now().isoformat(),
        "updated_at": datetime.now().isoformat(),
        "messages": [],
        "metadata": {},
        "knowledge_base_ids": session_data.knowledge_base_ids,
    }
    redis_client.set(
        f"session:{session_id}",
        redis_session_data,
        expire=86400 * 7
    )
    
    return {"session_id": session_id}


@router.get("/sessions/{session_id}", response_model=SessionResponse)
async def get_session(
    session_id: str,
    current_user: User = Depends(get_current_active_user)
):
    """获取会话详情（需要登录且只能访问自己的会话）"""
    session = SessionManager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    # 验证会话属于当前用户
    if session.get("user_id") != str(current_user.id):
        raise HTTPException(status_code=403, detail="Access denied")
    
    return SessionResponse(**session)


@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """删除会话"""
    # 验证权限
    session = chat_session_service.get_user_session(db, current_user.id, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    # 删除 PostgreSQL 记录
    chat_session_service.delete_session(db, session.id)
    
    # 删除 Redis 记录
    SessionManager.delete_session(session_id)
    
    return {"success": True}


@router.get("/sessions/{session_id}/messages")
async def get_messages(
    session_id: str,
    limit: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """获取会话消息"""
    # 验证权限
    session = chat_session_service.get_user_session(db, current_user.id, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    messages = SessionManager.get_messages(session_id, limit=limit)
    return {"messages": messages}


@router.post("/chat")
async def send_message(
    data: MessageCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """发送消息（需要登录）"""
    # 验证会话存在且属于当前用户
    session = chat_session_service.get_user_session(db, current_user.id, data.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    request_knowledge_base_ids = _validate_knowledge_base_ids(db, current_user.id, data.knowledge_base_ids)
    if request_knowledge_base_ids:
        chat_session_service.update_session_knowledge_bases(db, session.id, request_knowledge_base_ids)
        knowledge_base_ids = request_knowledge_base_ids
    else:
        knowledge_base_ids = session.knowledge_base_ids or []
    
    # 确保 Redis 会话也存在
    redis_session = SessionManager.get_session(data.session_id)
    if not redis_session:
        # 创建新的 Redis 会话
        from core.redis_client import redis_client
        session_data = {
            "session_id": data.session_id,
            "user_id": str(current_user.id),
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
            "messages": [],
            "metadata": {},
            "knowledge_base_ids": knowledge_base_ids,
        }
        redis_client.set(
            f"session:{data.session_id}",
            session_data,
            expire=86400 * 7
        )
    else:
        SessionManager.update_session(data.session_id, {"knowledge_base_ids": knowledge_base_ids})
    
    chat_session_service.add_message(db, session.id, "user", data.content)
    
    # 添加用户消息到 Redis
    SessionManager.add_message(data.session_id, "user", data.content)
    user_input = [{
            "role": "user",
            "content": data.content
        }]
    task = execute_agent_task.delay(
        data.session_id,
        user_input,
        data.provider or "openai",
        data.model,
        current_user.id,
        knowledge_base_ids,
    )

    return {
        "success": True,
        "task_id": task.id,
        "session_id": data.session_id,
        "provider": data.provider,
        "model": data.model,
    }


@router.get("/tasks/{task_id}")
async def get_task_status(task_id: str):
    from workers.celery_app import celery_app
    task = celery_app.AsyncResult(task_id)

    try:
        task_state = task.state
        response = {
            "task_id": task_id,
            "status": task_state,
        }

        if task_state == "SUCCESS":
            response["result"] = task.result
        elif task_state == "FAILURE":
            response["error"] = str(task.info)
            response["result"] = {
                "message": str(task.info),
            }
        elif task_state in {"PENDING", "STARTED", "RETRY", "PROCESSING"}:
            if isinstance(task.info, dict):
                response["result"] = task.info

        return response
    except ValueError as exc:
        # 兜底处理历史异常结果，避免轮询接口因 Celery 结果格式问题直接 500
        return {
            "task_id": task_id,
            "status": "FAILURE",
            "error": f"任务结果解析失败: {str(exc)}",
            "result": {
                "message": "任务执行失败，结果格式异常，请重新上传或查看后端日志",
            },
        }
