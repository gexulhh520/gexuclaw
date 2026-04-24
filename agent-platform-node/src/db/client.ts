import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for agent-platform-node");
}

// 第一阶段统一使用 PostgreSQL，避免 Windows 下原生 SQLite 依赖的编译问题。
export const pool = new Pool({
  connectionString,
});

export const db = drizzle(pool, { schema });
