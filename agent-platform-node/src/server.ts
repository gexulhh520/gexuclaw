import "dotenv/config";
import { buildApp } from "./app.js";
import { ensureDatabaseSchema } from "./db/migrate.js";
import { seedBuiltinPlugins, attachDefaultPluginsToAllAgents } from "./bootstrap/seed-plugins.js";
import { pluginRegistry } from "./modules/plugins/plugin-registry-instance.js";

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

// 初始化插件系统
await seedBuiltinPlugins(pluginRegistry);

// 为所有 Agent 挂载默认插件（Agent 级别，所有版本共享）
await attachDefaultPluginsToAllAgents(pluginRegistry);

const app = await buildApp();
await app.listen({ port, host });
