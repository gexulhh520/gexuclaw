from sqlalchemy import Column, Integer, String, DateTime, Boolean, JSON
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from .database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    email = Column(String(100), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True)
    # User settings (v1: stored on users table; add DB-compat migration on startup)
    timezone = Column(String(100), nullable=False, default="Asia/Shanghai")
    notification_email = Column(String(255), nullable=True)
    email_notifications_enabled = Column(Boolean, nullable=False, default=False)
    wechat_notifications_enabled = Column(Boolean, nullable=False, default=False)
    wechat_channel_type = Column(String(50), nullable=False, default="clawbot")
    wechat_config_json = Column(JSON, nullable=False, default=dict)
    task_settings_json = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # 关联会话
    sessions = relationship("ChatSession", back_populates="user", cascade="all, delete-orphan")
    turns = relationship("ChatTurn", back_populates="user", cascade="all, delete-orphan")
    turn_memories = relationship("TurnMemory", back_populates="user", cascade="all, delete-orphan")
    knowledge_bases = relationship("KnowledgeBase", back_populates="user", cascade="all, delete-orphan")
    knowledge_documents = relationship("KnowledgeDocument", back_populates="user", cascade="all, delete-orphan")
    scheduled_tasks = relationship("ScheduledTask", back_populates="user", cascade="all, delete-orphan")
