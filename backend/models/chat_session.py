from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, JSON
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from .database import Base


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String(100), unique=True, index=True, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    title = Column(String(200), default="新会话")
    provider = Column(String(50), default="openai")
    model = Column(String(100), nullable=True)
    knowledge_base_ids = Column(JSON, nullable=False, default=list)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # 关联用户
    user = relationship("User", back_populates="sessions")
    # 关联消息
    messages = relationship("ChatMessage", back_populates="session", cascade="all, delete-orphan")
    # 关联轮次
    turns = relationship("ChatTurn", back_populates="session", cascade="all, delete-orphan")


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("chat_sessions.id"), nullable=False)
    turn_id = Column(Integer, ForeignKey("chat_turns.id"), nullable=True, index=True)
    role = Column(String(20), nullable=False)  # user / assistant / system
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # 关联会话
    session = relationship("ChatSession", back_populates="messages")
    turn = relationship("ChatTurn", back_populates="messages", foreign_keys=[turn_id])
    # 关联内容项（多模态）
    content_items = relationship("MessageContentItem", back_populates="message", cascade="all, delete-orphan")


class MessageContentItem(Base):
    __tablename__ = "message_content_items"

    id = Column(Integer, primary_key=True, index=True)
    message_id = Column(Integer, ForeignKey("chat_messages.id"), nullable=False)
    type = Column(String(20), nullable=False)  # text / image / audio / video
    content = Column(Text, nullable=False)      # 实际内容（文本、base64、URL等）
    content_id = Column(String(100), nullable=True)  # 可选标识符（如 image1）
    sort_order = Column(Integer, default=0)     # 排序顺序
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # 关联消息
    message = relationship("ChatMessage", back_populates="content_items")
