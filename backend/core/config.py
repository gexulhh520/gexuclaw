from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    APP_NAME: str = "GexuLaw Agent"
    APP_ENV: str = "development"
    DEBUG: bool = True

    API_HOST: str = "0.0.0.0"
    API_PORT: int = 8000

    # 数据库连接配置 (SQLite 或 PostgreSQL)
    # 示例: sqlite:///./gexuclaw.db
    # 示例: postgresql+pg8000://user:password@localhost:5432/gexuclaw
    DATABASE_URL: str = "postgresql+pg8000://gexuclaw:123456@localhost:5432/gexuclaw"
    
    REDIS_URL: str = "redis://localhost:6379/0"

    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4"

    DEEPSEEK_API_KEY: str = ""
    DEEPSEEK_MODEL: str = "deepseek-chat"

    KIMI_API_KEY: str = ""
    KIMI_MODEL: str = "kimi-k2.5"

    SECRET_KEY: str = "your-secret-key-change-this-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30

    CELERY_BROKER_URL: str = "redis://localhost:6379/1"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/2"

    class Config:
        env_file = ".env"


@lru_cache()
def get_settings():
    return Settings()
