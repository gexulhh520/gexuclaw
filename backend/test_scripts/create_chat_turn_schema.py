"""
独立执行聊天轮次基础表结构脚本

用途：
- 创建 chat_turns 表
- 为 chat_messages 增加 turn_id
- 为 agent_execution_steps 增加 turn_id

执行方式：
    python backend/test_scripts/create_chat_turn_schema.py
"""

from pathlib import Path
import sys

from sqlalchemy import inspect, text

CURRENT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = CURRENT_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from models.database import engine  # noqa: E402
from models.chat_turn import ChatTurn  # noqa: E402
from models.chat_session import ChatMessage  # noqa: E402
from models.agent_execution_step import AgentExecutionStep  # noqa: E402


def _column_exists(inspector, table_name: str, column_name: str) -> bool:
    columns = inspector.get_columns(table_name)
    return any(column["name"] == column_name for column in columns)


def _ensure_column(connection, inspector, table_name: str, column_name: str, ddl: str):
    if _column_exists(inspector, table_name, column_name):
        print(f"[skip] {table_name}.{column_name} already exists")
        return
    connection.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {ddl}"))
    print(f"[ok] added column {table_name}.{column_name}")


def _ensure_index(connection, index_name: str, table_name: str, column_name: str):
    connection.execute(text(f"CREATE INDEX IF NOT EXISTS {index_name} ON {table_name} ({column_name})"))
    print(f"[ok] ensured index {index_name}")


def main():
    inspector = inspect(engine)

    if "chat_turns" not in inspector.get_table_names():
        ChatTurn.__table__.create(bind=engine, checkfirst=True)
        print("[ok] created table chat_turns")
    else:
        print("[skip] table chat_turns already exists")

    with engine.begin() as connection:
        inspector = inspect(connection)

        _ensure_column(
            connection,
            inspector,
            ChatMessage.__tablename__,
            "turn_id",
            "INTEGER REFERENCES chat_turns(id)",
        )
        _ensure_column(
            connection,
            inspector,
            AgentExecutionStep.__tablename__,
            "turn_id",
            "INTEGER REFERENCES chat_turns(id)",
        )

        _ensure_index(connection, "ix_chat_messages_turn_id", ChatMessage.__tablename__, "turn_id")
        _ensure_index(connection, "ix_agent_execution_steps_turn_id", AgentExecutionStep.__tablename__, "turn_id")

    print("[done] chat turn schema ready")


if __name__ == "__main__":
    main()
