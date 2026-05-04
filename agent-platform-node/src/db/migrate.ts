import { pool } from "./client.js";

export async function ensureDatabaseSchema(): Promise<void> {
  // 第一阶段继续保留“启动即确保核心表存在”的策略。
  // 正式结构演进仍以 db/schema.ts 与 drizzle-kit 迁移为准。
  await pool.query(`
    create table if not exists agents (
      id serial primary key,
      agent_uid text not null unique,
      name text not null,
      type text not null,
      description text not null default '',
      capabilities_json text not null default '[]',
      owner_user_id text,
      current_version_id integer,
      standalone_enabled boolean not null default true,
      subagent_enabled boolean not null default false,
      ui_mode text not null default 'generic',
      ui_route text,
      status text not null default 'active',
      created_at text not null,
      updated_at text not null
    );

    create table if not exists model_profiles (
      id serial primary key,
      profile_uid text not null unique,
      name text not null,
      provider text not null,
      model_name text not null,
      base_url text,
      capability_json text not null default '{}',
      default_params_json text not null default '{}',
      max_context_tokens integer not null default 32000,
      status text not null default 'active',
      created_at text not null,
      updated_at text not null
    );

    create table if not exists agent_versions (
      id serial primary key,
      agent_id integer not null,
      version integer not null,
      model_profile_id integer not null,
      system_prompt text not null,
      skill_text text not null default '',
      allowed_plugin_ids_json text not null default '[]',
      allowed_tools_json text not null default '[]',
      context_policy_json text not null default '{}',
      model_params_override_json text not null default '{}',
      output_schema_json text not null default '{}',
      max_steps integer not null default 6,
      status text not null default 'published',
      published_at text,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists agent_runs (
      id serial primary key,
      run_uid text not null unique,
      agent_id integer not null,
      agent_version_id integer not null,
      user_id text,
      session_id text,
      work_context_id text,
      parent_orchestration_event_id text,
      parent_run_id integer,
      mode text not null default 'standalone',
      status text not null default 'queued',
      user_message text not null,
      handoff_note text,
      delegate_envelope_json text not null default '{}',
      input_artifact_ids_json text not null default '[]',
      output_artifact_ids_json text not null default '[]',
      snapshot_json text not null default '{}',
      context_package_summary_json text not null default '{}',
      result_summary text,
      output_json text not null default '{}',
      error_message text,
      started_at text,
      finished_at text,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists agent_run_steps (
      id serial primary key,
      run_id integer not null,
      step_index integer not null,
      step_type text not null,
      content text,
      tool_name text,
      tool_call_id text,
      tool_status text,
      input_json text not null default '{}',
      output_json text not null default '{}',
      metadata_json text not null default '{}',
      created_at text not null
    );

    create table if not exists model_invocations (
      id serial primary key,
      invocation_uid text not null unique,
      run_id integer not null,
      step_id integer,
      model_profile_id integer not null,
      provider text not null,
      model_name text not null,
      params_json text not null default '{}',
      request_summary_json text not null default '{}',
      response_summary_json text not null default '{}',
      raw_payload_ref text,
      prompt_context_summary_json text not null default '{}',
      selected_context_refs_json text not null default '{}',
      input_tokens integer,
      output_tokens integer,
      latency_ms integer,
      status text not null,
      error_message text,
      created_at text not null
    );

    create table if not exists projects (
      id serial primary key,
      project_uid text not null unique,
      user_id text,
      name text not null,
      description text not null default '',
      icon text not null default '📁',
      status text not null default 'active',
      metadata_json text not null default '{}',
      created_at text not null,
      updated_at text not null
    );

    create table if not exists sessions (
      id serial primary key,
      session_uid text not null unique,
      project_id integer,
      user_id text,
      title text not null,
      description text not null default '',
      agent_ids_json text not null default '[]',
      status text not null default 'active',
      metadata_json text not null default '{}',
      created_at text not null,
      updated_at text not null
    );

    create table if not exists work_contexts (
      id serial primary key,
      work_context_uid text not null unique,
      user_id text,
      session_id text,
      project_id text,
      title text not null,
      goal text not null default '',
      status text not null default 'active',
      source text not null default 'manual',
      current_run_id integer,
      latest_artifact_id integer,
      metadata_json text not null default '{}',
      created_at text not null,
      updated_at text not null
    );

    create table if not exists agent_artifacts (
      id serial primary key,
      artifact_uid text not null unique,
      work_context_id integer not null,
      run_id integer,
      artifact_type text not null,
      artifact_role text not null default 'output',
      title text not null,
      mime_type text,
      content_text text not null default '',
      content_json text not null default '{}',
      uri text,
      status text not null default 'ready',
      source_run_id integer,
      source_artifact_ids_json text not null default '[]',
      metadata_json text not null default '{}',
      created_at text not null,
      updated_at text not null
    );

    create table if not exists plugins (
      id serial primary key,
      plugin_uid text not null unique,
      plugin_id text not null unique,
      name text not null,
      description text not null default '',
      plugin_type text not null,
      provider_type text not null,
      version text not null default '1',
      source_ref text,
      manifest_json text not null default '{}',
      config_json text not null default '{}',
      installed boolean not null default false,
      enabled boolean not null default true,
      status text not null default 'registered',
      last_error text,
      last_health_check_at text,
      created_at text not null,
      updated_at text not null
    );

    comment on table agents is 'Agent 基础身份表';
    comment on column agents.agent_uid is '业务稳定 id，给 API、前端、日志和外部引用使用';
    comment on column agents.current_version_id is '当前默认运行版本 id';

    comment on table model_profiles is '模型抽象配置表';
    comment on column model_profiles.profile_uid is '业务稳定 id';
    comment on column model_profiles.provider is '模型供应商，例如 kimi、openai、mock';
    comment on column model_profiles.model_name is '具体模型名';

    comment on table agent_versions is 'Agent 可运行版本表';
    comment on column agent_versions.allowed_tools_json is '本版本允许暴露给 LLM 的工具白名单';
    comment on column agent_versions.context_policy_json is '上下文读取策略';
    comment on column agent_versions.max_steps is '单次运行最大步数';

    comment on table agent_runs is '一次 Agent 执行的主记录';
    comment on column agent_runs.run_uid is '业务稳定 id';
    comment on column agent_runs.work_context_id is '所属工作上下文 uid';
    comment on column agent_runs.context_package_summary_json is '本次上下文包摘要';
    comment on column agent_runs.result_summary is '结果摘要';

    comment on table agent_run_steps is 'Run 内部事实轨迹表';
    comment on column agent_run_steps.step_type is '步骤类型，例如 model_call、tool_start、tool_end、final';

    comment on table model_invocations is '模型调用审计记录表';
    comment on column model_invocations.prompt_context_summary_json is '本次 PromptContext 摘要';
    comment on column model_invocations.selected_context_refs_json is '本次被选入上下文的 refs';

    comment on table projects is '项目空间表，作为多个会话的容器';
    comment on column projects.project_uid is '业务稳定 id';
    comment on column projects.name is '项目名称';
    comment on column projects.icon is '项目图标';

    comment on table sessions is '会话表，代表与 Agent 的一次完整协作过程';
    comment on column sessions.session_uid is '业务稳定 id';
    comment on column sessions.project_id is '归属项目 id，null 表示个人会话';
    comment on column sessions.agent_ids_json is '本次会话关联的智能体列表';

    comment on table work_contexts is '同一工作目标下的工作上下文主表，由 LLM 动态生成';
    comment on column work_contexts.work_context_uid is '业务稳定 id';
    comment on column work_contexts.session_id is '归属的会话 uid';
    comment on column work_contexts.project_id is '归属的项目 uid，用于快速筛选';
    comment on column work_contexts.title is '工作标题';
    comment on column work_contexts.goal is '工作目标描述';
    comment on column work_contexts.source is '来源：manual 或 llm_generated';
    comment on column work_contexts.current_run_id is '最近一次运行的 agent_runs.id';
    comment on column work_contexts.latest_artifact_id is '最近一个产物的 agent_artifacts.id';
    comment on column work_contexts.metadata_json is '扩展元数据';

    comment on table agent_artifacts is 'Agent 运行产物索引表';
    comment on column agent_artifacts.artifact_uid is '业务稳定 id';
    comment on column agent_artifacts.work_context_id is '所属工作上下文 id';
    comment on column agent_artifacts.run_id is '来源运行 id';
    comment on column agent_artifacts.artifact_type is '产物类型：text | structured_data | page | image | link | file | collection';
    comment on column agent_artifacts.artifact_role is '产物角色：input | reference | intermediate | draft | final | output';
    comment on column agent_artifacts.content_text is '文本内容';
    comment on column agent_artifacts.content_json is '结构化 JSON 内容';
    comment on column agent_artifacts.uri is '外部存储地址或文件引用';
    comment on column agent_artifacts.source_run_id is '明确记录产物来源 run';
    comment on column agent_artifacts.source_artifact_ids_json is '派生产物的血缘关系';
    comment on column agent_artifacts.metadata_json is '扩展字段（subtype、文件信息、页面信息等）';

    comment on table plugins is '插件管理表';
    comment on column plugins.plugin_uid is '业务稳定 id';
    comment on column plugins.plugin_id is '插件唯一标识';
    comment on column plugins.plugin_type is '插件类型：builtin | external';
    comment on column plugins.provider_type is '提供者类型：builtin_code | manifest | mcp';
    comment on column plugins.manifest_json is '插件定义快照（tools/resources/prompts 等）';
    comment on column plugins.config_json is '插件运行配置';
    comment on column plugins.installed is '是否已安装';
    comment on column plugins.enabled is '是否已启用';
    comment on column plugins.status is '状态：registered | active | disabled | error | unavailable';
  `);

  // 迁移：为已存在的 agent_artifacts 表添加新字段
  await pool.query(`
    alter table agent_artifacts
    add column if not exists artifact_role text not null default 'output',
    add column if not exists source_run_id integer,
    add column if not exists source_artifact_ids_json text not null default '[]',
    add column if not exists metadata_json text not null default '{}';
  `);

  // 迁移：为已存在的 agent_versions 表添加 allowed_plugin_ids_json 字段
  await pool.query(`
    alter table agent_versions
    add column if not exists allowed_plugin_ids_json text not null default '[]';
  `);
}
