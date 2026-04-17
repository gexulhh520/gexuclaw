from typing import List, Dict, Any, AsyncGenerator
from datetime import datetime
import inspect
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
from core.config import get_settings


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
async def run_tool(tool_calls: List[Dict[str, Any]], browser_session_id: str = None, user_id: int = None) -> List[Dict[str, Any]]:
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
            arguments_str = function_info.get("arguments", "{}")

            # 解析参数
            import json
            arguments = json.loads(arguments_str) if isinstance(arguments_str, str) else arguments_str

            # 浏览器工具自动注入 session_id
            if browser_session_id and name.startswith("browser__"):
                if "launch_browser" in name:
                    arguments.setdefault("browser_session_id", browser_session_id)
                elif any(op in name for op in ["navigate", "click", "fill", "type", "get_text"]):
                    arguments.setdefault("session_id", browser_session_id)

            # 知识库工具自动注入 user_id
            if user_id and name.startswith("knowledge__"):
                arguments.setdefault("user_id", user_id)

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

    def __init__(self, provider: str = "openai", model: str = None, browser_session_id: str = None, system_prompt=None, user_id: int = None):
        self.provider = provider
        self.model = model
        self.browser_session_id = browser_session_id
        self.system_prompt = system_prompt  # 新增：存储系统提示词
        self.user_id = user_id  # 当前登录用户 ID

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
                "end": "responding"
            }
        )

        workflow.add_edge("acting", "context_manager_node")
        workflow.add_edge("context_manager_node", "thinking")   # 循环继续
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


           return "continue"
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

    # ====== acting：执行工具 ======
    async def _acting_node(self, state: AgentState):

        resp = state["llm_response"]

        tool_calls = resp.get("tool_calls")

        # 获取 browser_session_id 和 user_id
        browser_session_id = state.get("browser_session_id")


        

        # 方案 B: 初始化事件队列
        state.setdefault("_node_events", [])

        if tool_calls:
            # 方案 B: 注入 tool_start 事件
            for tc in tool_calls:
                tool_name = tc.get("function", {}).get("name", "")
                state["_node_events"].append({
                    "type": "tool_start",
                    "tool_name": tool_name,
                    "timestamp": datetime.utcnow().isoformat()
                })

            # 执行真实工具，返回 tool 消息列表（注入 browser_session_id 和 user_id）
            tool_messages = await run_tool(tool_calls, browser_session_id=browser_session_id, user_id=self.user_id)


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
                "browser_session_id": self.browser_session_id,
                "summary_history": summary_history,
                "_node_events": [],  # 初始化事件队列
            }

            processed_event_ids = set()  # 已处理的事件 ID 集合

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
                                    return

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
