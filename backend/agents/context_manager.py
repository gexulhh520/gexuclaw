from typing import Dict, Any, List
from agents.state import AgentState
from langchain_core.messages import trim_messages, RemoveMessage, SystemMessage, HumanMessage, AIMessage
import tiktoken  # pip install tiktoken（精确计数）


# ====================== Token 计数器（精确方案） ======================
def count_tokens(messages: List[Dict], model: str = "gpt-4o") -> int:
    """精确 token 计算（已完整支持 multimodal + tool）"""
    try:
        import tiktoken
        encoding = tiktoken.encoding_for_model(model)
    except Exception:
        import tiktoken
        encoding = tiktoken.get_encoding("cl100k_base")

    total = 0
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content")

        # 角色开销
        if role == "system":
            total += 4
        elif role in ("user", "human"):
            total += 3
        elif role in ("assistant", "ai"):
            total += 3
        elif role in ("tool", "function"):
            total += 5

        # 内容 token
        text = get_content_text(content)
        total += len(encoding.encode(text))

    total += len(messages) * 2
    return total


# ====================== 长消息预处理 ======================
def preprocess_long_message(content: str, max_single_tokens: int = 15000) -> str | Dict:
    """
    单条超长消息立即结构化提取
    
    Args:
        content: 消息内容
        max_single_tokens: 单条消息最大 token 数
    
    Returns:
        原始内容或结构化后的字典
    """
    from langchain_core.messages import HumanMessage
    
    tokens = count_tokens([{"content": content}])
    if tokens <= max_single_tokens:
        return content
    
    print(f"⚠️ 检测到单条消息约 {tokens} tokens，触发预处理...")
    
    # 结构化提取（简化版，实际项目中可调用 cheap_llm）
    structured = {
        "overall_goal": "操作网页完成指定任务",
        "steps": ["步骤 1：打开 URL...", "步骤 2：点击按钮...", "...（已提取）"],
        "constraints": ["不要刷新页面", "只提取表格数据"],
        "key_urls": ["https://example.com/pageA"],
        "extracted_data_template": {"title": "", "data": []}
    }
    print("✅ 已将长消息结构化为 JSON（token 显著减少）")
    return structured


# ====================== Trim 节点 ======================
async def trim_node(state: AgentState) -> AgentState:
    messages = state.get("messages", [])
    total_tokens = count_tokens(messages)
    
    model_context = 128000
    threshold = model_context * 0.80
    
    if total_tokens <= threshold:
        return state

    print(f"🔥 总 token {total_tokens} 超过阈值，触发 trim...")

    try:
        from langchain_core.messages import (
            HumanMessage, AIMessage, SystemMessage, ToolMessage
        )
        
        lc_messages = []
        for msg in messages:
            role = msg.get("role")
            content = msg.get("content")
            tool_call_id = msg.get("tool_call_id")   # 重要！tool 消息需要保留 id

            if role == "user":
                lc_messages.append(HumanMessage(content=content))
            elif role == "assistant":
                reasoning = msg.get("reasoning_content", "")
                tool_calls = msg.get("tool_calls")
                extra_kwargs = {"reasoning_content": reasoning} if reasoning else {}
                if tool_calls:
                    extra_kwargs["tool_calls"] = tool_calls
                lc_messages.append(AIMessage(content=content, **extra_kwargs))
            elif role == "system":
                lc_messages.append(SystemMessage(content=content))
            elif role == "tool":
                lc_messages.append(ToolMessage(
                    content=str(content), 
                    tool_call_id=tool_call_id or "unknown"
                ))
            else:
                # 未知 role 也尽量保留
                lc_messages.append(HumanMessage(content=f"[{role}] {content}"))

        trimmed = trim_messages(
            lc_messages,
            strategy="last",
            max_tokens=28000,          # 可以适当调大一点
            token_counter=lambda msgs: count_tokens([{"role": getattr(m, 'type', 'assistant'), "content": m.content} for m in msgs]),
            include_system=True,
            start_on="human",
            end_on=("human", "tool")   # 重点：保留 tool 消息结束
        )

        # 转回 dict 格式
        state["messages"] = []
        for m in trimmed:
            if isinstance(m, SystemMessage):
                role = "system"
            elif isinstance(m, HumanMessage):
                role = "user"
            elif isinstance(m, AIMessage):
                role = "assistant"
            elif isinstance(m, ToolMessage):
                role = "tool"
            else:
                role = "user"
            
            msg_dict = {"role": role, "content": m.content}
            if isinstance(m, ToolMessage) and hasattr(m, 'tool_call_id'):
                msg_dict["tool_call_id"] = m.tool_call_id
            if isinstance(m, AIMessage) and hasattr(m, 'reasoning_content') and m.reasoning_content:
                msg_dict["reasoning_content"] = m.reasoning_content
            if isinstance(m, AIMessage) and hasattr(m, 'tool_calls') and m.tool_calls:
                msg_dict["tool_calls"] = m.tool_calls

            state["messages"].append(msg_dict)

        print(f"✅ trim 完成，新 token: {count_tokens(state['messages'])}")
        
    except Exception as e:
        print(f"⚠️ trim 失败，使用简单保留最近消息: {e}")
        # 降级策略：保留 system + 最近 N 条（优先保留 tool 和 user/assistant 交替）
        system_msgs = [m for m in messages if m.get("role") == "system"]
        others = [m for m in messages if m.get("role") != "system"]
        state["messages"] = system_msgs + others[-30:]   # 多保留一点，因为有 tool

    return state


# ====================== Progressive Summarization 节点 ======================
async def summarize_node(state: AgentState) -> AgentState:
    """
    渐进总结节点（带上历史总结）
    
    当上下文超过阈值时：
    1. 保留最近的消息
    2. 对旧消息进行摘要
    3. 融合到 summary_history
    """
    from llm.client import llm_client_instance
    
    messages = state.get("messages", [])
    summary_history = state.get("summary_history", "")
    total_tokens = count_tokens(messages)
    
    # 模型上下文限制
    model_context = 128000
    threshold = model_context * 0.80
    
    if total_tokens <= threshold:
        return state
    
    print("📋 触发 progressive summarization...")
    
    try:
        # 1. 保留最近的消息（15k tokens）
        from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
        
        lc_messages = []
        for msg in messages:
            role = msg.get("role")
            content = msg.get("content")
            if role == "user":
                lc_messages.append(HumanMessage(content=content))
            elif role == "assistant":
                lc_messages.append(AIMessage(content=content))
            elif role == "system":
                lc_messages.append(SystemMessage(content=content))
        
        recent_lc = trim_messages(
            lc_messages,
            max_tokens=15000,
            strategy="last",
            token_counter=lambda msgs: count_tokens([{"content": m.content} for m in msgs])
        )
        
        # 2. 提取旧消息
        recent_contents = [m.content for m in recent_lc]
        old_messages = [
            msg for msg in messages 
            if msg.get("content") not in recent_contents
        ]
        
        if not old_messages:
            return state
        
        # 3. 构建摘要请求
        old_content = "\n".join([
            f"{msg.get('role')}: {str(msg.get('content', ''))[:500]}..." 
            for msg in old_messages
        ])
        
        summary_prompt = [
            {
                "role": "system",
                "content": """你是一个对话历史总结助手。
当前已有总结：
{previous_summary}

以下是需要新增的旧对话内容：
{old_content}

请更新总结：
- 保留用户核心目标、已完成任务、当前页面状态、重要约束
- 融合新内容，删除冗余，控制在 500 token 以内
- 用 bullet points 输出
- 只输出最终总结文本，不要解释""".replace(
                    "{previous_summary}", summary_history or "无历史总结"
                ).replace("{old_content}", old_content)
            }
        ]
        
        # 4. 调用 LLM 生成摘要
        summary_response = await llm_client_instance.chat(
            summary_prompt,
            provider=state.get("provider", "openai"),
            model=state.get("model"),
            system_prompt=None
        )
        
        new_summary = summary_response.get("content", "")
        
        # 5. 更新 summary_history
        state["summary_history"] = new_summary
        
        # 6. 重组消息：摘要 + 最近消息
        summary_msg = {
            "role": "system",
            "content": f"【历史对话总结】\n{new_summary}"
        }
        
        # 转换回原始格式
        recent_messages = [
            {"role": msg.type if hasattr(msg, 'type') else "assistant", "content": msg.content}
            for msg in recent_lc
        ]
        
        state["messages"] = [summary_msg] + recent_messages
        
        new_tokens = count_tokens(state["messages"])
        print(f"✅ progressive summary 完成，当前 token: {new_tokens}")
        
    except Exception as e:
        print(f"⚠️ summary 失败：{e}")
        # 摘要失败时，降级为简单截断
        system_messages = [m for m in messages if m.get("role") == "system"]
        non_system_messages = [m for m in messages if m.get("role") != "system"]
        state["messages"] = system_messages + non_system_messages[-20:]
    
    return state



from typing import Any, List, Dict

def get_content_text(content: Any) -> str:
    """专门处理 user 多模态 content（支持 "text" / "content" 两种 key）"""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        texts = []
        for block in content:
            if isinstance(block, dict):
                block_type = block.get("type")
                if block_type == "text":
                    text = block.get("text") or block.get("content") or ""
                    texts.append(str(text))
                elif block_type == "image_url":
                    texts.append("[图像]")
                else:
                    texts.append(str(block))
            else:
                texts.append(str(block))
        return "\n".join(texts)
    return str(content)



#       
async def context_manager_node(state: AgentState) -> AgentState:
    """
    单一上下文管理节点（主流推荐做法）
    内部逻辑：先 Progressive Summarization → 再轻量 Trim（兜底）
    已完整支持：
    - role = "tool"
    - user content 为多模态 list 格式（{"type": "text", "content": "..."}）
    """
    from llm.client import llm_client_instance
    from langchain_core.messages import (
        HumanMessage, AIMessage, SystemMessage, ToolMessage, trim_messages
    )

    messages: List[Dict] = state.get("messages", [])
    summary_history: str = state.get("summary_history", "")
    total_tokens = count_tokens(messages)

    model_context = 128000

    # ==================== 阶段 1：判断是否需要处理 ====================
    if total_tokens <= model_context * 0.78:   # 78% 以下不处理
        return state

    print(f"🔧 [Context Manager] 触发 | 当前 {total_tokens} tokens")

    try:
        # ====================== 1. 转 LangChain 格式 ======================
        lc_messages = []
        for msg in messages:
            role = msg.get("role")
            content = msg.get("content")
            tool_call_id = msg.get("tool_call_id")

            if role in ("user", "human"):
                lc_messages.append(HumanMessage(content=content))      # 直接支持 multimodal list
            elif role in ("assistant", "ai"):
                lc_messages.append(AIMessage(content=content))
            elif role == "system":
                lc_messages.append(SystemMessage(content=content))
            elif role in ("tool", "function"):
                lc_messages.append(ToolMessage(
                    content=get_content_text(content),
                    tool_call_id=tool_call_id or "unknown"
                ))
            else:
                lc_messages.append(HumanMessage(content=get_content_text(content)))

        # ====================== 2. Progressive Summarization ======================
        if total_tokens > model_context * 0.78:
            print("📋 执行 Progressive Summarization...")

            # 保留最近窗口（完整交互）
            recent_lc = trim_messages(
                lc_messages,
                max_tokens=18000,
                strategy="last",
                token_counter=lambda msgs: count_tokens([
                    {"role": getattr(m, 'type', 'assistant').replace("ai", "assistant"), "content": m.content}
                    for m in msgs
                ]),
                include_system=False,
                start_on="human",
                end_on=("human", "tool")
            )

            # 提取旧消息
            recent_set = set()
            for m in recent_lc:
                lc_type = getattr(m, 'type', 'assistant')
                std_role = {"human": "user", "ai": "assistant", "assistant": "assistant",
                            "system": "system", "tool": "tool"}.get(lc_type, "user")
                preview = get_content_text(m.content)[:150]
                recent_set.add((std_role, preview))

            old_messages = []
            for msg in messages:
                role = msg.get("role", "user")
                std_role = {"user": "user", "human": "user", "assistant": "assistant",
                            "ai": "assistant", "system": "system", "tool": "tool",
                            "function": "tool"}.get(role, "user")
                preview = get_content_text(msg.get("content", ""))[:150]
                if (std_role, preview) not in recent_set:
                    old_messages.append(msg)

            if old_messages:
                # 构建旧内容
                old_parts = []
                for msg in old_messages:
                    role = msg.get("role", "user")
                    content_text = get_content_text(msg.get("content", ""))
                    if role in ("tool", "function"):
                        preview = content_text[:350] + "..." if len(content_text) > 350 else content_text
                        old_parts.append(f"tool: [工具返回] {preview}")
                    else:
                        preview = content_text[:450] + "..." if len(content_text) > 450 else content_text
                        old_parts.append(f"{role}: {preview}")
                old_content = "\n".join(old_parts)

                # 生成总结
                summary_prompt = [{
                    "role": "system",
                    "content": f"""你是一个对话历史总结专家。

已有历史总结：
{summary_history or "（无）"}

需要新增总结的旧对话：
{old_content}

请输出更新后的总结（bullet points）：
- 重点保留用户核心目标、已完成任务、当前状态、关键数据、重要约束
- tool 返回只提取关键信息
- 总长度控制在 500 tokens 以内
- 只输出总结内容"""
                }]

                summary_response = await llm_client_instance.chat(
                    summary_prompt,
                    provider=state.get("provider", "openai"),
                    model=state.get("model", "gpt-4o-mini"),
                )

                new_summary = summary_response.get("content", "").strip()
                state["summary_history"] = new_summary

                # 重组消息
                summary_msg = {"role": "system", "content": f"【历史对话总结】\n{new_summary}"}

                recent_messages = []
                for m in recent_lc:
                    lc_type = getattr(m, 'type', 'assistant')
                    role = {"human": "user", "ai": "assistant", "assistant": "assistant",
                            "system": "system", "tool": "tool"}.get(lc_type, "user")
                    msg_dict = {"role": role, "content": m.content}
                    if hasattr(m, "tool_call_id"):
                        msg_dict["tool_call_id"] = m.tool_call_id
                    if hasattr(m, "reasoning_content") and m.reasoning_content:
                        msg_dict["reasoning_content"] = m.reasoning_content
                    if hasattr(m, "tool_calls") and m.tool_calls:
                        msg_dict["tool_calls"] = m.tool_calls
                    recent_messages.append(msg_dict)

                state["messages"] = [summary_msg] + recent_messages
                print(f"✅ Summarization 完成 | 当前 token: {count_tokens(state['messages'])}")

        # ====================== 3. 轻量 Trim 兜底 ======================
        current_tokens = count_tokens(state["messages"])
        if current_tokens > model_context * 0.92:
            print(f"🔥 执行轻量 Trim | 当前 {current_tokens} tokens")

            lc_messages = []  # 重新转一次（使用更新后的 messages）
            for msg in state["messages"]:
                role = msg.get("role")
                content = msg.get("content")
                tool_call_id = msg.get("tool_call_id")

                if role in ("user", "human"):
                    lc_messages.append(HumanMessage(content=content))
                elif role in ("assistant", "ai"):
                    lc_messages.append(AIMessage(content=content))
                elif role == "system":
                    lc_messages.append(SystemMessage(content=content))
                elif role in ("tool", "function"):
                    lc_messages.append(ToolMessage(
                        content=get_content_text(content),
                        tool_call_id=tool_call_id or "unknown"
                    ))
                else:
                    lc_messages.append(HumanMessage(content=get_content_text(content)))

            trimmed_lc = trim_messages(
                lc_messages,
                strategy="last",
                max_tokens=35000,
                token_counter=lambda msgs: count_tokens([
                    {"role": getattr(m, 'type', 'assistant').replace("ai", "assistant"), "content": m.content}
                    for m in msgs
                ]),
                include_system=True,
                start_on="human",
                end_on=("human", "tool")
            )

            # 转回 dict
            new_messages = []
            for m in trimmed_lc:
                lc_type = getattr(m, 'type', 'assistant')
                role = {"human": "user", "ai": "assistant", "assistant": "assistant",
                        "system": "system", "tool": "tool"}.get(lc_type, "user")
                msg_dict = {"role": role, "content": m.content}
                if hasattr(m, "tool_call_id"):
                    msg_dict["tool_call_id"] = m.tool_call_id
                if hasattr(m, "reasoning_content") and m.reasoning_content:
                    msg_dict["reasoning_content"] = m.reasoning_content
                if hasattr(m, "tool_calls") and m.tool_calls:
                    msg_dict["tool_calls"] = m.tool_calls
                new_messages.append(msg_dict)

            state["messages"] = new_messages
            print(f"✅ Trim 完成 | 最终 token: {count_tokens(state['messages'])}")

    except Exception as e:
        print(f"⚠️ Context Manager 异常，使用简单降级: {e}")
        system_msgs = [m for m in messages if m.get("role") == "system"]
        others = [m for m in messages if m.get("role") != "system"]
        state["messages"] = system_msgs + others[-28:]

    return state