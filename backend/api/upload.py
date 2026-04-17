import os
import uuid
from pathlib import Path
from datetime import datetime
from typing import List
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from pydantic import BaseModel
from core.config import get_settings
from core.auth import get_current_active_user
from models.user import User
from services.document_processor import process_uploaded_documents
from workers.document_tasks import process_document_task

router = APIRouter()
settings = get_settings()


class UploadResponse(BaseModel):
    success: bool
    path: str
    url: str
    filename: str
    size: int
    content_type: str
    type: str = "file"  # image, audio, document
    processed: bool = False
    chunks_count: int = 0
    message: str = ""
    task_id: str = ""  # Celery 任务 ID，用于查询处理进度


def _ensure_upload_dir(file_type: str, date_path: str) -> Path:
    """Ensure upload directory exists and return path"""
    upload_dir = Path(settings.UPLOAD_DIR) / file_type / date_path
    upload_dir.mkdir(parents=True, exist_ok=True)
    return upload_dir


def _generate_filename(original_filename: str) -> str:
    """Generate unique filename while preserving original name"""
    import re

    ext = original_filename.rsplit(".", 1)[-1] if "." in original_filename else ""
    name = original_filename.rsplit(".", 1)[0] if "." in original_filename else original_filename

    # 清理文件名中的特殊字符，保留中文、英文、数字、空格、下划线、连字符
    safe_name = re.sub(r'[^\w\s\-\u4e00-\u9fff]', '_', name)

    # 限制文件名长度，避免过长
    if len(safe_name) > 100:
        safe_name = safe_name[:100]

    unique_id = uuid.uuid4().hex[:8]  # 使用短UUID前缀

    if ext:
        return f"{unique_id}_{safe_name}.{ext}"
    return f"{unique_id}_{safe_name}"


@router.post("/image", response_model=UploadResponse)
async def upload_image(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_active_user)
):
    """Upload image file"""
    if file.content_type not in settings.ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid image type. Allowed: {settings.ALLOWED_IMAGE_TYPES}"
        )
    
    content = await file.read()
    
    if len(content) > settings.MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Max size: {settings.MAX_UPLOAD_SIZE // (1024*1024)}MB"
        )
    
    date_path = datetime.now().strftime("%Y/%m")
    filename = _generate_filename(file.filename or "image.png")
    save_dir = _ensure_upload_dir("images", date_path)
    save_path = save_dir / filename
    
    with open(save_path, "wb") as f:
        f.write(content)
    
    relative_path = f"/images/{date_path}/{filename}"
    
    return UploadResponse(
        success=True,
        path=relative_path,
        url=f"/uploads{relative_path}",
        filename=filename,
        size=len(content),
        content_type=file.content_type
    )


@router.post("/audio", response_model=UploadResponse)
async def upload_audio(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_active_user)
):
    """Upload audio file"""
    if file.content_type not in settings.ALLOWED_AUDIO_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid audio type. Allowed: {settings.ALLOWED_AUDIO_TYPES}"
        )
    
    content = await file.read()
    
    if len(content) > settings.MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Max size: {settings.MAX_UPLOAD_SIZE // (1024*1024)}MB"
        )
    
    date_path = datetime.now().strftime("%Y/%m")
    filename = _generate_filename(file.filename or "audio.wav")
    save_dir = _ensure_upload_dir("audio", date_path)
    save_path = save_dir / filename
    
    with open(save_path, "wb") as f:
        f.write(content)
    
    relative_path = f"/audio/{date_path}/{filename}"
    
    return UploadResponse(
        success=True,
        path=relative_path,
        url=f"/uploads{relative_path}",
        filename=filename,
        size=len(content),
        content_type=file.content_type
    )


def _is_document_file(filename: str, content_type: str) -> bool:
    """判断是否为文档文件（PDF/Word/ZIP）"""
    ext = filename.lower()
    return (
        ext.endswith(('.pdf', '.doc', '.docx', '.zip')) or
        content_type in settings.ALLOWED_DOCUMENT_TYPES
    )


@router.post("/document", response_model=UploadResponse)
async def upload_document(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_active_user)
):
    """
    Upload document file (PDF, Word, ZIP)
    文档会被解析、分块、生成 embedding 并存入 LanceDB
    """
    if not _is_document_file(file.filename or "", file.content_type or ""):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid document type. Allowed: PDF, Word, ZIP"
        )

    content = await file.read()

    if len(content) > settings.MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Max size: {settings.MAX_UPLOAD_SIZE // (1024*1024)}MB"
        )

    # 保存文件
    date_path = datetime.now().strftime("%Y/%m")
    filename = _generate_filename(file.filename or "document.pdf")
    save_dir = _ensure_upload_dir("documents", date_path)
    save_path = save_dir / filename

    with open(save_path, "wb") as f:
        f.write(content)

    # 提交异步任务处理文档（不阻塞主线程）
    try:
        task = process_document_task.delay(
            file_path=str(save_path),
            filename=file.filename or "document.pdf",
            user_id=current_user.id
        )

        relative_path = f"/documents/{date_path}/{filename}"

        return UploadResponse(
            success=True,
            path=relative_path,
            url=f"/uploads{relative_path}",
            filename=filename,
            size=len(content),
            content_type=file.content_type or "application/octet-stream",
            type="document",
            processed=False,  # 标记为处理中
            chunks_count=0,
            task_id=task.id,  # 返回任务ID
            message="文档已上传，正在后台处理中..."
        )
    except Exception as e:
        # 任务提交失败，返回文件信息
        relative_path = f"/documents/{date_path}/{filename}"

        return UploadResponse(
            success=True,
            path=relative_path,
            url=f"/uploads{relative_path}",
            filename=filename,
            size=len(content),
            content_type=file.content_type or "application/octet-stream",
            type="document",
            processed=False,
            chunks_count=0,
            task_id="",
            message=f"文件已上传但处理任务提交失败: {str(e)}"
        )


@router.post("/file", response_model=UploadResponse)
async def upload_file(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_active_user)
):
    """Upload any file (image, audio, or document)"""
    if file.content_type in settings.ALLOWED_IMAGE_TYPES:
        result = await upload_image(file, current_user)
        result.type = "image"
        return result
    elif file.content_type in settings.ALLOWED_AUDIO_TYPES:
        result = await upload_audio(file, current_user)
        result.type = "audio"
        return result
    elif _is_document_file(file.filename or "", file.content_type or ""):
        return await upload_document(file, current_user)
    else:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {file.content_type}"
        )


@router.delete("/{file_type}/{year}/{month}/{filename}")
async def delete_file(
    file_type: str,
    year: str,
    month: str,
    filename: str,
    current_user: User = Depends(get_current_active_user)
):
    """Delete uploaded file"""
    if file_type not in ["images", "audio"]:
        raise HTTPException(status_code=400, detail="Invalid file type")
    
    file_path = Path(settings.UPLOAD_DIR) / file_type / year / month / filename
    
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    
    os.remove(file_path)
    
    return {"success": True, "message": "File deleted"}
