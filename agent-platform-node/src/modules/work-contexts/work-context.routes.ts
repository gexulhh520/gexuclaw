import type { FastifyInstance } from "fastify";
import { ok } from "../../shared/api-response.js";
import { createArtifactSchema, createWorkContextSchema } from "./work-context.schema.js";
import {
  createArtifact,
  createWorkContext,
  getWorkContextByUid,
  getWorkContextWorkbench,
  listArtifactsByWorkContext,
  listWorkContexts,
} from "./work-context.service.js";

export async function registerWorkContextRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: { sessionId?: string; projectId?: string; limit?: string };
  }>("/api/agent-platform/work-contexts", async (request) => {
    return ok(
      await listWorkContexts({
        sessionId: request.query.sessionId,
        projectId: request.query.projectId,
        limit: request.query.limit ? Number(request.query.limit) : undefined,
      }),
    );
  });

  app.post("/api/agent-platform/work-contexts", async (request) => {
    const input = createWorkContextSchema.parse(request.body);
    return ok(await createWorkContext(input));
  });

  app.get<{ Params: { workContextUid: string } }>(
    "/api/agent-platform/work-contexts/:workContextUid",
    async (request) => {
      return ok(await getWorkContextByUid(request.params.workContextUid));
    },
  );

  app.get<{ Params: { workContextUid: string } }>(
    "/api/agent-platform/work-contexts/:workContextUid/artifacts",
    async (request) => {
      return ok(await listArtifactsByWorkContext(request.params.workContextUid));
    },
  );

  app.post<{ Params: { workContextUid: string } }>(
    "/api/agent-platform/work-contexts/:workContextUid/artifacts",
    async (request) => {
      const input = createArtifactSchema.parse(request.body);
      return ok(await createArtifact(request.params.workContextUid, input));
    },
  );

  // 获取 WorkContext 工作台聚合数据
  // GET /api/agent-platform/work-contexts/:workContextUid/workbench
  app.get<{ Params: { workContextUid: string } }>(
    "/api/agent-platform/work-contexts/:workContextUid/workbench",
    async (request) => {
      return ok(await getWorkContextWorkbench(request.params.workContextUid));
    },
  );
}
