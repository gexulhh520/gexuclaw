from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from .database import Base


class ChatTurn(Base):
    __tablename__ = "chat_turns"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("chat_sessions.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    turn_index = Column(Integer, nullable=False, index=True)
    status = Column(String(30), nullable=False, default="running", index=True)
    trigger_type = Column(String(30), nullable=False, default="normal")
    source_user_message_id = Column(Integer, ForeignKey("chat_messages.id"), nullable=True, index=True)
    assistant_message_id = Column(Integer, ForeignKey("chat_messages.id"), nullable=True, index=True)
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    finished_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    session = relationship("ChatSession", back_populates="turns", foreign_keys=[session_id])
    user = relationship("User", back_populates="turns")
    messages = relationship("ChatMessage", back_populates="turn", foreign_keys="ChatMessage.turn_id")
    execution_steps = relationship("AgentExecutionStep", back_populates="turn", foreign_keys="AgentExecutionStep.turn_id")
    turn_memory = relationship("TurnMemory", back_populates="turn", uselist=False, cascade="all, delete-orphan")
    source_user_message = relationship("ChatMessage", foreign_keys=[source_user_message_id], post_update=True)
    assistant_message = relationship("ChatMessage", foreign_keys=[assistant_message_id], post_update=True)
