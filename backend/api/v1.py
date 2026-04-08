from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List, Dict, Any, Union
from sqlalchemy.orm import Session
from datetime import datetime

from services.session_manager import SessionManager
from services.chat_session_service import chat_session_service
from workers.tasks import execute_agent_task
from models.database import get_db
from models.user import User
from core.auth import get_current_active_user

router = APIRouter()


class SessionCreate(BaseModel):
    user_id: Optional[str] = None
    provider: Optional[str] = "openai"
    model: Optional[str] = None


class MessageCreate(BaseModel):
    session_id: str
    content: Union[str, List[Dict[str, Any]]]
    provider: Optional[str] = "openai"
    model: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class SessionResponse(BaseModel):
    session_id: str
    user_id: Optional[str]
    created_at: str
    updated_at: str
    messages: List[Dict[str, Any]]


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
        title="聊天会话",
        provider=data.provider or "openai",
        model=data.model
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
        }
        redis_client.set(
            f"session:{data.session_id}",
            session_data,
            expire=86400 * 7
        )
    
    # 添加用户消息到 PostgreSQL
    chat_session_service.add_message(db, session.id, "user", data.content)
    
    # 添加用户消息到 Redis
    SessionManager.add_message(data.session_id, "user", data.content)

    task = execute_agent_task.delay(
        data.session_id,
        data.content,
        data.provider or "openai",
        data.model,
        current_user.id  # 传递 user_id 给 Worker
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

    response = {
        "task_id": task_id,
        "status": task.status,
    }

    if task.state == "SUCCESS":
        response["result"] = task.result
    elif task.state == "FAILURE":
        response["error"] = str(task.info)

    return response
