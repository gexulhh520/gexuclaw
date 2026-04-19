import smtplib
from email.mime.text import MIMEText
from typing import Any, Dict

import httpx

from core.config import get_settings
from models.user import User


class NotificationService:
    def __init__(self):
        self.settings = get_settings()

    def build_targets(self, user: User, task) -> Dict[str, Dict[str, Any]]:
        task_targets = task.notification_targets_json or {}
        return {
            "in_app": {"enabled": True},
            "email": {
                "enabled": "email" in (task.delivery_channels or []) and bool(user.email_notifications_enabled),
                "target": (
                    (task_targets.get("email") or {}).get("target")
                    or user.notification_email
                    or user.email
                ),
            },
            "wechat": {
                "enabled": "wechat" in (task.delivery_channels or []) and bool(user.wechat_notifications_enabled),
                "config": (task_targets.get("wechat") or {}).get("config") or user.wechat_config_json or {},
            },
        }

    def send_email(self, target: str, subject: str, content: str) -> Dict[str, Any]:
        if not target:
            return {"success": False, "error": "缺少邮件接收地址"}
        if not self.settings.SMTP_HOST or not self.settings.SMTP_SENDER:
            return {"success": False, "error": "SMTP 未配置"}

        message = MIMEText(content, "plain", "utf-8")
        message["Subject"] = subject
        message["From"] = self.settings.SMTP_SENDER
        message["To"] = target

        try:
            with smtplib.SMTP(self.settings.SMTP_HOST, self.settings.SMTP_PORT, timeout=30) as server:
                if self.settings.SMTP_USE_TLS:
                    server.starttls()
                if self.settings.SMTP_USERNAME:
                    server.login(self.settings.SMTP_USERNAME, self.settings.SMTP_PASSWORD)
                server.send_message(message)
            return {"success": True}
        except Exception as exc:
            return {"success": False, "error": f"邮件发送失败: {str(exc)}"}

    async def send_wechat_personal(self, config: Dict[str, Any], content: str) -> Dict[str, Any]:
        base_url = (config or {}).get("base_url")
        conversation_id = (config or {}).get("conversation_id")
        token = (config or {}).get("token")
        endpoint = (config or {}).get("send_endpoint") or "/message/send"
        if not base_url or not conversation_id:
            return {"success": False, "error": "微信配置缺少 base_url 或 conversation_id"}

        headers = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"

        payload = {
            "conversation_id": conversation_id,
            "message": content,
        }

        try:
            async with httpx.AsyncClient(timeout=self.settings.CLAWBOT_TIMEOUT_SECONDS) as client:
                response = await client.post(f"{base_url.rstrip('/')}{endpoint}", json=payload, headers=headers)
                response.raise_for_status()
                data = response.json() if response.content else {}
                return {
                    "success": True,
                    "provider_message_id": str(data.get("message_id") or data.get("id") or ""),
                    "response": data,
                }
        except Exception as exc:
            return {"success": False, "error": f"微信发送失败: {str(exc)}"}


notification_service = NotificationService()
