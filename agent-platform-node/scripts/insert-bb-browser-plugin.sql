-- 插入 bb-browser MCP 插件
INSERT INTO plugins (
  plugin_uid,
  plugin_id,
  name,
  description,
  plugin_type,
  provider_type,
  version,
  source_ref,
  manifest_json,
  config_json,
  installed,
  enabled,
  status,
  created_at,
  updated_at
) VALUES (
  'plugin-bb-browser-' || extract(epoch from now())::bigint,
  'bb-browser',
  '浏览器控制',
  '提供浏览器工具操控浏览器完成一些页面操作',
  'external',
  'mcp',
  '1.0.0',
  'npx bb-browser',
  '{}',
  '{
    "mcpServers": {
      "bb-browser": {
        "command": "npx",
        "args": ["-y", "bb-browser", "--mcp"]
      }
    }
  }',
  true,
  true,
  'active',
  to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
)
ON CONFLICT (plugin_id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  plugin_type = EXCLUDED.plugin_type,
  provider_type = EXCLUDED.provider_type,
  config_json = EXCLUDED.config_json,
  enabled = EXCLUDED.enabled,
  status = EXCLUDED.status,
  updated_at = EXCLUDED.updated_at;
