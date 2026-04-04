import base64
from typing import Optional, List, Dict, Any, AsyncGenerator
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, SystemMessage, ToolMessage
from .base import BaseProviderImpl


class OpenAIProvider(BaseProviderImpl):
    """OpenAI Provider - 支持多模态（文本、图片、音频）"""
    
    def __init__(self, config: Dict[str, Any]):
        self.api_key = config.get("api_key", "")
        self.model_name = config.get("model", "gpt-4")
        self.base_url = config.get("base_url", None)
        self.embeddings = OpenAIEmbeddings(
            api_key=self.api_key,
            base_url=self.base_url,
        )

    def _convert_to_provider_format(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        转换为 OpenAI API 多模态格式
        
        支持格式：
        - 纯文本：{"type": "text", "content": "..."}
        - 图片：{"type": "image", "content": "base64或URL", "id": "optional"}
        - 音频：{"type": "audio", "content": "base64", "format": "wav"}
        """
        converted = []
        
        for msg in self._normalize_messages(messages):
            new_msg = {"role": msg["role"]}
            
            content_list = msg.get("content", [])
            openai_content = []
            
            has_multimodal = any(item.get("type") in ["image", "audio", "video"] for item in content_list)
            
            for item in content_list:
                item_type = item.get("type")
                
                if item_type == "text":
                    openai_content.append({
                        "type": "text",
                        "text": item.get("content", "")
                    })
                    
                elif item_type == "image":
                    image_data = item.get("content", "")
                    
                    if isinstance(image_data, bytes):
                        b64 = base64.b64encode(image_data).decode()
                        mime = item.get("mime_type", "image/png")
                        url = f"data:{mime};base64,{b64}"
                    elif isinstance(image_data, str) and image_data.startswith(("http://", "https://", "data:")):
                        url = image_data
                    elif isinstance(image_data, str):
                        b64 = base64.b64encode(image_data.encode()).decode()
                        url = f"data:image/png;base64,{b64}"
                    else:
                        url = str(image_data)
                    
                    openai_content.append({
                        "type": "image_url",
                        "image_url": {"url": url}
                    })
                    
                elif item_type == "audio":
                    audio_data = item.get("content", "")
                    
                    if isinstance(audio_data, bytes):
                        b64 = base64.b64encode(audio_data).decode()
                    elif isinstance(audio_data, str):
                        try:
                            b64 = base64.b64encode(audio_data.encode()).decode()
                        except:
                            b64 = audio_data
                    else:
                        b64 = str(audio_data)
                    
                    openai_content.append({
                        "type": "input_audio",
                        "input_audio": {
                            "data": b64,
                            "format": item.get("format", "wav")
                        }
                    })
            
            if has_multimodal or len(openai_content) > 1:
                new_msg["content"] = openai_content
            else:
                new_msg["content"] = openai_content[0]["text"] if openai_content else ""
            
            if msg.get("tool_calls"):
                new_msg["tool_calls"] = msg["tool_calls"]
            if msg.get("tool_call_id"):
                new_msg["tool_call_id"] = msg["tool_call_id"]
                
            converted.append(new_msg)
        
        return converted

    def _to_langchain(self, messages: List[Dict[str, Any]]) -> List[BaseMessage]:
        """将转换后的消息转为 LangChain 格式"""
        result = []
        for msg in messages:
            role = msg.get("role")
            content = msg.get("content", "")
            
            if role == "system":
                if isinstance(content, list):
                    text_parts = [item.get("text", "") for item in content if item.get("type") == "text"]
                    content = "\n".join(text_parts)
                result.append(SystemMessage(content=content))
            elif role == "user":
                if isinstance(content, list):
                    text_parts = [item.get("text", "") for item in content if item.get("type") == "text"]
                    content = "\n".join(text_parts)
                result.append(HumanMessage(content=content))
            elif role == "assistant":
                ai_msg = AIMessage(content=content if isinstance(content, str) else str(content))
                if msg.get("tool_calls"):
                    ai_msg.tool_calls = msg["tool_calls"]
                result.append(ai_msg)
            elif role == "tool":
                result.append(ToolMessage(
                    content=str(content),
                    tool_call_id=msg.get("tool_call_id", "")
                ))
        return result

    async def chat(
        self,
        messages: List[Dict[str, Any]],
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        system_prompt: Optional[str] = None,
    ) -> Dict[str, Any]:
        """OpenAI 聊天接口，支持多模态和工具调用"""
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
        
        langchain_messages = self._to_langchain(provider_messages)
        
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
        """流式输出，返回统一格式"""
        messages_with_system = self._add_system_prompt(messages, system_prompt)
        provider_messages = self._convert_to_provider_format(messages_with_system)
        
        model = ChatOpenAI(
            model=self.model_name,
            api_key=self.api_key,
            base_url=self.base_url,
            temperature=temperature,
        )
        langchain_messages = self._to_langchain(provider_messages)
        
        async for chunk in model.astream(langchain_messages):
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
