from sqlalchemy import (
    Column,
    Integer,
    String,
    DateTime,
    ForeignKey,
    Text,
    JSON,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from .database import Base


class ScheduledTask(Base):
    __tablename__ = "scheduled_tasks"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    source_session_id = Column(String(255), nullable=True, index=True)
    source_message_id = Column(Integer, nullable=True, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    intent_text = Column(Text, nullable=False)
    schedule_type = Column(String(50), nullable=False, default="natural_language")
    schedule_text = Column(String(255), nullable=False)
    cron_expression = Column(String(100), nullable=False)
    timezone = Column(String(100), nullable=False, default="Asia/Shanghai")
    status = Column(String(30), nullable=False, default="draft", index=True)
    analysis_status = Column(String(30), nullable=False, default="draft")
    draft_summary_markdown = Column(Text, nullable=True)
    preview_status = Column(String(30), nullable=False, default="pending")
    preview_run_id = Column(Integer, nullable=True, index=True)
    dedupe_key = Column(String(255), nullable=True, index=True)
    notification_targets_json = Column(JSON, nullable=False, default=dict)
    planner_version = Column(String(50), nullable=False, default="v1")
    draft_expires_at = Column(DateTime(timezone=True), nullable=True)
    delivery_channels = Column(JSON, nullable=False, default=list)
    plan_json = Column(JSON, nullable=False, default=dict)
    raw_trace_json = Column(JSON, nullable=False, default=dict)
    feasibility_json = Column(JSON, nullable=False, default=dict)
    retry_policy_json = Column(JSON, nullable=False, default=dict)
    budget_policy_json = Column(JSON, nullable=False, default=dict)
    tool_whitelist_json = Column(JSON, nullable=False, default=list)
    last_run_at = Column(DateTime(timezone=True), nullable=True)
    next_run_at = Column(DateTime(timezone=True), nullable=True, index=True)
    failure_count = Column(Integer, nullable=False, default=0)
    auto_pause_reason = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user = relationship("User", back_populates="scheduled_tasks")
    runs = relationship("ScheduledTaskRun", back_populates="task", cascade="all, delete-orphan")
    notifications = relationship("ScheduledTaskNotification", back_populates="task", cascade="all, delete-orphan")


class ScheduledTaskRun(Base):
    __tablename__ = "scheduled_task_runs"

    id = Column(Integer, primary_key=True, index=True)
    scheduled_task_id = Column(Integer, ForeignKey("scheduled_tasks.id"), nullable=False, index=True)
    status = Column(String(30), nullable=False, default="queued", index=True)
    triggered_at = Column(DateTime(timezone=True), nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    run_type = Column(String(30), nullable=False, default="scheduled")
    trigger_source = Column(String(50), nullable=True)
    execution_plan_snapshot = Column(JSON, nullable=False, default=dict)
    result_summary = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)
    steps_json = Column(JSON, nullable=False, default=list)
    preflight_result_json = Column(JSON, nullable=False, default=dict)
    notification_status_json = Column(JSON, nullable=False, default=dict)
    cost_metrics_json = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    task = relationship("ScheduledTask", back_populates="runs")


class ScheduledTaskNotification(Base):
    __tablename__ = "scheduled_task_notifications"

    id = Column(Integer, primary_key=True, index=True)
    scheduled_task_id = Column(Integer, ForeignKey("scheduled_tasks.id"), nullable=False, index=True)
    scheduled_task_run_id = Column(Integer, ForeignKey("scheduled_task_runs.id"), nullable=True, index=True)
    channel = Column(String(50), nullable=False, default="in_app")
    target = Column(String(255), nullable=True)
    provider = Column(String(50), nullable=True)
    provider_message_id = Column(String(255), nullable=True)
    payload = Column(JSON, nullable=False, default=dict)
    status = Column(String(30), nullable=False, default="pending")
    error_message = Column(Text, nullable=True)
    retry_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    task = relationship("ScheduledTask", back_populates="notifications")
