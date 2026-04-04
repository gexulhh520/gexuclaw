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

    def _get_model(self, provider: Optional[str], model: Optional[str]) -> Optional[str]:
        """获取实际使用的模型名称"""
        if model:
            return model
        # 如果没有指定模型，使用 provider 的默认模型
        provider_name = provider or self.default
        provider_config = self.providers.get(provider_name)
        if provider_config:
            return getattr(provider_config, 'model_name', None)
        return None

    async def chat(
        self,
        messages: List[Dict[str, str]],
        provider: Optional[str] = None,
        model: Optional[str] = None,  # ⭐ 新增 model 参数
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """聊天完成，支持动态指定模型"""
        provider_instance = self.get_provider(provider)
        actual_model = self._get_model(provider, model)
        
        # 如果 provider 支持动态 model 参数，传入 model
        kwargs = {
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "tools": tools,
        }
        
        # 动态更新 provider 的模型（如果指定了 model）
        if model and hasattr(provider_instance, 'model_name'):
            original_model = provider_instance.model_name
            provider_instance.model_name = model
            try:
                result = await provider_instance.chat(**kwargs)
            finally:
                provider_instance.model_name = original_model
            return result
        
        return await provider_instance.chat(**kwargs)

    async def stream(
        self,
        messages: List[Dict[str, str]],
        provider: Optional[str] = None,
        model: Optional[str] = None,  # ⭐ 新增 model 参数
        temperature: float = 0.7,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """流式聊天，支持动态指定模型"""
        provider_instance = self.get_provider(provider)
        
        # 动态更新 provider 的模型（如果指定了 model）
        if model and hasattr(provider_instance, 'model_name'):
            original_model = provider_instance.model_name
            provider_instance.model_name = model
            try:
                async for chunk in provider_instance.stream(messages, temperature=temperature):
                    yield chunk
            finally:
                provider_instance.model_name = original_model
        else:
            async for chunk in provider_instance.stream(messages, temperature=temperature):
                yield chunk

    async def embedding(self, text: str, provider: Optional[str] = None) -> List[float]:
        return await self.get_provider(provider).embedding(text)

    async def embedding_batch(self, texts: List[str], provider: Optional[str] = None) -> List[List[float]]:
        return await self.get_provider(provider).embedding_batch(texts)


llm_client = LLMClient()
