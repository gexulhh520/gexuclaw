import { PluginRegistry } from "./plugin-registry.js";

/**
 * 全局插件注册表实例
 * 在整个应用生命周期中共享同一个 PluginRegistry
 */
export const pluginRegistry = new PluginRegistry();
