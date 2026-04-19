from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Boolean, Float, JSON, Text
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from .database import Base


class TurnMemory(Base):
    __tablename__ = "turn_memories"

    id = Column(Integer, primary_key=True, index=True)
    turn_id = Column(Integer, ForeignKey("chat_turns.id"), nullable=False, unique=True, index=True)
    session_id = Column(Integer, ForeignKey("chat_sessions.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    source_user_message_id = Column(Integer, ForeignKey("chat_messages.id"), nullable=True, index=True)
    source_assistant_message_id = Column(Integer, ForeignKey("chat_messages.id"), nullable=True, index=True)
    user_query = Column(Text, nullable=True)
    assistant_final = Column(Text, nullable=True)
    task_goal = Column(Text, nullable=True)
    result_summary = Column(Text, nullable=True)
    tool_trace_summary = Column(Text, nullable=True)
    successful_tools_json = Column(JSON, nullable=False, default=list)
    failed_tools_json = Column(JSON, nullable=False, default=list)
    knowledge_base_ids_json = Column(JSON, nullable=False, default=list)
    browser_used = Column(Boolean, nullable=False, default=False)
    is_task_candidate = Column(Boolean, nullable=False, default=False)
    candidate_score = Column(Float, nullable=False, default=0.0)
    tags_json = Column(JSON, nullable=False, default=list)
    embedding_status = Column(String(30), nullable=False, default="pending", index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    turn = relationship("ChatTurn", back_populates="turn_memory", foreign_keys=[turn_id])
    session = relationship("ChatSession", foreign_keys=[session_id])
    user = relationship("User", back_populates="turn_memories", foreign_keys=[user_id])
