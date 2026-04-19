import re
from typing import Any, Dict, Optional, TypedDict

from langgraph.graph import END, StateGraph

from models.database import SessionLocal
from services.scheduled_task_planner_service import scheduled_task_planner_service


class ScheduledTaskSubgraphState(TypedDict):
    session_id: str
    user_id: int
    provider: Optional[str]
    model: Optional[str]
    route_decision: Dict[str, Any]
    task_id: Optional[int]
    draft_payload: Optional[Dict[str, Any]]


class ScheduledTaskPlannerSubgraph:
    def __init__(self):
        self.graph = self._build_graph()

    def _build_graph(self):
        workflow = StateGraph(ScheduledTaskSubgraphState)
        workflow.add_node("normalize_intent", self._normalize_intent_node)
        workflow.add_node("build_draft", self._build_draft_node)
        workflow.add_node("finalize", self._finalize_node)
        workflow.set_entry_point("normalize_intent")
        workflow.add_edge("normalize_intent", "build_draft")
        workflow.add_edge("build_draft", "finalize")
        workflow.add_edge("finalize", END)
        return workflow.compile()

    async def _normalize_intent_node(self, state: ScheduledTaskSubgraphState):
        route_decision = state.get("route_decision") or {}
        intent_text = (route_decision.get("intent_text") or "").strip()
        schedule_text = (route_decision.get("schedule_text") or "").strip()

        if not intent_text:
            intent_text = "将当前流程转为可重复执行的定时任务"
        if not schedule_text:
            schedule_text = self._extract_schedule_from_intent(intent_text)

        route_decision["intent_text"] = intent_text
        route_decision["schedule_text"] = schedule_text
        state["route_decision"] = route_decision
        return state

    async def _build_draft_node(self, state: ScheduledTaskSubgraphState):
        route_decision = state.get("route_decision") or {}
        db = SessionLocal()
        try:
            task, draft = await scheduled_task_planner_service.build_draft(
                db=db,
                user_id=state["user_id"],
                session_id=state["session_id"],
                intent_text=route_decision.get("intent_text") or "",
                schedule_text=route_decision.get("schedule_text"),
                timezone=route_decision.get("timezone"),
                provider=state.get("provider"),
                model=state.get("model"),
            )
            state["task_id"] = task.id
            state["draft_payload"] = {
                "id": task.id,
                "title": task.title,
                "summary_markdown": task.draft_summary_markdown or draft.summary_markdown,
                "intent_text": task.intent_text,
                "analysis_status": task.analysis_status,
                "schedule_text": task.schedule_text,
                "timezone": task.timezone,
            }
            return state
        finally:
            db.close()

    async def _finalize_node(self, state: ScheduledTaskSubgraphState):
        return state

    async def ainvoke(self, state: ScheduledTaskSubgraphState) -> ScheduledTaskSubgraphState:
        return await self.graph.ainvoke(state)

    def _extract_schedule_from_intent(self, intent_text: str) -> str:
        match = re.search(r"(每天.*|每周.*|每月.*|工作日.*|今天.*|明天.*)", intent_text)
        return match.group(1) if match else "每天 09:00"


scheduled_task_planner_subgraph = ScheduledTaskPlannerSubgraph()
