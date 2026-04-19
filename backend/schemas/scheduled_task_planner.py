from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class ScheduledTaskExecutionStep(BaseModel):
    step_index: int
    title: str
    tool_name: Optional[str] = None
    action: str
    params: Dict[str, Any] = Field(default_factory=dict)
    success_condition: Optional[str] = None
    failure_handler: Optional[str] = None


class ScheduledTaskFeasibility(BaseModel):
    is_feasible: bool = True
    estimated_success_rate: Optional[float] = None
    estimated_cost: Optional[str] = None
    risks: List[str] = Field(default_factory=list)
    feasibility_reasons: List[str] = Field(default_factory=list)
    required_tools: List[str] = Field(default_factory=list)
    required_permissions: List[str] = Field(default_factory=list)
    preflight_checks: List[str] = Field(default_factory=list)


class ScheduledTaskDraftContent(BaseModel):
    title: str
    description: str
    schedule_text: str
    cron_expression: str
    timezone: str
    delivery_channels: List[str] = Field(default_factory=lambda: ["in_app"])
    execution_steps: List[ScheduledTaskExecutionStep] = Field(default_factory=list)
    success_criteria: List[str] = Field(default_factory=list)
    failure_handlers: List[str] = Field(default_factory=list)
    feasibility: ScheduledTaskFeasibility = Field(default_factory=ScheduledTaskFeasibility)
    retry_policy: Dict[str, Any] = Field(default_factory=dict)
    budget_policy: Dict[str, Any] = Field(default_factory=dict)
    tool_whitelist: List[str] = Field(default_factory=list)
    summary_markdown: str = ""
    raw_trace_summary: Dict[str, Any] = Field(default_factory=dict)


class ScheduledTaskDraftRequest(BaseModel):
    session_id: str
    intent_text: str
    trigger_message_id: Optional[int] = None
    schedule_text: Optional[str] = None
    timezone: Optional[str] = None


class ScheduledTaskDraftPreviewRequest(BaseModel):
    draft_id: int


class ScheduledTaskDraftUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    schedule_text: Optional[str] = None
    cron_expression: Optional[str] = None
    timezone: Optional[str] = None
    delivery_channels: Optional[List[str]] = None
