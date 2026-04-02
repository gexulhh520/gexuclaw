from typing import Optional, List, Dict, Any, AsyncGenerator, Protocol
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, SystemMessage


class BaseProvider(Protocol):
    """LLM Provider 统一接口协议"""
    
    async def chat(
        self,
        messages: List[Dict[str, Any]],  # 统一格式消息
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        tools: Optional[List[Dict[str, Any]]] = None,  # 工具列表
    ) -> Dict[str, Any]:
        """
        统一聊天接口
        
        Args:
            messages: 统一格式消息列表
                     [{"role": "user"|"assistant"|"system"|"tool", 
                       "content": str,
                       "tool_calls": [...],  # assistant 消息可选
                       "tool_call_id": str,  # tool 消息必填
                       "reasoning_content": str}]  # 可选
            temperature: 温度参数
            max_tokens: 最大 token 数
            tools: 工具定义列表
            
        Returns:
            统一格式响应:
            {
                "content": str,
                "role": str,
                "tool_calls": [...] | None,
                "reasoning_content": str | None,
            }
        """
        ...

    async def stream(
        self,
        messages: List[Dict[str, Any]],  # 统一格式消息
        temperature: float = 0.7,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        统一流式接口
        
        Yields:
            {"content": str, "tool_calls": [...], "finish_reason": str}
        """
        ...

    async def embedding(self, text: str) -> List[float]:
        ...

    async def embedding_batch(self, texts: List[str]) -> List[List[float]]:
        ...


class BaseProviderImpl:
    def _convert_messages(self, messages: List[Dict[str, str]]) -> List[BaseMessage]:
        result = []
        for msg in messages:
            role = msg.get("role")
            content = msg.get("content", "")
            if role == "system":
                result.append(SystemMessage(content=content))
            elif role == "user":
                result.append(HumanMessage(content=content))
            elif role == "assistant":
                result.append(AIMessage(content=content))
        return result
