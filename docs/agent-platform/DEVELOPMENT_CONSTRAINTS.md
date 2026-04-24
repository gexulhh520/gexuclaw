# Agent Platform 开发约束

本文档记录 Agent Platform 正式开发前必须遵守的工程约束。目标是让后续代码结构清晰、行为可追踪、接口可维护、前后端协作稳定。

## 1. 总体约束

- 新 Agent Platform 使用 Node.js / TypeScript 从零开发，目录为 `agent-platform-node/`。
- 不接入旧 Python 后端作为核心实现；旧 Python 只保留现有系统能力。
- 第一阶段优先跑通单 Agent 运行闭环，不提前实现复杂编排。
- 每次开发必须有明确目标、改动范围、验证方式和进度记录。
- 每次完成开发任务后，必须更新 `DEVELOPMENT_PROGRESS.md`。
- 代码结构优先清晰，不为短期跑通牺牲边界。
- 注释要解释“为什么这样做”和复杂流程，不写无意义注释。
- 不引入不必要的新依赖；新增依赖必须说明用途。
- 数据结构、接口入参和返回值必须有 Zod schema 或明确 TypeScript 类型。
- 所有可复盘对象都要有稳定 id，例如 `agent_uid`、`run_uid`、`invocation_uid`。

## 2. 分阶段边界

第一阶段只做：

- agents。
- agent_versions。
- model_profiles。
- agent_runs。
- agent_run_steps。
- model_invocations。
- AgentRuntime 最小循环。
- ModelClient Provider Adapter，默认 Kimi 2.5。
- ToolRuntime 最小白名单过滤。
- Mock browser tool。

第一阶段不做：

- 主 Agent 语义委派。
- WorkContext 复杂阶段推进。
- Artifact 完整血缘。
- Scoped Memory。
- ProjectContext。
- 内置 Agent 专属 UI。
- Python Worker。
- 复杂权限系统。

后续阶段按 `DEVELOPMENT_ROADMAP.md` 推进，不越级堆功能。

## 3. 服务端规范

### 3.1 技术栈

- Runtime：Node.js 20+。
- Language：TypeScript。
- API：Fastify。
- ORM / SQL Builder：Drizzle。
- Validation：Zod。
- LLM：Provider Adapter，第一阶段默认 Kimi 2.5，OpenAI 可选。

### 3.2 目录职责

```text
agent-platform-node/
  src/
    app.ts
    server.ts

    db/
      client.ts
      schema.ts

    modules/
      agents/
      model-profiles/
      runs/
      work-contexts/
      artifacts/
      orchestration/

    runtime/
      agent-runtime.ts
      context-builder.ts
      model-client.ts
      tool-runtime.ts

    tools/
      tool-registry.ts
      tool-types.ts

    bootstrap/
      seed-default-agents.ts

    shared/
      ids.ts
      errors.ts
      json.ts
      time.ts
```

职责约束：

- `*.routes.ts` 只处理 HTTP 入参、调用 service、返回响应。
- `*.schema.ts` 只放 Zod schema、DTO 类型和运行结构。
- `*.service.ts` 放业务动作，不直接写 HTTP 细节。
- `db/schema.ts` 只定义数据库结构，不写业务流程。
- `runtime/` 放 Agent 执行骨架、上下文组装、模型调用和工具执行。
- `tools/` 放工具声明、工具类型和工具注册。
- `shared/` 放无业务依赖的通用能力。

### 3.3 API 规范

- 路径统一使用 `/api/agent-platform/...`。
- 请求体必须经过 Zod 校验。
- 响应结构保持稳定，不让前端猜字段。
- 错误返回要包含 `code`、`message`、必要时包含 `details`。
- 列表接口预留分页字段，即使第一阶段数据量很小。
- 所有创建接口返回新对象的稳定 uid。

推荐响应：

```ts
type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
};
```

### 3.4 数据库规范

- 表名使用复数 snake_case。
- 业务稳定 id 使用 `*_uid`，数据库自增 id 只做内部主键。
- JSON 字段统一以 `_json` 结尾。
- 时间字段统一：`created_at`、`updated_at`，运行类对象增加 `started_at`、`finished_at`。
- `model_invocations` 必须记录 `prompt_context_summary_json` 和 `selected_context_refs_json`。
- 大 payload 不直接塞数据库，保存摘要和 `raw_payload_ref`。
- PostgreSQL 表和关键字段应补 `COMMENT ON TABLE` / `COMMENT ON COLUMN`。
- 代码注释、数据库 comment 和字段说明文档三层都要保持一致。

### 3.5 Runtime 规范

- AgentRun 启动时冻结 AgentVersion snapshot。
- 模型调用必须经过 `model-client.ts`。
- 工具调用必须经过 `tool-runtime.ts`。
- 每次模型调用必须写入 `model_invocations`。
- 每个工具调用必须写入 `agent_run_steps`。
- ContextBuilder 只负责组装 PromptContext，不负责业务决策。
- 主 Agent 委派决策由 MainAgent LLM + skill / playbook 完成，`orchestration.service.ts` 只执行和记录。

### 3.6 注释规范

需要注释：

- AgentRuntime 主循环。
- ContextBuilder 的上下文选择策略。
- Provider Adapter 差异处理。
- 数据血缘、状态流转、幂等处理。
- 非显而易见的错误兜底。

不需要注释：

- 简单赋值。
- 字段同名映射。
- 一眼能看懂的 if / return。

## 4. 前端规范

前端仍优先沿用现有 Vue 3 + TypeScript + Vite 项目风格。Agent Platform 前端后续应放在：

```text
frontend/src/pages/agent-platform/
frontend/src/components/agent-platform/
frontend/src/services/agent-platform.ts
```

### 4.1 页面边界

第一阶段前端只需要支持：

- Agent 列表。
- Agent 创建 / 查看。
- ModelProfile 列表。
- 运行 Agent。
- 查看 AgentRun。
- 查看 AgentRunStep。
- 查看 ModelInvocation 摘要。

暂不做：

- 复杂工作台。
- 多 Agent 编排可视化。
- ProjectContext 管理。
- Memory 管理。
- 高级权限 UI。

### 4.2 组件规范

- 页面组件负责布局和状态编排。
- 业务组件负责单一业务块，例如 AgentCard、RunTimeline、InvocationPanel。
- API 调用放到 service，不直接散在组件中。
- 复杂状态后续再引入 store，第一阶段不为了形式提前上复杂状态管理。
- Props / Emits 必须有 TypeScript 类型。

### 4.3 UI 状态规范

每个接口驱动页面都要考虑：

- loading。
- empty。
- error。
- disabled。
- success feedback。
- 表单校验。
- 请求中的按钮防重复提交。

### 4.4 视觉规范

- 以真实产品工作台为目标，不做临时 demo 风格。
- 信息密度要服务 Agent 调试和运行追踪。
- 日志、步骤、调用记录要可扫描。
- 避免过度装饰，优先清楚、稳定、可读。
- 移动端至少不崩坏，桌面端优先。

## 5. 文档与进度规范

每次开发完成后，必须更新 `DEVELOPMENT_PROGRESS.md`，记录：

- 日期。
- 本次目标。
- 修改文件。
- 完成内容。
- 验证方式。
- 未完成事项。
- 下一步建议。

每次涉及设计变更时，必须同步更新：

- `AGENT_PLATFORM_DESIGN.md`
- `IMPLEMENTATION_PLAN.md`
- `DEVELOPMENT_ROADMAP.md`

如果只是实现既定计划，不需要改设计文档，但仍要更新进度记录。

## 6. 开发前检查清单

每次开始编码前先确认：

- 当前任务属于哪个阶段。
- 是否会越过当前阶段边界。
- 是否需要新增表、接口、工具或依赖。
- 是否影响已有文档中的对象边界。
- 是否需要前端配合。
- 是否有测试或最小验证方式。
- 是否会修改用户已有代码或旧系统代码。

## 7. 完成标准

一项开发任务完成，至少满足：

- 代码结构符合本文档目录职责。
- 核心类型和 schema 完整。
- 关键流程有必要注释。
- 本地能运行或说明无法运行原因。
- 有最小验证记录。
- `DEVELOPMENT_PROGRESS.md` 已更新。
