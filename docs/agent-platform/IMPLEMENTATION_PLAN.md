# Agent 平台第一阶段实施计划（Node.js / TypeScript）

本文档用于记录 Agent Platform 第一阶段的实际开发计划。

当前决策：

- 新 Agent Platform 主服务使用 Node.js / TypeScript 从零实现。
- 不在旧 Python 后端新增 `backend/agent_platform` 主实现。
- 旧 Python 后端保留现有系统能力，后续可作为 Tool Worker 接入。
- 总路线以 `DEVELOPMENT_ROADMAP.md` 为准；本文只展开第一阶段。

## 1. 第一阶段目标

第一阶段只做一个最小闭环：

```text
创建 Agent -> 发布 AgentVersion -> 绑定 ModelProfile -> 运行 Agent -> 记录 AgentRun / AgentRunStep / ModelInvocation
```

完成后应能做到：

- 创建 ModelProfile。
- 创建 Agent。
- 发布 AgentVersion。
- 给 AgentVersion 配置 allowed_tools。
- 调用 API 运行 Agent。
- Runtime 只向 LLM 暴露 allowed_tools。
- 保存 agent_runs。
- 保存 agent_run_steps。
- 保存 model_invocations。
- 返回 run_id、状态、摘要和步骤数量。

第一阶段验收场景：

```text
调用 Node API，让 BrowserAgent 执行“访问百度”，只能看到 browser 工具，并留下完整 run steps 和 model invocation。
```

## 2. 第一阶段不做

- 不接旧 Python 主 Agent。
- 不做主 Agent 语义委派。
- 不做 orchestration_events 完整链路。
- 不做 WorkContext 复杂阶段推进。
- 不做 Artifact 血缘完整维护。
- 不做 Scoped Memory。
- 不做 ProjectContext。
- 不做内置 Agent 专属 UI。
- 不做复杂权限体系。
- 不做 Python Worker。

## 3. 技术栈

- Runtime：Node.js 20+
- Language：TypeScript
- API Framework：Fastify
- ORM / SQL Builder：Drizzle
- Schema Validation：Zod
- Database：PostgreSQL
- LLM：Provider Adapter 优先，默认 Kimi 2.5；OpenAI 作为可选 provider
- Realtime：第一阶段暂不做，后续优先 SSE
- Queue：第一阶段暂不做，后续 BullMQ + Redis

## 4. 代码目录

```text
agent-platform-node/
  package.json
  tsconfig.json
  .env.example

  src/
    app.ts
    server.ts

    db/
      client.ts
      schema.ts

    modules/
      agents/
        agent.schema.ts
        agent.service.ts
        agent.routes.ts

      model-profiles/
        model-profile.schema.ts
        model-profile.service.ts
        model-profile.routes.ts

      runs/
        run.schema.ts
        run.service.ts
        run.routes.ts

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

## 5. 第一阶段核心表

第一阶段先建 6 张表：

- agents
- agent_versions
- model_profiles
- agent_runs
- agent_run_steps
- model_invocations

第二阶段再建：

- work_contexts
- agent_artifacts

第三阶段再建：

- orchestration_events

## 6. 表字段草案

核心表的中文字段解释见：

- `CORE_TABLE_FIELDS.md`

### 6.1 agents

- id
- agent_uid
- name
- type：custom / builtin / main
- description
- capabilities_json
- owner_user_id
- current_version_id
- standalone_enabled
- subagent_enabled
- ui_mode
- ui_route
- status
- created_at
- updated_at

### 6.2 agent_versions

- id
- agent_id
- version
- model_profile_id
- system_prompt
- skill_text
- allowed_tools_json
- context_policy_json
- model_params_override_json
- output_schema_json
- max_steps
- status
- published_at
- created_at
- updated_at

### 6.3 model_profiles

- id
- profile_uid
- name
- provider
- model_name
- base_url
- capability_json
- default_params_json
- max_context_tokens
- status
- created_at
- updated_at

### 6.4 agent_runs

- id
- run_uid
- agent_id
- agent_version_id
- user_id
- session_id
- work_context_id：第一阶段可为空
- parent_orchestration_event_id：第一阶段可为空
- parent_run_id
- mode：standalone / subagent / main
- status：queued / running / success / failed / cancelled / needs_clarification
- user_message
- handoff_note
- delegate_envelope_json
- input_artifact_ids_json
- output_artifact_ids_json
- snapshot_json
- context_package_summary_json
- result_summary
- output_json
- error_message
- started_at
- finished_at
- created_at
- updated_at

### 6.5 agent_run_steps

- id
- run_id
- step_index
- step_type：model_call / tool_start / tool_end / observation / final / error
- content
- tool_name
- tool_call_id
- tool_status
- input_json
- output_json
- metadata_json
- created_at

### 6.6 model_invocations

- id
- invocation_uid
- run_id
- step_id
- model_profile_id
- provider
- model_name
- params_json
- request_summary_json
- response_summary_json
- raw_payload_ref
- prompt_context_summary_json
- selected_context_refs_json
- input_tokens
- output_tokens
- latency_ms
- status
- error_message
- created_at

第一阶段就要记录本次模型调用使用了哪些上下文来源，但不需要保存完整聊天历史或完整 prompt：

- `request_summary_json`：模型请求摘要，例如 user_message、system prompt 版本、工具数量。
- `prompt_context_summary_json`：PromptContext 的摘要，例如包含了哪些模块、token 预算、是否使用 conversation_summary。
- `selected_context_refs_json`：被选入上下文的 refs，例如 message ids、work_context_id、run_trace ids、artifact ids、memory ids。
- `raw_payload_ref`：可选，指向对象存储或本地调试文件；默认不把完整 prompt 明文塞进数据库。

## 7. 第一阶段 API

### 7.1 ModelProfile

```text
POST /api/agent-platform/model-profiles
GET  /api/agent-platform/model-profiles
```

### 7.2 Agent

```text
POST /api/agent-platform/agents
GET  /api/agent-platform/agents
GET  /api/agent-platform/agents/:agentUid
```

### 7.3 AgentVersion

```text
POST /api/agent-platform/agents/:agentUid/versions
GET  /api/agent-platform/agents/:agentUid/versions
```

### 7.4 Run

```text
POST /api/agent-platform/agents/:agentUid/runs
GET  /api/agent-platform/runs/:runUid
GET  /api/agent-platform/runs/:runUid/steps
```

## 8. Runtime 执行流程

```text
load Agent
load current AgentVersion
load ModelProfile
create AgentRun(status=running)
freeze snapshot
build messages from user_message + handoff_note + system_prompt + skill_text
load allowed tool operations
loop until max_steps:
  call model
  record ModelInvocation
  record model_call step
  if model returns tool calls:
    validate tool name in allowed_tools
    record tool_start step
    execute tool
    record tool_end step
    append tool result to messages
  else:
    record final step
    mark AgentRun success
    return result
on exception:
  record error step
  mark AgentRun failed
```

## 9. ToolRuntime 第一版

第一阶段可以先做 Node 内置工具注册：

```text
tool-registry.ts
tool-runtime.ts
tool-types.ts
```

接口：

```ts
type ToolDefinition = {
  name: string
  description: string
  parameters: unknown
}

type ToolResult = {
  success: boolean
  data?: unknown
  error?: string
  meta?: Record<string, unknown>
}
```

规则：

- LLM 只能看到 AgentVersion.allowed_tools_json 中允许的工具。
- 工具执行前再次校验 allowed_tools。
- 第一阶段可以先注册一个 mock browser 工具，后续再接真实浏览器服务。

## 10. ModelClient 第一版

第一阶段先支持：

- Kimi provider，按 OpenAI-compatible API 方式接入。
- OpenAI provider 可选，不作为第一阶段必需依赖。
- model name 来自 ModelProfile。
- default params 来自 ModelProfile.default_params_json。
- override params 来自 AgentVersion.model_params_override_json。
- 记录 usage、latency、status 到 model_invocations。

后续再扩：

- DeepSeek。
- Qwen。
- Anthropic。
- Gemini。
- Local model。

环境变量建议：

```env
DEFAULT_MODEL_PROVIDER=kimi

KIMI_API_KEY=
KIMI_BASE_URL=https://api.moonshot.cn/v1
KIMI_DEFAULT_MODEL=kimi-k2.5

OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_DEFAULT_MODEL=gpt-5-mini
```

## 11. Bootstrap

第一阶段初始化：

- 默认 ModelProfile：`main_agent_default`，provider 为 `kimi`，model_name 使用 `KIMI_DEFAULT_MODEL`。
- 默认 ModelProfile：`browser_agent_default`，provider 为 `kimi`，model_name 使用 `KIMI_DEFAULT_MODEL`。
- 默认 ModelProfile：`summary_default`，provider 为 `kimi`，model_name 使用 `KIMI_DEFAULT_MODEL`。
- 内置 BrowserAgent：`builtin_browser_agent`。
- BrowserAgent 第一版 allowed_tools：`browser.open` / `browser.get_page_info` 或 mock 工具。

## 12. 验收标准

- `npm run dev` 可以启动 Node 服务。
- Drizzle schema 能创建 6 张核心表。
- 可以创建 ModelProfile。
- 可以创建 Agent。
- 可以发布 AgentVersion。
- 可以运行 Agent。
- Agent 运行时只暴露 allowed_tools。
- 每次模型调用写入 model_invocations。
- 每个工具调用写入 agent_run_steps。
- API 可以查看 run 和 steps。

## 13. 下一阶段入口

第一阶段完成后进入 Phase 2：

- 新增 work_contexts。
- 新增 agent_artifacts。
- AgentRun 关联 work_context_id。
- WorkContext 保存 run_refs_json / artifact_refs_json。
- 跑通 CodexAgent 生成网页和截图场景。
