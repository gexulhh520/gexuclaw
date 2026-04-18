from typing import List, Optional

from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from core.auth import get_current_active_user
from core.config import get_settings
from models.database import get_db
from models.user import User
from schemas.knowledge_base import (
    KnowledgeBaseCreate,
    KnowledgeBaseResponse,
    KnowledgeBaseUpdate,
    KnowledgeDocumentResponse,
    KnowledgeDocumentUploadResponse,
    KnowledgeSearchRequest,
    KnowledgeSearchResponse,
)
from services.knowledge_base_service import knowledge_base_service
from tools.knowledge_tool import search_knowledge_results
from workers.document_tasks import process_document_task

settings = get_settings()

router = APIRouter(tags=["知识库"])


def _is_document_file(filename: str, content_type: str) -> bool:
    ext = filename.lower()
    return (
        ext.endswith(('.pdf', '.doc', '.docx', '.zip')) or
        content_type in settings.ALLOWED_DOCUMENT_TYPES
    )


def _ensure_upload_dir(file_type: str, date_path: str) -> Path:
    upload_dir = Path(settings.UPLOAD_DIR) / file_type / date_path
    upload_dir.mkdir(parents=True, exist_ok=True)
    return upload_dir


def _generate_filename(original_filename: str) -> str:
    import re
    import uuid

    ext = original_filename.rsplit(".", 1)[-1] if "." in original_filename else ""
    name = original_filename.rsplit(".", 1)[0] if "." in original_filename else original_filename
    safe_name = re.sub(r'[^\w\s\-\u4e00-\u9fff]', '_', name)
    if len(safe_name) > 100:
        safe_name = safe_name[:100]
    unique_id = uuid.uuid4().hex[:8]
    return f"{unique_id}_{safe_name}.{ext}" if ext else f"{unique_id}_{safe_name}"


@router.post("", response_model=KnowledgeBaseResponse)
def create_knowledge_base(
    knowledge_base_data: KnowledgeBaseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    knowledge_base = knowledge_base_service.create_knowledge_base(
        db,
        current_user.id,
        knowledge_base_data,
    )
    return knowledge_base_service.get_knowledge_base_response(db, current_user.id, knowledge_base.id)


@router.get("", response_model=List[KnowledgeBaseResponse])
def get_my_knowledge_bases(
    category: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    return knowledge_base_service.list_user_knowledge_bases(db, current_user.id, category)


@router.get("/{knowledge_base_id}", response_model=KnowledgeBaseResponse)
def get_knowledge_base(
    knowledge_base_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    return knowledge_base_service.get_knowledge_base_response(db, current_user.id, knowledge_base_id)


@router.put("/{knowledge_base_id}", response_model=KnowledgeBaseResponse)
def update_knowledge_base(
    knowledge_base_id: int,
    knowledge_base_data: KnowledgeBaseUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    knowledge_base = knowledge_base_service.update_knowledge_base(
        db,
        current_user.id,
        knowledge_base_id,
        knowledge_base_data,
    )
    return knowledge_base_service.get_knowledge_base_response(db, current_user.id, knowledge_base.id)


@router.delete("/{knowledge_base_id}")
def delete_knowledge_base(
    knowledge_base_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    knowledge_base_service.delete_knowledge_base(db, current_user.id, knowledge_base_id)
    return {"success": True, "message": "知识库已删除"}


@router.get("/{knowledge_base_id}/documents", response_model=List[KnowledgeDocumentResponse])
def get_knowledge_base_documents(
    knowledge_base_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    return knowledge_base_service.list_knowledge_base_documents(db, current_user.id, knowledge_base_id)


@router.delete("/{knowledge_base_id}/documents/{document_id}")
def delete_knowledge_base_document(
    knowledge_base_id: int,
    document_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    knowledge_base_service.delete_document(db, current_user.id, knowledge_base_id, document_id)
    return {"success": True, "message": "文档已删除"}


@router.post("/{knowledge_base_id}/documents", response_model=KnowledgeDocumentUploadResponse)
async def upload_knowledge_base_document(
    knowledge_base_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    knowledge_base = knowledge_base_service.get_user_knowledge_base_or_404(db, current_user.id, knowledge_base_id)

    if not _is_document_file(file.filename or "", file.content_type or ""):
        raise HTTPException(
            status_code=400,
            detail="Invalid document type. Allowed: PDF, Word, ZIP",
        )

    content = await file.read()
    if len(content) > settings.MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Max size: {settings.MAX_UPLOAD_SIZE // (1024 * 1024)}MB",
        )

    date_path = datetime.now().strftime("%Y/%m")
    stored_filename = _generate_filename(file.filename or "document.pdf")
    save_dir = _ensure_upload_dir("documents", date_path)
    save_path = save_dir / stored_filename

    with open(save_path, "wb") as f:
        f.write(content)

    relative_path = f"/documents/{date_path}/{stored_filename}"
    document = knowledge_base_service.create_document_record(
        db,
        user_id=current_user.id,
        knowledge_base_id=knowledge_base.id,
        original_filename=file.filename or stored_filename,
        stored_filename=stored_filename,
        file_path=relative_path,
        file_type=file.content_type or "application/octet-stream",
        status="pending",
    )

    try:
        task = process_document_task.delay(
            file_path=str(save_path),
            filename=file.filename or stored_filename,
            user_id=current_user.id,
            knowledge_base_id=knowledge_base.id,
            knowledge_base_name=knowledge_base.name,
            category=knowledge_base.category,
            document_id=document.id,
            keep_original_file=True,
        )
    except Exception as exc:
        knowledge_base_service.update_document_status(
            db,
            user_id=current_user.id,
            document_id=document.id,
            status_value="failed",
            chunks_count=0,
            error_message=str(exc),
        )
        raise HTTPException(status_code=500, detail=f"文档任务提交失败: {str(exc)}")

    return {
        "success": True,
        "document": document,
        "task_id": task.id,
        "message": "文档已上传，正在后台处理中...",
    }


@router.post("/search", response_model=KnowledgeSearchResponse)
def search_knowledge_bases(
    search_data: KnowledgeSearchRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    if not search_data.knowledge_base_ids:
        raise HTTPException(status_code=400, detail="knowledge_base_ids 不能为空")

    normalized_ids = []
    for knowledge_base_id in dict.fromkeys(search_data.knowledge_base_ids):
        knowledge_base_service.get_user_knowledge_base_or_404(db, current_user.id, knowledge_base_id)
        normalized_ids.append(knowledge_base_id)

    result = search_knowledge_results(
        query=search_data.query,
        user_id=current_user.id,
        top_k=search_data.top_k,
        knowledge_base_ids=normalized_ids,
    )
    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("error", "知识库检索失败"))

    return {
        "query": search_data.query,
        "results": result.get("results", []),
        "results_count": len(result.get("results", [])),
    }
