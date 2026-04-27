# MCP 风格插件系统设计草案

## 1. 文档目标

本文档用于定义 Agent Platform 后续的插件系统设计方向，重点解决以下问题：

1. 如何以 MCP 的能力分类思路来设计插件，但不强行照搬 MCP 传输层。
2. 如何组织 Agent 原生能力与插件扩展能力。
3. 如何区分内置插件与外部插件。
4. 如何让 BrowserAgent 同时获得 Playwright、bb-browser、OpenCLI 这类外部能力，但不直接耦合具体技术实现。
5. 如何保证插件工具输出统一适配到平台 `ToolResult` 与 Artifact 流程中。

本文档主要面向：

- `AgentRuntime`
- `ToolRuntime`
- `WorkContext / Artifact / Run`
- 后续后台管理中的 Agent 能力配置

本文档不覆盖：

- 完整的 MCP JSON-RPC 协议接入
- 插件 marketplace 分发协议
- 远程插件沙箱与安全治理细节
- Artifact version / lineage 的完整设计

---

## 2. 设计原则

### 2.1 遵循 MCP 的能力分类，而不是照搬传输协议

平台后续的插件模型应尽量遵循 MCP 的三类能力组织方式：

- `tools`
- `resources`
- `prompts`

但平台内部仍保留自己的：

- `AgentRuntime`
- `ToolRuntime`
- `WorkContext`
- `Artifact`

也就是说：

**插件系统采用 MCP 风格的能力建模，但运行时与持久化对象继续使用平台自有模型。**

### 2.2 Agent 原生能力与插件扩展能力分离

一个 Agent 的最终能力不应全部写死在 AgentVersion 本体内，而应拆成：

- Agent 原生能力
- 插件扩展能力

最终运行能力在 Runtime 中合并生成。

### 2.3 插件输出不得直接进入系统

无论插件是内置还是外部，工具返回都必须先经过平台统一适配，转换为：

- `ToolResult`
- `artifactCandidates`

再由平台继续推进：

- `ArtifactBuilder`
- `ArtifactCoordinator`
- `WorkContext / Artifact / Run`

**插件不得直接写数据库。**

---

## 3. 能力模型

### 3.1 Agent 原生能力

AgentVersion 当前已经具备的原生能力包括：

- `systemPrompt`
- `skillText`
- `allowedTools`
- `contextPolicyJson`

这部分定义：

**“这个 Agent 本来是谁，以及它的基础能力边界。”**

### 3.2 插件扩展能力

插件扩展能力包括：

- 插件自带 `tools`
- 插件自带 `resources`
- 插件自带 `prompts`/`skillText`
- 插件附带的 `contextPolicyPatch`
- 插件 provider 配置与依赖说明

这部分定义：

**“这个 Agent 额外获得了什么能力。”**

### 3.3 最终能力合并公式

```text
Final Agent Capability
= Base Agent Capability
+ Attached Plugin Capabilities
```

展开后即：

- 最终 prompt = `systemPrompt` + `base skillText` + `plugin prompts/skills`
- 最终 tools = `base allowedTools` + `plugin tools`
- 最终 policy = `base contextPolicyJson` + `plugin contextPolicyPatch`

---

## 4. 插件类型

### 4.1 内置插件（builtin plugins）

特点：

- 平台自带
- 默认可信
- 当前阶段可默认装载
- 适合作为平台基础能力

典型例子：

- `builtin-browser-core`
- `builtin-browser-playwright`
- `builtin-writer-core`
- `builtin-orchestration-core`

### 4.2 外部插件（external plugins）

特点：

- 需要显式安装
- 需要显式挂载到 Agent / AgentVersion
- 适合接第三方生态能力
- 更适合提供专项网站能力或桌面桥接能力

典型例子：

- `browser-bb-browser`
- `browser-opencli`
- 未来可能的站点适配插件

### 4.3 当前阶段装载策略

当前阶段确定如下：

- 内置插件：可以默认装载
- 外部插件：按需显式挂载

后续后台管理阶段：

- 新增/编辑 Agent 时，可以选择内置插件或外部插件
- Agent 的最终能力由“原生能力 + 选中的插件”共同决定

---

## 5. MCP 风格映射

### 5.1 Plugin tools

映射为：

- 可调用工具定义
- 输入 schema
- 输出适配器

例如：

- `browser.open`
- `browser.click`
- `browser.extract_page`
- `browser.screenshot`

### 5.2 Plugin resources

映射为：

- 可供 Agent 读取的上下文资源
- 页面快照
- 站点摘要
- 外部网站结构化结果
- 登录态可用性信息

资源不是 Artifact 本身，但可以成为：

- PromptContext 的输入
- Tool 执行前的参考
- Artifact 派生时的来源之一

### 5.3 Plugin prompts

映射为：

- 插件 skill
- provider-specific usage hints
- 工具使用约束
- artifact directive 的补充说明

插件 prompt 不是永久写回 AgentVersion `skillText`，而是运行时临时合并到最终 prompt context 中。

---

## 6. 插件元数据结构（建议）

当前阶段建议的数据结构如下：

```ts
type AgentPlugin = {
  pluginId: string
  pluginType: "builtin" | "external"
  name: string
  description?: string

  tools?: PluginToolDefinition[]
  resources?: PluginResourceDefinition[]
  prompts?: PluginPromptDefinition[]

  skillText?: string
  contextPolicyPatch?: Record<string, unknown>

  status: "active" | "disabled"
}
```

推荐补充字段：

- `providerType`
  - `playwright`
  - `bb-browser`
  - `opencli`
  - `custom`

- `runtimeRequirements`
  - 是否需要 daemon
  - 是否需要浏览器扩展
  - 是否需要桌面浏览器环境

- `defaultAttachTargets`
  - 默认建议挂载到哪些 Agent 类型

---

## 7. AgentVersion 挂载关系

### 7.1 当前推荐关系

建议明确一层关系：

```ts
type AgentVersionPluginBinding = {
  agentVersionId: string
  pluginId: string
  enabled: boolean
  priority?: number
}
```

### 7.2 当前实现阶段建议

短期可以先通过 JSON 或配置层表达挂载关系。  
中期后台管理上线后，建议独立关系表，方便：

- 查询
- 管理
- 启用/禁用
- 排序

---

## 8. 插件名称与工具名称

### 8.1 插件名称

插件名称用于标识能力包，例如：

- `builtin-browser-core`
- `builtin-browser-playwright`
- `browser-bb-browser`
- `browser-opencli`

### 8.2 工具名称

工具名称用于标识实际能力入口。

当前推荐原则：

- 插件内部可以保留 provider-specific 实现命名
- 平台对 Agent 尽量收敛为统一 browser capability 协议

例如：

- 插件内部实现名：
  - `playwright.open`
  - `bb.snapshot`

- 平台对 Agent 暴露：
  - `browser.open`
  - `browser.snapshot`
  - `browser.extract_page`

目的：

- 避免 Agent 面对多套高度相似但命名不同的工具
- 保持 Prompt 与 Tool schema 稳定
- 降低 provider 切换成本

---

## 9. 插件工具适配层

### 9.1 统一适配约束

无论插件是内置还是外部：

- 插件工具的原始返回
- 都不能直接进入系统

必须先统一转换为平台自己的：

```ts
type ToolResult = {
  success: boolean
  data?: unknown
  error?: string
  meta?: Record<string, unknown>
  artifactCandidates?: ToolArtifactCandidate[]
}
```

### 9.2 外部插件强约束

任何外部插件如果产生可沉淀结果：

- 必须通过 `artifactCandidates`
- 交由平台统一推进 Artifact 流程

即：

```text
Plugin Raw Output
-> Plugin Adapter
-> ToolResult
-> artifactCandidates
-> ArtifactBuilder
-> ArtifactCoordinator
-> WorkContext / Artifact / Run
```

### 9.3 为什么必须统一适配

因为平台后续所有能力都依赖统一对象：

- `RunStep.output`
- `ToolResult`
- `ArtifactCandidates`
- `ArtifactType`
- `ArtifactRole`
- 右侧工作台的产物展示

若插件直接返回任意结构，会导致：

- Agent prompt 不稳定
- Artifact 归类混乱
- 前端无法统一展示

---

## 10. BrowserAgent 插件策略

### 10.1 Playwright

推荐定位：

- 长期服务态浏览器执行底座
- 复杂交互与调试兜底能力
- 更适合作为内置浏览器基础执行插件

建议插件名：

- `builtin-browser-playwright`

### 10.2 bb-browser

推荐定位：

- 桌面态真实浏览器登录态复用
- 网站 adapter 能力
- 更适合作为外部插件

建议插件名：

- `browser-bb-browser`

### 10.3 OpenCLI

推荐定位：

- 外部浏览器/站点能力插件候选
- 可作为外部插件保留

建议插件名：

- `browser-opencli`

### 10.4 推荐组合

BrowserAgent 后续推荐能力组合：

- 默认内置：
  - `builtin-browser-core`
  - `builtin-browser-playwright`

- 可选外部：
  - `browser-bb-browser`
  - `browser-opencli`

这样：

- 没有外部插件时，仍有平台自带浏览器执行能力
- 挂上外部插件后，获得真实登录态/站点适配等增强能力

---

## 11. Runtime 合并职责

运行时应完成以下职责：

1. 读取 Agent 原生能力
2. 读取已挂载插件列表
3. 合并：
   - tools
   - resources
   - prompts / skill
   - contextPolicy
4. 将插件工具注册进统一 ToolRuntime
5. 确保插件工具输出统一适配为 `ToolResult`

### 11.1 冲突策略建议

- Prompt 合并：
  - `systemPrompt`
  - `base skill`
  - `plugin prompts`

- Tool 合并：
  - 原生 tools 在前
  - 插件 tools 追加
  - 对 Agent 暴露的工具名尽量统一

- Policy 合并：
  - Agent 原生 policy 为主
  - 插件 policy patch 补充命名空间

---

## 12. 后台管理方向

后续后台管理在新增/编辑 Agent 时，建议支持：

- 查看插件池
- 区分内置插件 / 外部插件
- 选择挂载的插件集合
- 配置插件优先级
- 查看插件运行依赖说明

目标是实现：

**Agent = 默认角色 + 可选装备**

---

## 13. 当前实现建议

### 阶段一

- 不立即引入完整 marketplace
- 先在后端实现：
  - 插件元数据模型
  - 插件装载逻辑
  - 工具结果适配层

### 阶段二

- 将 Browser 能力拆成：
  - `builtin-browser-playwright`
  - `browser-bb-browser`
  - `browser-opencli`

### 阶段三

- 后台 Agent 管理界面支持插件选择
- 将 AgentVersion 挂载插件配置化

---

## 14. 最终结论

平台后续应采用：

**MCP 风格能力建模 + 平台自有运行时与对象模型**

核心原则是：

- 插件分内置与外部
- Agent 原生能力与插件扩展能力分离
- BrowserAgent 不直接绑定 конкретe 技术实现
- 外部插件输出必须统一适配为平台 `ToolResult`
- Artifact 流程只由平台负责推进

这将使后续：

- Browser 能力扩展
- 站点能力接入
- 后台可配置 Agent
- Artifact 标准化沉淀

都建立在同一套稳定模型之上。
