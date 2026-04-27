import { EventEmitter } from "events";

// Run 步骤更新事件
export interface RunStepEvent {
  runId: string;
  stepIndex: number;
  stepType: string;
  content?: string;
  toolName?: string;
  toolStatus?: string;
  input?: unknown;
  output?: unknown;
  createdAt: string;
  agentName?: string;
}

// Run 状态更新事件
export interface RunStatusEvent {
  runId: string;
  status: string;
  resultSummary?: string | null;
  updatedAt: string;
}

// 全局事件总线
class RunEventBus extends EventEmitter {
  // 订阅 Run 步骤更新
  subscribeToRunSteps(runId: string, callback: (step: RunStepEvent) => void): () => void {
    const eventName = `run:${runId}:step`;
    this.on(eventName, callback);

    // 返回取消订阅函数
    return () => {
      this.off(eventName, callback);
    };
  }

  // 订阅 Run 状态更新
  subscribeToRunStatus(runId: string, callback: (status: RunStatusEvent) => void): () => void {
    const eventName = `run:${runId}:status`;
    this.on(eventName, callback);

    return () => {
      this.off(eventName, callback);
    };
  }

  // 发布 Run 步骤更新
  emitRunStep(runId: string, step: RunStepEvent): void {
    const eventName = `run:${runId}:step`;
    this.emit(eventName, step);
    console.log(`[EventBus] 发布步骤事件: ${runId}, step=${step.stepIndex}`);
  }

  // 发布 Run 状态更新
  emitRunStatus(runId: string, status: RunStatusEvent): void {
    const eventName = `run:${runId}:status`;
    this.emit(eventName, status);
    console.log(`[EventBus] 发布状态事件: ${runId}, status=${status.status}`);
  }
}

// 单例导出
export const runEventBus = new RunEventBus();
