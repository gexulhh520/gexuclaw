
## 2026-04-27：实现 MCP 风格插件系统 Phase 1-3

本次目标：

- 完成插件系统从设计到代码的完整落地。
- 实现 Phase 1：插件对象模型、目录摘要、plugin.read_item 工具定义。
- 实现 Phase 2：PluginRegistry、Runtime 合并逻辑、plugin.read_item 注册。
- 实现 Phase 3：最小内置插件验证、Bootstrap 加载、端到端类型检查通过。

修改文件：

- `agent-platform-node/src/modules/plugins/plugin.schema.ts` (新建)
- `agent-platform-node/src/modules/plugins/plugin-catalog.ts` (新建)
- `agent-platform-node/src/modules/plugins/plugin-tools.ts` (新建)
- `agent-platform-node/src/modules/plugins/plugin-registry.ts` (新建)
- `agent-platform-node/src/modules/plugins/builtins/browser-core-docs.ts` (新建)
- `agent-platform-node/src/bootstrap/seed-plugins.ts` (新建)
- `agent-platform-node/src/runtime/agent-runtime.ts`
- `agent-platform-node/src/runtime/tool-runtime.ts`
- `agent-platform-node/src/runtime/context-builder.ts`
- `agent-platform-node/src/bootstrap/seed-default-agents.ts`
- `docs/agent-platform/DEVELOPMENT_PROGRESS.md`

完成内容：

- Phase 1：定义插件对象模型
  - 新建 `plugin.schema.ts`，定义完整类型：
    - `AgentPlugin`：插件主体（pluginId, pluginType, tools, resources, prompts, catalog, skillText, contextPolicyPatch 等）
    - `PluginCatalogSummary`：插件目录摘要
    - `PluginCatalogItem`：目录条目
    - `PluginReadItemInput / Result`：plugin.read_item 输入输出
    - `AgentVersionPluginBinding`：AgentVersion 与插件挂载关系
  - 新建 `plugin-catalog.ts`，实现目录摘要生成：
    - `buildSinglePluginCatalog()`：从插件提取目录
    - `buildPluginCatalogInjection()`：生成 LLM 可理解的注入文本
    - `buildPluginCatalogSummary()`：精简版目录（用于日志）
  - 新建 `plugin-tools.ts`，定义 plugin.read_item：
    - `pluginReadItemToolDefinition`：工具 schema
    - `handlePluginReadItem()`：查询 handler
    - `registerPluginReadItemTool()`：注册到 ToolRuntime

- Phase 2：接入 Runtime 合并逻辑
  - 新建 `plugin-registry.ts`，实现 PluginRegistry：
    - 内存存储插件和挂载关系
    - `registerPlugin() / getPlugin() / getActivePlugins()`
    - `getPluginsForAgentVersion()`：按 AgentVersion 获取挂载插件
    - `addBinding() / removeBinding()`：管理挂载关系
    - `getDefaultPluginsForAgentType()`：按 Agent 类型获取默认插件
  - 修改 `agent-runtime.ts`：
    - AgentRuntime 构造函数接收 `PluginRegistry`
    - `executeRunLoop()` 中获取挂载插件并合并工具
    - 注册 `plugin.read_item` 到 ToolRuntime
    - `renderSystemMessage()` 注入插件目录摘要
  - 修改 `tool-runtime.ts`：
    - 新增 `registerTool()` 方法，支持动态注册插件工具
  - 修改 `context-builder.ts`：
    - `PromptContext` 新增可选 `pluginCatalog` 字段

- Phase 3：最小内置插件验证
  - 新建 `builtins/browser-core-docs.ts`：
    - 定义 `builtin-browser-core-docs` 插件
    - 包含 3 个 prompts（页面分析模板、截图最佳实践、数据提取指南）
    - 包含 2 个 resources（常用 CSS 选择器、常见浏览器错误）
    - 默认挂载到 `browser` 类型 Agent
  - 新建 `bootstrap/seed-plugins.ts`：
    - `seedBuiltinPlugins()`：注册所有内置插件
    - `attachDefaultPluginsToAgentVersions()`：按 Agent 类型挂载默认插件
  - 修改 `bootstrap/seed-default-agents.ts`：
    - 初始化 PluginRegistry
    - 注册内置插件
    - 为 browser_agent 挂载默认插件

- 类型检查：
  - `npm run typecheck` 通过，无类型错误。

当前边界说明：

- 当前使用内存存储插件和挂载关系，未新增数据库表。
- 当前仅实现 `builtin-browser-core-docs` 一个最小内置插件。
- plugin.read_item 工具已注册，但需真实 LLM 调用验证（当前 mock provider 可能未覆盖）。
- 插件工具合并逻辑已就位，但真实外部插件（Playwright / bb-browser）尚未接入。

验证方式：

- `agent-platform-node` 执行 `npm run typecheck` 通过。
- PluginRegistry 单元逻辑已验证（注册、查询、挂载）。
- 目录摘要生成格式已人工检查，符合 LLM 理解习惯。

下一步建议：

- 在真实运行中验证插件目录是否正确注入 system message。
- 验证 LLM 是否能正确调用 `plugin.read_item` 并获取内容。
- 接入 `builtin-browser-playwright` 真实浏览器能力插件。
- 设计插件管理后台 UI，支持可视化挂载/卸载插件。
