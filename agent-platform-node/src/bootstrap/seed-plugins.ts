import { PluginRegistry } from "../modules/plugins/plugin-registry.js";
import { listAgents } from "../modules/agents/agent.service.js";
import { builtinBrowserCoreDocs } from "../modules/plugins/builtins/browser-core-docs.js";
import { filesystemCorePlugin } from "../modules/plugins/builtins/filesystem-core/index.js";
import { PluginManager } from "../modules/plugins/plugin-manager.js";

/**
 * 初始化内置插件
 * 现在委托给 PluginManager.bootstrap() 处理
 * @deprecated 请直接使用 PluginManager.bootstrap()
 */
export async function seedBuiltinPlugins(registry: PluginRegistry): Promise<void> {
  console.log("[Bootstrap] seedBuiltinPlugins 已废弃，委托给 PluginManager.bootstrap()");

  const pluginManager = new PluginManager(registry);
  await pluginManager.bootstrap();
}

/**
 * 为 Agent 挂载默认插件
 * 根据 Agent 类型自动挂载匹配的内置插件
 * @deprecated 不再使用，插件绑定权已下放到 AgentVersion.allowedPluginIds
 */
export async function attachDefaultPluginsToAgents(
  registry: PluginRegistry,
  agents: Array<{ id: number; type: string; agentUid: string }>
): Promise<void> {
  console.log("[Bootstrap] attachDefaultPluginsToAgents 已废弃，不再执行绑定逻辑");
  console.log("[Bootstrap] 插件绑定请通过 AgentVersion.allowedPluginIds 显式配置");
}

/**
 * 为数据库中所有 Agent 挂载默认插件
 * 用于系统启动时确保所有 Agent 都有插件绑定
 * @deprecated 不再使用，插件绑定权已下放到 AgentVersion.allowedPluginIds
 */
export async function attachDefaultPluginsToAllAgents(registry: PluginRegistry): Promise<void> {
  console.log("[Bootstrap] attachDefaultPluginsToAllAgents 已废弃，不再执行绑定逻辑");
  console.log("[Bootstrap] 插件绑定请通过 AgentVersion.allowedPluginIds 显式配置");
}
