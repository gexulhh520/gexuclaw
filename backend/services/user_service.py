from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from fastapi import HTTPException, status
from models.user import User
from schemas.user import UserCreate, UserLogin, UserSettingsUpdate
from core.auth import get_password_hash, verify_password, create_access_token


class UserService:
    @staticmethod
    def create_user(db: Session, user_data: UserCreate) -> User:
        # 检查用户名是否已存在
        if db.query(User).filter(User.username == user_data.username).first():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username already registered"
            )
        
        # 检查邮箱是否已存在
        if db.query(User).filter(User.email == user_data.email).first():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already registered"
            )
        
        # 创建新用户
        hashed_password = get_password_hash(user_data.password)
        db_user = User(
            username=user_data.username,
            email=user_data.email,
            hashed_password=hashed_password
        )
        
        try:
            db.add(db_user)
            db.commit()
            db.refresh(db_user)
            return db_user
        except IntegrityError:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Registration failed"
            )
    
    @staticmethod
    def authenticate_user(db: Session, login_data: UserLogin) -> User:
        user = db.query(User).filter(User.username == login_data.username).first()
        
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect username or password"
            )
        
        if not verify_password(login_data.password, user.hashed_password):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect username or password"
            )
        
        return user
    
    @staticmethod
    def get_user_by_username(db: Session, username: str) -> User:
        return db.query(User).filter(User.username == username).first()
    
    @staticmethod
    def get_user_by_id(db: Session, user_id: int) -> User:
        return db.query(User).filter(User.id == user_id).first()

    @staticmethod
    def update_user_settings(db: Session, user: User, payload: UserSettingsUpdate) -> User:
        data = payload.model_dump(exclude_unset=True)
        for key, value in data.items():
            setattr(user, key, value)
        db.commit()
        db.refresh(user)
        return user

    @staticmethod
    def validate_notification_channel(user: User, channel: str, target_override=None, config_override=None):
        channel = (channel or "").strip().lower()
        if channel == "in_app":
            return True, "站内通知可用", {"channel": "in_app"}
        if channel == "email":
            target = target_override or user.notification_email or user.email
            enabled = bool(user.email_notifications_enabled)
            valid = bool(enabled and target)
            return valid, ("邮件通知可用" if valid else "请先在用户设置中启用邮件通知并配置邮箱"), {
                "target": target,
                "enabled": enabled,
            }
        if channel == "wechat":
            config = config_override or user.wechat_config_json or {}
            enabled = bool(user.wechat_notifications_enabled)
            required_fields = ["base_url", "conversation_id"]
            missing = [field for field in required_fields if not config.get(field)]
            valid = enabled and not missing
            return valid, ("微信通知可用" if valid else f"微信配置缺失: {', '.join(missing) or '未启用'}"), {
                "enabled": enabled,
                "missing_fields": missing,
                "channel_type": user.wechat_channel_type,
            }
        return False, "不支持的通知通道", {"channel": channel}


user_service = UserService()
