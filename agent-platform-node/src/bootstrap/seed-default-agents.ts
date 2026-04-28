import "dotenv/config";
import { ensureDatabaseSchema } from "../db/migrate.js";
import { createAgent, createAgentVersion, getAgentByUid } from "../modules/agents/agent.service.js";
import { createModelProfile, getModelProfileByUid } from "../modules/model-profiles/model-profile.service.js";
import { PluginRegistry } from "../modules/plugins/plugin-registry.js";
import { seedBuiltinPlugins, attachDefaultPluginsToAgentVersions } from "./seed-plugins.js";

await ensureDatabaseSchema();

async function ensureModelProfile(input: {
  profileUid: string;
  name: string;
  provider: string;
  modelName: string;
  baseUrl?: string;
}) {
  // bootstrap 要可重复执行：已有配置则复用，没有才创建。
  // 这样本地开发多次初始化不会生成一堆重复默认数据。
  const existing = await getModelProfileByUid(input.profileUid);
  if (existing) return existing;

  return createModelProfile({
    ...input,
    capability: { tool_calling: true },
    defaultParams: { temperature: 0.2 },
    maxContextTokens: 32000,
  });
}

async function main() {
  // Kimi 是正式默认 provider；local_mock_default 用来在没有 API key 时跑通闭环。
  await ensureModelProfile({
    profileUid: "main_agent_default",
    name: "Main Agent Default",
    provider: process.env.DEFAULT_MODEL_PROVIDER ?? "kimi",
    modelName: process.env.KIMI_DEFAULT_MODEL ?? "kimi-k2.5",
    baseUrl: process.env.KIMI_BASE_URL ?? "https://api.moonshot.cn/v1",
  });

  await ensureModelProfile({
    profileUid: "browser_agent_default",
    name: "Browser Agent Default",
    provider: process.env.DEFAULT_MODEL_PROVIDER ?? "kimi",
    modelName: process.env.KIMI_DEFAULT_MODEL ?? "kimi-k2.5",
    baseUrl: process.env.KIMI_BASE_URL ?? "https://api.moonshot.cn/v1",
  });

  await ensureModelProfile({
    profileUid: "local_mock_default",
    name: "Local Mock Model",
    provider: "mock",
    modelName: "mock-tool-caller",
  });

  let browserAgent = await getAgentByUid("builtin_browser_agent");
  if (!browserAgent) {
    browserAgent = await createAgent({
      agentUid: "builtin_browser_agent",
      name: "Builtin Browser Agent",
      type: "builtin",
      description: "First-phase browser agent using mock browser tools.",
      capabilities: ["browser"],
      standaloneEnabled: true,
      subagentEnabled: true,
      uiMode: "generic",
    });
  }

  // 初始化插件系统（在创建 AgentVersion 之前）
  const pluginRegistry = new PluginRegistry();
  await seedBuiltinPlugins(pluginRegistry);

  if (!browserAgent.currentVersionId) {
    // 第一版 BrowserAgent 绑定 mock 模型和 mock browser 工具，
    // 目标是先验证 AgentRun / Step / ModelInvocation 是否完整落库。
    const version = await createAgentVersion("builtin_browser_agent", {
      modelProfileUid: "local_mock_default",
      systemPrompt: "You are a browser automation agent. Use browser tools only when they are exposed.",
      skillText: "Open pages, inspect mock page information, and return a concise summary.",
      allowedTools: ["browser.open", "browser.get_page_info"],
      contextPolicy: { include_work_context_summary: false },
      modelParamsOverride: {},
      outputSchema: {},
      maxSteps: 4,
    });

    // 使用刚创建的 version.id 挂载插件
    await attachDefaultPluginsToAgentVersions(pluginRegistry, [
      { id: version.id, agentType: browserAgent.type },
    ]);
  } else {
    // 已有版本，直接挂载
    await attachDefaultPluginsToAgentVersions(pluginRegistry, [
      { id: browserAgent.currentVersionId, agentType: browserAgent.type },
    ]);
  }

  console.log("Agent Platform bootstrap completed.");
  console.log(`Plugin stats: ${JSON.stringify(pluginRegistry.getStats())}`);
}

await main();
