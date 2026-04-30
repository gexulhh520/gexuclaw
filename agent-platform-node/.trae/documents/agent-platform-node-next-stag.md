修补任务：把 AgentResult.openIssues / touchedResources 写入 WorkContextProjection
背景

当前后端已经有：

AgentResultBuilder
AgentRuntime.outputJson = AgentResult
executePlanAsync 读取 agentRuns.outputJson
updateWorkContextProjection 支持 producedArtifactRefs / touchedRefs / openIssues

但是目前 executePlanAsync() 主要只把 producedArtifactRefs 传给了 updateWorkContextProjection()。

还需要补：

const touchedRefs = allAgentResults.flatMap(...)
const openIssues = allAgentResults.flatMap(...)

目标是让 AgentResult.touchedResources 和 AgentResult.openIssues 进入 work_contexts.metadataJson.projection。

修改文件

主要修改：

agent-platform-node/src/modules/orchestration/orchestration.service.ts

可能需要顺手修改：

agent-platform-node/src/runtime/agent-result.ts
agent-platform-node/src/runtime/agent-result-builder.ts
一、在 executePlanAsync 中收集 AgentResult

当前每个 step 后已经有类似逻辑：

const agentResult = run.runId
  ? await db
      .select({ outputJson: agentRuns.outputJson })
      .from(agentRuns)
      .where(eq(agentRuns.id, run.runId))
      .limit(1)
      .then(([r]) => (r ? jsonParse<Record<string, unknown>>(r.outputJson, {}) : null))
  : null;

需要新增一个数组，用于保存所有 step 的 AgentResult：

const allAgentResults: Array<Record<string, unknown>> = [];

在读取到 agentResult 后追加：

if (agentResult) {
  allAgentResults.push(agentResult);
}
二、把 touchedResources 转成 touchedRefs

在 executePlanAsync() 最后、调用 updateWorkContextProjection() 前，新增：

const touchedRefs = Array.from(
  new Set(
    allAgentResults.flatMap((result) => {
      const resources = Array.isArray(result.touchedResources)
        ? result.touchedResources
        : [];

      return resources
        .map((resource) => {
          if (!resource || typeof resource !== "object") return null;

          const item = resource as {
            type?: string;
            uri?: string;
            operation?: string;
            verified?: boolean;
          };

          if (!item.uri) return null;

          if (item.type === "file") {
            return `file:${item.uri}`;
          }

          if (item.type === "artifact") {
            return item.uri.startsWith("artifact:")
              ? item.uri
              : `artifact:${item.uri}`;
          }

          if (item.type === "url") {
            return `url:${item.uri}`;
          }

          if (item.type === "db_record") {
            return `db:${item.uri}`;
          }

          return `resource:${item.uri}`;
        })
        .filter((ref): ref is string => Boolean(ref));
    })
  )
).slice(0, 20);
三、把 AgentResult.openIssues 转成 projection.openIssues

新增：

const openIssues = allAgentResults.flatMap((result) => {
  const issues = Array.isArray(result.openIssues)
    ? result.openIssues
    : [];

  return issues
    .map((issue) => {
      if (!issue || typeof issue !== "object") return null;

      const item = issue as {
        refId?: string;
        type?: string;
        message?: string;
        summary?: string;
        severity?: "low" | "medium" | "high";
      };

      const summary =
        item.summary ||
        item.message ||
        (item.type ? `执行问题：${item.type}` : "执行过程中出现问题");

      return {
        refId: item.refId,
        summary,
        severity: item.severity ?? "medium",
      };
    })
    .filter(
      (
        issue
      ): issue is {
        refId?: string;
        summary: string;
        severity: "low" | "medium" | "high";
      } => Boolean(issue)
    );
}).slice(0, 10);
四、调用 updateWorkContextProjection 时传入 touchedRefs / openIssues

当前可能是：

await updateWorkContextProjection({
  workContextUid: finalWorkContextId,
  runUid: stepResults[stepResults.length - 1]?.runUid ?? mainRunId,
  status: finalStatus,
  summary: finalMessage,
  producedArtifactRefs,
});

改成：

await updateWorkContextProjection({
  workContextUid: finalWorkContextId,
  runUid: stepResults[stepResults.length - 1]?.runUid ?? mainRunId,
  status: finalStatus,
  summary: finalMessage,
  producedArtifactRefs,
  touchedRefs,
  openIssues,
});
五、建议抽成辅助函数，避免 executePlanAsync 太长

可以在 orchestration.service.ts 底部加两个函数：

function extractTouchedRefsFromAgentResults(
  results: Array<Record<string, unknown>>
): string[] {
  return Array.from(
    new Set(
      results.flatMap((result) => {
        const resources = Array.isArray(result.touchedResources)
          ? result.touchedResources
          : [];

        return resources
          .map((resource) => {
            if (!resource || typeof resource !== "object") return null;

            const item = resource as {
              type?: string;
              uri?: string;
              operation?: string;
              verified?: boolean;
            };

            if (!item.uri) return null;

            if (item.type === "file") return `file:${item.uri}`;
            if (item.type === "artifact") {
              return item.uri.startsWith("artifact:")
                ? item.uri
                : `artifact:${item.uri}`;
            }
            if (item.type === "url") return `url:${item.uri}`;
            if (item.type === "db_record") return `db:${item.uri}`;

            return `resource:${item.uri}`;
          })
          .filter((ref): ref is string => Boolean(ref));
      })
    )
  ).slice(0, 20);
}

function extractOpenIssuesFromAgentResults(
  results: Array<Record<string, unknown>>
): Array<{
  refId?: string;
  summary: string;
  severity: "low" | "medium" | "high";
}> {
  return results
    .flatMap((result) => {
      const issues = Array.isArray(result.openIssues)
        ? result.openIssues
        : [];

      return issues.map((issue) => {
        if (!issue || typeof issue !== "object") return null;

        const item = issue as {
          refId?: string;
          type?: string;
          message?: string;
          summary?: string;
          severity?: "low" | "medium" | "high";
        };

        const summary =
          item.summary ||
          item.message ||
          (item.type ? `执行问题：${item.type}` : "执行过程中出现问题");

        return {
          refId: item.refId,
          summary,
          severity: item.severity ?? "medium",
        };
      });
    })
    .filter(
      (
        issue
      ): issue is {
        refId?: string;
        summary: string;
        severity: "low" | "medium" | "high";
      } => Boolean(issue)
    )
    .slice(0, 10);
}

然后在 executePlanAsync() 最后使用：

const touchedRefs = extractTouchedRefsFromAgentResults(allAgentResults);
const openIssues = extractOpenIssuesFromAgentResults(allAgentResults);
六、建议修 AgentResult.touchedResources.type 类型

当前 agent-result.ts 里如果是：

type: "file" | "artifact" | "url" | "db_record" | "external_resource";

而 agent-result-builder.ts 里可能 fallback 到：

"unknown"

建议统一加上：

type: "file" | "artifact" | "url" | "db_record" | "external_resource" | "unknown";

否则 TypeScript 严格检查可能有隐患。

七、预期结果

修完后，如果工具失败，AgentResult.openIssues 会进入：

{
  "projection": {
    "openIssues": [
      {
        "summary": "fs_write 执行失败：Permission denied",
        "severity": "high",
        "status": "open"
      }
    ],
    "currentStage": "blocked",
    "lastFailedRunUid": "run_xxx"
  }
}

如果工具读写了文件，AgentResult.touchedResources 会进入：

{
  "projection": {
    "recentRefs": [
      "file:README.md",
      "artifact:artifact_xxx",
      "run:run_xxx"
    ]
  }
}

这样下一轮用户说：

失败了

主 Agent 能通过 Snapshot / ContextIndex 更稳定地定位失败对象。