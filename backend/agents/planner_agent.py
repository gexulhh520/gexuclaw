import json
from typing import Any, Dict, Optional, TypedDict

from langgraph.graph import StateGraph, END

from llm.client import llm_client_instance
from schemas.scheduled_task_v2 import ScheduledTaskDraftContentV2


class PlannerAgentState(TypedDict):
    trace_context: Dict[str, Any]
    intent_text: str
    schedule_text: str
    timezone: str
    goal: Optional[str]
    draft_content: Optional[ScheduledTaskDraftContentV2]


class PlannerAgentV2:
    def __init__(self, provider: str = "openai", model: str = None):
        self.provider = provider
        self.model = model
        self.graph = self._build_graph()

    def _build_graph(self):
        workflow = StateGraph(PlannerAgentState)
        workflow.add_node("analyze_and_draft", self._analyze_and_draft_node)
        workflow.set_entry_point("analyze_and_draft")
        workflow.add_edge("analyze_and_draft", END)
        return workflow.compile()

    async def _analyze_and_draft_node(self, state: PlannerAgentState):
        trace_context = state["trace_context"]
        intent_text = state["intent_text"]
        schedule_text = state["schedule_text"]
        timezone = state["timezone"]
        goal = state.get("goal") or intent_text

        prompt = (
            "你是定时任务规划器(Planner Agent V2)。请根据用户的历史操作轨迹，提取出一个目标驱动的定时任务执行策略。\n"
            "要求：\n"
            "1. 只输出合法 JSON。\n"
            "2. 不要规划死板的执行步骤（不需要 execution_steps），而是总结策略（strategy）。\n"
            "3. 策略包含：目标(goal)、执行策略(execution_strategy)、推荐工具(tool_hints)、成功标准(success_criteria)、风险(risk_notes)。\n"
            "4. reference_steps 仅保留对未来执行有参考价值的成功参数。\n"
            "5. 不要输出 markdown 标记（如 ```json），直接输出 JSON 对象。\n\n"
            f"目标：{goal}\n"
            f"意图：{intent_text}\n"
            f"调度描述：{schedule_text}\n"
            f"时区：{timezone}\n"
            f"执行轨迹上下文：{json.dumps(trace_context, ensure_ascii=False)}\n\n"
            "期望的 JSON 格式（对应 ScheduledTaskDraftContentV2）：\n"
            "{\n"
            '  "title": "任务名称",\n'
            '  "description": "任务描述",\n'
            '  "schedule_text": "...",\n'
            '  "cron_expression": "...",\n'
            '  "timezone": "...",\n'
            '  "strategy": {\n'
            '    "goal": "...",\n'
            '    "execution_strategy": "...",\n'
            '    "tool_hints": ["tool1", "tool2"],\n'
            '    "success_criteria": ["...", "..."],\n'
            '    "risk_notes": ["..."],\n'
            '    "reference_steps": [{...}]\n'
            '  },\n'
            '  "feasibility": { "is_feasible": true, ... },\n'
            '  "tool_whitelist": ["tool1"]\n'
            "}"
        )

        response = await llm_client_instance.chat(
            messages=[{"role": "user", "content": prompt}],
            provider=self.provider,
            model=self.model,
            temperature=0.2,
            system_prompt="你是定时任务规划器(Planner Agent V2)。请只返回合法 JSON。",
        )

        content = (response.get("content") or "").strip()
        content = self._strip_code_fences(content)
        json_text = self._extract_json_object(content) or content

        try:
            data = json.loads(json_text)
        except json.JSONDecodeError:
            data = self._fallback_draft(goal, schedule_text, timezone)

        if "strategy" not in data:
            data["strategy"] = self._fallback_draft(goal, schedule_text, timezone)["strategy"]

        data.setdefault("delivery_channels", ["in_app"])
        data.setdefault("raw_trace_summary", trace_context)

        strategy = data["strategy"]
        summary = (
            f"**目标**：{strategy.get('goal', goal)}\n\n"
            f"**执行策略**：{strategy.get('execution_strategy', '无')}\n\n"
            f"**建议工具**：{', '.join(strategy.get('tool_hints', []))}\n"
        )
        data["summary_markdown"] = summary

        state["draft_content"] = ScheduledTaskDraftContentV2(**data)
        return state

    def _fallback_draft(self, goal: str, schedule_text: str, timezone: str) -> dict:
        return {
            "title": goal[:20] + " 任务",
            "description": goal,
            "schedule_text": schedule_text,
            "cron_expression": "",
            "timezone": timezone,
            "strategy": {
                "goal": goal,
                "execution_strategy": "根据目标自行规划并调用工具",
                "tool_hints": ["browser__launch_browser", "network__fetch"],
                "success_criteria": ["任务完成目标"],
                "risk_notes": ["目标不明确可能导致失败"],
                "reference_steps": [],
            },
            "tool_whitelist": ["browser__launch_browser", "network__fetch"],
        }

    def _strip_code_fences(self, content: str) -> str:
        cleaned = (content or "").strip()
        if not cleaned.startswith("```"):
            return cleaned

        lines = cleaned.splitlines()
        if len(lines) >= 2 and lines[-1].strip() == "```":
            return "\n".join(lines[1:-1]).strip()

        return cleaned.replace("```json", "", 1).replace("```", "", 1).strip()

    def _extract_json_object(self, content: str) -> Optional[str]:
        if not content:
            return None

        start = content.find("{")
        if start == -1:
            return None

        depth = 0
        in_string = False
        escape = False

        for index in range(start, len(content)):
            char = content[index]
            if escape:
                escape = False
                continue
            if char == "\\":
                escape = True
                continue
            if char == '"':
                in_string = not in_string
                continue
            if in_string:
                continue
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    return content[start:index + 1].strip()

        return None

    async def execute(self, state: PlannerAgentState) -> PlannerAgentState:
        return await self.graph.ainvoke(state)
