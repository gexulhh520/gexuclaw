# Agent Platform 插件系统开发计划

## 文档信息

- **创建日期**: 2026-04-27
- **目标**: 基于现有 MCP 风格插件系统设计文档，制定可执行的分阶段开发计划
- **关联文档**:
  - `docs/agent-platform/MCP_STYLE_PLUGIN_SYSTEM_DESIGN.md`
  - `docs/agent-platform/PLUGIN_SYSTEM_PHASED_IMPLEMENTATION_PLAN.md`
  - `docs/agent-platform/DEVELOPMENT_PROGRESS.md`

---

## 1. 当前状态分析

### 1.1 已完成基础

| 组件 | 状态 | 说明 |
|------|------|------|
| AgentRuntime | ✅ | 单 Agent 执行闭环 |
| ToolRuntime | ✅ | 工具白名单与执行 |
| WorkContext/Artifact | ✅ | 产物沉淀与展示 |
| artifactCandidates | ✅ | 工具产物候选机制 |
| artifactDirectives | ✅ | Agent 决策产物机制 |
| 右侧工作台 | ✅ | 上下文/产物/执行过程三栏 |
| 主 Agent 委派 | ✅ | 两步决策 + 子 Agent 执行 |

### 1.2 待解决问题

1. **能力来源扁平**: Agent 原生能力与扩展能力混在一起
2. **插件内容无法按需查询**: 大段 skillText 静态注入，浪费上下文
3. **缺少统一插件查询入口**: 无 `plugin.read_item` 标准工具
4. **缺少 Runtime 合并过程**: Agent 原生能力与插件能力未正式合并

---

## 2. 设计原则确认

### 2.1 核心原则

| 原则 | 说明 |
|------|------|
| 原则1 | 插件目录摘要由 Runtime 自动注入，**不**暴露 `plugin.list_catalog` 给 LLM |
| 原则2 | `plugin.read_item` 是一个标准 `tool_call` 查询工具 |
| 原则3 | 挂载的插件默认视为可用，其 `tools` 默认进入 tools manifest |
| 原则4 | 插件正文不全塞入 prompt，子 Agent 通过目录摘要 + `plugin.read_item` 按需读取 |
| 原则5 | 插件工具返回必须统一适配成平台 `ToolResult`，可沉淀结果走 Artifact 流程 |

### 2.2 能力合并公式

```text
Final Agent Capability = Base Agent Capability + Attached Plugin Capabilities

- 最终 prompt = systemPrompt + base skillText + plugin prompts/skills
- 最终 tools = base allowedTools + plugin tools
- 最终 policy = base contextPolicyJson + plugin contextPolicyPatch
```

---

## 3. 分阶段实施计划

### Phase 1: 定义插件对象模型与目录查询机制

**目标**: 把插件系统的"对象层"定清楚，不急着大改 Runtime

**预计工期**: 2-3 天

#### 任务 1.1: 定义 `AgentPlugin` 正式结构

**文件**: `agent-platform-node/src/modules/plugins/plugin.schema.ts` (新建)

**类型定义**:

```typescript
// 插件类型
export type PluginType = "builtin" | "external";

// 插件状态
export type PluginStatus = "active" | "disabled";

// 插件工具定义
export type PluginToolDefinition = {
  toolId: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
  outputAdapter?: string; // 输出适配器标识
};

// 插件资源定义
export type PluginResourceDefinition = {
  resourceId: string;
  title: string;
  description?: string;
  contentType: "text" | "json" | "html" | "markdown";
  content: string; // 资源正文
};

// 插件 Prompt 定义
export type PluginPromptDefinition = {
  promptId: string;
  title: string;
  description?: string;
  content: string; // Prompt 正文
  usageHint?: string; // 使用场景提示
};

// 插件目录条目
export type PluginCatalogItem = {
  itemId: string;
  itemType: "prompt" | "resource" | "tool";
  title: string;
  description?: string;
};

// 插件目录摘要
export type PluginCatalogSummary = {
  pluginId: string;
  pluginName: string;
  description?: string;
  items: PluginCatalogItem[];
};

// 主插件对象
export type AgentPlugin = {
  pluginId: string;
  pluginType: PluginType;
  name: string;
  description?: string;
  
  // 能力定义
  tools?: PluginToolDefinition[];
  resources?: PluginResourceDefinition[];
  prompts?: PluginPromptDefinition[];
  
  // 目录摘要（运行时生成或预定义）
  catalog?: PluginCatalogSummary;
  
  // 扩展配置
  skillText?: string; // 插件级 skill 补充
  contextPolicyPatch?: Record<string, unknown>;
  
  // 运行时要求
  providerType?: "playwright" | "bb-browser" | "opencli" | "custom";
  runtimeRequirements?: {
    requiresDaemon?: boolean;
    requiresBrowserExtension?: boolean;
    requiresDesktopEnv?: boolean;
  };
  
  // 默认挂载目标
  defaultAttachTargets?: string[]; // Agent 类型列表
  
  status: PluginStatus;
  createdAt: string;
  updatedAt: string;
};

// AgentVersion 与插件的挂载关系
export type AgentVersionPluginBinding = {
  bindingId: string;
  agentVersionId: number;
  pluginId: string;
  enabled: boolean;
  priority?: number; // 加载优先级
  configOverride?: Record<string, unknown>; // 插件配置覆盖
  createdAt: string;
  updatedAt: string;
};
```

**数据库表设计** (Phase 1 可先不建表，用内存/JSON 配置):

```sql
-- 插件表 (后续迁移)
-- agent_plugins
-- - id, plugin_uid, plugin_type, name, description
-- - tools_json, resources_json, prompts_json, catalog_json
-- - skill_text, context_policy_patch_json
-- - provider_type, runtime_requirements_json
-- - default_attach_targets_json
-- - status, created_at, updated_at

-- 挂载关系表 (后续迁移)
-- agent_version_plugin_bindings
-- - id, agent_version_id, plugin_id, enabled, priority
-- - config_override_json, created_at, updated_at
```

**验收标准**:
- [ ] 类型定义文件创建完成
- [ ] 类型通过 TypeScript 检查
- [ ] 类型定义覆盖所有必要字段

---

#### 任务 1.2: 定义插件目录摘要注入格式

**文件**: `agent-platform-node/src/modules/plugins/plugin-catalog.ts` (新建)

**功能**:

```typescript
// 构建插件目录摘要文本（用于注入 Prompt）
export function buildPluginCatalogInjection(
  plugins: AgentPlugin[]
): string {
  // 生成格式：
  // ## 已装载插件
  // 
  // ### {pluginName}
  // {description}
  // 
  // **可用工具**:
  // - {toolId}: {description}
  // 
  // **可用资源**:
  // - {resourceId}: {title} - {description}
  // 
  // **可用提示**:
  // - {promptId}: {title} - {description}
  // 
  // 如需查看具体内容，请使用 `plugin.read_item` 工具查询。
}

// 构建单个插件的目录摘要
export function buildSinglePluginCatalog(
  plugin: AgentPlugin
): PluginCatalogSummary {
  // 汇总插件的 tools/resources/prompts
}
```

**注入格式示例**:

```markdown
## 已装载插件 (2个)

### builtin-browser-core
浏览器基础能力插件，提供网页访问、截图、内容提取等核心功能。

**可用工具**:
- browser.open: 打开指定 URL
- browser.screenshot: 截取当前页面
- browser.extract_page: 提取页面结构化内容

**可用资源**:
- browser-usage-guide: 浏览器工具使用指南
- common-selectors: 常用 CSS 选择器参考

**可用提示**:
- page-analysis-template: 页面分析模板
- screenshot-best-practices: 截图最佳实践

如需查看具体内容，请使用 `plugin.read_item` 工具查询，参数：
- pluginId: "builtin-browser-core"
- itemType: "prompt" | "resource"
- itemId: 上述条目 ID
```

**验收标准**:
- [ ] 目录摘要生成函数实现
- [ ] 格式符合预期，便于 LLM 理解
- [ ] 包含所有必要信息（工具/资源/提示）

---

#### 任务 1.3: 定义 `plugin.read_item` 工具 schema

**文件**: `agent-platform-node/src/modules/plugins/plugin-tools.ts` (新建)

**Tool Schema**:

```typescript
export const pluginReadItemToolDefinition = {
  name: "plugin.read_item",
  description: "读取已装载插件的具体内容（prompt 或 resource）。当需要了解某个插件工具的详细用法、参考模板或资源内容时使用。",
  inputSchema: {
    type: "object",
    properties: {
      pluginId: {
        type: "string",
        description: "插件 ID，例如 'builtin-browser-core'",
      },
      itemType: {
        type: "string",
        enum: ["prompt", "resource"],
        description: "要读取的条目类型",
      },
      itemId: {
        type: "string",
        description: "条目 ID，例如 'page-analysis-template'",
      },
    },
    required: ["pluginId", "itemType", "itemId"],
  },
};

// Handler 类型
export type PluginReadItemInput = {
  pluginId: string;
  itemType: "prompt" | "resource";
  itemId: string;
};

export type PluginReadItemResult = {
  success: boolean;
  pluginId: string;
  itemType: string;
  itemId: string;
  title: string;
  content: string;
  error?: string;
};
```

**Handler 实现**:

```typescript
export async function handlePluginReadItem(
  input: PluginReadItemInput,
  pluginRegistry: PluginRegistry
): Promise<PluginReadItemResult> {
  // 1. 查找插件
  // 2. 根据 itemType 查找对应条目
  // 3. 返回内容
}
```

**验收标准**:
- [ ] Tool schema 定义完成
- [ ] Handler 实现完成
- [ ] 错误处理完善（插件不存在、条目不存在等）

---

#### Phase 1 验收标准

- [ ] `AgentPlugin` 类型定义完整
- [ ] 插件目录摘要生成逻辑完成
- [ ] `plugin.read_item` 工具定义和 handler 完成
- [ ] 所有代码通过 TypeScript 类型检查
- [ ] 文档更新到 DEVELOPMENT_PROGRESS.md

---

### Phase 2: 接入 Runtime 合并逻辑

**目标**: 在后端 Runtime 中把插件能力真正装配进 Agent 运行链路

**预计工期**: 3-4 天

#### 任务 2.1: 创建 PluginRegistry 服务

**文件**: `agent-platform-node/src/modules/plugins/plugin-registry.ts` (新建)

**职责**:
- 管理插件注册表
- 提供插件查询接口
- 管理 AgentVersion 与插件的挂载关系

**接口设计**:

```typescript
export class PluginRegistry {
  // 注册插件
  registerPlugin(plugin: AgentPlugin): void;
  
  // 获取插件
  getPlugin(pluginId: string): AgentPlugin | undefined;
  
  // 获取所有已激活插件
  getActivePlugins(): AgentPlugin[];
  
  // 获取 AgentVersion 挂载的插件
  getPluginsForAgentVersion(agentVersionId: number): AgentPlugin[];
  
  // 加载内置插件
  loadBuiltinPlugins(): Promise<void>;
  
  // 检查插件是否已挂载到 AgentVersion
  isPluginAttached(agentVersionId: number, pluginId: string): boolean;
}
```

**验收标准**:
- [ ] PluginRegistry 实现完成
- [ ] 支持内存存储（当前阶段）
- [ ] 提供完整的插件查询接口

---

#### 任务 2.2: 修改 AgentRuntime 支持插件装载

**文件**: `agent-platform-node/src/runtime/agent-runtime.ts`

**修改点**:

1. **Runtime 构造函数接收 PluginRegistry**:

```typescript
export class AgentRuntime {
  constructor(options?: {
    pluginRegistry?: PluginRegistry;
  }) {
    this.pluginRegistry = options?.pluginRegistry;
  }
}
```

2. **修改 `run` 方法，在运行前合并插件能力**:

```typescript
async run(input: RunInput): Promise<RunResult> {
  // 1. 获取 Agent 原生配置
  const baseCapability = this.extractBaseCapability(input.versionRecord);
  
  // 2. 获取挂载的插件
  const attachedPlugins = this.pluginRegistry?.getPluginsForAgentVersion(
    input.versionRecord.id
  ) ?? [];
  
  // 3. 合并能力
  const mergedCapability = this.mergeCapabilities(
    baseCapability,
    attachedPlugins
  );
  
  // 4. 使用合并后的能力执行
  return this.runWithMergedCapability(input, mergedCapability);
}
```

3. **实现能力合并逻辑**:

```typescript
private mergeCapabilities(
  base: AgentCapability,
  plugins: AgentPlugin[]
): MergedCapability {
  return {
    // Prompt 合并
    systemPrompt: base.systemPrompt,
    skillText: this.mergeSkillText(base.skillText, plugins),
    pluginCatalogInjection: buildPluginCatalogInjection(plugins),
    
    // Tools 合并
    tools: [...base.tools, ...plugins.flatMap(p => p.tools ?? [])],
    
    // Policy 合并
    contextPolicy: this.mergePolicy(base.contextPolicy, plugins),
  };
}
```

4. **修改 `renderSystemMessage`，注入插件目录**:

```typescript
private renderSystemMessage(
  context: PromptContext,
  artifactDirectiveConfig: ArtifactDirectiveConfig,
  pluginCatalog?: string
): string {
  const sections = [
    context.systemPrompt,
    context.skillText ? `\nSkill:\n${context.skillText}` : "",
    // ... 其他基础部分
  ];
  
  // 注入插件目录摘要
  if (pluginCatalog) {
    sections.push("\n## 已装载插件\n", pluginCatalog);
  }
  
  // ... artifact directive 部分
  
  return sections.join("\n");
}
```

**验收标准**:
- [ ] AgentRuntime 支持接收 PluginRegistry
- [ ] 运行前正确合并插件能力
- [ ] 插件目录摘要正确注入 system message
- [ ] 插件工具正确进入 tool manifest

---

#### 任务 2.3: 注册 `plugin.read_item` 为 Runtime 工具

**文件**: `agent-platform-node/src/runtime/tool-runtime.ts` 或新建 `plugin-tool-runtime.ts`

**实现**:

```typescript
// 在 ToolRuntime 中注册 plugin.read_item
export function registerPluginTools(
  toolRuntime: ToolRuntime,
  pluginRegistry: PluginRegistry
): void {
  toolRuntime.registerTool({
    name: "plugin.read_item",
    description: pluginReadItemToolDefinition.description,
    handler: async (input: unknown) => {
      const parsed = pluginReadItemInputSchema.parse(input);
      return handlePluginReadItem(parsed, pluginRegistry);
    },
  });
}
```

**验收标准**:
- [ ] `plugin.read_item` 注册到 ToolRuntime
- [ ] LLM 可以正常调用
- [ ] 调用结果正确返回

---

#### 任务 2.4: 修改 ContextBuilder 支持插件上下文

**文件**: `agent-platform-node/src/runtime/context-builder.ts`

**修改**:

```typescript
export function buildPromptContext(
  input: PromptContextBuildInput,
  pluginContext?: PluginContext
): PromptContext {
  return {
    contextRole: input.contextRole,
    systemPrompt: input.systemPrompt,
    skillText: input.skillText,
    pluginCatalog: pluginContext?.catalogInjection,
    // ... 其他字段
  };
}
```

**验收标准**:
- [ ] ContextBuilder 支持接收插件上下文
- [ ] 插件目录正确进入 PromptContext

---

#### Phase 2 验收标准

- [ ] PluginRegistry 实现完成
- [ ] AgentRuntime 正确合并插件能力
- [ ] 插件目录摘要注入 system message
- [ ] 插件工具进入 tool manifest
- [ ] `plugin.read_item` 可正常调用
- [ ] 所有代码通过 TypeScript 类型检查
- [ ] 文档更新到 DEVELOPMENT_PROGRESS.md

---

### Phase 3: 最小插件验证链路

**目标**: 先不用接真实外部插件，做最小闭环验证

**预计工期**: 2-3 天

#### 任务 3.1: 创建最小内置插件 `builtin-browser-core-docs`

**文件**: `agent-platform-node/src/modules/plugins/builtins/browser-core-docs.ts`

**内容**:

```typescript
export const builtinBrowserCoreDocs: AgentPlugin = {
  pluginId: "builtin-browser-core-docs",
  pluginType: "builtin",
  name: "浏览器基础能力文档",
  description: "提供浏览器工具的使用指南、最佳实践和参考模板",
  
  prompts: [
    {
      promptId: "page-analysis-template",
      title: "页面分析模板",
      description: "分析网页内容的标准模板",
      content: `## 页面分析任务

请按以下步骤分析页面：

1. **页面概述**: 页面主题和主要功能
2. **内容结构**: 主要区块和内容组织
3. **关键信息**: 提取重要数据和文本
4. **交互元素**: 按钮、链接、表单等
5. **结论**: 总结页面价值

输出格式：
- 使用结构化文本
- 关键数据用表格展示
`,
      usageHint: "当需要系统性分析网页内容时使用",
    },
    {
      promptId: "screenshot-best-practices",
      title: "截图最佳实践",
      description: "如何有效使用截图工具",
      content: `## 截图最佳实践

1. **全屏截图**: 用于展示整体页面布局
2. **元素截图**: 用于聚焦特定区域
3. **对比截图**: 用于展示变化

注意事项：
- 确保页面完全加载后再截图
- 注意敏感信息脱敏
`,
      usageHint: "当需要使用 browser.screenshot 工具时参考",
    },
  ],
  
  resources: [
    {
      resourceId: "common-selectors",
      title: "常用 CSS 选择器参考",
      description: "提取页面内容时的常用选择器",
      contentType: "markdown",
      content: `| 目标 | 选择器 |
|------|--------|
| 文章标题 | h1, h2, .title |
| 正文内容 | article, .content, main |
| 链接列表 | a[href], .link |
| 表格数据 | table, tr, td |
`,
    },
  ],
  
  catalog: {
    pluginId: "builtin-browser-core-docs",
    pluginName: "浏览器基础能力文档",
    description: "提供浏览器工具的使用指南、最佳实践和参考模板",
    items: [
      { itemId: "page-analysis-template", itemType: "prompt", title: "页面分析模板", description: "分析网页内容的标准模板" },
      { itemId: "screenshot-best-practices", itemType: "prompt", title: "截图最佳实践", description: "如何有效使用截图工具" },
      { itemId: "common-selectors", itemType: "resource", title: "常用 CSS 选择器参考", description: "提取页面内容时的常用选择器" },
    ],
  },
  
  status: "active",
  createdAt: nowIso(),
  updatedAt: nowIso(),
};
```

**验收标准**:
- [ ] 插件定义完成
- [ ] 包含 prompts 和 resources
- [ ] 目录摘要完整

---

#### 任务 3.2: 创建插件 bootstrap 加载逻辑

**文件**: `agent-platform-node/src/bootstrap/seed-plugins.ts` (新建)

**功能**:

```typescript
export async function seedBuiltinPlugins(registry: PluginRegistry): Promise<void> {
  // 注册内置插件
  registry.registerPlugin(builtinBrowserCoreDocs);
  
  // 后续可扩展：
  // registry.registerPlugin(builtinBrowserPlaywright);
  // registry.registerPlugin(builtinWriterCore);
  
  console.log(`[Bootstrap] 已注册 ${registry.getActivePlugins().length} 个内置插件`);
}
```

**验收标准**:
- [ ] Bootstrap 脚本创建
- [ ] 内置插件正确注册
- [ ] 服务启动时自动加载

---

#### 任务 3.3: 修改 AgentVersion 配置，挂载内置插件

**文件**: `agent-platform-node/src/bootstrap/seed-default-agents.ts`

**修改**:

```typescript
// 在创建 browser_agent 时，默认挂载 builtin-browser-core-docs
export async function seedDefaultAgents(): Promise<void> {
  // ... 现有逻辑
  
  // 为 browser_agent 挂载插件
  // 当前阶段可通过 contextPolicyJson 或硬编码关联
  // 后续通过独立关系表管理
}
```

**验收标准**:
- [ ] BrowserAgent 默认挂载文档插件
- [ ] 其他 Agent 按需挂载

---

#### 任务 3.4: 端到端验证

**验证场景**:

1. **启动验证**:
   - 服务启动后，PluginRegistry 包含 builtin-browser-core-docs
   - AgentRuntime 初始化时传入 PluginRegistry

2. **运行验证**:
   - 创建 BrowserAgent Run
   - 检查 system message 是否包含插件目录摘要
   - 检查 tool manifest 是否包含 plugin.read_item

3. **查询验证**:
   - LLM 调用 `plugin.read_item`
   - 正确返回 prompt/resource 内容
   - 内容进入后续推理

4. **产物验证**:
   - 整个过程产生 RunStep
   - 产物正确沉淀到 Artifact

**验收标准**:
- [ ] 端到端验证通过
- [ ] 插件目录正确注入
- [ ] `plugin.read_item` 可查询
- [ ] 查询结果进入 LLM 上下文
- [ ] 整个过程产生可追踪的 RunStep

---

#### Phase 3 验收标准

- [ ] 最小内置插件创建完成
- [ ] Bootstrap 加载逻辑完成
- [ ] AgentVersion 默认挂载配置完成
- [ ] 端到端验证通过
- [ ] 文档更新到 DEVELOPMENT_PROGRESS.md

---

## 4. 后续扩展计划 (Phase 4+)

### Phase 4: 接入真实浏览器能力插件

| 插件 | 类型 | 说明 |
|------|------|------|
| `builtin-browser-playwright` | 内置 | Playwright 浏览器执行底座 |
| `browser-bb-browser` | 外部 | bb-browser 桌面浏览器能力 |
| `browser-opencli` | 外部 | OpenCLI 浏览器能力 |

### Phase 5: 插件管理后台

- Agent 编辑页面支持选择插件
- 插件启用/禁用/配置
- 插件目录可视化

### Phase 6: 外部插件市场

- 插件安装/卸载
- 版本管理
- 安全校验

---

## 5. 实施时间表

| 阶段 | 任务 | 预计工期 | 依赖 |
|------|------|----------|------|
| Phase 1 | 定义插件对象模型 | 2-3 天 | 无 |
| Phase 1 | 定义目录摘要格式 | 1 天 | 任务 1.1 |
| Phase 1 | 定义 plugin.read_item | 1 天 | 任务 1.1 |
| Phase 2 | PluginRegistry 服务 | 1-2 天 | Phase 1 |
| Phase 2 | Runtime 合并逻辑 | 2 天 | 任务 2.1 |
| Phase 2 | plugin.read_item 注册 | 1 天 | 任务 2.1 |
| Phase 3 | 最小内置插件 | 1 天 | Phase 2 |
| Phase 3 | Bootstrap 加载 | 0.5 天 | 任务 3.1 |
| Phase 3 | 端到端验证 | 1-2 天 | 任务 3.2 |

**总计**: 约 10-14 天

---

## 6. 风险与应对

| 风险 | 影响 | 应对策略 |
|------|------|----------|
| 类型定义反复修改 | 工期延误 | Phase 1 充分评审，确认后再进入 Phase 2 |
| Runtime 合并逻辑复杂 | 引入 Bug | 保持最小改动，充分单元测试 |
| LLM 理解插件目录格式 | 效果不佳 | Phase 3 验证时调优格式 |
| 与现有 artifact 流程冲突 | 产物沉淀异常 | 严格遵循原则 5，统一适配 |

---

## 7. 文档更新计划

每完成一个 Phase，更新以下文档：

1. `docs/agent-platform/DEVELOPMENT_PROGRESS.md`
   - 追加该 Phase 完成记录

2. `docs/agent-platform/MCP_STYLE_PLUGIN_SYSTEM_DESIGN.md`
   - 更新设计细节（如有调整）

3. `docs/agent-platform/PLUGIN_SYSTEM_PHASED_IMPLEMENTATION_PLAN.md`
   - 标记已完成项
   - 调整后续计划（如需）

---

## 8. 下一步行动

等待用户确认本计划后，立即开始：

1. 创建 Phase 1 任务分支
2. 实现 `AgentPlugin` 类型定义
3. 实现插件目录摘要生成逻辑
4. 实现 `plugin.read_item` 工具定义

---

*本计划基于现有设计文档制定，如有调整需求请指出。*
