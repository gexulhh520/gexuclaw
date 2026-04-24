import cors from "@fastify/cors";
import Fastify from "fastify";
import { ZodError } from "zod";
import { registerAgentRoutes } from "./modules/agents/agent.routes.js";
import { registerModelProfileRoutes } from "./modules/model-profiles/model-profile.routes.js";
import { registerProjectRoutes } from "./modules/projects/project.routes.js";
import { registerRunRoutes } from "./modules/runs/run.routes.js";
import { registerSessionRoutes } from "./modules/sessions/session.routes.js";
import { registerWorkContextRoutes } from "./modules/work-contexts/work-context.routes.js";
import { fail } from "./shared/api-response.js";
import { AppError } from "./shared/errors.js";
import { registerBuiltinTools } from "./tools/tool-registry.js";

export async function buildApp() {
  registerBuiltinTools();

  const app = Fastify({
    logger: true,
  });

  await app.register(cors, { origin: true });

  app.get("/health", async () => ({ ok: true, service: "agent-platform-node" }));

  await registerModelProfileRoutes(app);
  await registerAgentRoutes(app);
  await registerRunRoutes(app);
  await registerProjectRoutes(app);
  await registerSessionRoutes(app);
  await registerWorkContextRoutes(app);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      reply.status(400).send(fail("VALIDATION_ERROR", "Request validation failed", error.flatten()));
      return;
    }

    if (error instanceof AppError) {
      reply.status(error.statusCode).send(fail(error.code, error.message, error.details));
      return;
    }

    app.log.error(error);
    reply.status(500).send(fail("INTERNAL_ERROR", "Unexpected server error"));
  });

  return app;
}
