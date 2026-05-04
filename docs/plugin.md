开发任务说明（更新版）
目标

在当前仓库基础上，完成两部分改造：

1. 插件管理模块完整落地

包括：

插件数据库表
插件后端管理模块
插件运行时注册
插件前端管理页面
2. AgentVersion 改为显式绑定插件 ID

包括：

在 agent_versions 表增加 allowed_plugin_ids_json
创建/编辑 AgentVersion 时支持保存插件 ID 列表
运行时根据 allowedPluginIds 展开工具
不再通过 agent.type + defaultAttachTargets 自动挂载插件
一、必须遵守的改造原则
原则 1：不要影响现有核心运行链

以下功能必须保持可用：

现有 AgentRuntime 执行
现有 ToolRuntime 工具执行
现有 filesystem builtin 工具执行
现有 run / artifact / work_context 逻辑
原则 2：插件绑定权下放到 AgentVersion

以后插件权限来源只看：

agent_versions.allowed_plugin_ids_json
agent_versions.allowed_tools_json

不再看：

agent.type
defaultAttachTargets
PluginRegistry.bindings
原则 3：插件定义和插件配置分离
manifest_json：插件定义快照
config_json：插件运行配置
原则 4：复杂定义统一放 manifest_json

以下都放进 manifest_json：

tools
resources
prompts
catalog
skillText
contextPolicyPatch
runtimeRequirements
二、数据库改造
1. 修改 agent_versions 表

文件：

agent-platform-node/src/db/schema.ts
新增字段
allowedPluginIdsJson: text("allowed_plugin_ids_json").notNull().default("[]"),
说明

这是 AgentVersion 显式绑定插件 ID 的字段。

字段内容示例：

["builtin-filesystem-core", "builtin-browser-core-docs"]
保留字段

当前已有：

allowedToolsJson

继续保留。

最终语义
allowedPluginIdsJson：本版本启用哪些插件
allowedToolsJson：本版本额外允许的工具白名单/补充工具
2. 新增 plugins 表

同样在：

agent-platform-node/src/db/schema.ts

新增：

export const plugins = pgTable("plugins", {
  id: serial("id").primaryKey(),

  pluginUid: text("plugin_uid").notNull().unique(),
  pluginId: text("plugin_id").notNull().unique(),

  name: text("name").notNull(),
  description: text("description").notNull().default(""),

  pluginType: text("plugin_type").notNull(),     // builtin | external
  providerType: text("provider_type").notNull(), // builtin_code | manifest | mcp

  version: text("version").notNull().default("1"),
  sourceRef: text("source_ref"),

  manifestJson: text("manifest_json").notNull().default("{}"),
  configJson: text("config_json").notNull().default("{}"),

  installed: boolean("installed").notNull().default(false),
  enabled: boolean("enabled").notNull().default(true),

  status: text("status").notNull().default("registered"),
  lastError: text("last_error"),
  lastHealthCheckAt: text("last_health_check_at"),

  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
三、插件对象设计调整

文件：

agent-platform-node/src/modules/plugins/plugin.schema.ts
1. 保留 AgentPlugin 这些字段

保留：

pluginId
pluginType
name
description
tools
resources
prompts
catalog
skillText
contextPolicyPatch
providerType
runtimeRequirements
status
createdAt
updatedAt
2. 去掉/废弃
defaultAttachTargets

从新逻辑里移除，不再使用。

两套 binding schema
AgentVersionPluginBinding
AgentPluginBinding

不要再作为新主线使用。可以保留文件内类型，但标记废弃，后续等没有调用点再删。

3. 补充枚举

新增更合理的枚举：

export const PluginStatusEnum = z.enum([
  "registered",
  "active",
  "disabled",
  "error",
  "unavailable",
]);

export const PluginProviderTypeEnum = z.enum([
  "builtin_code",
  "manifest",
  "mcp",
]);
4. 增加 AgentVersion 入参 schema 字段

在 createAgentVersionSchema 里增加：

allowedPluginIds: z.array(z.string()).default([]),

并保留：

allowedTools: z.array(z.string()).default([]),
四、后端插件管理模块新增文件
1. 新增 plugin.repository.ts

路径：

agent-platform-node/src/modules/plugins/plugin.repository.ts

职责：

listPlugins()
listEnabledPlugins()
getPluginById(pluginId)
createPlugin()
updatePlugin()
upsertPlugin()
markPluginStatus()
enablePlugin()
disablePlugin()

要求：

用 drizzle
JSON 一律 stringify/parse
不写复杂业务逻辑
2. 新增 plugin-manager.ts

路径：

agent-platform-node/src/modules/plugins/plugin-manager.ts

职责：

bootstrap()
syncBuiltinPluginsToDb()
loadEnabledPluginsToRegistry()
enablePlugin(pluginId)
disablePlugin(pluginId)
reloadPlugin(pluginId)
getCatalog()
启动流程

bootstrap() 必须这样做：

1. 同步 builtin 插件到 DB
2. 从 DB 读取 enabled 的插件
3. 按 providerType 构建 AgentPlugin
4. 注册到 PluginRegistry
注意
builtin 和 manifest 要先完全跑通
mcp 先做配置管理和 adapter 入口，不要求这一轮完整打通协议
不要在启动时把所有 mcp 插件一股脑拉起
3. 新增 adapters

路径：

agent-platform-node/src/modules/plugins/adapters/
manifest-plugin-adapter.ts

职责：

从 manifestJson 还原 AgentPlugin
mcp-plugin-adapter.ts

职责：

校验 configJson
提供未来 MCP 接入入口
当前阶段允许只做 stub / config 校验
4. 新增 builtin-plugins.ts

路径：

agent-platform-node/src/modules/plugins/builtin-plugins.ts

作用：
统一导出所有 builtin 插件：

export const builtinPlugins = [
  builtinBrowserCoreDocs,
  filesystemCorePlugin,
];

当前 builtin 插件来源仍然是代码定义文件。

5. 新增 plugin.routes.ts

路径：

agent-platform-node/src/modules/plugins/plugin.routes.ts

提供 API：

查询
GET /api/agent-platform/plugins
GET /api/agent-platform/plugins/catalog
GET /api/agent-platform/plugins/:pluginId
管理
POST /api/agent-platform/plugins
PATCH /api/agent-platform/plugins/:pluginId
POST /api/agent-platform/plugins/:pluginId/enable
POST /api/agent-platform/plugins/:pluginId/disable
POST /api/agent-platform/plugins/:pluginId/reload
五、收缩 PluginRegistry

文件：

agent-platform-node/src/modules/plugins/plugin-registry.ts
保留
registerPlugin
unregisterPlugin
getPlugin
getAllPlugins
getActivePlugins
getPluginsByType
废弃但先不删
bindings
addBinding
removeBinding
getPluginsForAgent
getBindingsForAgent
isPluginAttached
getDefaultPluginsForAgentType
要求
新逻辑不再使用这些方法
如果现有其他代码还依赖，先保留兼容
明确注释为 deprecated
六、修改 AgentVersion 创建/保存逻辑

文件：

agent-platform-node/src/modules/agents/agent.service.ts
agent-platform-node/src/modules/agents/agent.routes.ts
agent-platform-node/src/modules/agents/agent.schema.ts
1. 修改 createAgentVersionSchema

增加：

allowedPluginIds: z.array(z.string()).default([]),
2. 修改 CreateAgentVersionInput

增加：

allowedPluginIds?: string[]
3. 修改 createAgentVersion()

保存：

allowedPluginIdsJson: jsonStringify(input.allowedPluginIds ?? [])
allowedToolsJson: jsonStringify(input.allowedTools ?? [])
说明

以后 AgentVersion 的能力来源就是：

allowedPluginIdsJson + allowedToolsJson
七、修改运行时插件展开逻辑（关键）

文件：

agent-platform-node/src/runtime/agent-runtime.ts
当前问题

现在运行时逻辑还会通过旧链路：

agent.id
→ pluginRegistry.getPluginsForAgent(agent.id)
→ 拿插件工具

这必须改。

新逻辑

运行时改成：

读取 versionRecord.allowedPluginIdsJson
读取 versionRecord.allowedToolsJson
根据 allowedPluginIds 去 PluginRegistry 查插件
展开插件里的 tools
合并 allowedTools
得到最终 finalAllowedTools
伪代码
const allowedPluginIds = jsonParse<string[]>(
  args.input.versionRecord.allowedPluginIdsJson,
  []
)

const allowedTools = jsonParse<string[]>(
  args.input.versionRecord.allowedToolsJson,
  []
)

const pluginToolIds = this.pluginRegistry
  ? this.pluginRegistry
      .getActivePlugins()
      .filter((p) => allowedPluginIds.includes(p.pluginId))
      .flatMap((p) => p.tools?.map((t) => `${p.pluginId}__${t.toolId}`) ?? [])
  : []

const baseAllowedTools = [...new Set([
  ...pluginToolIds,
  ...allowedTools,
])]

然后继续交给 ToolRuntime。

注意
不要再用
getPluginsForAgent(agent.id)
defaultAttachTargets
agent.type
仍然保持

pluginId__toolId 格式不变，兼容当前 ToolRuntime。

八、bootstrap 改造

当前 builtin 插件注册逻辑散在 bootstrap 里。
这次要改成：

服务启动
→ PluginManager.bootstrap()
具体要求
seedBuiltinPlugins() 不再直接主导注册
可以保留文件，但内部改成委托给 PluginManager
九、前端改造（后端完成后）
1. 修改 API 文件

文件：

frontend/src/api/agentPlatform.ts
新增插件 API
listPlugins
getPluginsCatalog
getPlugin
createPlugin
updatePlugin
enablePlugin
disablePlugin
reloadPlugin
修改 AgentVersion 类型

在 CreateAgentVersionInput / UpdateAgentVersionInput 中增加：

allowedPluginIds?: string[]

并保留：

allowedTools?: string[]
2. 先新增插件管理页面

这一轮先独立做插件管理页，不先和 Agent 管理页强耦合。

页面功能：

列表

显示：

name
pluginId
pluginType
providerType
installed
enabled
status
lastError
操作
查看详情
启用
禁用
刷新
新建 external 插件
详情

展示：

manifestJson
configJson
tools 摘要
resources/prompts 数量
status / lastError
3. Agent 管理页顺带改一点

既然你已经决定 AgentVersion 要绑定插件 ID，这一轮也要补最小改动。

在 Version 创建/编辑表单里增加
allowedPluginIds 多选项

数据来源：

GET /api/agent-platform/plugins/catalog
保存时提交
allowedPluginIds
allowedTools
注意
这里只补 Version 绑定插件 ID
不重做整个 Agent 管理页
不再通过 agent.type 自动绑定插件
十、必须废弃的旧绑定逻辑

这次改完后，以下逻辑必须退出主流程：

defaultAttachTargets
getDefaultPluginsForAgentType()
PluginRegistry.bindings
addBinding()
removeBinding()
getPluginsForAgent(agentId)

要求：

可以先保留代码
但主流程不再使用
注释写清楚 deprecated
十一、必须做的回归验证
后端
内置插件能同步进 plugins 表
GET /plugins / GET /plugins/catalog 正常
能创建 external 插件记录
启用/禁用插件生效
PluginRegistry 中能看到 active 插件
createAgentVersion() 能保存 allowedPluginIdsJson
AgentRuntime 能按 allowedPluginIdsJson 正确展开插件工具
现有 ToolRuntime 不受影响
前端
插件管理页正常显示
可以创建 external 插件配置
可以启用/禁用插件
AgentVersion 页面可选择插件
保存后后端收到 allowedPluginIds
现有 Agent 管理其他功能不崩
十二、绝对不要做的事
不要顺手重构整个 Agent 平台
不要删掉旧逻辑导致现有功能直接挂
不要把 MCP 全部打通作为这一轮硬目标
不要改 ToolRuntime 协议
不要改 run/artifact/workcontext 主链
不要改数据库风格，继续 text + JSON string
十三、最终交付物
后端
plugins 表 migration
修改 agent_versions 增加 allowed_plugin_ids_json
修改 plugin.schema.ts
修改 plugin-registry.ts
新增 plugin.repository.ts
新增 plugin-manager.ts
新增 plugin.routes.ts
新增 builtin-plugins.ts
新增 adapters
修改 AgentVersion create/update 逻辑
修改 AgentRuntime 插件展开逻辑
修改 bootstrap
前端
更新 frontend/src/api/agentPlatform.ts
新增插件管理页面
在 AgentVersion 表单加入 allowedPluginIds
接入插件 catalog
十四、给大模型的执行要求

请按以下顺序执行：

先评估现有依赖链，确认改动不会破坏现有 AgentRuntime / ToolRuntime / bootstrap。
先改后端：
schema
repository
manager
routes
runtime
做完后端回归验证。
再改前端：
API
插件管理页面
AgentVersion 表单最小改动
最终输出：
修改了哪些文件
新增了哪些文件
migration 内容
风险点
回归结果

一句话总结这次最终目标：

把插件管理做完整，并把 AgentVersion 的插件绑定改成显式 allowedPluginIds，
彻底替代 agent.type + defaultAttachTargets 的旧插件绑定方式，
同时保证不影响现有其他功能。

如果你要，我可以把这份再压缩成一个更适合直接喂给编码模型的“执行型 prompt”。