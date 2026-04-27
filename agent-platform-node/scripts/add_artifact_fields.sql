-- 为 agent_artifacts 表添加新字段的迁移脚本
-- 执行方式: psql -U your_username -d your_database -f add_artifact_fields.sql

-- 添加 artifact_role 字段（如果不存在）
ALTER TABLE agent_artifacts
ADD COLUMN IF NOT EXISTS artifact_role text NOT NULL DEFAULT 'output';

-- 添加 source_run_id 字段（如果不存在）
ALTER TABLE agent_artifacts
ADD COLUMN IF NOT EXISTS source_run_id integer;

-- 添加 source_artifact_ids_json 字段（如果不存在）
ALTER TABLE agent_artifacts
ADD COLUMN IF NOT EXISTS source_artifact_ids_json text NOT NULL DEFAULT '[]';

-- 添加 metadata_json 字段（如果不存在）
ALTER TABLE agent_artifacts
ADD COLUMN IF NOT EXISTS metadata_json text NOT NULL DEFAULT '{}';

-- 添加字段注释
COMMENT ON COLUMN agent_artifacts.artifact_role IS '产物业务角色: input | reference | intermediate | draft | final | output';
COMMENT ON COLUMN agent_artifacts.source_run_id IS '明确记录产物来源 run';
COMMENT ON COLUMN agent_artifacts.source_artifact_ids_json IS '派生产物的血缘关系，JSON 数组格式';
COMMENT ON COLUMN agent_artifacts.metadata_json IS '扩展字段（subtype、文件信息、页面信息等）';

-- 验证字段是否添加成功
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'agent_artifacts'
ORDER BY ordinal_position;
