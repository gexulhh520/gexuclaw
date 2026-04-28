import type { AgentPlugin, PluginCatalogSummary } from "./plugin.schema.js";

/**
 * 构建单个插件的目录摘要
 * 从插件的 tools/resources/prompts 中提取目录信息
 */
export function buildSinglePluginCatalog(plugin: AgentPlugin): PluginCatalogSummary {
  const items: PluginCatalogSummary["items"] = [];

  // 提取 tools
  if (plugin.tools) {
    for (const tool of plugin.tools) {
      items.push({
        itemId: tool.toolId,
        itemType: "tool",
        title: tool.name,
        description: tool.description,
      });
    }
  }

  // 提取 resources
  if (plugin.resources) {
    for (const resource of plugin.resources) {
      items.push({
        itemId: resource.resourceId,
        itemType: "resource",
        title: resource.title,
        description: resource.description,
      });
    }
  }

  // 提取 prompts
  if (plugin.prompts) {
    for (const prompt of plugin.prompts) {
      items.push({
        itemId: prompt.promptId,
        itemType: "prompt",
        title: prompt.title,
        description: prompt.description,
      });
    }
  }

  return {
    pluginId: plugin.pluginId,
    pluginName: plugin.name,
    description: plugin.description,
    items,
  };
}

/**
 * 构建插件目录摘要文本（用于注入 Prompt）
 * 生成 LLM 可理解的插件目录描述
 */
export function buildPluginCatalogInjection(plugins: AgentPlugin[]): string {
  if (plugins.length === 0) {
    return "";
  }

  const sections: string[] = [];
  sections.push(`## 已装载插件 (${plugins.length}个)`);
  sections.push("");

  for (const plugin of plugins) {
    // 确保目录摘要存在
    const catalog = plugin.catalog ?? buildSinglePluginCatalog(plugin);

    sections.push(`### ${plugin.name}`);
    sections.push(`**插件ID**: \`${plugin.pluginId}\``);
    if (plugin.description) {
      sections.push(plugin.description);
    }
    sections.push("");

    // 工具列表
    const toolItems = catalog.items.filter((item) => item.itemType === "tool");
    if (toolItems.length > 0) {
      sections.push("**可用工具**:");
      for (const item of toolItems) {
        const desc = item.description ? ` - ${item.description}` : "";
        sections.push(`- \`${item.itemId}\`: ${item.title}${desc}`);
      }
      sections.push("");
    }

    // 资源列表
    const resourceItems = catalog.items.filter((item) => item.itemType === "resource");
    if (resourceItems.length > 0) {
      sections.push("**可用资源**:");
      for (const item of resourceItems) {
        const desc = item.description ? ` - ${item.description}` : "";
        sections.push(`- \`${item.itemId}\`: ${item.title}${desc}`);
      }
      sections.push("");
    }

    // 提示列表
    const promptItems = catalog.items.filter((item) => item.itemType === "prompt");
    if (promptItems.length > 0) {
      sections.push("**可用提示**:");
      for (const item of promptItems) {
        const desc = item.description ? ` - ${item.description}` : "";
        sections.push(`- \`${item.itemId}\`: ${item.title}${desc}`);
      }
      sections.push("");
    }
  }

  // 添加使用说明
  sections.push("---");
  sections.push("使用 `plugin_read_item` 工具查看插件详情，参数：`pluginId`（见上）、`itemType`（prompt/resource）、`itemId`（见上）");
  sections.push("");

  return sections.join("\n");
}

/**
 * 构建精简版插件目录（仅用于日志或调试）
 */
export function buildPluginCatalogSummary(plugins: AgentPlugin[]): string {
  return plugins
    .map(
      (p) =>
        `${p.name}(${p.pluginId}): ${p.tools?.length ?? 0}tools, ${p.resources?.length ?? 0}resources, ${p.prompts?.length ?? 0}prompts`
    )
    .join(" | ");
}
