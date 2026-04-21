from __future__ import annotations

import traceback
from typing import Any, Dict, List, Optional

import lancedb
import ollama
from lancedb.pydantic import LanceModel, Vector
from sqlalchemy.orm import Session, joinedload

from core.config import get_settings
from models.chat_session import ChatMessage, ChatSession
from models.chat_turn import ChatTurn
from models.turn_memory import TurnMemory


settings = get_settings()


class TurnMemoryVector(LanceModel):
    id: str
    turn_memory_id: int
    turn_id: int
    session_id: int
    user_id: int
    source_user_message_id: Optional[int]
    source_assistant_message_id: Optional[int]
    content: str
    tags_text: str
    vector: Vector(1024)


class TurnMemoryService:
    def __init__(self):
        self.db = lancedb.connect(settings.LANCEDB_URI)
        self.ollama_client = ollama.Client(host=settings.OLLAMA_BASE_URL)

    def build_turn_memory(self, db: Session, turn_id: int) -> TurnMemory:
        turn = db.query(ChatTurn).options(
            joinedload(ChatTurn.messages).joinedload(ChatMessage.content_items),
            joinedload(ChatTurn.execution_steps),
            joinedload(ChatTurn.session),
        ).filter(ChatTurn.id == turn_id).first()
        if not turn:
            raise ValueError(f"turn_id={turn_id} 不存在")

        existing = db.query(TurnMemory).filter(TurnMemory.turn_id == turn_id).first()
        user_message = self._select_turn_message(turn, "user")
        assistant_message = self._select_turn_message(turn, "assistant")

        user_query = self._message_text(user_message)
        assistant_final = self._message_text(assistant_message)
        successful_tools, failed_tools = self._split_tool_results(turn.execution_steps)
        tool_trace_summary = self._build_tool_trace_summary(turn.execution_steps)
        task_goal = user_query[:500] if user_query else ""
        result_summary = assistant_final[:1000] if assistant_final else ""
        browser_used = any((step.tool_name or "").startswith("browser__") for step in turn.execution_steps)
        knowledge_base_ids = list(getattr(turn.session, "knowledge_base_ids", []) or [])
        tags = self._build_tags(user_query, successful_tools, failed_tools, browser_used, knowledge_base_ids)
        candidate_score = self._score_candidate(successful_tools, failed_tools, browser_used, assistant_final)
        is_task_candidate = candidate_score >= 0.45

        payload = {
            "session_id": turn.session_id,
            "user_id": turn.user_id,
            "source_user_message_id": getattr(user_message, "id", None),
            "source_assistant_message_id": getattr(assistant_message, "id", None),
            "user_query": user_query,
            "assistant_final": assistant_final,
            "task_goal": task_goal,
            "result_summary": result_summary,
            "tool_trace_summary": tool_trace_summary,
            "successful_tools_json": successful_tools,
            "failed_tools_json": failed_tools,
            "knowledge_base_ids_json": knowledge_base_ids,
            "browser_used": browser_used,
            "is_task_candidate": is_task_candidate,
            "candidate_score": candidate_score,
            "tags_json": tags,
        }

        if existing:
            for key, value in payload.items():
                setattr(existing, key, value)
            existing.embedding_status = "pending"
            db.commit()
            db.refresh(existing)
            return existing

        memory = TurnMemory(turn_id=turn_id, embedding_status="pending", **payload)
        db.add(memory)
        db.commit()
        db.refresh(memory)
        return memory

    def index_turn_memory(self, db: Session, turn_memory_id: int) -> TurnMemory:
        memory = db.query(TurnMemory).filter(TurnMemory.id == turn_memory_id).first()
        if not memory:
            raise ValueError(f"turn_memory_id={turn_memory_id} 不存在")

        embedding_text = self._build_embedding_text(memory)
        vector = self._build_query_vector(embedding_text)
        table = self._get_or_create_table()
        table.delete(f"turn_memory_id = {turn_memory_id}")
        table.add([{
            "id": f"turn_memory_{turn_memory_id}",
            "turn_memory_id": memory.id,
            "turn_id": memory.turn_id,
            "session_id": memory.session_id,
            "user_id": memory.user_id,
            "source_user_message_id": memory.source_user_message_id,
            "source_assistant_message_id": memory.source_assistant_message_id,
            "content": embedding_text,
            "tags_text": " ".join(memory.tags_json or []),
            "vector": vector,
        }])
        memory.embedding_status = "indexed"
        db.commit()
        db.refresh(memory)
        return memory

    def _get_or_create_table(self):
        table_name = "turn_memories"
        if table_name in self.db.table_names():
            return self.db.open_table(table_name)
        return self.db.create_table(table_name, schema=TurnMemoryVector, mode="create")

    def _build_query_vector(self, query: str) -> List[float]:
        response = self.ollama_client.embeddings(
            model=settings.EMBEDDING_MODEL,
            prompt=query,
        )
        embedding = response.get("embedding") if isinstance(response, dict) else None
        if not isinstance(embedding, list) or not embedding:
            raise ValueError(
                f"embedding response invalid: type={type(response).__name__}, keys={list(response.keys()) if isinstance(response, dict) else 'n/a'}"
            )
        return embedding

    def _build_embedding_text(self, memory: TurnMemory) -> str:
        tags = ", ".join(memory.tags_json or [])
        success = ", ".join(memory.successful_tools_json or []) or "无"
        failed = ", ".join(memory.failed_tools_json or []) or "无"
        return (
            f"用户目标：{memory.user_query or ''}\n"
            f"任务目标：{memory.task_goal or ''}\n"
            f"最终结果：{memory.result_summary or ''}\n"
            f"工具轨迹：{memory.tool_trace_summary or ''}\n"
            f"成功工具：{success}\n"
            f"失败工具：{failed}\n"
            f"标签：{tags}"
        ).strip()

    def _select_turn_message(self, turn: ChatTurn, role: str) -> Optional[ChatMessage]:
        if role == "user" and turn.source_user_message_id:
            for message in turn.messages:
                if message.id == turn.source_user_message_id:
                    return message
        if role == "assistant" and turn.assistant_message_id:
            for message in turn.messages:
                if message.id == turn.assistant_message_id:
                    return message
        candidates = [message for message in turn.messages if message.role == role]
        return candidates[-1] if candidates else None

    def _message_text(self, message: Optional[ChatMessage]) -> str:
        if not message:
            return ""
        parts: List[str] = []
        for item in getattr(message, "content_items", []) or []:
            content = item.content if hasattr(item, "content") else None
            if content and str(content).strip():
                parts.append(str(content).strip())
        return "\n".join(parts).strip()

    def _split_tool_results(self, steps) -> tuple[List[str], List[str]]:
        successful_tools: List[str] = []
        failed_tools: List[str] = []
        for step in steps or []:
            if not step.tool_name:
                continue
            status = (step.tool_status or "").lower()
            if status in {"success", "succeeded", "completed"}:
                successful_tools.append(step.tool_name)
            elif status in {"error", "failed", "failure"}:
                failed_tools.append(step.tool_name)
        return sorted(set(successful_tools)), sorted(set(failed_tools))

    def _build_tool_trace_summary(self, steps) -> str:
        items: List[str] = []
        for step in sorted(steps or [], key=lambda item: (item.sort_order or 0, item.id or 0)):
            if step.tool_name:
                status = step.tool_status or "unknown"
                items.append(f"{step.tool_name}({status})")
            elif step.content:
                items.append((step.content or "")[:80])
        return " -> ".join(items[:12])

    def _build_tags(
        self,
        user_query: str,
        successful_tools: List[str],
        failed_tools: List[str],
        browser_used: bool,
        knowledge_base_ids: List[int],
    ) -> List[str]:
        tags: List[str] = []
        if browser_used:
            tags.append("browser")
        if knowledge_base_ids:
            tags.append("knowledge")
        if successful_tools:
            tags.append("success")
        if failed_tools:
            tags.append("has_failure")
        if "定时" in (user_query or ""):
            tags.append("scheduled_task")
        return tags

    def _score_candidate(
        self,
        successful_tools: List[str],
        failed_tools: List[str],
        browser_used: bool,
        assistant_final: str,
    ) -> float:
        score = 0.2
        if successful_tools:
            score += min(0.4, len(successful_tools) * 0.1)
        if browser_used:
            score += 0.1
        if assistant_final:
            score += 0.15
        if failed_tools:
            score -= min(0.2, len(failed_tools) * 0.05)
        return max(0.0, min(1.0, score))


turn_memory_service = TurnMemoryService()
