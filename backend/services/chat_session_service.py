from sqlalchemy.orm import Session
from sqlalchemy import desc
from typing import List, Optional
from datetime import datetime
from models.chat_session import ChatSession, ChatMessage
from schemas.chat_session import ChatSessionCreate


class ChatSessionService:
    @staticmethod
    def create_session(db: Session, user_id: int, session_data: ChatSessionCreate, session_id: str) -> ChatSession:
        """创建新会话"""
        db_session = ChatSession(
            session_id=session_id,
            user_id=user_id,
            title=session_data.title,
            provider=session_data.provider,
            model=session_data.model
        )
        db.add(db_session)
        db.commit()
        db.refresh(db_session)
        return db_session
    
    @staticmethod
    def get_user_sessions(db: Session, user_id: int, skip: int = 0, limit: int = 100) -> List[ChatSession]:
        """获取用户的所有会话（按创建时间降序）"""
        return db.query(ChatSession).filter(
            ChatSession.user_id == user_id
        ).order_by(desc(ChatSession.created_at)).offset(skip).limit(limit).all()
    
    @staticmethod
    def get_session_by_id(db: Session, session_id: str) -> Optional[ChatSession]:
        """通过 session_id 获取会话"""
        return db.query(ChatSession).filter(ChatSession.session_id == session_id).first()
    
    @staticmethod
    def get_user_session(db: Session, user_id: int, session_id: str) -> Optional[ChatSession]:
        """获取用户的特定会话（验证权限）"""
        return db.query(ChatSession).filter(
            ChatSession.user_id == user_id,
            ChatSession.session_id == session_id
        ).first()
    
    @staticmethod
    def add_message(db: Session, session_id: int, role: str, content: str) -> ChatMessage:
        """添加消息到会话"""
        db_message = ChatMessage(
            session_id=session_id,
            role=role,
            content=content
        )
        db.add(db_message)
        db.commit()
        db.refresh(db_message)
        
        # 更新会话的 updated_at
        db.query(ChatSession).filter(ChatSession.id == session_id).update(
            {"updated_at": datetime.utcnow()}
        )
        db.commit()
        
        return db_message
    
    @staticmethod
    def get_session_messages(db: Session, session_id: int) -> List[ChatMessage]:
        """获取会话的所有消息"""
        return db.query(ChatMessage).filter(
            ChatMessage.session_id == session_id
        ).order_by(ChatMessage.created_at).all()
    
    @staticmethod
    def update_session_title(db: Session, session_id: int, title: str) -> None:
        """更新会话标题"""
        db.query(ChatSession).filter(ChatSession.id == session_id).update(
            {"title": title}
        )
        db.commit()
    
    @staticmethod
    def delete_session(db: Session, session_id: int) -> bool:
        """删除会话"""
        import time
        
        start = time.time()
        session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
        query_time = time.time() - start
        print(f"[Delete Service Debug] Step 2.1 - Query session by id: {query_time:.3f}s")
        
        if session:
            start = time.time()
            db.delete(session)
            delete_op_time = time.time() - start
            print(f"[Delete Service Debug] Step 2.2 - Delete operation: {delete_op_time:.3f}s")
            
            start = time.time()
            db.commit()
            commit_time = time.time() - start
            print(f"[Delete Service Debug] Step 2.3 - Commit: {commit_time:.3f}s")
            
            return True
        return False


chat_session_service = ChatSessionService()
