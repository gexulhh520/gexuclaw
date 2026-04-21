from typing import Any, Dict, List, Optional, TypedDict
from datetime import datetime

from langgraph.graph import StateGraph, END
from langchain_core.messages import SystemMessage, HumanMessage

from llm.client import llm_client_instance
from tools import get_tool_runtime
from agents.executor import run_tool, get_available_tools, prepare_tool_call_arguments
from schemas.scheduled_task_v2 import ExecutionStrategyV2


class TaskExecutorState(TypedDict):
    messages: List[Dict[str, Any]]
    browser_session_id: Optional[str]
    user_id: int
    knowledge_base_ids: List[int]
    tool_whitelist: List[str]
    max_steps: int
    current_step: int
    
    # 策略与目标
    strategy: ExecutionStrategyV2
    
    # 节点间通信
    llm_response: Optional[Dict[str, Any]]
    _node_events: List[Dict[str, Any]]


class TaskExecutorAgentV2:
    """
    目标驱动执行的 V2 Agent。
    不再硬编码步骤重放，而是根据 Planner 提炼的 goal 和 strategy，
    在一个白名单限制的循环内 thinking -> acting -> context_manager。
    """

    def __init__(self, provider: str = "openai", model: str = None, session_id: str = None):
        self.provider = provider
        self.model = model
        self.session_id = session_id
        self.graph = self._build_graph()

    def _build_graph(self):
        workflow = StateGraph(TaskExecutorState)
        workflow.add_node("thinking", self._thinking_node)
        workflow.add_node("acting", self._acting_node)
        workflow.add_node("context_manager_node", self._context_manager_node)
        workflow.add_node("responding", self._responding_node)

        workflow.set_entry_point("thinking")

        workflow.add_conditional_edges(
            "thinking",
            self._should_continue,
            {
                "continue": "acting",
                "end": "responding",
            }
        )

        workflow.add_edge("acting", "context_manager_node")
        workflow.add_edge("context_manager_node", "thinking")
        workflow.add_edge("responding", END)

        return workflow.compile()

    def _should_continue(self, state: TaskExecutorState):
        resp = state.get("llm_response")
        
        # 防止死循环
        if state.get("current_step", 0) >= state.get("max_steps", 10):
            return "end"

        if resp and resp.get("tool_calls"):
            # 记录 message
            formatted_tool_calls = []
            for i, tc in enumerate(resp.get("tool_calls")):
                formatted_tc = {
                    "id": tc.get("id") or tc.get("tool_call_id") or f"call_{i}",
                    "type": "function",
                    "function": {
                        "name": tc.get("function", {}).get("name", ""),
                        "arguments": tc.get("function", {}).get("arguments", "{}")
                    }
                }
                formatted_tool_calls.append(formatted_tc)

            assistant_msg = {
                "role": "assistant",
                "content": resp.get("content", ""),
                "tool_calls": formatted_tool_calls
            }
            if resp.get("reasoning_content"):
                assistant_msg["reasoning_content"] = resp.get("reasoning_content")
            state["messages"].append(assistant_msg)
            return "continue"
        
        return "end"

    async def _thinking_node(self, state: TaskExecutorState):
        state.setdefault("current_step", 0)
        state["current_step"] += 1
        
        # 过滤白名单工具，且禁用 scheduled_task__plan_draft
        all_tools = get_available_tools()
        whitelist = set(state.get("tool_whitelist", []))
        
        allowed_tools = []
        for tool in all_tools:
            name = tool.get("function", {}).get("name", "")
            if name == "scheduled_task__plan_draft":
                continue
            if name in whitelist:
                allowed_tools.append(tool)
        
        # 如果系统工具不在白名单但也需要（比如 planner），这里以 whitelist 为主。
        if not allowed_tools:
            # 兜底
            allowed_tools = all_tools

        strategy: ExecutionStrategyV2 = state.get("strategy")
        
        system_prompt = (
            "你是一个目标驱动的任务执行 Agent (TaskExecutor V2)。\n"
            f"你的核心目标：{strategy.goal if strategy else '完成用户指定的定时任务'}\n"
            f"推荐执行策略：{strategy.execution_strategy if strategy else '根据需要调用工具'}\n"
            f"风险提示：{', '.join(strategy.risk_notes) if strategy and strategy.risk_notes else '无'}\n"
            "请思考当前环境和已完成的步骤，决定下一步调用什么工具，或者判定任务已完成结束。\n"
            "不要解释，只通过 function calling 执行操作，完成目标后返回成功结论。"
        )

        resp = await llm_client_instance.chat(
            state["messages"],
            provider=self.provider,
            model=self.model,
            tools=allowed_tools,
            system_prompt=system_prompt
        )

        state["llm_response"] = resp
        return state

    async def _acting_node(self, state: TaskExecutorState):
        resp = state["llm_response"]
        tool_calls = resp.get("tool_calls", [])
        
        if tool_calls:
            # 实际调用工具
            tool_messages = await run_tool(
                tool_calls,
                browser_session_id=state.get("browser_session_id"),
                user_id=state.get("user_id"),
                knowledge_base_ids=state.get("knowledge_base_ids", [])
            )
            for tm in tool_messages:
                state["messages"].append(tm)
                
            state.setdefault("_node_events", []).extend(tool_messages)
            
        return state

    async def _context_manager_node(self, state: TaskExecutorState):
        # TODO: 可以加入总结或者裁剪历史的逻辑
        return state

    async def _responding_node(self, state: TaskExecutorState):
        # 最终回答，不需要 tool
        return state

    async def execute(self, state: TaskExecutorState) -> Dict[str, Any]:
        result = await self.graph.ainvoke(state)
        return result
