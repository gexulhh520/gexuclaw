from pydantic import BaseModel, EmailStr, Field
from datetime import datetime
from typing import Any, Dict, Optional


class UserBase(BaseModel):
    username: str
    email: EmailStr


class UserCreate(UserBase):
    password: str


class UserLogin(BaseModel):
    username: str
    password: str


class UserResponse(UserBase):
    id: int
    is_active: bool
    timezone: str = "Asia/Shanghai"
    notification_email: Optional[EmailStr] = None
    email_notifications_enabled: bool = False
    wechat_notifications_enabled: bool = False
    wechat_channel_type: str = "clawbot"
    wechat_config_json: Dict[str, Any] = Field(default_factory=dict)
    task_settings_json: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    
    class Config:
        from_attributes = True


class UserSettingsResponse(BaseModel):
    timezone: str = "Asia/Shanghai"
    notification_email: Optional[EmailStr] = None
    email_notifications_enabled: bool = False
    wechat_notifications_enabled: bool = False
    wechat_channel_type: str = "clawbot"
    wechat_config_json: Dict[str, Any] = Field(default_factory=dict)
    task_settings_json: Dict[str, Any] = Field(default_factory=dict)


class UserSettingsUpdate(BaseModel):
    timezone: Optional[str] = None
    notification_email: Optional[EmailStr] = None
    email_notifications_enabled: Optional[bool] = None
    wechat_notifications_enabled: Optional[bool] = None
    wechat_channel_type: Optional[str] = None
    wechat_config_json: Optional[Dict[str, Any]] = None
    task_settings_json: Optional[Dict[str, Any]] = None


class ChannelValidationRequest(BaseModel):
    channel: str
    target_override: Optional[str] = None
    config_override: Optional[Dict[str, Any]] = None


class ChannelValidationResponse(BaseModel):
    channel: str
    valid: bool
    message: str
    details: Dict[str, Any] = Field(default_factory=dict)


class Token(BaseModel):
    access_token: str
    token_type: str
    user: UserResponse
