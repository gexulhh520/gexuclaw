import { jsonParse } from "../../../shared/json.js";
import { McpClient, McpToolBridge, McpToolBridgeRegistry } from "../mcp/index.js";
import type { AgentPlugin, PluginToolDefinition, PluginResourceDefinition, PluginPromptDefinition } from "../plugin.schema.js";

/**
 * MCP 插件配置结构
 */
export type McpPluginConfig = {
  mcpServers?: Record<string, {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }>;
  // 兼容旧格式
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  transport?: "stdio" | "sse" | "http";
  serverUrl?: string;
  timeout?: number;
};

/**
 * MCP 插件运行时
 */
export class McpPluginRuntime {
  private client: McpClient | null = null;
  private toolBridge: McpToolBridge | null = null;
  private connected = false;

  constructor(
    private readonly pluginId: string,
    private readonly config: McpPluginConfig
  ) {}

  /**
   * 启动 MCP 连接
   */
  async start(): Promise<{ success: boolean; error?: string; agentPlugin?: AgentPlugin }> {
    try {
      // 解析配置
      const serverConfig = this.resolveServerConfig();
      if (!serverConfig) {
        return { success: false, error: "无法解析 MCP 服务器配置" };
      }

      console.log(`[McpPluginRuntime] 启动 MCP 插件: ${this.pluginId}`);
      console.log(`[McpPluginRuntime] 命令: ${serverConfig.command} ${serverConfig.args?.join(" ") ?? ""}`);

      // 创建客户端并连接
      this.client = new McpClient(this.pluginId, serverConfig);
      const connectResult = await this.client.connect();

      if (!connectResult.success) {
        return { success: false, error: connectResult.error };
      }

      this.connected = true;

      // 创建工具桥接器
      this.toolBridge = new McpToolBridge({
        pluginId: this.pluginId,
        mcpClient: this.client,
      });

      // 注册到全局桥接器注册表
      McpPluginAdapter.registerToolBridge(this.pluginId, this.toolBridge);

      // 构建 AgentPlugin
      const agentPlugin = this.buildAgentPlugin();

      console.log(`[McpPluginRuntime] MCP 插件启动成功: ${this.pluginId}`);
      console.log(`[McpPluginRuntime] 工具数: ${agentPlugin.tools?.length ?? 0}`);
      console.log(`[McpPluginRuntime] 资源数: ${agentPlugin.resources?.length ?? 0}`);
      console.log(`[McpPluginRuntime] Prompts数: ${agentPlugin.prompts?.length ?? 0}`);

      return { success: true, agentPlugin };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[McpPluginRuntime] 启动失败: ${this.pluginId}`, errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * 解析服务器配置
   */
  private resolveServerConfig(): { command: string; args?: string[]; env?: Record<string, string> } | null {
    // 优先使用 mcpServers 格式
    if (this.config.mcpServers) {
      const serverConfig = this.config.mcpServers[this.pluginId] || Object.values(this.config.mcpServers)[0];
      if (serverConfig) {
        return {
          command: serverConfig.command,
          args: serverConfig.args,
          env: serverConfig.env,
        };
      }
    }

    // 兼容旧格式
    if (this.config.command) {
      return {
        command: this.config.command,
        args: this.config.args,
        env: this.config.env,
      };
    }

    return null;
  }

  /**
   * 构建 AgentPlugin
   */
  private buildAgentPlugin(): AgentPlugin {
    if (!this.client || !this.toolBridge) {
      throw new Error("MCP 客户端未初始化");
    }

    const tools: PluginToolDefinition[] = this.client.getTools().map((tool) => ({
      toolId: tool.name,
      name: tool.name,
      description: tool.description ?? `${tool.name} tool`,
      inputSchema: tool.inputSchema,
    }));

    const resources: PluginResourceDefinition[] = this.client.getResources().map((resource) => ({
      resourceId: resource.uri,
      title: resource.name,
      description: resource.description,
      contentType: this.inferContentType(resource.mimeType),
      content: "", // 内容需要动态读取
    }));

    const prompts: PluginPromptDefinition[] = this.client.getPrompts().map((prompt) => ({
      promptId: prompt.name,
      title: prompt.name,
      description: prompt.description,
      content: "", // 内容需要动态获取
    }));

    return {
      pluginId: this.pluginId,
      pluginType: "external",
      name: this.pluginId,
      description: `MCP 插件: ${this.pluginId}`,
      providerType: "mcp",
      status: "active",
      tools,
      resources,
      prompts,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * 推断内容类型
   */
  private inferContentType(mimeType?: string): "text" | "json" | "html" | "markdown" {
    if (!mimeType) return "text";
    if (mimeType.includes("json")) return "json";
    if (mimeType.includes("html")) return "html";
    if (mimeType.includes("markdown")) return "markdown";
    return "text";
  }

  /**
   * 停止 MCP 连接
   */
  async stop(): Promise<void> {
    console.log(`[McpPluginRuntime] 停止 MCP 插件: ${this.pluginId}`);

    // 从注册表移除
    McpPluginAdapter.unregisterToolBridge(this.pluginId);

    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }

    this.toolBridge = null;
    this.connected = false;

    console.log(`[McpPluginRuntime] MCP 插件已停止: ${this.pluginId}`);
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * 获取工具桥接器
   */
  getToolBridge(): McpToolBridge | null {
    return this.toolBridge;
  }
}

/**
 * MCP 插件适配器
 * 管理 MCP 插件的生命周期
 */
export class McpPluginAdapter {
  private static toolBridgeRegistry = new McpToolBridgeRegistry();
  private runtimes: Map<string, McpPluginRuntime> = new Map();

  constructor(private pluginId: string) {}

  /**
   * 注册工具桥接器到全局注册表
   */
  static registerToolBridge(pluginId: string, bridge: McpToolBridge): void {
    McpPluginAdapter.toolBridgeRegistry.registerBridge(pluginId, bridge);
  }

  /**
   * 从全局注册表注销工具桥接器
   */
  static unregisterToolBridge(pluginId: string): void {
    McpPluginAdapter.toolBridgeRegistry.unregisterBridge(pluginId);
  }

  /**
   * 获取全局工具桥接器注册表
   */
  static getToolBridgeRegistry(): McpToolBridgeRegistry {
    return McpPluginAdapter.toolBridgeRegistry;
  }

  /**
   * 加载配置
   */
  loadConfig(configJson: string): { success: boolean; config?: McpPluginConfig; error?: string } {
    try {
      const parsed = jsonParse<McpPluginConfig>(configJson, {});

      // 校验配置
      if (!parsed.mcpServers && !parsed.command) {
        return {
          success: false,
          error: "MCP 配置必须包含 mcpServers 或 command 字段",
        };
      }

      return { success: true, config: parsed };
    } catch (error) {
      return {
        success: false,
        error: `MCP 配置解析失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * 初始化 MCP 插件
   */
  async initialize(config: McpPluginConfig): Promise<{ success: boolean; agentPlugin?: AgentPlugin; error?: string }> {
    // 如果已存在，先停止
    const existingRuntime = this.runtimes.get(this.pluginId);
    if (existingRuntime) {
      await existingRuntime.stop();
      this.runtimes.delete(this.pluginId);
    }

    // 创建新运行时
    const runtime = new McpPluginRuntime(this.pluginId, config);
    const result = await runtime.start();

    if (result.success && result.agentPlugin) {
      this.runtimes.set(this.pluginId, runtime);
    }

    return result;
  }

  /**
   * 释放 MCP 插件
   */
  async dispose(): Promise<void> {
    const runtime = this.runtimes.get(this.pluginId);
    if (runtime) {
      await runtime.stop();
      this.runtimes.delete(this.pluginId);
    }
  }

  /**
   * 获取运行时
   */
  getRuntime(): McpPluginRuntime | undefined {
    return this.runtimes.get(this.pluginId);
  }
}
