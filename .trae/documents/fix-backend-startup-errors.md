# 后端启动错误修复计划

## 问题分析

### 错误 1：ModuleNotFoundError: No module named 'torch'
**文件**: [gemma4.py](file:///d:/戈旭接的项目/gexuclaw/backend/llm/providers/gemma4.py#L1)
**原因**: 当前 gemma4.py 使用了 `torch` 和 `transformers`，但 requirements.txt 中没有这些依赖

### 错误 2：Gemma4Provider 不符合统一接口
**文件**: [gemma4.py](file:///d:/戈旭接的项目/gexuclaw/backend/llm/providers/gemma4.py#L8)
**问题**:
- ❌ 没有继承 `BaseProviderImpl`
- ❌ 字段名不统一（用 `text` 而非 `content`，用 `data` 而非 `content`）
- ❌ 缺少 `async` 支持
- ❌ 缺少 `stream()`, `embedding()` 等必需方法
- ❌ 返回值格式不符合标准（返回 `tool_call` 而非 `tool_calls`）

### 错误 3：构造函数参数不匹配
**文件**: [client.py:29-33](file:///d:/戈旭接的项目/gexuclaw/backend/llm/client.py#L29-L33)
```python
"gemma4": Gemma4Provider({
    "api_key": "ollama",
    "model": "gemma4:e2b",
    "base_url": "http://localhost:11434/v1",
}),
```
但 gemma4.py 的 `__init__` 只接收 `model_id="google/gemma-4-E2B-it"`

---

## 修复方案

### Step 1: 更新 requirements.txt
添加必要的依赖：
```txt
torch>=2.0.0
transformers>=4.40.0
```

### Step 2: 重写 gemma4.py
使其完全符合 **BaseProviderImpl** 统一接口：

```python
import json
import re
from typing import Optional, List, Dict, Any, AsyncGenerator
from .base import BaseProviderImpl


class Gemma4Provider(BaseProviderImpl):
    """Gemma4 Provider - 使用 HuggingFace Transformers (本地模型)"""
    
    def __init__(self, config: Dict[str, Any]):
        self.model_id = config.get("model", "google/gemma-4-E2B-it")
        self.device = config.get("device", "auto")
        # 延迟加载模型（避免导入时立即下载）
        self._model = None
        self._processor = None
    
    @property
    def model(self):
        if self._model is None:
            import torch
            from transformers import AutoModelForMultimodalLM
            self._model = AutoModelForMultimodalLM.from_pretrained(
                self.model_id,
                device_map=self.device,
                torch_dtype=torch.float16
            )
        return self._model
    
    @property
    def processor(self):
        if self._processor is None:
            from transformers import AutoProcessor
            self._processor = AutoProcessor.from_pretrained(self.model_id)
        return self._processor
    
    def _convert_to_provider_format(self, messages):
        # 将统一格式转换为 transformers 格式
        # {"type": "text", "content": "..."} -> {"type": "text", "text": "..."}
        # {"type": "image", "content": ...} -> {"type": "image", "image": ...}
        pass
    
    async def chat(self, messages, temperature=0.7, max_tokens=None, tools=None, system_prompt=None):
        # 实现异步包装
        pass
    
    async def stream(self, messages, temperature=0.7, system_prompt=None):
        # 流式输出
        pass
    
    async def embedding(self, text):
        # 如果不支持可以抛出 NotImplementedError 或返回空列表
        return []
    
    async def embedding_batch(self, texts):
        return [[] for _ in texts]
```

---

## 执行步骤

| 步骤 | 文件 | 操作 |
|------|------|------|
| 1 | requirements.txt | 添加 torch, transformers |
| 2 | llm/providers/gemma4.py | 完全重写，符合 BaseProviderImpl |
| 3 | llm/client.py | 确认参数正确 |
| 4 | 运行测试 | python main.py 验证无报错 |

---

## 关键改动点

### gemma4.py 必须实现的方法
1. ✅ `chat(messages, temperature, max_tokens, tools, system_prompt)` -> Dict
2. ✅ `stream(messages, temperature, system_prompt)` -> AsyncGenerator
3. ✅ `embedding(text)` -> List[float]
4. ✅ `embedding_batch(texts)` -> List[List[float]]
5. ✅ `_convert_to_provider_format(messages)` -> List[Dict] (可选，用于转换消息格式)

### 返回值格式必须统一
```python
{
    "content": str,
    "role": "assistant",
    "tool_calls": [...] or None,  # 注意是复数
    "reasoning_content": str or None,
}
```

### 消息格式转换
输入（统一格式）:
```python
{"type": "text", "content": "..."}
{"type": "image", "content": bytes_or_path, "id": "optional"}
```

转换为 transformers 格式:
```python
{"type": "text", "text": "..."}       # content -> text
{"type": "image", "image": data}      # content -> image
{"type": "audio", "audio": data}      # content -> audio
```
