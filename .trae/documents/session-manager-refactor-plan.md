# Session Manager 重构计划：将 session_id 生成移至任务层

## 一、当前架构分析

### 当前流程
```
tasks.py
    └── AgentExecutor()  ← 创建时不传 browser_session_id
            └── execute_stream()
                    └── run_tool() → launch_browser()
                            └── SessionManager.create_session()  ← 自动生成 session_id
                                    └── 返回 session_id 给 LLM
                                            └── LLM 记住 session_id，后续操作使用
```

### 问题
1. **session_id 生成位置不当**：在工具内部自动生成，LLM 需要记忆
2. **与聊天会话无关联**：browser session 和 chat session 是独立的
3. **生命周期不清晰**：不知道何时应该清理 session

## 二、目标架构

### 新流程
```
tasks.py (_execute)
    │
    ├── 1. 生成/获取 browser_session_id (基于 chat session_id)
    │       └── browser_session_id = f"bs_{chat_session_id}"
    │
    └── 2. 创建 AgentExecutor(browser_session_id=xxx)
            │
            └── 3. 执行工具时，自动使用 browser_session_id
                    └── run_tool(tool_calls, browser_session_id=xxx)
                            └── BrowserTool 使用已存在的 session
```

## 三、具体修改步骤

### 步骤 1: 修改 SessionManager - 支持指定 session_id

**文件**: `backend/tools/browser/session_manager.py`

修改 `create_session` 方法：
```python
async def create_session(
    self,
    cdp_port: int,
    browser: Browser,
    session_id: Optional[str] = None,  # 新增：允许外部指定
    metadata: Optional[Dict[str, Any]] = None
) -> BrowserSession:
    async with self._lock:
        # 如果未提供 session_id，则自动生成（向后兼容）
        if not session_id:
            session_id = f"sess_{uuid.uuid4().hex[:12]}"
        
        # 检查是否已存在
        if session_id in self._sessions:
            return self._sessions[session_id]
        
        context = await browser.new_context()
        page = await context.new_page()
        
        session = BrowserSession(...)
        self._sessions[session_id] = session
        return session
```

### 步骤 2: 修改 BrowserTool.launch_browser - 支持接收 session_id

**文件**: `backend/tools/browser/tool.py`

```python
async def launch_browser(
    self,
    profile_name: str,
    headless: bool = True,
    url: Optional[str] = None,
    browser_session_id: Optional[str] = None,  # 新增参数
) -> ToolResult:
    # ... 获取 profile ...
    
    # 创建或获取 session
    session = await self._browser_controller.create_session(
        cdp_port=profile.cdp_port,
        session_id=browser_session_id,  # 传入指定的 session_id
        metadata={...}
    )
    
    return ToolResult(True, data={
        "session_id": session.session_id,  # 返回同一个 session_id
        ...
    })
```

### 步骤 3: 修改 BrowserController.create_session - 传递 session_id

**文件**: `backend/tools/browser/browser_controller.py`

```python
async def create_session(
    self,
    cdp_port: int,
    session_id: Optional[str] = None,  # 新增
    metadata: Optional[Dict[str, Any]] = None
) -> BrowserSession:
    browser = await self.connect(cdp_port)
    
    session_manager = get_session_manager()
    session = await session_manager.create_session(
        cdp_port, 
        browser, 
        session_id=session_id,  # 传递
        metadata=metadata
    )
    return session
```

### 步骤 4: 修改 AgentExecutor - 接收并存储 browser_session_id

**文件**: `backend/agents/executor.py`

```python
class AgentExecutor:
    def __init__(
        self, 
        provider: str = "openai", 
        model: str = None,
        browser_session_id: str = None  # 新增
    ):
        self.provider = provider
        self.model = model
        self.browser_session_id = browser_session_id  # 存储
        self.graph = self._build_graph()
```

### 步骤 5: 修改 run_tool 函数 - 注入 browser_session_id

**文件**: `backend/agents/executor.py`

方案 A: 通过 arguments 注入（推荐）
- LLM 调用浏览器工具时，自动附加 browser_session_id 参数

```python
async def run_tool(
    tool_calls: List[Dict[str, Any]], 
    browser_session_id: str = None  # 新增参数
):
    for call in tool_calls:
        name = function_info.get("name", "")
        arguments = json.loads(arguments_str)
        
        # 如果是浏览器操作且提供了 browser_session_id，自动注入
        if browser_session_id and name.startswith("browser__"):
            if "launch_browser" in name or "navigate" in name or "click" in name:
                arguments["browser_session_id"] = browser_session_id
        
        result = await tool_runtime.execute_by_name_async(name, arguments)
```

方案 B: 通过全局上下文注入
- 将 browser_session_id 存储到 ThreadLocal 或类似机制中
- 工具执行时从上下文读取

### 步骤 6: 修改 tasks.py - 生成并传入 browser_session_id

**文件**: `backend/workers/tasks.py`

```python
async def _execute(self, session_id, user_input, provider="openai", model=None, user_id=None):
    try:
        # 生成 browser_session_id (与 chat session 关联)
        browser_session_id = f"bs_{session_id[:12]}"
        
        # 创建 AgentExecutor 并传入 browser_session_id
        executor = AgentExecutor(
            provider=provider, 
            model=model,
            browser_session_id=browser_session_id  # 新增
        )
        
        # 修改 execute_stream 以支持传递 browser_session_id
        async for chunk in executor.execute_stream(messages_with_system):
            ...
```

### 步骤 7: 修改 execute_stream 方法 - 传递 browser_session_id

**文件**: `backend/agents/executor.py`

需要将 browser_session_id 传递到 run_tool 调用。由于 LangGraph 的限制，可能需要：
- 方案 A: 将 browser_session_id 存入 state
- 方案 B: 使用闭包或 partial 函数绑定

```python
async def execute_stream(self, messages: List[Dict]) -> AsyncGenerator[str, None]:
    state = {
        "messages": messages,
        "browser_session_id": self.browser_session_id  # 存入 state
    }
    
    result = await self.graph.ainvoke(state)
    ...
```

然后在 `_acting_node` 中从 state 获取：
```python
async def _acting_node(self, state: AgentState):
    browser_session_id = state.get("browser_session_id")
    
    tool_messages = await run_tool(
        state["llm_response"].get("tool_calls"),
        browser_session_id=browser_session_id
    )
    ...
```

## 四、文件修改清单

| 文件 | 修改内容 |
|------|---------|
| `tools/browser/session_manager.py` | create_session 支持 session_id 参数 |
| `tools/browser/browser_controller.py` | create_session 传递 session_id |
| `tools/browser/tool.py` | launch_browser 等方法接收 browser_session_id |
| `agents/executor.py` | AgentExecutor 接收 browser_session_id；run_tool 注入；state 传递 |
| `workers/tasks.py` | 生成 browser_session_id 并传入 AgentExecutor |

## 五、注意事项

1. **向后兼容**：所有新增参数都设置默认值 None，保持现有功能可用
2. **session 复用**：如果 session_id 已存在，直接返回已有 session
3. **清理机制**：任务结束时可选关闭对应的 browser session
4. **错误处理**：如果 browser_session_id 对应的 session 不存在，自动创建

## 六、预期效果

重构后：
- ✅ browser_session_id 在任务开始时就确定
- ✅ 与 chat session_id 关联（如 `bs_abc123def456`）
- ✅ LLM 不需要记忆 session_id
- ✅ 所有浏览器操作自动使用正确的 session
- ✅ 任务结束后可以方便地清理对应 session
