import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { agentRunSteps, agentRuns, modelInvocations, modelProfiles, workContexts } from "../db/schema.js";
import { jsonParse, jsonStringify } from "../shared/json.js";
import { makeUid } from "../shared/ids.js";
import { nowIso } from "../shared/time.js";
import {
  buildPromptContext,
  selectedContextRefsForFirstPhase,
  summarizePromptContext,
} from "./context-builder.js";
import type { ChatMessage } from "./model-client.js";
import { ModelClient } from "./model-client.js";
import { ToolRuntime } from "./tool-runtime.js";

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
    allowedToolsJson: string;
    contextPolicyJson: string;
    modelParamsOverrideJson: string;
    maxSteps: number;
  };
  userMessage: string;
  handoffNote?: string;
  userId?: string;
  sessionId?: string;
  workContextId?: string;
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

  async run(input: RunAgentInput) {
    const [profile] = await db
      .select()
      .from(modelProfiles)
      .where(eq(modelProfiles.id, input.versionRecord.modelProfileId));

    if (!profile) throw new Error("ModelProfile not found for AgentVersion");

    const now = nowIso();
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

    const [run] = await db
      .insert(agentRuns)
      .values({
        runUid: makeUid("run"),
        agentId: input.agentRecord.id,
        agentVersionId: input.versionRecord.id,
        userId: input.userId,
        sessionId: input.sessionId,
        workContextId: input.workContextId,
        mode: input.mode,
        status: "running",
        userMessage: input.userMessage,
        handoffNote: input.handoffNote,
        snapshotJson: jsonStringify(snapshot),
        createdAt: now,
        updatedAt: now,
        startedAt: now,
      })
      .returning();

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
      const result = await this.executeRunLoop({ runId: run.id, profile, input });
      const finishedAt = nowIso();

      await db
        .update(agentRuns)
        .set({
          status: "success",
          resultSummary: result.summary,
          outputJson: jsonStringify(result),
          finishedAt,
          updatedAt: finishedAt,
        })
        .where(eq(agentRuns.id, run.id));

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
        runUid: run.runUid,
        status: "success",
        summary: result.summary,
        stepsCount: result.stepsCount,
      };
    } catch (error) {
      const finishedAt = nowIso();
      const message = error instanceof Error ? error.message : String(error);

      await this.createStep({
        runId: run.id,
        stepIndex: 9999,
        stepType: "error",
        content: message,
        output: { error: message },
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

      throw error;
    }
  }

  private async executeRunLoop(args: {
    runId: number;
    profile: typeof modelProfiles.$inferSelect;
    input: RunAgentInput;
  }) {
    const allowedTools = jsonParse<string[]>(args.input.versionRecord.allowedToolsJson, []);
    const contextPolicy = jsonParse<Record<string, unknown>>(args.input.versionRecord.contextPolicyJson, {});
    const modelParamsOverride = jsonParse<Record<string, unknown>>(
      args.input.versionRecord.modelParamsOverrideJson,
      {},
    );
    const modelDefaultParams = jsonParse<Record<string, unknown>>(args.profile.defaultParamsJson, {});
    const toolRuntime = new ToolRuntime(allowedTools);
    const toolManifest = toolRuntime.getToolManifest();

    // 第一阶段 PromptContext 还不读取 WorkContext / RunTrace / Memory，
    // 但仍然通过 ContextBuilder 统一入口组装，避免后续阶段改 Runtime 主流程。
    const promptContext = buildPromptContext({
      systemPrompt: args.input.versionRecord.systemPrompt,
      skillText: args.input.versionRecord.skillText,
      userMessage: args.input.userMessage,
      handoffNote: args.input.handoffNote,
      toolManifest,
      contextPolicy,
      maxContextTokens: args.profile.maxContextTokens,
    });

    await db
      .update(agentRuns)
      .set({ contextPackageSummaryJson: jsonStringify(summarizePromptContext(promptContext)) })
      .where(eq(agentRuns.id, args.runId));

    const messages: ChatMessage[] = [
      { role: "system", content: this.renderSystemMessage(promptContext) },
      { role: "user", content: args.input.userMessage },
    ];

    let stepIndex = 1;
    let latestContent = "";

    // 第一阶段的主循环故意保持小：先验证模型调用、工具白名单和运行轨迹。
    for (let turn = 0; turn < args.input.versionRecord.maxSteps; turn += 1) {
      const modelStep = await this.createStep({
        runId: args.runId,
        stepIndex: stepIndex++,
        stepType: "model_call",
        input: { messageCount: messages.length, toolNames: toolManifest.map((tool) => tool.name) },
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

      latestContent = modelResult.content;
      await db
        .update(agentRunSteps)
        .set({
          content: modelResult.content,
          outputJson: jsonStringify({
            hasToolCalls: modelResult.toolCalls.length > 0,
            toolCallCount: modelResult.toolCalls.length,
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
          hasContent: modelResult.content.length > 0,
          toolCallCount: modelResult.toolCalls.length,
        },
        promptContextSummary: summarizePromptContext(promptContext),
        selectedContextRefs: selectedContextRefsForFirstPhase(),
        usage: modelResult.usage,
        latencyMs: Date.now() - started,
        status: "success",
      });

      if (modelResult.toolCalls.length === 0) {
        await this.createStep({
          runId: args.runId,
          stepIndex: stepIndex++,
          stepType: "final",
          content: modelResult.content,
          output: { content: modelResult.content },
        });

        return { summary: modelResult.content || "Agent run completed.", stepsCount: stepIndex - 1 };
      }

      messages.push({
        role: "assistant",
        content: modelResult.content,
        tool_calls: modelResult.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: "function",
          function: {
            name: toolCall.name,
            arguments: jsonStringify(toolCall.arguments),
          },
        })),
      });

      for (const toolCall of modelResult.toolCalls) {
        await this.createStep({
          runId: args.runId,
          stepIndex: stepIndex++,
          stepType: "tool_start",
          toolName: toolCall.name,
          toolCallId: toolCall.id,
          toolStatus: "running",
          input: toolCall.arguments,
        });

        const toolResult = await toolRuntime.execute(toolCall.name, toolCall.arguments);

        await this.createStep({
          runId: args.runId,
          stepIndex: stepIndex++,
          stepType: "tool_end",
          toolName: toolCall.name,
          toolCallId: toolCall.id,
          toolStatus: toolResult.success ? "success" : "failed",
          output: toolResult,
        });

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: jsonStringify(toolResult),
        });
      }
    }

    return { summary: latestContent || "Agent run reached max steps.", stepsCount: stepIndex - 1 };
  }

  private renderSystemMessage(context: ReturnType<typeof buildPromptContext>): string {
    return [
      context.systemPrompt,
      context.skillText ? `\nSkill:\n${context.skillText}` : "",
      context.handoffNote ? `\nHandoff note:\n${context.handoffNote}` : "",
      "\nUse only the tools exposed in the tool manifest. Return a concise final answer when done.",
    ].join("\n");
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
