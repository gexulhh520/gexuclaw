import { PluginRegistry } from "../modules/plugins/plugin-registry.js";
import { builtinBrowserCoreDocs } from "../modules/plugins/builtins/browser-core-docs.js";

/**
 * 初始化内置插件
 * 注册所有 builtin 类型插件到 PluginRegistry
 */
export async function seedBuiltinPlugins(registry: PluginRegistry): Promise<void> {
  console.log("[Bootstrap] 开始注册内置插件...");

  // 注册浏览器基础能力文档插件
  registry.registerPlugin(builtinBrowserCoreDocs);

  // 后续可在此添加更多内置插件
  // registry.registerPlugin(builtinBrowserPlaywright);
  // registry.registerPlugin(builtinWriterCore);
  // registry.registerPlugin(builtinExtractorCore);

  const stats = registry.getStats();
  console.log(`[Bootstrap] 内置插件注册完成: ${stats.activePlugins} 个激活插件`);
  console.log(`[Bootstrap] 插件列表: ${registry.getActivePlugins().map((p) => p.pluginId).join(", ")}`);
}

/**
 * 为 AgentVersion 挂载默认插件
 * 根据 Agent 类型自动挂载匹配的内置插件
 */
export async function attachDefaultPluginsToAgentVersions(
  registry: PluginRegistry,
  agentVersions: Array<{ id: number; agentType: string }>
): Promise<void> {
  console.log("[Bootstrap] 开始挂载默认插件...");

  for (const version of agentVersions) {
    // 查找该 Agent 类型默认应挂载的插件
    const defaultPlugins = registry.getDefaultPluginsForAgentType(version.agentType);

    for (const plugin of defaultPlugins) {
      registry.addBinding({
        bindingId: `binding-${version.id}-${plugin.pluginId}`,
        agentVersionId: version.id,
        pluginId: plugin.pluginId,
        enabled: true,
        priority: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      console.log(`[Bootstrap] 挂载插件 ${plugin.pluginId} -> AgentVersion ${version.id} (${version.agentType})`);
    }
  }

  console.log("[Bootstrap] 默认插件挂载完成");
}
