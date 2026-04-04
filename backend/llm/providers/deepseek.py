import base64
from typing import Optional, List, Dict, Any, AsyncGenerator
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from .base import BaseProviderImpl


class DeepSeekProvider(BaseProviderImpl):
    """DeepSeek Provider - 支持多模态（使用 OpenAI 兼容接口）"""
    
    def __init__(self, config: Dict[str, Any]):
        self.api_key = config.get("api_key", "")
        self.model_name = config.get("model", "deepseek-chat")
        self.base_url = config.get("base_url", "https://api.deepseek.com")
        self.embeddings = OpenAIEmbeddings(
            api_key=self.api_key,
            base_url=self.base_url,
            model="deepseek-embedding",
        )

    def _convert_to_provider_format(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """转换为 DeepSeek API 格式（与 OpenAI 类似）"""
        converted = []
        
        for msg in self._normalize_messages(messages):
            new_msg = {"role": msg["role"]}
            
            content_list = msg.get("content", [])
            deepseek_content = []
            
            has_multimodal = any(item.get("type") in ["image", "audio"] for item in content_list)
            
            for item in content_list:
                item_type = item.get("type")
                
                if item_type == "text":
                    deepseek_content.append({
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
                    deepseek_content.append({
                        "type": "image_url",
                        "image_url": {"url": url}
                    })
            
            if has_multimodal or len(deepseek_content) > 1:
                new_msg["content"] = deepseek_content
            else:
                new_msg["content"] = deepseek_content[0]["text"] if deepseek_content else ""
            
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
        system_prompt: Optional[str] = None,
    ) -> Dict[str, Any]:
        from langchain_core.messages import ToolMessage
        
        messages_with_system = self._add_system_prompt(messages, system_prompt)
        provider_messages = self._convert_to_provider_format(messages_with_system)
        
        model = ChatOpenAI(
            model=self.model_name,
            api_key=self.api_key,
            base_url=self.base_url,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        
        if tools:
            model = model.bind_tools(tools)
        
        langchain_messages = []
        for msg in provider_messages:
            role = msg.get("role")
            content = msg.get("content", "")
            if isinstance(content, list):
                text_parts = [item.get("text", "") for item in content if item.get("type") == "text"]
                content = "\n".join(text_parts)
            
            if role == "system":
                from langchain_core.messages import SystemMessage
                langchain_messages.append(SystemMessage(content=content))
            elif role == "user":
                from langchain_core.messages import HumanMessage
                langchain_messages.append(HumanMessage(content=content))
            elif role == "assistant":
                from langchain_core.messages import AIMessage
                ai_msg = AIMessage(content=content)
                if msg.get("tool_calls"):
                    ai_msg.tool_calls = msg["tool_calls"]
                langchain_messages.append(ai_msg)
            elif role == "tool":
                langchain_messages.append(ToolMessage(content=str(content), tool_call_id=msg.get("tool_call_id", "")))
        
        response = await model.ainvoke(langchain_messages)
        
        result = {
            "content": response.content,
            "role": "assistant",
            "tool_calls": None,
            "reasoning_content": None,
        }
        
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

    async def stream(
        self,
        messages: List[Dict[str, Any]],
        temperature: float = 0.7,
        system_prompt: Optional[str] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        messages_with_system = self._add_system_prompt(messages, system_prompt)
        provider_messages = self._convert_to_provider_format(messages_with_system)
        
        model = ChatOpenAI(
            model=self.model_name,
            api_key=self.api_key,
            base_url=self.base_url,
            temperature=temperature,
        )
        
        langchain_messages = []
        for msg in provider_messages:
            content = msg.get("content", "")
            if isinstance(content, list):
                text_parts = [item.get("text", "") for item in content if item.get("type") == "text"]
                content = "\n".join(text_parts)
            
            if msg["role"] == "user":
                from langchain_core.messages import HumanMessage
                langchain_messages.append(HumanMessage(content=content))
            elif msg["role"] == "assistant":
                from langchain_core.messages import AIMessage
                langchain_messages.append(AIMessage(content=content))
        
        async for chunk in model.astream(langchain_messages):
            if chunk.content:
                yield {
                    "type": "token",
                    "content": chunk.content
                }
            if hasattr(chunk, "tool_calls") and chunk.tool_calls:
                yield {
                    "type": "tool_call",
                    "tool_calls": chunk.tool_calls
                }

    async def embedding(self, text: str) -> List[float]:
        return await self.embeddings.aembed_query(text)

    async def embedding_batch(self, texts: List[str]) -> List[List[float]]:
        return await self.embeddings.aembed_documents(texts)
