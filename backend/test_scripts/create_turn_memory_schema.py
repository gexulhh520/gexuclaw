"""
独立执行 turn memory 表结构脚本

用途：
- 创建 turn_memories 表

执行方式：
    python backend/test_scripts/create_turn_memory_schema.py
"""

from pathlib import Path
import sys

CURRENT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = CURRENT_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from models.database import engine  # noqa: E402
from models.turn_memory import TurnMemory  # noqa: E402


def main():
    TurnMemory.__table__.create(bind=engine, checkfirst=True)
    print("[done] turn_memories schema ready")


if __name__ == "__main__":
    main()
