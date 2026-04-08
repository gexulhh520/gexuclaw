# Gemma4 使用 Ollama Python 库重构计划

## 目标
将 Gemma4Provider 从使用 HTTP API 改为使用 `ollama` Python 库，支持音频和图片通过 `images` 字段传入。

---

## 当前实现 vs 目标实现

### 当前实现（HTTP API）
```python
import httpx
self.client = httpx.AsyncClient(timeout=120.0)
response = await self.client.post(self.api_chat, json=payload)
```

### 目标实现（Ollama 库）
```python
import ollama
response = ollama.chat(
    model="gemma4:e4b",
    messages=[{
        "role": "user",
        "content": "请转录这段音频",
        "images": [audio_base64]  # 图片和音频都用 images 字段
    }],
    stream=False
)
```

---

## 关键改动

### 1. 导入 ollama 库

```python
import ollama
import base64
from typing import Optional, List, Dict, Any, AsyncGenerator
from .base import BaseProviderImpl
```

### 2. 修改构造函数

```python
def __init__(self, config: Dict[str, Any]):
    self.model = config.get("model", "gemma4:e4b")
    # Ollama 库会自动连接本地 Ollama 服务
    # 如果需要指定 host，可以设置环境变量 OLLAMA_HOST
```

### 3. 修改消息格式转换

```python
def _convert_to_ollama_format(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Convert unified format to Ollama format
    
    Key: Ollama uses "images" field for both images AND audio (base64)
    """
    ollama_messages = []
    
    for msg in self._normalize_messages(messages):
        role = msg["role"]
        content_list = msg.get("content", [])
        
        # Extract text content
        text_parts = []
        images = []  # Both images and audio go here
        
        for item in content_list:
            item_type = item.get("type")
            item_content = item.get("content", "")
            
            if item_type == "text":
                text_parts.append(str(item_content))
            
            elif item_type == "image":
                # Convert to base64
                b64 = self._to_base64(item_content)
                if b64:
                    images.append(b64)
            
            elif item_type == "audio":
                # Audio also goes to "images" field (Ollama's current approach)
                b64 = self._to_base64(item_content)
                if b64:
                    images.append(b64)
        
        # Build Ollama message
        ollama_msg = {
            "role": role,
            "content": "\n".join(text_parts) if text_parts else ""
        }
        
        # Add images (includes both images and audio)
        if images:
            ollama_msg["images"] = images
        
        ollama_messages.append(ollama_msg)
    
    return ollama_messages
```

### 4. 修改 chat 方法（同步包装）

```python
async def chat(
    self,
    messages: List[Dict[str, Any]],
    temperature: float = 0.7,
    max_tokens: Optional[int] = None,
    tools: Optional[List[Dict[str, Any]]] = None,
    system_prompt: Optional[str] = None,
) -> Dict[str, Any]:
    """Chat completion using Ollama library"""
    messages_with_system = self._add_system_prompt(messages, system_prompt)
    ollama_messages = self._convert_to_ollama_format(messages_with_system)
    
    # Run in thread pool (ollama.chat is synchronous)
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None,
        self._sync_chat,
        ollama_messages,
        temperature
    )
    
    return result

def _sync_chat(self, messages: List[Dict], temperature: float) -> Dict[str, Any]:
    """Synchronous chat using ollama library"""
    try:
        response = ollama.chat(
            model=self.model,
            messages=messages,
            stream=False,
            options={"temperature": temperature}
        )
        
        content = response.get("message", {}).get("content", "")
        
        return {
            "content": content,
            "role": "assistant",
            "tool_calls": None,
            "reasoning_content": None,
        }
    except Exception as e:
        return {
            "content": f"Error: {str(e)}",
            "role": "assistant",
            "tool_calls": None,
            "reasoning_content": None,
        }
```

### 5. 修改 stream 方法

```python
async def stream(
    self,
    messages: List[Dict[str, Any]],
    temperature: float = 0.7,
    system_prompt: Optional[str] = None,
) -> AsyncGenerator[Dict[str, Any], None]:
    """Stream chat completion using Ollama library"""
    messages_with_system = self._add_system_prompt(messages, system_prompt)
    ollama_messages = self._convert_to_ollama_format(messages_with_system)
    
    try:
        # ollama.chat with stream=True returns generator
        for chunk in ollama.chat(
            model=self.model,
            messages=ollama_messages,
            stream=True,
            options={"temperature": temperature}
        ):
            content = chunk.get("message", {}).get("content", "")
            done = chunk.get("done", False)
            
            if content:
                yield {
                    "content": content,
                    "tool_calls": None,
                    "finish_reason": "stop" if done else None,
                }
            
            if done:
                break
                
    except Exception as e:
        yield {
            "content": f"Error: {str(e)}",
            "tool_calls": None,
            "finish_reason": "error",
        }
```

---

## 文件变更

| 文件 | 操作 |
|------|------|
| `backend/llm/providers/gemma4.py` | 重写，使用 ollama 库 |
| `backend/requirements.txt` | 添加 `ollama` 依赖 |

---

## 注意事项

1. **Ollama 库是同步的**：需要用 `run_in_executor` 包装成异步
2. **音频用 images 字段**：Ollama 当前用 `images` 字段传入音频 base64
3. **环境变量**：可通过 `OLLAMA_HOST` 指定 Ollama 服务地址
4. **音频时长**：建议不超过 30 秒

---

## 实施步骤

1. 添加 `ollama` 到 requirements.txt
2. 重写 `gemma4.py` 使用 ollama 库
3. 测试验证
