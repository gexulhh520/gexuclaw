from typing import Optional, List, Dict, Any, AsyncGenerator
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, SystemMessage, ToolMessage
from .base import BaseProviderImpl


class OpenAIProvider(BaseProviderImpl):
    """OpenAI Provider - 支持统一消息格式"""
    
    def __init__(self, config: Dict[str, Any]):
        self.api_key = config.get("api_key", "")
        self.model_name = config.get("model", "gpt-4")
        self.base_url = config.get("base_url", None)
        self.embeddings = OpenAIEmbeddings(
            api_key=self.api_key,
            base_url=self.base_url,
        )

    async def chat(
        self,
        messages: List[Dict[str, Any]],
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """OpenAI 聊天接口，支持工具调用"""
        model = ChatOpenAI(
            model=self.model_name,
            api_key=self.api_key,
            base_url=self.base_url,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        
        # 绑定工具（如果提供）
        if tools:
            model = model.bind_tools(tools)
        
        # 转换消息为 LangChain 格式
        langchain_messages = self._convert_messages_to_langchain(messages)
        
        response = await model.ainvoke(langchain_messages)
        
        # 转换为统一格式返回
        result = {
            "content": response.content,
            "role": "assistant",
            "tool_calls": None,
            "reasoning_content": None,
        }
        
        # 处理 tool_calls
        if hasattr(response, "tool_calls") and response.tool_calls:
            result["tool_calls"] = [
                {
                    "id": tc.get("id", ""),
                    "type": "function",
                    "function": {
                        "name": tc.get("name", ""),
                        "arguments": tc.get("args", {}),
                    }
                }
                for tc in response.tool_calls
            ]
        
        return result
    
    def _convert_messages_to_langchain(self, messages: List[Dict[str, Any]]) -> List[BaseMessage]:
        """将统一格式消息转换为 LangChain 消息"""
        result = []
        for msg in messages:
            role = msg.get("role")
            content = msg.get("content", "")
            
            if role == "system":
                result.append(SystemMessage(content=content))
            elif role == "user":
                result.append(HumanMessage(content=content))
            elif role == "assistant":
                # assistant 消息可能包含 tool_calls
                ai_msg = AIMessage(content=content)
                if msg.get("tool_calls"):
                    ai_msg.tool_calls = msg["tool_calls"]
                result.append(ai_msg)
            elif role == "tool":
                # tool 消息
                result.append(ToolMessage(
                    content=content,
                    tool_call_id=msg.get("tool_call_id", "")
                ))
        return result

    async def stream(
        self,
        messages: List[Dict[str, Any]],
        temperature: float = 0.7,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """流式输出，返回统一格式"""
        model = ChatOpenAI(
            model=self.model_name,
            api_key=self.api_key,
            base_url=self.base_url,
            temperature=temperature,
        )
        langchain_messages = self._convert_messages_to_langchain(messages)
        async for chunk in model.astream(langchain_messages):
            # 返回统一格式
            result = {
                "content": "",
                "tool_calls": None,
                "finish_reason": None,
            }
            
            if chunk.content:
                result["content"] = chunk.content
            
            if hasattr(chunk, "tool_calls") and chunk.tool_calls:
                result["tool_calls"] = chunk.tool_calls
            
            yield result

    async def embedding(self, text: str) -> List[float]:
        return await self.embeddings.aembed_query(text)

    async def embedding_batch(self, texts: List[str]) -> List[List[float]]:
        return await self.embeddings.aembed_documents(texts)
