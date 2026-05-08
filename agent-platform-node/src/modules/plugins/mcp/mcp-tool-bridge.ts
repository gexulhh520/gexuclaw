import type { McpClient } from "./mcp-client.js";
import type { ToolDefinition, ToolResult } from "../../../tools/tool-types.js";
import type { McpPluginConfig } from "../adapters/mcp-plugin-adapter.js";
import {
  buildRuntimeHookErrorResult,
  isRecoverableRuntimeError,
  runBeforeToolHook,
  runRuntimeResetPolicy,
} from "./mcp-runtime-hook.js";

type McpContentItem = {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
};

export type McpToolBridgeConfig = {
  pluginId: string;
  mcpClient: McpClient;
  runtimeConfig?: McpPluginConfig;
};

/**
 * MCP 工具桥接器
 * 将 MCP 工具桥接到系统工具运行时
 */
export class McpToolBridge {
  private pluginId: string;
  private mcpClient: McpClient;
  private runtimeConfig: McpPluginConfig;

  constructor(config: McpToolBridgeConfig) {
    this.pluginId = config.pluginId;
    this.mcpClient = config.mcpClient;
    this.runtimeConfig = config.runtimeConfig ?? {};
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

    // beforeTool hook：
    // 1. 执行 bb-browser status
    // 2. 如果不健康，只执行 bb-browser daemon shutdown
    // 3. 不主动 open about:blank，后续交给 MCP tool 自己拉起 daemon
    let healthResult;
    try {
      healthResult = await runBeforeToolHook(this.pluginId, this.runtimeConfig);
      console.log(`[McpToolBridge] beforeTool hook result: state=${healthResult.state}, checked=${healthResult.checked}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[McpToolBridge] beforeTool hook 执行失败: ${this.pluginId}`, message);

      return buildRuntimeHookErrorResult(this.pluginId, originalToolName, message);
    }

    const result = await this.mcpClient.callTool(originalToolName, args);

    if (!result.success) {
      const errorMessage = result.error ?? "未知错误";

      // 工具执行时仍然遇到 daemon/CDP 错误，则 reset 一次，再重试原工具一次
      if (isRecoverableRuntimeError(errorMessage, this.runtimeConfig)) {
        console.warn(
          `[McpToolBridge] MCP 工具遇到可恢复 runtime 错误，准备 reset 后重试一次: ${errorMessage}`
        );

        try {
          await runRuntimeResetPolicy(this.pluginId, this.runtimeConfig);

          const retryResult = await this.mcpClient.callTool(originalToolName, args);

          if (retryResult.success) {
            return this.normalizeMcpSuccessResult(originalToolName, args, retryResult.result);
          }

          return {
            success: false,
            operation: {
              type: "analyze",
              target: originalToolName,
            },
            error: {
              code: "MCP_TOOL_ERROR_AFTER_RUNTIME_RESET",
              message: retryResult.error ?? errorMessage,
              retryable: true,
              category: "runtime",
            },
            outputRefs: [],
          };
        } catch (resetError) {
          const resetMessage = resetError instanceof Error ? resetError.message : String(resetError);

          return {
            success: false,
            operation: {
              type: "analyze",
              target: originalToolName,
            },
            error: {
              code: "MCP_RUNTIME_RESET_FAILED",
              message: resetMessage,
              retryable: true,
              category: "runtime",
            },
            outputRefs: [],
          };
        }
      }

      return {
        success: false,
        operation: {
          type: "analyze",
          target: originalToolName,
        },
        error: {
          code: "MCP_TOOL_ERROR",
          message: errorMessage,
        },
        outputRefs: [],
      };
    }

    return this.normalizeMcpSuccessResult(originalToolName, args, result.result);
  }

  private normalizeMcpSuccessResult(
    originalToolName: string,
    args: Record<string, unknown>,
    rawResult: unknown
  ): ToolResult {
    const mcpResult = rawResult as {
      content?: McpContentItem[];
      isError?: boolean;
    };

    const content = Array.isArray(mcpResult?.content) ? mcpResult.content : [];

    const textContent = content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .filter(Boolean)
      .join("\n");

    const imageItems = content
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.type === "image" && typeof item.data === "string");

    const imageRefs = imageItems.map(({ item, index }) => {
      const mimeType = item.mimeType || "image/png";
      return {
        refId: `${originalToolName}:image:${index + 1}`,
        mimeType,
        contentIndex: index,
        sizeChars: item.data?.length ?? 0,
        canHydrateToVisionMessage: true,
      };
    });

    const success = !mcpResult?.isError;

    return {
      success,
      operation: {
        type: inferOperationType(originalToolName),
        target: inferOperationTarget(originalToolName, args),
        targetKind: inferTargetKind(originalToolName, args),
      },
      verification: {
        required: false,
        status: success ? "not_applicable" : "failed",
        method: "mcp_tool_result",
        evidence: {
          textContent,
          imageCount: imageRefs.length,
        },
      },
      data: {
        textContent,
        imageCount: imageRefs.length,
        images: imageRefs,
        resultSummary:
          imageRefs.length > 0
            ? `工具返回了 ${imageRefs.length} 张图片，图片已保存为 artifact，可用于视觉模型分析。`
            : textContent,
      },
      artifactCandidates: imageItems.map(({ item, index }) => {
        const mimeType = item.mimeType || "image/png";

        return {
          kind: "image" as const,
          title: `MCP 图片结果 - ${originalToolName} #${index + 1}`,
          mimeType,
          contentJson: {
            encoding: "base64",
            data: item.data!,
            mimeType,
          },
          metadata: {
            source: "mcp",
            toolName: originalToolName,
            contentIndex: index,
            sizeChars: item.data!.length,
          },
          defaultRole: "intermediate" as const,
        };
      }),
      outputRefs: [
        ...buildOutputRefs(originalToolName, args, mcpResult),
        ...imageRefs.map((image) => ({
          refId: image.refId,
          role: "result" as const,
        })),
      ],
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

function inferOperationType(toolName: string): "read" | "write" | "edit" | "append" | "delete" | "list" | "search" | "analyze" | "generate" | "verify" {
  const name = toolName.toLowerCase();

  if (name.includes("read") || name.includes("get") || name.includes("snapshot")) return "read";
  if (name.includes("open") || name.includes("create") || name.includes("new")) return "write";
  if (name.includes("write") || name.includes("fill") || name.includes("type")) return "write";
  if (name.includes("edit") || name.includes("update")) return "edit";
  if (name.includes("delete") || name.includes("remove") || name.includes("close")) return "delete";
  if (name.includes("list")) return "list";
  if (name.includes("search")) return "search";
  if (name.includes("verify") || name.includes("check")) return "verify";

  return "analyze";
}

function inferOperationTarget(toolName: string, args: Record<string, unknown>): string {
  const candidates = [
    args.url,
    args.uri,
    args.path,
    args.filePath,
    args.target,
    args.query,
    args.name,
  ];

  for (const item of candidates) {
    if (typeof item === "string" && item.trim()) {
      return item;
    }
  }

  return toolName;
}

function inferTargetKind(
  toolName: string,
  args: Record<string, unknown>
): "file" | "artifact" | "url" | "db_record" | "external_resource" | undefined {
  const url = args.url || args.uri;

  if (typeof url === "string" && /^https?:\/\//i.test(url)) {
    return "url";
  }

  if (typeof args.path === "string" || typeof args.filePath === "string") {
    return "file";
  }

  return "external_resource";
}

function buildOutputRefs(
  toolName: string,
  args: Record<string, unknown>,
  mcpResult: unknown
) {
  const target = inferOperationTarget(toolName, args);

  if (!target || target === toolName) {
    return [];
  }

  return [
    {
      uri: target,
      role: "result" as const,
    },
  ];
}
