import asyncio
import base64
from typing import Optional, List, Dict, Any, AsyncGenerator
import ollama
from .base import BaseProviderImpl


class Gemma4Provider(BaseProviderImpl):
    """Gemma4 Provider - using Ollama Python library"""
    
    def __init__(self, config: Dict[str, Any]):
        self.model = config.get("model", "gemma4:e2b")
        # Ollama library auto-connects to local Ollama service
        # Set OLLAMA_HOST env var to change host (default: http://localhost:11434)
    
    def _convert_to_ollama_format(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        转换为 Ollama API 格式
        
        输入格式 (messages):
        ```python
        [
            {
                "role": "user",  # 或 "assistant", "system", "tool"
                "content": [
                    {"type": "text", "content": "文本内容"},
                    {"type": "image", "content": "图片路径/base64/URL"},
                    {"type": "audio", "content": "音频路径/base64"}
                ],
                "tool_calls": [...],  # 可选，assistant 角色可能有
                "tool_call_id": "..."  # 可选，tool 角色可能有
            }
        ]
        ```
        
        输出格式 (转换后):
        ```python
        [
            {
                "role": "user",
                "content": "合并后的纯文本内容",  # 所有 text 类型用换行符合并
                "images": [  # 可选，包含所有图片和音频的 base64
                    "base64_string_1",  # 图片
                    "base64_string_2"   # 音频
                ]
            },
            {
                "role": "assistant",
                "content": "助手回复的纯文本"
            }
        ]
        ```
        
        转换规则:
        1. text -> 合并到 content 字段（多个 text 用换行符连接）
        2. image -> 转 base64 后加入 images 数组
           - 支持本地文件路径（自动读取）
           - 支持 base64 字符串（直接使用）
           - 不支持 URL（Ollama 要求 base64）
        3. audio -> 转 base64 后加入 images 数组（与图片相同字段）
           - Ollama 的 Gemma4 模型复用 images 字段处理音频
        4. tool_calls/tool_call_id -> 保留到对应字段
        
        关键点:
        - Ollama 的 content 字段只接受纯文本，不接受数组
        - 所有多模态资源（图片/音频）都通过 images 字段传递
        - 音频和圖片在 Ollama 中都使用 images 字段（不是 audio 字段）
        """
        ollama_messages = []
        
        for msg in self._normalize_messages(messages):
            role = msg["role"]
            content_list = msg.get("content", [])
            
            text_parts = []
            images = []  # Both images and audio go here
            
            for item in content_list:
                item_type = item.get("type")
                item_content = item.get("content", "")
                
                if item_type == "text":
                    text_parts.append(str(item_content))
                
                elif item_type == "image":
                    b64 = self._to_base64(item_content)
                    if b64:
                        images.append(b64)
                
                elif item_type == "audio":
                    b64 = self._to_base64(item_content)
                    if b64:
                        images.append(b64)
            
            ollama_msg = {
                "role": role,
                "content": "\n".join(text_parts) if text_parts else ""
            }
            
            if images:
                ollama_msg["images"] = images
            
            ollama_messages.append(ollama_msg)
        
        return ollama_messages
    
    def _to_base64(self, data) -> Optional[str]:
        """Convert various data formats to base64 string"""
        if not data:
            return None
        
        # URL - return None (Ollama needs base64, not URLs)
        if isinstance(data, str) and data.startswith(("http://", "https://")):
            print("[Gemma4] Warning: URLs not supported by Ollama, need base64")
            return None
        
        # Data URL - extract base64 part
        if isinstance(data, str) and data.startswith("data:"):
            if "," in data:
                return data.split(",", 1)[-1]
            return None
        
        # Try to read as file path
        file_content = self._read_file_content(data)
        if file_content:
            return base64.b64encode(file_content).decode()
        
        # Check if already base64
        if isinstance(data, str):
            try:
                base64.b64decode(data)
                return data
            except:
                pass
        
        # Bytes
        if isinstance(data, bytes):
            return base64.b64encode(data).decode()
        
        return None
    
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
            print(f"[Gemma4] Error: {e}")
            return {
                "content": f"Error: {str(e)}",
                "role": "assistant",
                "tool_calls": None,
                "reasoning_content": None,
            }
    
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
        
        # 打印转换后的消息以便调试
        #print(f"[Gemma4] Input messages: {messages_with_system}")
        
        # Run in thread pool (ollama.chat is synchronous)
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            self._sync_chat,
            ollama_messages,
            temperature
        )
        
        return result
    
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
            print(f"[Gemma4] Stream Error: {e}")
            yield {
                "content": f"Error: {str(e)}",
                "tool_calls": None,
                "finish_reason": "error",
            }
    
    async def embedding(self, text: str) -> List[float]:
        """Embedding using Ollama library"""
        try:
            response = ollama.embeddings(
                model=self.model,
                prompt=text
            )
            return response.get("embedding", [])
        except Exception as e:
            print(f"[Gemma4] Embedding Error: {e}")
            return []
    
    async def embedding_batch(self, texts: List[str]) -> List[List[float]]:
        """Batch embedding"""
        results = []
        for text in texts:
            emb = await self.embedding(text)
            results.append(emb)
        return results
