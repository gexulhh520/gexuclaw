import type { RegisteredTool } from "./tool-types.js";

const tools = new Map<string, RegisteredTool>();

export function registerTool(tool: RegisteredTool): void {
  // 工具注册表是第一阶段的本地目录，后续可以替换成数据库或远程工具目录。
  tools.set(tool.name, tool);
}

export function getTool(name: string): RegisteredTool | undefined {
  return tools.get(name);
}

export function listTools(allowedToolNames: string[]) {
  return allowedToolNames.map((name) => tools.get(name)).filter((tool): tool is RegisteredTool => Boolean(tool));
}

export function registerBuiltinTools(): void {
  // 内置工具已迁移到插件系统
  // 浏览器工具现在通过 builtin-browser-core-docs 插件提供
}
