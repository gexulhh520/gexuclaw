# 多媒体文件存储方案设计

## 问题分析

用户问题：前端上传的图片/音频应该如何存储？

**当前实现**：
- `MessageContentItem.content` 字段类型为 `Text`
- 注释说明：`实际内容（文本、base64、URL等）`
- 目前没有文件上传 API，没有配置存储路径

**用户期望**：
- 图片/音频存到文件系统
- 数据库存文件路径

---

## 两种方案对比

### 方案 A：存 Base64（当前方式）

```python
# 数据库存储
{
    "type": "image",
    "content": "iVBORw0KGgoAAAANSUhEUgAA..."  # base64 字符串
}
```

**优点**：
- ✅ 简单，无需额外配置
- ✅ 数据库自包含，备份方便
- ✅ 无需处理文件路径、权限

**缺点**：
- ❌ 数据库体积大（base64 比原文件大约 33%）
- ❌ 查询性能下降
- ❌ 无法直接预览（需要前端解码）

---

### 方案 B：存文件路径（推荐）✅

```python
# 数据库存储
{
    "type": "image",
    "content": "/uploads/images/2024/04/abc123.png"  # 文件路径
}
```

**优点**：
- ✅ 数据库轻量
- ✅ 查询性能好
- ✅ 文件可直接访问（静态文件服务）
- ✅ 支持 CDN 加速

**缺点**：
- ❌ 需要文件上传 API
- ❌ 需要配置存储路径
- ❌ 备份时需要同时备份数据库和文件

---

## 推荐方案：文件存储 + 数据库存路径

### 1. 配置存储路径

```python
# core/config.py
class Settings(BaseSettings):
    # ... 其他配置 ...
    
    # 文件上传配置
    UPLOAD_DIR: str = "D:/gexuclaw_uploads"  # 或使用相对路径 "./uploads"
    MAX_UPLOAD_SIZE: int = 50 * 1024 * 1024  # 50MB
    ALLOWED_IMAGE_TYPES: list = ["image/jpeg", "image/png", "image/gif", "image/webp"]
    ALLOWED_AUDIO_TYPES: list = ["audio/wav", "audio/mp3", "audio/m4a", "audio/ogg"]
```

### 2. 目录结构

```
D:/gexuclaw_uploads/
├── images/
│   └── 2024/
│       └── 04/
│           ├── abc123.png
│           └── def456.jpg
├── audio/
│   └── 2024/
│       └── 04/
│           └── xyz789.wav
└── temp/           # 临时文件（上传中）
```

### 3. 文件上传 API

```python
# api/upload.py
from fastapi import APIRouter, UploadFile, File, HTTPException
from pathlib import Path
import uuid
from datetime import datetime
from core.config import get_settings

router = APIRouter()
settings = get_settings()

@router.post("/upload/image")
async def upload_image(file: UploadFile = File(...)):
    """上传图片"""
    # 验证文件类型
    if file.content_type not in settings.ALLOWED_IMAGE_TYPES:
        raise HTTPException(400, "Invalid image type")
    
    # 生成文件名和路径
    ext = file.filename.split(".")[-1]
    date_path = datetime.now().strftime("%Y/%m")
    filename = f"{uuid.uuid4().hex}.{ext}"
    save_dir = Path(settings.UPLOAD_DIR) / "images" / date_path
    save_dir.mkdir(parents=True, exist_ok=True)
    save_path = save_dir / filename
    
    # 保存文件
    content = await file.read()
    with open(save_path, "wb") as f:
        f.write(content)
    
    # 返回相对路径
    relative_path = f"/images/{date_path}/{filename}"
    return {
        "success": True,
        "path": relative_path,
        "url": f"/uploads{relative_path}"  # 静态文件访问 URL
    }

@router.post("/upload/audio")
async def upload_audio(file: UploadFile = File(...)):
    """上传音频"""
    # 类似实现...
```

### 4. 静态文件服务

```python
# main.py
from fastapi.staticfiles import StaticFiles
from core.config import get_settings

settings = get_settings()

# 挂载静态文件目录
app.mount("/uploads", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")
```

### 5. 数据库存储

```python
# MessageContentItem 表
{
    "type": "image",
    "content": "/images/2024/04/abc123.png",  # 相对路径
    "content_id": "image1"
}
```

### 6. 前端上传流程

```
1. 用户选择图片
    ↓
2. 前端调用 POST /api/upload/image
    ↓
3. 后端保存文件，返回路径
    ↓
4. 前端将路径放入消息 content
    ↓
5. 发送消息到 POST /api/v1/chat
```

---

## 实施步骤

| 步骤 | 文件 | 操作 |
|------|------|------|
| 1 | `core/config.py` | 添加 UPLOAD_DIR 等配置 |
| 2 | `api/upload.py` | 新建文件上传 API |
| 3 | `main.py` | 挂载静态文件目录 |
| 4 | `api/v1.py` | 调整消息处理逻辑 |
| 5 | 前端 | 添加文件上传组件 |

---

## 注意事项

1. **文件大小限制**：FastAPI 默认限制，可在配置中调整
2. **文件类型验证**：防止恶意文件上传
3. **文件名安全**：使用 UUID 避免文件名冲突和路径遍历攻击
4. **清理策略**：定期清理临时文件和孤立文件
5. **备份策略**：数据库和文件需要同时备份

---

## 是否需要实施？

请确认：
1. 是否采用文件存储方案？
2. 存储路径配置在哪里？（建议 D:/gexuclaw_uploads）
3. 是否需要支持其他文件类型（视频等）？
