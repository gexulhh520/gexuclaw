from pydantic import BaseModel
from datetime import datetime
from typing import List, Optional


class ChatMessageResponse(BaseModel):
    id: int
    role: str
    content: str
    created_at: datetime
    
    class Config:
        from_attributes = True


class ChatSessionBase(BaseModel):
    title: Optional[str] = "新会话"
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
    # 不包含 messages，避免 N+1 查询
    
    class Config:
        from_attributes = True
