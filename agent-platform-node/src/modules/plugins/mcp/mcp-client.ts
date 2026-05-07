import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ToolDefinition } from "../../../tools/tool-types.js";

export type McpServerConfig = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type McpTool = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

export type McpResource = {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
};

export type McpPrompt = {
  name: string;
  description?: string;
};

export class McpClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private tools: McpTool[] = [];
  private resources: McpResource[] = [];
  private prompts: McpPrompt[] = [];
  private connected = false;

  constructor(
    private readonly serverName: string,
    private readonly config: McpServerConfig
  ) {}

  /**
   * 连接到 MCP 服务器
   */
  async connect(): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`[McpClient] 连接到 MCP 服务器: ${this.serverName}`);
      console.log(`[McpClient] 命令: ${this.config.command} ${this.config.args?.join(" ") ?? ""}`);

      this.transport = new StdioClientTransport({
        command: this.config.command,
        args: this.config.args ?? [],
        env: { ...process.env, ...this.config.env } as Record<string, string>,
      });

      this.client = new Client(
        {
          name: "agent-platform-client",
          version: "1.0.0",
        },
        {
          capabilities: {},
        }
      );

      await this.client.connect(this.transport);
      this.connected = true;

      console.log(`[McpClient] 连接成功: ${this.serverName}`);

      // 发现能力
      await this.discoverCapabilities();

      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[McpClient] 连接失败: ${this.serverName}`, errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * 发现服务器能力
   */
  private async discoverCapabilities(): Promise<void> {
    if (!this.client) return;

    try {
      // 发现工具
      const toolsResult = await this.client.listTools();
      this.tools = toolsResult.tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown>,
      }));
      console.log(`[McpClient] 发现 ${this.tools.length} 个工具:`, this.tools.map((t) => t.name));

      // 发现资源
      try {
        const resourcesResult = await this.client.listResources();
        this.resources = resourcesResult.resources.map((r) => ({
          uri: r.uri,
          name: r.name,
          description: r.description,
          mimeType: r.mimeType,
        }));
        console.log(`[McpClient] 发现 ${this.resources.length} 个资源`);
      } catch {
        console.log(`[McpClient] 服务器不支持资源`);
      }

      // 发现 prompts
      try {
        const promptsResult = await this.client.listPrompts();
        this.prompts = promptsResult.prompts.map((p) => ({
          name: p.name,
          description: p.description,
        }));
        console.log(`[McpClient] 发现 ${this.prompts.length} 个 prompts`);
      } catch {
        console.log(`[McpClient] 服务器不支持 prompts`);
      }
    } catch (error) {
      console.error(`[McpClient] 发现能力失败:`, error);
    }
  }

  /**
   * 调用工具
   */
  async callTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{
    success: boolean;
    result?: unknown;
    error?: string;
  }> {
    if (!this.client || !this.connected) {
      return { success: false, error: "MCP 客户端未连接" };
    }

    try {
      console.log(`[McpClient] 调用工具: ${toolName}`, args);
      const result = await this.client.callTool({
        name: toolName,
        arguments: args,
      });
      console.log(`[McpClient] 工具调用成功: ${toolName}`);
      return { success: true, result };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[McpClient] 工具调用失败: ${toolName}`, errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * 读取资源
   */
  async readResource(uri: string): Promise<{
    success: boolean;
    content?: string;
    error?: string;
  }> {
    if (!this.client || !this.connected) {
      return { success: false, error: "MCP 客户端未连接" };
    }

    try {
      const result = await this.client.readResource({ uri });
      return { success: true, content: JSON.stringify(result) };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * 获取工具列表
   */
  getTools(): McpTool[] {
    return this.tools;
  }

  /**
   * 获取资源列表
   */
  getResources(): McpResource[] {
    return this.resources;
  }

  /**
   * 获取 prompts 列表
   */
  getPrompts(): McpPrompt[] {
    return this.prompts;
  }

  /**
   * 转换为系统工具定义格式
   */
  toToolDefinitions(pluginId: string): ToolDefinition[] {
    return this.tools.map((tool) => ({
      type: "function",
      function: {
        name: `${pluginId}__${tool.name}`,
        description: tool.description ?? `${tool.name} tool`,
        parameters: tool.inputSchema,
      },
    }));
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }
    this.client = null;
    this.connected = false;
    console.log(`[McpClient] 断开连接: ${this.serverName}`);
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.connected;
  }
}
