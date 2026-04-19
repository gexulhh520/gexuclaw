from typing import Optional

from ..base import BaseTool
from ..tool_operation import ToolOperation
from ..tool_registry import tool
from ..tool_result import ToolResult


@tool("scheduled_task")
class ScheduledTaskTool(BaseTool):
    category = "scheduled_task"
    description = (
        "定时任务规划入口工具。仅在用户明确希望把当前或历史成功流程转为可重复执行的定时任务时调用。"
        "适用示例：'把刚才这个流程设成每天早上9点执行'、'把之前成功的抓取流程改成每周一自动跑'。"
        "不适用示例：普通问答、一次性执行、仅咨询定时任务概念。"
    )

    def _register_operations(self):
        self.operations = {
            "plan_draft": ToolOperation(
                name="plan_draft",
                description=(
                    "当用户明确要求把一个已经完成或讨论过的流程转成定时任务时调用。"
                    "该工具不会直接创建任务，而是进入定时任务规划子图并生成草案。"
                    "如果用户没有表达明确的重复执行意图，或只是想临时执行一次，不要调用。"
                ),
                parameters=[
                    {
                        "name": "intent_text",
                        "type": "string",
                        "required": True,
                        "description": (
                            "用户希望转成定时任务的核心意图，应包含要做什么和对象是什么。"
                            "示例：把刚才成功的招聘网站投递流程转成定时任务。"
                        ),
                    },
                    {
                        "name": "schedule_text",
                        "type": "string",
                        "required": True,
                        "description": (
                            "自然语言频率描述，例如 每天09:00、每周一上午10点。"
                            "不要传 cron 表达式，优先传用户能理解的自然语言。"
                        ),
                    },
                    {
                        "name": "timezone",
                        "type": "string",
                        "required": False,
                        "description": (
                            "时区，例如 Asia/Shanghai。未提供时由系统使用用户默认时区。"
                            "只有当用户明确提到时区时才建议填写。"
                        ),
                    },
                    {
                        "name": "goal",
                        "type": "string",
                        "required": False,
                        "description": (
                            "任务最终目标，用于帮助子图规划最佳执行路径。"
                            "示例：每天自动抓取新案件并发送结果摘要。"
                        ),
                    },
                ],
                func=self.plan_draft,
            )
        }

    async def plan_draft(
        self,
        intent_text: str,
        schedule_text: str,
        timezone: Optional[str] = None,
        goal: Optional[str] = None,
    ) -> ToolResult:
        return ToolResult(
            True,
            data={
                "intent_text": intent_text,
                "schedule_text": schedule_text,
                "timezone": timezone,
                "goal": goal,
                "trigger": "scheduled_task_subgraph",
            },
            meta={"handled_by": "scheduled_task_subgraph"},
        )
