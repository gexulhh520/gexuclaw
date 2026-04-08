# 多模态消息转换优化计划

## 用户需求

保留原有的多模态数组格式，同时把多模态内容合并到 text 中。

---

## 方案对比

### 方案 A：当前实现（纯文本替换）

```python
# 输入
{
    "role": "user",
    "content": [
        {"type": "text", "content": "请分析这张图片"},
        {"type": "image", "content": "/images/abc.png"}
    ]
}

# 输出
{
    "role": "user",
    "content": "请分析这张图片\n\n[Image Resource: /images/abc.png]"
}
```

**问题**：丢失了原有的多模态结构

---

### 方案 B：保留数组 + 合并文本（推荐）

```python
# 输入
{
    "role": "user",
    "content": [
        {"type": "text", "content": "请分析这张图片"},
        {"type": "image", "content": "/images/abc.png"}
    ]
}

# 输出
{
    "role": "user",
    "content": [
        {"type": "text", "content": "请分析这张图片\n\n[Image Resource: /images/abc.png]"},  # 合并后的文本
        {"type": "image", "content": "/images/abc.png"}  # 保留原有图片
    ]
}
```

**优点**：
- ✅ 保留原有结构
- ✅ LLM 可以识别文本描述中的资源路径
- ✅ 如果 LLM 支持多模态，也能直接处理图片

---

## 修改方案

### 修改 `_convert_multimodal_to_text` 方法

```python
def _convert_multimodal_to_text(messages: List[Dict]) -> List[Dict]:
    """
    Convert multimodal messages: keep original array + merge text description
    """
    converted = []
    
    for msg in messages:
        role = msg.get("role")
        content = msg.get("content")
        
        # If string, keep as is
        if isinstance(content, str):
            converted.append({"role": role, "content": content})
            continue
        
        # If list (multimodal), merge text + keep original structure
        if isinstance(content, list):
            text_parts = []
            resources = []
            new_content = []
            
            for item in content:
                item_type = item.get("type")
                item_content = item.get("content", "")
                
                # Keep original item
                new_content.append(item)
                
                if item_type == "text":
                    text_parts.append(item_content)
                elif item_type == "image":
                    resources.append(f"[Image Resource: {item_content}]")
                elif item_type == "audio":
                    resources.append(f"[Audio Resource: {item_content}]")
            
            # Merge text description
            merged_text = "\n".join(text_parts)
            if resources:
                merged_text += "\n\n" + "\n".join(resources)
            
            # Replace first text item with merged text
            if text_parts and new_content:
                for i, item in enumerate(new_content):
                    if item.get("type") == "text":
                        new_content[i] = {"type": "text", "content": merged_text}
                        break
            
            converted.append({"role": role, "content": new_content})
        
        else:
            converted.append({"role": role, "content": str(content)})
    
    return converted
```

---

## 示例

### 输入

```python
{
    "role": "user",
    "content": [
        {"type": "text", "content": "请分析这张图片"},
        {"type": "image", "content": "/images/abc.png"},
        {"type": "audio", "content": "/audio/test.wav"}
    ]
}
```

### 输出

```python
{
    "role": "user",
    "content": [
        {"type": "text", "content": "请分析这张图片\n\n[Image Resource: /images/abc.png]\n[Audio Resource: /audio/test.wav]"},
        {"type": "image", "content": "/images/abc.png"},
        {"type": "audio", "content": "/audio/test.wav"}
    ]
}
```

---

## 文件变更

| 文件 | 操作 |
|------|------|
| `backend/agents/executor.py` | 修改 `_convert_multimodal_to_text` 方法 |

---

## 确认

请确认这是否是您期望的行为？
