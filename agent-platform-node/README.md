# Agent Platform Node

First-phase Node.js / TypeScript implementation for the Agent Platform.

## Scope

This package implements the phase-one single Agent run foundation:

- agents
- agent_versions
- model_profiles
- agent_runs
- agent_run_steps
- model_invocations
- AgentRuntime
- ContextBuilder
- ModelClient provider adapter
- ToolRuntime with mock browser tools

It does not implement WorkContext, Artifact lineage, Memory, ProjectContext or multi-Agent orchestration yet.

## Setup

```bash
npm install
cp .env.example .env
npm run bootstrap
npm run dev
```

The service listens on `http://localhost:3100` by default.

## Database

This project now uses PostgreSQL in local development and production.

```env
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/agent_platform
```

Create the database first, then run:

```bash
npm run bootstrap
```

## Local Mock Run

Bootstrap creates `builtin_browser_agent` with the `local_mock_default` model profile. This lets the runtime validate model calls, tool filtering and run tracing without a paid model key.

```bash
curl -X POST http://localhost:3100/api/agent-platform/agents/builtin_browser_agent/runs \
  -H "Content-Type: application/json" \
  -d "{\"userMessage\":\"访问百度\"}"
```

### PowerShell UTF-8 Tip

On Windows PowerShell, `curl` is often an alias of `Invoke-WebRequest`, and the default console code page may garble Chinese input. Prefer:

```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:3100/api/agent-platform/agents/builtin_browser_agent/runs" `
  -ContentType "application/json; charset=utf-8" `
  -Body '{"userMessage":"访问百度"}'
```

## Kimi

For real Kimi calls, create or update a ModelProfile with:

```env
KIMI_API_KEY=
KIMI_BASE_URL=https://api.moonshot.cn/v1
KIMI_DEFAULT_MODEL=kimi-k2.5
```
