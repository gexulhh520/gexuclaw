# 文档分块（Chunking）策略详解

## 当前实现的分块逻辑

### 1. 整体流程

```
文档上传 → 文本提取 → 按段落分割 → 滑动窗口分块 → 生成 Embedding → 存入 LanceDB
```

### 2. 分块算法详解

#### 2.1 第一步：按段落分割

```python
# 先将文本按空行分割成段落
paragraphs = [p.strip() for p in text.split('\n\n') if p.strip()]
```

**示例**：
```
原文本：
这是第一段。包含一些内容。

这是第二段。包含更多内容。

这是第三段。

分割后：
["这是第一段。包含一些内容。", "这是第二段。包含更多内容。", "这是第三段。"]
```

#### 2.2 第二步：滑动窗口分块

使用**贪心算法**将段落组合成块：

```python
chunk_size = 500      # 每个块的目标大小（字符数）
overlap = 50          # 块之间的重叠大小（字符数）
```

**分块逻辑**：

1. 遍历每个段落
2. 将段落加入当前块
3. 如果当前块大小超过 `chunk_size`：
   - 保存当前块
   - 保留最后 `overlap` 个字符作为下一个块的开头（保持上下文连续性）
   - 开始新块

#### 2.3 示例说明

假设配置：
```python
CHUNK_SIZE = 500      # 每个块约 500 字符
CHUNK_OVERLAP = 50    # 块间重叠 50 字符
```

**原文本**（假设有 3 个段落，每个 200 字符）：
```
段落1（200字符）：项目背景介绍...

段落2（200字符）：技术选型说明...

段落3（200字符）：实施方案描述...

段落4（200字符）：总结与展望...
```

**分块结果**：

```
Chunk 0（400字符）：
- 段落1（200）+ 段落2（200）
- 索引：0

Chunk 1（约400字符）：
- 段落2的最后50字符（重叠）+ 段落3（200）+ 段落4（150）
- 索引：1

Chunk 2（约150字符）：
- 段落4的剩余部分
- 索引：2
```

### 3. 重叠（Overlap）的作用

```
文本：...这是句子的结尾。这是下一句的开头...

Chunk 0: [这是句子的结尾。这是下一句的开头]  ← 包含完整句子
Chunk 1: [这是下一句的开头...]                  ← 重叠部分保持上下文
         ↑ 重叠 50 字符
```

**为什么需要重叠？**
- 避免句子被切断导致语义丢失
- 保持块之间的上下文连续性
- 提高检索时的召回率

### 4. 配置参数

在 `core/config.py` 中：

```python
# 文档处理配置
CHUNK_SIZE: int = 500       # 分块大小（字符数）
CHUNK_OVERLAP: int = 50     # 分块重叠（字符数）
```

**参数调优建议**：

| 场景 | CHUNK_SIZE | CHUNK_OVERLAP | 说明 |
|------|-----------|---------------|------|
| 短文本/FAQ | 200-300 | 20-30 | 适合问答场景 |
| 通用文档 | 500 | 50 | 平衡方案（当前配置） |
| 长文章/论文 | 1000 | 100 | 适合长文档，减少块数量 |
| 代码文档 | 300-400 | 30-40 | 代码块通常较短 |

### 5. 与其他分块策略对比

#### 5.1 当前策略：基于段落 + 滑动窗口

**优点**：
- 保持段落完整性
- 实现简单，速度快
- 重叠保持上下文

**缺点**：
- 块大小不均匀
- 可能切断长段落

#### 5.2 其他常见策略

**策略A：固定字符数**
```python
# 每 500 字符切一刀，不管段落
chunks = [text[i:i+500] for i in range(0, len(text), 450)]  # 450 = 500-50
```

**策略B：按句子分割**
```python
import re
sentences = re.split(r'(?<=[。！？.!?])', text)
# 然后组合句子成块
```

**策略C：语义分块（高级）**
```python
# 使用模型判断语义边界
# 当语义发生变化时切分
```

### 6. 存储结构

每个 chunk 存储为：

```python
{
    "id": "uuid",                    # 唯一标识
    "content": "文本内容",            # 块内容
    "vector": [0.1, 0.2, ...],       # 1024 维 embedding
    "user_id": 123,                  # 用户 ID
    "session_id": "xxx",             # 会话 ID（可选）
    "filename": "document.pdf",      # 来源文件名
    "chunk_index": 0,                # 块索引
    "created_at": "2024-01-01..."    # 创建时间
}
```

### 7. 如何修改分块策略

如果需要调整，修改 `document_processor.py` 中的 `_split_text` 方法：

```python
def _split_text(self, text, filename, user_id, session_id):
    # 自定义分块逻辑
    # 例如：按句子分块
    import re
    sentences = re.split(r'(?<=[。！？.!?])', text)
    
    chunks = []
    current_chunk = []
    current_length = 0
    
    for sentence in sentences:
        if current_length + len(sentence) > settings.CHUNK_SIZE:
            # 保存当前块
            chunks.append(DocumentChunk(...))
            # 开始新块
            current_chunk = [sentence]
            current_length = len(sentence)
        else:
            current_chunk.append(sentence)
            current_length += len(sentence)
    
    return chunks
```

### 8. 常见问题

**Q: 为什么我的文档只生成了 1 个 chunk？**
A: 文档太短（< 500 字符），或只有 1 个段落。

**Q: 重叠部分会不会导致重复检索？**
A: 会，但这是设计上的权衡。重复比遗漏好，且可以通过去重逻辑处理。

**Q: 中文和英文的 chunk 大小一样吗？**
A: 当前按字符数计算，中英文相同。但语义密度不同，中文 500 字符 ≈ 英文 800-1000 字符的信息量。

**Q: 如何查看某个文档的分块结果？**
A: 可以添加调试日志或查询 LanceDB：
```python
import lancedb
db = lancedb.connect("D:/gexuclaw_vector_db")
table = db.open_table("user_123")
df = table.to_pandas()
print(df[df['filename'] == 'xxx.pdf'][['chunk_index', 'content']])
```
