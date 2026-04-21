from __future__ import annotations

import traceback
from typing import Any, Dict, List

from sqlalchemy.orm import Session

from models.turn_memory import TurnMemory
from services.turn_memory_service import turn_memory_service


class MemoryRetrievalService:
    def get_recent_turn_memories(self, db: Session, session_db_id: int, limit: int = 4) -> List[TurnMemory]:
        return db.query(TurnMemory).filter(
            TurnMemory.session_id == session_db_id
        ).order_by(TurnMemory.created_at.desc(), TurnMemory.id.desc()).limit(limit).all()

    def search_turn_memories(self, db: Session, user_id: int, query: str, top_k: int = 5) -> List[Dict[str, Any]]:
        if top_k <= 0:
            return []
        if not (query or "").strip():
            return []

        table = turn_memory_service._get_or_create_table()
        if table.count_rows() == 0:
            return []

        try:
            query_vector = turn_memory_service._build_query_vector(query)
        except Exception as exc:
            print(
                "[MemoryRetrieval Warn] _build_query_vector failed | "
                f"user_id={user_id} top_k={top_k} query_preview={(query or '')[:120]!r} error={exc}\n"
                f"{traceback.format_exc()}"
            )
            return []

        if not query_vector:
            return []

        try:
            results = table.search(query_vector).limit(max(top_k * 5, 20)).to_pandas()
        except Exception as exc:
            print(
                "[MemoryRetrieval Warn] LanceDB search failed | "
                f"user_id={user_id} top_k={top_k} query_preview={(query or '')[:120]!r} error={exc}\n"
                f"{traceback.format_exc()}"
            )
            return []

        if len(results) == 0:
            return []

        results = results[results["user_id"] == user_id] if "user_id" in results.columns else results.iloc[0:0]
        formatted: List[Dict[str, Any]] = []
        memory_ids: List[int] = []
        for _, row in results.head(top_k).iterrows():
            turn_memory_id = int(row.get("turn_memory_id"))
            memory_ids.append(turn_memory_id)
            formatted.append({
                "turn_memory_id": turn_memory_id,
                "turn_id": int(row.get("turn_id")),
                "content": str(row.get("content", "")).strip(),
                "score": row.get("_distance", row.get("score")),
            })

        if not memory_ids:
            return []

        memories = db.query(TurnMemory).filter(TurnMemory.id.in_(memory_ids)).all()
        memory_map = {memory.id: memory for memory in memories}
        enriched: List[Dict[str, Any]] = []
        for item in formatted:
            memory = memory_map.get(item["turn_memory_id"])
            if not memory:
                continue
            enriched.append({
                **item,
                "task_goal": memory.task_goal,
                "result_summary": memory.result_summary,
                "tool_trace_summary": memory.tool_trace_summary,
                "tags": memory.tags_json or [],
                "is_task_candidate": memory.is_task_candidate,
                "candidate_score": memory.candidate_score,
            })
        return enriched

    def build_context_bundle(
        self,
        db: Session,
        user_id: int,
        session_db_id: int,
        query: str,
        recent_limit: int = 4,
        top_k: int = 5,
    ) -> Dict[str, Any]:
        recent: List[TurnMemory] = []
        retrieved: List[Dict[str, Any]] = []

        try:
            recent = self.get_recent_turn_memories(db, session_db_id, recent_limit)
        except Exception as exc:
            print(
                "[MemoryRetrieval Warn] get_recent_turn_memories failed | "
                f"session_db_id={session_db_id} user_id={user_id} recent_limit={recent_limit} error={exc}\n"
                f"{traceback.format_exc()}"
            )

        try:
            retrieved = self.search_turn_memories(db, user_id, query, top_k)
        except Exception as exc:
            query_preview = (query or "")[:120]
            print(
                "[MemoryRetrieval Warn] search_turn_memories failed | "
                f"session_db_id={session_db_id} user_id={user_id} top_k={top_k} query_preview={query_preview!r} "
                f"error={exc}\n{traceback.format_exc()}"
            )

        return {
            "recent_context": [
                {
                    "turn_id": item.turn_id,
                    "task_goal": item.task_goal,
                    "result_summary": item.result_summary,
                    "tool_trace_summary": item.tool_trace_summary,
                    "candidate_score": item.candidate_score,
                }
                for item in recent
            ],
            "retrieved_context": retrieved,
        }


memory_retrieval_service = MemoryRetrievalService()
