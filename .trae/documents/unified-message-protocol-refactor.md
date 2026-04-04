# 统一消息协议重构计划 v2

## 目标
统一所有 LLM Provider 的消息格式，支持多模态（文本、音频、图片），使用子表存储多模态内容，并让每个 provider 内部处理 system_prompt。

---

## 一、统一消息协议定义

### 标准消息格式
```python
messages = [
    {
        "role": "user",
        "content": [
            {"type": "text", "content": "图片1和图片2分别描述一下"},
            {"type": "image", "content": "img1.png", "id": "image1"},
            {"type": "image", "content": "img2.png", "id": "image2"}
        ]
    },
    {
        "role": "assistant",
        "content": [
            {"type": "text", "content": "图片1显示的是..."}
        ]
    }
]
```

### 字段说明

**消息级别字段：**
- `role`: `"user"` | `"assistant"` | `"system"` | `"tool"`
- `content`: 内容列表（必填）

**内容项字段：**
- `type`: `"text"` | `"image"` | `"audio"` | `"video"` (可扩展)
- `content`: 实际内容
  - 文本：字符串
  - 图片/音频/视频：文件路径、URL、或 base64 数据
- `id`: 可选标识符，用于关联和引用（如 "image1", "audio_001"）

### 向后兼容写法
```python
# 简化版：字符串自动转换为列表
{"role": "user", "content": "hello"}

# 自动转换为：
{
    "role": "user",
    "content": [
        {"type": "text", "content": "hello"}
    ]
}
```

---

## 二、数据库结构设计

### 2.1 主表：chat_messages（修改）

```python
class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("chat_sessions.id"), nullable=False)
    role = Column(String(20), nullable=False)  # user / assistant / system
    
    # 移除 content 字段（改用子表）
    # content = Column(Text, nullable=False)  ❌ 删除
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # 关联
    session = relationship("ChatSession", back_populates="messages")
    content_items = relationship("MessageContentItem", back_populates="message", cascade="all, delete-orphan")
```

### 2.2 子表：message_content_items（新建）

```python
class MessageContentItem(Base):
    __tablename__ = "message_content_items"

    id = Column(Integer, primary_key=True)
    message_id = Column(Integer, ForeignKey("chat_messages.id"), nullable=False)
    
    type = Column(String(20), nullable=False)  # text / image / audio / video
    content = Column(Text, nullable=False)      # 实际内容
    content_id = Column(String(100), nullable=True)  # 可选标识符
    sort_order = Column(Integer, default=0)     # 排序顺序
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # 关联
    message = relationship("ChatMessage", back_populates="content_items")
```

### 2.3 数据关系图

```
ChatSession (1)
  ├── ChatMessage (N) ←→ MessageContentItem (N)
  │   ├── item 1: {type: "text", content: "..."}
  │   ├── item 2: {type: "image", content: "base64...", id: "img1"}
  │   └── item 3: {type: "audio", content: "path/to/audio.wav"}
  └── ...
```

### 2.4 示例数据

**chat_messages 表：**
| id | session_id | role | created_at |
|----|-----------|------|------------|
| 1  | 5         | user | 2026-01-01 |
| 2  | 5         | assistant | 2026-01-01 |

**message_content_items 表：**
| id | message_id | type | content | content_id | sort_order |
|----|-----------|------|---------|------------|------------|
| 1  | 1         | text | 描述这两张图片 | NULL        | 0          |
| 2  | 1         | image | data:image/png;base64,... | image1      | 1          |
| 3  | 1         | image | data:image/jpeg;base64,... | image2      | 2          |
| 4  | 2         | text | 图片1是...图片2是... | NULL        | 0          |

---

## 三、Schema 层定义

### 3.1 Pydantic 模型

```python
# schemas/chat_session.py

class ContentItemBase(BaseModel):
    """内容项基础模型"""
    type: str  # text / image / audio / video
    content: str
    id: Optional[str] = None  # 可选标识符

class ContentItemCreate(ContentItemBase):
    """创建内容项"""
    pass

class ContentItemResponse(ContentItemBase):
    """响应内容项"""
    id: Optional[int] = None  # 数据库主键
    message_id: int
    sort_order: int = 0
    created_at: datetime
    
    class Config:
        from_attributes = True

class MessageCreate(BaseModel):
    """创建消息（支持多模态）"""
    session_id: str
    content: Union[str, List[ContentItemCreate]]  # 兼容旧格式
    provider: Optional[str] = "openai"
    model: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None

class MessageResponse(BaseModel):
    """消息响应"""
    id: int
    role: str
    content: List[ContentItemResponse]
    created_at: datetime
    
    class Config:
        from_attributes = True
```

---

## 四、Provider 层实现

### 4.1 BaseProvider 接口更新

```python
# llm/providers/base.py

from typing import Optional, List, Dict, Any, AsyncGenerator, Protocol, Union


class BaseProvider(Protocol):
    """LLM Provider 统一接口协议"""
    
    async def chat(
        self,
        messages: List[Dict[str, Any]],
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        system_prompt: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        统一聊天接口
        
        Args:
            messages: 统一多模态消息列表
                     [{"role": "...",
                       "content": [{"type": "text|image|audio",
                                   "content": "...",
                                   "id": "optional"}],
                       ...}]
            temperature: 温度参数
            max_tokens: 最大 token 数
            tools: 工具定义列表
            system_prompt: 系统提示词（内部拼接，不放在 messages 里）
            
        Returns:
            {
                "content": str,
                "role": str,
                "tool_calls": [...] | None,
                "reasoning_content": str | None,
            }
        """
        ...

    async def stream(
        self,
        messages: List[Dict[str, Any]],
        temperature: float = 0.7,
        system_prompt: Optional[str] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """统一流式接口"""
        ...

    async def embedding(self, text: str) -> List[float]:
        ...

    async def embedding_batch(self, texts: List[str]) -> List[List[float]]:
        ...


class BaseProviderImpl:
    """Provider 基础实现类"""
    
    def _normalize_message(self, msg: Dict[str, Any]) -> Dict[str, Any]:
        """
        规范化单条消息
        
        处理：
        1. 字符串 content → 列表格式
        2. 字段名标准化
        """
        content = msg.get("content")
        
        if isinstance(content, str):
            content = [{"type": "text", "content": content}]
        
        normalized_msg = {
            "role": msg.get("role"),
            "content": content,
        }
        
        if msg.get("tool_calls"):
            normalized_msg["tool_calls"] = msg["tool_calls"]
        if msg.get("tool_call_id"):
            normalized_msg["tool_call_id"] = msg["tool_call_id"]
        if msg.get("reasoning_content"):
            normalized_msg["reasoning_content"] = msg["reasoning_content"]
            
        return normalized_msg
    
    def _normalize_messages(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """规范化所有消息"""
        return [self._normalize_message(msg) for msg in messages]
    
    def _convert_to_provider_format(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        转换为特定 provider 格式（子类重写）
        
        默认实现：提取纯文本（兼容不支持多模态的 provider）
        """
        converted = []
        for msg in messages:
            new_msg = {"role": msg["role"]}
            
            content_list = msg.get("content", [])
            text_parts = []
            for item in content_list:
                if item.get("type") == "text":
                    text_parts.append(item.get("content", ""))
            
            new_msg["content"] = "\n".join(text_parts) if text_parts else ""
            
            if msg.get("tool_calls"):
                new_msg["tool_calls"] = msg["tool_calls"]
            if msg.get("tool_call_id"):
                new_msg["tool_call_id"] = msg["tool_call_id"]
                
            converted.append(new_msg)
        
        return converted
    
    def _add_system_prompt(self, messages: List[Dict[str, Any]], system_prompt: str) -> List[Dict[str, Any]]:
        """添加系统提示到消息开头"""
        if not system_prompt:
            return messages
            
        system_msg = {
            "role": "system",
            "content": [{"type": "text", "content": system_prompt}]
        }
        return [system_msg] + messages
```

### 4.2 OpenAI Provider 实现

```python
# llm/providers/openai.py

import base64
from typing import Optional, List, Dict, Any, AsyncGenerator, Union
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, SystemMessage, ToolMessage
from .base import BaseProviderImpl


class OpenAIProvider(BaseProviderImpl):
    """OpenAI Provider - 支持多模态"""
    
    def __init__(self, config: Dict[str, Any]):
        self.api_key = config.get("api_key", "")
        self.model_name = config.get("model", "gpt-4")
        self.base_url = config.get("base_url", None)
        self.embeddings = OpenAIEmbeddings(
            api_key=self.api_key,
            base_url=self.base_url,
        )

    def _convert_to_provider_format(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """转换为 OpenAI API 多模态格式"""
        converted = []
        
        for msg in self._normalize_messages(messages):
            new_msg = {"role": msg["role"]}
            
            content_list = msg.get("content", [])
            openai_content = []
            
            has_multimodal = any(item.get("type") in ["image", "audio", "video"] for item in content_list)
            
            for item in content_list:
                item_type = item.get("type")
                
                if item_type == "text":
                    openai_content.append({
                        "type": "text",
                        "text": item.get("content", "")
                    })
                    
                elif item_type == "image":
                    image_data = item.get("content", "")
                    
                    if isinstance(image_data, bytes):
                        b64 = base64.b64encode(image_data).decode()
                        mime = "image/png"
                        url = f"data:{mime};base64,{b64}"
                    elif image_data.startswith(("http://", "https://", "data:")):
                        url = image_data
                    else:
                        b64 = base64.b64encode(image_data.encode()).decode() if isinstance(image_data, str) else ""
                        url = f"data:image/png;base64,{b64}"
                    
                    openai_content.append({
                        "type": "image_url",
                        "image_url": {"url": url}
                    })
                    
                elif item_type == "audio":
                    audio_data = item.get("content", "")
                    
                    if isinstance(audio_data, bytes):
                        b64 = base64.b64encode(audio_data).decode()
                    else:
                        b64 = base64.b64encode(audio_data.encode()).decode() if isinstance(audio_data, str) else ""
                    
                    openai_content.append({
                        "type": "input_audio",
                        "input_audio": {
                            "data": b64,
                            "format": item.get("format", "wav")
                        }
                    })
            
            if has_multimodal or len(openai_content) > 1:
                new_msg["content"] = openai_content
            else:
                new_msg["content"] = openai_content[0]["text"] if openai_content else ""
            
            if msg.get("tool_calls"):
                new_msg["tool_calls"] = msg["tool_calls"]
            if msg.get("tool_call_id"):
                new_msg["tool_call_id"] = msg["tool_call_id"]
                
            converted.append(new_msg)
        
        return converted

    async def chat(
        self,
        messages: List[Dict[str, Any]],
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        system_prompt: Optional[str] = None,
    ) -> Dict[str, Any]:
        messages_with_system = self._add_system_prompt(messages, system_prompt)
        provider_messages = self._convert_to_provider_format(messages_with_system)
        
        # 转换为 LangChain 格式...
        langchain_messages = self._to_langchain(provider_messages)
        
        model = ChatOpenAI(...)
        response = await model.ainvoke(langchain_messages)
        
        return {...}

    async def stream(self, messages, temperature=0.7, system_prompt=None):
        messages_with_system = self._add_system_prompt(messages, system_prompt)
        provider_messages = self._convert_to_provider_format(messages_with_system)
        # 流式输出...
```

### 4.3 DeepSeek Provider（类似 OpenAI）

```python
# llm/providers/deepseek.py

class DeepSeekProvider(BaseProviderImpl):
    """DeepSeek Provider - 使用 OpenAI 兼容接口"""
    
    def _convert_to_provider_format(self, messages):
        # 与 OpenAI 类似，DeepSeek 也支持 vision
        pass
```

### 4.4 Kimi Provider（类似 OpenAI）

```python
# llm/providers/kimi.py

class KimiProvider(BaseProviderImpl):
    """Kimi Provider - 使用 OpenAI 兼容接口"""
    
    def _convert_to_provider_format(self, messages):
        # Kimi 支持多模态
        pass
```

### 4.5 Gemma4 Provider ✅ 已符合新协议

```python
# llm/providers/gemma4.py （用户已重构的版本）

# 已经支持新的格式：
# content: [{"type": "text", "content": "..."}, {"type": "image", "content": ...}]

class Gemma4Provider:
    def _convert_messages(self, messages):
        # 已经实现了转换逻辑
        pass
```

---

## 五、服务层实现

### 5.1 ChatSessionService 更新

```python
# services/chat_session_service.py

class ChatSessionService:
    @staticmethod
    def add_message(db: Session, session_id: int, role: str, 
                   content: Union[str, List[Dict]]) -> ChatMessage:
        """
        添加消息到会话
        
        Args:
            db: 数据库会话
            session_id: 会话 ID
            role: 消息角色
            content: 消息内容（字符串或内容项列表）
        """
        db_message = ChatMessage(
            session_id=session_id,
            role=role,
        )
        db.add(db_message)
        db.commit()
        db.refresh(db_message)
        
        # 添加内容项到子表
        if isinstance(content, str):
            content_items = [{"type": "text", "content": content}]
        else:
            content_items = content
        
        for idx, item in enumerate(content_items):
            content_item = MessageContentItem(
                message_id=db_message.id,
                type=item.get("type", "text"),
                content=item.get("content", ""),
                content_id=item.get("id"),  # 可选标识符
                sort_order=idx,
            )
            db.add(content_item)
        
        db.commit()
        
        # 更新会话时间戳
        db.query(ChatSession).filter(ChatSession.id == session_id).update(
            {"updated_at": datetime.utcnow()}
        )
        db.commit()
        
        return db_message
    
    @staticmethod
    def get_message_with_contents(db: Session, message_id: int) -> Dict:
        """获取消息及其完整内容"""
        message = db.query(ChatMessage).filter(ChatMessage.id == message_id).first()
        if not message:
            return None
            
        contents = db.query(MessageContentItem)\
            .filter(MessageContentItem.message_id == message_id)\
            .order_by(MessageContentItem.sort_order)\
            .all()
        
        return {
            "id": message.id,
            "role": message.role,
            "content": [
                {
                    "type": c.type,
                    "content": c.content,
                    "id": c.content_id,
                }
                for c in contents
            ],
            "created_at": message.created_at.isoformat(),
        }
```

---

## 六、API 层实现

### 6.1 v1.py 更新

```python
# api/v1.py

class MessageCreate(BaseModel):
    session_id: str
    content: Union[str, List[Dict]]  # 支持字符串或多模态列表
    provider: Optional[str] = "openai"
    model: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None

@router.post("/chat")
async def send_message(data: MessageCreate, ...):
    # 存储消息（包含多模态内容）
    chat_session_service.add_message(
        db, 
        session.id, 
        "user", 
        data.content  # 可以是字符串或列表
    )
    
    # 发送到 Worker
    task = execute_agent_task.delay(
        data.session_id,
        data.content,  # 传递原始内容
        data.provider,
        data.model,
        current_user.id
    )
    
    return {...}

@router.get("/sessions/{session_id}/messages")
async def get_messages(session_id: str, ...):
    messages = chat_session_service.get_session_messages(db, session.id)
    
    # 返回完整的多模态消息
    result = []
    for msg in messages:
        full_msg = chat_session_service.get_message_with_contents(db, msg.id)
        result.append(full_msg)
    
    return {"messages": result}
```

---

## 七、Worker 层修改

### 7.1 tasks.py 更新

```python
# workers/tasks.py

@celery_app.task(bind=True)
def execute_agent_task(self, session_id, user_input, provider="openai", model=None, user_id=None):
    return asyncio.run(_execute(self, session_id, user_input, provider, model, user_id))

async def _execute(self, session_id, user_input, provider, model, user_id):
    try:
        # 1. 获取上下文消息（现在包含多模态内容）
        messages = SessionManager.get_messages(session_id)
        
        # 2. 获取 system_prompt（但不在这里拼接！）
        system_prompt = get_system_prompt("default")
        
        # 3. 创建 Executor（传递 system_prompt）
        executor = AgentExecutor(
            provider=provider,
            model=model,
            browser_session_id=f"bs_{session_id[:12]}",
            system_prompt=system_prompt  # 新增！
        )
        
        # 4. 执行（Executor 内部会处理 system_prompt）
        result = ""
        async for chunk in executor.execute_stream(messages):
            result += chunk
            await _send_to_session(session_id, {"type": "chunk", "content": chunk})
        
        # 5. 保存 AI 回复（可能是多模态？目前只是文本）
        SessionManager.add_message(session_id, "assistant", result)
        # 同时保存到 PostgreSQL 子表...
        
        await _send_to_session(session_id, {"type": "done", "content": result})
        
    except Exception as e:
        print(f"[Task Error] {e}")
        await _send_to_session(session_id, {"type": "error", "content": str(e)})
```

---

## 八、Agent Executor 修改

### 8.1 executor.py 更新

```python
# agents/executor.py

class AgentExecutor:
    def __init__(self, provider="openai", model=None, browser_session_id=None, system_prompt=None):
        self.provider = provider
        self.model = model
        self.browser_session_id = browser_session_id
        self.system_prompt = system_prompt  # 新增！
        self.graph = self._build_graph()

    async def _thinking_node(self, state: AgentState):
        messages = state["messages"]
        tools = get_available_tools()
        
        resp = await llm_client_instance.chat(
            messages,
            provider=self.provider,
            model=self.model,
            tools=tools if tools else None,
            system_prompt=self.system_prompt  # 传递给 LLMClient！
        )
        
        state["llm_response"] = resp
        return state
```

---

## 九、LLM Client 修改

### 9.1 client.py 更新

```python
# llm/client.py

class LLMClient:
    async def chat(
        self,
        messages: List[Dict[str, Any]],
        provider: Optional[str] = None,
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        system_prompt: Optional[str] = None,  # 新增！
    ) -> Dict[str, Any]:
        """聊天完成"""
        provider_instance = self.get_provider(provider)
        
        kwargs = {
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "tools": tools,
            "system_prompt": system_prompt,  # 传递给 provider
        }
        
        return await provider_instance.chat(**kwargs)

    async def stream(
        self,
        messages: List[Dict[str, Any]],
        provider: Optional[str] = None,
        model: Optional[str] = None,
        temperature: float = 0.7,
        system_prompt: Optional[str] = None,  # 新增！
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """流式聊天"""
        provider_instance = self.get_provider(provider)
        
        async for chunk in provider_instance.stream(
            messages, 
            temperature=temperature,
            system_prompt=system_prompt  # 传递给 provider
        ):
            yield chunk
```

---

## 十、数据库迁移

### 10.1 Alembic Migration

需要创建新的 migration 来：
1. 创建 `message_content_items` 表
2. 从 `chat_messages.content` 迁移数据到子表
3. 删除 `chat_messages.content` 字段（或保留为冗余备份）

```python
# alembic/versions/xxx_add_message_content_items.py

def upgrade():
    # 1. 创建子表
    op.create_table(
        'message_content_items',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('message_id', sa.Integer(), sa.ForeignKey('chat_messages.id'), nullable=False),
        sa.Column('type', sa.String(20), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('content_id', sa.String(100), nullable=True),
        sa.Column('sort_order', sa.Integer(), server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=func.now()),
    )
    
    # 2. 迁移现有数据
    op.execute("""
        INSERT INTO message_content_items (message_id, type, content, sort_order)
        SELECT id, 'text', content, 0 FROM chat_messages WHERE content IS NOT NULL
    """)
    
    # 3. 删除原 content 字段（可选，先注释掉测试）
    # op.drop_column('chat_messages', 'content')

def downgrade():
    op.drop_table('message_content_items')
    # 如果需要恢复 content 字段...
```

---

## 十一、实施步骤（按优先级排序）

### Phase 1: 数据库层 ⭐⭐⭐
1. [ ] 创建 `MessageContentItem` 模型 (`models/chat_session.py`)
2. [ ] 修改 `ChatMessage` 模型（移除 content，添加 relationship）
3. [ ] 创建 Alembic migration
4. [ ] 运行数据库迁移
5. [ ] 测试数据完整性

### Phase 2: Schema 和 Service 层 ⭐⭐⭐
6. [ ] 定义 Pydantic 模型 (`schemas/chat_session.py`)
7. [ ] 实现 `ChatSessionService.add_message()` 新逻辑
8. [ ] 实现 `get_message_with_contents()` 方法
9. [ ] 编写单元测试

### Phase 3: Provider 层 ⭐⭐⭐
10. [ ] 重构 `BaseProvider` 接口（添加 system_prompt 参数）
11. [ ] 实现 `BaseProviderImpl` 基础方法
12. [ ] 重构 `OpenAIProvider`（添加多模态转换）
13. [ ] 重构 `DeepSeekProvider`
14. [ ] 重构 `KimiProvider`
15. [ ] 验证 `Gemma4Provider` 兼容性

### Phase 4: 集成层 ⭐⭐
16. [ ] 修改 `LLMClient`（传递 system_prompt）
17. [ ] 修改 `workers/tasks.py`（移除外部拼接）
18. [ ] 修改 `agents/executor.py`（传递 system_prompt）

### Phase 5: API 层 ⭐⭐
19. [ ] 修改 `api/v1.py`（支持多模态请求/响应）
20. [ ] 测试 API 端点

### Phase 6: 前端适配（后续）⭐
21. [ ] 修改 Chat.vue（构建多模态消息）
22. [ ] 图片上传组件
23. [ ] 音频录制集成
24. [ ] 多模态内容展示

---

## 十二、注意事项

### 向后兼容性
✅ **必须保证**：旧的字符串格式消息能正常工作
- API 层自动检测 `content` 类型
- Provider 层自动转换字符串 → 列表
- 数据库兼容查询

### 性能考虑
⚠️ **大文件处理**：
- 音频/视频可能很大，考虑：
  - 使用文件存储（S3/OSS），只存 URL
  - base64 编码会增加 ~33% 大小
  - 考虑异步处理大文件

### 错误处理
🔍 **降级策略**：
- 不支持多模态的 provider 自动提取文本
- 格式错误时记录日志并优雅降级
- 文件损坏时提供友好错误信息

### 安全性
🔒 **安全检查**：
- 文件类型白名单
- 文件大小限制
- base64 解码验证
- 防止 XSS（图片 URL）

---

## 十三、文件修改汇总

| 文件路径 | 修改类型 | 优先级 | 说明 |
|---------|---------|--------|------|
| `models/chat_session.py` | **重构** | P0 | 新增子表模型 |
| `schemas/chat_session.py` | **重构** | P0 | 多模态 Schema |
| `services/chat_session_service.py` | **重构** | P0 | 子表操作方法 |
| `llm/providers/base.py` | **重构** | P0 | 统一接口 + 工具方法 |
| `llm/providers/openai.py` | **重构** | P0 | 多模态转换器 |
| `llm/providers/deepseek.py` | **重构** | P0 | 同上 |
| `llm/providers/kimi.py` | **重构** | P0 | 同上 |
| `llm/providers/gemma4.py` | 微调 | P0 | 确保兼容 |
| `llm/client.py` | 修改 | P0 | system_prompt 参数 |
| `workers/tasks.py` | 修改 | P0 | 移除外部拼接 |
| `agents/executor.py` | 修改 | P0 | 传递 system_prompt |
| `api/v1.py` | 修改 | P1 | 多模态 API |
| `alembic/versions/xxx.py` | 新建 | P0 | 数据库迁移 |

**总计：13 个文件需要修改/新建**

---

## 十四、测试用例示例

### 用例 1：纯文本消息（向后兼容）
```python
# 输入
messages = [{"role": "user", "content": "你好"}]

# 期望行为
# 1. 自动转换为：[{"role": "user", "content": [{"type": "text", "content": "你好"}]}]
# 2. 存储到子表：1条 text 记录
# 3. 各 provider 正常工作
```

### 用例 2：多模态消息
```python
# 输入
messages = [{
    "role": "user",
    "content": [
        {"type": "text", "content": "描述这张图片"},
        {"type": "image", "content": base64_image, "id": "img1"}
    ]
}]

# 期望行为
# 1. 存储到子表：2条记录（text + image）
# 2. OpenAI/Kimi 正确解析多模态
# 3. Gemma4 正确处理
# 4. DeepSeek 降级为纯文本（如果暂不支持 vision）
```

### 用例 3：System Prompt
```python
# 输入
messages = [{"role": "user", "content": "hello"}]
system_prompt = "你是一个助手"

# 期望行为
# 1. tasks.py 不再手动拼接
# 2. provider 内部在 messages 前面插入 system 消息
# 3. 最终发送：[system_msg, user_msg]
```

---

**准备就绪，等待确认后开始实施！** 🚀
