import type { FastifyInstance } from "fastify";
import { ok } from "../../shared/api-response.js";
import { createSessionSchema } from "./session.schema.js";
import { createSession, getSessionByUid, getSessionWorkbench, listSessions, listArtifactsBySession } from "./session.service.js";

export async function registerSessionRoutes(app: FastifyInstance) {
  // 列出会话
  // GET /api/agent-platform/sessions?projectUid=xxx  - 项目下的会话
  // GET /api/agent-platform/sessions?personal=true   - 个人会话
  // GET /api/agent-platform/sessions                 - 所有会话
  app.get<{
    Querystring: { projectUid?: string; personal?: string; limit?: string };
  }>("/api/agent-platform/sessions", async (request) => {
    const { projectUid, personal, limit } = request.query;
    return ok(
      await listSessions({
        projectUid,
        personal: personal === "true",
        limit: limit ? Number(limit) : undefined,
      })
    );
  });

  // 创建会话
  app.post("/api/agent-platform/sessions", async (request) => {
    const input = createSessionSchema.parse(request.body);
    return ok(await createSession(input));
  });

  // 获取单个会话
  app.get<{ Params: { sessionUid: string } }>(
    "/api/agent-platform/sessions/:sessionUid",
    async (request) => {
      return ok(await getSessionByUid(request.params.sessionUid));
    }
  );

  // 获取会话工作台聚合数据
  // GET /api/agent-platform/sessions/:sessionUid/workbench
  app.get<{ Params: { sessionUid: string } }>(
    "/api/agent-platform/sessions/:sessionUid/workbench",
    async (request) => {
      return ok(await getSessionWorkbench(request.params.sessionUid));
    }
  );

  // 获取会话的 artifacts
  // GET /api/agent-platform/sessions/:sessionUid/artifacts
  app.get<{ Params: { sessionUid: string } }>(
    "/api/agent-platform/sessions/:sessionUid/artifacts",
    async (request) => {
      return ok(await listArtifactsBySession(request.params.sessionUid));
    }
  );
}
