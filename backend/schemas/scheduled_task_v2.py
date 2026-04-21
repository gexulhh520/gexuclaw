from datetime import datetime
from typing import Optional, List, Dict, Any

from pydantic import BaseModel, Field
from schemas.scheduled_task_planner import ScheduledTaskFeasibility


class PlannerDraftQueueRequest(BaseModel):
    session_id: str
    intent_text: str
    schedule_text: str
    timezone: str = "Asia/Shanghai"
    trigger_message_id: Optional[int] = None
    goal: Optional[str] = None
    request_id: Optional[str] = None


class PlannerDraftQueueResponse(BaseModel):
    success: bool = True
    status: str = "queued"
    request_id: str
    job_id: str
    session_id: str
    queued_at: datetime = Field(default_factory=datetime.utcnow)


class ExecutionStrategyV2(BaseModel):
    goal: str
    execution_strategy: str
    tool_hints: List[str] = Field(default_factory=list)
    success_criteria: List[str] = Field(default_factory=list)
    risk_notes: List[str] = Field(default_factory=list)
    reference_steps: List[Dict[str, Any]] = Field(default_factory=list)


class ScheduledTaskDraftContentV2(BaseModel):
    title: str
    description: str
    schedule_text: str
    cron_expression: str
    timezone: str
    delivery_channels: List[str] = Field(default_factory=lambda: ["in_app"])
    strategy: ExecutionStrategyV2
    feasibility: ScheduledTaskFeasibility = Field(default_factory=ScheduledTaskFeasibility)
    retry_policy: Dict[str, Any] = Field(default_factory=dict)
    budget_policy: Dict[str, Any] = Field(default_factory=dict)
    tool_whitelist: List[str] = Field(default_factory=list)
    summary_markdown: str = ""
    raw_trace_summary: Dict[str, Any] = Field(default_factory=dict)
