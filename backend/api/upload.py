import os
import uuid
from pathlib import Path
from datetime import datetime
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from pydantic import BaseModel
from core.config import get_settings
from core.auth import get_current_active_user
from models.user import User

router = APIRouter()
settings = get_settings()


class UploadResponse(BaseModel):
    success: bool
    path: str
    url: str
    filename: str
    size: int
    content_type: str


def _ensure_upload_dir(file_type: str, date_path: str) -> Path:
    """Ensure upload directory exists and return path"""
    upload_dir = Path(settings.UPLOAD_DIR) / file_type / date_path
    upload_dir.mkdir(parents=True, exist_ok=True)
    return upload_dir


def _generate_filename(original_filename: str) -> str:
    """Generate unique filename with UUID"""
    ext = original_filename.rsplit(".", 1)[-1] if "." in original_filename else ""
    return f"{uuid.uuid4().hex}.{ext}" if ext else uuid.uuid4().hex


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


@router.post("/file", response_model=UploadResponse)
async def upload_file(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_active_user)
):
    """Upload any file (image or audio)"""
    if file.content_type in settings.ALLOWED_IMAGE_TYPES:
        return await upload_image(file, current_user)
    elif file.content_type in settings.ALLOWED_AUDIO_TYPES:
        return await upload_audio(file, current_user)
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
