# 生产部署指南

## 一、环境准备

### 1. 系统要求

- **操作系统**: Linux (Ubuntu 20.04+/CentOS 7+) / Windows Server 2019+
- **Python**: 3.10 - 3.12 (推荐 3.11)
- **Node.js**: 18.x LTS
- **内存**: 最少 4GB，推荐 8GB+
- **磁盘**: 最少 20GB 可用空间

### 2. 依赖服务安装

#### PostgreSQL
```bash
# Ubuntu
sudo apt update
sudo apt install postgresql postgresql-contrib

# 创建数据库和用户
sudo -u postgres psql
CREATE DATABASE gexuclaw;
CREATE USER gexuclaw WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE gexuclaw TO gexuclaw;
\q
```

#### Redis
```bash
# Ubuntu
sudo apt install redis-server
sudo systemctl enable redis-server
sudo systemctl start redis-server

# 配置密码（可选）
sudo nano /etc/redis/redis.conf
# 修改: requirepass your_redis_password
sudo systemctl restart redis-server
```

#### Chrome 浏览器（用于浏览器自动化）
```bash
# Ubuntu/Debian
wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | sudo apt-key add -
sudo sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list'
sudo apt update
sudo apt install google-chrome-stable

# 或使用 Playwright 自带的 Chromium
python -m playwright install chromium
```

---

## 二、后端部署

### 1. 代码部署

```bash
# 克隆代码（或使用 SCP/FTP 上传）
git clone <your-repo-url> /opt/gexuclaw
cd /opt/gexuclaw/backend

# 创建虚拟环境
python3 -m venv venv
source venv/bin/activate  # Linux
# 或 venv\Scripts\activate  # Windows

# 安装依赖
pip install -r requirements.txt

# 安装浏览器依赖
python -m playwright install chromium
```

### 2. 环境配置

创建 `.env` 文件：

```bash
cd /opt/gexuclaw/backend
cp .env.example .env
nano .env
```

配置内容：
```env
# 数据库
DATABASE_URL=postgresql+pg8000://gexuclaw:your_password@localhost:5432/gexuclaw

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password  # 如果有

# JWT
SECRET_KEY=your-super-secret-key-change-this-in-production
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=1440

# LLM API Keys
OPENAI_API_KEY=sk-...
DEEPSEEK_API_KEY=sk-...
KIMI_API_KEY=sk-...

# 其他配置
DEBUG=false
LOG_LEVEL=INFO
```

### 3. 数据库迁移

```bash
cd /opt/gexuclaw/backend

# 使用 Alembic 迁移（如果有）
alembic upgrade head

# 或自动创建表
python -c "from models.database import Base, engine; Base.metadata.create_all(bind=engine)"
```

### 4. 使用 Gunicorn 运行（生产环境）

```bash
# 安装 Gunicorn
pip install gunicorn

# 创建启动脚本
cat > /opt/gexuclaw/start_backend.sh << 'EOF'
#!/bin/bash
cd /opt/gexuclaw/backend
source venv/bin/activate

# 使用 Gunicorn 启动
# -w: worker 数量（建议 2-4 x CPU核心数）
# -k: worker 类型（uvicorn.workers.UvicornWorker 用于 ASGI）
# -b: 绑定地址
# --access-logfile: 访问日志
# --error-logfile: 错误日志
# --capture-output: 捕获输出
# --enable-stdio-inheritance: 继承 stdio
exec gunicorn main:app \
    -w 4 \
    -k uvicorn.workers.UvicornWorker \
    -b 0.0.0.0:8000 \
    --access-logfile /var/log/gexuclaw/access.log \
    --error-logfile /var/log/gexuclaw/error.log \
    --capture-output \
    --enable-stdio-inheritance
EOF

chmod +x /opt/gexuclaw/start_backend.sh

# 创建日志目录
sudo mkdir -p /var/log/gexuclaw
sudo chown -R $USER:$USER /var/log/gexuclaw
```

### 5. 使用 Systemd 管理（Linux）

创建服务文件：

```bash
sudo tee /etc/systemd/system/gexuclaw-backend.service << 'EOF'
[Unit]
Description=GexuLaw Backend API
After=network.target postgresql.service redis.service

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/opt/gexuclaw/backend
Environment=PATH=/opt/gexuclaw/backend/venv/bin
Environment=PYTHONPATH=/opt/gexuclaw/backend
EnvironmentFile=/opt/gexuclaw/backend/.env
ExecStart=/opt/gexuclaw/backend/venv/bin/gunicorn main:app -w 4 -k uvicorn.workers.UvicornWorker -b 0.0.0.0:8000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# 重新加载 systemd
sudo systemctl daemon-reload

# 启动服务
sudo systemctl enable gexuclaw-backend
sudo systemctl start gexuclaw-backend

# 查看状态
sudo systemctl status gexuclaw-backend
```

---

## 三、Celery Worker 部署

### 1. 使用 Systemd 管理 Celery

```bash
sudo tee /etc/systemd/system/gexuclaw-worker.service << 'EOF'
[Unit]
Description=GexuLaw Celery Worker
After=network.target postgresql.service redis.service

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/opt/gexuclaw/backend
Environment=PATH=/opt/gexuclaw/backend/venv/bin
Environment=PYTHONPATH=/opt/gexuclaw/backend
EnvironmentFile=/opt/gexuclaw/backend/.env
ExecStart=/opt/gexuclaw/backend/venv/bin/celery -A workers.celery_app worker --loglevel=info --concurrency=4
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable gexuclaw-worker
sudo systemctl start gexuclaw-worker
```

---

## 四、前端部署

### 1. 构建生产版本

```bash
cd /opt/gexuclaw/frontend

# 安装依赖
npm install

# 修改 API 地址（生产环境）
nano .env.production
# 添加: VITE_API_BASE_URL=https://your-domain.com/api

# 构建
npm run build

# 构建输出在 dist/ 目录
```

### 2. 使用 Nginx 部署

```bash
# 安装 Nginx
sudo apt install nginx

# 创建 Nginx 配置
sudo tee /etc/nginx/sites-available/gexuclaw << 'EOF'
server {
    listen 80;
    server_name your-domain.com;

    # 前端静态文件
    location / {
        root /opt/gexuclaw/frontend/dist;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    # API 代理
    location /api/ {
        proxy_pass http://localhost:8000/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # WebSocket 代理
    location /ws/ {
        proxy_pass http://localhost:8000/ws/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

# 启用站点
sudo ln -s /etc/nginx/sites-available/gexuclaw /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default  # 删除默认站点
sudo nginx -t
sudo systemctl restart nginx
```

---

## 五、HTTPS 配置（SSL/TLS）

### 使用 Let's Encrypt

```bash
# 安装 Certbot
sudo apt install certbot python3-certbot-nginx

# 获取证书
sudo certbot --nginx -d your-domain.com

# 自动续期
sudo certbot renew --dry-run
```

---

## 六、Docker 部署（可选）

### 1. 创建 Dockerfile

```dockerfile
# backend/Dockerfile
FROM python:3.11-slim

WORKDIR /app

# 安装系统依赖
RUN apt-get update && apt-get install -y \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# 安装 Playwright 依赖
RUN apt-get update && apt-get install -y \
    libglib2.0-0 \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxcb1 \
    libxkbcommon0 \
    libx11-6 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 安装 Playwright 浏览器
RUN python -m playwright install chromium

COPY . .

EXPOSE 8000

CMD ["gunicorn", "main:app", "-w", "4", "-k", "uvicorn.workers.UvicornWorker", "-b", "0.0.0.0:8000"]
```

### 2. Docker Compose

```yaml
# docker-compose.yml
version: '3.8'

services:
  backend:
    build: ./backend
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql+pg8000://gexuclaw:password@postgres:5432/gexuclaw
      - REDIS_HOST=redis
      - REDIS_PORT=6379
    depends_on:
      - postgres
      - redis
    volumes:
      - ./backend/.env:/app/.env

  worker:
    build: ./backend
    command: celery -A workers.celery_app worker --loglevel=info
    environment:
      - DATABASE_URL=postgresql+pg8000://gexuclaw:password@postgres:5432/gexuclaw
      - REDIS_HOST=redis
      - REDIS_PORT=6379
    depends_on:
      - postgres
      - redis
      - backend
    volumes:
      - ./backend/.env:/app/.env

  postgres:
    image: postgres:15
    environment:
      - POSTGRES_USER=gexuclaw
      - POSTGRES_PASSWORD=password
      - POSTGRES_DB=gexuclaw
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./frontend/dist:/usr/share/nginx/html
      - ./nginx.conf:/etc/nginx/conf.d/default.conf
    depends_on:
      - backend

volumes:
  postgres_data:
```

### 3. 部署命令

```bash
# 构建并启动
docker-compose up -d --build

# 查看日志
docker-compose logs -f backend
docker-compose logs -f worker

# 停止
docker-compose down

# 停止并删除数据
docker-compose down -v
```

---

## 七、监控与日志

### 1. 日志管理

```bash
# 查看后端日志
sudo journalctl -u gexuclaw-backend -f

# 查看 Worker 日志
sudo journalctl -u gexuclaw-worker -f

# Nginx 日志
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

### 2. 进程监控

```bash
# 安装 Supervisor（可选）
sudo apt install supervisor

# 或使用 PM2（Node.js 风格）
npm install -g pm2
pm2 start "gunicorn main:app -w 4 -k uvicorn.workers.UvicornWorker -b 0.0.0.0:8000" --name gexuclaw-backend
```

---

## 八、备份与恢复

### 数据库备份

```bash
# 手动备份
pg_dump -U gexuclaw -h localhost gexuclaw > backup_$(date +%Y%m%d).sql

# 自动备份脚本
cat > /opt/gexuclaw/backup.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/opt/backups"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR
pg_dump -U gexuclaw -h localhost gexuclaw | gzip > $BACKUP_DIR/gexuclaw_$DATE.sql.gz
# 保留最近 7 天
find $BACKUP_DIR -name "gexuclaw_*.sql.gz" -mtime +7 -delete
EOF

chmod +x /opt/gexuclaw/backup.sh

# 添加到 crontab（每天凌晨 2 点备份）
0 2 * * * /opt/gexuclaw/backup.sh
```

---

## 九、安全加固

### 1. 防火墙配置

```bash
# UFW (Ubuntu)
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow http
sudo ufw allow https
sudo ufw enable
```

### 2. 文件权限

```bash
# 设置正确的权限
sudo chown -R www-data:www-data /opt/gexuclaw
sudo chmod -R 755 /opt/gexuclaw/backend
sudo chmod 600 /opt/gexuclaw/backend/.env
```

### 3. 定期更新

```bash
# 更新系统
sudo apt update && sudo apt upgrade -y

# 更新 Python 依赖
pip install --upgrade -r requirements.txt

# 重启服务
sudo systemctl restart gexuclaw-backend
sudo systemctl restart gexuclaw-worker
```

---

## 十、故障排查

### 常见问题

1. **端口被占用**
   ```bash
   sudo lsof -i :8000
   sudo kill -9 <PID>
   ```

2. **权限问题**
   ```bash
   sudo chown -R $USER:$USER /opt/gexuclaw
   ```

3. **数据库连接失败**
   ```bash
   # 检查 PostgreSQL 状态
   sudo systemctl status postgresql
   
   # 检查连接
   psql -U gexuclaw -h localhost -d gexuclaw
   ```

4. **Redis 连接失败**
   ```bash
   sudo systemctl status redis-server
   redis-cli ping
   ```

5. **浏览器工具无法使用**
   ```bash
   # 检查 Chromium 是否安装
   python -m playwright install chromium
   
   # 检查 Chrome 路径
   which google-chrome
   ```

---

## 十一、启动顺序说明

### 生产环境完整启动流程

#### 1. 基础服务（必须最先启动）
```bash
# 启动 PostgreSQL
sudo systemctl start postgresql

# 启动 Redis
sudo systemctl start redis-server

# 验证服务状态
sudo systemctl status postgresql
sudo systemctl status redis-server
```

#### 2. 后端服务
```bash
# 方式一：使用 Systemd（推荐）
sudo systemctl start gexuclaw-backend

# 方式二：手动启动（开发/测试）
cd /opt/gexuclaw/backend
source venv/bin/activate
gunicorn main:app -w 4 -k uvicorn.workers.UvicornWorker -b 0.0.0.0:8000
```

#### 3. Celery Worker（必须启动，否则任务无法执行）
```bash
# 方式一：使用 Systemd（推荐）
sudo systemctl start gexuclaw-worker

# 方式二：手动启动（开发/测试）
cd /opt/gexuclaw/backend
source venv/bin/activate
celery -A workers.celery_app worker --loglevel=info --concurrency=4

# 方式三：Windows 开发环境
celery -A workers.celery_app worker --loglevel=info --pool=solo
```

**⚠️ 重要提示**：
- Worker 是**必须**的，负责处理 AI 对话任务
- 如果没有 Worker，用户发送消息后永远不会收到回复
- `--pool=solo` 是 Windows 开发环境专用，Linux 生产环境使用 `--concurrency=4`

#### 4. 前端服务
```bash
# 方式一：Nginx（推荐生产环境）
sudo systemctl start nginx

# 方式二：开发服务器（仅开发）
cd /opt/gexuclaw/frontend
npm run dev
```

### 服务依赖关系

```
┌─────────────────────────────────────────────────────────────┐
│                    第一层：基础服务                           │
│              PostgreSQL + Redis（必须最先启动）               │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    第二层：后端服务                           │
│              FastAPI (Gunicorn) + Celery Worker              │
│                      （Worker 必须启动）                      │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    第三层：前端服务                           │
│                     Nginx / 开发服务器                        │
└─────────────────────────────────────────────────────────────┘
```

### 一键启动脚本

创建启动脚本 `/opt/gexuclaw/start_all.sh`：

```bash
#!/bin/bash

echo "========== 启动 GexuLaw 服务 =========="

# 1. 启动基础服务
echo "[1/4] 启动 PostgreSQL..."
sudo systemctl start postgresql

echo "[2/4] 启动 Redis..."
sudo systemctl start redis-server

# 2. 等待基础服务就绪
sleep 2

# 3. 启动后端服务
echo "[3/4] 启动后端 API..."
sudo systemctl start gexuclaw-backend

echo "[4/4] 启动 Celery Worker..."
sudo systemctl start gexuclaw-worker

# 4. 启动前端（如果使用 Nginx）
echo "启动 Nginx..."
sudo systemctl start nginx

echo "========== 所有服务启动完成 =========="
echo ""
echo "检查服务状态："
sudo systemctl status postgresql --no-pager
sudo systemctl status redis-server --no-pager
sudo systemctl status gexuclaw-backend --no-pager
sudo systemctl status gexuclaw-worker --no-pager
```

```bash
chmod +x /opt/gexuclaw/start_all.sh
sudo /opt/gexuclaw/start_all.sh
```

### 一键停止脚本

创建停止脚本 `/opt/gexuclaw/stop_all.sh`：

```bash
#!/bin/bash

echo "========== 停止 GexuLaw 服务 =========="

echo "[1/4] 停止前端 Nginx..."
sudo systemctl stop nginx

echo "[2/4] 停止 Celery Worker..."
sudo systemctl stop gexuclaw-worker

echo "[3/4] 停止后端 API..."
sudo systemctl stop gexuclaw-backend

echo "[4/4] 停止基础服务..."
sudo systemctl stop redis-server
sudo systemctl stop postgresql

echo "========== 所有服务已停止 =========="
```

```bash
chmod +x /opt/gexuclaw/stop_all.sh
sudo /opt/gexuclaw/stop_all.sh
```

### 查看所有服务状态

```bash
# 查看所有相关服务状态
sudo systemctl status postgresql redis-server gexuclaw-backend gexuclaw-worker nginx

# 或查看进程
ps aux | grep -E "(postgres|redis|gunicorn|celery|nginx)"

# 查看端口占用
sudo netstat -tlnp | grep -E "(5432|6379|8000|80|443)"
```

---

## 部署检查清单

### 环境准备
- [ ] 服务器环境准备完成（Linux/Windows）
- [ ] Python 3.10-3.12 安装完成
- [ ] Node.js 18.x 安装完成
- [ ] PostgreSQL 安装并配置
- [ ] Redis 安装并配置

### 后端部署
- [ ] 后端代码部署到 /opt/gexuclaw
- [ ] Python 虚拟环境创建完成
- [ ] requirements.txt 依赖安装完成
- [ ] .env 环境变量配置完成
- [ ] 数据库迁移完成
- [ ] 浏览器自动化依赖安装完成（python -m playwright install chromium）

### 服务配置
- [ ] Gunicorn 配置正确
- [ ] Systemd 服务配置完成（gexuclaw-backend）
- [ ] Celery Worker Systemd 配置完成（gexuclaw-worker）
- [ ] 服务开机自启配置完成

### 前端部署
- [ ] 前端构建完成（npm run build）
- [ ] Nginx 配置完成
- [ ] HTTPS SSL 证书配置完成

### 启动验证
- [ ] PostgreSQL 启动并运行
- [ ] Redis 启动并运行
- [ ] 后端 API 启动并运行（端口 8000）
- [ ] **Celery Worker 启动并运行（必须！）**
- [ ] Nginx 启动并运行（端口 80/443）
- [ ] 前端页面可以正常访问
- [ ] AI 对话功能测试通过

### 安全与监控
- [ ] 防火墙配置完成（ufw/iptables）
- [ ] 文件权限设置正确
- [ ] 日志监控配置完成
- [ ] 数据库备份脚本配置完成
- [ ] 定期更新策略制定
