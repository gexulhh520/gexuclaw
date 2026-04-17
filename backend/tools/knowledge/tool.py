"""
知识检索工具 - 用于 Agent 检索用户知识库中的文档内容
"""
from typing import Dict, Any, List, Optional
from pathlib import Path

import lancedb
import ollama

from ..tool_result import ToolResult
from ..tool_operation import ToolOperation
from ..tool_registry import tool
from ..base import BaseTool
from core.config import get_settings

settings = get_settings()


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
        self.ollama_client = ollama.Client(host=settings.OLLAMA_BASE_URL)
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
                ],
                func=self.search,
            ),
            "stats": ToolOperation(
                name="stats",
                description="获取用户知识库统计信息",
                parameters=[],
                func=self.stats,
            ),
            "check": ToolOperation(
                name="check",
                description="检查用户是否有知识库数据",
                parameters=[],
                func=self.check,
            ),
        }

    # ====== 操作实现 ======

    def search(
        self,
        query: str,
        user_id: int,
        top_k: int = 8,
        session_id: Optional[str] = None
    ) -> ToolResult:
        """搜索用户知识库中的相关文档内容"""
        try:
            if not user_id:
                return ToolResult(False, error="未提供用户 ID，无法搜索知识库")

            if not query or not query.strip():
                return ToolResult(False, error="搜索查询不能为空")

            # 连接 LanceDB
            db = lancedb.connect(settings.LANCEDB_URI)
            table_name = f"{settings.LANCEDB_TABLE_PREFIX}{user_id}"

            # 检查表是否存在
            if table_name not in db.table_names():
                return ToolResult(
                    True,
                    data="该用户暂无知识库数据，请先上传文档",
                    meta={"has_knowledge": False, "results_count": 0}
                )

            table = db.open_table(table_name)

            # 检查表是否为空
            if table.count_rows() == 0:
                return ToolResult(
                    True,
                    data="知识库为空，请先上传文档",
                    meta={"has_knowledge": False, "results_count": 0}
                )

            # 使用 Ollama 生成查询的 embedding
            try:
                response = self.ollama_client.embeddings(
                    model=settings.EMBEDDING_MODEL,
                    prompt=query
                )
                query_vector = response['embedding']
            except Exception as e:
                return ToolResult(
                    False,
                    error=f"生成查询 embedding 失败: {str(e)}"
                )

            # 执行向量搜索
            try:
                results = table.search(query_vector).limit(top_k).to_pandas()
            except Exception as e:
                return ToolResult(
                    False,
                    error=f"向量搜索失败: {str(e)}"
                )

            if len(results) == 0:
                return ToolResult(
                    True,
                    data="未找到相关内容",
                    meta={"has_knowledge": True, "results_count": 0}
                )

            # 格式化返回结果
            contents = []
            files = set()
            for idx, row in results.iterrows():
                content = row.get('content', '')
                filename = row.get('filename', '未知文件')
                chunk_index = row.get('chunk_index', 0)

                if content and content.strip():
                    contents.append(
                        f"【{filename} - 片段 {chunk_index + 1}】\n{content.strip()}"
                    )
                    files.add(filename)

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
                    "user_id": user_id,
                }
            )

        except Exception as e:
            return ToolResult(False, error=f"知识检索失败: {str(e)}")

    def stats(self, user_id: int) -> ToolResult:
        """获取用户知识库统计信息"""
        try:
            if not user_id:
                return ToolResult(False, error="未提供用户 ID")

            db = lancedb.connect(settings.LANCEDB_URI)
            table_name = f"{settings.LANCEDB_TABLE_PREFIX}{user_id}"

            if table_name not in db.table_names():
                return ToolResult(
                    True,
                    data={
                        "has_knowledge": False,
                        "total_chunks": 0,
                        "files": []
                    },
                    meta={"user_id": user_id}
                )

            table = db.open_table(table_name)
            total_chunks = table.count_rows()

            # 获取文件列表
            df = table.to_pandas()
            files = df['filename'].unique().tolist() if len(df) > 0 else []

            return ToolResult(
                True,
                data={
                    "has_knowledge": total_chunks > 0,
                    "total_chunks": total_chunks,
                    "files": files
                },
                meta={
                    "user_id": user_id,
                    "table_name": table_name
                }
            )

        except Exception as e:
            return ToolResult(False, error=f"获取知识库统计失败: {str(e)}")

    def check(self, user_id: int) -> ToolResult:
        """检查用户是否有知识库数据"""
        try:
            if not user_id:
                return ToolResult(False, error="未提供用户 ID")

            db = lancedb.connect(settings.LANCEDB_URI)
            table_name = f"{settings.LANCEDB_TABLE_PREFIX}{user_id}"

            if table_name not in db.table_names():
                return ToolResult(
                    True,
                    data=False,
                    meta={"user_id": user_id, "has_knowledge": False}
                )

            table = db.open_table(table_name)
            has_data = table.count_rows() > 0

            return ToolResult(
                True,
                data=has_data,
                meta={
                    "user_id": user_id,
                    "has_knowledge": has_data,
                    "table_name": table_name
                }
            )

        except Exception as e:
            return ToolResult(False, error=f"检查知识库失败: {str(e)}")
