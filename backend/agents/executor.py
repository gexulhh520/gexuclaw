from typing import List, Dict, Any, AsyncGenerator, Optional
from datetime import datetime
import inspect
import json
import re
import sys
from urllib.parse import urlparse
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver   # 测试/降级用（支持异步）

try:
    # Provided by langgraph-checkpoint-postgres
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver  # type: ignore
except Exception:
    AsyncPostgresSaver = None

from llm.client import llm_client_instance
from tools import get_tool_runtime, ToolResult
from agents.state import AgentState
from agents.context_manager import context_manager_node
from agents.scheduled_task_planner_subgraph import scheduled_task_planner_subgraph
from core.config import get_settings

SCHEDULED_TASK_TOOL_NAME = "scheduled_task__plan_draft"


def _convert_multimodal_to_text(messages: List[Dict]) -> List[Dict]:
    """
    只处理 role=user 且 content 为多模态数组的消息，合并文本描述
    其他消息保持不变
    """
    for msg in messages:
        role = msg.get("role")
        content = msg.get("content")

        # 只处理 user 角色的多模态内容
        if role != "user" or not isinstance(content, list):
            continue

        has_multimodal = any(item.get("type") in ["image", "audio", "document"] for item in content)
        if not has_multimodal:
            continue

        text_parts = []
        resources = []

        for item in content:
            item_type = item.get("type")
            item_content = item.get("content", "")

            if item_type == "text":
                text_parts.append(item_content)
            elif item_type == "image":
                resources.append(f"[Image Resource: {item_content}]")
            elif item_type == "audio":
                resources.append(f"[Audio Resource: {item_content}]")
            elif item_type == "document":
                resources.append(f"[knowledge Document : {item_content}]")

        merged_text = "\n".join(text_parts)
        if resources:
            merged_text += "\n\n" + "\n".join(resources)

        if text_parts:
            for i, item in enumerate(content):
                if item.get("type") == "text":
                    content[i] = {"type": "text", "content": merged_text}
                    break
        try:
            if bool(getattr(get_settings(), "DEBUG", False)):
                print("[Agent Debug] merged multimodal text len=", len(merged_text))
        except Exception:
            pass
    return messages


def _smart_truncate(data: Any, max_length: int = 3000) -> str:
    """
    格式化工具返回数据
    不再截断 base64 数据，保留完整内容
    """
    if data is None:
        return "None"
    
    # 如果是字典，处理每个字段
    if isinstance(data, dict):
        result = {}
        for key, value in data.items():
            # 跳过内部使用的完整数据字段
            if key.startswith('_'):
                continue
            result[key] = value
        return str(result)
    
    # 直接返回字符串表示
    return str(data)


# ====== 工具系统 ======
async def run_tool(
    tool_calls: List[Dict[str, Any]],
    browser_session_id: str = None,
    user_id: int = None,
    knowledge_base_ids: Optional[List[int]] = None,
) -> List[Dict[str, Any]]:
    """
    执行工具调用（已优化，适配新 LangGraph + trim/summarize）
    
    tool_calls 格式：
    [
        {
            "id": "call_xxx",
            "type": "function",
            "function": {
                "name": "文件系统__write_file",
                "arguments": '{"path": "test.txt", "content": "Hello"}'
            }
        }
    ]
    
    返回：
    [
        {
            "tool_call_id": "call_xxx",
            "role": "tool",
            "content": "执行结果...",
            "name": "filesystem__write_file",
            "tool_name": "filesystem__write_file"
        }
    ]
    
    Args:
        tool_calls: 工具调用列表
        browser_session_id: 可选，浏览器会话 ID（自动注入到浏览器操作）
        user_id: 可选，当前登录用户 ID（自动注入到知识库工具）
        knowledge_base_ids: 可选，当前会话允许访问的知识库 ID 列表
    """
    tool_runtime = get_tool_runtime()
    tool_messages = []

    try:
        debug_enabled = bool(getattr(get_settings(), "DEBUG", False))
    except Exception:
        debug_enabled = False

    for call in tool_calls:
        try:
            # 统一 tool_call_id 生成逻辑
            tool_call_id = (
                call.get("id")
                or call.get("tool_call_id")
                or f"call_{id(call)}_{hash(str(call)) % 10000}"
            )

            function_info = call.get("function", {})
            name = function_info.get("name", "")
            _, arguments = prepare_tool_call_arguments(
                call,
                browser_session_id=browser_session_id,
                user_id=user_id,
                knowledge_base_ids=knowledge_base_ids,
            )

            if debug_enabled:
                print(f"[Tool Debug] Executing: {name} | Args: {arguments}")

            result = await tool_runtime.execute_by_name_async(name, arguments)

            # 格式化内容（保留智能截断逻辑）
            if result.success:
                content = f"工具 [{name}] 执行成功：{_smart_truncate(result.data)}"
            else:
                content = f"工具 [{name}] 执行失败：{_smart_truncate(result.error)}"

            # ==================== 关键优化点 ====================
            tool_messages.append({
                "tool_call_id": tool_call_id,      # LangGraph 推荐字段
                "role": "tool",                    # 必须是 "tool"
                "content": content,
                "name": name,                      # 新增：工具名称，便于 trim/summarize 识别
                "tool_name": name,                 # 额外字段，方便调试和前端展示
            })

        except Exception as e:
            tool_messages.append({
                "tool_call_id": call.get("id") or f"call_error_{id(call)}",
                "role": "tool",
                "content": f"工具调用异常：{str(e)}",
                "name": name if 'name' in locals() else "unknown",
                "tool_name": name if 'name' in locals() else "unknown",
            })

    return tool_messages


def prepare_tool_call_arguments(
    call: Dict[str, Any],
    browser_session_id: Optional[str] = None,
    user_id: Optional[int] = None,
    knowledge_base_ids: Optional[List[int]] = None,
) -> tuple[Dict[str, Any], Dict[str, Any]]:
    function_info = call.get("function", {}) or {}
    name = function_info.get("name", "")
    arguments_raw = function_info.get("arguments", "{}")

    if isinstance(arguments_raw, str):
        try:
            raw_arguments = json.loads(arguments_raw)
        except Exception:
            raw_arguments = {}
    elif isinstance(arguments_raw, dict):
        raw_arguments = dict(arguments_raw)
    else:
        raw_arguments = {}

    executed_arguments = dict(raw_arguments)

    # 浏览器工具自动注入运行时参数
    if browser_session_id and name.startswith("browser__"):
        if "launch_browser" in name:
            executed_arguments.setdefault("browser_session_id", browser_session_id)
        elif any(op in name for op in ["navigate", "click", "fill", "type", "get_text"]):
            executed_arguments.setdefault("session_id", browser_session_id)

    # 知识库工具自动注入上下文
    if user_id and name.startswith("knowledge__"):
        executed_arguments.setdefault("user_id", user_id)
        if knowledge_base_ids:
            executed_arguments.setdefault("knowledge_base_ids", knowledge_base_ids)

    return raw_arguments, executed_arguments


def get_available_tools() -> List[Dict[str, Any]]:
    """获取所有可用的工具定义，用于 LLM function calling"""
    tool_runtime = get_tool_runtime()
    tools = tool_runtime.get_all_operations()
    try:
        if bool(getattr(get_settings(), "DEBUG", False)):
            print(f"[Tool Debug] Tool runtime categories: {list(tool_runtime.tools.keys())}")
            print(f"[Tool Debug] Available tools count: {len(tools)}")
    except Exception:
        pass
    return tools


# ====== Agent Executor ======
class AgentExecutor:
    provider: str = "openai"
    model: str = None
    browser_session_id: str = None
    user_id: int = None
    knowledge_base_ids: List[int] = []

    def __init__(
        self,
        provider: str = "openai",
        model: str = None,
        browser_session_id: str = None,
        system_prompt=None,
        user_id: int = None,
        knowledge_base_ids: Optional[List[int]] = None,
        session_id: Optional[str] = None,
    ):
        self.provider = provider
        self.model = model
        self.browser_session_id = browser_session_id
        self.system_prompt = system_prompt  # 新增：存储系统提示词
        self.user_id = user_id  # 当前登录用户 ID
        self.knowledge_base_ids = knowledge_base_ids or []
        self.session_id = session_id

        # Default to in-memory so graph compilation always succeeds; execute_stream() may
        # switch to a persistent Postgres checkpointer at runtime (AsyncPostgresSaver.from_conn_string
        # is typically an async context manager).
        self.checkpointer = MemorySaver()
        self.graph = self._build_graph(checkpointer=self.checkpointer)

    def _get_checkpoint_conn_string(self) -> str | None:
        settings = get_settings()
        conn_string = getattr(settings, "CHECKPOINT_DATABASE_URL", None)
        if not conn_string or not isinstance(conn_string, str):
            return None

        # AsyncPostgresSaver / psycopg expects either:
        # - A PostgreSQL URI: postgresql://user:pass@host:port/dbname
        # - Or a conninfo string: "host=... dbname=... user=... password=..."
        #
        # The "+driver" form (e.g. "postgresql+psycopg://") is a SQLAlchemy URL and will
        # fail psycopg parsing with "missing '=' ...". Normalize those back to a URI.
        if conn_string.startswith("postgresql+"):
            # Keep everything after "postgresql+" and the driver name, replacing with "postgresql://"
            # Example: postgresql+psycopg://u:p@h:5432/db -> postgresql://u:p@h:5432/db
            try:
                _, rest = conn_string.split("+", 1)
                if "://" in rest:
                    return "postgresql://" + rest.split("://", 1)[1]
            except Exception:
                return None

        return conn_string

    def _redact_conn_string(self, conn_string: str) -> str:
        # Avoid leaking credentials into logs; show only scheme/host/port/dbname.
        try:
            parsed = urlparse(conn_string)
            host = parsed.hostname or ""
            port = f":{parsed.port}" if parsed.port else ""
            dbname = (parsed.path or "").lstrip("/")
            scheme = parsed.scheme or "postgresql"
            if host or dbname:
                return f"{scheme}://{host}{port}/{dbname}"
        except Exception:
            pass
        return "<unparseable-conn-string>"

    # ====== Graph 构建 ======
    def _build_graph(self, checkpointer=None):

        workflow = StateGraph(AgentState)

        workflow.add_node("thinking", self._thinking_node)
        workflow.add_node("scheduled_task_subgraph", self._scheduled_task_subgraph_node)
        workflow.add_node("acting", self._acting_node)
        workflow.add_node("context_manager_node", context_manager_node)
        workflow.add_node("responding", self._responding_node)

        workflow.set_entry_point("thinking")

        # 条件分支
        workflow.add_conditional_edges(
            "thinking",
            self._should_continue,
            {
                "continue": "acting",
                "scheduled_task_subgraph": "scheduled_task_subgraph",
                "end": "responding",
            }
        )

        workflow.add_edge("acting", "context_manager_node")
        workflow.add_edge("context_manager_node", "thinking")   # 循环继续
        workflow.add_edge("scheduled_task_subgraph", "responding")
        workflow.add_edge("responding", END)

        return workflow.compile(checkpointer=checkpointer)

    # ====== 判断是否继续 ======
    def _should_continue(self, state: AgentState):

        resp = state.get("llm_response")

        if resp and resp.get("tool_calls"):
           tool_calls = resp.get("tool_calls")
            # 写回上下文：assistant 消息（包含 tool_calls）
            # Kimi K2 需要 reasoning_content 字段
            # 确保 tool_calls 格式正确（id 字段必须存在）
           if tool_calls:
                formatted_tool_calls = []
                for i, tc in enumerate(tool_calls):
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
                # 如果有 reasoning_content，也加上（Kimi K2 需要）
                if resp.get("reasoning_content"):
                    assistant_msg["reasoning_content"] = resp.get("reasoning_content")
                print(f"[Agent Debug] assistant_msg = {assistant_msg}")
                state["messages"].append(assistant_msg)
                # 注入 thinking_ing 事件
                state.setdefault("_node_events", [])
                # 拼接思考内容和工具调用信息
                tool_calls_info = "\n".join([
                    f"调用工具: {tc['function']['name']}，参数: {tc['function']['arguments']}"
                    for tc in formatted_tool_calls
                ])
                thinking_content = resp.get("content", "") + "\n" + resp.get("reasoning_content", "") + "\n" + tool_calls_info
                state["_node_events"].append({
                    "type": "thinking_ing",
                    "content": thinking_content,
                    "timestamp": datetime.utcnow().isoformat()
                })

                scheduled_task_route = self._extract_scheduled_task_route(formatted_tool_calls)
                if scheduled_task_route:
                    state["scheduled_task_route"] = scheduled_task_route
                    has_normal_tool_calls = any(
                        not self._is_scheduled_task_tool_call(tc) for tc in formatted_tool_calls
                    )
                    if not has_normal_tool_calls:
                        return "scheduled_task_subgraph"
           return "continue"
        if state.get("scheduled_task_route"):
            return "scheduled_task_subgraph"
        return "end"

    # ====== thinking：LLM 决策 ======
    async def _thinking_node(self, state: AgentState):

        # # 方案 B: 注入 thinking_start 事件
        # state.setdefault("_node_events", [])
        # state["_node_events"].append({
        #     "type": "thinking_start",
        #     "timestamp": datetime.utcnow().isoformat()
        # })

        #messages = state["messages"]

        # Convert multimodal messages to plain text description
        text_messages = state["messages"]

        # 调试日志：打印发送给 LLM 的消息
        # print(f"[Agent Debug] === 发送给 LLM 的消息 ({len(text_messages)} 条) ===")
        # for i, msg in enumerate(text_messages):
        #     print(f"[Agent Debug] [{i}] role={msg.get('role')}")
        #     print(f"[Agent Debug] [{i}] content={msg.get('content')}")
        #     print(f"[Agent Debug] [{i}] reasoning_content={msg.get('reasoning_content')}")
        #     if msg.get('tool_calls'):
        #         print(f"[Agent Debug] [{i}] tool_calls={msg.get('tool_calls')}")
        #     if msg.get('tool_call_id'):
        #         print(f"[Agent Debug] [{i}] tool_call_id={msg.get('tool_call_id')}")
        # print(f"[Agent Debug] === 消息打印结束 ===")

        # 获取可用工具并传递给 LLM
        tools = get_available_tools()
        #调试是否拿到工具
        #print(f"[Agent Debug] Available Tools: {tools}")

        resp = await llm_client_instance.chat(
            text_messages,  # Use converted plain text messages
            provider=self.provider,
            model=self.model,  # 传入动态模型
            tools=tools if tools else None,
            system_prompt=self.system_prompt  # 新增：传递系统提示词
        )

        # 调试日志
        #print(f"[Agent Debug] LLM Response: {resp}")
        #print(f"[Agent Debug] Content: {resp.get('content')}")
        #print(f"[Agent Debug] Tool Calls: {resp.get('tool_calls')}")

        state["llm_response"] = resp

        return state

    async def _scheduled_task_subgraph_node(self, state: AgentState):
        route_decision = state.get("scheduled_task_route") or {}
        result = await scheduled_task_planner_subgraph.ainvoke(
            {
                "session_id": state.get("session_id") or self.session_id or "",
                "user_id": self.user_id,
                "provider": self.provider,
                "model": self.model,
                "route_decision": route_decision,
                "task_id": None,
                "draft_payload": None,
            }
        )
        draft_payload = result.get("draft_payload") or {}
        state["scheduled_task_draft"] = draft_payload
        state.setdefault("_node_events", [])
        tool_call_id = route_decision.get("tool_call_id") or self._resolve_scheduled_tool_call_id(state)
        if tool_call_id:
            tool_message = {
                "tool_call_id": tool_call_id,
                "role": "tool",
                "name": SCHEDULED_TASK_TOOL_NAME,
                "tool_name": SCHEDULED_TASK_TOOL_NAME,
                "content": json.dumps(
                    {
                        "status": "success",
                        "draft_id": draft_payload.get("id"),
                        "draft_title": draft_payload.get("title"),
                        "analysis_status": draft_payload.get("analysis_status") or "draft",
                    },
                    ensure_ascii=False,
                ),
            }
            # 用新列表回写，确保 LangGraph/Checkpoint 识别到 messages 状态更新。
            state["messages"] = list(state.get("messages", [])) + [tool_message]
            print(
                "[Agent Debug] scheduled_task_subgraph append tool message | "
                f"tool_call_id={tool_call_id} "
                f"session_id={state.get('session_id') or self.session_id}"
            )
        else:
            print(
                "[Agent Warn] scheduled_task_subgraph missing tool_call_id, "
                f"session_id={state.get('session_id') or self.session_id}"
            )
        state["_node_events"].append({
            "type": "scheduled_task_suggestion",
            "content": f"已根据当前对话生成定时任务草案：{draft_payload.get('title') or '未命名任务'}",
            "intent_text": draft_payload.get("intent_text") or route_decision.get("intent_text") or "",
            "draft_id": draft_payload.get("id"),
            "draft_title": draft_payload.get("title"),
            "summary_markdown": draft_payload.get("summary_markdown") or "",
            "analysis_status": draft_payload.get("analysis_status") or "draft",
            "timestamp": datetime.utcnow().isoformat(),
        })
        resp = state.get("llm_response") or {}
        final_hint = "我已经根据当前对话生成了一个定时任务草案，你可以查看、预览并确认创建。"
        current_content = (resp.get("content") or "").strip()
        if not current_content:
            resp["content"] = final_hint
        elif "定时任务草案" not in current_content:
            resp["content"] = f"{current_content}\n\n{final_hint}"
        state["llm_response"] = resp
        state["scheduled_task_route"] = None
        return state

    # ====== acting：执行工具 ======
    async def _acting_node(self, state: AgentState):

        resp = state["llm_response"]

        tool_calls = resp.get("tool_calls")

        # 获取 browser_session_id 和 user_id
        browser_session_id = state.get("browser_session_id")


        

        # 方案 B: 初始化事件队列
        state.setdefault("_node_events", [])

        if tool_calls:
            executable_tool_calls = [
                tc for tc in tool_calls if not self._is_scheduled_task_tool_call(tc)
            ]
            if not executable_tool_calls:
                return state
            # 方案 B: 注入 tool_start 事件
            for tc in executable_tool_calls:
                tool_name = tc.get("function", {}).get("name", "")
                raw_arguments, executed_arguments = prepare_tool_call_arguments(
                    tc,
                    browser_session_id=browser_session_id,
                    user_id=self.user_id,
                    knowledge_base_ids=self.knowledge_base_ids,
                )
                state["_node_events"].append({
                    "type": "tool_start",
                    "tool_name": tool_name,
                    "tool_call_id": tc.get("id"),
                    "metadata": {
                        "raw_arguments": raw_arguments,
                        "executed_arguments": executed_arguments,
                    },
                    "timestamp": datetime.utcnow().isoformat()
                })

            # 执行真实工具，返回 tool 消息列表（注入 browser_session_id 和 user_id）
            tool_messages = await run_tool(
                executable_tool_calls,
                browser_session_id=browser_session_id,
                user_id=self.user_id,
                knowledge_base_ids=self.knowledge_base_ids,
            )


            # 写回上下文：tool 消息（每个 tool_call 对应一条，包含 tool_call_id）
            for tool_message in tool_messages:
                state["messages"].append(tool_message)

            # 方案 B: 注入 tool_end 事件
            for tool_message in tool_messages:
                content = tool_message.get("content", "")
                tool_status = "success" if "执行成功" in content else "error"
                state["_node_events"].append({
                    "type": "tool_end",
                    "tool_name": tool_message.get("tool_name", ""),
                    "tool_call_id": tool_message.get("tool_call_id"),
                    "tool_status": tool_status,
                    "content": content,
                    "timestamp": datetime.utcnow().isoformat()
                })

        return state

    # ====== responding：最终输出准备 ======
    async def _responding_node(self, state: AgentState):

        state.setdefault("_node_events", [])

        print(f"[Responding Node] state keys: {state.keys()}")
        print(f"[Responding Node] llm_response: {state.get('llm_response')}")

        resp = state.get("llm_response", {})
        final_content = resp.get("content", "")

        print(f"[Responding Node] final_content: {final_content}")

        state["_node_events"].append({
            "type": "thinking_end",
            "content": final_content,
            "timestamp": datetime.utcnow().isoformat()
        })

        #text_messages = _convert_multimodal_to_text(state["messages"])
        text_messages = state["messages"]

        final_prompt = [
            {
                "role": "system",
                "content": "请直接输出最终答案，不要调用工具"
            },
            *text_messages
        ]

        state["final_messages"] = final_prompt

        return state

    # ====== 同步结果 ======
    async def execute(self, messages: List[Dict]):

        state = {
            "messages": messages,
            "browser_session_id": self.browser_session_id
        }

        result = await self.graph.ainvoke(state)

        llm_response = result.get("llm_response", {})
        return llm_response.get("content", "")

    # ====== 真正流式执行（核心） ======
    async def execute_stream(self, messages: List[Dict], thread_id: str) -> AsyncGenerator[Dict, None]:
        """
        方案 B 实现：手动注入事件 + 状态队列消费
        1. 从 Checkpoint 加载上一次已 trim/summarize 的历史
        2. 只追加本次用户最新一条消息
        3. 通过 _node_events 队列传递 thinking/tool 相关事件
        """
        if not messages:
            yield {"type": "error", "content": "No messages provided", "timestamp": datetime.utcnow().isoformat()}
            return

        config = {"configurable": {"thread_id": thread_id}, "recursion_limit": 100}

        text_messages = _convert_multimodal_to_text(messages)
        user_latest_message = text_messages[-1]
        #user_latest_message 需要打印对象内容
        #print( "用户最新消息"+ str(user_latest_message))

        # Debug: print where history_messages came from (checkpoint hit/miss) without dumping full message content.
        try:
            settings = get_settings()
            debug_enabled = bool(getattr(settings, "DEBUG", False))
        except Exception:
            debug_enabled = False

        async def _run_with(graph, checkpointer):
            checkpoint_tuple = None
            if checkpointer:
                checkpoint_tuple = await checkpointer.aget_tuple(config)
                if checkpoint_tuple and checkpoint_tuple.checkpoint:
                    history_messages = checkpoint_tuple.checkpoint.get("channel_values", {}).get("messages", [])
                    summary_history = checkpoint_tuple.checkpoint.get("channel_values", {}).get("summary_history", "")
                else:
                    history_messages = messages[:-1] if len(messages) > 1 else []
                    summary_history = ""
            else:
                history_messages = messages[:-1] if len(messages) > 1 else []
                summary_history = ""

            if debug_enabled:
                checkpoint_hit = bool(checkpointer and checkpoint_tuple and checkpoint_tuple.checkpoint)
                roles = [m.get("role", "unknown") for m in (history_messages or []) if isinstance(m, dict)]
                print(
                    "[Agent Debug] execute_stream history | "
                    f"thread_id={thread_id} "
                    f"checkpointer={type(checkpointer).__name__ if checkpointer else None} "
                    f"checkpoint_hit={checkpoint_hit} "
                    f"history_count={len(history_messages) if history_messages else 0} "
                    f"summary_chars={len(summary_history or '')} "
                    f"history_tail_roles={roles[-5:]}"
                )
            self._log_scheduled_task_tool_history(history_messages or [], thread_id)

            current_messages = history_messages.copy()

            if not current_messages or current_messages[-1] != user_latest_message:
                current_messages.append(user_latest_message)
                if debug_enabled:
                    print(
                        "[Agent Debug] execute_stream append latest message | "
                        f"user_role={user_latest_message.get('role', 'unknown')}"
                    )

            initial_state: Dict[str, Any] = {
                "messages": current_messages,
                "session_id": self.session_id,
                "browser_session_id": self.browser_session_id,
                "summary_history": summary_history,
                "_node_events": [],  # 初始化事件队列
            }

            processed_event_ids = set()  # 已处理的事件 ID 集合
            seen_thinking_end = False

            async for event in graph.astream_events(initial_state, config=config, version="v2"):
                # 方案 B: 从 on_chain_stream 事件中提取 _node_events
                if event["event"] == "on_chain_stream":
                    state_chunk = event.get("data", {}).get("chunk", {})
                    if hasattr(state_chunk, "get"):
                        node_events = state_chunk.get("_node_events", [])
                        for ev in node_events:
                            ev_id = id(ev)
                            if ev_id not in processed_event_ids:
                                processed_event_ids.add(ev_id)
                                yield ev
                                if ev.get("type") == "thinking_end":
                                    # 不要提前 return，确保 graph 能完整收尾并写入 checkpoint。
                                    seen_thinking_end = True

                elif event["event"] == "on_chain_end":
                    if event["name"] == "context_manager_node":
                        yield {"type": "context_trimmed", "timestamp": datetime.utcnow().isoformat()}

        # Prefer Postgres-backed checkpointer when available. If anything goes wrong,
        # fall back to in-memory so the task still runs.
        conn_string = self._get_checkpoint_conn_string()

        if debug_enabled:
            print(
                "[Agent Debug] checkpointer config | "
                f"python={sys.executable} "
                f"has_pg_saver={bool(AsyncPostgresSaver)} "
                f"conn={'set' if bool(conn_string) else 'missing'} "
                f"conn_redacted={self._redact_conn_string(conn_string) if conn_string else None}"
            )

        if conn_string and AsyncPostgresSaver:
            try:
                pg_ctx_or_saver = AsyncPostgresSaver.from_conn_string(conn_string)
                if hasattr(pg_ctx_or_saver, "__aenter__"):
                    async with pg_ctx_or_saver as pg_checkpointer:
                        setup_fn = getattr(pg_checkpointer, "setup", None)
                        if callable(setup_fn):
                            maybe_awaitable = setup_fn()
                            if inspect.isawaitable(maybe_awaitable):
                                await maybe_awaitable

                        pg_graph = self._build_graph(checkpointer=pg_checkpointer)
                        async for ev in _run_with(pg_graph, pg_checkpointer):
                            yield ev
                        return
                else:
                    pg_checkpointer = pg_ctx_or_saver
                    setup_fn = getattr(pg_checkpointer, "setup", None)
                    if callable(setup_fn):
                        maybe_awaitable = setup_fn()
                        if inspect.isawaitable(maybe_awaitable):
                            await maybe_awaitable

                    pg_graph = self._build_graph(checkpointer=pg_checkpointer)
                    async for ev in _run_with(pg_graph, pg_checkpointer):
                        yield ev
                    return
            except Exception as e:
                print(f"[Agent Warn] Persistent checkpointer unavailable, falling back to MemorySaver: {e}")
        elif debug_enabled:
            reason = "missing_conn_string" if not conn_string else "missing_pg_saver"
            print(f"[Agent Debug] persistent checkpointer skipped | reason={reason}")

        async for ev in _run_with(self.graph, self.checkpointer):
            yield ev

    def _extract_latest_user_text(self, messages: List[Dict[str, Any]]) -> str:
        for message in reversed(messages):
            if message.get("role") != "user":
                continue
            content = message.get("content")
            if isinstance(content, str):
                return content
            if isinstance(content, list):
                text_parts = []
                for item in content:
                    if isinstance(item, dict) and item.get("type") == "text" and item.get("content"):
                        text_parts.append(item.get("content"))
                if text_parts:
                    return "\n".join(text_parts)
        return ""

    def _log_scheduled_task_tool_history(self, messages: List[Dict[str, Any]], thread_id: str) -> None:
        related_items = []
        for idx, message in enumerate(messages):
            if not isinstance(message, dict):
                continue
            role = message.get("role")

            if role == "assistant":
                tool_calls = message.get("tool_calls") or []
                for tool_call in tool_calls:
                    function_info = (tool_call.get("function", {}) or {})
                    if function_info.get("name") != SCHEDULED_TASK_TOOL_NAME:
                        continue
                    related_items.append(
                        {
                            "index": idx,
                            "role": "assistant",
                            "tool_call_id": tool_call.get("id"),
                            "arguments": function_info.get("arguments"),
                            "content_preview": str(message.get("content", ""))[:160],
                        }
                    )
                continue

            if role == "tool":
                tool_name = message.get("name") or message.get("tool_name")
                tool_call_id = message.get("tool_call_id")
                if tool_name != SCHEDULED_TASK_TOOL_NAME and not str(tool_call_id).startswith(f"{SCHEDULED_TASK_TOOL_NAME}:"):
                    continue
                content = message.get("content", "")
                content_preview = str(content)
                if len(content_preview) > 200:
                    content_preview = content_preview[:200] + "..."
                related_items.append(
                    {
                        "index": idx,
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "name": tool_name,
                        "content_preview": content_preview,
                    }
                )

        if related_items:
            print(
                "[Agent Debug] scheduled_task__plan_draft history | "
                f"thread_id={thread_id} "
                f"count={len(related_items)} "
                f"items={related_items}"
            )

    def _is_scheduled_task_tool_call(self, tool_call: Dict[str, Any]) -> bool:
        return (tool_call.get("function", {}) or {}).get("name") == SCHEDULED_TASK_TOOL_NAME

    def _resolve_scheduled_tool_call_id(self, state: AgentState) -> Optional[str]:
        for message in reversed(state.get("messages", [])):
            if not isinstance(message, dict) or message.get("role") != "assistant":
                continue
            tool_calls = message.get("tool_calls") or []
            for tool_call in reversed(tool_calls):
                if self._is_scheduled_task_tool_call(tool_call):
                    tool_call_id = tool_call.get("id")
                    if tool_call_id:
                        return tool_call_id
        return None

    def _extract_scheduled_task_route(self, tool_calls: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        latest_user_text = ""
        for tool_call in tool_calls:
            if not self._is_scheduled_task_tool_call(tool_call):
                continue
            arguments_text = (tool_call.get("function", {}) or {}).get("arguments", "{}")
            arguments = self._parse_json_response(arguments_text)
            latest_user_text = arguments.get("intent_text") or latest_user_text
            return {
                "should_enter_subgraph": True,
                "tool_call_id": tool_call.get("id"),
                "intent_text": arguments.get("intent_text") or "",
                "schedule_text": arguments.get("schedule_text") or "",
                "timezone": arguments.get("timezone"),
                "goal": arguments.get("goal") or "",
                "reason": "主 agent 调用了 scheduled_task__plan_draft",
            }
        return None

    def _parse_json_response(self, text: str) -> Dict[str, Any]:
        if not text:
            return {}
        cleaned = text.strip()
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```(?:json)?", "", cleaned).strip()
            cleaned = re.sub(r"```$", "", cleaned).strip()
        try:
            return json.loads(cleaned)
        except Exception:
            match = re.search(r"\{[\s\S]*\}", cleaned)
            if match:
                try:
                    return json.loads(match.group(0))
                except Exception:
                    return {}
        return {}
