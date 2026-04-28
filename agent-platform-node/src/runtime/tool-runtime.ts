import { validationError } from "../shared/errors.js";
import { getTool, listTools, registerTool } from "../tools/tool-registry.js";

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

  /**
   * 注册动态工具（如插件工具）
   * @param tool 工具定义
   */
  registerTool(tool: { name: string; description: string; handler: (input: unknown) => Promise<import("../tools/tool-types.js").ToolResult> }): void {
    // 注册到全局工具注册表
    registerTool({
      name: tool.name,
      description: tool.description,
      parameters: { type: "object", properties: {} }, // 简化 schema
      handler: tool.handler,
    });
    // 添加到允许列表
    if (!this.allowedToolNames.includes(tool.name)) {
      this.allowedToolNames.push(tool.name);
    }
  }
}
