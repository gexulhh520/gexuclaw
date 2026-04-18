from pathlib import Path
from typing import List, Optional

import lancedb
from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from core.config import get_settings
from models.knowledge_base import KnowledgeBase, KnowledgeDocument
from schemas.knowledge_base import KnowledgeBaseCreate, KnowledgeBaseUpdate

settings = get_settings()


class KnowledgeBaseService:
    @staticmethod
    def _normalize_text(value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @staticmethod
    def _build_response_payload(db: Session, knowledge_base: KnowledgeBase) -> dict:
        stats = db.query(
            func.count(KnowledgeDocument.id),
            func.coalesce(func.sum(KnowledgeDocument.chunks_count), 0),
        ).filter(
            KnowledgeDocument.knowledge_base_id == knowledge_base.id
        ).one()

        document_count, chunk_count = stats

        return {
            "id": knowledge_base.id,
            "user_id": knowledge_base.user_id,
            "name": knowledge_base.name,
            "category": knowledge_base.category,
            "description": knowledge_base.description,
            "is_default": knowledge_base.is_default,
            "document_count": int(document_count or 0),
            "chunk_count": int(chunk_count or 0),
            "created_at": knowledge_base.created_at,
            "updated_at": knowledge_base.updated_at,
        }

    @staticmethod
    def create_knowledge_base(
        db: Session,
        user_id: int,
        knowledge_base_data: KnowledgeBaseCreate,
    ) -> KnowledgeBase:
        name = knowledge_base_data.name.strip()
        category = KnowledgeBaseService._normalize_text(knowledge_base_data.category)
        description = KnowledgeBaseService._normalize_text(knowledge_base_data.description)

        existing = db.query(KnowledgeBase).filter(
            KnowledgeBase.user_id == user_id,
            KnowledgeBase.name == name,
        ).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="知识库名称已存在",
            )

        knowledge_base = KnowledgeBase(
            user_id=user_id,
            name=name,
            category=category,
            description=description,
        )
        db.add(knowledge_base)
        db.commit()
        db.refresh(knowledge_base)
        return knowledge_base

    @staticmethod
    def list_user_knowledge_bases(
        db: Session,
        user_id: int,
        category: Optional[str] = None,
    ) -> List[dict]:
        query = db.query(KnowledgeBase).filter(KnowledgeBase.user_id == user_id)
        normalized_category = KnowledgeBaseService._normalize_text(category)
        if normalized_category:
            query = query.filter(KnowledgeBase.category == normalized_category)

        knowledge_bases = query.order_by(KnowledgeBase.updated_at.desc(), KnowledgeBase.id.desc()).all()
        return [KnowledgeBaseService._build_response_payload(db, kb) for kb in knowledge_bases]

    @staticmethod
    def get_user_knowledge_base(
        db: Session,
        user_id: int,
        knowledge_base_id: int,
    ) -> Optional[KnowledgeBase]:
        return db.query(KnowledgeBase).filter(
            KnowledgeBase.id == knowledge_base_id,
            KnowledgeBase.user_id == user_id,
        ).first()

    @staticmethod
    def get_user_knowledge_base_or_404(
        db: Session,
        user_id: int,
        knowledge_base_id: int,
    ) -> KnowledgeBase:
        knowledge_base = KnowledgeBaseService.get_user_knowledge_base(db, user_id, knowledge_base_id)
        if not knowledge_base:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="知识库不存在",
            )
        return knowledge_base

    @staticmethod
    def get_knowledge_base_response(
        db: Session,
        user_id: int,
        knowledge_base_id: int,
    ) -> dict:
        knowledge_base = KnowledgeBaseService.get_user_knowledge_base_or_404(db, user_id, knowledge_base_id)
        return KnowledgeBaseService._build_response_payload(db, knowledge_base)

    @staticmethod
    def update_knowledge_base(
        db: Session,
        user_id: int,
        knowledge_base_id: int,
        knowledge_base_data: KnowledgeBaseUpdate,
    ) -> KnowledgeBase:
        knowledge_base = KnowledgeBaseService.get_user_knowledge_base_or_404(db, user_id, knowledge_base_id)

        update_data = knowledge_base_data.model_dump(exclude_unset=True)
        if "name" in update_data and update_data["name"] is not None:
            new_name = update_data["name"].strip()
            duplicate = db.query(KnowledgeBase).filter(
                KnowledgeBase.user_id == user_id,
                KnowledgeBase.name == new_name,
                KnowledgeBase.id != knowledge_base_id,
            ).first()
            if duplicate:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="知识库名称已存在",
                )
            knowledge_base.name = new_name

        if "category" in update_data:
            knowledge_base.category = KnowledgeBaseService._normalize_text(update_data["category"])

        if "description" in update_data:
            knowledge_base.description = KnowledgeBaseService._normalize_text(update_data["description"])

        db.commit()
        db.refresh(knowledge_base)
        return knowledge_base

    @staticmethod
    def delete_knowledge_base(
        db: Session,
        user_id: int,
        knowledge_base_id: int,
    ) -> None:
        knowledge_base = KnowledgeBaseService.get_user_knowledge_base_or_404(db, user_id, knowledge_base_id)
        documents = db.query(KnowledgeDocument).filter(
            KnowledgeDocument.user_id == user_id,
            KnowledgeDocument.knowledge_base_id == knowledge_base_id,
        ).all()

        for document in documents:
            KnowledgeBaseService._delete_document_vectors(user_id, document.id)
            KnowledgeBaseService._delete_uploaded_file(document.file_path)

        db.delete(knowledge_base)
        db.commit()

    @staticmethod
    def list_knowledge_base_documents(
        db: Session,
        user_id: int,
        knowledge_base_id: int,
    ) -> List[KnowledgeDocument]:
        KnowledgeBaseService.get_user_knowledge_base_or_404(db, user_id, knowledge_base_id)
        return db.query(KnowledgeDocument).filter(
            KnowledgeDocument.user_id == user_id,
            KnowledgeDocument.knowledge_base_id == knowledge_base_id,
        ).order_by(KnowledgeDocument.created_at.desc(), KnowledgeDocument.id.desc()).all()

    @staticmethod
    def create_document_record(
        db: Session,
        user_id: int,
        knowledge_base_id: int,
        original_filename: str,
        stored_filename: str,
        file_path: str,
        file_type: str,
        status: str = "pending",
    ) -> KnowledgeDocument:
        KnowledgeBaseService.get_user_knowledge_base_or_404(db, user_id, knowledge_base_id)

        document = KnowledgeDocument(
            knowledge_base_id=knowledge_base_id,
            user_id=user_id,
            original_filename=original_filename,
            stored_filename=stored_filename,
            file_path=file_path,
            file_type=file_type,
            status=status,
            chunks_count=0,
            error_message=None,
        )
        db.add(document)
        db.commit()
        db.refresh(document)
        return document

    @staticmethod
    def get_user_document(
        db: Session,
        user_id: int,
        knowledge_base_id: int,
        document_id: int,
    ) -> Optional[KnowledgeDocument]:
        return db.query(KnowledgeDocument).filter(
            KnowledgeDocument.id == document_id,
            KnowledgeDocument.user_id == user_id,
            KnowledgeDocument.knowledge_base_id == knowledge_base_id,
        ).first()

    @staticmethod
    def get_user_document_or_404(
        db: Session,
        user_id: int,
        knowledge_base_id: int,
        document_id: int,
    ) -> KnowledgeDocument:
        document = KnowledgeBaseService.get_user_document(db, user_id, knowledge_base_id, document_id)
        if not document:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="知识库文档不存在",
            )
        return document

    @staticmethod
    def update_document_status(
        db: Session,
        user_id: int,
        document_id: int,
        status_value: str,
        chunks_count: Optional[int] = None,
        error_message: Optional[str] = None,
    ) -> Optional[KnowledgeDocument]:
        document = db.query(KnowledgeDocument).filter(
            KnowledgeDocument.id == document_id,
            KnowledgeDocument.user_id == user_id,
        ).first()
        if not document:
            return None

        document.status = status_value
        if chunks_count is not None:
            document.chunks_count = chunks_count
        document.error_message = error_message
        db.commit()
        db.refresh(document)
        return document

    @staticmethod
    def delete_document(
        db: Session,
        user_id: int,
        knowledge_base_id: int,
        document_id: int,
    ) -> None:
        document = KnowledgeBaseService.get_user_document_or_404(db, user_id, knowledge_base_id, document_id)
        KnowledgeBaseService._delete_document_vectors(user_id, document.id)
        KnowledgeBaseService._delete_uploaded_file(document.file_path)
        db.delete(document)
        db.commit()

    @staticmethod
    def _delete_uploaded_file(file_path: str) -> None:
        if not file_path:
            return

        normalized = file_path.lstrip("/\\")
        full_path = Path(settings.UPLOAD_DIR) / normalized.replace("/", "\\")
        try:
            if full_path.exists():
                full_path.unlink()
        except Exception:
            pass

    @staticmethod
    def _delete_document_vectors(user_id: int, document_id: int) -> None:
        try:
            db = lancedb.connect(settings.LANCEDB_URI)
            table_name = f"{settings.LANCEDB_TABLE_PREFIX}{user_id}"
            if table_name not in db.table_names():
                return

            table = db.open_table(table_name)
            table.delete(f"document_id = {document_id}")
        except Exception:
            pass


knowledge_base_service = KnowledgeBaseService()
