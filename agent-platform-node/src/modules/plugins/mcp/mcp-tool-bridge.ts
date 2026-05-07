import type { McpClient } from "./mcp-client.js";
import type { ToolDefinition, ToolResult } from "../../../tools/tool-types.js";

export type McpToolBridgeConfig = {
  pluginId: string;
  mcpClient: McpClient;
};

/**
 * MCP 工具桥接器
 * 将 MCP 工具桥接到系统工具运行时
 */
export class McpToolBridge {
  private pluginId: string;
  private mcpClient: McpClient;

  constructor(config: McpToolBridgeConfig) {
    this.pluginId = config.pluginId;
    this.mcpClient = config.mcpClient;
  }

  /**
   * 获取工具定义列表
   */
  getToolDefinitions(): ToolDefinition[] {
    return this.mcpClient.toToolDefinitions(this.pluginId);
  }

  /**
   * 执行工具
   */
  async executeTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    // 提取原始工具名（去掉 pluginId 前缀）
    const prefix = `${this.pluginId}__`;
    const originalToolName = toolName.startsWith(prefix)
      ? toolName.slice(prefix.length)
      : toolName;

    console.log(`[McpToolBridge] 执行工具: ${originalToolName} (原始: ${toolName})`);

    const result = await this.mcpClient.callTool(originalToolName, args);

    if (!result.success) {
      return {
        success: false,
        operation: {
          type: "analyze",
          target: originalToolName,
        },
        error: {
          code: "MCP_TOOL_ERROR",
          message: result.error ?? "未知错误",
        },
        outputRefs: [],
      };
    }

    // 解析 MCP 工具返回结果
    const mcpResult = result.result as {
      content?: Array<{
        type: string;
        text?: string;
        data?: unknown;
      }>;
      isError?: boolean;
    };

    const textContent = mcpResult?.content
      ?.filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n") ?? "";

    return {
      success: !mcpResult?.isError,
      operation: {
        type: "analyze",
        target: originalToolName,
      },
      data: {
        result: mcpResult,
        textContent,
      },
      outputRefs: [],
    };
  }

  /**
   * 检查是否可以处理该工具
   */
  canHandle(toolName: string): boolean {
    return toolName.startsWith(`${this.pluginId}__`);
  }
}

/**
 * MCP 工具桥接器注册表
 */
export class McpToolBridgeRegistry {
  private bridges: Map<string, McpToolBridge> = new Map();

  /**
   * 注册桥接器
   */
  registerBridge(pluginId: string, bridge: McpToolBridge): void {
    this.bridges.set(pluginId, bridge);
    console.log(`[McpToolBridgeRegistry] 注册桥接器: ${pluginId}`);
  }

  /**
   * 注销桥接器
   */
  unregisterBridge(pluginId: string): void {
    this.bridges.delete(pluginId);
    console.log(`[McpToolBridgeRegistry] 注销桥接器: ${pluginId}`);
  }

  /**
   * 获取所有工具定义
   */
  getAllToolDefinitions(): ToolDefinition[] {
    const allTools: ToolDefinition[] = [];
    for (const bridge of this.bridges.values()) {
      allTools.push(...bridge.getToolDefinitions());
    }
    return allTools;
  }

  /**
   * 查找可以处理指定工具的桥接器
   */
  findBridgeForTool(toolName: string): McpToolBridge | undefined {
    for (const [pluginId, bridge] of this.bridges) {
      if (bridge.canHandle(toolName)) {
        return bridge;
      }
    }
    return undefined;
  }

  /**
   * 执行工具
   */
  async executeTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<ToolResult | null> {
    const bridge = this.findBridgeForTool(toolName);
    if (!bridge) {
      return null;
    }
    return bridge.executeTool(toolName, args);
  }

  /**
   * 获取所有已注册的 pluginId
   */
  getRegisteredPluginIds(): string[] {
    return Array.from(this.bridges.keys());
  }
}
