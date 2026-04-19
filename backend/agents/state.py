from typing import List, Dict, Any, TypedDict, Optional


class AgentState(TypedDict):
    """Agent 状态定义"""
    messages: List[Dict[str, Any]]  # 对话历史
    pending_events: List[Dict[str, Any]]  # 待发送事件
    context_tokens: int  # 当前上下文 token 数
    session_id: str
    model: str = None
    browser_session_id: str = None
    last_thinking_content: str = None  # 最近一次思考内容
    llm_response: Optional[Dict[str, Any]] = None  # LLM 响应
    summary_history: str = ""  # 摘要历史
    _node_events: List[Dict[str, Any]] = None  # 节点事件队列
    scheduled_task_route: Optional[Dict[str, Any]] = None
    scheduled_task_draft: Optional[Dict[str, Any]] = None
