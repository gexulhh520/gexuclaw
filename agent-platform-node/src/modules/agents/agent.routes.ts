import type { FastifyInstance } from "fastify";
import { ok } from "../../shared/api-response.js";
import { notFound } from "../../shared/errors.js";
import { runAgentSchema } from "../runs/run.schema.js";
import { runAgent } from "../runs/run.service.js";
import { createAgentSchema, createAgentVersionSchema } from "./agent.schema.js";
import {
  createAgent,
  createAgentVersion,
  getAgentByUid,
  listAgents,
  listAgentVersions,
} from "./agent.service.js";

export async function registerAgentRoutes(app: FastifyInstance) {
  app.get("/api/agent-platform/agents", async () => ok(await listAgents()));

  app.post("/api/agent-platform/agents", async (request) => {
    const input = createAgentSchema.parse(request.body);
    return ok(await createAgent(input));
  });

  app.get<{ Params: { agentUid: string } }>("/api/agent-platform/agents/:agentUid", async (request) => {
    const agent = await getAgentByUid(request.params.agentUid);
    if (!agent) throw notFound("Agent not found", { agentUid: request.params.agentUid });
    return ok(agent);
  });

  app.post<{ Params: { agentUid: string } }>("/api/agent-platform/agents/:agentUid/versions", async (request) => {
    const input = createAgentVersionSchema.parse(request.body);
    return ok(await createAgentVersion(request.params.agentUid, input));
  });

  app.get<{ Params: { agentUid: string } }>("/api/agent-platform/agents/:agentUid/versions", async (request) => {
    return ok(await listAgentVersions(request.params.agentUid));
  });

  app.post<{ Params: { agentUid: string } }>("/api/agent-platform/agents/:agentUid/runs", async (request) => {
    const input = runAgentSchema.parse(request.body);
    return ok(await runAgent(request.params.agentUid, input));
  });
}
