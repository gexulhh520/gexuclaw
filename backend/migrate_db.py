"""
修复数据库结构 - 删除 chat_messages 表的旧 content 列
"""
from sqlalchemy import text
from models.database import engine, Base
from models.chat_session import ChatSession, ChatMessage, MessageContentItem

def migrate():
    with engine.connect() as conn:
        # 检查 message_content_items 表是否存在
        result = conn.execute(text("""
            SELECT table_name FROM information_schema.tables 
            WHERE table_name = 'message_content_items'
        """))
        if not result.fetchone():
            print("Creating message_content_items table...")
            conn.execute(text("""
                CREATE TABLE message_content_items (
                    id SERIAL PRIMARY KEY,
                    message_id INTEGER NOT NULL REFERENCES chat_messages(id),
                    type VARCHAR(20) NOT NULL,
                    content TEXT NOT NULL,
                    content_id VARCHAR(100),
                    sort_order INTEGER DEFAULT 0,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            """))
            conn.commit()
            print("message_content_items table created.")
        else:
            print("message_content_items table already exists.")
        
        # 检查 chat_messages 表是否有 content 列
        result = conn.execute(text("""
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = 'chat_messages' AND column_name = 'content'
        """))
        if result.fetchone():
            print("Dropping old 'content' column from chat_messages...")
            conn.execute(text("""
                ALTER TABLE chat_messages DROP COLUMN content
            """))
            conn.commit()
            print("Old 'content' column dropped.")
        else:
            print("chat_messages table already has correct structure (no 'content' column).")
        
        print("\nMigration completed successfully!")

if __name__ == "__main__":
    migrate()
