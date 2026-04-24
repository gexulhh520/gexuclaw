import type { FastifyInstance } from "fastify";
import { ok } from "../../shared/api-response.js";
import { getRunByUid, listRunModelInvocations, listRuns, listRunSteps } from "./run.service.js";

export async function registerRunRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { agentUid?: string; workContextId?: string; limit?: string } }>(
    "/api/agent-platform/runs",
    async (request) => {
    return ok(
      await listRuns({
        agentUid: request.query.agentUid,
        workContextId: request.query.workContextId,
        limit: request.query.limit ? Number(request.query.limit) : undefined,
      }),
    );
    },
  );

  app.get<{ Params: { runUid: string } }>("/api/agent-platform/runs/:runUid", async (request) => {
    return ok(await getRunByUid(request.params.runUid));
  });

  app.get<{ Params: { runUid: string } }>("/api/agent-platform/runs/:runUid/steps", async (request) => {
    return ok(await listRunSteps(request.params.runUid));
  });

  app.get<{ Params: { runUid: string } }>("/api/agent-platform/runs/:runUid/model-invocations", async (request) => {
    return ok(await listRunModelInvocations(request.params.runUid));
  });
}
