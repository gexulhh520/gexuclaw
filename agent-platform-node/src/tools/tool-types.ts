/**
 * OpenAI 标准格式的工具定义
 * 用于发送给 LLM
 */
export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

/**
 * 内部工具定义格式（用于注册）
 */
export type InternalToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ArtifactType =
  | "text"
  | "structured_data"
  | "page"
  | "image"
  | "link"
  | "file"
  | "collection";

export type ArtifactRole =
  | "input"
  | "reference"
  | "intermediate"
  | "draft"
  | "final"
  | "output";

export type ToolArtifactCandidate = {
  candidateId?: string;
  kind: ArtifactType;
  title?: string;
  contentText?: string;
  contentJson?: Record<string, unknown> | unknown[];
  uri?: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
  defaultRole?: ArtifactRole;
};

export type ToolResult = {
  success: boolean;
  data?: unknown;
  error?: string;
  meta?: Record<string, unknown>;
  artifactCandidates?: ToolArtifactCandidate[];
};

export type ToolHandler = (input: unknown) => Promise<ToolResult>;

export type RegisteredTool = InternalToolDefinition & {
  handler: ToolHandler;
};
