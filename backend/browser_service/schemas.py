from typing import Any, Dict, Optional

from pydantic import BaseModel, Field


class BrowserExecuteRequest(BaseModel):
    operation: str = Field(min_length=1)
    args: Dict[str, Any] = Field(default_factory=dict)


class BrowserExecuteResponse(BaseModel):
    success: bool
    data: Any = None
    error: Optional[str] = None
    meta: Dict[str, Any] = Field(default_factory=dict)


class BrowserHealthResponse(BaseModel):
    status: str
    service: str
