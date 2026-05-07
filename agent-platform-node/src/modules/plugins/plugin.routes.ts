import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ok } from "../../shared/api-response.js";
import { notFound } from "../../shared/errors.js";
import { jsonParse } from "../../shared/json.js";
import {
  createPlugin,
  disablePlugin,
  enablePlugin,
  getPluginById,
  listPlugins,
  updatePlugin,
} from "./plugin.repository.js";
import { pluginRegistry } from "./plugin-registry-instance.js";
import { PluginManager } from "./plugin-manager.js";
import {
  runRuntimeHealthCheck,
  runRuntimeResetPolicy,
  type RuntimeHookConfig,
} from "./mcp/mcp-runtime-hook.js";
import { McpPluginAdapter } from "./adapters/mcp-plugin-adapter.js";

const pluginManager = new PluginManager(pluginRegistry);

const createPluginSchema = z.object({
  pluginId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  pluginType: z.enum(["builtin", "external"]).default("external"),
  providerType: z.enum(["builtin_code", "manifest", "mcp"]).default("manifest"),
  version: z.string().default("1"),
  sourceRef: z.string().optional(),
  manifestJson: z.record(z.unknown()).default({}),
  configJson: z.record(z.unknown()).default({}),
});

const updatePluginSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  version: z.string().optional(),
  sourceRef: z.string().optional(),
  manifestJson: z.record(z.unknown()).optional(),
  configJson: z.record(z.unknown()).optional(),
  status: z.string().optional(),
});

export async function registerPluginRoutes(app: FastifyInstance) {
  // GET /api/agent-platform/plugins - 列出所有插件
  app.get("/api/agent-platform/plugins", async () => {
    const records = await listPlugins();
    return ok(records);
  });

  // GET /api/agent-platform/plugins/catalog - 获取插件目录
  app.get("/api/agent-platform/plugins/catalog", async () => {
    const catalog = await pluginManager.getCatalog();
    return ok(catalog);
  });

  // GET /api/agent-platform/plugins/:pluginId - 获取单个插件
  app.get<{ Params: { pluginId: string } }>("/api/agent-platform/plugins/:pluginId", async (request) => {
    const record = await getPluginById(request.params.pluginId);
    if (!record) throw notFound("Plugin not found", { pluginId: request.params.pluginId });
    return ok(record);
  });

  // POST /api/agent-platform/plugins - 创建插件
  app.post("/api/agent-platform/plugins", async (request) => {
    const input = createPluginSchema.parse(request.body);
    const record = await createPlugin({
      pluginId: input.pluginId,
      name: input.name,
      description: input.description,
      pluginType: input.pluginType,
      providerType: input.providerType,
      version: input.version,
      sourceRef: input.sourceRef,
      manifestJson: input.manifestJson,
      configJson: input.configJson,
      installed: true,
      enabled: true,
      status: "active",
    });

    // 创建后自动加载到注册表
    try {
      await pluginManager.enablePlugin(record.pluginId);
    } catch (error) {
      console.error(`[PluginRoutes] 创建插件后加载失败: ${record.pluginId}`, error);
    }

    return ok(record);
  });

  // PATCH /api/agent-platform/plugins/:pluginId - 更新插件
  app.patch<{ Params: { pluginId: string } }>("/api/agent-platform/plugins/:pluginId", async (request) => {
    const input = updatePluginSchema.parse(request.body);
    const record = await updatePlugin(request.params.pluginId, input);
    return ok(record);
  });

  // POST /api/agent-platform/plugins/:pluginId/enable - 启用插件
  app.post<{ Params: { pluginId: string } }>("/api/agent-platform/plugins/:pluginId/enable", async (request) => {
    await pluginManager.enablePlugin(request.params.pluginId);
    return ok({ success: true });
  });

  // POST /api/agent-platform/plugins/:pluginId/disable - 禁用插件
  app.post<{ Params: { pluginId: string } }>("/api/agent-platform/plugins/:pluginId/disable", async (request) => {
    await pluginManager.disablePlugin(request.params.pluginId);
    return ok({ success: true });
  });

  // POST /api/agent-platform/plugins/:pluginId/reload - 重新加载插件
  app.post<{ Params: { pluginId: string } }>("/api/agent-platform/plugins/:pluginId/reload", async (request) => {
    await pluginManager.reloadPlugin(request.params.pluginId);
    return ok({ success: true });
  });

  // POST /api/agent-platform/plugins/:pluginId/health-check - 健康检查
  app.post<{ Params: { pluginId: string } }>("/api/agent-platform/plugins/:pluginId/health-check", async (request) => {
    const record = await getPluginById(request.params.pluginId);
    if (!record) throw notFound("Plugin not found", { pluginId: request.params.pluginId });

    if (record.providerType !== "mcp") {
      return ok({
        checked: false,
        state: "UNKNOWN",
        message: "Only MCP plugins support health check",
      });
    }

    const config = jsonParse<RuntimeHookConfig>(record.configJson, {});
    const result = await runRuntimeHealthCheck(config);

    return ok(result);
  });

  // POST /api/agent-platform/plugins/:pluginId/reset-runtime - 重置运行时
  app.post<{ Params: { pluginId: string } }>("/api/agent-platform/plugins/:pluginId/reset-runtime", async (request) => {
    const record = await getPluginById(request.params.pluginId);
    if (!record) throw notFound("Plugin not found", { pluginId: request.params.pluginId });

    if (record.providerType !== "mcp") {
      return ok({
        success: false,
        message: "Only MCP plugins support runtime reset",
      });
    }

    const config = jsonParse<RuntimeHookConfig>(record.configJson, {});
    await runRuntimeResetPolicy(request.params.pluginId, config);

    return ok({ success: true });
  });
}
