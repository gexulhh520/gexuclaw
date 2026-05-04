import { builtinBrowserCoreDocs } from "./builtins/browser-core-docs.js";
import { filesystemCorePlugin } from "./builtins/filesystem-core/index.js";

/**
 * 统一导出所有 builtin 插件
 */
export const builtinPlugins = [
  builtinBrowserCoreDocs,
  filesystemCorePlugin,
];
