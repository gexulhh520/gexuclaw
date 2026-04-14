from pydantic import BaseModel, ConfigDict
from datetime import datetime
from typing import Optional, Dict, Any


class ExecutionStepBase(BaseModel):
    """执行步骤基础模型"""
    step_type: str                    # chunk / thinking / tool_start / tool_end / done / error / context_trimmed
    content: Optional[str] = None
    tool_name: Optional[str] = None
    tool_status: Optional[str] = None   # success / error / running
    metadata: Optional[Dict[str, Any]] = None
    created_at: datetime = datetime.utcnow()


class ExecutionStepCreate(ExecutionStepBase):
    """创建步骤"""
    message_id: int                   # 关联到 assistant 的 message_id


class ExecutionStepResponse(ExecutionStepBase):
    """前端返回模型"""
    id: int
    message_id: int
    sort_order: int = 0

    model_config = ConfigDict(from_attributes=True)
