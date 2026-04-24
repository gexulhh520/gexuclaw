import type { FastifyInstance } from "fastify";
import { ok } from "../../shared/api-response.js";
import { createProjectSchema } from "./project.schema.js";
import { createProject, getProjectByUid, listProjects } from "./project.service.js";

export async function registerProjectRoutes(app: FastifyInstance) {
  app.get("/api/agent-platform/projects", async () => {
    return ok(await listProjects());
  });

  app.post("/api/agent-platform/projects", async (request) => {
    const input = createProjectSchema.parse(request.body);
    return ok(await createProject(input));
  });

  app.get<{ Params: { projectUid: string } }>("/api/agent-platform/projects/:projectUid", async (request) => {
    return ok(await getProjectByUid(request.params.projectUid));
  });
}
