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
  | "output"
  | "pending_write";

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

export type ToolError = {
  code: string;
  message: string;
  retryable?: boolean;
  category?:
    | "validation"
    | "permission"
    | "not_found"
    | "conflict"
    | "runtime"
    | "external"
    | "unknown";
};

export type ToolOperation = {
  type:
    | "read"
    | "write"
    | "edit"
    | "append"
    | "delete"
    | "list"
    | "search"
    | "analyze"
    | "generate"
    | "verify";
  target?: string;
  targetKind?: "file" | "artifact" | "url" | "db_record" | "external_resource";
};

export type ToolSideEffect = {
  type:
    | "file_write"
    | "file_edit"
    | "file_append"
    | "file_delete"
    | "artifact_create"
    | "external_call";
  target: string;
  status: "created" | "modified" | "deleted" | "attempted" | "none";
};

export type ToolVerification = {
  required: boolean;
  status: "verified" | "unverified" | "failed" | "not_applicable";
  method?: string;
  evidence?: unknown;
};

export type ToolRef = {
  refId?: string;
  artifactUid?: string;
  uri?: string;
  role?: "input" | "source" | "target" | "content" | "result" | "created" | "modified" | "pending_write";
};

export type ToolResult = {
  success: boolean;
  data?: unknown;
  error?: string | ToolError;
  meta?: Record<string, unknown>;
  artifactCandidates?: ToolArtifactCandidate[];

  operation?: ToolOperation;
  sideEffects?: ToolSideEffect[];
  verification?: ToolVerification;
  inputRefs?: ToolRef[];
  outputRefs?: ToolRef[];
};

export type ToolHandler = (input: unknown) => Promise<ToolResult>;

export type RegisteredTool = InternalToolDefinition & {
  handler: ToolHandler;
};
