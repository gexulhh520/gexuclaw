import redis
import json
from typing import Optional, Any
from core.config import get_settings

settings = get_settings()


class RedisClient:
    def __init__(self, url: str = None):
        self.url = url or settings.REDIS_URL
        self._client = None

    @property
    def client(self):
        if self._client is None:
            self._client = redis.from_url(self.url)
        return self._client

    def get(self, key: str) -> Optional[Any]:
        value = self.client.get(key)
        if value:
            try:
                return json.loads(value)
            except json.JSONDecodeError:
                return value.decode()
        return None

    def set(self, key: str, value: Any, expire: int = None) -> bool:
        if isinstance(value, (dict, list)):
            value = json.dumps(value)
        return self.client.set(key, value, ex=expire)

    def delete(self, key: str) -> int:
        return self.client.delete(key)

    def exists(self, key: str) -> bool:
        return self.client.exists(key) > 0

    def expire(self, key: str, seconds: int) -> bool:
        return self.client.expire(key, seconds)


redis_client = RedisClient()
