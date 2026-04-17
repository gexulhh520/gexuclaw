"""
知识检索工具 - 用于 Agent 检索用户知识库中的文档内容
"""
from typing import Optional, List
import lancedb
import ollama

from core.config import get_settings

settings = get_settings()


def search_knowledge(
    query: str,
    user_id: int,
    top_k: int = 8,
    session_id: Optional[str] = None
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
    if not user_id:
        return "未提供用户 ID，无法搜索知识库"

    if not query or not query.strip():
        return "搜索查询不能为空"

    try:
        # 连接 LanceDB
        db = lancedb.connect(settings.LANCEDB_URI)
        table_name = f"{settings.LANCEDB_TABLE_PREFIX}{user_id}"

        # 检查表是否存在
        if table_name not in db.table_names():
            return "该用户暂无知识库数据，请先上传文档"

        table = db.open_table(table_name)

        # 检查表是否为空
        if table.count_rows() == 0:
            return "知识库为空，请先上传文档"

        # 使用 Ollama 生成查询的 embedding
        ollama_client = ollama.Client(host=settings.OLLAMA_BASE_URL)
        try:
            response = ollama_client.embeddings(
                model=settings.EMBEDDING_MODEL,
                prompt=query
            )
            query_vector = response['embedding']
        except Exception as e:
            print(f"[KnowledgeTool] 生成查询 embedding 失败: {e}")
            return f"搜索失败：无法生成查询向量 ({str(e)})"

        # 执行向量搜索
        try:
            results = table.search(query_vector) \
                           .limit(top_k) \
                           .to_pandas()
        except Exception as e:
            print(f"[KnowledgeTool] 向量搜索失败: {e}")
            return f"搜索失败：{str(e)}"

        if len(results) == 0:
            return "未找到相关内容"

        # 格式化返回结果
        contents = []
        for idx, row in results.iterrows():
            content = row.get('content', '')
            filename = row.get('filename', '未知文件')
            chunk_index = row.get('chunk_index', 0)

            if content and content.strip():
                contents.append(
                    f"【{filename} - 片段 {chunk_index + 1}】\n{content.strip()}"
                )

        if not contents:
            return "未找到有效内容"

        return "\n\n---\n\n".join(contents)

    except Exception as e:
        print(f"[KnowledgeTool] 知识检索失败: {e}")
        return f"知识检索失败: {str(e)}"


def search_knowledge_simple(query: str, user_id: int, top_k: int = 5) -> str:
    """
    简化的知识检索接口（用于 LangChain Tool）

    Args:
        query: 搜索查询文本
        user_id: 用户 ID
        top_k: 返回结果数量

    Returns:
        相关文档内容
    """
    return search_knowledge(query, user_id, top_k)


async def async_search_knowledge(
    query: str,
    user_id: int,
    top_k: int = 8,
    session_id: Optional[str] = None
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
    return search_knowledge(query, user_id, top_k, session_id)


# LangChain Tool 封装（可选）
try:
    from langchain.tools import StructuredTool
    from pydantic import BaseModel, Field

    class KnowledgeSearchInput(BaseModel):
        """知识搜索工具输入参数"""
        query: str = Field(description="搜索查询文本")
        user_id: int = Field(description="用户 ID")
        top_k: int = Field(default=8, description="返回结果数量")

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
def has_knowledge_base(user_id: int) -> bool:
    """检查用户是否有知识库数据"""
    try:
        db = lancedb.connect(settings.LANCEDB_URI)
        table_name = f"{settings.LANCEDB_TABLE_PREFIX}{user_id}"

        if table_name not in db.table_names():
            return False

        table = db.open_table(table_name)
        return table.count_rows() > 0

    except Exception:
        return False


# 便捷函数：获取用户知识库统计
def get_knowledge_stats(user_id: int) -> dict:
    """获取用户知识库统计信息"""
    try:
        db = lancedb.connect(settings.LANCEDB_URI)
        table_name = f"{settings.LANCEDB_TABLE_PREFIX}{user_id}"

        if table_name not in db.table_names():
            return {
                "has_knowledge": False,
                "total_chunks": 0,
                "files": []
            }

        table = db.open_table(table_name)
        total_chunks = table.count_rows()

        # 获取文件列表
        df = table.to_pandas()
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
