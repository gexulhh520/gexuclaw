import { jsonParse } from "../../../shared/json.js";
import { nowIso } from "../../../shared/time.js";
import {
  type AgentPlugin,
  pluginManifestSchema,
  type PluginManifest,
} from "../plugin.schema.js";

/**
 * 从 manifestJson 字符串还原 AgentPlugin 对象
 * @param pluginId 插件 ID
 * @param name 插件名称
 * @param description 插件描述
 * @param manifestJson manifest_json 字段的字符串值
 * @returns AgentPlugin 对象
 */
export function buildAgentPluginFromManifest(
  pluginId: string,
  name: string,
  description: string,
  manifestJson: string
): AgentPlugin {
  const parsed = jsonParse<Record<string, unknown>>(manifestJson, {});
  const manifest = pluginManifestSchema.safeParse(parsed);

  if (!manifest.success) {
    console.warn(`[ManifestAdapter] 插件 ${pluginId} 的 manifest 校验失败:`, manifest.error);
  }

  const data: PluginManifest = manifest.success ? manifest.data : (parsed as PluginManifest);

  return {
    pluginId,
    pluginType: "external" as const,
    name,
    description,
    tools: data.tools,
    resources: data.resources,
    prompts: data.prompts,
    catalog: data.catalog,
    skillText: data.skillText,
    contextPolicyPatch: data.contextPolicyPatch,
    providerType: "manifest",
    runtimeRequirements: data.runtimeRequirements,
    status: "active",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

/**
 * 将 AgentPlugin 对象序列化为 manifestJson 字符串
 * @param plugin AgentPlugin 对象
 * @returns manifest_json 字段的字符串值
 */
export function serializeManifestFromAgentPlugin(plugin: AgentPlugin): string {
  const manifest = {
    tools: plugin.tools,
    resources: plugin.resources,
    prompts: plugin.prompts,
    catalog: plugin.catalog,
    skillText: plugin.skillText,
    contextPolicyPatch: plugin.contextPolicyPatch,
    runtimeRequirements: plugin.runtimeRequirements,
  };
  return JSON.stringify(manifest);
}
