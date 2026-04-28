import { validationError } from "../shared/errors.js";
import { getTool, listTools, registerTool } from "../tools/tool-registry.js";
import type { PluginRegistry } from "../modules/plugins/plugin-registry.js";
import type { ToolDefinition } from "../tools/tool-types.js";
import { createFilesystemTools } from "../modules/plugins/builtins/filesystem-core/filesystem-tools.js";

/**
 * 工具运行时
 * 管理工具的执行和清单生成
 * 支持全局注册工具和插件工具
 */
export class ToolRuntime {
  private pluginRegistry?: PluginRegistry;

  constructor(
    private readonly allowedToolNames: string[],
    pluginRegistry?: PluginRegistry
  ) {
    this.pluginRegistry = pluginRegistry;
  }

  /**
   * 获取工具清单（用于发送给 LLM）
   * 支持全局工具和插件工具（格式: pluginId__toolId）
   * 返回 OpenAI 标准格式: { type: "function", function: { name, description, parameters } }
   */
  getToolManifest(): ToolDefinition[] {
    const manifest: ToolDefinition[] = [];

    for (const toolName of this.allowedToolNames) {
      // 检查是否是插件工具（格式: pluginId__toolId）
      if (toolName.includes("__")) {
        const pluginToolDef = this.getPluginToolDefinition(toolName);
        if (pluginToolDef) {
          manifest.push(pluginToolDef);
        }
      } else {
        // 全局注册的工具
        const tool = getTool(toolName);
        if (tool) {
          const { handler: _handler, name, description, parameters } = tool;
          manifest.push({
            type: "function",
            function: {
              name,
              description,
              parameters,
            },
          });
        }
      }
    }

    return manifest;
  }

  /**
   * 执行工具
   * 支持全局工具和插件工具
   */
  async execute(toolName: string, input: unknown) {
    // 模型返回 tool call 后还要在执行前再校验一次，防止模型调用未授权工具
    if (!this.allowedToolNames.includes(toolName)) {
      throw validationError("Tool is not allowed for this AgentVersion", { toolName });
    }

    // 检查是否是插件工具
    if (toolName.includes("__")) {
      return this.executePluginTool(toolName, input);
    }

    // 全局注册的工具
    const tool = getTool(toolName);
    if (!tool) {
      throw validationError("Tool is not registered", { toolName });
    }

    return tool.handler(input);
  }

  /**
   * 获取插件工具定义（OpenAI 标准格式）
   * @param fullToolName 完整工具名（格式: pluginId__toolId）
   */
  private getPluginToolDefinition(fullToolName: string): ToolDefinition | undefined {
    if (!this.pluginRegistry) return undefined;

    const [pluginId, toolId] = fullToolName.split("__");
    if (!pluginId || !toolId) return undefined;

    const plugin = this.pluginRegistry.getPlugin(pluginId);
    if (!plugin || !plugin.tools) return undefined;

    const tool = plugin.tools.find((t) => t.toolId === toolId);
    if (!tool) return undefined;

    return {
      type: "function",
      function: {
        name: fullToolName,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    };
  }

  /**
   * 执行插件工具
   * @param fullToolName 完整工具名（格式: pluginId__toolId）
   * @param input 工具输入
   */
  private async executePluginTool(fullToolName: string, input: unknown) {
    const [pluginId, toolId] = fullToolName.split("__");

    // 根据插件类型调用对应的实现
    if (pluginId === "builtin-filesystem-core") {
      return this.executeFilesystemTool(toolId, input);
    }

    // 其他插件使用 mock 实现
    return this.executeMockPluginTool(pluginId, toolId, input);
  }

  /**
   * Mock 插件工具执行（第一阶段）
   */
  private async executeMockPluginTool(
    pluginId: string,
    toolId: string,
    input: unknown
  ) {
    // 浏览器插件的 mock 实现
    if (pluginId === "builtin-browser-core-docs") {
      return this.executeMockBrowserTool(toolId, input);
    }

    // 默认 mock 响应
    return {
      success: true,
      data: {
        message: `Mock execution: ${pluginId}__${toolId}`,
        input,
      },
      meta: { mock: true },
    };
  }

  /**
   * Mock 浏览器工具执行
   */
  private async executeMockBrowserTool(toolId: string, input: unknown) {
    const args = typeof input === "object" && input !== null ? input as Record<string, unknown> : {};

    switch (toolId) {
      case "browser_open": {
        const url = String(args.url || "");
        return {
          success: Boolean(url),
          data: {
            url,
            title: url ? `Mock page for ${url}` : undefined,
            text: url ? "This is a mock browser result for first-phase AgentRuntime validation." : undefined,
          },
          error: url ? undefined : "Missing url",
          meta: { mock: true },
          artifactCandidates: url
            ? [
                {
                  kind: "page" as const,
                  title: `页面快照 - ${url}`,
                  contentJson: {
                    url,
                    title: `Mock page for ${url}`,
                    text: "This is a mock browser result for first-phase AgentRuntime validation.",
                  },
                  defaultRole: "intermediate" as const,
                },
              ]
            : [],
        };
      }

      case "browser_get_page_info": {
        return {
          success: true,
          data: {
            title: "Mock current page",
            url: "mock://current-page",
            text: "Mock current page information.",
          },
          meta: { mock: true },
          artifactCandidates: [
            {
              kind: "page" as const,
              title: "当前页面信息",
              contentJson: {
                title: "Mock current page",
                url: "mock://current-page",
                text: "Mock current page information.",
              },
              defaultRole: "intermediate" as const,
            },
          ],
        };
      }

      case "browser_find_element": {
        const selector = String(args.selector || "");
        return {
          success: Boolean(selector),
          data: {
            selector,
            found: true,
            text: `Mock element text for selector: ${selector}`,
            html: `<div class="mock-element">Mock content</div>`,
          },
          error: selector ? undefined : "Missing selector",
          meta: { mock: true },
        };
      }

      case "browser_click": {
        const selector = String(args.selector || "");
        return {
          success: Boolean(selector),
          data: {
            selector,
            clicked: true,
            navigation: args.waitForNavigation ? "completed" : "none",
          },
          error: selector ? undefined : "Missing selector",
          meta: { mock: true },
        };
      }

      case "browser_input_text": {
        const selector = String(args.selector || "");
        const text = String(args.text || "");
        return {
          success: Boolean(selector) && Boolean(text),
          data: {
            selector,
            text,
            cleared: args.clearFirst,
            input: true,
          },
          error: selector && text ? undefined : "Missing selector or text",
          meta: { mock: true },
        };
      }

      case "browser_screenshot": {
        return {
          success: true,
          data: {
            selector: args.selector,
            fullPage: args.fullPage,
            screenshot: "mock-screenshot-data-url",
            format: "png",
          },
          meta: { mock: true },
          artifactCandidates: [
            {
              kind: "image" as const,
              title: args.selector ? `元素截图 - ${args.selector}` : "页面截图",
              contentJson: {
                dataUrl: "mock-screenshot-data-url",
                format: "png",
                selector: args.selector,
                fullPage: args.fullPage,
              },
              defaultRole: "intermediate" as const,
            },
          ],
        };
      }

      case "browser_scroll": {
        return {
          success: true,
          data: {
            direction: args.direction,
            amount: args.amount,
            toElement: args.toElement,
            scrolled: true,
          },
          meta: { mock: true },
        };
      }

      case "browser_extract_data": {
        return {
          success: true,
          data: {
            schema: args.schema,
            listSelector: args.listSelector,
            extracted: [
              { title: "Mock Item 1", price: "¥100" },
              { title: "Mock Item 2", price: "¥200" },
            ],
          },
          meta: { mock: true },
        };
      }

      default:
        return {
          success: false,
          error: `Unknown browser tool: ${toolId}`,
          meta: { mock: true },
        };
    }
  }

  /**
   * 执行文件系统工具
   * 使用真实的文件系统实现
   */
  private async executeFilesystemTool(toolId: string, input: unknown) {
    // 从环境变量读取工作空间路径，默认为当前工作目录
    const workspaceDir = process.env.WORKSPACE_DIR ?? process.cwd();
    console.log(`[ToolRuntime] 文件系统工作空间: ${workspaceDir}`);
    const fsTools = createFilesystemTools({ workspaceDir });

    try {
      let result: unknown;
      const args = typeof input === "object" && input !== null ? input : {};

      switch (toolId) {
        case "fs_read":
          result = await fsTools.fs_read(args as Parameters<typeof fsTools.fs_read>[0]);
          break;
        case "fs_write":
          result = await fsTools.fs_write(args as Parameters<typeof fsTools.fs_write>[0]);
          break;
        case "fs_append":
          result = await fsTools.fs_append(args as Parameters<typeof fsTools.fs_append>[0]);
          break;
        case "fs_edit":
          result = await fsTools.fs_edit(args as Parameters<typeof fsTools.fs_edit>[0]);
          break;
        case "fs_apply_patch":
          result = await fsTools.fs_apply_patch(args as Parameters<typeof fsTools.fs_apply_patch>[0]);
          break;
        case "fs_grep":
          result = await fsTools.fs_grep(args as Parameters<typeof fsTools.fs_grep>[0]);
          break;
        case "fs_find":
          result = await fsTools.fs_find(args as Parameters<typeof fsTools.fs_find>[0]);
          break;
        case "fs_ls":
          result = await fsTools.fs_ls(args as Parameters<typeof fsTools.fs_ls>[0]);
          break;
        default:
          return {
            success: false,
            error: `Unknown filesystem tool: ${toolId}`,
            meta: { mock: true },
          };
      }

      return {
        success: true,
        data: result,
        meta: { plugin: "builtin-filesystem-core", tool: toolId },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        meta: { plugin: "builtin-filesystem-core", tool: toolId },
      };
    }
  }

  /**
   * 注册动态工具（如 plugin_read_item）
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
