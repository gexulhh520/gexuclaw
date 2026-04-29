/**
 * 文件系统核心插件 - 工具实现
 */

import fs from "node:fs/promises";
import path from "node:path";

/* -------------------------------------------------------------------------- */
/*                                   Types                                    */
/* -------------------------------------------------------------------------- */

export type FilesystemToolOptions = {
  workspaceDir: string;
  maxReadBytes?: number;
  maxWriteBytes?: number;
  ignoredDirs?: string[];
};

export type ReadInput = {
  path: string;
  startLine?: number;
  endLine?: number;
};

export type WriteInput = {
  path: string;
  content: string;
  createDirs?: boolean;
};

export type AppendInput = {
  path: string;
  content: string;
  createDirs?: boolean;
};

export type EditInput = {
  path: string;
  oldText: string;
  newText: string;
  replaceAll?: boolean;
};

export type ApplyPatchInput = {
  patches: EditInput[];
};

export type GrepInput = {
  query: string;
  path?: string;
  caseSensitive?: boolean;
  maxResults?: number;
};

export type FindInput = {
  pattern?: string;
  path?: string;
  maxResults?: number;
};

export type LsInput = {
  path?: string;
};

/* -------------------------------------------------------------------------- */
/*                              Path Guard / Safety                           */
/* -------------------------------------------------------------------------- */

export class FileAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileAccessError";
  }
}

function createPathGuard(workspaceDir: string) {
  const workspaceRoot = path.resolve(workspaceDir);

  function resolveInsideWorkspace(inputPath: string): string {
    if (!inputPath || typeof inputPath !== "string") {
      throw new FileAccessError("Path must be a non-empty string.");
    }

    const resolved = path.resolve(workspaceRoot, inputPath);
    const inside =
      resolved === workspaceRoot || resolved.startsWith(workspaceRoot + path.sep);

    if (!inside) {
      throw new FileAccessError(
        `Path is outside workspace. input=${inputPath}, resolved=${resolved}`
      );
    }

    return resolved;
  }

  return { workspaceRoot, resolveInsideWorkspace };
}

async function statFileSafe(filePath: string) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf-8");
}

/* -------------------------------------------------------------------------- */
/*                              文本文件扩展名                                 */
/* -------------------------------------------------------------------------- */

const TEXT_FILE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".txt",
  ".yaml", ".yml", ".html", ".css", ".scss", ".less", ".java", ".py",
  ".go", ".rs", ".php", ".rb", ".c", ".cpp", ".h", ".hpp", ".cs",
  ".xml", ".sql", ".sh", ".bat", ".env",
]);

function isLikelyTextFile(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  if (base === ".env" || base.startsWith(".env.")) return true;
  return TEXT_FILE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/* -------------------------------------------------------------------------- */
/*                                  fs_read                                   */
/* -------------------------------------------------------------------------- */

export function createReadTool(options: FilesystemToolOptions) {
  const guard = createPathGuard(options.workspaceDir);
  const maxReadBytes = options.maxReadBytes ?? 512_000;

  return async function read(input: ReadInput) {
    const filePath = guard.resolveInsideWorkspace(input.path);
    const stat = await statFileSafe(filePath);

    if (!stat) {
      throw new Error(`File not found: ${input.path}`);
    }

    if (!stat.isFile()) {
      throw new Error(`Path is not a file: ${input.path}`);
    }

    if (stat.size > maxReadBytes) {
      throw new Error(
        `File too large to read: ${stat.size} bytes, max ${maxReadBytes}`
      );
    }

    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split(/\r?\n/);

    if (input.startLine !== undefined || input.endLine !== undefined) {
      const startLine = Math.max(input.startLine ?? 1, 1);
      const endLine = Math.min(input.endLine ?? lines.length, lines.length);
      const startIndex = startLine - 1;

      return {
        path: input.path,
        content: lines.slice(startIndex, endLine).join("\n"),
        startLine,
        endLine,
        totalLines: lines.length,
        truncated: startLine > 1 || endLine < lines.length,
      };
    }

    return {
      path: input.path,
      content,
      totalLines: lines.length,
      bytes: stat.size,
      truncated: false,
    };
  };
}

/* -------------------------------------------------------------------------- */
/*                                  fs_write                                  */
/* -------------------------------------------------------------------------- */

export function createWriteTool(options: FilesystemToolOptions) {
  const guard = createPathGuard(options.workspaceDir);
  const maxWriteBytes = options.maxWriteBytes ?? 2_000_000;

  return async function write(input: WriteInput) {
    const filePath = guard.resolveInsideWorkspace(input.path);
    const size = byteLength(input.content);

    if (size > maxWriteBytes) {
      throw new Error(
        `Content too large to write: ${size} bytes, max ${maxWriteBytes}`
      );
    }

    if (input.createDirs !== false) {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
    }

    await fs.writeFile(filePath, input.content, "utf-8");

    return {
      ok: true,
      path: input.path,
      bytes: size,
      operation: {
        type: "write" as const,
        target: input.path,
        targetKind: "file" as const,
      },
      sideEffects: [
        {
          type: "file_write" as const,
          target: input.path,
          status: "created" as const,
        },
      ],
      verification: {
        required: true,
        status: "verified" as const,
        method: "fs_stat",
        evidence: { path: input.path, bytes: size },
      },
    };
  };
}

/* -------------------------------------------------------------------------- */
/*                                  fs_append                                 */
/* -------------------------------------------------------------------------- */

export function createAppendTool(options: FilesystemToolOptions) {
  const guard = createPathGuard(options.workspaceDir);
  const maxWriteBytes = options.maxWriteBytes ?? 2_000_000;

  return async function append(input: AppendInput) {
    const filePath = guard.resolveInsideWorkspace(input.path);
    const size = byteLength(input.content);

    if (size > maxWriteBytes) {
      throw new Error(
        `Content too large to append: ${size} bytes, max ${maxWriteBytes}`
      );
    }

    if (input.createDirs !== false) {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
    }

    await fs.appendFile(filePath, input.content, "utf-8");

    return {
      ok: true,
      path: input.path,
      bytes: size,
      operation: {
        type: "append" as const,
        target: input.path,
        targetKind: "file" as const,
      },
      sideEffects: [
        {
          type: "file_append" as const,
          target: input.path,
          status: "modified" as const,
        },
      ],
      verification: {
        required: true,
        status: "verified" as const,
        method: "fs_stat",
        evidence: { path: input.path, appendedBytes: size },
      },
    };
  };
}

/* -------------------------------------------------------------------------- */
/*                                  fs_edit                                   */
/* -------------------------------------------------------------------------- */

export function createEditTool(options: FilesystemToolOptions) {
  const guard = createPathGuard(options.workspaceDir);
  const maxWriteBytes = options.maxWriteBytes ?? 2_000_000;

  return async function edit(input: EditInput) {
    if (!input.oldText) {
      throw new Error("oldText must not be empty.");
    }

    const filePath = guard.resolveInsideWorkspace(input.path);
    const content = await fs.readFile(filePath, "utf-8");

    if (!content.includes(input.oldText)) {
      throw new Error(`oldText not found in file: ${input.path}`);
    }

    const occurrences = content.split(input.oldText).length - 1;

    if (occurrences > 1 && !input.replaceAll) {
      throw new Error(
        `oldText appears ${occurrences} times. Provide more specific oldText or set replaceAll=true.`
      );
    }

    const updated = input.replaceAll
      ? content.split(input.oldText).join(input.newText)
      : content.replace(input.oldText, input.newText);

    const updatedBytes = byteLength(updated);

    if (updatedBytes > maxWriteBytes) {
      throw new Error(
        `Updated content too large: ${updatedBytes} bytes, max ${maxWriteBytes}`
      );
    }

    await fs.writeFile(filePath, updated, "utf-8");

    return {
      ok: true,
      path: input.path,
      occurrences,
      replaced: input.replaceAll ? occurrences : 1,
      bytes: updatedBytes,
      operation: {
        type: "edit" as const,
        target: input.path,
        targetKind: "file" as const,
      },
      sideEffects: [
        {
          type: "file_edit" as const,
          target: input.path,
          status: "modified" as const,
        },
      ],
      verification: {
        required: true,
        status: "verified" as const,
        method: "fs_stat",
        evidence: { path: input.path, replaced: input.replaceAll ? occurrences : 1 },
      },
    };
  };
}

/* -------------------------------------------------------------------------- */
/*                               fs_apply_patch                               */
/* -------------------------------------------------------------------------- */

export function createApplyPatchTool(options: FilesystemToolOptions) {
  const edit = createEditTool(options);

  return async function applyPatch(input: ApplyPatchInput) {
    if (!Array.isArray(input.patches)) {
      throw new Error("patches must be an array.");
    }

    const results = [];
    for (const patch of input.patches) {
      const result = await edit(patch);
      results.push(result);
    }

    return {
      ok: true,
      changedFiles: [...new Set(input.patches.map((patch) => patch.path))],
      results,
      operation: {
        type: "edit" as const,
        target: input.patches.map((p) => p.path).join(", "),
        targetKind: "file" as const,
      },
      sideEffects: results.map((r: Record<string, unknown>) => ({
        type: "file_edit" as const,
        target: String(r.path),
        status: "modified" as const,
      })),
      verification: {
        required: true,
        status: "verified" as const,
        method: "fs_stat",
        evidence: { changedFiles: [...new Set(input.patches.map((patch) => patch.path))] },
      },
    };
  };
}

/* -------------------------------------------------------------------------- */
/*                                  fs_ls                                     */
/* -------------------------------------------------------------------------- */

export function createLsTool(options: FilesystemToolOptions) {
  const guard = createPathGuard(options.workspaceDir);

  return async function ls(input: LsInput = {}) {
    const relativeDir = input.path ?? ".";
    const dirPath = guard.resolveInsideWorkspace(relativeDir);

    const stat = await statFileSafe(dirPath);

    if (!stat) {
      throw new Error(`Directory not found: ${relativeDir}`);
    }

    if (!stat.isDirectory()) {
      throw new Error(`Path is not a directory: ${relativeDir}`);
    }

    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    return {
      path: relativeDir,
      entries: entries.map((entry) => {
        const fullPath = path.join(dirPath, entry.name);
        const relativePath = path.relative(guard.workspaceRoot, fullPath);

        return {
          name: entry.name,
          path: relativePath,
          type: entry.isDirectory()
            ? "directory"
            : entry.isFile()
            ? "file"
            : entry.isSymbolicLink()
            ? "symlink"
            : "other",
        };
      }),
    };
  };
}

/* -------------------------------------------------------------------------- */
/*                                  fs_find                                   */
/* -------------------------------------------------------------------------- */

function matchSimplePattern(target: string, pattern?: string): boolean {
  if (!pattern || pattern === "*") return true;

  const normalizedTarget = target.replace(/\\/g, "/");
  const normalizedPattern = pattern.replace(/\\/g, "/");

  if (normalizedPattern.startsWith("*.")) {
    return normalizedTarget.endsWith(normalizedPattern.slice(1));
  }

  if (normalizedPattern.includes("*")) {
    const parts = normalizedPattern.split("*").filter(Boolean);
    return parts.every((part) => normalizedTarget.includes(part));
  }

  return normalizedTarget.includes(normalizedPattern);
}

export function createFindTool(options: FilesystemToolOptions) {
  const guard = createPathGuard(options.workspaceDir);
  const ignoredDirs = new Set(
    options.ignoredDirs ?? ["node_modules", ".git", "dist", "build"]
  );

  return async function find(input: FindInput = {}) {
    const relativeRoot = input.path ?? ".";
    const root = guard.resolveInsideWorkspace(relativeRoot);
    const maxResults = input.maxResults ?? 200;
    const results: string[] = [];

    async function walk(dir: string): Promise<void> {
      if (results.length >= maxResults) return;

      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (ignoredDirs.has(entry.name)) continue;

        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(guard.workspaceRoot, fullPath);

        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          if (
            matchSimplePattern(entry.name, input.pattern) ||
            matchSimplePattern(relativePath, input.pattern)
          ) {
            results.push(relativePath);
          }
        }

        if (results.length >= maxResults) break;
      }
    }

    await walk(root);

    return {
      pattern: input.pattern ?? "*",
      path: relativeRoot,
      results,
      truncated: results.length >= maxResults,
    };
  };
}

/* -------------------------------------------------------------------------- */
/*                                  fs_grep                                   */
/* -------------------------------------------------------------------------- */

export function createGrepTool(options: FilesystemToolOptions) {
  const guard = createPathGuard(options.workspaceDir);
  const ignoredDirs = new Set(
    options.ignoredDirs ?? ["node_modules", ".git", "dist", "build"]
  );

  return async function grep(input: GrepInput) {
    if (!input.query) {
      throw new Error("query must not be empty.");
    }

    const relativeRoot = input.path ?? ".";
    const root = guard.resolveInsideWorkspace(relativeRoot);
    const maxResults = input.maxResults ?? 100;

    const results: Array<{
      path: string;
      line: number;
      text: string;
    }> = [];

    const needle = input.caseSensitive
      ? input.query
      : input.query.toLowerCase();

    async function walk(dir: string): Promise<void> {
      if (results.length >= maxResults) return;

      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (ignoredDirs.has(entry.name)) continue;

        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          await walk(fullPath);
          continue;
        }

        if (!entry.isFile() || !isLikelyTextFile(fullPath)) {
          continue;
        }

        const content = await fs.readFile(fullPath, "utf-8").catch(() => null);
        if (content === null) continue;

        const lines = content.split(/\r?\n/);

        for (let index = 0; index < lines.length; index++) {
          const haystack = input.caseSensitive
            ? lines[index]
            : lines[index].toLowerCase();

          if (haystack.includes(needle)) {
            results.push({
              path: path.relative(guard.workspaceRoot, fullPath),
              line: index + 1,
              text: lines[index],
            });
          }

          if (results.length >= maxResults) break;
        }

        if (results.length >= maxResults) break;
      }
    }

    await walk(root);

    return {
      query: input.query,
      path: relativeRoot,
      results,
      truncated: results.length >= maxResults,
    };
  };
}

/* -------------------------------------------------------------------------- */
/*                              Tool Factory                                  */
/* -------------------------------------------------------------------------- */

export function createFilesystemTools(options: FilesystemToolOptions) {
  return {
    fs_read: createReadTool(options),
    fs_write: createWriteTool(options),
    fs_append: createAppendTool(options),
    fs_edit: createEditTool(options),
    fs_apply_patch: createApplyPatchTool(options),
    fs_grep: createGrepTool(options),
    fs_find: createFindTool(options),
    fs_ls: createLsTool(options),
  };
}

export type FilesystemTools = ReturnType<typeof createFilesystemTools>;
