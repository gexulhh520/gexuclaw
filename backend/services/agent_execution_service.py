from sqlalchemy.orm import Session
from models.agent_execution_step import AgentExecutionStep
from schemas.agent_execution import ExecutionStepCreate
from datetime import datetime
from typing import List, Optional, Dict, Any


async def save_execution_step(
    db: Session,
    message_id: int,
    step_type: str,
    content: Optional[str] = None,
    tool_name: Optional[str] = None,
    tool_status: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    sort_order: Optional[int] = None,
) -> AgentExecutionStep:
    """
    保存一次执行步骤（中间过程）
    
    Args:
        db: 数据库会话
        message_id: 关联的 assistant message ID
        step_type: 步骤类型 (thinking/acting/responding/tool_start/tool_end/chunk)
        content: 步骤内容
        tool_name: 工具名称
        tool_status: 工具执行状态
        metadata: 额外元数据
        sort_order: 排序顺序
    
    Returns:
        AgentExecutionStep: 创建的执行步骤对象
    """
    step = AgentExecutionStep(
        message_id=message_id,
        step_type=step_type,
        content=content,
        tool_name=tool_name,
        tool_status=tool_status,
        metadata=metadata or {},
        sort_order=sort_order or 0,
        created_at=datetime.utcnow(),
    )
    db.add(step)
    db.commit()
    db.refresh(step)
    return step


async def save_execution_steps_batch(
    db: Session,
    message_id: int,
    steps: List[dict]
) -> None:
    """
    批量保存多个步骤（性能更好）
    
    Args:
        db: 数据库会话
        message_id: 关联的 assistant message ID
        steps: 步骤数据列表
    """
    for i, step_data in enumerate(steps):
        step = AgentExecutionStep(
            message_id=message_id,
            step_type=step_data.get("step_type") or step_data.get("type"),
            content=step_data.get("content"),
            tool_name=step_data.get("tool_name"),
            tool_status=step_data.get("tool_status") or step_data.get("status"),
            metadata=step_data,
            sort_order=i,
        )
        db.add(step)
    db.commit()


async def get_execution_steps_by_message(
    db: Session,
    message_id: int
) -> List[AgentExecutionStep]:
    """
    获取某个消息的所有执行步骤
    
    Args:
        db: 数据库会话
        message_id: 消息 ID
    
    Returns:
        List[AgentExecutionStep]: 执行步骤列表（按 sort_order 排序）
    """
    return db.query(AgentExecutionStep).filter(
        AgentExecutionStep.message_id == message_id
    ).order_by(AgentExecutionStep.sort_order).all()
