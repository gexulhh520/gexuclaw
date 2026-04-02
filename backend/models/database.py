from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from core.config import get_settings

settings = get_settings()

# 根据数据库类型创建引擎
if settings.DATABASE_URL.startswith('sqlite'):
    # SQLite 配置 - 使用连接池
    engine = create_engine(
        settings.DATABASE_URL,
        connect_args={"check_same_thread": False},
        pool_pre_ping=True,  # 连接前ping测试
        pool_recycle=3600,   # 1小时后回收连接
    )
else:
    # PostgreSQL 配置 - 使用连接池
    engine = create_engine(
        settings.DATABASE_URL,
        pool_size=10,        # 连接池大小
        max_overflow=20,     # 最大溢出连接
        pool_pre_ping=True,  # 连接前ping测试
        pool_recycle=3600,   # 1小时后回收连接
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
