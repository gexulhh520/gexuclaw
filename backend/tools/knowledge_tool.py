"""
知识检索工具 - 用于 Agent 检索用户知识库中的文档内容
"""
from typing import Optional, List, Dict, Any
import lancedb
import ollama

from core.config import get_settings

settings = get_settings()


def _normalize_knowledge_base_ids(knowledge_base_ids: Optional[List[int]]) -> Optional[List[int]]:
    if not knowledge_base_ids:
        return None
    return list(dict.fromkeys(int(kb_id) for kb_id in knowledge_base_ids))


def _open_user_table(user_id: int):
    db = lancedb.connect(settings.LANCEDB_URI)
    table_name = f"{settings.LANCEDB_TABLE_PREFIX}{user_id}"

    if table_name not in db.table_names():
        return None, table_name

    return db.open_table(table_name), table_name


def _build_query_vector(query: str) -> List[float]:
    ollama_client = ollama.Client(host=settings.OLLAMA_BASE_URL)
    response = ollama_client.embeddings(
        model=settings.EMBEDDING_MODEL,
        prompt=query
    )
    return response['embedding']


def search_knowledge_results(
    query: str,
    user_id: int,
    top_k: int = 8,
    session_id: Optional[str] = None,
    knowledge_base_ids: Optional[List[int]] = None,
) -> Dict[str, Any]:
    if not user_id:
        return {
            "success": False,
            "error": "未提供用户 ID，无法搜索知识库",
            "results": [],
            "has_knowledge": False,
        }

    if not query or not query.strip():
        return {
            "success": False,
            "error": "搜索查询不能为空",
            "results": [],
            "has_knowledge": False,
        }

    try:
        table, table_name = _open_user_table(user_id)
        if table is None:
            return {
                "success": True,
                "results": [],
                "has_knowledge": False,
                "message": "该用户暂无知识库数据，请先上传文档",
                "table_name": table_name,
            }

        if table.count_rows() == 0:
            return {
                "success": True,
                "results": [],
                "has_knowledge": False,
                "message": "知识库为空，请先上传文档",
                "table_name": table_name,
            }

        query_vector = _build_query_vector(query)
        search_limit = max(top_k * 5, 50)
        results = table.search(query_vector).limit(search_limit).to_pandas()

        if len(results) == 0:
            return {
                "success": True,
                "results": [],
                "has_knowledge": True,
                "message": "未找到相关内容",
                "table_name": table_name,
            }

        normalized_ids = _normalize_knowledge_base_ids(knowledge_base_ids)
        if normalized_ids:
            results = results[results["knowledge_base_id"].isin(normalized_ids)] if "knowledge_base_id" in results.columns else results.iloc[0:0]

        if len(results) == 0:
            return {
                "success": True,
                "results": [],
                "has_knowledge": True,
                "message": "未找到相关内容",
                "table_name": table_name,
            }

        formatted_results: List[Dict[str, Any]] = []
        for _, row in results.head(top_k).iterrows():
            content = row.get('content', '')
            if not content or not str(content).strip():
                continue

            formatted_results.append({
                "content": str(content).strip(),
                "knowledge_base_id": row.get("knowledge_base_id"),
                "knowledge_base_name": row.get("knowledge_base_name"),
                "category": row.get("category"),
                "document_id": row.get("document_id"),
                "filename": row.get("filename", "未知文件"),
                "chunk_index": int(row.get("chunk_index", 0)),
                "score": row.get("_distance", row.get("score")),
            })

        return {
            "success": True,
            "results": formatted_results,
            "has_knowledge": True,
            "message": "ok" if formatted_results else "未找到有效内容",
            "table_name": table_name,
        }
    except Exception as e:
        print(f"[KnowledgeTool] 知识检索失败: {e}")
        return {
            "success": False,
            "error": f"知识检索失败: {str(e)}",
            "results": [],
            "has_knowledge": False,
        }


def search_knowledge(
    query: str,
    user_id: int,
    top_k: int = 8,
    session_id: Optional[str] = None,
    knowledge_base_ids: Optional[List[int]] = None,
) -> str:
    """
    搜索用户知识库中的相关文档片段

    Args:
        query: 搜索查询文本
        user_id: 用户 ID（用于数据隔离）
        top_k: 返回结果数量，默认 8
        session_id: 可选的会话 ID 过滤

    Returns:
        相关文档内容拼接的字符串，如果没有找到则返回提示信息
    """
    search_result = search_knowledge_results(
        query=query,
        user_id=user_id,
        top_k=top_k,
        session_id=session_id,
        knowledge_base_ids=knowledge_base_ids,
    )

    if not search_result.get("success"):
        return search_result.get("error", "知识检索失败")

    results = search_result.get("results", [])
    if not results:
        return search_result.get("message", "未找到相关内容")

    contents = []
    for item in results:
        kb_name = item.get("knowledge_base_name")
        filename = item.get("filename", "未知文件")
        chunk_index = int(item.get("chunk_index", 0)) + 1
        prefix = f"【{kb_name} / {filename} - 片段 {chunk_index}】" if kb_name else f"【{filename} - 片段 {chunk_index}】"
        contents.append(f"{prefix}\n{item.get('content', '').strip()}")

    return "\n\n---\n\n".join(contents) if contents else "未找到有效内容"


def search_knowledge_simple(
    query: str,
    user_id: int,
    top_k: int = 5,
    knowledge_base_ids: Optional[List[int]] = None,
) -> str:
    """
    简化的知识检索接口（用于 LangChain Tool）

    Args:
        query: 搜索查询文本
        user_id: 用户 ID
        top_k: 返回结果数量

    Returns:
        相关文档内容
    """
    return search_knowledge(query, user_id, top_k, knowledge_base_ids=knowledge_base_ids)


async def async_search_knowledge(
    query: str,
    user_id: int,
    top_k: int = 8,
    session_id: Optional[str] = None,
    knowledge_base_ids: Optional[List[int]] = None,
) -> str:
    """
    异步版本的知识检索（用于 async 环境）

    Args:
        query: 搜索查询文本
        user_id: 用户 ID
        top_k: 返回结果数量
        session_id: 可选的会话 ID

    Returns:
        相关文档内容
    """
    # 由于 LanceDB 和 Ollama 的同步调用很快，直接调用同步版本
    return search_knowledge(query, user_id, top_k, session_id, knowledge_base_ids=knowledge_base_ids)


# LangChain Tool 封装（可选）
try:
    from langchain.tools import StructuredTool
    from pydantic import BaseModel, Field

    class KnowledgeSearchInput(BaseModel):
        """知识搜索工具输入参数"""
        query: str = Field(description="搜索查询文本")
        user_id: int = Field(description="用户 ID")
        top_k: int = Field(default=8, description="返回结果数量")
        knowledge_base_ids: Optional[List[int]] = Field(default=None, description="限定搜索的知识库 ID 列表")

    knowledge_search_tool = StructuredTool(
        name="knowledge_search",
        description="""
        搜索用户知识库中的相关文档内容。
        当用户询问关于已上传文档的问题时，使用此工具检索相关信息。
        支持 PDF、Word 等文档格式。
        """,
        func=search_knowledge_simple,
        args_schema=KnowledgeSearchInput,
    )

except ImportError:
    # 如果 LangChain 不可用，则不创建 Tool 对象
    knowledge_search_tool = None


# 便捷函数：检查用户是否有知识库
def has_knowledge_base(user_id: int, knowledge_base_ids: Optional[List[int]] = None) -> bool:
    """检查用户是否有知识库数据"""
    try:
        table, _ = _open_user_table(user_id)
        if table is None:
            return False
        if not knowledge_base_ids:
            return table.count_rows() > 0

        df = table.to_pandas()
        if "knowledge_base_id" not in df.columns:
            return False
        normalized_ids = _normalize_knowledge_base_ids(knowledge_base_ids)
        return len(df[df["knowledge_base_id"].isin(normalized_ids)]) > 0

    except Exception:
        return False


# 便捷函数：获取用户知识库统计
def get_knowledge_stats(user_id: int, knowledge_base_ids: Optional[List[int]] = None) -> dict:
    """获取用户知识库统计信息"""
    try:
        table, table_name = _open_user_table(user_id)
        if table is None:
            return {
                "has_knowledge": False,
                "total_chunks": 0,
                "files": []
            }

        df = table.to_pandas()
        normalized_ids = _normalize_knowledge_base_ids(knowledge_base_ids)
        if normalized_ids:
            if "knowledge_base_id" not in df.columns:
                df = df.iloc[0:0]
            else:
                df = df[df["knowledge_base_id"].isin(normalized_ids)]

        total_chunks = len(df)
        files = df['filename'].unique().tolist() if len(df) > 0 else []

        return {
            "has_knowledge": total_chunks > 0,
            "total_chunks": total_chunks,
            "files": files
        }

    except Exception as e:
        return {
            "has_knowledge": False,
            "total_chunks": 0,
            "files": [],
            "error": str(e)
        }
