# Provider 文件路径读取与转换计划

## 问题分析

**当前实现**：
- 前端上传文件后，返回的是文件路径（如 `/images/2024/04/abc123.png`）
- 消息发送时，`content` 包含路径
- 各个 Provider 的 `_convert_to_provider_format` 方法没有正确处理文件路径

**问题代码示例**（kimi.py:38-44）：
```python
elif item_type == "image":
    image_data = item.get("content", "")
    if isinstance(image_data, bytes):
        b64 = base64.b64encode(image_data).decode()
        url = f"data:image/png;base64,{b64}"
    else:
        url = str(image_data)  # ❌ 直接把路径当 URL 用，不会读取文件
```

**期望行为**：
- 如果 `content` 是文件路径（如 `/images/2024/04/abc123.png`）
- 应该读取文件内容并转换为 base64
- 然后传给大模型 API

---

## 解决方案

### 1. 在 `base.py` 中添加文件读取方法

```python
class BaseProviderImpl:
    def _read_file_content(self, file_path: str) -> Optional[bytes]:
        """
        Read file content from path
        
        Supports:
        - Relative path: /images/2024/04/abc123.png
        - Absolute path: D:/gexuclaw_uploads/images/2024/04/abc123.png
        - URL: http://... (returns None, should be handled separately)
        - Base64: already encoded (returns None)
        """
        if not file_path:
            return None
        
        # Skip URLs and base64 data
        if file_path.startswith(("http://", "https://", "data:")):
            return None
        
        # Check if already base64
        try:
            base64.b64decode(file_path)
            return None  # Already base64, no need to read
        except:
            pass
        
        # Build full path
        from core.config import get_settings
        settings = get_settings()
        
        # Remove leading slash if present
        relative_path = file_path.lstrip("/")
        full_path = Path(settings.UPLOAD_DIR) / relative_path
        
        if not full_path.exists():
            print(f"[Provider] File not found: {full_path}")
            return None
        
        with open(full_path, "rb") as f:
            return f.read()
    
    def _content_to_base64(self, content: str, mime_type: str = None) -> Optional[str]:
        """
        Convert content to base64 string
        
        Handles:
        - File path -> read and encode
        - URL -> return as is
        - Base64 -> return as is
        - Bytes -> encode
        """
        if not content:
            return None
        
        # URL - return as is
        if content.startswith(("http://", "https://", "data:")):
            return content
        
        # Try to read as file path
        file_content = self._read_file_content(content)
        if file_content:
            return base64.b64encode(file_content).decode()
        
        # Check if already base64
        try:
            base64.b64decode(content)
            return content
        except:
            pass
        
        return None
```

### 2. 修改各个 Provider

#### kimi.py
```python
elif item_type == "image":
    image_data = item.get("content", "")
    
    # Try to read file and convert to base64
    b64 = self._content_to_base64(image_data)
    
    if b64:
        if b64.startswith("data:"):
            url = b64  # Already data URL
        else:
            url = f"data:image/png;base64,{b64}"
    else:
        url = str(image_data)  # Fallback
    
    kimi_content.append({
        "type": "image_url",
        "image_url": {"url": url}
    })
```

#### openai.py
```python
elif item_type == "image":
    image_data = item.get("content", "")
    
    # Try to read file and convert to base64
    b64 = self._content_to_base64(image_data)
    
    if b64:
        if b64.startswith("data:"):
            url = b64
        else:
            url = f"data:image/png;base64,{b64}"
    elif isinstance(image_data, bytes):
        b64 = base64.b64encode(image_data).decode()
        url = f"data:image/png;base64,{b64}"
    else:
        url = str(image_data)
    
    openai_content.append({
        "type": "image_url",
        "image_url": {"url": url}
    })
```

#### deepseek.py
类似 kimi.py 的修改

#### gemma4.py
```python
def _to_base64(self, data) -> Optional[str]:
    """Convert various data formats to base64 string"""
    if not data:
        return None
    
    # URL - return as is
    if isinstance(data, str) and data.startswith(("http://", "https://", "data:")):
        return data
    
    # Try to read as file path
    file_content = self._read_file_content(data)
    if file_content:
        return base64.b64encode(file_content).decode()
    
    # Check if already base64
    if isinstance(data, str):
        try:
            base64.b64decode(data)
            return data
        except:
            pass
    
    # Bytes
    if isinstance(data, bytes):
        return base64.b64encode(data).decode()
    
    return None
```

---

## 文件变更清单

| 文件 | 操作 |
|------|------|
| `backend/llm/providers/base.py` | 添加 `_read_file_content` 和 `_content_to_base64` 方法 |
| `backend/llm/providers/kimi.py` | 修改 `_convert_to_provider_format` 使用新方法 |
| `backend/llm/providers/openai.py` | 修改 `_convert_to_provider_format` 使用新方法 |
| `backend/llm/providers/deepseek.py` | 修改 `_convert_to_provider_format` 使用新方法 |
| `backend/llm/providers/gemma4.py` | 修改 `_to_base64` 使用新方法 |

---

## 数据流

```
前端上传文件
    ↓
POST /api/upload/image → 返回路径 "/images/2024/04/abc123.png"
    ↓
发送消息 content: [{type: "image", content: "/images/2024/04/abc123.png"}]
    ↓
Provider._convert_to_provider_format()
    ↓
_content_to_base64("/images/2024/04/abc123.png")
    ↓
_read_file_content() → 读取 D:/gexuclaw_uploads/images/2024/04/abc123.png
    ↓
base64.b64encode() → 返回 base64 字符串
    ↓
构建 data:image/png;base64,{base64_data}
    ↓
发送给大模型 API
```

---

## 实施步骤

1. **修改 base.py** - 添加文件读取方法
2. **修改 kimi.py** - 使用新方法处理图片路径
3. **修改 openai.py** - 使用新方法处理图片/音频路径
4. **修改 deepseek.py** - 使用新方法处理图片路径
5. **修改 gemma4.py** - 使用新方法处理图片/音频路径
6. **测试验证** - 上传图片并发送消息
