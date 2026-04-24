import type { FastifyInstance } from "fastify";
import { ok } from "../../shared/api-response.js";
import { createModelProfileSchema } from "./model-profile.schema.js";
import { createModelProfile, listModelProfiles } from "./model-profile.service.js";

export async function registerModelProfileRoutes(app: FastifyInstance) {
  app.get("/api/agent-platform/model-profiles", async () => {
    return ok(await listModelProfiles());
  });

  app.post("/api/agent-platform/model-profiles", async (request) => {
    const input = createModelProfileSchema.parse(request.body);
    return ok(await createModelProfile(input));
  });
}
