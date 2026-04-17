# RAG 文档系统开发计划

## 一、项目背景

- **操作系统**: Windows
- **向量数据库**: LanceDB（嵌入式，本地绝对路径存储）
- **Embedding 模型**: Ollama + bge-m3
- **文档上传**: 复用现有 `/upload` 接口
- **Chat 消息**: 只传文件 path，不直接传文件内容
- **支持格式**: PDF、Word（doc/docx）、ZIP
- **多用户隔离**: 每个用户独立的 LanceDB table

## 二、总体目标

当用户通过现有 upload 接口上传 PDF、Word、ZIP 时：
1. 后端自动判断文件类型
2. 解析文档 → 分块 → 使用 bge-m3 生成 embedding
3. 存入 LanceDB（每个用户一个独立的 table）
4. 返回给前端：原始文件地址 + "已解析为 X 个向量片段"的总结信息
5. Chat 接口后续只传文件 path，Agent 可通过工具检索该用户的向量数据

## 三、技术选型

| 组件 | 选型 | 说明 |
|------|------|------|
| 向量数据库 | LanceDB (嵌入式) | Windows 友好，使用绝对路径 |
| Embedding 模型 | Ollama + bge-m3 | 本地运行，1024 维 |
| 文档解析 | unstructured (elements 模式) | 支持 PDF/Word/ZIP，结构化好 |
| 多用户隔离 | 每个用户一个 LanceDB Table | 最干净、最安全 |
| 文件存储 | 保持原有 upload 逻辑 | 不改变现有文件保存方式 |

## 四、分阶段开发计划

### 阶段 1：环境准备 + 配置（预计 1 天）

**目标**: 安装依赖 + 配置 LanceDB 路径

**要做的事**:
1. 安装依赖包
2. 在 .env 中新增配置
3. 修改 core/config.py

**代码变更**:

```python
# backend/core/config.py
class Settings:
    # 现有配置...
    
    # LanceDB 配置
    LANCEDB_URI: str = "D:/gexuclaw_vector_db"      # Windows 绝对路径
    LANCEDB_TABLE_PREFIX: str = "user_"             # 每个用户 table 前缀 → user_123
    EMBEDDING_MODEL: str = "bge-m3"
    EMBEDDING_DIMENSION: int = 1024
    
    # 文档处理配置
    CHUNK_SIZE: int = 500
    CHUNK_OVERLAP: int = 50
```

**依赖安装**:
```bash
pip install lancedb unstructured unstructured[pdf] unstructured[docx] ollama
```

---

### 阶段 2：文档解析核心服务（预计 2-3 天）

**新建文件**: `backend/services/document_processor.py`

**目标**: 实现文件解析、分块、embedding、存 LanceDB 的核心逻辑

**核心类设计**:

```python
class DocumentProcessor:
    def __init__(self):
        self.db = lancedb.connect(settings.LANCEDB_URI)
        # 使用 Ollama 生成 embedding
        
    async def process_files(self, files: List[UploadFile], user_id: int, session_id: str = None):
        """处理文件列表，返回解析结果"""
        all_chunks = []
        for file in files:
            if self._is_zip(file):
                await self._process_zip(file, all_chunks, user_id, session_id)
            elif self._is_pdf_or_word(file):
                await self._process_single_document(file, all_chunks, user_id, session_id)
        
        # 存入 LanceDB
        table_name = f"{settings.LANCEDB_TABLE_PREFIX}{user_id}"
        table = self._get_or_create_table(table_name)
        
        # 生成 embeddings 并存储
        await self._store_chunks(table, all_chunks)
        
        return {
            "total_chunks": len(all_chunks),
            "message": f"已解析为 {len(all_chunks)} 个向量片段"
        }
    
    def _is_zip(self, file) -> bool:
        return file.filename.lower().endswith('.zip')
    
    def _is_pdf_or_word(self, file) -> bool:
        ext = file.filename.lower()
        return ext.endswith(('.pdf', '.doc', '.docx'))
    
    async def _process_single_document(self, file, chunks: list, user_id: int, session_id: str):
        """解析单个文档"""
        # 1. 保存临时文件
        # 2. 使用 unstructured 解析
        # 3. 分块
        # 4. 添加到 chunks 列表
        pass
    
    async def _process_zip(self, file, chunks: list, user_id: int, session_id: str):
        """解压并处理 ZIP 内的文档"""
        # 1. 解压 ZIP
        # 2. 遍历内部文件
        # 3. 对每个文档调用 _process_single_document
        pass
    
    def _get_or_create_table(self, table_name: str):
        """获取或创建用户的 LanceDB table"""
        if table_name in self.db.table_names():
            return self.db.open_table(table_name)
        else:
            # 创建新表，定义 schema
            schema = pa.schema([
                ("id", pa.string()),
                ("content", pa.string()),
                ("vector", pa.list_(pa.float32(), settings.EMBEDDING_DIMENSION)),
                ("user_id", pa.int64()),
                ("session_id", pa.string()),
                ("filename", pa.string()),
                ("chunk_index", pa.int64()),
                ("created_at", pa.timestamp('us')),
            ])
            return self.db.create_table(table_name, schema=schema)
    
    async def _store_chunks(self, table, chunks: list):
        """生成 embedding 并存储到 LanceDB"""
        # 1. 调用 Ollama 生成 embeddings
        # 2. 批量写入 LanceDB
        pass
    
    async def _generate_embedding(self, text: str) -> List[float]:
        """使用 Ollama + bge-m3 生成 embedding"""
        # 调用 Ollama API
        pass
```

---

### 阶段 3：修改 Upload 接口（预计 1-2 天）

**修改文件**: `backend/api/upload.py`

**核心逻辑**:
- 保留原有 `/upload/image` 和 `/upload/audio`
- 新增或修改为支持 document 类型
- 如果是 PDF/Word/ZIP → 调用 DocumentProcessor 处理
- 返回结果中增加 processed 和 chunks_count 字段

**代码变更**:

```python
@router.post("/upload")
async def upload_file(
    files: List[UploadFile] = File(...),
    current_user: User = Depends(get_current_active_user)
):
    results = []
    for file in files:
        if is_document_file(file):  # pdf, docx, doc, zip
            processor = DocumentProcessor()
            process_result = await processor.process_files([file], current_user.id)
            
            results.append({
                "filename": file.filename,
                "path": f"/uploads/{file.filename}",
                "url": f"http://...",
                "type": "document",
                "processed": True,
                "chunks_count": process_result["total_chunks"],
                "message": process_result["message"]
            })
        else:
            # 原有图片/音频逻辑
            ...
    
    return {"success": True, "files": results}

def is_document_file(file: UploadFile) -> bool:
    """判断是否为文档文件"""
    ext = file.filename.lower()
    return ext.endswith(('.pdf', '.doc', '.docx', '.zip'))
```

---

### 阶段 4：LanceDB Table 管理（预计 1 天）

**目标**: 确保每个用户都有独立的 table

**代码位置**: 集成在 DocumentProcessor 中

```python
def _get_or_create_table(self, table_name: str):
    """获取或创建用户的 LanceDB table"""
    if table_name in self.db.table_names():
        return self.db.open_table(table_name)
    else:
        # 使用 PyArrow 定义 schema
        import pyarrow as pa
        
        schema = pa.schema([
            ("id", pa.string()),                    # 唯一 ID
            ("content", pa.string()),               # 文本内容
            ("vector", pa.list_(pa.float32(), 1024)),  # embedding 向量
            ("user_id", pa.int64()),                # 用户 ID
            ("session_id", pa.string()),            # 会话 ID（可选）
            ("filename", pa.string()),              # 原始文件名
            ("chunk_index", pa.int64()),            # 分块索引
            ("created_at", pa.timestamp('us')),     # 创建时间
        ])
        
        return self.db.create_table(table_name, schema=schema, mode="create")
```

---

### 阶段 5：知识检索 Tool（预计 1 天）

**新建文件**: `backend/tools/knowledge_tool.py`

**为未来 RAG Subgraph 准备**

```python
from langchain.tools import tool
import lancedb
from core.config import settings

@tool("knowledge_search")
async def search_knowledge(query: str, top_k: int = 8, user_id: int = None):
    """
    搜索用户知识库中的相关文档片段
    
    Args:
        query: 搜索查询
        top_k: 返回结果数量
        user_id: 用户 ID（用于隔离）
    
    Returns:
        相关文档内容拼接的字符串
    """
    if not user_id:
        return "未提供用户 ID，无法搜索知识库"
    
    db = lancedb.connect(settings.LANCEDB_URI)
    table_name = f"{settings.LANCEDB_TABLE_PREFIX}{user_id}"
    
    if table_name not in db.table_names():
        return "该用户暂无知识库数据"
    
    table = db.open_table(table_name)
    
    # 使用 LanceDB 的向量搜索
    results = table.search(query) \
                   .limit(top_k) \
                   .to_pandas()
    
    if len(results) == 0:
        return "未找到相关内容"
    
    # 格式化返回结果
    contents = []
    for _, row in results.iterrows():
        contents.append(f"[来自 {row['filename']}]\n{row['content']}")
    
    return "\n\n---\n\n".join(contents)
```

---

### 阶段 6：前端小幅适配 + 测试（预计 1-2 天）

**前端基本无需大改**（因为 chat 只传 path）：

1. 上传文档后，`uploadedFiles` 里会多一个 `type: "document"` 的记录
2. 发送消息时继续使用现有 `buildMultimodalContent`
3. 可选：显示 "已解析为 X 个向量片段" 的提示

**前端代码示例**:

```typescript
// 处理上传结果
if (file.type === 'document') {
  ElMessage.success(file.message)  // "已解析为 15 个向量片段"
}

// 发送消息时（无需修改）
const content = buildMultimodalContent(inputMessage.value, uploadedFiles.value)
```

---

## 五、文件结构

```
backend/
├── core/
│   └── config.py              # 新增 LanceDB 配置
├── services/
│   └── document_processor.py  # 新建：文档处理核心服务
├── api/
│   └── upload.py              # 修改：支持 document 类型
├── tools/
│   └── knowledge_tool.py      # 新建：知识检索工具
└── models/
    └── document_chunk.py      # 可选：DocumentChunk 模型定义
```

## 六、关键依赖

```txt
# requirements.txt 新增
lancedb>=0.5.0
unstructured>=0.12.0
unstructured[pdf]>=0.12.0
unstructured[docx]>=0.12.0
pyarrow>=14.0.0
ollama>=0.1.0
```

## 七、Ollama 配置

确保 Ollama 已安装并运行 bge-m3 模型：

```bash
# 安装 Ollama（Windows）
# 下载地址：https://ollama.com/download/windows

# 拉取 bge-m3 模型
ollama pull bge-m3

# 测试
ollama run bge-m3
```

## 八、注意事项

1. **Windows 路径**: 使用正斜杠或原始字符串处理路径
2. **大文件处理**: ZIP 内文件过多时需要异步处理
3. **内存管理**: 大文档分块处理，避免一次性加载
4. **错误处理**: 文档解析失败时记录日志但不阻断流程
5. **并发安全**: LanceDB 支持多进程读取，但写入需要同步

## 九、验收标准

- [ ] PDF 文件上传后能正确解析并生成向量
- [ ] Word 文件上传后能正确解析并生成向量
- [ ] ZIP 文件上传后能解压并处理内部文档
- [ ] 每个用户有独立的 LanceDB table
- [ ] 上传返回包含 chunks_count 和 message
- [ ] knowledge_search 工具能正确检索内容
- [ ] 前端显示 "已解析为 X 个向量片段"
