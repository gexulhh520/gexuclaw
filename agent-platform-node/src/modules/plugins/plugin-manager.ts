import { jsonStringify } from "../../shared/json.js";
import { nowIso } from "../../shared/time.js";
import { buildAgentPluginFromManifest } from "./adapters/manifest-plugin-adapter.js";
import { McpPluginAdapter } from "./adapters/mcp-plugin-adapter.js";
import { builtinPlugins } from "./builtin-plugins.js";
import {
  disablePlugin as repoDisablePlugin,
  enablePlugin as repoEnablePlugin,
  getPluginById,
  listEnabledPlugins,
  type PluginRecord,
  upsertPlugin,
} from "./plugin.repository.js";
import type { PluginRegistry } from "./plugin-registry.js";

/**
 * 插件生命周期管理器
 * 负责插件的同步、加载、启用/禁用等生命周期管理
 */
export class PluginManager {
  private mcpAdapters: Map<string, McpPluginAdapter> = new Map();

  constructor(private registry: PluginRegistry) {}

  /**
   * 启动时初始化
   * 1. 同步 builtin 插件到 DB
   * 2. 从 DB 读取 enabled 的插件
   * 3. 按 providerType 构建 AgentPlugin
   * 4. 注册到 PluginRegistry
   */
  async bootstrap(): Promise<void> {
    console.log("[PluginManager] 开始初始化...");

    await this.syncBuiltinPluginsToDb();
    await this.loadEnabledPluginsToRegistry();

    const stats = this.registry.getStats();
    console.log(`[PluginManager] 初始化完成: ${stats.activePlugins} 个激活插件`);
    console.log(`[PluginManager] 插件列表: ${this.registry.getActivePlugins().map((p) => p.pluginId).join(", ")}`);
  }

  /**
   * 同步 builtin 插件到数据库
   * 如果已存在则更新，不存在则创建
   */
  async syncBuiltinPluginsToDb(): Promise<void> {
    console.log("[PluginManager] 同步 builtin 插件到数据库...");

    for (const builtin of builtinPlugins) {
      const manifestJson = JSON.stringify({
        tools: builtin.tools,
        resources: builtin.resources,
        prompts: builtin.prompts,
        catalog: builtin.catalog,
        skillText: builtin.skillText,
        contextPolicyPatch: builtin.contextPolicyPatch,
        runtimeRequirements: builtin.runtimeRequirements,
      });

      await upsertPlugin({
        pluginId: builtin.pluginId,
        name: builtin.name,
        description: builtin.description ?? "",
        pluginType: builtin.pluginType,
        providerType: "builtin_code",
        version: "1",
        manifestJson: JSON.parse(manifestJson),
        configJson: {},
        installed: true,
        enabled: builtin.status === "active",
        status: builtin.status === "active" ? "active" : "registered",
      });

      console.log(`[PluginManager] 同步 builtin 插件: ${builtin.pluginId}`);
    }

    console.log("[PluginManager] builtin 插件同步完成");
  }

  /**
   * 从数据库加载已启用的插件到注册表
   */
  async loadEnabledPluginsToRegistry(): Promise<void> {
    console.log("[PluginManager] 从数据库加载已启用插件...");

    const enabledPlugins = await listEnabledPlugins();

    for (const record of enabledPlugins) {
      try {
        const agentPlugin = await this.buildAgentPluginFromRecord(record);
        if (agentPlugin) {
          this.registry.registerPlugin(agentPlugin);
          console.log(`[PluginManager] 加载插件: ${record.pluginId} (${record.providerType})`);
        }
      } catch (error) {
        console.error(`[PluginManager] 加载插件 ${record.pluginId} 失败:`, error);
        await repoDisablePlugin(record.pluginId);
      }
    }

    console.log("[PluginManager] 插件加载完成");
  }

  /**
   * 启用插件
   */
  async enablePlugin(pluginId: string): Promise<void> {
    const record = await getPluginById(pluginId);
    if (!record) throw new Error(`插件不存在: ${pluginId}`);

    await repoEnablePlugin(pluginId);

    // 重新加载到注册表
    const agentPlugin = await this.buildAgentPluginFromRecord(record);
    if (agentPlugin) {
      this.registry.registerPlugin(agentPlugin);
    }

    console.log(`[PluginManager] 启用插件: ${pluginId}`);
  }

  /**
   * 禁用插件
   */
  async disablePlugin(pluginId: string): Promise<void> {
    await repoDisablePlugin(pluginId);
    this.registry.unregisterPlugin(pluginId);

    // 释放 MCP 适配器
    const mcpAdapter = this.mcpAdapters.get(pluginId);
    if (mcpAdapter) {
      await mcpAdapter.dispose();
      this.mcpAdapters.delete(pluginId);
    }

    console.log(`[PluginManager] 禁用插件: ${pluginId}`);
  }

  /**
   * 重新加载插件
   */
  async reloadPlugin(pluginId: string): Promise<void> {
    console.log(`[PluginManager] 重新加载插件: ${pluginId}`);

    // 先注销
    this.registry.unregisterPlugin(pluginId);

    const mcpAdapter = this.mcpAdapters.get(pluginId);
    if (mcpAdapter) {
      await mcpAdapter.dispose();
      this.mcpAdapters.delete(pluginId);
    }

    // 重新加载
    const record = await getPluginById(pluginId);
    if (!record) throw new Error(`插件不存在: ${pluginId}`);

    if (record.enabled) {
      const agentPlugin = await this.buildAgentPluginFromRecord(record);
      if (agentPlugin) {
        this.registry.registerPlugin(agentPlugin);
      }
    }

    console.log(`[PluginManager] 插件重新加载完成: ${pluginId}`);
  }

  /**
   * 获取插件目录
   */
  async getCatalog(): Promise<Array<{
    pluginId: string;
    pluginName: string;
    description?: string;
    pluginType: string;
    providerType: string;
    status: string;
    enabled: boolean;
    toolCount: number;
    resourceCount: number;
    promptCount: number;
  }>> {
    const allPlugins = this.registry.getAllPlugins();

    return allPlugins.map((p) => ({
      pluginId: p.pluginId,
      pluginName: p.name,
      description: p.description,
      pluginType: p.pluginType,
      providerType: p.providerType ?? "unknown",
      status: p.status,
      enabled: p.status === "active",
      toolCount: p.tools?.length ?? 0,
      resourceCount: p.resources?.length ?? 0,
      promptCount: p.prompts?.length ?? 0,
    }));
  }

  /**
   * 根据数据库记录构建 AgentPlugin
   */
  private async buildAgentPluginFromRecord(record: PluginRecord) {
    switch (record.providerType) {
      case "builtin_code": {
        // 从代码中查找对应的 builtin 插件
        const builtin = builtinPlugins.find((p) => p.pluginId === record.pluginId);
        if (builtin) {
          return { ...builtin, status: record.enabled ? "active" as const : "disabled" as const };
        }
        console.warn(`[PluginManager] 未找到 builtin 插件代码: ${record.pluginId}`);
        return null;
      }

      case "manifest": {
        return buildAgentPluginFromManifest(
          record.pluginId,
          record.name,
          record.description,
          record.manifestJson
        );
      }

      case "mcp": {
        // MCP 插件：实际拉起 MCP 服务器
        const adapter = new McpPluginAdapter(record.pluginId);
        const loadResult = adapter.loadConfig(record.configJson);

        if (!loadResult.success || !loadResult.config) {
          console.warn(`[PluginManager] MCP 插件 ${record.pluginId} 配置加载失败: ${loadResult.error}`);
          return null;
        }

        this.mcpAdapters.set(record.pluginId, adapter);

        // 初始化 MCP 连接
        const initResult = await adapter.initialize(loadResult.config);

        if (!initResult.success || !initResult.agentPlugin) {
          console.error(`[PluginManager] MCP 插件 ${record.pluginId} 初始化失败: ${initResult.error}`);
          return null;
        }

        console.log(`[PluginManager] MCP 插件 ${record.pluginId} 初始化成功`);
        return initResult.agentPlugin;
      }

      default:
        console.warn(`[PluginManager] 未知的 providerType: ${record.providerType}`);
        return null;
    }
  }
}
