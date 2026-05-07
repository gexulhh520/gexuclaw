CREATE TABLE IF NOT EXISTS "agent_artifacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"artifact_uid" text NOT NULL,
	"session_id" text,
	"work_context_id" integer,
	"run_id" integer,
	"artifact_type" text NOT NULL,
	"artifact_role" text DEFAULT 'output' NOT NULL,
	"title" text NOT NULL,
	"mime_type" text,
	"content_text" text DEFAULT '' NOT NULL,
	"content_json" text DEFAULT '{}' NOT NULL,
	"uri" text,
	"status" text DEFAULT 'ready' NOT NULL,
	"source_run_id" integer,
	"source_artifact_ids_json" text DEFAULT '[]' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "agent_artifacts_artifact_uid_unique" UNIQUE("artifact_uid")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_run_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"step_index" integer NOT NULL,
	"step_type" text NOT NULL,
	"content" text,
	"tool_name" text,
	"tool_call_id" text,
	"tool_status" text,
	"input_json" text DEFAULT '{}' NOT NULL,
	"output_json" text DEFAULT '{}' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_uid" text NOT NULL,
	"agent_id" integer NOT NULL,
	"agent_version_id" integer NOT NULL,
	"user_id" text,
	"session_id" text,
	"work_context_id" text,
	"parent_orchestration_event_id" text,
	"parent_run_id" integer,
	"mode" text DEFAULT 'standalone' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"user_message" text NOT NULL,
	"handoff_note" text,
	"delegate_envelope_json" text DEFAULT '{}' NOT NULL,
	"input_artifact_ids_json" text DEFAULT '[]' NOT NULL,
	"output_artifact_ids_json" text DEFAULT '[]' NOT NULL,
	"snapshot_json" text DEFAULT '{}' NOT NULL,
	"context_package_summary_json" text DEFAULT '{}' NOT NULL,
	"result_summary" text,
	"output_json" text DEFAULT '{}' NOT NULL,
	"error_message" text,
	"started_at" text,
	"finished_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "agent_runs_run_uid_unique" UNIQUE("run_uid")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"version" integer NOT NULL,
	"model_profile_id" integer NOT NULL,
	"system_prompt" text NOT NULL,
	"skill_text" text DEFAULT '' NOT NULL,
	"allowed_plugin_ids_json" text DEFAULT '[]' NOT NULL,
	"allowed_tools_json" text DEFAULT '[]' NOT NULL,
	"context_policy_json" text DEFAULT '{}' NOT NULL,
	"model_params_override_json" text DEFAULT '{}' NOT NULL,
	"output_schema_json" text DEFAULT '{}' NOT NULL,
	"max_steps" integer DEFAULT 6 NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"published_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agents" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_uid" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"capabilities_json" text DEFAULT '[]' NOT NULL,
	"owner_user_id" text,
	"current_version_id" integer,
	"standalone_enabled" boolean DEFAULT true NOT NULL,
	"subagent_enabled" boolean DEFAULT false NOT NULL,
	"ui_mode" text DEFAULT 'generic' NOT NULL,
	"ui_route" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "agents_agent_uid_unique" UNIQUE("agent_uid")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "model_invocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"invocation_uid" text NOT NULL,
	"run_id" integer NOT NULL,
	"step_id" integer,
	"model_profile_id" integer NOT NULL,
	"provider" text NOT NULL,
	"model_name" text NOT NULL,
	"params_json" text DEFAULT '{}' NOT NULL,
	"request_summary_json" text DEFAULT '{}' NOT NULL,
	"response_summary_json" text DEFAULT '{}' NOT NULL,
	"raw_payload_ref" text,
	"prompt_context_summary_json" text DEFAULT '{}' NOT NULL,
	"selected_context_refs_json" text DEFAULT '{}' NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"latency_ms" integer,
	"status" text NOT NULL,
	"error_message" text,
	"created_at" text NOT NULL,
	CONSTRAINT "model_invocations_invocation_uid_unique" UNIQUE("invocation_uid")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "model_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_uid" text NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"model_name" text NOT NULL,
	"base_url" text,
	"capability_json" text DEFAULT '{}' NOT NULL,
	"default_params_json" text DEFAULT '{}' NOT NULL,
	"max_context_tokens" integer DEFAULT 32000 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "model_profiles_profile_uid_unique" UNIQUE("profile_uid")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plugins" (
	"id" serial PRIMARY KEY NOT NULL,
	"plugin_uid" text NOT NULL,
	"plugin_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"plugin_type" text NOT NULL,
	"provider_type" text NOT NULL,
	"version" text DEFAULT '1' NOT NULL,
	"source_ref" text,
	"manifest_json" text DEFAULT '{}' NOT NULL,
	"config_json" text DEFAULT '{}' NOT NULL,
	"installed" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'registered' NOT NULL,
	"last_error" text,
	"last_health_check_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "plugins_plugin_uid_unique" UNIQUE("plugin_uid"),
	CONSTRAINT "plugins_plugin_id_unique" UNIQUE("plugin_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_uid" text NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"icon" text DEFAULT '📁' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "projects_project_uid_unique" UNIQUE("project_uid")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_uid" text NOT NULL,
	"project_id" integer,
	"user_id" text,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"agent_ids_json" text DEFAULT '[]' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "sessions_session_uid_unique" UNIQUE("session_uid")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_contexts" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_context_uid" text NOT NULL,
	"user_id" text,
	"session_id" text,
	"project_id" text,
	"title" text NOT NULL,
	"goal" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"current_run_id" integer,
	"latest_artifact_id" integer,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "work_contexts_work_context_uid_unique" UNIQUE("work_context_uid")
);
