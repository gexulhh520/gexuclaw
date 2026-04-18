from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime

from models.database import get_db
from models.user import User
from schemas.chat_session import (
    ChatSessionCreate,
    ChatSessionResponse,
    ChatMessageResponse,
    SessionKnowledgeBasesUpdate,
)
from services.chat_session_service import chat_session_service
from services.knowledge_base_service import knowledge_base_service
from services.session_manager import SessionManager
from core.auth import get_current_active_user

router = APIRouter(tags=["会话管理"])


def _validate_knowledge_base_ids(db: Session, user_id: int, knowledge_base_ids: List[int]) -> List[int]:
    unique_ids = list(dict.fromkeys(knowledge_base_ids))
    for knowledge_base_id in unique_ids:
        knowledge_base_service.get_user_knowledge_base_or_404(db, user_id, knowledge_base_id)
    return unique_ids


@router.post("", response_model=ChatSessionResponse)
def create_session(
    session_data: ChatSessionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """创建新会话"""
    import uuid
    session_id = str(uuid.uuid4())
    session_data.knowledge_base_ids = _validate_knowledge_base_ids(
        db,
        current_user.id,
        session_data.knowledge_base_ids,
    )
    return chat_session_service.create_session(db, current_user.id, session_data, session_id)


@router.get("", response_model=List[ChatSessionResponse])
def get_my_sessions(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """获取当前用户的所有会话"""
    import time
    start_total = time.time()
    
    start = time.time()
    sessions = chat_session_service.get_user_sessions(db, current_user.id, skip, limit)
    query_time = time.time() - start
    
    start = time.time()
    result = [ChatSessionResponse.model_validate(s) for s in sessions]
    serialize_time = time.time() - start
    
    total_time = time.time() - start_total
    print(f"[Debug] Query: {query_time:.3f}s, Serialize: {serialize_time:.3f}s, Total: {total_time:.3f}s, Count: {len(sessions)}")
    return result


@router.get("/{session_id}", response_model=ChatSessionResponse)
def get_session(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """获取特定会话详情"""
    session = chat_session_service.get_user_session(db, current_user.id, session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )
    return session


@router.get("/{session_id}/messages", response_model=List[ChatMessageResponse])
def get_session_messages(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """获取会话的所有消息"""
    session = chat_session_service.get_user_session(db, current_user.id, session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )
    
    messages = chat_session_service.get_session_messages(db, session.id)
    
    # 手动转换为响应格式
    return [
        ChatMessageResponse(
            id=msg.id,
            role=msg.role,
            content=msg.content_items,
            created_at=msg.created_at
        )
        for msg in messages
    ]


@router.delete("/{session_id}")
def delete_session(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """删除会话"""
    import time
    start_total = time.time()
    
    start = time.time()
    session = chat_session_service.get_user_session(db, current_user.id, session_id)
    query_time = time.time() - start
    print(f"[Delete Debug] Step 1 - Query session: {query_time:.3f}s")
    
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )
    
    start = time.time()
    success = chat_session_service.delete_session(db, session.id)
    delete_time = time.time() - start
    print(f"[Delete Debug] Step 2 - Delete session: {delete_time:.3f}s")
    
    total_time = time.time() - start_total
    print(f"[Delete Debug] Total: {total_time:.3f}s")
    
    if success:
        return {"message": "Session deleted successfully"}
    else:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete session"
        )


@router.put("/{session_id}/knowledge-bases")
def update_session_knowledge_bases(
    session_id: str,
    update_data: SessionKnowledgeBasesUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """更新会话绑定的知识库"""
    session = chat_session_service.get_user_session(db, current_user.id, session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )

    knowledge_base_ids = _validate_knowledge_base_ids(db, current_user.id, update_data.knowledge_base_ids)
    chat_session_service.update_session_knowledge_bases(db, session.id, knowledge_base_ids)
    SessionManager.update_session(session_id, {"knowledge_base_ids": knowledge_base_ids})

    return {
        "success": True,
        "session_id": session_id,
        "knowledge_base_ids": knowledge_base_ids,
    }
