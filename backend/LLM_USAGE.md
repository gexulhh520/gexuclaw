# LLMClient 多提供商使用指南

## 概述

LLMClient 现在支持多个 LLM 提供商，包括：
- OpenAI (默认)
- DeepSeek

## 基础使用

### 1. 导入 LLMClient

```python
from llm.client import llm_client
```

### 2. 使用默认提供商 (OpenAI)

```python
# 普通对话
messages = [
    {"role": "user", "content": "你好，请介绍一下你自己"}
]
response = await llm_client.chat(messages)
print(response["content"])

# 流式输出
async for chunk in llm_client.stream(messages):
    if chunk["type"] == "token":
        print(chunk["content"], end="")
```

### 3. 指定提供商

```python
# 使用 DeepSeek
response = await llm_client.chat(messages, provider="deepseek")

# 流式使用 DeepSeek
async for chunk in llm_client.stream(messages, provider="deepseek"):
    if chunk["type"] == "token":
        print(chunk["content"], end="")
```

### 4. Embedding

```python
# 使用默认提供商
embedding = await llm_client.embedding("这是一段文本")

# 指定提供商
embedding = await llm_client.embedding("这是一段文本", provider="deepseek")

# 批量 embedding
embeddings = await llm_client.embedding_batch(["文本1", "文本2"], provider="openai")
```

## API 接口使用

### 发送消息时指定提供商

```bash
POST /api/v1/chat
Content-Type: application/json

{
  "session_id": "your-session-id",
  "content": "你好",
  "provider": "deepseek"
}
```

## 添加新的提供商

要添加新的 LLM 提供商，只需：

1. 在 `llm/client.py` 中创建新的 Provider 类，实现 `BaseProvider` 协议
2. 在 `LLMClient.__init__` 中注册新的提供商

示例：

```python
class NewProvider:
    def __init__(self, config: Dict[str, Any]):
        # 初始化配置
        pass
    
    async def chat(self, messages, temperature=0.7, max_tokens=None):
        # 实现对话逻辑
        pass
    
    async def stream(self, messages, temperature=0.7):
        # 实现流式输出
        pass
    
    async def embedding(self, text):
        # 实现 embedding
        pass
```

## 配置

在 `.env` 文件中配置各提供商的 API Key：

```env
# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4

# DeepSeek
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_MODEL=deepseek-chat
```
