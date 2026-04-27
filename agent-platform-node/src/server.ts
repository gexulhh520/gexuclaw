import "dotenv/config";
import { buildApp } from "./app.js";
import { ensureDatabaseSchema } from "./db/migrate.js";

// 设置 UTF-8 编码（Windows 终端兼容性）
if (process.platform === "win32") {
  process.env.FORCE_COLOR = "1";
  // 尝试设置控制台编码
  try {
    const { execSync } = await import("child_process");
    execSync("chcp 65001", { stdio: "ignore" });
  } catch {
    // 忽略错误
  }
}

const port = Number(process.env.PORT ?? 3100);
const host = process.env.HOST ?? "0.0.0.0";

await ensureDatabaseSchema();

const app = await buildApp();
await app.listen({ port, host });
