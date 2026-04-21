from celery import Celery
from celery.signals import worker_init, worker_shutdown
from celery.schedules import crontab
from core.config import get_settings
from tools.tool_discovery import auto_discover_and_register

settings = get_settings()

# Worker 启动时自动发现工具
auto_discover_and_register()

celery_app = Celery(
    "gexuclaw_agent",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Asia/Shanghai",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=30 * 60,
    task_soft_time_limit=25 * 60,
)

celery_app.autodiscover_tasks([
    "workers.tasks",
    "workers.tasks_v2",
    "workers.planner_jobs",
    "workers.document_tasks",
    "workers.maintenance_tasks",
    "workers.scheduled_task_dispatcher",
    "workers.scheduled_task_executor",
    "workers.turn_memory_tasks",
])

# 导入文档处理任务模块以确保任务被注册
import workers.document_tasks
import workers.maintenance_tasks
import workers.planner_jobs
import workers.tasks_v2
import workers.scheduled_task_dispatcher
import workers.scheduled_task_executor
import workers.turn_memory_tasks


beat_schedule = {}

if getattr(settings, "MAINTENANCE_CLEANUP_ENABLED", False):
    beat_schedule.update({
        "maintenance-cleanup": {
            "task": "workers.maintenance_tasks.cleanup_maintenance",
            "schedule": crontab(
                hour=getattr(settings, "MAINTENANCE_CLEANUP_HOUR", 3),
                minute=getattr(settings, "MAINTENANCE_CLEANUP_MINUTE", 30),
            ),
        }
    })

beat_schedule["dispatch-due-scheduled-tasks"] = {
    "task": "workers.scheduled_task_dispatcher.dispatch_due_scheduled_tasks",
    "schedule": 60.0,
}

celery_app.conf.beat_schedule = beat_schedule


# 注意：BrowserManager 改为延迟初始化
# 不在 Worker 启动时初始化，而是在第一次任务执行时初始化
# 这是因为 Playwright 的 Browser 对象不能跨事件循环使用

# Worker 停止时关闭 BrowserManager
@worker_shutdown.connect
def shutdown_worker(**kwargs):
    print("[Worker] 关闭 BrowserManager...")
    import asyncio
    from tools.browser.browser_manager import get_browser_manager
    browser_manager = get_browser_manager()
    try:
        # 使用当前事件循环或创建新的
        try:
            loop = asyncio.get_event_loop()
            if loop.is_closed():
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        loop.run_until_complete(browser_manager.shutdown())
        print("[Worker] BrowserManager 已关闭")
    except Exception as e:
        print(f"[Worker] BrowserManager 关闭失败: {e}")
