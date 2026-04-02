"""
Redis Pub/Sub for WebSocket cross-process communication
"""
import json
import asyncio
from typing import Dict, Any
from core.redis_client import redis_client


class WebSocketRedisPubSub:
    """
    使用 Redis Pub/Sub 实现跨进程的 WebSocket 消息推送
    """
    
    def __init__(self):
        self._pubsub = None
        self._running = False
        self._handlers: Dict[str, Any] = {}
    
    def publish(self, session_id: str, message: dict):
        """
        发布消息到 Redis
        任何订阅该频道的进程都会收到消息
        """
        channel = f"ws:{session_id}"
        redis_client.client.publish(channel, json.dumps(message))
        #print(f"[Redis Pub] Published to {channel}: {message}")
    
    async def subscribe(self, session_id: str, handler):
        """
        订阅频道并处理消息
        """
        if self._pubsub is None:
            self._pubsub = redis_client.client.pubsub()
        
        channel = f"ws:{session_id}"
        self._pubsub.subscribe(channel)
        self._handlers[session_id] = handler
        
        #print(f"[Redis Sub] Subscribed to {channel}")
        
        # 启动监听任务
        if not self._running:
            asyncio.create_task(self._listen())
    
    async def _listen(self):
        """
        监听 Redis 消息 - 使用线程池避免阻塞事件循环
        """
        self._running = True
        print("[Redis Sub] Started listening")
        
        import concurrent.futures
        loop = asyncio.get_event_loop()
        
        with concurrent.futures.ThreadPoolExecutor() as pool:
            while self._running:
                try:
                    # 在线程池中执行阻塞的 get_message
                    message = await loop.run_in_executor(
                        pool, 
                        self._pubsub.get_message, 
                        True,  # ignore_subscribe_messages
                        1.0    # timeout
                    )
                    
                    if message and message['type'] == 'message':
                        channel = message['channel'].decode()
                        session_id = channel.replace('ws:', '')
                        data = json.loads(message['data'])
                        
                        print(f"[Redis Sub] Received on {channel}: {data}")
                        
                        # 调用对应的 handler
                        if session_id in self._handlers:
                            await self._handlers[session_id](data)
                except Exception as e:
                    print(f"[Redis Sub] Error: {e}")
                
                # 短暂休眠，避免 CPU 占用过高
                await asyncio.sleep(0.001)
    
    def unsubscribe(self, session_id: str):
        """
        取消订阅
        """
        if self._pubsub and session_id in self._handlers:
            channel = f"ws:{session_id}"
            self._pubsub.unsubscribe(channel)
            del self._handlers[session_id]
            print(f"[Redis Sub] Unsubscribed from {channel}")


# 全局实例
ws_pubsub = WebSocketRedisPubSub()
