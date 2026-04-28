import "dotenv/config";
import { ensureDatabaseSchema } from "../db/migrate.js";
import { createAgent, createAgentVersion, getAgentByUid } from "../modules/agents/agent.service.js";
import { createModelProfile, getModelProfileByUid } from "../modules/model-profiles/model-profile.service.js";
import { pluginRegistry } from "../modules/plugins/plugin-registry-instance.js";
import { seedBuiltinPlugins, attachDefaultPluginsToAgents, attachDefaultPluginsToAllAgents } from "./seed-plugins.js";

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

  // Kimi k2.5 不需要传入 temperature 参数，使用模型默认值
  const isKimiK25 = input.modelName === "kimi-k2.5";
  const defaultParams = isKimiK25 ? {} : { temperature: 0.2 };

  return createModelProfile({
    ...input,
    capability: { tool_calling: true },
    defaultParams,
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

  // 初始化插件系统（使用全局 pluginRegistry）
  await seedBuiltinPlugins(pluginRegistry);

  if (!browserAgent.currentVersionId) {
    // 第一版 BrowserAgent 绑定 mock 模型和 mock browser 工具，
    // 目标是先验证 AgentRun / Step / ModelInvocation 是否完整落库。
    await createAgentVersion("builtin_browser_agent", {
      modelProfileUid: "local_mock_default",
      systemPrompt: "You are a browser automation agent. Use browser tools only when they are exposed.",
      skillText: "Open pages, inspect mock page information, and return a concise summary.",
      allowedTools: [
        // 插件工具（格式: pluginId__toolId）
        "builtin-browser-core-docs__browser_open",
        "builtin-browser-core-docs__browser_get_page_info",
        "builtin-browser-core-docs__browser_find_element",
        "builtin-browser-core-docs__browser_click",
        "builtin-browser-core-docs__browser_input_text",
        "builtin-browser-core-docs__browser_screenshot",
        "builtin-browser-core-docs__browser_scroll",
        "builtin-browser-core-docs__browser_extract_data",
      ],
      contextPolicy: { include_work_context_summary: false },
      modelParamsOverride: {},
      outputSchema: {},
      maxSteps: 4,
    });

    // 为 Agent 挂载插件（Agent 级别，所有版本共享）
    await attachDefaultPluginsToAgents(pluginRegistry, [
      { id: browserAgent.id, type: browserAgent.type, agentUid: browserAgent.agentUid },
    ]);
  }

  // 为数据库中所有 Agent 挂载默认插件
  // 确保即使之前创建的 Agent 也能获得插件绑定
  await attachDefaultPluginsToAllAgents(pluginRegistry);

  console.log("Agent Platform bootstrap completed.");
  console.log(`Plugin stats: ${JSON.stringify(pluginRegistry.getStats())}`);
}

await main();
