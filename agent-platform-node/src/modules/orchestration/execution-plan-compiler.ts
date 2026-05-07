/**
 * ExecutionPlanCompiler
 * 把 MainDecision 确定性转换为 ExecutionPlan
 * 这个模块不需要 LLM
 */

import { makeUid } from "../../shared/ids.js";
import type { MainDecision } from "./main-decision.schema.js";
import type { SessionRuntimeSnapshot, SessionContextIndex, ExecutionPlan } from "./orchestration.types.js";

export class ExecutionPlanCompiler {
  compile(input: {
    decision: MainDecision;
    snapshot: SessionRuntimeSnapshot;
    contextIndex: SessionContextIndex;
  }): ExecutionPlan {
    const { decision } = input;
    const planUid = makeUid("plan");

    // decisionType -> mode 映射
    const hasSteps = !!decision.plan?.steps && decision.plan.steps.length > 0;
    const mode = this.mapDecisionTypeToMode(decision.decisionType, hasSteps);

    // 收集所有 selected refs
    const selectedRefs = [
      ...decision.primaryRefs,
      ...decision.secondaryRefs,
    ];

    // 生成 steps
    const steps: ExecutionPlan["steps"] = [];

    if (decision.plan?.steps) {
      for (let i = 0; i < decision.plan.steps.length; i++) {
        const draft = decision.plan.steps[i];
        const stepUid = makeUid("step");

        // 计算 allowedTools：从 Agent 当前可用工具中筛选
        const allowedTools = this.computeAllowedTools({
          targetAgentUid: draft.targetAgentUid,
          snapshot: input.snapshot,
          contextIndex: input.contextIndex,
        });

        steps.push({
          stepUid,
          targetAgentUid: draft.targetAgentUid,
          objective: draft.objective,
          inputRefIds: draft.inputRefIds,
          dependsOn: i > 0 ? [steps[i - 1].stepUid] : [],
          expectedResultKind: draft.expectedResultKind ?? "answer",
          requireVerification: draft.requireVerification ?? false,
          allowedTools,
        });
      }
    }

    // 确定 finalResponseStrategy
    const finalResponseStrategy = this.determineResponseStrategy(decision, steps);

    return {
      planUid,
      mode,
      sessionId: input.snapshot.session.sessionUid,
      selectedRefs,
      steps,
      finalResponseStrategy,
    };
  }

  private mapDecisionTypeToMode(
    decisionType: MainDecision["decisionType"],
    hasSteps: boolean
  ): ExecutionPlan["mode"] {
    switch (decisionType) {
      case "answer_directly":
        return "direct_response";
      case "delegate":
        return "single_agent";
      case "multi_step_plan":
        return "sequential_agents";
      case "recover_execution":
      case "verify_execution":
        return "sequential_agents";
      default:
        return "direct_response";
    }
  }

  private computeAllowedTools(input: {
    targetAgentUid: string;
    snapshot: SessionRuntimeSnapshot;
    contextIndex: SessionContextIndex;
  }): string[] {
    // 返回空数组表示不限制工具使用
    // 实际工具权限由 AgentRuntime 根据 AgentVersion.allowedTools 和挂载插件决定
    return [];
  }

  private determineResponseStrategy(
    decision: MainDecision,
    steps: ExecutionPlan["steps"]
  ): ExecutionPlan["finalResponseStrategy"] {
    if (decision.decisionType === "answer_directly") {
      return "use_direct_response";
    }

    if (steps.length === 1) {
      return "compose_from_agent_results";
    }

    return "compose_from_ledger";
  }
}
