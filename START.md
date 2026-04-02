# 快速启动指南

## 前置要求

- Python 3.10+
- Node.js 18+
- Docker & Docker Compose

## 步骤一：启动依赖服务

```bash
docker-compose up -d
```

这将启动：
- Redis (端口 6379)
- PostgreSQL (端口 5432)
- Qdrant (端口 6333)

## 步骤二：配置环境变量

```bash
cd backend
cp .env.example .env
# 编辑 .env 文件，填入你的 OpenAI API Key
```

## 步骤三：安装后端依赖并启动

```bash
cd backend
pip install -r requirements.txt
python main.py
```

## 步骤四：启动 Celery Worker（新终端）

```bash
cd backend
celery -A workers.celery_app worker --loglevel=info --pool=solo

python -m celery -A workers.celery_app worker --loglevel=info --pool=solo
```

## 步骤五：启动前端（新终端）

```bash
cd frontend
npm install
npm run dev
```

## 访问应用

- 前端: http://localhost:5173
- 后端 API: http://localhost:8000
- API 文档: http://localhost:8000/docs
