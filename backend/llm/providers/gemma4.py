import json
import re
import asyncio
from typing import Optional, List, Dict, Any, AsyncGenerator
from .base import BaseProviderImpl


class Gemma4Provider(BaseProviderImpl):
    """Gemma4 Provider - using HuggingFace Transformers (local model)"""
    
    def __init__(self, config: Dict[str, Any]):
        self.model_id = config.get("model", "google/gemma-4-E2B-it")
        self.device = config.get("device", "auto")
        # Lazy loading - don't load model at import time
        self._model = None
        self._processor = None
        self.cache_path = r"D:\huggingface_cache\gemma4"
    
    @property
    def model(self):
        if self._model is None:
            import torch
            from transformers import AutoModelForMultimodalLM
            print(f"[Gemma4] Loading model: {self.model_id}")
            self._model = AutoModelForMultimodalLM.from_pretrained(
                self.model_id,
                device_map=self.device,
                torch_dtype=torch.float16,
                cache_dir=self.cache_path
            )
            print("[Gemma4] Model loaded successfully")
        return self._model
    
    @property
    def processor(self):
        if self._processor is None:
            from transformers import AutoProcessor
            print(f"[Gemma4] Loading processor for: {self.model_id}")
            self._processor = AutoProcessor.from_pretrained(self.model_id,cache_dir=self.cache_path)
            print("[Gemma4] Processor loaded successfully")
        return self._processor
    
    def _convert_to_provider_format(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Convert unified format to transformers format
        
        Unified format:
        {"type": "text", "content": "..."}
        {"type": "image", "content": data, "id": "optional"}
        
        Transformers format:
        {"type": "text", "text": "..."}
        {"type": "image", "image": data}
        """
        converted = []
        
        for msg in self._normalize_messages(messages):
            role = msg["role"]
            content_list = msg.get("content", [])
            
            new_content = []
            
            for item in content_list:
                item_type = item.get("type")
                
                if item_type == "text":
                    new_content.append({
                        "type": "text",
                        "text": item.get("content", "")
                    })
                
                elif item_type == "image":
                    image_data = item.get("content")
                    new_content.append({
                        "type": "image",
                        "image": image_data
                    })
                
                elif item_type == "audio":
                    audio_data = item.get("content")
                    new_content.append({
                        "type": "audio",
                        "audio": audio_data
                    })
            
            converted.append({
                "role": role,
                "content": new_content
            })
        
        return converted

    def _parse_tool_call(self, text: str) -> Optional[Dict]:
        """Parse tool call from response text"""
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            return None
        
        try:
            data = json.loads(match.group(0))
            if "name" in data:
                return {
                    "id": f"call_{hash(text) % 10000}",
                    "type": "function",
                    "function": {
                        "name": data.get("name"),
                        "arguments": json.dumps(data.get("arguments", {}))
                    }
                }
        except Exception as e:
            print(f"[Gemma4] Failed to parse tool call: {e}")
        
        return None

    async def chat(
        self,
        messages: List[Dict[str, Any]],
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        system_prompt: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Chat completion with async wrapper"""
        # Add system prompt
        messages_with_system = self._add_system_prompt(messages, system_prompt)
        
        # Convert to provider format
        converted_messages = self._convert_to_provider_format(messages_with_system)
        
        # Run synchronous code in thread pool to avoid blocking
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, self._sync_chat, converted_messages, temperature, max_tokens)
        
        return result
    
    def _sync_chat(
        self,
        messages: List[Dict[str, Any]],
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Synchronous chat execution"""
        inputs = self.processor.apply_chat_template(
            messages,
            add_generation_prompt=True,
            return_tensors="pt"
        ).to(self.model.device)

        gen_kwargs = {
            "max_new_tokens": max_tokens or 512,
            "temperature": temperature,
        }
        
        outputs = self.model.generate(**inputs, **gen_kwargs)
        text = self.processor.decode(outputs[0], skip_special_tokens=True)
        
        tool_call = self._parse_tool_call(text) if text else None
        
        return {
            "content": text,
            "role": "assistant",
            "tool_calls": [tool_call] if tool_call else None,
            "reasoning_content": None,
        }

    async def stream(
        self,
        messages: List[Dict[str, Any]],
        temperature: float = 0.7,
        system_prompt: Optional[str] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """Stream output (simulated - Gemma4 doesn't support native streaming)"""
        messages_with_system = self._add_system_prompt(messages, system_prompt)
        converted_messages = self._convert_to_provider_format(messages_with_system)
        
        # Run sync and yield as single chunk (or implement token-by-token if needed)
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, self._sync_chat, converted_messages, temperature, None)
        
        # Yield the complete result as one chunk
        yield {
            "content": result.get("content", ""),
            "tool_calls": result.get("tool_calls"),
            "finish_reason": "stop",
        }

    async def embedding(self, text: str) -> List[float]:
        """Embedding not supported by local Gemma4 model"""
        print("[Gemma4 Warning] Embedding not supported, returning empty list")
        return []

    async def embedding_batch(self, texts: List[str]) -> List[List[float]]:
        """Batch embedding not supported"""
        print("[Gemma4 Warning] Batch embedding not supported, returning empty lists")
        return [[] for _ in texts]
