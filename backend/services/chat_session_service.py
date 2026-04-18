from sqlalchemy.orm import Session, joinedload
from sqlalchemy import desc
from typing import List, Optional, Union, Dict, Any
from datetime import datetime
from models.chat_session import ChatSession, ChatMessage, MessageContentItem
from models.agent_execution_step import AgentExecutionStep
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
            model=session_data.model,
            knowledge_base_ids=session_data.knowledge_base_ids or [],
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
    def add_message(db: Session, session_id: int, role: str, 
                   content: Union[str, List[Dict[str, Any]]]) -> ChatMessage:
        """
        添加消息到会话（支持多模态）
        
        Args:
            db: 数据库会话
            session_id: 会话 ID（数据库主键）
            role: 消息角色 (user/assistant/system)
            content: 消息内容
                - 字符串：纯文本消息（向后兼容）
                - 列表：多模态内容项 [{"type": "text|image|audio", "content": "...", "id": "optional"}]
        
        Returns:
            ChatMessage 对象
        """
        db_message = ChatMessage(
            session_id=session_id,
            role=role,
        )
        db.add(db_message)
        db.commit()
        db.refresh(db_message)
        
        # 标准化 content 为列表格式
        if isinstance(content, str):
            content_items = [{"type": "text", "content": content}]
        elif isinstance(content, list):
            content_items = content
        else:
            content_items = [{"type": "text", "content": str(content)}]
        
        # 添加内容项到子表
        for idx, item in enumerate(content_items):
            content_item = MessageContentItem(
                message_id=db_message.id,
                type=item.get("type", "text"),
                content=item.get("content", ""),
                content_id=item.get("id"),  # 可选标识符
                sort_order=idx,
            )
            db.add(content_item)
        
        db.commit()
        
        # 更新会话的 updated_at
        db.query(ChatSession).filter(ChatSession.id == session_id).update(
            {"updated_at": datetime.utcnow()}
        )
        db.commit()
        
        return db_message
    
    @staticmethod
    def get_message_with_contents(db: Session, message_id: int) -> Optional[Dict[str, Any]]:
        """
        获取消息及其完整的多模态内容
        
        Returns:
            {
                "id": int,
                "role": str,
                "content": [
                    {
                        "type": str,
                        "content": str,
                        "id": Optional[str],
                    }
                ],
                "created_at": datetime,
                "steps": [  # 新增：执行步骤
                    {
                        "id": int,
                        "step_type": str,
                        "content": str,
                        "tool_name": str,
                        "tool_status": str,
                        "metadata": dict,
                        "sort_order": int,
                        "created_at": datetime
                    }
                ]
            }
            或 None
        """
        message = db.query(ChatMessage).filter(ChatMessage.id == message_id).first()
        if not message:
            return None
            
        contents = db.query(MessageContentItem)\
            .filter(MessageContentItem.message_id == message_id)\
            .order_by(MessageContentItem.sort_order)\
            .all()
        
        # 获取执行步骤
        steps = db.query(AgentExecutionStep)\
            .filter(AgentExecutionStep.message_id == message_id)\
            .order_by(AgentExecutionStep.sort_order)\
            .all()
        
        return {
            "id": message.id,
            "role": message.role,
            "content": [
                {
                    "type": c.type,
                    "content": c.content,
                    "id": c.content_id,
                }
                for c in contents
            ],
            "created_at": message.created_at.isoformat(),
            "steps": [
                {
                    "id": s.id,
                    "step_type": s.step_type,
                    "content": s.content,
                    "tool_name": s.tool_name,
                    "tool_status": s.tool_status,
                    "metadata": s.metadata,
                    "sort_order": s.sort_order,
                    "created_at": s.created_at.isoformat() if s.created_at else None
                }
                for s in steps
            ]
        }
    
    @staticmethod
    def get_session_messages_with_contents(db: Session, session_db_id: int) -> List[Dict[str, Any]]:
        """
        获取会话的所有消息（包含完整多模态内容）
        
        Returns:
            [message_dict, ...]  # 每个 message_dict 包含完整的 content 列表
        """
        messages = db.query(ChatMessage).filter(
            ChatMessage.session_id == session_db_id
        ).order_by(ChatMessage.created_at).all()
        
        result = []
        for msg in messages:
            full_msg = ChatSessionService.get_message_with_contents(db, msg.id)
            if full_msg:
                result.append(full_msg)
        
        return result
    
    @staticmethod
    def get_session_messages(db: Session, session_id: int) -> List[ChatMessage]:
        """获取会话的所有消息（仅消息记录，不含详细内容）"""
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
    def update_session_knowledge_bases(db: Session, session_id: int, knowledge_base_ids: List[int]) -> None:
        """更新会话绑定的知识库列表"""
        db.query(ChatSession).filter(ChatSession.id == session_id).update(
            {
                "knowledge_base_ids": knowledge_base_ids,
                "updated_at": datetime.utcnow(),
            }
        )
        db.commit()
    
    @staticmethod
    def delete_session(db: Session, session_id: int) -> bool:
        """删除会话"""
        import time
        
        start = time.time()
        session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
        query_time = time.time() - start
        
        if session:
            start = time.time()
            db.delete(session)
            delete_op_time = time.time() - start
            
            start = time.time()
            db.commit()
            commit_time = time.time() - start
            
            return True
        return False


chat_session_service = ChatSessionService()
