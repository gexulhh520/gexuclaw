import { validationError } from "../shared/errors.js";
import { getTool, listTools } from "../tools/tool-registry.js";

export class ToolRuntime {
  constructor(private readonly allowedToolNames: string[]) {}

  getToolManifest() {
    // 只把 AgentVersion.allowed_tools_json 允许的工具暴露给模型。
    // handler 不会出现在 manifest 里，避免把执行细节泄露给 LLM。
    return listTools(this.allowedToolNames).map(({ handler: _handler, ...definition }) => definition);
  }

  async execute(toolName: string, input: unknown) {
    // 模型返回 tool call 后还要在执行前再校验一次，防止模型调用未授权工具。
    if (!this.allowedToolNames.includes(toolName)) {
      throw validationError("Tool is not allowed for this AgentVersion", { toolName });
    }

    const tool = getTool(toolName);
    if (!tool) {
      throw validationError("Tool is not registered", { toolName });
    }

    return tool.handler(input);
  }
}
