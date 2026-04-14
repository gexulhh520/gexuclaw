from pydantic import BaseModel, field_validator, ConfigDict
from datetime import datetime
from typing import List, Optional, Union, Any, Dict
from schemas.agent_execution import ExecutionStepResponse


class ContentItemBase(BaseModel):
    """内容项基础模型"""
    type: str  # text / image / audio / video
    content: str
    id: Optional[Union[str, int]] = None  # 可选标识符（如 image1, audio_001 或数据库 ID）


class ContentItemCreate(ContentItemBase):
    """创建内容项"""
    pass


class ContentItemResponse(ContentItemBase):
    """响应内容项"""
    db_id: Optional[int] = None  # 数据库主键
    message_id: int
    sort_order: int = 0
    created_at: datetime
    
    model_config = {"from_attributes": True}


class ChatMessageResponse(BaseModel):
    id: int
    role: str
    content: List[ContentItemResponse]
    created_at: datetime
    steps: List[ExecutionStepResponse] = []   # 新增字段：执行步骤
    
    model_config = ConfigDict(from_attributes=True)


class ChatSessionBase(BaseModel):
    title: Optional[str] = "聊天会话"
    provider: str = "openai"
    model: Optional[str] = None


class ChatSessionCreate(ChatSessionBase):
    pass


class ChatSessionResponse(ChatSessionBase):
    id: int
    session_id: str
    user_id: int
    created_at: datetime
    updated_at: Optional[datetime]
    
    class Config:
        from_attributes = True


class MessageCreate(BaseModel):
    """创建消息（支持多模态）"""
    session_id: str
    content: Union[str, List[ContentItemCreate]]  # 兼容旧格式（字符串）和新格式（列表）
    provider: Optional[str] = "openai"
    model: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
