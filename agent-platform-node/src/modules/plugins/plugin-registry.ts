import type { AgentPlugin, AgentVersionPluginBinding } from "./plugin.schema.js";

/**
 * 插件注册表
 * 管理插件的注册、查询和 AgentVersion 挂载关系
 * 
 * 当前阶段使用内存存储，后续可扩展为数据库存储
 */
export class PluginRegistry {
  // 插件存储: pluginId -> AgentPlugin
  private plugins: Map<string, AgentPlugin> = new Map();

  // AgentVersion 挂载关系: agentVersionId -> PluginBinding[]
  private bindings: Map<number, AgentVersionPluginBinding[]> = new Map();

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
   * 添加 AgentVersion 与插件的挂载关系
   * @param binding 挂载关系
   */
  addBinding(binding: AgentVersionPluginBinding): void {
    const existing = this.bindings.get(binding.agentVersionId) ?? [];
    // 检查是否已存在
    const index = existing.findIndex(
      (b) => b.pluginId === binding.pluginId
    );
    if (index >= 0) {
      existing[index] = binding;
    } else {
      existing.push(binding);
    }
    this.bindings.set(binding.agentVersionId, existing);
    console.log(
      `[PluginRegistry] 挂载插件: ${binding.pluginId} -> AgentVersion ${binding.agentVersionId}`
    );
  }

  /**
   * 移除 AgentVersion 与插件的挂载关系
   * @param agentVersionId AgentVersion ID
   * @param pluginId 插件 ID
   */
  removeBinding(agentVersionId: number, pluginId: string): void {
    const existing = this.bindings.get(agentVersionId) ?? [];
    const filtered = existing.filter((b) => b.pluginId !== pluginId);
    this.bindings.set(agentVersionId, filtered);
    console.log(
      `[PluginRegistry] 移除挂载: ${pluginId} -> AgentVersion ${agentVersionId}`
    );
  }

  /**
   * 获取 AgentVersion 挂载的所有插件
   * @param agentVersionId AgentVersion ID
   * @returns 挂载的插件列表
   */
  getPluginsForAgentVersion(agentVersionId: number): AgentPlugin[] {
    const bindings = this.bindings.get(agentVersionId) ?? [];
    const enabledBindings = bindings.filter((b) => b.enabled);

    // 按优先级排序
    enabledBindings.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

    const plugins: AgentPlugin[] = [];
    for (const binding of enabledBindings) {
      const plugin = this.plugins.get(binding.pluginId);
      if (plugin && plugin.status === "active") {
        plugins.push(plugin);
      }
    }

    return plugins;
  }

  /**
   * 检查插件是否已挂载到 AgentVersion
   * @param agentVersionId AgentVersion ID
   * @param pluginId 插件 ID
   * @returns 是否已挂载且启用
   */
  isPluginAttached(agentVersionId: number, pluginId: string): boolean {
    const bindings = this.bindings.get(agentVersionId) ?? [];
    return bindings.some((b) => b.pluginId === pluginId && b.enabled);
  }

  /**
   * 获取 AgentVersion 的挂载关系
   * @param agentVersionId AgentVersion ID
   * @returns 挂载关系列表
   */
  getBindingsForAgentVersion(agentVersionId: number): AgentVersionPluginBinding[] {
    return this.bindings.get(agentVersionId) ?? [];
  }

  /**
   * 根据 Agent 类型获取默认建议挂载的插件
   * @param agentType Agent 类型
   * @returns 建议挂载的插件列表
   */
  getDefaultPluginsForAgentType(agentType: string): AgentPlugin[] {
    return this.getActivePlugins().filter((p) =>
      p.defaultAttachTargets?.includes(agentType)
    );
  }

  /**
   * 加载内置插件
   * 从内置插件目录加载所有 builtin 类型插件
   */
  async loadBuiltinPlugins(): Promise<void> {
    // 当前阶段: 内置插件通过代码直接注册
    // 后续可扩展为从文件系统或数据库加载
    console.log("[PluginRegistry] 加载内置插件...");
    // 具体加载逻辑在 bootstrap 中实现
  }

  /**
   * 获取注册表统计信息
   */
  getStats(): {
    totalPlugins: number;
    activePlugins: number;
    builtinPlugins: number;
    externalPlugins: number;
    totalBindings: number;
  } {
    const allPlugins = this.getAllPlugins();
    return {
      totalPlugins: allPlugins.length,
      activePlugins: this.getActivePlugins().length,
      builtinPlugins: allPlugins.filter((p) => p.pluginType === "builtin").length,
      externalPlugins: allPlugins.filter((p) => p.pluginType === "external").length,
      totalBindings: Array.from(this.bindings.values()).reduce(
        (sum, b) => sum + b.length,
        0
      ),
    };
  }

  /**
   * 清空注册表
   * 主要用于测试
   */
  clear(): void {
    this.plugins.clear();
    this.bindings.clear();
    console.log("[PluginRegistry] 已清空");
  }
}
