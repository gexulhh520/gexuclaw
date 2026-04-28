/**
 * 文件系统核心插件
 * 提供基础的文件读写、搜索、编辑能力
 */

import type { AgentPlugin } from "../../plugin.schema.js";

const nowIso = () => new Date().toISOString();

/**
 * 文件系统插件定义
 * 默认挂载到所有 Agent，作为基础能力
 */
export const filesystemCorePlugin: AgentPlugin = {
  pluginId: "builtin-filesystem-core",
  pluginType: "builtin",
  name: "文件系统核心",
  description:
    "提供基础的文件系统操作能力，包括读取、写入、编辑、搜索文件和目录列表。所有路径都是相对于工作空间的相对路径。",
  providerType: "custom",

  // 插件提示词 - 指导 LLM 如何使用文件系统工具
  prompts: [
    {
      promptId: "filesystem-usage-guide",
      title: "文件系统使用指南",
      content: `
## 文件系统工具使用指南

你可以使用以下文件系统工具来操作工作空间中的文件：

### 工具列表
- **fs_read**: 读取文件内容，支持指定行范围
- **fs_write**: 创建或覆盖文件
- **fs_append**: 追加内容到文件末尾
- **fs_edit**: 精确编辑文件（替换指定文本）
- **fs_apply_patch**: 批量应用多个文件修改
- **fs_grep**: 在文件中搜索文本内容
- **fs_find**: 查找文件（支持通配符模式）
- **fs_ls**: 列出目录内容

### 使用规则
1. 所有路径都是相对于工作空间的相对路径
2. 禁止访问工作空间之外的文件
3. 修改文件前，建议先读取文件内容
4. 使用 fs_edit 进行小范围精确修改
5. 使用 fs_write 创建新文件或完全覆盖
6. 使用 fs_apply_patch 进行多文件批量修改
7. 使用 fs_find 或 fs_grep 定位目标文件
8. fs_edit 的 oldText 必须完全匹配原文

### 安全限制
- 单次读取最大 512KB
- 单次写入最大 2MB
- 自动跳过 node_modules, .git, dist, build 等目录
`.trim(),
    },
  ],

  // 插件资源 - 常用文件扩展名参考
  resources: [
    {
      resourceId: "text-file-extensions",
      title: "文本文件扩展名",
      contentType: "text",
      content: `
常用文本文件扩展名：
.ts, .tsx, .js, .jsx, .mjs, .cjs, .json, .md, .txt, .yaml, .yml,
.html, .css, .scss, .less, .java, .py, .go, .rs, .php, .rb,
.c, .cpp, .h, .hpp, .cs, .xml, .sql, .sh, .bat, .env
`.trim(),
    },
  ],

  // 插件工具集
  tools: [
    {
      toolId: "fs_read",
      name: "读取文件",
      description: "读取工作空间中的文件内容，支持指定行范围",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "文件路径（相对于工作空间）",
          },
          startLine: {
            type: "number",
            description: "可选，起始行号（从1开始）",
          },
          endLine: {
            type: "number",
            description: "可选，结束行号（包含）",
          },
        },
        required: ["path"],
      },
    },
    {
      toolId: "fs_write",
      name: "写入文件",
      description: "在工作空间中创建或覆盖文件",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "文件路径（相对于工作空间）",
          },
          content: {
            type: "string",
            description: "文件内容",
          },
          createDirs: {
            type: "boolean",
            description: "是否自动创建父目录，默认为 true",
          },
        },
        required: ["path", "content"],
      },
    },
    {
      toolId: "fs_append",
      name: "追加文件",
      description: "将内容追加到文件末尾，如果文件不存在则创建",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "文件路径（相对于工作空间）",
          },
          content: {
            type: "string",
            description: "要追加的内容",
          },
          createDirs: {
            type: "boolean",
            description: "是否自动创建父目录，默认为 true",
          },
        },
        required: ["path", "content"],
      },
    },
    {
      toolId: "fs_edit",
      name: "编辑文件",
      description: "通过替换精确文本内容来编辑文件",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "文件路径（相对于工作空间）",
          },
          oldText: {
            type: "string",
            description: "要替换的原文本（必须完全匹配）",
          },
          newText: {
            type: "string",
            description: "新文本",
          },
          replaceAll: {
            type: "boolean",
            description: "是否替换所有匹配项，默认为 false",
          },
        },
        required: ["path", "oldText", "newText"],
      },
    },
    {
      toolId: "fs_apply_patch",
      name: "应用补丁",
      description: "批量应用多个文件修改补丁",
      inputSchema: {
        type: "object",
        properties: {
          patches: {
            type: "array",
            description: "补丁列表",
            items: {
              type: "object",
              properties: {
                path: {
                  type: "string",
                  description: "文件路径",
                },
                oldText: {
                  type: "string",
                  description: "要替换的原文本",
                },
                newText: {
                  type: "string",
                  description: "新文本",
                },
                replaceAll: {
                  type: "boolean",
                  description: "是否替换所有匹配项",
                },
              },
              required: ["path", "oldText", "newText"],
            },
          },
        },
        required: ["patches"],
      },
    },
    {
      toolId: "fs_grep",
      name: "搜索文件内容",
      description: "在工作空间的文件中搜索文本内容",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "搜索关键词",
          },
          path: {
            type: "string",
            description: "可选，搜索目录（相对于工作空间）",
          },
          caseSensitive: {
            type: "boolean",
            description: "是否区分大小写，默认为 false",
          },
          maxResults: {
            type: "number",
            description: "最大结果数，默认为 100",
          },
        },
        required: ["query"],
      },
    },
    {
      toolId: "fs_find",
      name: "查找文件",
      description: "在工作空间中查找文件（支持通配符模式）",
      inputSchema: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "文件名模式，如 '*.ts', 'index', 'src'，默认为 '*'",
          },
          path: {
            type: "string",
            description: "可选，搜索目录（相对于工作空间）",
          },
          maxResults: {
            type: "number",
            description: "最大结果数，默认为 200",
          },
        },
      },
    },
    {
      toolId: "fs_ls",
      name: "列出目录",
      description: "列出工作空间中的目录内容",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "目录路径（相对于工作空间），默认为 '.'",
          },
        },
      },
    },
  ],

  // 默认挂载到所有类型的 Agent（作为全局基础能力）
  defaultAttachTargets: ["builtin", "chat", "workflow"],

  status: "active",
  createdAt: nowIso(),
  updatedAt: nowIso(),
};

// 导出实现
export * from "./filesystem-tools.js";
