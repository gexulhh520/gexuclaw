# 多模态消息转换为纯文本描述计划

## 目标

1. 数据库存储：保持多模态格式（text + image 分开存）- **已实现**
2. 提交给大模型前：把多模态内容转换为纯文本描述
3. 大模型识别 tool，把图片路径和消息传给工具

---

## 当前流程

```
前端发送消息
    ↓
api/v1.py → chat_session_service.add_message() 存入 PostgreSQL（多模态）
    ↓
SessionManager.add_message() 存入 Redis
    ↓
Celery 任务 execute_agent_task
    ↓
AgentExecutor.execute_stream(messages)
    ↓
llm_client_instance.chat(messages, tools=...)
```

---

## 需要修改的位置

### 方案：在 `AgentExecutor` 中添加消息转换

在 `_thinking_node` 调用 LLM 之前，将多模态消息转换为纯文本描述。

```python
# executor.py

def _convert_multimodal_to_text(self, messages: List[Dict]) -> List[Dict]:
    """
    将多模态消息转换为纯文本描述
    
    输入：
    [
        {
            "role": "user",
            "content": [
                {"type": "text", "content": "请分析这张图片"},
                {"type": "image", "content": "/images/2024/04/abc123.png"}
            ]
        }
    ]
    
    输出：
    [
        {
            "role": "user",
            "content": "请分析这张图片\n\n[图片资源: /images/2024/04/abc123.png]"
        }
    ]
    """
    converted = []
    
    for msg in messages:
        role = msg.get("role")
        content = msg.get("content")
        
        # 如果是字符串，直接保留
        if isinstance(content, str):
            converted.append({"role": role, "content": content})
            continue
        
        # 如果是列表（多模态），转换为文本描述
        if isinstance(content, list):
            text_parts = []
            resources = []
            
            for item in content:
                item_type = item.get("type")
                item_content = item.get("content", "")
                
                if item_type == "text":
                    text_parts.append(item_content)
                
                elif item_type == "image":
                    resources.append(f"[图片资源: {item_content}]")
                
                elif item_type == "audio":
                    resources.append(f"[音频资源: {item_content}]")
            
            # 组合文本
            full_text = "\n".join(text_parts)
            if resources:
                full_text += "\n\n" + "\n".join(resources)
            
            converted.append({"role": role, "content": full_text})
        
        else:
            converted.append({"role": role, "content": str(content)})
    
    return converted
```

---

## 修改 `AgentExecutor._thinking_node`

```python
async def _thinking_node(self, state: AgentState):
    messages = state["messages"]
    
    # 新增：转换多模态消息为纯文本
    text_messages = self._convert_multimodal_to_text(messages)
    
    tools = get_available_tools()
    
    resp = await llm_client_instance.chat(
        text_messages,  # 使用转换后的纯文本消息
        provider=self.provider,
        model=self.model,
        tools=tools if tools else None,
        system_prompt=self.system_prompt
    )
    
    # ... 后续代码不变
```

---

## 数据流对比

### 修改前

```
用户消息（多模态）→ 存入数据库 → 直接传给 LLM（多模态格式）
```

### 修改后

```
用户消息（多模态）→ 存入数据库（保持多模态）→ 转换为纯文本描述 → 传给 LLM
```

---

## 示例

### 输入消息

```python
{
    "role": "user",
    "content": [
        {"type": "text", "content": "请分析这张图片中的内容"},
        {"type": "image", "content": "/images/2024/04/abc123.png"}
    ]
}
```

### 转换后

```python
{
    "role": "user",
    "content": "请分析这张图片中的内容\n\n[图片资源: /images/2024/04/abc123.png]"
}
```

### LLM 可能返回的 Tool Call

```python
{
    "tool_calls": [{
        "id": "call_xxx",
        "type": "function",
        "function": {
            "name": "image_analyzer",
            "arguments": '{"image_path": "/images/2024/04/abc123.png", "question": "请分析这张图片中的内容"}'
        }
    }]
}
```

---

## 文件变更

| 文件 | 操作 |
|------|------|
| `backend/agents/executor.py` | 添加 `_convert_multimodal_to_text` 方法，修改 `_thinking_node` |

---

## 注意事项

1. **工具开发**：下一步需要开发 `image_analyzer` 等工具
2. **消息存储**：数据库保持多模态格式，便于后续展示和回放
3. **Redis 缓存**：Redis 中也保持多模态格式

---

## 实施步骤

1. 在 `executor.py` 添加 `_convert_multimodal_to_text` 方法
2. 修改 `_thinking_node` 在调用 LLM 前转换消息
3. 测试验证
