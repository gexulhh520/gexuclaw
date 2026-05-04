# agent-platform-node 插件管理系统完整落地计划

## 一、需求概述

基于 `docs/plugin.md` 文档，完成两部分改造：

1. **插件管理模块完整落地** — 包括插件数据库表、后端管理模块、运行时注册、前端管理页面
2. **AgentVersion 改为显式绑定插件 ID** — 通过 `allowed_plugin_ids_json` 字段替代 `agent.type + defaultAttachTargets` 的旧绑定方式

***

## 二、现状调研结论

### 2.1 现有代码结构

| 文件                                                      | 当前职责                                                             |
| ------------------------------------------------------- | ---------------------------------------------------------------- |
| `src/db/schema.ts`                                      | 10 张表，无 plugins 表，agent\_versions 无 allowedPluginIdsJson         |
| `src/db/migrate.ts`                                     | 原生 SQL 建表，PostgreSQL 语法                                          |
| `src/modules/plugins/plugin.schema.ts`                  | AgentPlugin 类型定义，含 `defaultAttachTargets`                        |
| `src/modules/plugins/plugin-registry.ts`                | 插件注册表，含 `bindings` / `addBinding` / `getPluginsForAgent`         |
| `src/modules/plugins/plugin-registry-instance.ts`       | 全局 PluginRegistry 实例                                             |
| `src/modules/plugins/plugin-catalog.ts`                 | 构建插件目录摘要                                                         |
| `src/modules/plugins/plugin-tools.ts`                   | plugin\_read\_item 工具                                            |
| `src/modules/plugins/builtins/browser-core-docs.ts`     | 浏览器文档插件，含 `defaultAttachTargets: ["builtin"]`                    |
| `src/modules/plugins/builtins/filesystem-core/index.ts` | 文件系统插件，含 `defaultAttachTargets: ["builtin", "chat", "workflow"]` |
| `src/bootstrap/seed-plugins.ts`                         | 注册 builtin 插件 + 为 Agent 挂载默认插件（通过 bindings）                      |
| `src/bootstrap/seed-default-agents.ts`                  | 启动时调用 `ensureDatabaseSchema()` + `seedBuiltinPlugins()`          |
| `src/runtime/agent-runtime.ts`                          | 通过 `pluginRegistry.getPluginsForAgent(agent.id)` 获取插件            |
| `src/modules/agents/agent.schema.ts`                    | createAgentVersionSchema，无 allowedPluginIds                      |
| `src/modules/agents/agent.service.ts`                   | createAgentVersion()，不处理 allowedPluginIds                        |
| `src/modules/agents/agent.routes.ts`                    | Agent CRUD 路由                                                    |
| `src/app.ts`                                            | Fastify 应用构建，注册各模块路由                                             |
| `frontend/src/api/agentPlatform.ts`                     | 前端 API 封装，无插件相关 API                                              |

### 2.2 关键依赖链

```
run.service.ts → AgentRuntime({ pluginRegistry })
    ↓
agent-runtime.ts → pluginRegistry.getPluginsForAgent(agent.id) [旧链路]
    ↓
plugin-registry.ts → bindings (agentId -> PluginBinding[])
    ↓
seed-plugins.ts → attachDefaultPluginsToAgents() / attachDefaultPluginsToAllAgents()
    ↓
browser-core-docs.ts / filesystem-core.ts → defaultAttachTargets
```

**新链路目标：**

```
agent-runtime.ts → versionRecord.allowedPluginIdsJson → PluginRegistry.getActivePlugins()
    → filter by allowedPluginIds → 展开 tools
```

***

## 三、后端开发计划

### Phase 1: 数据库层改造

#### 3.1.1 修改 `src/db/schema.ts`

**新增** **`plugins`** **表：**

```typescript
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
```

**修改** **`agent_versions`** **表：**

* 新增字段：`allowedPluginIdsJson: text("allowed_plugin_ids_json").notNull().default("[]")`

#### 3.1.2 修改 `src/db/migrate.ts`

* 新增 `plugins` 表的 `create table if not exists` 语句

* 新增 `agent_versions` 表的 `add column if not exists allowed_plugin_ids_json` 语句

* 添加表/字段注释

***

### Phase 2: Schema 类型定义调整

#### 3.2.1 修改 `src/modules/plugins/plugin.schema.ts`

**变更清单：**

1. `PluginStatusEnum` 扩展为：`["registered", "active", "disabled", "error", "unavailable"]`
2. 新增 `PluginProviderTypeEnum = z.enum(["builtin_code", "manifest", "mcp"])`
3. `agentPluginSchema.providerType` 改为使用 `PluginProviderTypeEnum`
4. **废弃** **`defaultAttachTargets`** — 保留字段但标记为 deprecated，新逻辑不再使用
5. **废弃** **`agentVersionPluginBindingSchema`** **和** **`agentPluginBindingSchema`** — 保留类型但标记为 deprecated
6. 新增 `pluginManifestSchema` — 定义 manifest\_json 的结构（tools/resources/prompts/catalog/skillText/contextPolicyPatch/runtimeRequirements）
7. 新增 `pluginConfigSchema` — 定义 config\_json 的结构

#### 3.2.2 修改 `src/modules/agents/agent.schema.ts`

* `createAgentVersionSchema` 新增：`allowedPluginIds: z.array(z.string()).default([])`

* `CreateAgentVersionInput` 类型自动继承

***

### Phase 3: Repository 层

#### 3.3.1 新增 `src/modules/plugins/plugin.repository.ts`

**职责：** 纯数据访问，不写业务逻辑

**接口：**

```typescript
export async function listPlugins(): Promise<PluginRecord[]>
export async function listEnabledPlugins(): Promise<PluginRecord[]>
export async function getPluginById(pluginId: string): Promise<PluginRecord | undefined>
export async function getPluginByUid(pluginUid: string): Promise<PluginRecord | undefined>
export async function createPlugin(input: CreatePluginInput): Promise<PluginRecord>
export async function updatePlugin(pluginId: string, input: UpdatePluginInput): Promise<PluginRecord>
export async function upsertPlugin(input: UpsertPluginInput): Promise<PluginRecord>
export async function markPluginStatus(pluginId: string, status: string, lastError?: string): Promise<void>
export async function enablePlugin(pluginId: string): Promise<void>
export async function disablePlugin(pluginId: string): Promise<void>
```

**要求：**

* 使用 drizzle ORM

* JSON 字段统一 stringify/parse

* 返回原始数据库记录（不归一化）

***

### Phase 4: PluginManager 层

#### 3.4.1 新增 `src/modules/plugins/plugin-manager.ts`

**职责：** 插件生命周期管理，连接 DB 和 Registry

**核心方法：**

```typescript
export class PluginManager {
  constructor(private registry: PluginRegistry, private db: typeof db) {}

  async bootstrap(): Promise<void> {
    // 1. 同步 builtin 插件到 DB
    // 2. 从 DB 读取 enabled 的插件
    // 3. 按 providerType 构建 AgentPlugin
    // 4. 注册到 PluginRegistry
  }

  async syncBuiltinPluginsToDb(): Promise<void> {
    // 遍历 builtinPlugins，upsert 到 plugins 表
  }

  async loadEnabledPluginsToRegistry(): Promise<void> {
    // 从 DB 读取 enabled=true 的插件
    // builtin_code: 直接从代码构建 AgentPlugin
    // manifest: 通过 manifest-plugin-adapter 从 manifestJson 还原
    // mcp: 当前阶段只做配置校验，不拉起服务
  }

  async enablePlugin(pluginId: string): Promise<void>
  async disablePlugin(pluginId: string): Promise<void>
  async reloadPlugin(pluginId: string): Promise<void>
  async getCatalog(): Promise<PluginCatalogSummary[]>
}
```

#### 3.4.2 新增 `src/modules/plugins/builtin-plugins.ts`

```typescript
import { builtinBrowserCoreDocs } from "./builtins/browser-core-docs.js";
import { filesystemCorePlugin } from "./builtins/filesystem-core/index.js";

export const builtinPlugins = [
  builtinBrowserCoreDocs,
  filesystemCorePlugin,
];
```

#### 3.4.3 新增 Adapters

**`src/modules/plugins/adapters/manifest-plugin-adapter.ts`**

* 从 `manifestJson` 还原 `AgentPlugin` 对象

* 校验 manifest 结构

**`src/modules/plugins/adapters/mcp-plugin-adapter.ts`**

* 校验 `configJson` 结构

* 提供 MCP 接入入口（当前阶段允许 stub）

***

### Phase 5: PluginRegistry 收缩

#### 3.5.1 修改 `src/modules/plugins/plugin-registry.ts`

**保留方法：**

* `registerPlugin`

* `unregisterPlugin`

* `getPlugin`

* `getAllPlugins`

* `getActivePlugins`

* `getPluginsByType`

**废弃方法（保留但标记 deprecated）：**

* `bindings` / `addBinding` / `removeBinding`

* `getPluginsForAgent`

* `getBindingsForAgent`

* `isPluginAttached`

* `getDefaultPluginsForAgentType`

**新增辅助方法（可选）：**

* `getPluginsByIds(pluginIds: string[]): AgentPlugin[]` — 按 ID 列表批量获取

***

### Phase 6: AgentVersion 逻辑改造

#### 3.6.1 修改 `src/modules/agents/agent.service.ts`

**`createAgentVersion()`** **方法：**

* 新增保存 `allowedPluginIdsJson: jsonStringify(input.allowedPluginIds ?? [])`

* 保留 `allowedToolsJson`

#### 3.6.2 修改 `src/modules/agents/agent.routes.ts`

* 无需修改（schema 变更自动处理）

***

### Phase 7: AgentRuntime 运行时改造（关键）

#### 3.7.1 修改 `src/runtime/agent-runtime.ts`

**当前逻辑（约 317-340 行）：**

```typescript
const attachedPlugins = this.pluginRegistry?.getPluginsForAgent(
  args.input.agentRecord.id
) ?? [];
```

**新逻辑：**

```typescript
const allowedPluginIds = jsonParse<string[]>(
  args.input.versionRecord.allowedPluginIdsJson,
  []
);
const allowedTools = jsonParse<string[]>(args.input.versionRecord.allowedToolsJson, []);

const pluginToolIds = this.pluginRegistry
  ? this.pluginRegistry
      .getActivePlugins()
      .filter((p) => allowedPluginIds.includes(p.pluginId))
      .flatMap((p) => p.tools?.map((t) => `${p.pluginId}__${t.toolId}`) ?? [])
  : [];

const baseAllowedTools = [...new Set([...pluginToolIds, ...allowedTools])];
```

**同时需要修改** **`RunAgentInput`** **类型：**

* `versionRecord` 新增 `allowedPluginIdsJson: string`

***

### Phase 8: Routes 层

#### 3.8.1 新增 `src/modules/plugins/plugin.routes.ts`

**API 列表：**

```typescript
GET    /api/agent-platform/plugins
GET    /api/agent-platform/plugins/catalog
GET    /api/agent-platform/plugins/:pluginId
POST   /api/agent-platform/plugins
PATCH  /api/agent-platform/plugins/:pluginId
POST   /api/agent-platform/plugins/:pluginId/enable
POST   /api/agent-platform/plugins/:pluginId/disable
POST   /api/agent-platform/plugins/:pluginId/reload
```

#### 3.8.2 修改 `src/app.ts`

* 导入并注册 `registerPluginRoutes(app)`

***

### Phase 9: Bootstrap 改造

#### 3.9.1 修改 `src/bootstrap/seed-plugins.ts`

* `seedBuiltinPlugins()` 不再直接主导注册，改为委托给 PluginManager

* `attachDefaultPluginsToAgents()` 和 `attachDefaultPluginsToAllAgents()` 标记为 deprecated，保留兼容

#### 3.9.2 修改 `src/bootstrap/seed-default-agents.ts`

* 启动流程改为：`PluginManager.bootstrap()`

* 保留 `ensureDatabaseSchema()` 调用

***

## 四、前端开发计划

### Phase 10: API 层

#### 4.1.1 修改 `frontend/src/api/agentPlatform.ts`

**新增类型：**

```typescript
export type PluginRecord = {
  id: number
  pluginUid: string
  pluginId: string
  name: string
  description: string
  pluginType: string
  providerType: string
  version: string
  sourceRef: string | null
  manifestJson: string
  configJson: string
  installed: boolean
  enabled: boolean
  status: string
  lastError: string | null
  lastHealthCheckAt: string | null
  createdAt: string
  updatedAt: string
}

export type CreatePluginInput = {
  pluginId: string
  name: string
  description?: string
  pluginType?: string
  providerType?: string
  version?: string
  sourceRef?: string
  manifestJson?: Record<string, unknown>
  configJson?: Record<string, unknown>
}

export type UpdatePluginInput = Partial<CreatePluginInput>
```

**新增 API 方法：**

```typescript
async listPlugins()
async getPluginsCatalog()
async getPlugin(pluginId: string)
async createPlugin(input: CreatePluginInput)
async updatePlugin(pluginId: string, input: UpdatePluginInput)
async enablePlugin(pluginId: string)
async disablePlugin(pluginId: string)
async reloadPlugin(pluginId: string)
```

**修改** **`CreateAgentVersionInput`：**

* 新增 `allowedPluginIds?: string[]`

***

### Phase 11: 插件管理页面

#### 4.2.1 新增 `frontend/src/views/PluginManager.vue`

**页面功能：**

* **列表视图：** 显示所有插件（name, pluginId, pluginType, providerType, installed, enabled, status, lastError）

* **操作按钮：** 查看详情、启用、禁用、刷新

* **新建插件：** 创建 external 插件配置

* **详情视图：** 展示 manifestJson, configJson, tools 摘要, resources/prompts 数量, status/lastError

#### 4.2.2 新增路由

在 `frontend/src/main.ts` 或路由配置中添加 `/agent-platform/plugins` 路由。

***

### Phase 12: AgentVersion 表单改造

#### 4.3.1 修改 Agent 管理页面

**在 Version 创建/编辑表单中增加：**

* `allowedPluginIds` 多选框

* 数据来源：`GET /api/agent-platform/plugins/catalog`

* 保存时提交 `allowedPluginIds` + `allowedTools`

**注意：**

* 只补 Version 绑定插件 ID

* 不重做整个 Agent 管理页

* 不再通过 `agent.type` 自动绑定插件

***

## 五、回归验证计划

### 5.1 后端验证

| # | 验证项                              | 通过标准                                                       |
| - | -------------------------------- | ---------------------------------------------------------- |
| 1 | 内置插件同步进 plugins 表                | `listPlugins()` 返回 builtin 插件记录                            |
| 2 | 插件查询 API                         | `GET /plugins` / `GET /plugins/catalog` 正常返回               |
| 3 | 创建 external 插件                   | `POST /plugins` 成功创建记录                                     |
| 4 | 启用/禁用插件                          | `POST /plugins/:id/enable` 后 registry 中可见/不可见              |
| 5 | PluginRegistry active 插件         | `getActivePlugins()` 只返回 enabled 的插件                       |
| 6 | AgentVersion 保存 allowedPluginIds | `createAgentVersion()` 后 DB 中 `allowed_plugin_ids_json` 正确 |
| 7 | AgentRuntime 插件展开                | 运行时按 `allowedPluginIdsJson` 正确展开插件工具                       |
| 8 | ToolRuntime 不受影响                 | 现有工具（fs\_read 等）正常执行                                       |
| 9 | 现有 run/artifact/workcontext 逻辑   | 主链功能正常                                                     |

### 5.2 前端验证

| # | 验证项               | 通过标准                     |
| - | ----------------- | ------------------------ |
| 1 | 插件管理页显示           | 列表正常渲染，字段完整              |
| 2 | 创建 external 插件    | 表单提交成功，页面刷新后可见           |
| 3 | 启用/禁用插件           | 按钮点击后状态切换，API 调用成功       |
| 4 | AgentVersion 插件选择 | 多选框显示 catalog 插件，保存后后端收到 |
| 5 | 现有 Agent 管理功能     | 其他功能不崩                   |

***

## 六、文件变更清单

### 修改文件

| #  | 文件                                       | 变更内容                                                                  |
| -- | ---------------------------------------- | --------------------------------------------------------------------- |
| 1  | `src/db/schema.ts`                       | 新增 plugins 表，agent\_versions 新增 allowedPluginIdsJson                  |
| 2  | `src/db/migrate.ts`                      | 新增 plugins 建表 SQL，agent\_versions 加字段                                 |
| 3  | `src/modules/plugins/plugin.schema.ts`   | 扩展枚举，废弃 defaultAttachTargets/binding schema，新增 manifest/config schema |
| 4  | `src/modules/plugins/plugin-registry.ts` | 标记废弃方法，新增 getPluginsByIds                                             |
| 5  | `src/modules/agents/agent.schema.ts`     | createAgentVersionSchema 新增 allowedPluginIds                          |
| 6  | `src/modules/agents/agent.service.ts`    | createAgentVersion 保存 allowedPluginIdsJson                            |
| 7  | `src/runtime/agent-runtime.ts`           | 改为从 versionRecord.allowedPluginIdsJson 展开插件                           |
| 8  | `src/bootstrap/seed-plugins.ts`          | 委托给 PluginManager，标记旧方法 deprecated                                    |
| 9  | `src/bootstrap/seed-default-agents.ts`   | 启动流程改为 PluginManager.bootstrap()                                      |
| 10 | `src/app.ts`                             | 注册 plugin routes                                                      |
| 11 | `frontend/src/api/agentPlatform.ts`      | 新增插件 API 和类型，修改 CreateAgentVersionInput                               |

### 新增文件

| # | 文件                                                        | 职责                     |
| - | --------------------------------------------------------- | ---------------------- |
| 1 | `src/modules/plugins/plugin.repository.ts`                | 插件数据访问层                |
| 2 | `src/modules/plugins/plugin-manager.ts`                   | 插件生命周期管理               |
| 3 | `src/modules/plugins/plugin.routes.ts`                    | 插件 REST API            |
| 4 | `src/modules/plugins/builtin-plugins.ts`                  | 统一导出 builtin 插件        |
| 5 | `src/modules/plugins/adapters/manifest-plugin-adapter.ts` | manifest 转 AgentPlugin |
| 6 | `src/modules/plugins/adapters/mcp-plugin-adapter.ts`      | MCP 配置校验/入口            |
| 7 | `frontend/src/views/PluginManager.vue`                    | 插件管理页面                 |

***

## 七、风险点

1. **AgentRuntime 插件展开逻辑变更** — 这是核心改动，必须确保 `allowedPluginIdsJson` 为空数组时，不会破坏现有运行链
2. **bootstrap 时序** — PluginManager.bootstrap() 必须在 AgentRuntime 使用前完成
3. **旧 binding 数据兼容** — 已有 bindings 的 Agent 在切换新逻辑后，需要通过 allowedPluginIdsJson 重新配置
4. **builtin 插件的 providerType** — 现有 builtin 插件代码中 `providerType` 是 `"playwright" | "bb-browser" | "opencli" | "custom"`，需与新的 `"builtin_code" | "manifest" | "mcp"` 映射
5. **前端类型同步** — AgentVersionRecord 需要同步增加 allowedPluginIdsJson 字段

***

## 八、执行顺序

```
Phase 1: 数据库层 (schema.ts, migrate.ts)
    ↓
Phase 2: Schema 类型定义 (plugin.schema.ts, agent.schema.ts)
    ↓
Phase 3: Repository 层 (plugin.repository.ts)
    ↓
Phase 4: Adapters (manifest-plugin-adapter.ts, mcp-plugin-adapter.ts)
    ↓
Phase 5: PluginManager (plugin-manager.ts, builtin-plugins.ts)
    ↓
Phase 6: PluginRegistry 收缩 (plugin-registry.ts)
    ↓
Phase 7: AgentVersion 逻辑 (agent.service.ts)
    ↓
Phase 8: AgentRuntime 改造 (agent-runtime.ts) ← 最关键
    ↓
Phase 9: Routes (plugin.routes.ts, app.ts)
    ↓
Phase 10: Bootstrap 改造 (seed-plugins.ts, seed-default-agents.ts)
    ↓
Phase 11: 后端回归验证
    ↓
Phase 12: 前端 API (agentPlatform.ts)
    ↓
Phase 13: 前端插件管理页面 (PluginManager.vue)
    ↓
Phase 14: 前端 AgentVersion 表单改造
    ↓
Phase 15: 前端回归验证
```

