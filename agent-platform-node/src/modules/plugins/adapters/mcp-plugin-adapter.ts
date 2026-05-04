import { jsonParse } from "../../../shared/json.js";

/**
 * MCP 插件配置结构
 */
export const mcpPluginConfigSchema = {
  serverUrl: "string",
  transport: "stdio | sse | http",
  command: "string (optional)",
  args: "string[] (optional)",
  env: "Record<string, string> (optional)",
  timeout: "number (optional)",
} as const;

export type McpPluginConfig = {
  serverUrl?: string;
  transport?: "stdio" | "sse" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  timeout?: number;
};

/**
 * 校验 MCP 插件配置
 * @param configJson config_json 字段的字符串值
 * @returns 校验结果
 */
export function validateMcpConfig(configJson: string): {
  valid: boolean;
  config?: McpPluginConfig;
  error?: string;
} {
  try {
    const parsed = jsonParse<McpPluginConfig>(configJson, {});

    // 基础校验：至少要有 serverUrl 或 command
    if (!parsed.serverUrl && !parsed.command) {
      return {
        valid: false,
        error: "MCP 配置必须包含 serverUrl 或 command 字段",
      };
    }

    // 校验 transport 值
    if (parsed.transport && !["stdio", "sse", "http"].includes(parsed.transport)) {
      return {
        valid: false,
        error: `不支持的 transport 类型: ${parsed.transport}，可选值: stdio, sse, http`,
      };
    }

    // 校验 timeout
    if (parsed.timeout !== undefined && (typeof parsed.timeout !== "number" || parsed.timeout < 0)) {
      return {
        valid: false,
        error: "timeout 必须是正整数",
      };
    }

    return { valid: true, config: parsed };
  } catch (error) {
    return {
      valid: false,
      error: `MCP 配置解析失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * MCP 插件适配器
 * 当前阶段只做配置管理和校验，不实际拉起 MCP 服务
 */
export class McpPluginAdapter {
  private config?: McpPluginConfig;

  constructor(private pluginId: string) {}

  /**
   * 加载配置
   * @param configJson config_json 字段的字符串值
   */
  loadConfig(configJson: string): { success: boolean; error?: string } {
    const result = validateMcpConfig(configJson);
    if (!result.valid) {
      return { success: false, error: result.error };
    }
    this.config = result.config;
    return { success: true };
  }

  /**
   * 获取当前配置
   */
  getConfig(): McpPluginConfig | undefined {
    return this.config;
  }

  /**
   * 检查是否已配置
   */
  isConfigured(): boolean {
    return this.config !== undefined;
  }

  /**
   * 未来：初始化 MCP 客户端连接
   * 当前阶段返回 stub
   */
  async initialize(): Promise<{ success: boolean; error?: string }> {
    if (!this.config) {
      return { success: false, error: "MCP 配置未加载" };
    }

    console.log(`[McpAdapter] 插件 ${this.pluginId} 的 MCP 连接尚未实现，配置已校验通过`);
    console.log(`[McpAdapter] 配置: ${JSON.stringify(this.config)}`);

    // TODO: 实现实际的 MCP 客户端初始化
    return { success: true };
  }

  /**
   * 未来：关闭 MCP 连接
   */
  async dispose(): Promise<void> {
    console.log(`[McpAdapter] 插件 ${this.pluginId} 的 MCP 连接释放（stub）`);
    // TODO: 实现实际的 MCP 连接释放
  }
}
