"""
数据库初始化脚本
用于创建数据库和用户
"""
import pg8000
from pg8000.dbapi import ProgrammingError

# 使用默认的 postgres 用户连接（需要在命令行设置密码）
def create_database():
    print("正在连接 PostgreSQL...")
    
    # 先连接到默认的 postgres 数据库
    try:
        conn = pg8000.connect(
            user="postgres",
            password="123456",  # 请修改为你安装时设置的密码
            host="localhost",
            port=5432,
            database="postgres"
        )
        print("连接成功！")
        
        cursor = conn.cursor()
        
        # 创建数据库
        try:
            cursor.execute("CREATE DATABASE gexuclaw")
            print("数据库 'gexuclaw' 创建成功")
        except ProgrammingError as e:
            if "already exists" in str(e):
                print("数据库 'gexuclaw' 已存在")
            else:
                raise
        
        # 创建用户
        try:
            cursor.execute("CREATE USER gexu WITH PASSWORD 'gexu123'")
            print("用户 'gexu' 创建成功")
        except ProgrammingError as e:
            if "already exists" in str(e):
                print("用户 'gexu' 已存在")
            else:
                raise
        
        # 授权
        cursor.execute("GRANT ALL PRIVILEGES ON DATABASE gexuclaw TO gexu")
        print("授权成功")
        
        conn.commit()
        cursor.close()
        conn.close()
        
        print("\n数据库初始化完成！")
        print("请更新 .env 文件中的数据库配置：")
        print("DB_USER=gexu")
        print("DB_PASSWORD=gexu123")
        print("DB_NAME=gexuclaw")
        
    except Exception as e:
        print(f"错误: {e}")
        print("\n请确保：")
        print("1. PostgreSQL 服务已启动")
        print("2. 密码正确（修改脚本中的 password 参数）")

if __name__ == "__main__":
    create_database()
