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
  // 第一阶段先用 mock browser 工具验证 AgentRuntime 的工具链路。
  // 真实浏览器自动化后续可以保持同名工具协议，再替换 handler 实现。
  registerTool({
    name: "browser.open",
    description: "Mock browser tool. Opens a URL and returns a lightweight page summary.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
      },
      required: ["url"],
    },
    async handler(input) {
      const url = typeof input === "object" && input !== null && "url" in input ? String(input.url) : "";

      return {
        success: Boolean(url),
        data: {
          url,
          title: url ? `Mock page for ${url}` : undefined,
          text: url ? "This is a mock browser result for first-phase AgentRuntime validation." : undefined,
        },
        error: url ? undefined : "Missing url",
        meta: { mock: true },
      };
    },
  });

  registerTool({
    name: "browser.get_page_info",
    description: "Mock browser tool. Returns page metadata from the current mock browser state.",
    parameters: {
      type: "object",
      properties: {},
    },
    async handler() {
      return {
        success: true,
        data: {
          title: "Mock current page",
          url: "mock://current-page",
          text: "Mock current page information.",
        },
        meta: { mock: true },
      };
    },
  });
}
