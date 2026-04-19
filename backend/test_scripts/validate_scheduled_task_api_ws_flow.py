"""
验证定时任务方案1的 API + Celery + WebSocket 真实联调。

前置要求：
- FastAPI 已启动（http://127.0.0.1:8000）
- Celery worker 已启动

覆盖链路：
1. 注册并登录测试用户
2. 创建会话
3. 连接 WebSocket
4. 发送真实聊天请求（provider=kimi）
5. 等待 scheduled_task_suggestion / done 事件
6. 回查会话消息确认 assistant 回复已落库

执行方式：
    python backend/test_scripts/validate_scheduled_task_api_ws_flow.py
"""

from __future__ import annotations

import asyncio
from pathlib import Path
import sys
import uuid

import httpx
import websockets

CURRENT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = CURRENT_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


API_BASE = "http://127.0.0.1:8000"
WS_BASE = "ws://127.0.0.1:8000"


def assert_true(condition, message: str):
    if not condition:
        raise AssertionError(message)


async def _collect_ws_events(session_id: str):
    uri = f"{WS_BASE}/ws/chat/{session_id}"
    events = []
    async with websockets.connect(uri) as websocket:
        while True:
            raw = await asyncio.wait_for(websocket.recv(), timeout=120)
            events.append(raw)
            if '"type":"done"' in raw.replace(" ", ""):
                break
    return events


async def main():
    suffix = uuid.uuid4().hex[:8]
    username = f"apiws_{suffix}"
    password = "test123456"
    email = f"{username}@example.com"

    async with httpx.AsyncClient(timeout=120.0) as client:
        register_resp = await client.post(
            f"{API_BASE}/api/auth/register",
            json={"username": username, "email": email, "password": password},
        )
        assert_true(register_resp.status_code == 200, f"注册失败: {register_resp.text}")

        login_resp = await client.post(
            f"{API_BASE}/api/auth/login",
            json={"username": username, "password": password},
        )
        assert_true(login_resp.status_code == 200, f"登录失败: {login_resp.text}")
        token = login_resp.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        session_resp = await client.post(
            f"{API_BASE}/api/sessions",
            json={"title": "scheduled task api ws test", "provider": "kimi", "model": None, "knowledge_base_ids": []},
            headers=headers,
        )
        assert_true(session_resp.status_code == 200, f"创建会话失败: {session_resp.text}")
        session_id = session_resp.json()["session_id"]

        ws_task = asyncio.create_task(_collect_ws_events(session_id))
        await asyncio.sleep(0.5)

        chat_resp = await client.post(
            f"{API_BASE}/api/v1/chat",
            json={
                "session_id": session_id,
                "content": "把刚才成功的招聘网站投递流程设成每天早上9点自动执行，并在完成后发通知",
                "provider": "kimi",
                "model": None,
                "knowledge_base_ids": [],
            },
            headers=headers,
        )
        assert_true(chat_resp.status_code == 200, f"发送消息失败: {chat_resp.text}")

        ws_events = await ws_task
        normalized_events = [event.replace(" ", "") for event in ws_events]
        assert_true(any('"type":"scheduled_task_suggestion"' in event for event in normalized_events), "缺少 scheduled_task_suggestion 事件")
        assert_true(any('"type":"done"' in event for event in normalized_events), "缺少 done 事件")

        await asyncio.sleep(1.0)
        messages_resp = await client.get(
            f"{API_BASE}/api/sessions/{session_id}/messages",
            headers=headers,
        )
        assert_true(messages_resp.status_code == 200, f"获取消息失败: {messages_resp.text}")
        messages = messages_resp.json()
        assistant_messages = [message for message in messages if message["role"] == "assistant"]
        assert_true(len(assistant_messages) > 0, "没有 assistant message")
        assistant_texts = []
        for message in assistant_messages:
            for item in message.get("content", []):
                if item.get("type") == "text":
                    assistant_texts.append(item.get("content", ""))
        assert_true(any("定时任务草案" in text for text in assistant_texts), "assistant message 未包含草案提示")

        print("[done] scheduled task api ws flow validation passed")


if __name__ == "__main__":
    asyncio.run(main())
