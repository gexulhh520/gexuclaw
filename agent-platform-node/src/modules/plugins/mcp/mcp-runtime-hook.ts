import { spawn } from "child_process";
import type { ToolResult } from "../../../tools/tool-types.js";

export type RuntimeCommandStep = {
  name?: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
  ignoreError?: boolean;
};

export type RuntimeHealthCheckConfig = {
  enabled?: boolean;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
  readyPatterns?: string[];
  notReadyPatterns?: string[];
};

export type RuntimeResetPolicyConfig = {
  enabled?: boolean;
  triggerWhenNotReady?: boolean;
  steps?: RuntimeCommandStep[];
};

export type RuntimeBeforeToolHookConfig = {
  enabled?: boolean;
  mode?: "checkOnly" | "resetOnUnhealthy";
  runOnEveryToolCall?: boolean;
  timeoutMs?: number;
};

export type RuntimeAfterRegisterHookConfig = {
  enabled?: boolean;
  mode?: "checkOnly";
  blockOnFailure?: boolean;
  updateHealthStatus?: boolean;
};

export type RuntimeLifecycleHooksConfig = {
  afterRegister?: RuntimeAfterRegisterHookConfig;
  beforeTool?: RuntimeBeforeToolHookConfig;
};

export type RuntimeHookConfig = {
  lifecycleHooks?: RuntimeLifecycleHooksConfig;
  healthCheck?: RuntimeHealthCheckConfig;
  resetPolicy?: RuntimeResetPolicyConfig;
};

export type RuntimeHealthState = "READY" | "NOT_READY" | "UNKNOWN";

export type RuntimeHealthResult = {
  checked: boolean;
  state: RuntimeHealthState;
  command?: string;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  rawOutput: string;
  error?: string;
};

type CommandResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

const COMMON_NOT_READY_PATTERNS = [
  "Daemon not running",
  "Daemon running: no",
  "No daemon.json found",
  "Is the daemon running",
  "CDP connected:  no",
  "CDP connected: no",
  "Chrome not connected",
  "CDP WebSocket closed",
  "CDP WebSocket closed unexpectedly",
  "Daemon HTTP 503",
  "ECONNREFUSED",
];

export async function runBeforeToolHook(
  pluginId: string,
  config: RuntimeHookConfig
): Promise<RuntimeHealthResult> {
  const hook = config.lifecycleHooks?.beforeTool;

  console.log(`[RuntimeHook][beforeTool] plugin=${pluginId}, enabled=${hook?.enabled ?? false}`);

  if (!hook?.enabled) {
    console.log(`[RuntimeHook][beforeTool] plugin=${pluginId}, hook disabled, skip`);
    return {
      checked: false,
      state: "READY",
      rawOutput: "",
    };
  }

  console.log(`[RuntimeHook][beforeTool] plugin=${pluginId}, start health check`);
  const health = await runRuntimeHealthCheck(config);
  console.log(`[RuntimeHook][beforeTool] plugin=${pluginId}, health state=${health.state}, checked=${health.checked}`);

  if (health.state === "READY") {
    console.log(`[RuntimeHook][beforeTool] plugin=${pluginId}, runtime is healthy`);
    return health;
  }

  console.warn(`[RuntimeHook][beforeTool] plugin=${pluginId}, runtime unhealthy, state=${health.state}`);
  console.log(`[RuntimeHook][beforeTool] plugin=${pluginId}, hook.mode=${hook.mode}, resetPolicy.enabled=${config.resetPolicy?.enabled ?? false}`);

  if (hook.mode === "resetOnUnhealthy") {
    if (config.resetPolicy?.enabled) {
      console.log(`[RuntimeHook][beforeTool] plugin=${pluginId}, WILL execute resetPolicy, steps=${config.resetPolicy.steps?.length ?? 0}`);
      await runRuntimeResetPolicy(pluginId, config);
      console.log(`[RuntimeHook][beforeTool] plugin=${pluginId}, resetPolicy execution completed`);
    } else {
      console.warn(`[RuntimeHook][beforeTool] plugin=${pluginId}, mode=resetOnUnhealthy BUT resetPolicy.enabled=false or not configured, SKIP reset`);
    }
  } else {
    console.log(`[RuntimeHook][beforeTool] plugin=${pluginId}, mode=${hook.mode}, skip reset (mode is not resetOnUnhealthy)`);
  }

  return health;
}

export async function runRuntimeHealthCheck(
  config: RuntimeHookConfig
): Promise<RuntimeHealthResult> {
  const healthCheck = config.healthCheck;

  console.log(`[RuntimeHook][healthCheck] enabled=${healthCheck?.enabled ?? false}`);

  if (!healthCheck?.enabled) {
    console.log(`[RuntimeHook][healthCheck] health check disabled, skip`);
    return {
      checked: false,
      state: "READY",
      rawOutput: "",
    };
  }

  const commandText = formatCommand(healthCheck.command, healthCheck.args ?? []);
  console.log(`[RuntimeHook][healthCheck] command="${commandText}", timeout=${healthCheck.timeoutMs ?? 10000}ms`);

  try {
    console.log(`[RuntimeHook][healthCheck] executing command...`);
    const result = await runCommand({
      command: healthCheck.command,
      args: healthCheck.args ?? [],
      env: healthCheck.env,
      timeoutMs: healthCheck.timeoutMs ?? 10000,
      ignoreError: true,
    });

    const rawOutput = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
    console.log(`[RuntimeHook][healthCheck] command completed, exitCode=${result.exitCode}`);
    console.log(`[RuntimeHook][healthCheck] stdout: ${result.stdout?.substring(0, 500) ?? "(empty)"}`);
    if (result.stderr) {
      console.log(`[RuntimeHook][healthCheck] stderr: ${result.stderr?.substring(0, 500) ?? "(empty)"}`);
    }

    const state = parseHealthState(rawOutput, healthCheck);
    console.log(`[RuntimeHook][healthCheck] parsed state=${state}`);

    if (healthCheck.readyPatterns?.length) {
      console.log(`[RuntimeHook][healthCheck] readyPatterns=${JSON.stringify(healthCheck.readyPatterns)}`);
    }
    if (healthCheck.notReadyPatterns?.length) {
      console.log(`[RuntimeHook][healthCheck] notReadyPatterns=${JSON.stringify(healthCheck.notReadyPatterns)}`);
    }

    return {
      checked: true,
      state,
      command: commandText,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      rawOutput,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[RuntimeHook][healthCheck] command failed: ${message}`);

    return {
      checked: true,
      state: "NOT_READY",
      command: commandText,
      rawOutput: message,
      error: message,
    };
  }
}

export async function runRuntimeResetPolicy(
  pluginId: string,
  config: RuntimeHookConfig
): Promise<void> {
  const resetPolicy = config.resetPolicy;

  console.log(`[RuntimeHook][resetPolicy] plugin=${pluginId}, enabled=${resetPolicy?.enabled ?? false}`);

  if (!resetPolicy?.enabled) {
    console.log(`[RuntimeHook][resetPolicy] plugin=${pluginId}, reset policy disabled, skip`);
    return;
  }

  const steps = resetPolicy.steps ?? [];
  console.log(`[RuntimeHook][resetPolicy] plugin=${pluginId}, totalSteps=${steps.length}`);

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepName = step.name ?? formatCommand(step.command, step.args ?? []);

    console.log(`[RuntimeHook][resetPolicy] plugin=${pluginId}, step[${i + 1}/${steps.length}] name="${stepName}"`);
    console.log(`[RuntimeHook][resetPolicy] plugin=${pluginId}, step[${i + 1}] command="${formatCommand(step.command, step.args ?? [])}"`);
    console.log(`[RuntimeHook][resetPolicy] plugin=${pluginId}, step[${i + 1}] timeout=${step.timeoutMs ?? 10000}ms, ignoreError=${step.ignoreError ?? false}`);

    try {
      console.log(`[RuntimeHook][resetPolicy] plugin=${pluginId}, step[${i + 1}] executing...`);

      await runCommand({
        command: step.command,
        args: step.args ?? [],
        env: step.env,
        timeoutMs: step.timeoutMs ?? 10000,
        ignoreError: step.ignoreError ?? false,
      });

      console.log(`[RuntimeHook][resetPolicy] plugin=${pluginId}, step[${i + 1}] completed successfully`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[RuntimeHook][resetPolicy] plugin=${pluginId}, step[${i + 1}] failed: ${errorMsg}`);

      if (step.ignoreError) {
        console.warn(`[RuntimeHook][resetPolicy] plugin=${pluginId}, step[${i + 1}] error ignored, continue`);
        continue;
      }

      console.error(`[RuntimeHook][resetPolicy] plugin=${pluginId}, step[${i + 1}] error not ignored, throwing`);
      throw error;
    }
  }

  console.log(`[RuntimeHook][resetPolicy] plugin=${pluginId}, all steps completed`);
}

export function isRecoverableRuntimeError(
  errorMessage: string,
  config: RuntimeHookConfig
): boolean {
  const text = errorMessage || "";
  const patterns = [
    ...COMMON_NOT_READY_PATTERNS,
    ...(config.healthCheck?.notReadyPatterns ?? []),
  ];

  console.log(`[RuntimeHook][isRecoverable] checking error: "${text.substring(0, 200)}"`);
  console.log(`[RuntimeHook][isRecoverable] total patterns: ${patterns.length}`);

  const matched = patterns.some((pattern) => {
    const isMatch = text.toLowerCase().includes(pattern.toLowerCase());
    if (isMatch) {
      console.log(`[RuntimeHook][isRecoverable] matched pattern: "${pattern}"`);
    }
    return isMatch;
  });

  console.log(`[RuntimeHook][isRecoverable] result: ${matched}`);
  return matched;
}

export function buildRuntimeHookErrorResult(
  pluginId: string,
  toolName: string,
  errorMessage: string
): ToolResult {
  return {
    success: false,
    error: {
      code: "MCP_RUNTIME_HOOK_ERROR",
      message: errorMessage,
      retryable: true,
      category: "runtime",
    },
    meta: {
      pluginId,
      toolName,
      runtimeHook: true,
    },
    operation: {
      type: "verify",
      target: toolName,
      targetKind: "external_resource",
    },
    verification: {
      required: true,
      status: "failed",
      method: "before_tool_runtime_hook",
      evidence: errorMessage,
    },
    outputRefs: [],
  };
}

function parseHealthState(
  rawOutput: string,
  healthCheck: RuntimeHealthCheckConfig
): RuntimeHealthState {
  const text = rawOutput || "";

  const readyPatterns = healthCheck.readyPatterns ?? [];
  const notReadyPatterns = [
    ...COMMON_NOT_READY_PATTERNS,
    ...(healthCheck.notReadyPatterns ?? []),
  ];

  const matchedNotReady = notReadyPatterns.some((pattern) =>
    text.toLowerCase().includes(pattern.toLowerCase())
  );

  if (matchedNotReady) {
    return "NOT_READY";
  }

  if (readyPatterns.length > 0) {
    const allReadyMatched = readyPatterns.every((pattern) =>
      text.toLowerCase().includes(pattern.toLowerCase())
    );

    return allReadyMatched ? "READY" : "NOT_READY";
  }

  return "UNKNOWN";
}

function runCommand(step: RuntimeCommandStep): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(step.command, step.args ?? [], {
      shell: process.platform === "win32",
      env: {
        ...process.env,
        ...(step.env ?? {}),
      },
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const timeoutMs = step.timeoutMs ?? 10000;

    const timer = setTimeout(() => {
      child.kill();

      const result: CommandResult = {
        exitCode: -1,
        stdout,
        stderr: `${stderr}\nCommand timeout after ${timeoutMs}ms`,
      };

      if (step.ignoreError) {
        resolve(result);
      } else {
        reject(new Error(result.stderr));
      }
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);

      if (step.ignoreError) {
        resolve({
          exitCode: -1,
          stdout,
          stderr: error.message,
        });
        return;
      }

      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);

      const result: CommandResult = {
        exitCode: code,
        stdout,
        stderr,
      };

      if (code !== 0 && !step.ignoreError) {
        reject(
          new Error(
            `Command failed: ${formatCommand(step.command, step.args ?? [])}\n${stdout}\n${stderr}`
          )
        );
        return;
      }

      resolve(result);
    });
  });
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].join(" ");
}
