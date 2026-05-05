# 计划 - 补齐 FileSlice 的状态和操作推断

## 背景

当前 `task-envelope-context-hydrator.ts` 中 file 状态映射只识别 `"write_failed" | "ok" | "unverified"`，但 `appendRunResultRefs` 已将成功资源状态统一为 `"verified"`，导致 `verified` 进入 TaskEnvelope 后变成 `lastKnownStatus: "unknown"`。

同时 `FileSlice` 类型已有 `lastKnownOperation`，但 hydrator 当前没有从 `ref.tags` 推断该字段。

---

## 步骤

### 步骤 1：修改 file 处理逻辑

**文件**：`src/modules/orchestration/task-envelope-context-hydrator.ts`

将当前 file 处理：
```typescript
if (ref.kind === "file") {
  files.push({
    refId: ref.refId,
    uri: ref.source?.uri || "",
    path: ref.source?.uri || "",
    lastKnownStatus:
      ref.status === "write_failed"
        ? "failed"
        : ref.status === "ok"
          ? "success"
          : ref.status === "unverified"
            ? "unverified"
            : "unknown",
    summary: ref.summary,
  });
}
```

改为使用推断函数：
```typescript
if (ref.kind === "file") {
  files.push({
    refId: ref.refId,
    uri: ref.source?.uri || "",
    path: ref.source?.uri || "",
    lastKnownOperation: inferFileOperation(ref.tags),
    lastKnownStatus: inferFileStatus(ref.status),
    summary: ref.summary,
  });
}
```

### 步骤 2：新增 inferFileStatus 函数

在文件底部新增：
```typescript
function inferFileStatus(
  status?: string
): FileSlice["lastKnownStatus"] {
  if (status === "write_failed" || status === "failed") {
    return "failed";
  }

  if (status === "ok" || status === "verified" || status === "success" || status === "ready") {
    return "success";
  }

  if (status === "unverified") {
    return "unverified";
  }

  return "unknown";
}
```

### 步骤 3：新增 inferFileOperation 函数

在文件底部新增：
```typescript
function inferFileOperation(
  tags: string[]
): FileSlice["lastKnownOperation"] | undefined {
  const joined = tags.join(" ").toLowerCase();

  if (joined.includes("append")) {
    return "append";
  }

  if (
    joined.includes("write") ||
    joined.includes("wrote") ||
    joined.includes("save") ||
    joined.includes("create")
  ) {
    return "write";
  }

  if (
    joined.includes("edit") ||
    joined.includes("modify") ||
    joined.includes("modified") ||
    joined.includes("patch") ||
    joined.includes("update")
  ) {
    return "edit";
  }

  if (joined.includes("read") || joined.includes("open")) {
    return "read";
  }

  if (joined.includes("move") || joined.includes("rename")) {
    return "move";
  }

  if (joined.includes("delete") || joined.includes("remove")) {
    return "delete";
  }

  return undefined;
}
```

注意顺序：`append` 要放在 `write` 前面。

### 步骤 4：优化 url/resource 的 operation 推断

将当前 resources 的 `lastKnownOperation`：
```typescript
lastKnownOperation: ref.tags.find((t) =>
  ["read", "write", "save", "fetch", "crawl", "scrape", "modify", "delete"].includes(t)
),
```

改为使用通用函数：
```typescript
lastKnownOperation: inferResourceOperation(ref.tags),
```

在文件底部新增：
```typescript
function inferResourceOperation(tags: string[]): string | undefined {
  const joined = tags.join(" ").toLowerCase();

  if (joined.includes("crawl")) return "crawl";
  if (joined.includes("scrape")) return "scrape";
  if (joined.includes("fetch")) return "fetch";
  if (joined.includes("navigate")) return "navigate";
  if (joined.includes("visit")) return "visit";
  if (joined.includes("read")) return "read";
  if (joined.includes("write") || joined.includes("wrote") || joined.includes("save")) return "write";
  if (joined.includes("modify") || joined.includes("modified") || joined.includes("update")) return "modify";
  if (joined.includes("delete") || joined.includes("deleted") || joined.includes("remove")) return "delete";
  if (joined.includes("touched")) return "touched";

  return undefined;
}
```

---

## 验收标准

测试以下 3 种 ref：

```typescript
const refs = [
  {
    refId: "file:1.txt",
    kind: "file",
    title: "1.txt",
    summary: "write; verified=true",
    status: "verified",
    source: { uri: "1.txt" },
    tags: ["file", "write", "verified"],
  },
  {
    refId: "file:2.txt",
    kind: "file",
    title: "2.txt",
    summary: "append; verified=true",
    status: "verified",
    source: { uri: "2.txt" },
    tags: ["file", "append", "verified"],
  },
  {
    refId: "file:3.txt",
    kind: "file",
    title: "3.txt",
    summary: "write failed",
    status: "write_failed",
    source: { uri: "3.txt" },
    tags: ["file", "write_failed"],
  },
];
```

期望 hydrate 后：
- `files[0].lastKnownStatus === "success"`
- `files[0].lastKnownOperation === "write"`
- `files[1].lastKnownStatus === "success"`
- `files[1].lastKnownOperation === "append"`
- `files[2].lastKnownStatus === "failed"`
- `files[2].lastKnownOperation === "write"`

---

## 不改的地方

只改：`task-envelope-context-hydrator.ts`

不改：MainDecision、ExecutionPlan、TaskEnvelopeRenderer、AgentRuntime、appendRunResultRefs
