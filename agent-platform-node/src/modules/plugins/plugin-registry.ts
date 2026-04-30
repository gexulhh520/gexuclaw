import type { AgentPlugin, AgentPluginBinding } from "./plugin.schema.js";

/**
 * 插件注册表
 * 管理插件的注册、查询和 Agent 挂载关系
 * 
 * 绑定关系改为 Agent 级别，一个 Agent 的所有版本共享相同的插件
 */
export class PluginRegistry {
  // 插件存储: pluginId -> AgentPlugin
  private plugins: Map<string, AgentPlugin> = new Map();

  // Agent 挂载关系: agentId -> PluginBinding[]
  private bindings: Map<number, AgentPluginBinding[]> = new Map();

  /**
   * 注册插件
   * @param plugin 插件定义
   */
  registerPlugin(plugin: AgentPlugin): void {
    this.plugins.set(plugin.pluginId, plugin);
    console.log(`[PluginRegistry] 注册插件: ${plugin.pluginId} (${plugin.name})`);
  }

  /**
   * 注销插件
   * @param pluginId 插件 ID
   */
  unregisterPlugin(pluginId: string): void {
    this.plugins.delete(pluginId);
    console.log(`[PluginRegistry] 注销插件: ${pluginId}`);
  }

  /**
   * 获取插件
   * @param pluginId 插件 ID
   * @returns 插件定义或 undefined
   */
  getPlugin(pluginId: string): AgentPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * 获取所有已注册插件
   * @returns 插件列表
   */
  getAllPlugins(): AgentPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * 获取所有已激活插件
   * @returns 激活状态的插件列表
   */
  getActivePlugins(): AgentPlugin[] {
    return this.getAllPlugins().filter((p) => p.status === "active");
  }

  /**
   * 获取指定类型的插件
   * @param pluginType 插件类型
   * @returns 符合条件的插件列表
   */
  getPluginsByType(pluginType: "builtin" | "external"): AgentPlugin[] {
    return this.getActivePlugins().filter((p) => p.pluginType === pluginType);
  }

  /**
   * 添加 Agent 与插件的挂载关系
   * @param binding 挂载关系
   */
  addBinding(binding: AgentPluginBinding): void {
    const existing = this.bindings.get(binding.agentId) ?? [];
    // 检查是否已存在
    const index = existing.findIndex(
      (b) => b.pluginId === binding.pluginId
    );
    if (index >= 0) {
      existing[index] = binding;
    } else {
      existing.push(binding);
    }
    this.bindings.set(binding.agentId, existing);
    console.log(
      `[PluginRegistry] 挂载插件: ${binding.pluginId} -> Agent ${binding.agentId}`
    );
  }

  /**
   * 移除 Agent 与插件的挂载关系
   * @param agentId Agent ID
   * @param pluginId 插件 ID
   */
  removeBinding(agentId: number, pluginId: string): void {
    const existing = this.bindings.get(agentId) ?? [];
    const filtered = existing.filter((b) => b.pluginId !== pluginId);
    this.bindings.set(agentId, filtered);
    console.log(
      `[PluginRegistry] 移除挂载: ${pluginId} -> Agent ${agentId}`
    );
  }

  /**
   * 获取 Agent 挂载的所有插件
   * @param agentId Agent ID
   * @returns 挂载的插件列表
   */
  getPluginsForAgent(agentId: number): AgentPlugin[] {
    console.log(`[PluginRegistry] getPluginsForAgent called, agentId=${agentId}`);
    console.log(`[PluginRegistry] 当前所有 bindings: ${JSON.stringify(Array.from(this.bindings.entries()))}`);
    
    const bindings = this.bindings.get(agentId) ?? [];
    console.log(`[PluginRegistry] agentId=${agentId} 的 bindings: ${JSON.stringify(bindings)}`);
    
    const enabledBindings = bindings.filter((b) => b.enabled);
    console.log(`[PluginRegistry] enabledBindings: ${JSON.stringify(enabledBindings)}`);

    // 按优先级排序
    enabledBindings.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

    const plugins: AgentPlugin[] = [];
    for (const binding of enabledBindings) {
      const plugin = this.plugins.get(binding.pluginId);
      console.log(`[PluginRegistry] 查找插件 ${binding.pluginId}: ${plugin ? "找到" : "未找到"}, status=${plugin?.status}`);
      if (plugin && plugin.status === "active") {
        plugins.push(plugin);
      }
    }

    console.log(`[PluginRegistry] 返回插件数: ${plugins.length}`);
    return plugins;
  }

  /**
   * 获取 Agent 的绑定列表
   * @param agentId Agent ID
   * @returns 绑定列表
   */
  getBindingsForAgent(agentId: number): AgentPluginBinding[] {
    return this.bindings.get(agentId) ?? [];
  }

  /**
   * 检查插件是否已挂载到 Agent
   * @param agentId Agent ID
   * @param pluginId 插件 ID
   * @returns 是否已挂载
   */
  isPluginAttached(agentId: number, pluginId: string): boolean {
    const bindings = this.bindings.get(agentId) ?? [];
    return bindings.some((b) => b.pluginId === pluginId && b.enabled);
  }

  /**
   * 获取指定 Agent 类型的默认插件列表
   * @param agentType Agent 类型 (builtin, chat, workflow)
   * @returns 默认应挂载的插件列表
   */
  getDefaultPluginsForAgentType(agentType: string): AgentPlugin[] {
    return this.getActivePlugins().filter((plugin) =>
      plugin.defaultAttachTargets?.includes(agentType)
    );
  }

  /**
   * 获取注册表统计信息
   * @returns 统计信息
   */
  getStats(): {
    totalPlugins: number;
    activePlugins: number;
    totalBindings: number;
  } {
    const totalBindings = Array.from(this.bindings.values()).reduce(
      (sum, bindings) => sum + bindings.length,
      0
    );

    return {
      totalPlugins: this.plugins.size,
      activePlugins: this.getActivePlugins().length,
      totalBindings,
    };
  }
}
