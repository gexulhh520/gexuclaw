import base64
from typing import Optional, List, Dict, Any, AsyncGenerator, Union
from openai import OpenAI, AsyncOpenAI, APITimeoutError, APIError
from .base import BaseProviderImpl


class Gemma4Provider(BaseProviderImpl):
    """
    Gemma4 Provider
    使用 OpenAI 兼容接口，支持音频和图片输入
    """

    def __init__(self, config: Dict[str, Any]):
        self.api_key = config.get("api_key", "EMPTY")
        self.model_name = config.get("model", "gemma4:e2b")
        self.base_url = config.get("base_url", "http://localhost:11434/v1")
        
        self.client = OpenAI(
            api_key=self.api_key,
            base_url=self.base_url,
        )
        self.async_client = AsyncOpenAI(
            api_key=self.api_key,
            base_url=self.base_url,
        )

    def _convert_messages(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        converted_messages = []
        
        for msg in messages:
            role = msg.get("role")
            content = msg.get("content")
            
            converted_msg = {"role": role}
            
            if isinstance(content, str):
                if "audio" in msg or "audio_data" in msg or "audio_url" in msg:
                    content_parts = [{"type": "text", "text": content}]
                    
                    if "audio" in msg:
                        audio_info = msg["audio"]
                        if isinstance(audio_info, dict):
                            if "data" in audio_info:
                                if isinstance(audio_info["data"], bytes):
                                    audio_base64 = base64.b64encode(audio_info["data"]).decode("utf-8")
                                else:
                                    audio_base64 = audio_info["data"]
                                content_parts.append({
                                    "type": "input_audio",
                                    "input_audio": {
                                        "data": audio_base64,
                                        "format": audio_info.get("format", "wav"),
                                    }
                                })
                            elif "url" in audio_info:
                                content_parts.append({
                                    "type": "input_audio",
                                    "input_audio": {
                                        "data": audio_info["url"],
                                        "format": audio_info.get("format", "wav"),
                                    }
                                })
                    
                    if "audio_data" in msg:
                        audio_data = msg["audio_data"]
                        if isinstance(audio_data, bytes):
                            audio_base64 = base64.b64encode(audio_data).decode("utf-8")
                        else:
                            audio_base64 = audio_data
                        content_parts.append({
                            "type": "input_audio",
                            "input_audio": {
                                "data": audio_base64,
                                "format": msg.get("audio_format", "wav"),
                            }
                        })
                    
                    if "audio_url" in msg:
                        content_parts.append({
                            "type": "input_audio",
                            "input_audio": {
                                "data": msg["audio_url"],
                                "format": msg.get("audio_format", "wav"),
                            }
                        })
                    
                    converted_msg["content"] = content_parts
                elif "image" in msg or "image_data" in msg or "image_url" in msg:
                    content_parts = [{"type": "text", "text": content}]
                    
                    if "image" in msg:
                        image_info = msg["image"]
                        if isinstance(image_info, dict):
                            if "data" in image_info:
                                if isinstance(image_info["data"], bytes):
                                    image_base64 = base64.b64encode(image_info["data"]).decode("utf-8")
                                else:
                                    image_base64 = image_info["data"]
                                mime_type = image_info.get("mime_type", "image/png")
                                content_parts.append({
                                    "type": "image_url",
                                    "image_url": {
                                        "url": f"data:{mime_type};base64,{image_base64}"
                                    }
                                })
                            elif "url" in image_info:
                                content_parts.append({
                                    "type": "image_url",
                                    "image_url": {"url": image_info["url"]}
                                })
                    
                    if "image_data" in msg:
                        image_data = msg["image_data"]
                        if isinstance(image_data, bytes):
                            image_base64 = base64.b64encode(image_data).decode("utf-8")
                        else:
                            image_base64 = image_data
                        mime_type = msg.get("image_mime_type", "image/png")
                        content_parts.append({
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{mime_type};base64,{image_base64}"
                            }
                        })
                    
                    if "image_url" in msg:
                        content_parts.append({
                            "type": "image_url",
                            "image_url": {"url": msg["image_url"]}
                        })
                    
                    converted_msg["content"] = content_parts
                else:
                    converted_msg["content"] = content
            elif isinstance(content, list):
                converted_content = []
                for item in content:
                    if isinstance(item, dict):
                        item_type = item.get("type")
                        
                        if item_type == "text":
                            converted_content.append(item)
                        elif item_type == "image" or item_type == "image_url":
                            if "image_url" in item:
                                converted_content.append({
                                    "type": "image_url",
                                    "image_url": item["image_url"]
                                })
                            elif "url" in item:
                                converted_content.append({
                                    "type": "image_url",
                                    "image_url": {"url": item["url"]}
                                })
                            elif "data" in item:
                                image_data = item["data"]
                                if isinstance(image_data, bytes):
                                    image_base64 = base64.b64encode(image_data).decode("utf-8")
                                else:
                                    image_base64 = image_data
                                mime_type = item.get("mime_type", "image/png")
                                converted_content.append({
                                    "type": "image_url",
                                    "image_url": {
                                        "url": f"data:{mime_type};base64,{image_base64}"
                                    }
                                })
                        elif item_type == "audio" or item_type == "input_audio":
                            if "input_audio" in item:
                                converted_content.append({
                                    "type": "input_audio",
                                    "input_audio": item["input_audio"]
                                })
                            elif "data" in item:
                                audio_data = item["data"]
                                if isinstance(audio_data, bytes):
                                    audio_base64 = base64.b64encode(audio_data).decode("utf-8")
                                else:
                                    audio_base64 = audio_data
                                converted_content.append({
                                    "type": "input_audio",
                                    "input_audio": {
                                        "data": audio_base64,
                                        "format": item.get("format", "wav"),
                                    }
                                })
                            elif "url" in item:
                                converted_content.append({
                                    "type": "input_audio",
                                    "input_audio": {
                                        "data": item["url"],
                                        "format": item.get("format", "wav"),
                                    }
                                })
                        else:
                            converted_content.append(item)
                    else:
                        converted_content.append({"type": "text", "text": str(item)})
                
                converted_msg["content"] = converted_content
            else:
                converted_msg["content"] = str(content) if content else ""
            
            if role == "assistant" and msg.get("tool_calls"):
                converted_msg["tool_calls"] = msg["tool_calls"]
            
            if role == "tool":
                if msg.get("tool_call_id"):
                    converted_msg["tool_call_id"] = msg["tool_call_id"]
            
            converted_messages.append(converted_msg)
        
        return converted_messages

    async def chat(
        self,
        messages: List[Dict[str, Any]],
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: Optional[str] = None,
    ) -> Dict[str, Any]:
        converted_messages = self._convert_messages(messages)
        
        kwargs = {
            "model": self.model_name,
            "messages": converted_messages,
            "temperature": temperature,
        }
        
        if max_tokens is not None:
            kwargs["max_tokens"] = max_tokens
            
        if tools is not None:
            kwargs["tools"] = tools
            
        if tool_choice is not None:
            kwargs["tool_choice"] = tool_choice
        
        print(f"[Gemma4 Debug] Request params: {kwargs}")
        
        try:
            response = await self.async_client.chat.completions.create(**kwargs)
        except APITimeoutError as e:
            print(f"[Gemma4 Error] 请求超时: {e}")
            return {
                "content": "抱歉，Gemma4 API 请求超时，请稍后重试。",
                "tool_calls": None,
                "role": "assistant",
                "reasoning_content": None,
                "error": "timeout",
                "error_message": str(e),
            }
        except APIError as e:
            print(f"[Gemma4 Error] API 错误: {e}")
            return {
                "content": f"抱歉，Gemma4 API 调用失败: {e.message}",
                "tool_calls": None,
                "role": "assistant",
                "reasoning_content": None,
                "error": "api_error",
                "error_message": str(e),
            }
        except Exception as e:
            print(f"[Gemma4 Error] 未知错误: {e}")
            return {
                "content": f"抱歉，调用 Gemma4 时发生错误: {str(e)}",
                "tool_calls": None,
                "role": "assistant",
                "reasoning_content": None,
                "error": "unknown",
                "error_message": str(e),
            }
        
        message = response.choices[0].message
        
        print(f"[Gemma4 Debug] Response: {message}")
        
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

    async def chat_with_audio(
        self,
        text: str,
        audio_data: bytes,
        audio_format: str = "wav",
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
    ) -> Dict[str, Any]:
        audio_base64 = base64.b64encode(audio_data).decode("utf-8")
        
        messages = [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": text,
                    },
                    {
                        "type": "input_audio",
                        "input_audio": {
                            "data": audio_base64,
                            "format": audio_format,
                        }
                    }
                ]
            }
        ]
        
        return await self.chat(
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )

    async def chat_with_audio_file(
        self,
        text: str,
        audio_file_path: str,
        audio_format: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
    ) -> Dict[str, Any]:
        if audio_format is None:
            audio_format = audio_file_path.split(".")[-1].lower()
        
        with open(audio_file_path, "rb") as f:
            audio_data = f.read()
        
        return await self.chat_with_audio(
            text=text,
            audio_data=audio_data,
            audio_format=audio_format,
            temperature=temperature,
            max_tokens=max_tokens,
        )

    async def stream(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        converted_messages = self._convert_messages(messages)
        
        kwargs = {
            "model": self.model_name,
            "messages": converted_messages,
            "stream": True,
            "temperature": temperature,
        }
        
        if tools is not None:
            kwargs["tools"] = tools
        
        try:
            stream = await self.async_client.chat.completions.create(**kwargs)
        except APITimeoutError as e:
            print(f"[Gemma4 Error] 流式请求超时: {e}")
            yield {
                "content": "抱歉，Gemma4 API 请求超时，请稍后重试。",
                "finish_reason": "error",
                "error": "timeout",
            }
            return
        except APIError as e:
            print(f"[Gemma4 Error] 流式 API 错误: {e}")
            yield {
                "content": f"抱歉，Gemma4 API 调用失败: {e.message}",
                "finish_reason": "error",
                "error": "api_error",
            }
            return
        except Exception as e:
            print(f"[Gemma4 Error] 流式未知错误: {e}")
            yield {
                "content": f"抱歉，调用 Gemma4 时发生错误: {str(e)}",
                "finish_reason": "error",
                "error": "unknown",
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
            model=self.model_name,
            input=text,
        )
        return response.data[0].embedding

    async def embedding_batch(self, texts: List[str]) -> List[List[float]]:
        response = await self.async_client.embeddings.create(
            model=self.model_name,
            input=texts,
        )
        return [item.embedding for item in response.data]
