import { exec as execCallback } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";

import { workspaceService } from "@/server/workspace/workspace-service";
import { environmentService } from "@/server/environment/environment-service";
import { outputManager } from "@/server/runtime/output-manager";

const execAsync = promisify(execCallback);

/** Maximum execution time: 120 seconds */
const MAX_EXECUTION_TIME_MS = 120_000;

/** Maximum output capture: 512KB */
const MAX_OUTPUT_BUFFER = 512 * 1024;

/** Allowed command prefixes (whitelist) */
const ALLOWED_COMMANDS = ["python", "python3", "node", "bash", "sh", "deno", "bun"];

/** Dangerous patterns to block */
const DANGEROUS_PATTERNS = [
  /\bsudo\b/i,
  /\brm\s+-rf\b/i,
  /\brm\s+-r\b/i,
  /\bdocker\b/i,
  /\bssh\b/i,
  /\bkill\b/i,
  /\bkillall\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bmkfs\b/i,
  /\bdd\b.*\bif=/i,
  /\bcurl\b.*\|\s*\bsh\b/i,
  /\bwget\b.*\|\s*\bsh\b/i,
];

/** Shell injection characters */
const SHELL_INJECTION_PATTERN = /[`]|\$\(|;\s*\S|\|\||&&|\|\s*\S/;

export interface DevAgentExecutionInput {
  workspaceId: string;
  entryFile: string;
  runCommand: string;
  resolvedInput: string;
  env?: Record<string, string>;
  environmentId?: string;
  /** Override CWD for local project mode (uses this path instead of workspace storage) */
  cwdOverride?: string;
  /** Template parameters for Script Node — interpolated into runCommand as {key} placeholders */
  templateParams?: Record<string, string>;
  outputDirOverride?: string;
}

export interface DevAgentExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  outputFiles: string[];
  success: boolean;
}

function validateCommand(command: string): void {
  const trimmed = command.trim();

  // Check whitelist
  const firstWord = trimmed.split(/\s+/)[0].toLowerCase();
  if (!ALLOWED_COMMANDS.includes(firstWord)) {
    throw new Error(
      `命令 "${firstWord}" 不在白名单中。允许的命令: ${ALLOWED_COMMANDS.join(", ")}`,
    );
  }

  // Check for dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      throw new Error(`命令包含不允许的危险操作: ${trimmed}`);
    }
  }

  // Check for shell injection
  if (SHELL_INJECTION_PATTERN.test(trimmed)) {
    throw new Error("命令包含不允许的 shell 注入字符");
  }
}

function collectOutputFiles(wsRoot: string): string[] {
  const outputDir = join(wsRoot, "output");
  if (!existsSync(outputDir) || !statSync(outputDir).isDirectory()) {
    return [];
  }
  const results: string[] = [];
  const entries = readdirSync(outputDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      results.push(`output/${entry.name}`);
    }
  }
  return results;
}

/**
 * Resolve the actual command to execute.
 * If an environmentId is provided, replace the python/python3 prefix
 * with the full path to the environment's python executable.
 */
function resolveCommand(runCommand: string, environmentId?: string): string {
  if (!environmentId) return runCommand;

  const env = environmentService.findById(environmentId);
  if (!env) {
    throw new Error(`执行环境 ${environmentId} 未找到，请刷新环境列表`);
  }
  if (!env.isAvailable) {
    throw new Error(`执行环境 ${env.name} 不可用`);
  }

  // Replace the python/python3 command prefix with the full path
  const trimmed = runCommand.trim();
  const pythonPrefixPattern = /^(python3?)\b/i;
  if (pythonPrefixPattern.test(trimmed)) {
    return trimmed.replace(pythonPrefixPattern, `"${env.pythonPath}"`);
  }

  // If the command doesn't start with python, return as-is
  return runCommand;
}

/**
 * Interpolate {key} placeholders in a command template with values.
 * E.g. "python -m cli {stage} --input {input}" with {stage: "s1", input: "a.txt"}
 *   => "python -m cli s1 --input a.txt"
 */
function interpolateCommand(template: string, params?: Record<string, string>): string {
  if (!params || Object.keys(params).length === 0) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return key in params ? params[key] : match;
  });
}

export async function executeDevAgent(input: DevAgentExecutionInput): Promise<DevAgentExecutionResult> {
  const {
    workspaceId,
    entryFile,
    runCommand: rawRunCommand,
    resolvedInput,
    env,
    environmentId,
    cwdOverride,
    templateParams,
    outputDirOverride,
  } = input;

  // Interpolate template parameters into the command
  const runCommand = interpolateCommand(rawRunCommand, templateParams);

  // 1. Determine working directory
  let wsRoot: string;
  if (cwdOverride) {
    wsRoot = resolve(cwdOverride);
    if (!existsSync(wsRoot)) {
      throw new Error(`本地项目目录不存在: ${cwdOverride}`);
    }
  } else {
    wsRoot = workspaceService.getWorkspaceAbsolutePath(workspaceId);
    workspaceService.ensureWorkspace(workspaceId);
  }

  // 2. Validate entry file exists (skip for local project if no entryFile)
  if (entryFile) {
    const entryPath = resolve(wsRoot, entryFile);
    if (!entryPath.startsWith(wsRoot)) {
      throw new Error("入口文件路径超出工作目录");
    }
    if (!existsSync(entryPath)) {
      throw new Error(`入口文件不存在: ${entryFile}`);
    }
  }

  // 3. Validate command (validate against original command for whitelist)
  validateCommand(runCommand);

  // 4. Resolve command with environment path if needed
  const actualCommand = resolveCommand(runCommand, environmentId);

  // 5. Execute
  const startTime = Date.now();
  let stdout = "";
  let stderr = "";
  let exitCode = 0;

  try {
    const result = await execAsync(actualCommand, {
      cwd: wsRoot,
      timeout: MAX_EXECUTION_TIME_MS,
      maxBuffer: MAX_OUTPUT_BUFFER,
      env: {
        ...process.env,
        // Pass resolved input as env var for script consumption
        AGENT_INPUT: resolvedInput,
        WORKSPACE_DIR: wsRoot,
        INPUTS_DIR: join(wsRoot, "inputs"),
        AGENT_OUTPUT_DIR: outputDirOverride
          ? resolve(outputDirOverride)
          : outputManager.getRunNodeOutputDir(workspaceId || "workspace", "adhoc"),
        // Ensure PYTHONPATH includes project root so local modules resolve
        PYTHONPATH: [wsRoot, process.env.PYTHONPATH].filter(Boolean).join(process.platform === "win32" ? ";" : ":"),
        ...env,
      },
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error: unknown) {
    const execError = error as { code?: number; killed?: boolean; stdout?: string; stderr?: string; signal?: string };
    stdout = execError.stdout ?? "";
    stderr = execError.stderr ?? "";

    if (execError.killed || execError.signal === "SIGTERM") {
      exitCode = 124; // Timeout convention
      stderr += `\n[超时] 执行时间超过 ${MAX_EXECUTION_TIME_MS / 1000} 秒限制`;
    } else {
      exitCode = typeof execError.code === "number" ? execError.code : 1;
    }
  }

  const durationMs = Date.now() - startTime;

  // 5. Collect output files
  const outputFiles = outputManager.collectOutputFiles(
    outputDirOverride ? resolve(outputDirOverride) : undefined,
    join(wsRoot, "output"),
  );

  return {
    exitCode,
    stdout: stdout.slice(0, MAX_OUTPUT_BUFFER),
    stderr: stderr.slice(0, MAX_OUTPUT_BUFFER),
    durationMs,
    outputFiles,
    success: exitCode === 0,
  };
}
