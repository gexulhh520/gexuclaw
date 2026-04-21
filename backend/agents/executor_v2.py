import json
import uuid
from datetime import datetime
from typing import Any

from agents.executor import AgentExecutor, SCHEDULED_TASK_TOOL_NAME
from core.config import get_settings


class AgentExecutorV2(AgentExecutor):
    """
    V2 主图执行器：
    - 完全复用 AgentExecutor 的 LangGraph 核心编排（thinking -> acting -> context_manager -> responding）。
    - 仅重写 _build_graph，将 scheduled_task_subgraph 节点替换为异步投递节点 (async_dispatch_node)。
    """

    def _build_graph(self, checkpointer=None):
        from langgraph.graph import StateGraph, END
        from agents.state import AgentState
        from agents.context_manager import context_manager_node

        workflow = StateGraph(AgentState)

        workflow.add_node("thinking", self._thinking_node)
        workflow.add_node("async_dispatch_node", self._async_dispatch_node)
        workflow.add_node("acting", self._acting_node)
        workflow.add_node("context_manager_node", context_manager_node)
        workflow.add_node("responding", self._responding_node)

        workflow.set_entry_point("thinking")

        # 条件分支
        workflow.add_conditional_edges(
            "thinking",
            self._should_continue_v2,
            {
                "continue": "acting",
                "async_dispatch_node": "async_dispatch_node",
                "end": "responding",
            }
        )

        workflow.add_edge("acting", "context_manager_node")
        workflow.add_edge("context_manager_node", "thinking")   # 循环继续
        workflow.add_edge("async_dispatch_node", "responding")
        workflow.add_edge("responding", END)

        return workflow.compile(checkpointer=checkpointer)

    def _should_continue_v2(self, state):
        route = self._should_continue(state)
        if route == "scheduled_task_subgraph":
            return "async_dispatch_node"
        return route

    async def _async_dispatch_node(self, state):
        route_decision = state.get("scheduled_task_route") or {}
        state.setdefault("_node_events", [])
        settings = get_settings()

        request_id = route_decision.get("request_id") or str(uuid.uuid4())
        session_id = state.get("session_id") or self.session_id

        if not settings.SCHEDULED_TASK_V2_PLANNER_DISPATCH_ENABLED:
            state["_node_events"].append(
                {
                    "type": "thinking_end",
                    "content": "A/B 验证模式：已识别定时任务意图，但暂未投递后台草案任务。",
                    "timestamp": datetime.utcnow().isoformat(),
                }
            )
            resp = state.get("llm_response") or {}
            resp["content"] = "A/B 验证模式：已识别定时任务意图，但暂未投递后台草案任务。"
            state["llm_response"] = resp
            state["scheduled_task_route"] = None
            return state

        # 异步排队草案生成任务
        from workers.planner_jobs import generate_planner_draft_task

        job = generate_planner_draft_task.delay(
            session_id=session_id,
            user_id=self.user_id,
            intent_text=route_decision.get("intent_text") or "",
            schedule_text=route_decision.get("schedule_text") or "",
            timezone=route_decision.get("timezone") or "Asia/Shanghai",
            trigger_message_id=route_decision.get("trigger_message_id"),
            goal=route_decision.get("goal"),
            provider=self.provider,
            model=self.model,
            request_id=request_id,
        )

        tool_call_id = route_decision.get("tool_call_id") or self._resolve_scheduled_tool_call_id(state)
        if tool_call_id:
            tool_message = {
                "tool_call_id": tool_call_id,
                "role": "tool",
                "name": SCHEDULED_TASK_TOOL_NAME,
                "tool_name": SCHEDULED_TASK_TOOL_NAME,
                "content": json.dumps(
                    {
                        "status": "queued",
                        "request_id": request_id,
                        "job_id": job.id,
                    },
                    ensure_ascii=False,
                ),
            }
            state["messages"] = list(state.get("messages", [])) + [tool_message]

        state["_node_events"].append(
            {
                "type": "planner_draft_queued",
                "request_id": request_id,
                "job_id": job.id,
                "intent_text": route_decision.get("intent_text") or "",
                "schedule_text": route_decision.get("schedule_text") or "",
                "timestamp": datetime.utcnow().isoformat(),
            }
        )
        
        state["_node_events"].append(
            {
                "type": "thinking_end",
                "content": "我已在后台开始生成定时任务草案，生成完成后会通知你，你可以继续聊天。",
                "timestamp": datetime.utcnow().isoformat(),
            }
        )

        # 保持与原逻辑一致
        resp = state.get("llm_response") or {}
        resp["content"] = "我已在后台开始生成定时任务草案，生成完成后会通知你。"
        state["llm_response"] = resp
        state["scheduled_task_route"] = None
        return state
