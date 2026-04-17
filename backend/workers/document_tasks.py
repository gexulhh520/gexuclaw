"""
文档处理 Celery 任务 - 后台异步处理文档上传
"""
import os
import asyncio
from typing import Optional

from workers.celery_app import celery_app
from services.document_processor import DocumentProcessor
from core.config import get_settings

settings = get_settings()


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def process_document_task(
    self,
    file_path: str,
    filename: str,
    user_id: int,
    session_id: Optional[str] = None
):
    """
    异步处理文档任务

    进度状态：
    - PENDING: 等待处理
    - PROCESSING: 正在解析文档
    - EXTRACTING: 正在提取文本
    - CHUNKING: 正在分块
    - EMBEDDING: 正在生成向量
    - STORING: 正在存储
    - SUCCESS: 完成
    - FAILURE: 失败

    Args:
        file_path: 文件保存路径
        filename: 原始文件名
        user_id: 用户 ID
        session_id: 可选的会话 ID，用于 WebSocket 通知

    Returns:
        dict: 处理结果
    """
    return asyncio.run(_process_document_async(
        self, file_path, filename, user_id, session_id
    ))


async def _process_document_async(
    task,
    file_path: str,
    filename: str,
    user_id: int,
    session_id: Optional[str] = None
):
    """异步处理文档"""
    processor = DocumentProcessor()
    temp_dir = None

    try:
        # 阶段 1: 开始处理 (10%)
        _update_progress(task, 10, '正在解析文档...', session_id)

        # 检查文件是否存在
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"文件不存在: {file_path}")

        # 阶段 2: 提取文本 (30%)
        _update_progress(task, 30, '正在提取文本内容...', session_id)

        # 根据文件类型处理
        if processor._is_zip(filename):
            chunks = await _process_zip_with_progress(
                processor, file_path, filename, user_id, session_id, task
            )
        else:
            chunks = await _process_single_document_with_progress(
                processor, file_path, filename, user_id, session_id, task
            )

        if not chunks:
            return {
                "success": True,
                "total_chunks": 0,
                "message": "未解析到有效内容",
                "filename": filename
            }

        # 阶段 5: 生成 embedding 和存储 (70% -> 100%)
        _update_progress(task, 70, f'正在生成向量 ({len(chunks)} 个片段)...', session_id)

        # 分批生成 embedding，每批更新进度
        await _embed_and_store_with_progress(
            processor, chunks, user_id, session_id, task
        )

        # 完成
        _update_progress(task, 100, '文档处理完成', session_id)

        # 清理文件
        try:
            os.remove(file_path)
        except Exception as e:
            print(f"[DocumentTask] 清理文件失败: {e}")

        return {
            "success": True,
            "total_chunks": len(chunks),
            "message": f"已解析为 {len(chunks)} 个向量片段",
            "filename": filename
        }

    except Exception as e:
        print(f"[DocumentTask] 处理文档失败: {e}")

        # 更新任务状态为失败
        task.update_state(
            state='FAILURE',
            meta={
                'progress': 0,
                'message': f'处理失败: {str(e)}',
                'filename': filename
            }
        )

        # 尝试重试
        try:
            task.retry(countdown=60)
        except:
            pass

        # 清理文件
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
        except:
            pass

        raise


async def _process_single_document_with_progress(
    processor: DocumentProcessor,
    file_path: str,
    filename: str,
    user_id: int,
    session_id: Optional[str],
    task
):
    """处理单个文档，带进度更新"""
    # 阶段 3: 提取文本 (30% -> 50%)
    _update_progress(task, 40, '正在提取文档内容...', session_id)

    text_content = processor._extract_text(file_path, filename)

    if not text_content.strip():
        return []

    # 阶段 4: 分块 (50% -> 70%)
    _update_progress(task, 60, '正在分块处理...', session_id)

    chunks = processor._split_into_chunks(text_content, filename, user_id, session_id)

    return chunks


async def _process_zip_with_progress(
    processor: DocumentProcessor,
    file_path: str,
    filename: str,
    user_id: int,
    session_id: Optional[str],
    task
):
    """处理 ZIP 文件，带进度更新"""
    import zipfile
    import tempfile
    import shutil

    _update_progress(task, 35, '正在解压压缩包...', session_id)

    temp_dir = tempfile.mkdtemp()
    all_chunks = []

    try:
        extract_dir = os.path.join(temp_dir, 'extracted')
        with zipfile.ZipFile(file_path, 'r') as zip_ref:
            zip_ref.extractall(extract_dir)

        # 获取所有文档文件
        doc_files = []
        for root, dirs, files in os.walk(extract_dir):
            for f in files:
                if processor._is_document(f) and not processor._is_zip(f):
                    doc_files.append(os.path.join(root, f))

        total_files = len(doc_files)

        # 处理每个文件
        for idx, file_path in enumerate(doc_files):
            progress = 40 + int((idx / total_files) * 20)  # 40% -> 60%
            _update_progress(
                task, progress,
                f'正在处理第 {idx + 1}/{total_files} 个文件...',
                session_id
            )

            try:
                text_content = processor._extract_text(file_path, os.path.basename(file_path))
                if text_content.strip():
                    chunks = processor._split_into_chunks(
                        text_content,
                        os.path.basename(file_path),
                        user_id,
                        session_id
                    )
                    all_chunks.extend(chunks)
            except Exception as e:
                print(f"[DocumentTask] 处理 ZIP 内文件失败: {e}")
                continue

        return all_chunks

    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


async def _embed_and_store_with_progress(
    processor: DocumentProcessor,
    chunks: list,
    user_id: int,
    session_id: Optional[str],
    task
):
    """生成 embedding 并存储，带进度更新"""
    total = len(chunks)

    # 分批处理，每 5 个更新一次进度
    batch_size = 5
    for i in range(0, total, batch_size):
        batch = chunks[i:i+batch_size]

        # 处理这一批
        for chunk in batch:
            try:
                response = processor.ollama_client.embeddings(
                    model=settings.EMBEDDING_MODEL,
                    prompt=chunk.content
                )
                chunk.vector = response['embedding']
            except Exception as e:
                print(f"[DocumentTask] 生成 embedding 失败: {e}")
                chunk.vector = [0.0] * 1024

        # 更新进度 (70% -> 95%)
        progress = 70 + int((i + len(batch)) / total * 25)
        _update_progress(
            task, progress,
            f'正在生成向量 ({min(i + batch_size, total)}/{total})...',
            session_id
        )

    # 阶段 6: 存储 (95% -> 100%)
    _update_progress(task, 95, '正在存储到知识库...', session_id)

    # 获取或创建表
    table_name = f"{settings.LANCEDB_TABLE_PREFIX}{user_id}"
    table = processor._get_or_create_table(table_name)

    # 存储数据
    data = [chunk.model_dump() for chunk in chunks]
    table.add(data)

    print(f"[DocumentTask] 已存储 {len(chunks)} 个 chunks 到表 {table_name}")


def _update_progress(
    task,
    progress: int,
    message: str,
    session_id: Optional[str] = None
):
    """更新任务进度"""
    # 更新 Celery 任务状态
    task.update_state(
        state='PROCESSING',
        meta={
            'progress': progress,
            'message': message
        }
    )

    # 如果有 session_id，发送 WebSocket 通知
    if session_id:
        try:
            from websocket.manager import connection_manager
            connection_manager.send_to_session(session_id, {
                'type': 'document_progress',
                'status': 'processing',
                'progress': progress,
                'message': message
            })
        except Exception as e:
            print(f"[DocumentTask] WebSocket 通知失败: {e}")
