import { PluginRegistry } from "../modules/plugins/plugin-registry.js";
import { listAgents } from "../modules/agents/agent.service.js";
import { builtinBrowserCoreDocs } from "../modules/plugins/builtins/browser-core-docs.js";
import { filesystemCorePlugin } from "../modules/plugins/builtins/filesystem-core/index.js";

/**
 * 初始化内置插件
 * 注册所有 builtin 类型插件到 PluginRegistry
 */
export async function seedBuiltinPlugins(registry: PluginRegistry): Promise<void> {
  console.log("[Bootstrap] 开始注册内置插件...");

  // 注册浏览器基础能力文档插件
  registry.registerPlugin(builtinBrowserCoreDocs);

  // 注册文件系统核心插件（全局基础能力）
  registry.registerPlugin(filesystemCorePlugin);

  // 后续可在此添加更多内置插件
  // registry.registerPlugin(builtinBrowserPlaywright);
  // registry.registerPlugin(builtinWriterCore);
  // registry.registerPlugin(builtinExtractorCore);

  const stats = registry.getStats();
  console.log(`[Bootstrap] 内置插件注册完成: ${stats.activePlugins} 个激活插件`);
  console.log(`[Bootstrap] 插件列表: ${registry.getActivePlugins().map((p) => p.pluginId).join(", ")}`);
}

/**
 * 为 Agent 挂载默认插件
 * 根据 Agent 类型自动挂载匹配的内置插件
 */
export async function attachDefaultPluginsToAgents(
  registry: PluginRegistry,
  agents: Array<{ id: number; type: string; agentUid: string }>
): Promise<void> {
  console.log("[Bootstrap] 开始挂载默认插件...");

  for (const agent of agents) {
    // 查找该 Agent 类型默认应挂载的插件
    const defaultPlugins = registry.getDefaultPluginsForAgentType(agent.type);

    for (const plugin of defaultPlugins) {
      registry.addBinding({
        bindingId: `binding-${agent.id}-${plugin.pluginId}`,
        agentId: agent.id,
        pluginId: plugin.pluginId,
        enabled: true,
        priority: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      console.log(`[Bootstrap] 挂载插件 ${plugin.pluginId} -> Agent ${agent.id} (${agent.type}) [${agent.agentUid}]`);
    }
  }

  console.log("[Bootstrap] 默认插件挂载完成");
}

/**
 * 为数据库中所有 Agent 挂载默认插件
 * 用于系统启动时确保所有 Agent 都有插件绑定
 */
export async function attachDefaultPluginsToAllAgents(registry: PluginRegistry): Promise<void> {
  console.log("[Bootstrap] 开始为所有 Agent 挂载默认插件...");

  const allAgents = await listAgents();
  console.log(`[Bootstrap] 发现 ${allAgents.length} 个 Agent`);

  for (const agent of allAgents) {
    // 查找该 Agent 类型默认应挂载的插件
    const defaultPlugins = registry.getDefaultPluginsForAgentType(agent.type);

    for (const plugin of defaultPlugins) {
      // 检查是否已绑定
      const existingBindings = registry.getBindingsForAgent(agent.id);
      const alreadyBound = existingBindings.some(b => b.pluginId === plugin.pluginId);

      if (!alreadyBound) {
        registry.addBinding({
          bindingId: `binding-${agent.id}-${plugin.pluginId}`,
          agentId: agent.id,
          pluginId: plugin.pluginId,
          enabled: true,
          priority: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        console.log(`[Bootstrap] 挂载插件 ${plugin.pluginId} -> Agent ${agent.id} (${agent.type}) [${agent.agentUid}]`);
      } else {
        console.log(`[Bootstrap] 插件 ${plugin.pluginId} 已绑定到 Agent ${agent.id}，跳过`);
      }
    }
  }

  console.log("[Bootstrap] 所有 Agent 默认插件挂载完成");
}
