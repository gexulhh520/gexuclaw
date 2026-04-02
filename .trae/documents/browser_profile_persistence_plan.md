# 浏览器数据持久化功能实现计划

## 问题分析

当前浏览器工具**不具备**数据持久化能力：
- 每次任务启动新的 Browser Context
- 登录状态、Cookie、LocalStorage 在任务结束后丢失
- 用户需要重复登录

## 目标

实现浏览器数据持久化，让登录状态在任务间保持：
1. 使用 Playwright 的 `storage_state` 保存/恢复用户数据
2. 默认使用 "gexuclaw" profile，所有任务共享
3. 任务结束时自动保存，启动时自动加载

## 实现方案

### 1. 修改 TaskBrowserManager

**文件**: `backend/tools/browser/task_browser_manager.py`

#### 1.1 添加 Profile 目录常量
```python
# Profile 存储目录
PROFILE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "browser_profiles")
DEFAULT_PROFILE = "gexuclaw"
```

#### 1.2 添加 Profile 管理方法
```python
def _get_profile_path(self, profile_name: str) -> str:
    """获取 profile 文件路径"""
    return os.path.join(PROFILE_DIR, f"{profile_name}.json")

def _load_storage_state(self, profile_name: str) -> Optional[Dict]:
    """加载 storage state (cookies, localStorage 等)"""
    profile_path = self._get_profile_path(profile_name)
    if os.path.exists(profile_path):
        try:
            with open(profile_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"[TaskBrowserManager] 加载 profile 失败: {e}")
    return None

async def _save_storage_state(self, profile_name: str, context: BrowserContext):
    """保存 storage state"""
    os.makedirs(PROFILE_DIR, exist_ok=True)
    profile_path = self._get_profile_path(profile_name)
    try:
        storage_state = await context.storage_state()
        with open(profile_path, 'w', encoding='utf-8') as f:
            json.dump(storage_state, f, ensure_ascii=False, indent=2)
        print(f"[TaskBrowserManager] Profile 已保存: {profile_name}")
    except Exception as e:
        print(f"[TaskBrowserManager] 保存 profile 失败: {e}")
```

#### 1.3 修改 create_session 方法
```python
async def create_session(
    self, 
    session_id: str, 
    headless: bool = False,
    profile_name: str = DEFAULT_PROFILE
) -> TaskBrowserSession:
    """
    创建新的浏览器会话，支持 profile 持久化
    
    Args:
        session_id: 会话 ID
        headless: 是否无头模式
        profile_name: Profile 名称，默认使用 "gexuclaw"
    """
    async with self._lock:
        # ... 已有代码 ...
        
        # 加载 storage_state（如果有）
        storage_state = self._load_storage_state(profile_name)
        
        # 创建 Context，传入 storage_state
        context_options = {
            'viewport': {'width': 1920, 'height': 1080},
            'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
        if storage_state:
            context_options['storage_state'] = storage_state
            print(f"[TaskBrowserManager] 加载 profile: {profile_name}")
        
        context = await browser.new_context(**context_options)
        
        # 保存 profile 名称到 session，用于后续保存
        session = TaskBrowserSession(
            session_id=session_id,
            browser=browser,
            context=context,
            page=page,
            playwright=playwright,
            profile_name=profile_name  # 新增
        )
```

#### 1.4 修改 _close_session_internal 方法
```python
async def _close_session_internal(self, session_id: str):
    """内部关闭方法（必须在锁内调用）"""
    session = self._sessions.pop(session_id, None)
    if not session:
        return

    print(f"[TaskBrowserManager] 关闭 Session: {session_id}")

    # 保存 profile（如果有）
    if hasattr(session, 'profile_name') and session.profile_name:
        await self._save_storage_state(session.profile_name, session.context)

    # ... 已有关闭代码 ...
```

#### 1.5 修改 TaskBrowserSession dataclass
```python
@dataclass
class TaskBrowserSession:
    """任务级浏览器会话"""
    session_id: str
    browser: Browser
    context: BrowserContext
    page: Page
    playwright: Any
    profile_name: str = DEFAULT_PROFILE  # 新增
    created_at: datetime = field(default_factory=datetime.now)
```

### 2. 修改 BrowserTool

**文件**: `backend/tools/browser/tool.py`

#### 2.1 修改 launch_browser 操作
- 移除 `profile` 参数（固定使用 "gexuclaw"）
- 内部调用时传入 `profile_name=DEFAULT_PROFILE`

```python
async def launch_browser(
    self,
    browser_session_id: Optional[str] = None,
    url: Optional[str] = None
) -> ToolResult:
    """
    启动浏览器会话
    自动使用默认 gexuclaw profile，支持登录状态持久化
    """
    # ... 
    session = await self._task_browser_manager.create_session(
        session_id=browser_session_id,
        headless=False,
        profile_name=DEFAULT_PROFILE  # 固定使用默认 profile
    )
    # ...
```

### 3. 修改 Celery Worker 启动逻辑

**文件**: `backend/workers/celery_app.py`

#### 3.1 Worker 启动时创建默认 profile
```python
@worker_init.connect
def init_worker(**kwargs):
    print("[Worker] 初始化默认 browser profile...")
    from tools.browser.task_browser_manager import get_task_browser_manager, DEFAULT_PROFILE
    task_browser_manager = get_task_browser_manager()
    
    # 创建默认 profile 文件（如果不存在）
    profile_path = os.path.join(PROFILE_DIR, f"{DEFAULT_PROFILE}.json")
    if not os.path.exists(profile_path):
        os.makedirs(os.path.dirname(profile_path), exist_ok=True)
        with open(profile_path, 'w', encoding='utf-8') as f:
            json.dump({"cookies": [], "origins": []}, f)
        print(f"[Worker] 创建默认 profile: {DEFAULT_PROFILE}")
    else:
        print(f"[Worker] 默认 profile 已存在: {DEFAULT_PROFILE}")
```

### 4. 目录结构

```
backend/
├── data/
│   └── browser_profiles/
│       └── gexuclaw.json          # 默认 profile 存储
├── tools/
│   └── browser/
│       ├── task_browser_manager.py  # 修改
│       ├── tool.py                  # 修改
│       └── ...
└── workers/
    └── celery_app.py              # 修改
```

## 工作流程

```
Worker 启动
    ↓
创建 gexuclaw.json（如果不存在）
    ↓
任务 A 启动浏览器
    ↓
加载 gexuclaw.json 中的 cookies/localStorage
    ↓
用户登录网站（如百度）
    ↓
任务 A 结束
    ↓
自动保存 storage_state 到 gexuclaw.json
    ↓
任务 B 启动浏览器
    ↓
加载 gexuclaw.json（包含登录状态）
    ↓
用户已是登录状态
```

## 注意事项

1. **安全性**: profile 文件包含敏感信息（cookies），注意文件权限
2. **并发**: 多个任务同时读写同一 profile 可能有冲突（当前设计每个任务独立 browser，但共享 profile 文件）
3. **清理**: 长期运行后 profile 文件可能变大，可定期清理

## 测试步骤

1. 启动 Worker，检查是否创建 `backend/data/browser_profiles/gexuclaw.json`
2. 发送消息 "打开百度并登录"
3. 完成任务后检查 profile 文件是否更新（cookies 增加）
4. 开启新任务 "打开百度"，检查是否已是登录状态
