from pydantic_settings import BaseSettings
from functools import lru_cache
from pathlib import Path


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
    CHECKPOINT_DATABASE_URL: str = "postgresql://gexuclaw:123456@localhost:5432/gexuclaw"
    
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

    # Browser service configuration
    BROWSER_SERVICE_ENABLED: bool = False
    BROWSER_SERVICE_URL: str = "http://127.0.0.1:8001"
    BROWSER_SERVICE_HOST: str = "127.0.0.1"
    BROWSER_SERVICE_PORT: int = 8001

    # Maintenance / retention (safe defaults; enable scheduling explicitly)
    MAINTENANCE_CLEANUP_ENABLED: bool = False
    MAINTENANCE_CLEANUP_HOUR: int = 3
    MAINTENANCE_CLEANUP_MINUTE: int = 30

    EXECUTION_STEPS_RETENTION_DAYS: int = 30
    EXECUTION_STEPS_CLEANUP_ENABLED: bool = False
    CHECKPOINT_RETENTION_DAYS: int = 30
    CHECKPOINT_KEEP_PER_THREAD: int = 50

    # File upload configuration
    UPLOAD_DIR: str = "D:/gexuclaw_uploads"
    MAX_UPLOAD_SIZE: int = 50 * 1024 * 1024  # 50MB
    ALLOWED_IMAGE_TYPES: list = ["image/jpeg", "image/png", "image/gif", "image/webp"]
    ALLOWED_AUDIO_TYPES: list = ["audio/wav", "audio/mpeg", "audio/mp3", "audio/m4a", "audio/ogg", "audio/webm", "audio/mp4"]

    # LanceDB 向量数据库配置
    LANCEDB_URI: str = "D:/gexuclaw_vector_db"      # Windows 绝对路径
    LANCEDB_TABLE_PREFIX: str = "user_"             # 每个用户 table 前缀 → user_123
    EMBEDDING_MODEL: str = "bge-m3"                 # Ollama embedding 模型
    EMBEDDING_DIMENSION: int = 1024                 # bge-m3 输出维度
    OLLAMA_BASE_URL: str = "http://localhost:11434" # Ollama 服务地址

    # 文档处理配置（优化后的推荐值）
    CHUNK_SIZE: int = 800                           # 文本分块大小（约 200-250 tokens）
    CHUNK_OVERLAP: int = 150                        # 分块重叠大小（保持上下文连续性）
    ALLOWED_DOCUMENT_TYPES: list = ["application/pdf", "application/msword",
                                     "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                                     "application/zip", "application/x-zip-compressed"]

    class Config:
        # Always load the backend .env regardless of CWD (Celery often runs from repo root).
        env_file = str(Path(__file__).resolve().parents[1] / ".env")


@lru_cache()
def get_settings():
    return Settings()
