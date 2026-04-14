import asyncio
import json
from typing import List, Dict, Any

from langchain_core.messages import message_chunk_to_message
from workers.celery_app import celery_app
from services.session_manager import SessionManager
from services.chat_session_service import chat_session_service
from services.agent_execution_service import save_execution_step
from agents.executor import AgentExecutor
from websocket.manager import connection_manager
from models.database import SessionLocal
from config.agent_config import get_system_prompt
from tools.tool_runtime import get_tool_runtime

# Worker 启动时初始化工具运行时（确保工具被加载）
_tool_runtime = get_tool_runtime()


@celery_app.task(bind=True)
def execute_agent_task(self, session_id: str, user_messages: List[dict], provider: str = "openai", model: str = None, user_id: int = None):
    return asyncio.run(_execute(session_id, user_messages, provider, model, user_id))


async def _send_to_session(session_id: str, message: dict):
    """发送消息到 WebSocket（通过 Redis Pub/Sub）"""
    try:
        print(f"[WebSocket Debug] Sending to {session_id}: {message}")
        # Worker 进程使用 send_to_session（通过 Redis 发布）
        connection_manager.send_to_session(session_id, message)
        # print(f"[WebSocket Debug] Published to Redis successfully")
    except Exception as e:
        print(f"[WebSocket Debug] Failed to send message to session {session_id}: {e}")


async def _execute(session_id: str, user_messages: List[dict], provider: str = "openai", model: str = None, user_id: int = None):

    try:
        # 1. 获取 system_prompt
        system_prompt = get_system_prompt("default")

        # 2. 生成 browser_session_id (与 chat session 关联)
        browser_session_id = f"bs_{session_id[:12]}"

        # 3. 创建新的 AgentExecutor 实例
        executor = AgentExecutor(
            provider=provider, 
            model=model,
            browser_session_id=browser_session_id,
            system_prompt=system_prompt
        )

        # 4. 临时收集所有中间步骤
        collected_steps: List[Dict[str, Any]] = []
        result = ""
        step_count = 0

        # 5. 真正流式执行 + 保存中间过程
        async for event in executor.execute_stream(user_messages, thread_id=session_id):
            step_count += 1

            # 过滤 context_trimmed：不推送给前端，也不记录
            if event.get("type") == "context_trimmed":
                continue

            # === 实时推送给前端 WebSocket ===
            await _send_to_session(session_id, event)

            # === 实时收集中间执行步骤 ===
            collected_steps.append({
                "step_type": event["type"],
                "content": event.get("content"),
                "tool_name": event.get("tool_name"),
                "tool_status": event.get("tool_status"),
            })

            # 累积最终结果（从 thinking_end 事件获取）
            if event.get("type") == "thinking_end" and event.get("content"):
                result = event["content"]

        # 6. 执行结束：创建最终 assistant message 并关联所有 steps
        if result:
            db = SessionLocal()
            try:
                # 获取会话
                session = chat_session_service.get_session_by_id(db, session_id)
                if session:
                    # 创建 assistant message
                    assistant_message = chat_session_service.add_message(
                        db, session.id, "assistant", result
                    )
                    final_message_id = assistant_message.id
                    
                    # 单条保存所有中间步骤
                    for step in collected_steps:
                        await save_execution_step(
                            db=db,
                            message_id=final_message_id,
                            step_type=step["step_type"],
                            content=step.get("content"),
                            tool_name=step.get("tool_name"),
                            tool_status=step.get("tool_status"),
                        )
                    
                    print(f"[Task Debug] Saved {len(collected_steps)} execution steps for message {final_message_id}")
                else:
                    print(f"[Task Error] Session {session_id} not found in PostgreSQL")
            finally:
                db.close()

            # 保存到 Redis（保持原有逻辑）
            SessionManager.add_message(session_id, "assistant", result)

        # 7. 发送完成信号
        await _send_to_session(session_id, {
            "type": "done",
            "content": result,
            "total_steps": step_count,
        })

        print(f"[Task Success] Session {session_id} completed ({step_count} steps)")

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
