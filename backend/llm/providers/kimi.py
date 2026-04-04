import base64
from typing import Optional, List, Dict, Any, AsyncGenerator
from openai import OpenAI, AsyncOpenAI, APITimeoutError, APIError
from .base import BaseProviderImpl


class KimiProvider(BaseProviderImpl):
    """Moonshot AI (Kimi) Provider - 支持多模态"""
    
    def __init__(self, config: Dict[str, Any]):
        self.api_key = config.get("api_key", "")
        self.model_name = config.get("model", "kimi-k2.5")
        self.base_url = config.get("base_url", "https://api.moonshot.cn/v1")
        
        self.client = OpenAI(api_key=self.api_key, base_url=self.base_url)
        self.async_client = AsyncOpenAI(api_key=self.api_key, base_url=self.base_url)

    def _convert_to_provider_format(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """转换为 Kimi API 格式"""
        converted = []
        
        for msg in self._normalize_messages(messages):
            new_msg = {"role": msg["role"]}
            
            content_list = msg.get("content", [])
            kimi_content = []
            
            has_multimodal = any(item.get("type") in ["image", "audio"] for item in content_list)
            
            for item in content_list:
                item_type = item.get("type")
                
                if item_type == "text":
                    kimi_content.append({
                        "type": "text",
                        "text": item.get("content", "")
                    })
                elif item_type == "image":
                    image_data = item.get("content", "")
                    if isinstance(image_data, bytes):
                        b64 = base64.b64encode(image_data).decode()
                        url = f"data:image/png;base64,{b64}"
                    else:
                        url = str(image_data)
                    kimi_content.append({
                        "type": "image_url",
                        "image_url": {"url": url}
                    })
            
            if has_multimodal or len(kimi_content) > 1:
                new_msg["content"] = kimi_content
            else:
                new_msg["content"] = kimi_content[0]["text"] if kimi_content else ""
            
            if msg.get("tool_calls"):
                new_msg["tool_calls"] = msg["tool_calls"]
            if msg.get("tool_call_id"):
                new_msg["tool_call_id"] = msg["tool_call_id"]
            
            converted.append(new_msg)
        
        return converted

    async def chat(
        self,
        messages: List[Dict[str, Any]],
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: Optional[str] = None,
        system_prompt: Optional[str] = None,
    ) -> Dict[str, Any]:
        messages_with_system = self._add_system_prompt(messages, system_prompt)
        provider_messages = self._convert_to_provider_format(messages_with_system)
        
        kwargs = {
            "model": self.model_name,
            "messages": provider_messages,
        }
        
        if "kimi-k2" not in self.model_name:
            kwargs["temperature"] = temperature
            
        if tools is not None:
            kwargs["tools"] = tools
            
        if tool_choice is not None:
            kwargs["tool_choice"] = tool_choice
        
        try:
            response = await self.async_client.chat.completions.create(**kwargs)
        except APITimeoutError as e:
            return {
                "content": "抱歉，Kimi API 请求超时，请稍后重试。",
                "tool_calls": None,
                "role": "assistant",
                "reasoning_content": None,
                "error": "timeout",
                "error_message": str(e),
            }
        except APIError as e:
            return {
                "content": f"抱歉，Kimi API 调用失败: {e.message}",
                "tool_calls": None,
                "role": "assistant",
                "reasoning_content": None,
                "error": "api_error",
                "error_message": str(e),
            }
        except Exception as e:
            return {
                "content": f"抱歉，调用 Kimi 时发生错误: {str(e)}",
                "tool_calls": None,
                "role": "assistant",
                "reasoning_content": None,
                "error": "unknown",
                "error_message": str(e),
            }
        
        message = response.choices[0].message
        
        result = {
            "content": message.content,
            "tool_calls": None,
            "role": message.role,
            "reasoning_content": None,
        }
        
        if hasattr(message, "reasoning_content") and message.reasoning_content:
            result["reasoning_content"] = message.reasoning_content
        
        if hasattr(message, "tool_calls") and message.tool_calls:
            result["tool_calls"] = [
                {
                    "id": tc.id,
                    "type": tc.type,
                    "function": {
                        "name": tc.function.name,
                        "arguments": tc.function.arguments,
                    }
                }
                for tc in message.tool_calls
            ]
            
        return result

    async def stream(
        self,
        messages: List[Dict[str, Any]],
        temperature: float = 0.7,
        tools: Optional[List[Dict[str, Any]]] = None,
        system_prompt: Optional[str] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        messages_with_system = self._add_system_prompt(messages, system_prompt)
        provider_messages = self._convert_to_provider_format(messages_with_system)
        
        kwargs = {
            "model": self.model_name,
            "messages": provider_messages,
            "stream": True,
        }
        
        if "kimi-k2" not in self.model_name:
            kwargs["temperature"] = temperature
        
        if tools is not None:
            kwargs["tools"] = tools
        
        try:
            stream = await self.async_client.chat.completions.create(**kwargs)
        except (APITimeoutError, APIError, Exception) as e:
            yield {
                "content": f"Kimi 流式请求错误: {str(e)}",
                "finish_reason": "error",
                "error": "stream_error",
            }
            return
        
        async for chunk in stream:
            if chunk.choices:
                delta = chunk.choices[0].delta
                result = {"content": "", "finish_reason": chunk.choices[0].finish_reason}
                
                if delta.content:
                    result["content"] = delta.content
                    
                if hasattr(delta, "tool_calls") and delta.tool_calls:
                    result["tool_calls"] = [
                        {
                            "index": tc.index,
                            "id": tc.id if hasattr(tc, "id") else None,
                            "type": tc.type if hasattr(tc, "type") else "function",
                            "function": {
                                "name": tc.function.name if hasattr(tc.function, "name") else None,
                                "arguments": tc.function.arguments if hasattr(tc.function, "arguments") else "",
                            }
                        }
                        for tc in delta.tool_calls
                    ]
                
                yield result

    async def embedding(self, text: str) -> List[float]:
        response = await self.async_client.embeddings.create(
            model="moonshot-embedding",
            input=text,
        )
        return response.data[0].embedding

    async def embedding_batch(self, texts: List[str]) -> List[List[float]]:
        response = await self.async_client.embeddings.create(
            model="moonshot-embedding",
            input=texts,
        )
        return [item.embedding for item in response.data]
