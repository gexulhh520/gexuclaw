# Gemma4 Ollama 重构计划

## 目标
将 Gemma4 Provider 从 HuggingFace Transformers 改为使用 Ollama API 实现，支持图片和音频输入。

## Ollama API 格式

### 图片输入
```bash
curl http://localhost:11434/api/chat -d '{
  "model": "gemma4:e4b",
  "messages": [{
    "role": "user",
    "content": "请描述这张图片",
    "images": ["base64编码的图片数据"]
  }],
  "stream": false
}'
```

### 音频输入（Ollama 可能未来支持）
```bash
curl http://localhost:11434/api/chat -d '{
  "model": "gemma4:e4b",
  "messages": [{
    "role": "user",
    "content": "请转录这段音频",
    "audio": ["base64编码的音频数据"]
  }],
  "stream": false
}'
```

## 文件变更

### 1. 备份旧版本
- 原 `gemma4.py` (Transformers 版本) → `gemma4_transformers.py` ✅

### 2. 重写 `gemma4.py` (Ollama 版本) ✅

#### 关键实现点

**构造函数**
```python
def __init__(self, config: Dict[str, Any]):
    self.model = config.get("model", "gemma4:e4b")
    self.base_url = config.get("base_url", "http://localhost:11434")
    self.api_chat = f"{self.base_url}/api/chat"
    self.client = httpx.AsyncClient(timeout=120.0)
```

**消息格式转换**
```python
def _convert_to_ollama_format(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    # 统一格式 → Ollama 格式
    # {"type": "text", "content": "..."} → {"role": "user", "content": "..."}
    # {"type": "image", "content": base64} → {"role": "user", "content": "...", "images": [base64]}
    # {"type": "audio", "content": base64} → {"role": "user", "content": "...", "audio": [base64]}
```

**Base64 转换**
```python
def _to_base64(self, data) -> Optional[str]:
    # 支持 str/bytes 输入，输出 base64 字符串
```

**Chat 方法**
```python
async def chat(...):
    # 1. 添加 system_prompt
    # 2. 转换消息格式
    # 3. 调用 Ollama API
    # 4. 解析响应
```

**Stream 方法**
```python
async def stream(...):
    # 1. 添加 system_prompt
    # 2. 转换消息格式
    # 3. 调用 Ollama API (stream=True)
    # 4. 逐行解析并 yield
```

## 数据流

```
用户输入
    ↓
统一格式: [{"type": "text", "content": "..."}, {"type": "image", "content": base64}]
    ↓
_convert_to_ollama_format()
    ↓
Ollama 格式: [{"role": "user", "content": "...", "images": [base64]}]
    ↓
Ollama API (http://localhost:11434/api/chat)
    ↓
返回结果
```

## 依赖

```txt
httpx>=0.26.0  # 已存在
```

## 配置

```python
# client.py
"gemma4": Gemma4Provider({
    "model": "gemma4:e4b",
    "base_url": "http://localhost:11434",
}),
```

## 状态

- [x] 备份旧版本 (gemma4_transformers.py)
- [x] 重写 gemma4.py (Ollama 版本)
- [x] 实现消息格式转换
- [x] 实现图片 base64 支持
- [x] 实现音频 base64 支持（预留）
- [x] 实现 chat 方法
- [x] 实现 stream 方法
- [ ] 测试验证
