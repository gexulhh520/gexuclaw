from typing import List, Dict, Any, Callable


class ToolOperation:
    """
    单个操作的元信息
    描述一个工具操作的基本信息：名称、描述、参数、执行函数
    """

    def __init__(
        self,
        name: str,
        description: str,
        parameters: List[Dict[str, Any]],
        func: Callable,
    ):
        self.name = name
        self.description = description
        self.parameters = parameters
        self.func = func  # 实际执行函数

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典，用于 LLM 的 function calling"""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": {
                    "type": "object",
                    "properties": {
                        param["name"]: {
                            "type": param.get("type", "string"),
                            "description": param.get("description", ""),
                        }
                        for param in self.parameters
                    },
                    "required": [
                        param["name"]
                        for param in self.parameters
                        if param.get("required", False)
                    ],
                },
            },
        }

    def __repr__(self):
        return f"ToolOperation(name={self.name}, description={self.description})"
