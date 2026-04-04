import asyncio
from workers.celery_app import celery_app
from services.session_manager import SessionManager
from services.chat_session_service import chat_session_service
from agents.executor import AgentExecutor
from websocket.manager import connection_manager
from models.database import SessionLocal
from config.agent_config import get_system_prompt
from tools.tool_runtime import get_tool_runtime

# Worker 启动时初始化工具运行时（确保工具被加载）
_tool_runtime = get_tool_runtime()


@celery_app.task(bind=True)
def execute_agent_task(self, session_id: str, user_input: str, provider: str = "openai", model: str = None, user_id: int = None):
    return asyncio.run(_execute(self, session_id, user_input, provider, model, user_id))


async def _send_to_session(session_id: str, message: dict):
    """发送消息到 WebSocket（通过 Redis Pub/Sub）"""
    try:
        print(f"[WebSocket Debug] Sending to {session_id}: {message}")
        # Worker 进程使用 send_to_session（通过 Redis 发布）
        connection_manager.send_to_session(session_id, message)
        # print(f"[WebSocket Debug] Published to Redis successfully")
    except Exception as e:
        print(f"[WebSocket Debug] Failed to send message to session {session_id}: {e}")


async def _execute(self, session_id: str, user_input: str, provider: str = "openai", model: str = None, user_id: int = None):

    try:
        # 1. 写入用户消息（Redis）- 已在 v1.py 中写入，这里不需要重复
        # if not SessionManager.add_message(session_id, "user", user_input):
        #     raise Exception("Session not found or failed to add message")

        # 2. 获取上下文消息
        messages = SessionManager.get_messages(session_id)
        
        # 3. 获取 system_prompt（不再在这里拼接！传递给 Executor/Provider 内部处理）
        system_prompt = get_system_prompt("default")

        # 4. 生成 browser_session_id (与 chat session 关联)
        browser_session_id = f"bs_{session_id[:12]}"

        # 5. 创建新的 AgentExecutor 实例（避免全局单例问题）
        # 传入 model、browser_session_id 和 system_prompt
        executor = AgentExecutor(
            provider=provider, 
            model=model,
            browser_session_id=browser_session_id,
            system_prompt=system_prompt  # 新增：传递给 Executor
        )

        result = ""
        # 6. Agent执行（流式）
        chunk_count = 0
        async for chunk in executor.execute_stream(messages):  # 不再传入 messages_with_system
            chunk_count += 1
            #print(f"[Task Debug] Chunk {chunk_count}: {chunk}")
            
            result += chunk

            await _send_to_session(
                session_id,
                {
                    "type": "chunk",
                    "content": chunk,
                }
            )
        
        #print(f"[Task Debug] Total chunks: {chunk_count}")
        #print(f"[Task Debug] Final result: {result}")

        # 6. 写入AI回复到 Redis
        if not SessionManager.add_message(session_id, "assistant", result):
            print(f"Warning: Failed to add assistant message to Redis session {session_id}")

        # 7. 写入AI回复到 PostgreSQL
        if user_id:
            try:
                db = SessionLocal()
                # 获取会话
                session = chat_session_service.get_session_by_id(db, session_id)
                if session:
                    # 添加 AI 回复
                    chat_session_service.add_message(db, session.id, "assistant", result)
                    print(f"[Task Debug] Saved assistant message to PostgreSQL")
                db.close()
            except Exception as e:
                print(f"[Task Debug] Failed to save to PostgreSQL: {e}")

        # 8. 结束通知
        await _send_to_session(
            session_id,
            {
                "type": "done",
                "content": result,
            }
        )

        return {"success": True, "result": result, "provider": provider, "model": model}

    except Exception as e:
        import traceback
        error_msg = str(e)
        error_detail = traceback.format_exc()
        print(f"[Task Error] Agent execution failed: {error_msg}")
        print(f"[Task Error] Traceback: {error_detail}")

        await _send_to_session(
            session_id,
            {
                "type": "error",
                "content": error_msg,
            }
        )

        return {"success": False, "error": error_msg}
