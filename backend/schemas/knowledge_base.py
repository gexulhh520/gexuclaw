from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field


class KnowledgeBaseBase(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    category: Optional[str] = Field(default=None, max_length=100)
    description: Optional[str] = Field(default=None, max_length=1000)


class KnowledgeBaseCreate(KnowledgeBaseBase):
    pass


class KnowledgeBaseUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    category: Optional[str] = Field(default=None, max_length=100)
    description: Optional[str] = Field(default=None, max_length=1000)


class KnowledgeBaseResponse(KnowledgeBaseBase):
    id: int
    user_id: int
    is_default: bool
    document_count: int = 0
    chunk_count: int = 0
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class KnowledgeDocumentResponse(BaseModel):
    id: int
    knowledge_base_id: int
    user_id: int
    original_filename: str
    stored_filename: str
    file_path: str
    file_type: str
    status: str
    chunks_count: int
    error_message: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class KnowledgeDocumentUploadResponse(BaseModel):
    success: bool
    document: KnowledgeDocumentResponse
    task_id: str = ""
    message: str = ""


class KnowledgeSearchRequest(BaseModel):
    query: str = Field(min_length=1)
    knowledge_base_ids: List[int] = Field(default_factory=list)
    top_k: int = Field(default=8, ge=1, le=20)


class KnowledgeSearchResult(BaseModel):
    content: str
    knowledge_base_id: Optional[int] = None
    knowledge_base_name: Optional[str] = None
    category: Optional[str] = None
    document_id: Optional[int] = None
    filename: str
    chunk_index: int
    score: Optional[float] = None


class KnowledgeSearchResponse(BaseModel):
    query: str
    results: List[KnowledgeSearchResult]
    results_count: int
