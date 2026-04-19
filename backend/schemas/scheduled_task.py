from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field

from .scheduled_task_planner import ScheduledTaskDraftContent


class ScheduledTaskBase(BaseModel):
    title: str
    description: Optional[str] = None
    schedule_text: str
    cron_expression: str
    timezone: str
    delivery_channels: List[str] = Field(default_factory=lambda: ["in_app"])
    notification_targets_json: Dict[str, Any] = Field(default_factory=dict)


class ScheduledTaskCreate(ScheduledTaskBase):
    draft_id: int
    source_session_id: Optional[str] = None
    source_message_id: Optional[int] = None
    intent_text: str


class ScheduledTaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    schedule_text: Optional[str] = None
    cron_expression: Optional[str] = None
    timezone: Optional[str] = None
    delivery_channels: Optional[List[str]] = None
    notification_targets_json: Optional[Dict[str, Any]] = None
    status: Optional[str] = None


class ScheduledTaskRunResponse(BaseModel):
    id: int
    scheduled_task_id: int
    status: str
    run_type: str = "scheduled"
    trigger_source: Optional[str] = None
    triggered_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    execution_plan_snapshot: Dict[str, Any] = Field(default_factory=dict)
    result_summary: Optional[str] = None
    error_message: Optional[str] = None
    steps_json: List[Dict[str, Any]] = Field(default_factory=list)
    preflight_result_json: Dict[str, Any] = Field(default_factory=dict)
    notification_status_json: Dict[str, Any] = Field(default_factory=dict)
    cost_metrics_json: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ScheduledTaskResponse(ScheduledTaskBase):
    id: int
    user_id: int
    source_session_id: Optional[str] = None
    source_message_id: Optional[int] = None
    intent_text: str
    schedule_type: str
    status: str
    analysis_status: str = "draft"
    draft_summary_markdown: Optional[str] = None
    preview_status: str = "pending"
    preview_run_id: Optional[int] = None
    dedupe_key: Optional[str] = None
    notification_targets_json: Dict[str, Any] = Field(default_factory=dict)
    planner_version: str = "v1"
    draft_expires_at: Optional[datetime] = None
    plan_json: Dict[str, Any] = Field(default_factory=dict)
    raw_trace_json: Dict[str, Any] = Field(default_factory=dict)
    feasibility_json: Dict[str, Any] = Field(default_factory=dict)
    retry_policy_json: Dict[str, Any] = Field(default_factory=dict)
    budget_policy_json: Dict[str, Any] = Field(default_factory=dict)
    tool_whitelist_json: List[str] = Field(default_factory=list)
    last_run_at: Optional[datetime] = None
    next_run_at: Optional[datetime] = None
    failure_count: int = 0
    auto_pause_reason: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class ScheduledTaskDraftResponse(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    schedule_text: str
    cron_expression: str
    timezone: str
    status: str
    analysis_status: str
    summary_markdown: str = ""
    content: ScheduledTaskDraftContent
    created_at: datetime


class ScheduledTaskPreviewResponse(BaseModel):
    success: bool
    run: ScheduledTaskRunResponse
    message: str = ""
    checks: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    blockers: List[str] = Field(default_factory=list)
    suggested_fixes: List[str] = Field(default_factory=list)


class ScheduledTaskListResponse(BaseModel):
    tasks: List[ScheduledTaskResponse]
    total: int


class ScheduledTaskNotificationResponse(BaseModel):
    id: int
    scheduled_task_id: int
    scheduled_task_run_id: Optional[int] = None
    channel: str
    target: Optional[str] = None
    provider: Optional[str] = None
    provider_message_id: Optional[str] = None
    payload: Dict[str, Any] = Field(default_factory=dict)
    status: str
    error_message: Optional[str] = None
    retry_count: int = 0
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
