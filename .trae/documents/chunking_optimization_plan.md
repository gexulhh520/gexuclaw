# 分块策略优化计划

## 一、当前问题

现有分块逻辑使用简单的贪心算法，存在以下问题：
1. 按段落分割后组合，可能切断长段落
2. 块大小不均匀
3. 没有考虑中文标点符号
4. 缺乏灵活性

## 二、优化方案

### 方案：使用 RecursiveCharacterTextSplitter

**优势**：
- 递归分割，优先保持语义完整
- 支持多级分隔符（段落 → 句子 → 词语）
- 社区成熟方案，经过大量实践验证
- 支持中文标点符号分割

## 三、实施步骤

### 步骤 1：添加依赖

修改 `requirements.txt`：
```txt
langchain-text-splitters>=0.0.1
lancedb>=0.5.0
ollama>=0.1.0
```

### 步骤 2：修改 DocumentChunk 模型

使用 LanceDB 的 Pydantic 模型：

```python
from lancedb.pydantic import LanceModel, Vector
from typing import Optional
import uuid

class DocumentChunk(LanceModel):
    id: str
    user_id: int
    session_id: Optional[str]
    filename: str
    chunk_index: int
    content: str
    vector: Vector(1024)  # bge-m3 输出 1024 维
```

### 步骤 3：重构 DocumentProcessor

```python
from langchain_text_splitters import RecursiveCharacterTextSplitter
from lancedb.pydantic import LanceModel, Vector
import lancedb
import ollama
from typing import List, Optional
import uuid

from core.config import get_settings

settings = get_settings()


class DocumentChunk(LanceModel):
    """LanceDB Pydantic 模型"""
    id: str
    user_id: int
    session_id: Optional[str]
    filename: str
    chunk_index: int
    content: str
    vector: Vector(1024)


class DocumentProcessor:
    """文档处理器 - 使用 RecursiveCharacterTextSplitter"""

    def __init__(self):
        self.db = lancedb.connect(settings.LANCEDB_URI)
        self.ollama_client = ollama.Client(host=settings.OLLAMA_BASE_URL)

    async def process_files(
        self,
        files: List[UploadFile],
        user_id: int,
        session_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        处理文件列表

        Args:
            files: 上传的文件列表
            user_id: 用户 ID
            session_id: 会话 ID

        Returns:
            {"total_chunks": int, "message": str}
        """
        all_chunks: List[DocumentChunk] = []

        for file in files:
            if not self._is_document(file.filename):
                continue

            try:
                text = await self._extract_text(file)
                chunks = self._split_into_chunks(
                    text, file.filename, user_id, session_id
                )
                all_chunks.extend(chunks)
            except Exception as e:
                print(f"[DocumentProcessor] 处理文件 {file.filename} 失败: {e}")
                continue

        if not all_chunks:
            return {"total_chunks": 0, "message": "未解析到有效内容"}

        # 生成 embedding 并存储
        await self._embed_and_store(all_chunks, user_id)

        return {
            "total_chunks": len(all_chunks),
            "message": f"已解析为 {len(all_chunks)} 个向量片段"
        }

    def _split_into_chunks(
        self,
        text: str,
        filename: str,
        user_id: int,
        session_id: Optional[str]
    ) -> List[DocumentChunk]:
        """
        使用 RecursiveCharacterTextSplitter 分块

        分割优先级：
        1. 段落分隔符 \n\n
        2. 换行符 \n
        3. 中文标点 。！？
        4. 空格
        5. 字符
        """
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=settings.CHUNK_SIZE,      # 默认 800 字符
            chunk_overlap=settings.CHUNK_OVERLAP, # 默认 150 字符
            length_function=len,
            separators=["\n\n", "\n", "。", "！", "？", " ", ""]
        )

        # 分割文档
        documents = splitter.create_documents([text])

        # 转换为 DocumentChunk
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
                chunk.vector = [0.0] * 1024

        # 获取或创建表
        table_name = f"{settings.LANCEDB_TABLE_PREFIX}{user_id}"
        table = self._get_or_create_table(table_name)

        # 转换为字典列表并存储
        data = [chunk.model_dump() for chunk in chunks]
        table.add(data)

        print(f"[DocumentProcessor] 已存储 {len(chunks)} 个 chunks 到表 {table_name}")

    def _get_or_create_table(self, table_name: str):
        """获取或创建 LanceDB 表"""
        if table_name in self.db.table_names():
            return self.db.open_table(table_name)

        # 使用 Pydantic 模型创建表
        return self.db.create_table(
            table_name,
            schema=DocumentChunk,
            mode="create"
        )

    def _is_document(self, filename: str) -> bool:
        """判断是否为支持的文档类型"""
        ext = filename.lower()
        return ext.endswith(('.pdf', '.doc', '.docx', '.zip'))

    async def _extract_text(self, file: UploadFile) -> str:
        """提取文件文本内容"""
        # 复用现有逻辑
        pass
```

### 步骤 4：更新配置

```python
# core/config.py

# 文档处理配置（优化后的推荐值）
CHUNK_SIZE: int = 800        # 800 字符 ≈ 200-250 tokens
CHUNK_OVERLAP: int = 150     # 150 字符重叠，保持上下文
```

**参数说明**：

| 参数 | 原值 | 新值 | 说明 |
|------|------|------|------|
| CHUNK_SIZE | 500 | 800 | 更大的块，包含更多上下文 |
| CHUNK_OVERLAP | 50 | 150 | 更大的重叠，更好的连续性 |

### 步骤 5：测试验证

1. 上传测试文档
2. 检查分块数量是否合理
3. 验证块内容是否保持语义完整
4. 测试向量检索效果

## 四、新旧方案对比

| 特性 | 旧方案 | 新方案 |
|------|--------|--------|
| 分块算法 | 贪心算法 | RecursiveCharacterTextSplitter |
| 语义保持 | 一般 | 优秀 |
| 中文支持 | 基础 | 完整（支持标点分割） |
| 灵活性 | 低 | 高 |
| 维护性 | 自定义代码 | 社区维护 |
| 块大小均匀度 | 不均匀 | 较均匀 |

## 五、注意事项

1. **依赖安装**：需要安装 `langchain-text-splitters`
2. **向后兼容**：现有数据不受影响，新上传文档使用新逻辑
3. **性能**：RecursiveCharacterTextSplitter 稍慢，但质量更高
4. **内存**：大文档需要分批次处理

## 六、回滚方案

如果新方案有问题，可以回滚到旧方案：
- 保留旧版 `_split_text` 方法
- 通过配置开关切换
