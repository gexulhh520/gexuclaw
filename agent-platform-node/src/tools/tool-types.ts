export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ToolResult = {
  success: boolean;
  data?: unknown;
  error?: string;
  meta?: Record<string, unknown>;
};

export type ToolHandler = (input: unknown) => Promise<ToolResult>;

export type RegisteredTool = ToolDefinition & {
  handler: ToolHandler;
};
