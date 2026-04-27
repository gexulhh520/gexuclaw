# 插件系统分阶段落地设计（面向 BrowserAgent 与子 Agent 插件能力装载）

## 1. 文档目标

本文档用于规划 Agent Platform 下一阶段的插件系统落地工作，重点围绕：

- `AgentPlugin` 正式结构
- 插件目录摘要的注入格式
- `plugin.read_item` 查询工具
- Runtime 合并逻辑

本文档回答两个问题：

1. 当前系统哪块能力需要优化？
2. 插件系统应如何按阶段落地，避免一次性做大做乱？

---

## 2. 当前需要优化的功能

当前系统已经具备：

- Agent 原生 `systemPrompt / skillText / allowedTools / contextPolicy`
- `ToolRuntime`
- `Run / RunStep`
- `WorkContext / Artifact`
- `artifactCandidates`
- 右侧工作台 `上下文 / 产物 / 执行过程`

但在“子 Agent 如何获得并使用扩展能力”这件事上，当前仍有明显不足：

### 2.1 能力来源仍然过于扁平

当前能力几乎都塞在：

- `AgentVersion.systemPrompt`
- `AgentVersion.skillText`
- `AgentVersion.allowedTools`
- `AgentVersion.contextPolicyJson`

这意味着：

- Agent 原生能力与外部扩展能力混在一起
- 后续接 Playwright / bb-browser / OpenCLI 时，容易直接耦合到 BrowserAgent 本体
- 不利于后台管理中“按 Agent 选择能力包”

### 2.2 插件内容无法按需查询

当前如果我们把插件规则、文档、资源直接拼进 `skillText`，会产生几个问题：

- prompt 过长
- 插件说明难以维护
- 规则、资源、参考资料全部静态注入，浪费上下文
- 子 Agent 无法“先看目录，再按需读正文”

### 2.3 缺少统一插件查询入口

当前 Runtime 有工具调用，但没有面向插件内容查询的标准工具。

我们已经达成的设计结论是：

- 不暴露 `plugin.list_catalog` 给 LLM
- Runtime 直接注入插件目录摘要
- LLM 按需通过 `plugin.read_item` 查询具体内容

当前这部分还未正式建模。

### 2.4 缺少插件能力与 Runtime 的统一合并过程

当前还没有正式定义：

- Agent 原生能力如何和插件能力合并
- 挂载插件后，它的 tools 如何进入 tool manifest
- 插件目录摘要如何进入 prompt context
- 插件查询工具如何进入 LLM tools

这意味着 Runtime 层的能力装配还没有形成稳定模型。

---

## 3. 本次插件系统优化目标

本次优化的核心目标不是“立刻做完整插件平台”，而是先把插件系统最关键的骨架搭起来。

### 目标一：把 Agent 原生能力与插件扩展能力分离

Agent 自带：

- `systemPrompt`
- `skillText`
- `allowedTools`
- `contextPolicyJson`

插件扩展提供：

- tools
- resources
- prompts
- plugin catalog
- contextPolicyPatch

### 目标二：让子 Agent 具备“目录驱动的按需查询能力”

子 Agent 启动时只拿：

- 自己的最小 `skillText`
- 已挂载插件的目录摘要

真正需要时，再通过：

- `plugin.read_item`

读取具体 prompt/resource 内容。

### 目标三：让插件工具返回继续统一适配到平台 ToolResult / Artifact 流程

无论是内置插件还是外部插件：

- 工具返回都必须统一适配为 `ToolResult`
- 可沉淀内容通过 `artifactCandidates`
- 最终由平台继续走 `ArtifactBuilder / ArtifactCoordinator`

这条原则不改变。

---

## 4. 分阶段落地计划

---

## Phase 1：定义插件对象模型与目录查询机制

### 4.1 本阶段目标

先把插件系统的“对象层”定清楚，不急着大改 Runtime。

目标包括：

1. 定 `AgentPlugin` 正式结构
2. 定插件目录摘要结构
3. 定 `plugin.read_item` 的 tool schema 和返回结构

### 4.2 需要完成的设计项

#### A. 定义 `AgentPlugin` 正式结构

需要明确：

- `pluginId`
- `pluginType`
- `name`
- `description`
- `tools`
- `resources`
- `prompts`
- `catalog`
- `contextPolicyPatch`
- `status`

设计重点：

- 插件分 `builtin` / `external`
- `tools/resources/prompts` 分层明确
- 插件目录作为一等对象存在
- 插件不再依赖单一长 `skillText` 承载所有说明

#### B. 定义插件目录摘要结构

插件目录摘要应存：

- 插件总述
- prompt 条目摘要
- resource 条目摘要
- tool 条目摘要

目录摘要是给 Runtime 注入到 Agent 上下文中的，不是给 LLM 调 `list_catalog` 查出来的。

#### C. 定义 `plugin.read_item`

最小 schema：

```ts
type PluginReadItemInput = {
  pluginId: string
  itemType: "prompt" | "resource"
  itemId: string
}
```

返回结构：

- `pluginId`
- `itemType`
- `itemId`
- `title`
- `content`

### 4.3 本阶段产出

- 正式类型定义草案
- 插件目录摘要注入格式
- `plugin.read_item` 工具 schema

### 4.4 本阶段重点优化当前什么功能

优化当前“插件能力无法结构化表达”的问题。

也就是从：

- 大段 skill 拼接

升级到：

- 插件对象
- 插件目录
- 查询式读取

---

## Phase 2：接入 Runtime 合并逻辑

### 5.1 本阶段目标

在后端 Runtime 中把插件能力真正装配进 Agent 运行链路。

目标包括：

1. Agent 原生能力与插件能力的合并
2. 插件目录摘要注入 prompt context
3. 挂载插件的 tools 进入 LLM tool manifest
4. `plugin.read_item` 作为标准 tool_call 工具进入 Runtime

### 5.2 需要完成的实现项

#### A. Runtime 插件装载流程

运行前应完成：

- 读取 Agent 原生配置
- 读取已挂载插件集合
- 合并 plugin prompts/resources/tools/policy

#### B. 注入目录摘要

Runtime 在 system/context 中直接注入：

- 已挂载插件目录摘要

不暴露 `plugin.list_catalog` 给 LLM。

#### C. 注册 `plugin.read_item`

Runtime 将 `plugin.read_item` 注册为普通 tool。

这样子 Agent 可以通过 LLM 自己决定：

- 看哪个插件项
- 看 prompt 还是 resource

#### D. 工具合并

已挂载插件的 `tools` 默认进入最终 tool manifest。

前提规则：

- 挂载的插件默认视为已安装、已校验、可用

### 5.3 本阶段产出

- Runtime 插件装载逻辑
- 插件目录摘要注入逻辑
- `plugin.read_item` 工具 handler
- 最终 tool manifest 合并逻辑

### 5.4 本阶段重点优化当前什么功能

优化当前“Agent 运行时无法按插件能力动态装配”的问题。

也就是从：

- Agent 固定 skill + fixed tools

升级到：

- Agent 原生能力 + 插件动态扩展能力

---

## Phase 3：最小插件验证链路

### 6.1 本阶段目标

先不用一开始接真实外部插件，先做最小闭环验证。

建议先做一个最小内置插件：

- `builtin-browser-core-docs`
或
- `builtin-browser-plugin-catalog-demo`

它只提供：

- 一个插件目录
- 1~2 个 prompts
- 1~2 个 resources
- 可通过 `plugin.read_item` 查询

### 6.2 验证点

验证子 Agent 是否能够：

1. 启动时看到目录摘要
2. 因任务需要主动触发 `plugin.read_item`
3. 查询内容回到 LLM 后继续推理
4. 整个过程进入 `RunStep`

### 6.3 后续再扩展

最小闭环稳定后，再接：

- `builtin-browser-playwright`
- `browser-bb-browser`
- `browser-opencli`

### 6.4 本阶段重点优化当前什么功能

优化当前“插件系统还只是设计，尚未形成可验证执行闭环”的问题。

---

## 5. 当前建议的实现顺序

按当前阶段，最合理的开发顺序是：

1. 定 `AgentPlugin` 正式结构
2. 定插件目录摘要的注入格式
3. 定 `plugin.read_item` schema 和返回结构
4. 做 Runtime 合并逻辑
5. 接最小内置插件验证链路

这是因为：

- 先把对象定义清楚，后面 Runtime 才不会反复返工
- 先把目录/查询方式定清楚，才能避免再走“全量静态注入”的老路
- 先接最小内置插件，再上 Playwright / bb-browser / OpenCLI，风险最低

---

## 6. 当前阶段建议的设计原则

### 原则 1
插件目录摘要由 Runtime 自动注入，**不**暴露 `plugin.list_catalog` 给 LLM。

### 原则 2
`plugin.read_item` 是一个标准 `tool_call` 查询工具。

### 原则 3
挂载的插件默认视为可用，其 `tools` 默认进入该 Agent 本轮运行的 tools manifest。

### 原则 4
插件正文不全塞入 prompt，子 Agent 通过目录摘要 + `plugin.read_item` 按需读取。

### 原则 5
插件工具返回必须统一适配成平台 `ToolResult`，可沉淀结果继续走 Artifact 流程。

---

## 7. 下一步建议

建议下一轮工作直接产出：

1. `AgentPlugin` 正式类型定义
2. `PluginCatalogSummary` 类型定义
3. `plugin.read_item` tool schema
4. Runtime 合并流程草图

当这四项明确以后，再进入具体代码实现会更稳。
