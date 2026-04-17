"""
文档处理服务 - 使用 RecursiveCharacterTextSplitter 进行智能分块
支持 PDF、Word、ZIP 文档解析，生成 embedding 并存入 LanceDB
"""
import os
import uuid
import shutil
import zipfile
from typing import List, Dict, Any, Optional
from datetime import datetime
import tempfile

import lancedb
from lancedb.pydantic import LanceModel, Vector
from langchain_text_splitters import RecursiveCharacterTextSplitter
from fastapi import UploadFile
import ollama

from core.config import get_settings

settings = get_settings()


class DocumentChunk(LanceModel):
    """LanceDB Pydantic 模型 - 文档分块"""
    id: str
    user_id: int
    session_id: Optional[str]
    filename: str
    chunk_index: int
    content: str
    vector: Vector(1024)  # bge-m3 输出 1024 维


class DocumentProcessor:
    """文档处理器 - 使用 RecursiveCharacterTextSplitter 智能分块"""

    def __init__(self):
        self.db = lancedb.connect(settings.LANCEDB_URI)
        self.ollama_client = ollama.Client(host=settings.OLLAMA_BASE_URL)

    def _is_zip(self, filename: str) -> bool:
        """判断是否为 ZIP 文件"""
        return filename.lower().endswith('.zip')

    def _is_pdf(self, filename: str) -> bool:
        """判断是否为 PDF 文件"""
        return filename.lower().endswith('.pdf')

    def _is_word(self, filename: str) -> bool:
        """判断是否为 Word 文件"""
        ext = filename.lower()
        return ext.endswith(('.doc', '.docx'))

    def _is_document(self, filename: str) -> bool:
        """判断是否为支持的文档类型"""
        return self._is_pdf(filename) or self._is_word(filename) or self._is_zip(filename)

    async def process_files(
        self,
        files: List[UploadFile],
        user_id: int,
        session_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        处理文件列表，解析文档并存储到 LanceDB

        Args:
            files: 上传的文件列表
            user_id: 用户 ID
            session_id: 会话 ID（可选）

        Returns:
            处理结果，包含总块数和消息
        """
        all_chunks: List[DocumentChunk] = []

        for file in files:
            if not self._is_document(file.filename):
                continue

            try:
                if self._is_zip(file.filename):
                    chunks = await self._process_zip(file, user_id, session_id)
                    all_chunks.extend(chunks)
                else:
                    chunks = await self._process_single_document(file, user_id, session_id)
                    all_chunks.extend(chunks)
            except Exception as e:
                print(f"[DocumentProcessor] 处理文件 {file.filename} 失败: {e}")
                continue

        if not all_chunks:
            return {
                "total_chunks": 0,
                "message": "未解析到有效内容"
            }

        # 生成 embeddings 并存储
        await self._embed_and_store(all_chunks, user_id)

        return {
            "total_chunks": len(all_chunks),
            "message": f"已解析为 {len(all_chunks)} 个向量片段"
        }

    async def _process_single_document(
        self,
        file: UploadFile,
        user_id: int,
        session_id: Optional[str] = None
    ) -> List[DocumentChunk]:
        """处理单个文档文件"""
        # 创建临时文件
        temp_dir = tempfile.mkdtemp()
        temp_path = os.path.join(temp_dir, file.filename)

        try:
            # 保存上传的文件
            content = await file.read()
            with open(temp_path, 'wb') as f:
                f.write(content)

            # 解析文档内容
            text_content = self._extract_text(temp_path, file.filename)

            # 使用 RecursiveCharacterTextSplitter 分块
            chunks = self._split_into_chunks(text_content, file.filename, user_id, session_id)

            return chunks

        finally:
            # 清理临时文件
            shutil.rmtree(temp_dir, ignore_errors=True)

    async def _process_zip(
        self,
        file: UploadFile,
        user_id: int,
        session_id: Optional[str] = None
    ) -> List[DocumentChunk]:
        """处理 ZIP 压缩包"""
        all_chunks: List[DocumentChunk] = []
        temp_dir = tempfile.mkdtemp()
        zip_path = os.path.join(temp_dir, file.filename)

        try:
            # 保存 ZIP 文件
            content = await file.read()
            with open(zip_path, 'wb') as f:
                f.write(content)

            # 解压
            extract_dir = os.path.join(temp_dir, 'extracted')
            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                zip_ref.extractall(extract_dir)

            # 遍历解压后的文件
            for root, dirs, files in os.walk(extract_dir):
                for filename in files:
                    if self._is_document(filename) and not self._is_zip(filename):
                        file_path = os.path.join(root, filename)
                        try:
                            text_content = self._extract_text(file_path, filename)
                            chunks = self._split_into_chunks(text_content, filename, user_id, session_id)
                            all_chunks.extend(chunks)
                        except Exception as e:
                            print(f"[DocumentProcessor] 处理 ZIP 内文件 {filename} 失败: {e}")
                            continue

            return all_chunks

        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def _extract_text(self, file_path: str, filename: str) -> str:
        """
        从文件中提取文本内容

        优先使用 unstructured，如果失败则使用备选方案
        """
        try:
            # 尝试使用 unstructured
            from unstructured.partition.auto import partition

            elements = partition(filename=file_path)
            text_content = "\n\n".join([str(el) for el in elements if str(el).strip()])

            if text_content.strip():
                return text_content

        except Exception as e:
            print(f"[DocumentProcessor] unstructured 解析失败，尝试备选方案: {e}")

        # 备选方案：根据文件类型使用不同方法
        if self._is_pdf(filename):
            return self._extract_pdf_text(file_path)
        elif self._is_word(filename):
            return self._extract_word_text(file_path)

        return ""

    def _extract_pdf_text(self, file_path: str) -> str:
        """使用 PyPDF2 提取 PDF 文本（备选方案）"""
        try:
            from PyPDF2 import PdfReader

            reader = PdfReader(file_path)
            text_parts = []
            for page in reader.pages:
                text = page.extract_text()
                if text:
                    text_parts.append(text)

            return "\n\n".join(text_parts)
        except Exception as e:
            print(f"[DocumentProcessor] PDF 提取失败: {e}")
            return ""

    def _extract_word_text(self, file_path: str) -> str:
        """使用 python-docx 提取 Word 文本（备选方案）"""
        try:
            from docx import Document

            doc = Document(file_path)
            text_parts = []
            for para in doc.paragraphs:
                if para.text.strip():
                    text_parts.append(para.text)

            return "\n\n".join(text_parts)
        except Exception as e:
            print(f"[DocumentProcessor] Word 提取失败: {e}")
            return ""

    def _split_into_chunks(
        self,
        text: str,
        filename: str,
        user_id: int,
        session_id: Optional[str] = None
    ) -> List[DocumentChunk]:
        """
        使用 RecursiveCharacterTextSplitter 智能分块

        分割优先级（从高到低）：
        1. 段落分隔符 \n\n
        2. 换行符 \n
        3. 中文标点 。！？
        4. 空格
        5. 字符（最后手段）

        这种递归分割方式能最大程度保持语义完整性
        """
        if not text.strip():
            return []

        # 创建 RecursiveCharacterTextSplitter
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=settings.CHUNK_SIZE,        # 默认 800 字符
            chunk_overlap=settings.CHUNK_OVERLAP,  # 默认 150 字符
            length_function=len,
            separators=["\n\n", "\n", "。", "！", "？", " ", ""]
        )

        # 分割文档
        documents = splitter.create_documents([text])

        # 转换为 DocumentChunk 对象
        chunks = []
        for i, doc in enumerate(documents):
            chunks.append(DocumentChunk(
                id=str(uuid.uuid4()),
                user_id=user_id,
                session_id=session_id,
                filename=filename,
                chunk_index=i,
                content=doc.page_content,
                vector=[0.0] * 1024  # 占位，后面统一生成
            ))

        return chunks

    async def _embed_and_store(
        self,
        chunks: List[DocumentChunk],
        user_id: int
    ):
        """生成 embedding 并存储到 LanceDB"""
        # 批量生成 embedding
        for chunk in chunks:
            try:
                response = self.ollama_client.embeddings(
                    model=settings.EMBEDDING_MODEL,
                    prompt=chunk.content
                )
                chunk.vector = response['embedding']
            except Exception as e:
                print(f"[DocumentProcessor] 生成 embedding 失败: {e}")
                # 使用零向量作为 fallback
                chunk.vector = [0.0] * 1024

        # 获取或创建表
        table_name = f"{settings.LANCEDB_TABLE_PREFIX}{user_id}"
        table = self._get_or_create_table(table_name)

        # 使用 Pydantic 模型的 model_dump() 转换为字典
        data = [chunk.model_dump() for chunk in chunks]
        table.add(data)

        print(f"[DocumentProcessor] 已存储 {len(chunks)} 个 chunks 到表 {table_name}")

    def _get_or_create_table(self, table_name: str):
        """获取或创建用户的 LanceDB 表"""
        if table_name in self.db.table_names():
            return self.db.open_table(table_name)

        # 使用 Pydantic 模型创建表
        return self.db.create_table(
            table_name,
            schema=DocumentChunk,
            mode="create"
        )


# 便捷函数：处理上传的文档
async def process_uploaded_documents(
    files: List[UploadFile],
    user_id: int,
    session_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    处理上传的文档文件

    Args:
        files: 上传的文件列表
        user_id: 用户 ID
        session_id: 会话 ID

    Returns:
        处理结果
    """
    processor = DocumentProcessor()
    return await processor.process_files(files, user_id, session_id)
