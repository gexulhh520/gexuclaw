import "dotenv/config";
import { buildApp } from "./app.js";
import { ensureDatabaseSchema } from "./db/migrate.js";

const port = Number(process.env.PORT ?? 3100);
const host = process.env.HOST ?? "0.0.0.0";

await ensureDatabaseSchema();

const app = await buildApp();
await app.listen({ port, host });
