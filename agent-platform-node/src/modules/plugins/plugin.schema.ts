import { z } from "zod";

// 插件类型
export const PluginTypeEnum = z.enum(["builtin", "external"]);
export type PluginType = z.infer<typeof PluginTypeEnum>;

// 插件状态
export const PluginStatusEnum = z.enum(["active", "disabled"]);
export type PluginStatus = z.infer<typeof PluginStatusEnum>;

// 插件工具定义
export const pluginToolDefinitionSchema = z.object({
  toolId: z.string(),
  name: z.string(),
  description: z.string(),
  inputSchema: z.record(z.any()), // JSON Schema
  outputAdapter: z.string().optional(), // 输出适配器标识
});

export type PluginToolDefinition = z.infer<typeof pluginToolDefinitionSchema>;

// 插件资源定义
export const pluginResourceDefinitionSchema = z.object({
  resourceId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  contentType: z.enum(["text", "json", "html", "markdown"]),
  content: z.string(), // 资源正文
});

export type PluginResourceDefinition = z.infer<typeof pluginResourceDefinitionSchema>;

// 插件 Prompt 定义
export const pluginPromptDefinitionSchema = z.object({
  promptId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  content: z.string(), // Prompt 正文
  usageHint: z.string().optional(), // 使用场景提示
});

export type PluginPromptDefinition = z.infer<typeof pluginPromptDefinitionSchema>;

// 插件目录条目
export const pluginCatalogItemSchema = z.object({
  itemId: z.string(),
  itemType: z.enum(["prompt", "resource", "tool"]),
  title: z.string(),
  description: z.string().optional(),
});

export type PluginCatalogItem = z.infer<typeof pluginCatalogItemSchema>;

// 插件目录摘要
export const pluginCatalogSummarySchema = z.object({
  pluginId: z.string(),
  pluginName: z.string(),
  description: z.string().optional(),
  items: z.array(pluginCatalogItemSchema),
});

export type PluginCatalogSummary = z.infer<typeof pluginCatalogSummarySchema>;

// 运行时要求
export const pluginRuntimeRequirementsSchema = z.object({
  requiresDaemon: z.boolean().optional(),
  requiresBrowserExtension: z.boolean().optional(),
  requiresDesktopEnv: z.boolean().optional(),
});

export type PluginRuntimeRequirements = z.infer<typeof pluginRuntimeRequirementsSchema>;

// 主插件对象
export const agentPluginSchema = z.object({
  pluginId: z.string(),
  pluginType: PluginTypeEnum,
  name: z.string(),
  description: z.string().optional(),

  // 能力定义
  tools: z.array(pluginToolDefinitionSchema).optional(),
  resources: z.array(pluginResourceDefinitionSchema).optional(),
  prompts: z.array(pluginPromptDefinitionSchema).optional(),

  // 目录摘要（运行时生成或预定义）
  catalog: pluginCatalogSummarySchema.optional(),

  // 扩展配置
  skillText: z.string().optional(), // 插件级 skill 补充
  contextPolicyPatch: z.record(z.any()).optional(),

  // 运行时要求
  providerType: z.enum(["playwright", "bb-browser", "opencli", "custom"]).optional(),
  runtimeRequirements: pluginRuntimeRequirementsSchema.optional(),

  // 默认挂载目标
  defaultAttachTargets: z.array(z.string()).optional(), // Agent 类型列表

  status: PluginStatusEnum,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type AgentPlugin = z.infer<typeof agentPluginSchema>;

// AgentVersion 与插件的挂载关系
export const agentVersionPluginBindingSchema = z.object({
  bindingId: z.string(),
  agentVersionId: z.number(),
  pluginId: z.string(),
  enabled: z.boolean(),
  priority: z.number().optional(), // 加载优先级
  configOverride: z.record(z.any()).optional(), // 插件配置覆盖
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type AgentVersionPluginBinding = z.infer<typeof agentVersionPluginBindingSchema>;

// plugin.read_item 输入
export const pluginReadItemInputSchema = z.object({
  pluginId: z.string(),
  itemType: z.enum(["prompt", "resource"]),
  itemId: z.string(),
});

export type PluginReadItemInput = z.infer<typeof pluginReadItemInputSchema>;

// plugin.read_item 输出
export const pluginReadItemResultSchema = z.object({
  success: z.boolean(),
  pluginId: z.string(),
  itemType: z.string(),
  itemId: z.string(),
  title: z.string(),
  content: z.string(),
  error: z.string().optional(),
});

export type PluginReadItemResult = z.infer<typeof pluginReadItemResultSchema>;
