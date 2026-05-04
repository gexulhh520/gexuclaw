import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { agentRunSteps, agentRuns, modelInvocations, modelProfiles, workContexts } from "../db/schema.js";
import { jsonParse, jsonStringify } from "../shared/json.js";
import { makeUid } from "../shared/ids.js";
import { nowIso } from "../shared/time.js";
import { runEventBus } from "../shared/event-bus.js";
import {
  buildPromptContext,
  selectedContextRefsForFirstPhase,
  summarizePromptContext,
} from "./context-builder.js";
import type { ChatMessage } from "./model-client.js";
import { ModelClient } from "./model-client.js";
import { ToolRuntime } from "./tool-runtime.js";
import {
  extractArtifactDirectives,
  parseArtifactDirectiveConfig,
  type ArtifactDirectiveConfig,
} from "../modules/artifacts/artifact-directives.js";
import {
  attachCandidateIdsToToolResult,
  persistArtifactsFromAgentDecisions,
  persistArtifactsFromToolResult,
  persistDeclaredArtifacts,
  type PendingArtifactCandidate,
} from "../modules/artifacts/artifact-coordinator.js";
import { PluginRegistry } from "../modules/plugins/plugin-registry.js";
import { buildPluginCatalogInjection } from "../modules/plugins/plugin-catalog.js";
import { registerPluginReadItemTool } from "../modules/plugins/plugin-tools.js";
import { renderTaskEnvelopeForAgent } from "../modules/orchestration/task-envelope-renderer.js";
import type { TaskEnvelope } from "../modules/orchestration/task-envelope.types.js";
import { buildAgentResult } from "./agent-result-builder.js";

// 扩展 RunAgentInput 类型，添加 runUid 用于事件推送
type RunAgentInputExtended = {
  agentRecord: {
    id: number;
    agentUid: string;
    name: string;
    type: string;
  };
  versionRecord: {
    id: number;
    version: number;
    modelProfileId: number;
    systemPrompt: string;
    skillText: string;
    allowedPluginIdsJson: string;
    allowedToolsJson: string;
    contextPolicyJson: string;
    modelParamsOverrideJson: string;
    maxSteps: number;
  };
  userMessage: string;
  handoffNote?: string;
  originalUserMessage?: string;
  taskEnvelope?: TaskEnvelope;
  userId?: string;
  sessionId?: string;
  workContextId?: string;
  mode: "standalone" | "subagent" | "main";
  runUid?: string; // 用于事件推送
};

type RunAgentInput = {
  agentRecord: {
    id: number;
    agentUid: string;
    name: string;
    type: string;
  };
  versionRecord: {
    id: number;
    version: number;
    modelProfileId: number;
    systemPrompt: string;
    skillText: string;
    allowedPluginIdsJson: string;
    allowedToolsJson: string;
    contextPolicyJson: string;
    modelParamsOverrideJson: string;
    maxSteps: number;
  };
  userMessage: string;
  handoffNote?: string;
  originalUserMessage?: string;
  taskEnvelope?: TaskEnvelope;
  userId?: string;
  sessionId?: string;
  workContextId?: string;
  parentRunId?: number;  // 父 run 的 ID，用于关联主 Agent 和子 Agent
  mode: "standalone" | "subagent" | "main";
};

type RunStepInsert = {
  runId: number;
  stepIndex: number;
  stepType: "model_call" | "tool_start" | "tool_end" | "observation" | "final" | "error";
  content?: string;
  toolName?: string;
  toolCallId?: string;
  toolStatus?: string;
  input?: unknown;
  output?: unknown;
  metadata?: unknown;
};

export class AgentRuntime {
  private readonly modelClient = new ModelClient();
  private currentRunUid: string = "";
  private currentRunId: number = 0;
  private parentRunId: number | undefined = undefined;
  private agentName: string = "";
  private pluginRegistry?: PluginRegistry;

  constructor(options?: { pluginRegistry?: PluginRegistry }) {
    this.pluginRegistry = options?.pluginRegistry;
  }

  async run(input: RunAgentInput) {
    const [profile] = await db
      .select()
      .from(modelProfiles)
      .where(eq(modelProfiles.id, input.versionRecord.modelProfileId));

    if (!profile) throw new Error("ModelProfile not found for AgentVersion");

    const now = nowIso();
    const runUid = makeUid("run");
    this.currentRunUid = runUid;
    this.parentRunId = input.parentRunId;
    this.agentName = input.agentRecord.name;

    // 每次运行都冻结一份快照，保证以后复盘时能知道当时看到的 Agent / Version / ModelProfile 配置。
    const snapshot = {
      agent: {
        id: input.agentRecord.id,
        agentUid: input.agentRecord.agentUid,
        name: input.agentRecord.name,
        type: input.agentRecord.type,
      },
      version: {
        id: input.versionRecord.id,
        version: input.versionRecord.version,
        allowedTools: jsonParse<string[]>(input.versionRecord.allowedToolsJson, []),
        contextPolicy: jsonParse<Record<string, unknown>>(input.versionRecord.contextPolicyJson, {}),
      },
      modelProfile: {
        id: profile.id,
        profileUid: profile.profileUid,
        provider: profile.provider,
        modelName: profile.modelName,
      },
    };

    // 计算 effectiveUserMessage
    const effectiveUserMessage =
      input.mode === "subagent" && input.taskEnvelope
        ? renderTaskEnvelopeForAgent(input.taskEnvelope)
        : input.originalUserMessage || input.userMessage;

    console.log(`[AgentRuntime] Creating run with sessionId: ${input.sessionId}, workContextId: ${input.workContextId}, parentRunId: ${input.parentRunId}`);
    const [run] = await db
      .insert(agentRuns)
      .values({
        runUid,
        agentId: input.agentRecord.id,
        agentVersionId: input.versionRecord.id,
        userId: input.userId,
        sessionId: input.sessionId,
        workContextId: input.workContextId,
        parentRunId: input.parentRunId,
        mode: input.mode,
        status: "running",
        userMessage: input.originalUserMessage || input.userMessage,
        handoffNote: undefined,
        delegateEnvelopeJson: input.taskEnvelope ? jsonStringify(input.taskEnvelope) : undefined,
        snapshotJson: jsonStringify(snapshot),
        createdAt: now,
        updatedAt: now,
        startedAt: now,
      })
      .returning();
    this.currentRunId = run.id;
    console.log(`[AgentRuntime] Run created: ${run.runUid} with sessionId: ${run.sessionId}, id=${run.id}`);

    if (input.workContextId) {
      await db
        .update(workContexts)
        .set({
          currentRunId: run.id,
          updatedAt: now,
        })
        .where(eq(workContexts.workContextUid, input.workContextId));
    }

    try {
      // AgentRun 先落库再执行主循环，这样即使模型或工具失败，也能留下失败轨迹。
      const result = await this.executeRunLoop({ runId: run.id, runUid, profile, input });
      const finishedAt = nowIso();

      // 根据工具执行结果计算最终状态
      const finalStatus = result.hasFailedTool
        ? "failed"
        : result.hasUnverifiedSideEffect
          ? "partial_success"
          : "success";

      // 构建标准 AgentResult
      const agentResult = await buildAgentResult({
        runId: run.id,
        runUid,
        summary: result.summary,
        status: finalStatus,
      });

      await db
        .update(agentRuns)
        .set({
          status: agentResult.status,
          resultSummary: agentResult.summary,
          outputJson: jsonStringify(agentResult),
          finishedAt,
          updatedAt: finishedAt,
        })
        .where(eq(agentRuns.id, run.id));

      // 发布 Run 完成事件
      runEventBus.emitRunStatus(runUid, {
        runId: runUid,
        status: finalStatus,
        resultSummary: result.summary,
        updatedAt: finishedAt,
      });

      if (input.workContextId) {
        await db
          .update(workContexts)
          .set({
            currentRunId: run.id,
            updatedAt: finishedAt,
          })
          .where(eq(workContexts.workContextUid, input.workContextId));
      }

      return {
        runId: run.id,
        runUid: run.runUid,
        status: finalStatus,
        summary: result.summary,
        stepsCount: result.stepsCount,
      };
    } catch (error) {
      const finishedAt = nowIso();
      const message = error instanceof Error ? error.message : String(error);

      const errorStep = await this.createStep({
        runId: run.id,
        stepIndex: 9999,
        stepType: "error",
        content: message,
        output: { error: message },
      });

      // 发布错误步骤事件
      runEventBus.emitRunStep(runUid, {
        runId: runUid,
        stepIndex: errorStep.stepIndex,
        stepType: "error",
        content: message,
        createdAt: errorStep.createdAt,
      });

      await db
        .update(agentRuns)
        .set({
          status: "failed",
          errorMessage: message,
          finishedAt,
          updatedAt: finishedAt,
        })
        .where(eq(agentRuns.id, run.id));

      // 发布 Run 失败事件
      runEventBus.emitRunStatus(runUid, {
        runId: runUid,
        status: "failed",
        resultSummary: message,
        updatedAt: finishedAt,
      });

      throw error;
    }
  }

  private async executeRunLoop(args: {
    runId: number;
    runUid: string;
    profile: typeof modelProfiles.$inferSelect;
    input: RunAgentInput;
  }) {
    const allowedTools = jsonParse<string[]>(args.input.versionRecord.allowedToolsJson, []);
    const contextPolicy = jsonParse<Record<string, unknown>>(args.input.versionRecord.contextPolicyJson, {});
    const artifactDirectiveConfig = parseArtifactDirectiveConfig(contextPolicy);
    const modelParamsOverride = jsonParse<Record<string, unknown>>(
      args.input.versionRecord.modelParamsOverrideJson,
      {},
    );
    const modelDefaultParams = jsonParse<Record<string, unknown>>(args.profile.defaultParamsJson, {});

    // Kimi k2.5 不需要传入 temperature 参数，使用模型默认值
    const isKimiK25 = args.profile.modelName === "kimi-k2.5";
    if (isKimiK25) {
      delete modelDefaultParams.temperature;
      delete modelParamsOverride.temperature;
    }

    // 从 AgentVersion.allowedPluginIdsJson 获取显式绑定的插件
    console.log(`[AgentRuntime] ========== 插件挂载诊断 ==========`);
    console.log(`[AgentRuntime] Agent: ${args.input.agentRecord.agentUid} (ID: ${args.input.agentRecord.id})`);
    console.log(`[AgentRuntime] pluginRegistry 是否存在: ${!!this.pluginRegistry}`);

    const allowedPluginIds = jsonParse<string[]>(
      args.input.versionRecord.allowedPluginIdsJson,
      []
    );
    console.log(`[AgentRuntime] AgentVersion.allowedPluginIds: ${JSON.stringify(allowedPluginIds)}`);

    const activePlugins = this.pluginRegistry?.getActivePlugins() ?? [];
    const attachedPlugins = activePlugins.filter((p) =>
      allowedPluginIds.includes(p.pluginId)
    );

    console.log(`[AgentRuntime] 获取到挂载插件数: ${attachedPlugins.length}`);
    attachedPlugins.forEach(p => {
      console.log(`[AgentRuntime]   - 插件: ${p.pluginId}, 工具数: ${p.tools?.length ?? 0}`);
    });

    // 合并插件工具，工具名称格式为: pluginId__toolId
    const pluginToolIds = attachedPlugins.flatMap((p) =>
      p.tools?.map((t) => `${p.pluginId}__${t.toolId}`) ?? []
    );
    console.log(`[AgentRuntime] 插件工具ID列表: ${JSON.stringify(pluginToolIds)}`);

    const baseAllowedTools = [...new Set([...pluginToolIds, ...allowedTools])];
    console.log(`[AgentRuntime] AgentVersion.allowedTools: ${JSON.stringify(allowedTools)}`);
    console.log(`[AgentRuntime] 合并后 baseAllowedTools: ${JSON.stringify(baseAllowedTools)}`);

    // 与 TaskEnvelope.allowedTools 取并集（如果 TaskEnvelope 有指定工具，则合并到 baseAllowedTools）
    const envelopeAllowedTools = args.input.taskEnvelope?.allowedTools;
    console.log(`[AgentRuntime] TaskEnvelope.allowedTools: ${JSON.stringify(envelopeAllowedTools)}`);
    
    // 取并集：baseAllowedTools + envelopeAllowedTools（去重）
    const mergedAllowedTools = envelopeAllowedTools && envelopeAllowedTools.length > 0
      ? [...new Set([...baseAllowedTools, ...envelopeAllowedTools])]
      : baseAllowedTools;
    console.log(`[AgentRuntime] 最终 mergedAllowedTools（并集）: ${JSON.stringify(mergedAllowedTools)}`);
    console.log(`[AgentRuntime] ======================================`);

    const toolRuntime = new ToolRuntime(mergedAllowedTools, this.pluginRegistry);

    // 注册 plugin_read_item 工具
    if (this.pluginRegistry) {
      registerPluginReadItemTool(toolRuntime, this.pluginRegistry);
    }

    const toolManifest = toolRuntime.getToolManifest();

    // 第一阶段 PromptContext 还不读取 WorkContext / RunTrace / Memory，
    // 但仍然通过 ContextBuilder 统一入口组装，避免后续阶段改 Runtime 主流程。
    // 计算 effectiveUserMessage
    const effectiveUserMessage =
      args.input.mode === "subagent" && args.input.taskEnvelope
        ? renderTaskEnvelopeForAgent(args.input.taskEnvelope)
        : args.input.originalUserMessage || args.input.userMessage;

    const promptContext = buildPromptContext({
      systemPrompt: args.input.versionRecord.systemPrompt,
      skillText: args.input.versionRecord.skillText,
      userMessage: effectiveUserMessage,
      handoffNote: undefined,
      toolManifest,
      contextPolicy,
      maxContextTokens: args.profile.maxContextTokens,
    });

    await db
      .update(agentRuns)
      .set({ contextPackageSummaryJson: jsonStringify(summarizePromptContext(promptContext)) })
      .where(eq(agentRuns.id, args.runId));

    // 构建插件目录注入文本
    const pluginCatalogInjection = attachedPlugins.length > 0
      ? buildPluginCatalogInjection(attachedPlugins)
      : "";

    const systemMessage = this.renderSystemMessage(promptContext, artifactDirectiveConfig, pluginCatalogInjection);

    // 打印插件目录注入日志（用于验证）
    if (pluginCatalogInjection) {
      console.log("\n========== PLUGIN CATALOG INJECTION ==========");
      //console.log(pluginCatalogInjection);
      //console.log("========== END PLUGIN CATALOG ==========\n");
    } else {
      console.log("[AgentRuntime] No plugins attached to this AgentVersion");
    }

    // 打印 toolManifest 内容用于调试
    // console.log("\n========== TOOL MANIFEST (传给 LLM 的 tools) ==========");
   // console.log(JSON.stringify(toolManifest, null, 2));
    console.log(`========== 共 ${toolManifest.length} 个工具 ==========\n`);

    // 打印 systemMessage 内容用于调试
    console.log("\n========== SYSTEM MESSAGE ==========");
    console.log(systemMessage);
    console.log("========== END SYSTEM MESSAGE ==========\n");

    // 打印用户消息用于调试
    console.log("\n========== USER MESSAGE ==========");
    console.log(effectiveUserMessage);
    console.log("========== END USER MESSAGE ==========\n");

    const messages: ChatMessage[] = [
      { role: "system", content: systemMessage },
      { role: "user", content: effectiveUserMessage },
    ];

    let stepIndex = 1;
    let latestContent = "";
    let pendingArtifactCandidates: PendingArtifactCandidate[] = [];
    let hasFailedTool = false;
    let hasUnverifiedSideEffect = false;

    // 第一阶段的主循环故意保持小：先验证模型调用、工具白名单和运行轨迹。
    for (let turn = 0; turn < args.input.versionRecord.maxSteps; turn += 1) {
      console.log(`[AgentRuntime] 开始第 ${turn + 1} 轮模型调用，当前消息数:`, messages.length);
      const modelStep = await this.createStep({
        runId: args.runId,
        stepIndex: stepIndex++,
        stepType: "model_call",
        input: { messageCount: messages.length, toolNames: toolManifest.map((tool) => tool.function.name) },
      });

      const started = Date.now();
      const modelResult = await this.modelClient.invoke({
        provider: args.profile.provider,
        modelName: args.profile.modelName,
        baseUrl: args.profile.baseUrl,
        params: { ...modelDefaultParams, ...modelParamsOverride },
        messages,
        tools: toolManifest,
      });

      const directives = extractArtifactDirectives(modelResult.content);
      latestContent = directives.cleanContent;

      if (directives.artifactDecisions.length > 0) {
        const decisionResult = await persistArtifactsFromAgentDecisions({
          workContextUid: args.input.workContextId,
          runId: args.runId,
          pendingCandidates: pendingArtifactCandidates,
          decisions: directives.artifactDecisions,
        });

        if (decisionResult.consumedCandidateIds.length > 0) {
          const consumedSet = new Set(decisionResult.consumedCandidateIds);
          pendingArtifactCandidates = pendingArtifactCandidates.filter(
            (item) => !consumedSet.has(item.candidateId),
          );
        }
      }

      if (directives.declaredArtifacts.length > 0) {
        await persistDeclaredArtifacts({
          workContextUid: args.input.workContextId,
          runId: args.runId,
          declaredArtifacts: directives.declaredArtifacts,
        });
      }

      await db
        .update(agentRunSteps)
        .set({
          content: directives.cleanContent,
          outputJson: jsonStringify({
            hasToolCalls: modelResult.toolCalls.length > 0,
            toolCallCount: modelResult.toolCalls.length,
            artifactDecisionCount: directives.artifactDecisions.length,
            declaredArtifactCount: directives.declaredArtifacts.length,
          }),
        })
        .where(eq(agentRunSteps.id, modelStep.id));

      await this.createModelInvocation({
        runId: args.runId,
        stepId: modelStep.id,
        profile: args.profile,
        params: { ...modelDefaultParams, ...modelParamsOverride },
        requestSummary: { messageCount: messages.length, toolCount: toolManifest.length },
        responseSummary: {
          hasContent: directives.cleanContent.length > 0,
          toolCallCount: modelResult.toolCalls.length,
        },
        promptContextSummary: summarizePromptContext(promptContext),
        selectedContextRefs: selectedContextRefsForFirstPhase(),
        usage: modelResult.usage,
        latencyMs: Date.now() - started,
        status: "success",
      });

      if (modelResult.toolCalls.length === 0) {
        if (pendingArtifactCandidates.length > 0) {
          await persistArtifactsFromToolResult({
            workContextUid: args.input.workContextId,
            runId: args.runId,
            toolResult: {
              success: true,
              artifactCandidates: pendingArtifactCandidates.map((item) => item.candidate),
            },
          });
          pendingArtifactCandidates = [];
        }

        await this.createStep({
          runId: args.runId,
          stepIndex: stepIndex++,
          stepType: "final",
          content: directives.cleanContent,
          output: { content: directives.cleanContent },
        });

        return {
          summary: directives.cleanContent || "Agent run completed.",
          stepsCount: stepIndex - 1,
          hasFailedTool,
          hasUnverifiedSideEffect,
        };
      }

      // 构建 assistant 消息，包含 tool_calls
      // 对于支持 thinking 的模型（如 Kimi k2.5），需要添加 reasoning_content 字段
      const assistantMessage: {
        role: "assistant";
        content: string;
        tool_calls: Array<{
          id: string;
          type: "function";
          function: { name: string; arguments: string };
        }>;
        reasoning_content?: string;
      } = {
        role: "assistant",
        content: directives.cleanContent,
        tool_calls: modelResult.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: "function" as const,
          function: {
            name: toolCall.name,
            arguments: jsonStringify(toolCall.arguments),
          },
        })),
      };
      // 如果模型返回了 reasoning_content，则包含它
      // 对于支持 thinking 的模型（如 Kimi k2.5），所有 assistant 消息都必须包含 reasoning_content
      const rawResponse = modelResult.raw as Record<string, unknown> | undefined;
      const rawChoices = rawResponse?.choices as Array<Record<string, unknown>> | undefined;
      const rawMessage = rawChoices?.[0]?.message as Record<string, unknown> | undefined;
      console.log("[AgentRuntime] rawMessage keys:", rawMessage ? Object.keys(rawMessage) : "undefined");
      console.log("[AgentRuntime] rawMessage.reasoning_content:", rawMessage?.reasoning_content);
      // 对于 Kimi k2.5，始终添加 reasoning_content（即使为空字符串）
      if (args.profile.modelName === "kimi-k2.5") {
        const reasoningContent = typeof rawMessage?.reasoning_content === "string" ? rawMessage.reasoning_content : "";
        assistantMessage.reasoning_content = reasoningContent;
        console.log("[AgentRuntime] 添加 reasoning_content 到 assistant 消息:", reasoningContent ? "有内容" : "空字符串");
      } else if (typeof rawMessage?.reasoning_content === "string") {
        assistantMessage.reasoning_content = rawMessage.reasoning_content;
      }
      messages.push(assistantMessage);
      console.log("[AgentRuntime] Assistant 消息已添加，tool_calls 数量:", assistantMessage.tool_calls.length);

      for (const toolCall of modelResult.toolCalls) {
        // tool_start 轻量化：只存 summary + inputRefs，不存大 content
      const toolStartMetadata = {
        inputRefs: [],
        omittedFields: ["content"],
        recordLevel: "summary",
      };

      await this.createStep({
          runId: args.runId,
          stepIndex: stepIndex++,
          stepType: "tool_start",
          toolName: toolCall.name,
          toolCallId: toolCall.id,
          toolStatus: "running",
          input: { toolName: toolCall.name, argsKeys: Object.keys(toolCall.arguments) },
          metadata: toolStartMetadata,
        });

        const toolResult = await toolRuntime.execute(toolCall.name, toolCall.arguments);
        const decoratedToolResult = attachCandidateIdsToToolResult({
          toolName: toolCall.name,
          toolCallId: toolCall.id,
          toolResult,
        });

        // 累计工具执行状态
        if (!decoratedToolResult.toolResult.success) {
          hasFailedTool = true;
        }
        if (decoratedToolResult.toolResult.verification?.status === "unverified") {
          hasUnverifiedSideEffect = true;
        }

        if (decoratedToolResult.pendingCandidates.length > 0) {
          pendingArtifactCandidates = [
            ...pendingArtifactCandidates,
            ...decoratedToolResult.pendingCandidates,
          ];
        }

        // tool_end 存 ToolResult + metadata，包含 operation/sideEffects/verification
        const toolEndMetadata = {
          inputRefs: [],
          operation: decoratedToolResult.toolResult.operation,
          sideEffects: decoratedToolResult.toolResult.sideEffects,
          verification: decoratedToolResult.toolResult.verification,
          outputRefs: decoratedToolResult.toolResult.outputRefs,
          recordLevel: "result",
        };

        await this.createStep({
          runId: args.runId,
          stepIndex: stepIndex++,
          stepType: "tool_end",
          toolName: toolCall.name,
          toolCallId: toolCall.id,
          toolStatus: decoratedToolResult.toolResult.success ? "success" : "failed",
          output: decoratedToolResult.toolResult,
          metadata: toolEndMetadata,
        });

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: jsonStringify(decoratedToolResult.toolResult),
        });
      }
      console.log(`[AgentRuntime] 第 ${turn + 1} 轮完成，消息数:`, messages.length);
    }

    if (pendingArtifactCandidates.length > 0) {
      await persistArtifactsFromToolResult({
        workContextUid: args.input.workContextId,
        runId: args.runId,
        toolResult: {
          success: true,
          artifactCandidates: pendingArtifactCandidates.map((item) => item.candidate),
        },
      });
    }

    return {
      summary: latestContent || "Agent run reached max steps.",
      stepsCount: stepIndex - 1,
      hasFailedTool,
      hasUnverifiedSideEffect,
    };
  }

  private renderSystemMessage(
    context: ReturnType<typeof buildPromptContext>,
    artifactDirectiveConfig: ArtifactDirectiveConfig,
    pluginCatalogInjection?: string,
  ): string {
    const sections = [
      context.systemPrompt,
      context.skillText ? `\nSkill:\n${context.skillText}` : "",
      context.handoffNote ? `\nHandoff note:\n${context.handoffNote}` : "",
    ];

    // 注入插件目录摘要
    if (pluginCatalogInjection) {
      sections.push("\n" + pluginCatalogInjection);
    }

    sections.push(
      "\nUse only the tools exposed in the tool manifest.",
      "\nReturn a concise final answer when done.",
      "\n你必须严格按照 Objective 执行任务。",
      // "\nOriginal User Message 仅作为背景参考，不可扩展任务范围。",
      // "\n如果 Objective 与 Original User Message 冲突，必须以 Objective 为唯一执行目标。",
    );

    if (artifactDirectiveConfig.enabled) {
      sections.push(
        "\nArtifact directives are enabled for this agent version.",
        "\nIf you want to preserve or discard tool-produced artifact candidates, you may add one machine-readable block anywhere in your reply using the exact tag <artifact_directives>...</artifact_directives>.",
        '\nWithin that block, you may provide {"artifactDecisions":[{"candidateId":"toolcall:artifact:1","keep":true,"artifactRole":"reference","title":"Optional title override"}]}.',
      );

      if (artifactDirectiveConfig.mode === "full") {
        sections.push(
          '\nFull mode is enabled, so you may also declare new artifacts with {"declaredArtifacts":[{"artifactType":"text","artifactRole":"final","title":"Final summary","contentText":"..."}]}.',
        );
      }

      sections.push(
        "\nOnly include the block when you have artifact decisions or declared artifacts. Keep your normal user-facing answer outside the block.",
      );
    }

    return sections.join("\n");
  }

  private async createStep(input: RunStepInsert) {
    const [step] = await db
      .insert(agentRunSteps)
      .values({
        runId: input.runId,
        stepIndex: input.stepIndex,
        stepType: input.stepType,
        content: input.content,
        toolName: input.toolName,
        toolCallId: input.toolCallId,
        toolStatus: input.toolStatus,
        inputJson: jsonStringify(input.input ?? {}),
        outputJson: jsonStringify(input.output ?? {}),
        metadataJson: jsonStringify(input.metadata ?? {}),
        createdAt: nowIso(),
      })
      .returning();

    // 发布步骤事件到事件总线（当前 run）
    if (this.currentRunUid) {
      runEventBus.emitRunStep(this.currentRunUid, {
        runId: this.currentRunUid,
        stepIndex: step.stepIndex,
        stepType: step.stepType,
        content: step.content ?? undefined,
        toolName: step.toolName ?? undefined,
        toolStatus: step.toolStatus ?? undefined,
        input: input.input,
        output: input.output,
        createdAt: step.createdAt,
        agentName: this.agentName,
      });
    }

    // 如果有父 run，也发布到父 run（用于前端统一展示）
    if (this.parentRunId) {
      console.log(`[AgentRuntime] Forwarding step ${step.stepIndex} to parent run ${this.parentRunId}`);
      const [parentRun] = await db
        .select({ runUid: agentRuns.runUid })
        .from(agentRuns)
        .where(eq(agentRuns.id, this.parentRunId));
      
      if (parentRun) {
        console.log(`[AgentRuntime] Emitting step to parent run ${parentRun.runUid}`);
        runEventBus.emitRunStep(parentRun.runUid, {
          runId: parentRun.runUid,
          stepIndex: step.stepIndex,
          stepType: step.stepType,
          content: step.content ?? undefined,
          toolName: step.toolName ?? undefined,
          toolStatus: step.toolStatus ?? undefined,
          input: input.input,
          output: input.output,
          createdAt: step.createdAt,
          agentName: this.agentName,
        });
      } else {
        console.warn(`[AgentRuntime] Parent run ${this.parentRunId} not found`);
      }
    }

    return step;
  }

  private async createModelInvocation(input: {
    runId: number;
    stepId: number;
    profile: typeof modelProfiles.$inferSelect;
    params: Record<string, unknown>;
    requestSummary: unknown;
    responseSummary: unknown;
    promptContextSummary: unknown;
    selectedContextRefs: unknown;
    usage?: { inputTokens?: number; outputTokens?: number };
    latencyMs: number;
    status: "success" | "failed";
    errorMessage?: string;
  }) {
    await db.insert(modelInvocations).values({
      invocationUid: makeUid("invoke"),
      runId: input.runId,
      stepId: input.stepId,
      modelProfileId: input.profile.id,
      provider: input.profile.provider,
      modelName: input.profile.modelName,
      paramsJson: jsonStringify(input.params),
      requestSummaryJson: jsonStringify(input.requestSummary),
      responseSummaryJson: jsonStringify(input.responseSummary),
      promptContextSummaryJson: jsonStringify(input.promptContextSummary),
      selectedContextRefsJson: jsonStringify(input.selectedContextRefs),
      inputTokens: input.usage?.inputTokens ?? null,
      outputTokens: input.usage?.outputTokens ?? null,
      latencyMs: input.latencyMs,
      status: input.status,
      errorMessage: input.errorMessage,
      createdAt: nowIso(),
    });
  }
}
