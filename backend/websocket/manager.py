import json
import asyncio
from typing import Dict, Set
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState
from .redis_pubsub import ws_pubsub

router = APIRouter()


class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}

    async def connect(self, session_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[session_id] = websocket
        
        # 订阅 Redis 频道，接收来自 Worker 的消息
        await ws_pubsub.subscribe(session_id, self._handle_redis_message)

    def disconnect(self, session_id: str):
        if session_id in self.active_connections:
            del self.active_connections[session_id]
        # 取消 Redis 订阅
        ws_pubsub.unsubscribe(session_id)

    async def _handle_redis_message(self, message: dict):
        """
        处理从 Redis 收到的消息（来自 Worker 进程）
        """
        session_id = message.get('_session_id')
        if session_id and session_id in self.active_connections:
            websocket = self.active_connections[session_id]
            if websocket.client_state == WebSocketState.CONNECTED:
                # 移除内部字段
                msg_to_send = {k: v for k, v in message.items() if not k.startswith('_')}
                await websocket.send_json(msg_to_send)
                print(f"[WebSocket] Message sent via Redis to {session_id}")

    async def send_personal_message(self, session_id: str, message: dict):
        """
        直接发送（用于 FastAPI 进程内部）
        """
        print(f"[WebSocket Debug] send_personal_message to {session_id}: {message}")
        if session_id in self.active_connections:
            websocket = self.active_connections[session_id]
            print(f"[WebSocket Debug] WebSocket state: {websocket.client_state}")
            if websocket.client_state == WebSocketState.CONNECTED:
                await websocket.send_json(message)
                print(f"[WebSocket Debug] Message sent successfully")
            else:
                print(f"[WebSocket Debug] WebSocket not connected, state: {websocket.client_state}")
        else:
            print(f"[WebSocket Debug] Session {session_id} not found in active connections")
            print(f"[WebSocket Debug] Active sessions: {list(self.active_connections.keys())}")

    def send_to_session(self, session_id: str, message: dict):
        """
        通过 Redis 发布消息（用于 Worker 进程）
        """
        # 添加 session_id 到消息中，方便 handler 识别
        message['_session_id'] = session_id
        ws_pubsub.publish(session_id, message)

    async def broadcast(self, message: dict):
        for session_id, connection in list(self.active_connections.items()):
            if connection.client_state == WebSocketState.CONNECTED:
                try:
                    await connection.send_json(message)
                except Exception:
                    self.disconnect(session_id)


connection_manager = ConnectionManager()


@router.websocket("/chat/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    print(f"[WebSocket Debug] New connection: {session_id}")
    await connection_manager.connect(session_id, websocket)
    print(f"[WebSocket Debug] Connected: {session_id}, total connections: {len(connection_manager.active_connections)}")
    
    try:
        while True:
            data = await websocket.receive_text()
            print(f"[WebSocket Debug] Received from {session_id}: {data}")
            
            try:
                message = json.loads(data)
                await connection_manager.send_personal_message(session_id, {
                    "type": "ack",
                    "received": message
                })
            except json.JSONDecodeError:
                await connection_manager.send_personal_message(session_id, {
                    "type": "error",
                    "message": "Invalid JSON format"
                })
    except WebSocketDisconnect:
        print(f"[WebSocket Debug] Disconnected: {session_id}")
        connection_manager.disconnect(session_id)
    except Exception as e:
        print(f"[WebSocket Debug] Error for {session_id}: {e}")
        connection_manager.disconnect(session_id)
