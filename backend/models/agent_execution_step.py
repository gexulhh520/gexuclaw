from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, JSON
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from .database import Base


class AgentExecutionStep(Base):
    """Agent 执行步骤记录"""
    __tablename__ = "agent_execution_steps"

    id = Column(Integer, primary_key=True, index=True)
    message_id = Column(Integer, ForeignKey("chat_messages.id"), nullable=False)  # 关联的 assistant message
    step_type = Column(String(50), nullable=False)  # thinking/acting/responding/tool_start/tool_end/chunk
    content = Column(Text, nullable=True)  # 步骤内容
    tool_name = Column(String(100), nullable=True)  # 工具名称（如果是工具调用）
    tool_status = Column(String(20), nullable=True)  # 工具执行状态（success/error）
    extra_data = Column(JSON, nullable=True)  # JSON 格式的额外元数据
    sort_order = Column(Integer, default=0)  # 排序顺序
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # 关联消息
    message = relationship("ChatMessage", backref="execution_steps")
