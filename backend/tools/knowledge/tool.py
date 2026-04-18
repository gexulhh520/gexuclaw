"""
知识检索工具 - 用于 Agent 检索用户知识库中的文档内容
"""
from typing import Dict, Any, List, Optional

from ..tool_result import ToolResult
from ..tool_operation import ToolOperation
from ..tool_registry import tool
from ..base import BaseTool
from ..knowledge_tool import search_knowledge_results, get_knowledge_stats, has_knowledge_base


@tool("knowledge")
class KnowledgeTool(BaseTool):
    """
    知识检索工具类，包含：
    - search: 搜索用户知识库中的相关文档内容
    - stats: 获取用户知识库统计信息
    - check: 检查用户是否有知识库数据

    注意：user_id 由系统自动注入，无需在参数中提供
    """

    category = "knowledge"
    description = "知识库检索工具，支持搜索用户上传的文档内容（自动使用当前登录用户）"

    def __init__(self):
        super().__init__()

    def _register_operations(self):
        """
        注册所有知识检索操作
        """
        self.operations = {
            "search": ToolOperation(
                name="search",
                description="搜索用户知识库中的相关文档内容",
                parameters=[
                    {
                        "name": "query",
                        "type": "string",
                        "required": True,
                        "description": "搜索查询文本",
                    },
                    {
                        "name": "top_k",
                        "type": "integer",
                        "required": False,
                        "description": "返回结果数量，默认 8",
                    },
                    {
                        "name": "session_id",
                        "type": "string",
                        "required": False,
                        "description": "可选的会话 ID 过滤",
                    },
                    {
                        "name": "knowledge_base_ids",
                        "type": "array",
                        "required": False,
                        "description": "可选的知识库 ID 列表，用于限定检索范围",
                    },
                ],
                func=self.search,
            ),
            "stats": ToolOperation(
                name="stats",
                description="获取用户知识库统计信息",
                parameters=[
                    {
                        "name": "knowledge_base_ids",
                        "type": "array",
                        "required": False,
                        "description": "可选的知识库 ID 列表，用于限定统计范围",
                    },
                ],
                func=self.stats,
            ),
            "check": ToolOperation(
                name="check",
                description="检查用户是否有知识库数据",
                parameters=[
                    {
                        "name": "knowledge_base_ids",
                        "type": "array",
                        "required": False,
                        "description": "可选的知识库 ID 列表，用于限定检查范围",
                    },
                ],
                func=self.check,
            ),
        }

    # ====== 操作实现 ======

    def search(
        self,
        query: str,
        user_id: int,
        top_k: int = 8,
        session_id: Optional[str] = None,
        knowledge_base_ids: Optional[List[int]] = None,
    ) -> ToolResult:
        """搜索用户知识库中的相关文档内容"""
        try:
            search_result = search_knowledge_results(
                query=query,
                user_id=user_id,
                top_k=top_k,
                session_id=session_id,
                knowledge_base_ids=knowledge_base_ids,
            )

            if not search_result.get("success"):
                return ToolResult(False, error=search_result.get("error", "知识检索失败"))

            results = search_result.get("results", [])
            if not results:
                return ToolResult(
                    True,
                    data=search_result.get("message", "未找到相关内容"),
                    meta={
                        "has_knowledge": search_result.get("has_knowledge", False),
                        "results_count": 0,
                    }
                )

            contents = []
            files = set()
            knowledge_base_names = set()
            for item in results:
                content = item.get("content", "")
                filename = item.get("filename", "未知文件")
                chunk_index = int(item.get("chunk_index", 0))
                knowledge_base_name = item.get("knowledge_base_name")

                if content and content.strip():
                    prefix = f"【{knowledge_base_name} / {filename} - 片段 {chunk_index + 1}】" if knowledge_base_name else f"【{filename} - 片段 {chunk_index + 1}】"
                    contents.append(f"{prefix}\n{content.strip()}")
                    files.add(filename)
                    if knowledge_base_name:
                        knowledge_base_names.add(knowledge_base_name)

            if not contents:
                return ToolResult(
                    True,
                    data="未找到有效内容",
                    meta={"has_knowledge": True, "results_count": 0}
                )

            result_text = "\n\n---\n\n".join(contents)

            return ToolResult(
                True,
                data=result_text,
                meta={
                    "has_knowledge": True,
                    "results_count": len(contents),
                    "files": list(files),
                    "knowledge_bases": list(knowledge_base_names),
                    "user_id": user_id,
                    "knowledge_base_ids": knowledge_base_ids or [],
                }
            )

        except Exception as e:
            return ToolResult(False, error=f"知识检索失败: {str(e)}")

    def stats(self, user_id: int, knowledge_base_ids: Optional[List[int]] = None) -> ToolResult:
        """获取用户知识库统计信息"""
        try:
            if not user_id:
                return ToolResult(False, error="未提供用户 ID")

            return ToolResult(
                True,
                data=get_knowledge_stats(user_id, knowledge_base_ids),
                meta={
                    "user_id": user_id,
                    "knowledge_base_ids": knowledge_base_ids or [],
                }
            )

        except Exception as e:
            return ToolResult(False, error=f"获取知识库统计失败: {str(e)}")

    def check(self, user_id: int, knowledge_base_ids: Optional[List[int]] = None) -> ToolResult:
        """检查用户是否有知识库数据"""
        try:
            if not user_id:
                return ToolResult(False, error="未提供用户 ID")
            has_data = has_knowledge_base(user_id, knowledge_base_ids)

            return ToolResult(
                True,
                data=has_data,
                meta={
                    "user_id": user_id,
                    "has_knowledge": has_data,
                    "knowledge_base_ids": knowledge_base_ids or [],
                }
            )

        except Exception as e:
            return ToolResult(False, error=f"检查知识库失败: {str(e)}")
