from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from core.auth import get_current_active_user
from models.database import get_db
from models.user import User
from schemas.user import (
    ChannelValidationRequest,
    ChannelValidationResponse,
    UserSettingsResponse,
    UserSettingsUpdate,
)
from services.user_service import user_service


router = APIRouter(tags=["用户设置"])


def _serialize_settings(user: User) -> UserSettingsResponse:
    return UserSettingsResponse(
        timezone=user.timezone or "Asia/Shanghai",
        notification_email=user.notification_email,
        email_notifications_enabled=bool(user.email_notifications_enabled),
        wechat_notifications_enabled=bool(user.wechat_notifications_enabled),
        wechat_channel_type=user.wechat_channel_type or "clawbot",
        wechat_config_json=user.wechat_config_json or {},
        task_settings_json=user.task_settings_json or {},
    )


@router.get("", response_model=UserSettingsResponse)
def get_user_settings(current_user: User = Depends(get_current_active_user)):
    return _serialize_settings(current_user)


@router.put("", response_model=UserSettingsResponse)
def update_user_settings(
    payload: UserSettingsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    user = user_service.update_user_settings(db, current_user, payload)
    return _serialize_settings(user)


@router.post("/validate-channel", response_model=ChannelValidationResponse)
def validate_channel(
    payload: ChannelValidationRequest,
    current_user: User = Depends(get_current_active_user),
):
    valid, message, details = user_service.validate_notification_channel(
        current_user,
        payload.channel,
        target_override=payload.target_override,
        config_override=payload.config_override,
    )
    return {
        "channel": payload.channel,
        "valid": valid,
        "message": message,
        "details": details,
    }
