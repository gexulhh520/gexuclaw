from typing import Optional, List, Dict, Any, AsyncGenerator
from openai import OpenAI, AsyncOpenAI
from .base import BaseProviderImpl


class KimiProvider(BaseProviderImpl):
    """
    Moonshot AI (Kimi) Provider
    使用 OpenAI 兼容接口
    文档: https://platform.moonshot.cn/docs/api-reference
    """

    def __init__(self, config: Dict[str, Any]):
        self.api_key = config.get("api_key", "")
        self.model_name = config.get("model", "kimi-k2.5")
        self.base_url = config.get("base_url", "https://api.moonshot.cn/v1")
        
        # 同步客户端
        self.client = OpenAI(
            api_key=self.api_key,
            base_url=self.base_url,
        )
        # 异步客户端
        self.async_client = AsyncOpenAI(
            api_key=self.api_key,
            base_url=self.base_url,
        )

    async def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        聊天完成，支持工具调用
        
        Args:
            messages: 消息列表
            temperature: 温度参数
            max_tokens: 最大 token 数
            tools: 工具列表，格式为 OpenAI 工具格式
            tool_choice: 工具选择策略，如 "auto", "none", 或指定工具
        """
        # 构建请求参数
        # Kimi 某些模型只支持 temperature=1
        kwargs = {
            "model": self.model_name,
            "messages": messages,
        }
        
        # 只有非 reasoning 模型才传 temperature
        if "kimi-k2" not in self.model_name:
            kwargs["temperature"] = temperature
        
        if max_tokens is not None:
            kwargs["max_tokens"] = max_tokens
            
        if tools is not None:
            kwargs["tools"] = tools
            
        if tool_choice is not None:
            kwargs["tool_choice"] = tool_choice
        
        # 调试日志 - 打印入参
        #print(f"[Kimi Debug] Request params: {kwargs}")
        #print(f"[Kimi Debug] Messages: {messages}")
        
        response = await self.async_client.chat.completions.create(**kwargs)
        
        message = response.choices[0].message
        
        # 调试日志 - 打印返回结果
        print(f"[Kimi Debug] Response: {message}")
        print(f"[Kimi Debug] Content: {message.content}")
        print(f"[Kimi Debug] Tool calls: {message.tool_calls if hasattr(message, 'tool_calls') else None}")
        
        result = {
            "content": message.content,
            "tool_calls": None,
            "role": message.role,
            "reasoning_content": None,
        }
        
        # 检查是否有 reasoning_content（Kimi K2 推理模型）
        if hasattr(message, "reasoning_content") and message.reasoning_content:
            result["reasoning_content"] = message.reasoning_content
        
        # 检查是否有 tool_calls
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
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        流式聊天完成，支持工具调用
        """
        # Kimi 某些模型只支持 temperature=1
        kwargs = {
            "model": self.model_name,
            "messages": messages,
            "stream": True,
        }
        
        # 只有非 reasoning 模型才传 temperature
        if "kimi-k2" not in self.model_name:
            kwargs["temperature"] = temperature
        
        if tools is not None:
            kwargs["tools"] = tools
        
        stream = await self.async_client.chat.completions.create(**kwargs)
        
        async for chunk in stream:
            if chunk.choices:
                delta = chunk.choices[0].delta
                result = {"content": "", "finish_reason": chunk.choices[0].finish_reason}
                
                if delta.content:
                    result["content"] = delta.content
                    
                # 检查是否有 tool_calls
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
        """获取文本的 embedding 向量"""
        response = await self.async_client.embeddings.create(
            model="moonshot-embedding",
            input=text,
        )
        return response.data[0].embedding

    async def embedding_batch(self, texts: List[str]) -> List[List[float]]:
        """批量获取文本的 embedding 向量"""
        response = await self.async_client.embeddings.create(
            model="moonshot-embedding",
            input=texts,
        )
        return [item.embedding for item in response.data]
