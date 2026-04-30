/**
 * DecisionContractValidator
 * 校验 LLM 输出是否引用了真实对象，不判断用户业务语义
 */

import type { MainDecision } from "./main-decision.schema.js";
import type { SessionRuntimeSnapshot, SessionContextIndex } from "./orchestration.types.js";

export type ValidationResult =
  | { valid: true; normalizedDecision: MainDecision }
  | { valid: false; fallbackDecision: MainDecision; issues: string[] };

export class DecisionContractValidator {
  validate(input: {
    decision: MainDecision;
    snapshot: SessionRuntimeSnapshot;
    contextIndex: SessionContextIndex;
  }): ValidationResult {
    const { decision, snapshot, contextIndex } = input;
    const issues: string[] = [];

    const validWorkContextUids = new Set(snapshot.workContexts.map((wc) => wc.workContextUid));
    const validRefIds = new Set(contextIndex.refs.map((ref) => ref.refId));
    const validAgentUids = new Set(snapshot.availableAgents.map((a) => a.agentUid));

    // 1. primaryRefs 校验
    for (const refId of decision.primaryRefs) {
      if (!validRefIds.has(refId)) {
        issues.push(`primaryRef ${refId} 不存在`);
      }
    }

    // 2. secondaryRefs 校验
    for (const refId of decision.secondaryRefs) {
      if (!validRefIds.has(refId)) {
        issues.push(`secondaryRef ${refId} 不存在`);
      }
    }

    // 3. targetAgentUid 校验
    if (decision.targetAgentUid) {
      if (!validAgentUids.has(decision.targetAgentUid)) {
        issues.push(`targetAgentUid ${decision.targetAgentUid} 不存在`);
      }
    }

    // 4. plan.steps 校验
    if (decision.plan?.steps) {
      for (const step of decision.plan.steps) {
        if (!validAgentUids.has(step.targetAgentUid)) {
          issues.push(`plan step targetAgentUid ${step.targetAgentUid} 不存在`);
        }
        for (const refId of step.inputRefIds) {
          if (!validRefIds.has(refId)) {
            issues.push(`plan step inputRefId ${refId} 不存在`);
          }
        }
      }
    }

    // 5. decisionType 必填字段校验
    const requiresPlan = [
      "delegate",
      "multi_step_plan",
      "recover_execution",
      "verify_execution",
    ].includes(decision.decisionType);

    const mayCreateWorkContext =
      decision.decisionType === "create_work_context" ||
      decision.decisionType === "delegate" ||
      decision.decisionType === "multi_step_plan" ||
      decision.decisionType === "recover_execution" ||
      decision.decisionType === "verify_execution";

    if (requiresPlan && (!decision.plan || decision.plan.steps.length === 0)) {
      issues.push(`${decision.decisionType} 需要 plan.steps`);
    }

    if (decision.decisionType === "answer_directly" && (decision.response === null || decision.response === undefined)) {
      issues.push("answer_directly 需要 response");
    }

    if (decision.decisionType === "ask_user" && (!decision.ambiguity || !decision.ambiguity.question)) {
      issues.push("ask_user 需要 ambiguity.question");
    }

    if (decision.targetWorkContextUid && !validWorkContextUids.has(decision.targetWorkContextUid)) {
      issues.push(`targetWorkContextUid ${decision.targetWorkContextUid} 不存在，LLM 可能编造了 WorkContextUid`);
    }

    if (mayCreateWorkContext && !decision.targetWorkContextUid) {
      if (!decision.createWorkContext?.title || !decision.createWorkContext?.goal) {
        issues.push("没有 targetWorkContextUid 时必须提供 createWorkContext.title/goal");
      }
    }

    if (decision.decisionType === "create_work_context") {
      if (decision.targetWorkContextUid !== null) {
        issues.push("create_work_context 不允许携带 targetWorkContextUid");
      }
    }

    // 7. 如果校验失败，返回 fallback
    if (issues.length > 0) {
      const fallbackDecision: MainDecision = {
        decisionType: "ask_user",
        targetWorkContextUid: null,
        createWorkContext: null,
        primaryRefs: [],
        secondaryRefs: [],
        targetAgentUid: null,
        plan: null,
        response: null,
        ambiguity: {
          candidateWorkContextUids: Array.from(validWorkContextUids),
          candidateRefIds: decision.primaryRefs.filter((refId) => validRefIds.has(refId)),
          question: `我发现了一些问题：${issues.join("；")}。请确认你要继续处理哪一项。`,
        },
        confidence: "low",
        reasoning: `Decision validation failed: ${issues.join("; ")}`,
      };

      return { valid: false, fallbackDecision, issues };
    }

    return { valid: true, normalizedDecision: decision };
  }
}
