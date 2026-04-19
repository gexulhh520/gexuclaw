from models.database import SessionLocal
from services.turn_memory_service import turn_memory_service
from workers.celery_app import celery_app


@celery_app.task(bind=True)
def build_turn_memory_task(self, turn_id: int):
    db = SessionLocal()
    try:
        memory = turn_memory_service.build_turn_memory(db, turn_id)
        indexed_memory = turn_memory_service.index_turn_memory(db, memory.id)
        return {
            "success": True,
            "turn_id": turn_id,
            "turn_memory_id": indexed_memory.id,
            "embedding_status": indexed_memory.embedding_status,
        }
    except Exception as exc:
        return {
            "success": False,
            "turn_id": turn_id,
            "error": str(exc),
        }
    finally:
        db.close()
