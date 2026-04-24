# Agent 平台开发路线图

本文档用于描述 Agent 平台从最小可用到逐步做强的开发目录和阶段计划。

核心策略：

- 先重建干净底座，不背旧表包袱。
- Agent Platform 主服务切到 Node.js / TypeScript 实现。
- 旧 Python 后端暂时不承载新 Agent Platform，只作为现有系统和未来工具 Worker 的候选。
- 先跑通单 Agent，再做主 Agent 语义委派。
- 先记录 RunTrace 和 Artifact，再做记忆沉淀。
- 先用 JSON 保持灵活，再把高频稳定结构拆成独立表。
- 每个阶段都要有可验证场景，不只堆模型和表。

## 1. 总体目标

最终平台应支持：

- 用户创建和运行自定义 Agent。
- 系统内置专职 Agent，例如 BrowserAgent、ScheduledTaskAgent、CodexAgent、ImageAgent、DesignSpecAgent。
- 主 Agent 通过语义委派组织多个子 Agent 协作。
- WorkContext 承载一件工作的阶段、调度、执行和产物血缘。
- 子 Agent 根据自身 LLM 和 ContextPolicy 自主理解任务、读取上下文、调用工具或返回澄清请求。
- RunTrace 记录事实执行过程。
- Artifact 承载跨 Agent 协作产物。
- Scoped Memory 从 RunTrace、Artifact 和用户表达中逐步沉淀。
- ModelProfile 管理不同 Agent 的模型底座。

## 2. 第一版核心表

第一版建议重建 9 张核心表：

- agents
- agent_versions
- model_profiles
- work_contexts
- orchestration_events
- agent_runs
- agent_run_steps
- agent_artifacts
- model_invocations

第一版暂不建：

- model_providers
- context_policies
- project_contexts
- scoped_memories
- agent_experiences
- agent_tool_profiles
- agent_skills
- artifact_versions

这些先通过 JSON 字段预留能力，等流程跑稳后再拆。

## 3. 技术栈决策

Agent Platform 主服务使用 Node.js / TypeScript 从零实现。

推荐技术栈：

- Runtime：Node.js 20+
- Language：TypeScript
- API Framework：Fastify
- ORM / SQL Builder：Drizzle
- Schema Validation：Zod
- Database：PostgreSQL
- Vector：PostgreSQL + pgvector，后续可接 Qdrant / Pinecone
- Queue：BullMQ + Redis，第二阶段后再引入
- Realtime：SSE first，WebSocket later
- LLM：Provider Adapter 优先，默认 Kimi 2.5；OpenAI 作为可选 provider，后续扩展 Anthropic / Gemini / DeepSeek / Qwen
- Agent Graph：第一版自研 AgentRuntime；复杂 Agent 内部循环后续可接 LangGraph.js
- RAG / Loaders：LangChain.js / LlamaIndex.TS
- Complex Document Parsing：LlamaParse API 或 Python Tool Worker

Python 的定位：

- 不作为新 Agent Platform 主服务。
- 保留旧系统能力。
- 后续可作为工具 Worker，处理浏览器自动化、复杂文档解析、OCR、数据分析、向量处理等 Node 生态不够顺手的任务。

原则：

- Node.js 负责平台、API、实时事件、运行记录、WorkContext、AgentRuntime 和多 Agent 协作。
- Python 只通过工具协议或 Worker API 接入，不参与核心对象模型。
- 第一阶段不依赖 OpenAI 充值；默认模型配置使用 Kimi 2.5。

## 4. 推荐代码目录

Node 主服务目录：

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
      migrations/

    modules/
      agents/
        agent.schema.ts
        agent.service.ts
        agent.routes.ts

      model-profiles/
        model-profile.schema.ts
        model-profile.service.ts
        model-profile.routes.ts

      work-contexts/
        work-context.schema.ts
        work-context.service.ts
        work-context.routes.ts

      runs/
        run.schema.ts
        run.service.ts
        run.routes.ts

      artifacts/
        artifact.schema.ts
        artifact.service.ts
        artifact.routes.ts

      orchestration/
        delegate-envelope.schema.ts
        orchestration.service.ts

      runtime/
        agent-runtime.ts
        context-builder.ts
        model-client.ts
        tool-runtime.ts

      tools/
        tool-registry.ts
        tool-types.ts
        builtin/

      bootstrap/
        seed-default-agents.ts

    shared/
      ids.ts
      errors.ts
      json.ts
      time.ts
```

职责：

- `db/schema.ts`：9 张核心表的 Drizzle schema。
- `*.schema.ts`：Zod 请求、响应、运行结果、DelegateEnvelope schema。
- `*.service.ts`：Agent、AgentVersion、ModelProfile、WorkContext 等业务服务。
- `agent-runtime.ts`：AgentRuntime 主执行循环。
- `model-client.ts`：统一模型调用、usage、错误处理。
- `context-builder.ts`：根据 ContextPolicy 组装 PromptContext，负责最近消息、conversation_summary、WorkContext 摘要、RunTrace 摘要、Artifact 摘要和 Scoped Memory 的选择。
- `tool-runtime.ts`：allowed_tools 过滤、工具执行封装。
- `artifact.service.ts`：Artifact 创建、读取、血缘维护。
- `orchestration.service.ts`：执行 MainAgent LLM + skill 已决定的编排动作，记录委派事件、阶段推进和澄清闭环。
- `seed-default-agents.ts`：内置 Agent 和默认 ModelProfile 初始化。

旧 Python 后端暂时不新增 `backend/agent_platform` 作为主实现。若后续需要 Python 能力，通过 tool worker 或 HTTP worker 接入。

前端目录可后续增加：

```text
frontend/src/pages/agent-platform/
frontend/src/components/agent-platform/
frontend/src/services/agent-platform.ts
```

## 5. Phase 0：设计冻结与建表准备

目标：

- 冻结第一版对象边界。
- 明确不兼容旧表，直接新建。
- 输出数据库模型和 API 草案。

交付物：

- `AGENT_PLATFORM_DESIGN.md` 对齐完成。
- `IMPLEMENTATION_PLAN.md` 对齐完成。
- `DEVELOPMENT_CONSTRAINTS.md` 对齐完成。
- `DEVELOPMENT_PROGRESS.md` 建立并持续更新。
- 9 张核心表字段草案确认。
- 内置 Agent 第一批名单确认。

验收：

- 能解释清楚 Agent、AgentVersion、ModelProfile、WorkContext、RunTrace、Artifact、OrchestrationEvent 的边界。
- 能解释清楚主 Agent 语义委派不是函数调用。
- 能解释清楚 chat_messages 是原始记录，PromptContext 才是每次真正传给 LLM 的上下文包。
- 能解释清楚 MainAgent PromptContext 偏调度视角，SubAgent PromptContext 偏专业执行视角。

## 6. Phase 1：单 Agent 运行底座

目标：

- 跑通一个 Agent 按自己的工具白名单运行一次。
- 留下 AgentRun、AgentRunStep、ModelInvocation。

范围：

- agents
- agent_versions
- model_profiles
- agent_runs
- agent_run_steps
- model_invocations
- allowed_tools 过滤
- AgentRuntime 简单循环

暂不做：

- 主 Agent 调度子 Agent。
- WorkContext 复杂阶段推进。
- Artifact 血缘完整维护。
- Memory。

验收场景：

```text
调用 API，让 BrowserAgent 执行“访问百度”，只能看到 browser 工具，并留下完整 run steps 和 model invocation。
```

完成标准：

- AgentVersion 可以绑定 ModelProfile。
- Runtime 可以加载 system_prompt、skill_text、allowed_tools。
- 工具调用前后写入 AgentRunStep。
- 模型调用写入 ModelInvocation。
- AgentRun 返回 status、summary、steps_count。

## 7. Phase 2：WorkContext 与 Artifact

目标：

- 让一次工作有明确容器。
- 让代码、截图、设计图、文档等产物成为一等对象。

范围：

- work_contexts
- agent_artifacts
- AgentRun 关联 work_context_id
- WorkContext 的 run_refs_json / artifact_refs_json
- Artifact 的 source_run_id / source_artifact_ids_json

验收场景：

```text
CodexAgent 生成一个简单产品网页，保存代码 Artifact，并生成页面截图 Artifact。
```

完成标准：

- 新工作可创建 WorkContext。
- AgentRun 可挂到 WorkContext。
- Artifact 可挂到 WorkContext。
- WorkContext 能展示当前 state、run_refs、artifact_refs。
- run_refs 不是纯 run id，能记录 stage、role、输入产物、输出产物。

## 8. Phase 3：主 Agent 语义委派

目标：

- 主 Agent 能通过 DelegateEnvelope 委派子 Agent。
- 子 Agent 根据 WorkContext 和 ContextPolicy 自主读取上下文。

范围：

- orchestration_events
- DelegateEnvelope
- handoff_note
- authority
- ContextPolicy JSON
- 子 Agent needs_clarification 返回

验收场景：

```text
用户：访问百度
主 Agent：创建或复用 WorkContext，委派 BrowserAgent
用户：形成定时任务
主 Agent：发送 DelegateEnvelope 给 ScheduledTaskAgent
ScheduledTaskAgent：自行读取当前 WorkContext 下相关 RunTrace，生成草案或返回澄清问题
```

完成标准：

- 主 Agent 不传完整业务参数，不把子 Agent 当函数调用。
- OrchestrationEvent 能记录委派事实。
- AgentRun 能记录 parent_orchestration_event_id。
- 子 Agent 能基于 ContextPolicy 组装上下文包。
- 子 Agent 可以返回 `success / failed / needs_clarification`。

## 9. Phase 4：产物驱动多 Agent 工作流

目标：

- 验证 WorkContext 下多个 Agent 围绕 Artifact 串联工作。
- 跑通 UI 设计和还原链路。

验收场景：

```text
1. Codex 生成简单产品网页。
2. ImageAgent 基于网页截图生成更漂亮 UI 图。
3. DesignSpecAgent 基于 UI 图生成 UI 规范。
4. CodexAgent 依照 UI 规范和截图还原页面。
```

产物链：

```text
初版代码
  -> 初版截图
  -> 优化 UI 设计图
  -> UI 规范完整版
  -> 还原后的代码
  -> 还原后的页面截图
```

完成标准：

- 每个 AgentRun 都能说明由哪个 OrchestrationEvent 触发。
- 每个 Artifact 都能说明来源 run 和来源 artifact。
- WorkContext 能展示当前最新设计图、最新规范、最新代码和最新截图。
- CodexAgent 能按当前 WorkContext 中的 UI 图和 UI 规范完成还原。

## 10. Phase 5：内置专职 Agent 工作台

目标：

- 为高频内置 Agent 做专属 UI。
- 先做能产生价值的工作台，不做大而全。

候选顺序：

1. ScheduledTaskAgent 工作台。
2. BrowserAgent 运行轨迹查看。
3. CodexAgent 代码和截图对比。
4. DesignSpecAgent 规范查看器。
5. ImageAgent 设计图版本查看。

完成标准：

- 用户可以查看 WorkContext 下的 runs 和 artifacts。
- 用户可以确认草案、选择产物、继续委派。
- 用户可以看到子 Agent 当前状态和结果。

## 11. Phase 6：Scoped Memory 与经验沉淀

目标：

- 从 RunTrace、Artifact 和用户明确表达中沉淀记忆。
- 记忆有明确 scope，不变成无边界大池子。

范围：

- scoped_memories
- memory_type
- scope_type / scope_id
- source_refs_json
- memory retrieval

默认规则：

- 自动沉淀 work_context / session 级记忆。
- project / user 级记忆需要用户明确表达或确认。
- RunTrace 不是 Memory，但可以作为 Memory 来源。

完成标准：

- 子 Agent 可以按 ContextPolicy 检索少量相关 Memory。
- Memory 能引用来源 RunTrace、Artifact、WorkContext 或用户消息。
- 记忆不会跨 scope 泄漏。

## 12. Phase 7：ProjectContext 与长期项目

目标：

- 支持用户把临时 WorkContext 升级为长期项目资产。

范围：

- project_contexts
- project participants
- project-scoped artifacts
- project-scoped memory
- WorkContext 加入 ProjectContext

验收场景：

```text
用户完成一个浏览器自动化流程后，说“把这个保存到浏览器自动化项目里”。
系统将 WorkContext、RunTrace refs、Artifact refs 关联到 ProjectContext。
```

完成标准：

- ProjectContext 不默认等于 MainSession。
- 用户显式创建或确认后才进入项目。
- 项目级 Memory 只在项目范围内读取。

## 13. Phase 8：能力增强和治理

目标：

- 做强模型底座、权限、评测和稳定性。

方向：

- ModelProvider 独立表。
- ContextPolicy 独立表。
- ToolProfile 独立表。
- ArtifactVersion。
- Agent evaluation。
- 成本统计。
- 自动降级。
- 并行 Agent 协作。
- CI / 回归测试。

完成标准：

- 可以评估不同 AgentVersion 的成功率和成本。
- 可以回放关键 AgentRun。
- 可以对内置 Agent 做版本升级和灰度。
- 可以限制不同 Agent 的工具、数据和项目访问范围。

## 14. 里程碑顺序

推荐顺序：

```text
M0：设计冻结
M1：9 张核心表和基础 API
M2：单 Agent 运行和工具白名单
M3：WorkContext + Artifact
M4：主 Agent 语义委派
M5：浏览器转定时任务场景
M6：Codex -> Image -> DesignSpec -> Codex 场景
M7：内置 Agent 工作台
M8：Scoped Memory
M9：ProjectContext
M10：治理、评测、成本和灰度
```

## 15. 第一阶段最小开发清单

第一阶段先做：

- `agent-platform-node` 项目初始化。
- Drizzle schema：agents、agent_versions、model_profiles、agent_runs、agent_run_steps、model_invocations。
- Zod schemas。
- AgentService。
- ModelProfileService。
- AgentRuntime。
- ModelClient。
- allowed_tools 过滤。
- BrowserAgent bootstrap。
- API：创建 Agent、发布 AgentVersion、运行 Agent、查看 Run、查看 Steps。

第一阶段不做：

- 主 Agent 语义委派。
- OrchestrationEvent 完整链路。
- UI 工作台。
- Memory。
- ProjectContext。

## 16. 第二阶段最小开发清单

第二阶段做：

- work_contexts。
- agent_artifacts。
- WorkContextService。
- ArtifactService。
- AgentRun 关联 work_context_id。
- WorkContext run_refs_json / artifact_refs_json 更新。
- CodexAgent 生成网页和截图场景。

## 17. 第三阶段最小开发清单

第三阶段做：

- orchestration_events。
- DelegateEnvelope schema。
- ContextPolicy JSON。
- MainAgent Session Context 组装。
- MainAgent 委派入口。
- SubAgent needs_clarification 返回。
- 浏览器流程转定时任务场景。

## 18. 控制原则

- 每个阶段只引入少量新概念。
- 每个阶段必须有验收场景。
- 不为未来复杂性提前建太多表。
- 高频稳定结构再拆表，早期保留 JSON 灵活性。
- 主 Agent 不做函数参数拼装，子 Agent 保持语义理解能力。
- WorkContext 不保存完整日志，只保存状态和索引。
- RunTrace 记录事实，Memory 记录提炼认知。
