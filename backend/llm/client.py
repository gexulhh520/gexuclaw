from typing import Optional, List, Dict, Any, AsyncGenerator
from core.config import get_settings
from llm.providers import (
    BaseProvider,
    OpenAIProvider,
    DeepSeekProvider,
    KimiProvider,
    Gemma4Provider,
)

settings = get_settings()


class LLMClient:
    def __init__(self):
        self.providers = {
            "openai": OpenAIProvider({
                "api_key": settings.OPENAI_API_KEY,
                "model": settings.OPENAI_MODEL,
            }),
            "deepseek": DeepSeekProvider({
                "api_key": getattr(settings, "DEEPSEEK_API_KEY", ""),
                "model": getattr(settings, "DEEPSEEK_MODEL", "deepseek-chat"),
            }),
            "kimi": KimiProvider({
                "api_key": getattr(settings, "KIMI_API_KEY", ""),
                "model": getattr(settings, "KIMI_MODEL", "kimi-k2.5"),
            }),
            "gemma4": Gemma4Provider({
                "api_key": "ollama",
                "model": "gemma4:e2b",
                "base_url": "http://localhost:11434/v1",
            }),
        }
        self.default = "openai"

    def get_provider(self, name: Optional[str] = None) -> BaseProvider:
        return self.providers.get(name or self.default)

    async def chat(
        self,
        messages: List[Dict[str, Any]],
        provider: Optional[str] = None,
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        system_prompt: Optional[str] = None,
    ) -> Dict[str, Any]:
        """聊天完成"""
        provider_instance = self.get_provider(provider)
        
        return await provider_instance.chat(
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            tools=tools,
            system_prompt=system_prompt,
        )

    async def stream(
        self,
        messages: List[Dict[str, Any]],
        provider: Optional[str] = None,
        model: Optional[str] = None,
        temperature: float = 0.7,
        system_prompt: Optional[str] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """流式聊天"""
        provider_instance = self.get_provider(provider)
        
        async for chunk in provider_instance.stream(
            messages=messages,
            temperature=temperature,
            system_prompt=system_prompt,
        ):
            yield chunk


llm_client_instance = LLMClient()
