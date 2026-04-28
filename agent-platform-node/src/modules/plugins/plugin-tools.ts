import type {
  PluginReadItemInput,
  PluginReadItemResult,
} from "./plugin.schema.js";
import type { PluginRegistry } from "./plugin-registry.js";

/**
 * plugin.read_item 工具定义
 * 用于 LLM 按需查询插件的具体内容
 * 注意：工具名使用 plugin_read_item（下划线）而非 plugin.read_item（点号），
 * 因为部分模型（如 Kimi）要求函数名只能包含字母、数字、下划线和破折号
 */
export const pluginReadItemToolDefinition = {
  name: "plugin_read_item",
  description:
    "读取已装载插件的具体内容（prompt 或 resource）。当需要了解某个插件工具的详细用法、参考模板或资源内容时使用。",
  inputSchema: {
    type: "object" as const,
    properties: {
      pluginId: {
        type: "string" as const,
        description: "插件 ID，例如 'builtin-browser-core'",
      },
      itemType: {
        type: "string" as const,
        enum: ["prompt", "resource"],
        description: "要读取的条目类型",
      },
      itemId: {
        type: "string" as const,
        description: "条目 ID，例如 'page-analysis-template'",
      },
    },
    required: ["pluginId", "itemType", "itemId"],
  },
};

/**
 * 处理 plugin.read_item 请求
 * @param input 查询参数
 * @param registry 插件注册表
 * @returns 查询结果
 */
export async function handlePluginReadItem(
  input: PluginReadItemInput,
  registry: PluginRegistry
): Promise<PluginReadItemResult> {
  // 1. 查找插件
  const plugin = registry.getPlugin(input.pluginId);
  if (!plugin) {
    return {
      success: false,
      pluginId: input.pluginId,
      itemType: input.itemType,
      itemId: input.itemId,
      title: "",
      content: "",
      error: `插件不存在: ${input.pluginId}`,
    };
  }

  // 2. 根据 itemType 查找对应条目
  if (input.itemType === "prompt") {
    const prompt = plugin.prompts?.find((p) => p.promptId === input.itemId);
    if (!prompt) {
      return {
        success: false,
        pluginId: input.pluginId,
        itemType: input.itemType,
        itemId: input.itemId,
        title: "",
        content: "",
        error: `提示不存在: ${input.itemId} (插件: ${input.pluginId})`,
      };
    }

    return {
      success: true,
      pluginId: input.pluginId,
      itemType: input.itemType,
      itemId: input.itemId,
      title: prompt.title,
      content: prompt.content,
    };
  }

  if (input.itemType === "resource") {
    const resource = plugin.resources?.find((r) => r.resourceId === input.itemId);
    if (!resource) {
      return {
        success: false,
        pluginId: input.pluginId,
        itemType: input.itemType,
        itemId: input.itemId,
        title: "",
        content: "",
        error: `资源不存在: ${input.itemId} (插件: ${input.pluginId})`,
      };
    }

    return {
      success: true,
      pluginId: input.pluginId,
      itemType: input.itemType,
      itemId: input.itemId,
      title: resource.title,
      content: resource.content,
    };
  }

  // 理论上不会到达这里，因为 itemType 已被 schema 限制
  return {
    success: false,
    pluginId: input.pluginId,
    itemType: input.itemType,
    itemId: input.itemId,
    title: "",
    content: "",
    error: `不支持的条目类型: ${input.itemType}`,
  };
}

/**
 * 将 plugin.read_item 注册到 ToolRuntime
 * @param toolRuntime 工具运行时
 * @param registry 插件注册表
 */
export function registerPluginReadItemTool(
  toolRuntime: { registerTool: (tool: { name: string; description: string; handler: (input: unknown) => Promise<import("../../tools/tool-types.js").ToolResult> }) => void },
  registry: PluginRegistry
): void {
  toolRuntime.registerTool({
    name: pluginReadItemToolDefinition.name,
    description: pluginReadItemToolDefinition.description,
    handler: async (input: unknown) => {
      // 简单校验输入
      const parsed = input as PluginReadItemInput;
      if (!parsed.pluginId || !parsed.itemType || !parsed.itemId) {
        return {
          success: false,
          error: "缺少必要参数: pluginId, itemType, itemId",
        };
      }
      const result = await handlePluginReadItem(parsed, registry);
      return {
        success: result.success,
        data: result,
        error: result.error,
      };
    },
  });
}
