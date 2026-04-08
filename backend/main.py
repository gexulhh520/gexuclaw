import multiprocessing
# Windows 多进程需要设置启动方法
# if __name__ == "__main__":
#     multiprocessing.set_start_method("spawn", force=True)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from core.config import get_settings
from api import v1, auth, chat_sessions, upload
from websocket import manager
from models.database import engine, Base
from pathlib import Path

settings = get_settings()

# 创建数据库表
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title=settings.APP_NAME,
    description="GexuLaw Agent 智能体系统",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(v1.router, prefix="/api/v1", tags=["v1"])
app.include_router(auth.router, prefix="/api/auth", tags=["认证"])
app.include_router(chat_sessions.router, prefix="/api/sessions", tags=["会话管理"])
app.include_router(upload.router, prefix="/api/upload", tags=["文件上传"])
app.include_router(manager.router, prefix="/ws", tags=["websocket"])

# 挂载静态文件目录（用于访问上传的文件）
upload_dir = Path(settings.UPLOAD_DIR)
upload_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(upload_dir)), name="uploads")


@app.get("/")
async def root():
    return {
        "name": settings.APP_NAME,
        "version": "1.0.0",
        "status": "running",
    }


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.API_HOST,
        port=settings.API_PORT,
        reload=settings.DEBUG,
    )
