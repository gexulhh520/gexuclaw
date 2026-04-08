from typing import List, Dict, Any, AsyncGenerator
from langgraph.graph import StateGraph, END

from llm.client import llm_client_instance
from tools import get_tool_runtime, ToolResult


def _convert_multimodal_to_text(messages: List[Dict]) -> List[Dict]:
    """
    Convert multimodal messages: keep original array + merge text description
    
    Input:
    [
        {
            "role": "user",
            "content": [
                {"type": "text", "content": "Please analyze this image"},
                {"type": "image", "content": "/images/2024/04/abc123.png"}
            ]
        }
    ]
    
    Output:
    [
        {
            "role": "user",
            "content": [
                {"type": "text", "content": "Please analyze this image\n\n[Image Resource: /images/2024/04/abc123.png]"},
                {"type": "image", "content": "/images/2024/04/abc123.png"}
            ]
        }
    ]
    """
    converted = []
    
    for msg in messages:
        role = msg.get("role")
        content = msg.get("content")
        
        # If string, keep as is
        if isinstance(content, str):
            converted.append({"role": role, "content": content})
            continue
        
        # If list (multimodal), merge text + keep original structure
        if isinstance(content, list):
            text_parts = []
            resources = []
            new_content = []
            
            for item in content:
                item_type = item.get("type")
                item_content = item.get("content", "")
                
                # Keep original item
                new_content.append(item)
                
                if item_type == "text":
                    text_parts.append(item_content)
                elif item_type == "image":
                    resources.append(f"[Image Resource: {item_content}]")
                elif item_type == "audio":
                    resources.append(f"[Audio Resource: {item_content}]")
            
            # Merge text description
            merged_text = "\n".join(text_parts)
            if resources:
                merged_text += "\n\n" + "\n".join(resources)
            
            # Replace first text item with merged text
            if text_parts and new_content:
                for i, item in enumerate(new_content):
                    if item.get("type") == "text":
                        new_content[i] = {"type": "text", "content": merged_text}
                        break
            
            converted.append({"role": role, "content": new_content})
        
        else:
            converted.append({"role": role, "content": str(content)})
    
    return converted


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
async def run_tool(tool_calls: List[Dict[str, Any]], browser_session_id: str = None) -> List[Dict[str, Any]]:
    """
    执行工具调用
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
            "content": "执行结果..."
        }
    ]
    
    Args:
        tool_calls: 工具调用列表
        browser_session_id: 可选，浏览器会话 ID（自动注入到浏览器操作）
    """
    tool_runtime = get_tool_runtime()
    tool_messages = []

    for call in tool_calls:
        try:
            tool_call_id = call.get("id") or call.get("tool_call_id") or f"call_{id(call)}"
            function_info = call.get("function", {})
            name = function_info.get("name", "")
            arguments_str = function_info.get("arguments", "{}")

            # 解析参数
            import json
            arguments = json.loads(arguments_str) if isinstance(arguments_str, str) else arguments_str

            # 如果是浏览器操作且提供了 browser_session_id，自动注入
            if browser_session_id and name.startswith("browser__"):
                # launch_browser 时注入 session_id
                if "launch_browser" in name and "browser_session_id" not in arguments:
                    arguments["browser_session_id"] = browser_session_id
                # 其他浏览器操作如果需要 session_id 也注入（navigate, click 等）
                elif any(op in name for op in ["navigate", "click", "fill", "type", "get_text"]):
                    if "session_id" not in arguments:
                        arguments["session_id"] = browser_session_id

            # 执行工具（异步）
            print(f"[Tool Debug] Executing tool: {name} with args: {arguments}")
            result = await tool_runtime.execute_by_name_async(name, arguments)
            print(f"[Tool Debug] Tool result: {result}")
            
            # 格式化结果（智能截断，保留文本，省略 base64 等大内容）
            if result.success:
                content = f"工具 [{name}] 执行成功: {_smart_truncate(result.data)}"
            else:
                content = f"工具 [{name}] 执行失败: {_smart_truncate(result.error)}"

            # 构建 tool 消息（包含 tool_call_id）
            tool_messages.append({
                "tool_call_id": tool_call_id,
                "role": "tool",
                "content": content
            })

        except Exception as e:
            tool_messages.append({
                "tool_call_id": call.get("id", ""),
                "role": "tool",
                "content": f"工具调用异常: {str(e)}"
            })

    return tool_messages


def get_available_tools() -> List[Dict[str, Any]]:
    """获取所有可用的工具定义，用于 LLM function calling"""
    tool_runtime = get_tool_runtime()
    tools = tool_runtime.get_all_operations()
    print(f"[Tool Debug] Tool runtime categories: {list(tool_runtime.tools.keys())}")
    print(f"[Tool Debug] Available tools count: {len(tools)}")
    return tools


# ====== 状态定义 ======
AgentState = Dict[str, Any]


# ====== Agent Executor ======
class AgentExecutor:
    provider: str = "openai"
    model: str = None
    browser_session_id: str = None

    def __init__(self, provider: str = "openai", model: str = None, browser_session_id: str = None, system_prompt=None):
        self.provider = provider
        self.model = model
        self.browser_session_id = browser_session_id
        self.system_prompt = system_prompt  # 新增：存储系统提示词
        self.graph = self._build_graph()

    # ====== Graph构建 ======
    def _build_graph(self):

        workflow = StateGraph(AgentState)

        workflow.add_node("thinking", self._thinking_node)
        workflow.add_node("acting", self._acting_node)
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

        workflow.add_edge("acting", "thinking")
        workflow.add_edge("responding", END)

        return workflow.compile()

    # ====== 判断是否继续 ======
    def _should_continue(self, state: AgentState):

        resp = state.get("llm_response")

        if resp and resp.get("tool_calls"):
            return "continue"
        return "end"

    # ====== thinking：LLM决策 ======
    async def _thinking_node(self, state: AgentState):

        messages = state["messages"]
        
        # Convert multimodal messages to plain text description
        text_messages = _convert_multimodal_to_text(messages)

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
        print(f"[Agent Debug] LLM Response: {resp}")
        print(f"[Agent Debug] Content: {resp.get('content')}")
        print(f"[Agent Debug] Tool Calls: {resp.get('tool_calls')}")

        state["llm_response"] = resp

        return state

    # ====== acting：执行工具 ======
    async def _acting_node(self, state: AgentState):

        resp = state["llm_response"]

        tool_calls = resp.get("tool_calls")
        
        # 获取 browser_session_id
        browser_session_id = state.get("browser_session_id")

        if tool_calls:
            # 执行真实工具，返回 tool 消息列表（注入 browser_session_id）
            tool_messages = await run_tool(tool_calls, browser_session_id=browser_session_id)

            # 写回上下文：assistant 消息（包含 tool_calls）
            # Kimi K2 需要 reasoning_content 字段
            # 确保 tool_calls 格式正确（id 字段必须存在）
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
            state["messages"].append(assistant_msg)

            # 写回上下文：tool 消息（每个 tool_call 对应一条，包含 tool_call_id）
            for tool_message in tool_messages:
                state["messages"].append(tool_message)

        return state

    # ====== responding：最终输出准备 ======
    async def _responding_node(self, state: AgentState):
        
        # Convert messages to plain text for final response
        text_messages = _convert_multimodal_to_text(state["messages"])

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

    # ====== 流式输出（重点） ======
    async def execute_stream(self, messages: List[Dict]) -> AsyncGenerator[str, None]:

        state = {
            "messages": messages,
            "browser_session_id": self.browser_session_id
        }

        result = await self.graph.ainvoke(state)

        # 调试日志
        #print(f"[Stream Debug] Full result: {result}")
        print(f"[Stream Debug] llm_response: {result.get('llm_response')}")
        print(f"[Stream Debug] final_messages: {result.get('final_messages')}")

        # 检查是否有工具调用，如果没有直接返回内容
        llm_response = result.get("llm_response", {})
        print(f"[Stream Debug] llm_response content: {llm_response.get('content')}")
        
        if not result.get("final_messages") and llm_response.get("content"):
            print(f"[Stream Debug] Path 1: Direct content return")
            yield llm_response["content"]
            return

        final_messages = result.get("final_messages")
        if not final_messages:
            print(f"[Stream Debug] Path 2: Error - no final_messages")
            yield "抱歉，处理过程中出现错误。"
            return
        
        print(f"[Stream Debug] Path 3: Streaming with final_messages")
        async for chunk in llm_client_instance.stream(final_messages, provider=self.provider, model=self.model):
            # print(f"[Stream Debug] Chunk received: {chunk}")
            # 优先检查 content 字段（兼容不同 provider 格式）
            content = chunk.get("content", "")
            if content:
                yield content
