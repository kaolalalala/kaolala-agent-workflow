import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";

import type { ToolAdapter, ToolAdapterInput, ToolAdapterOutput } from "@/server/tools/adapters/tool-adapter";

const execAsync = promisify(execCallback);

function parseStdout(stdout: string) {
  const text = stdout.trim();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { text };
  }
}

// 禁止包含 shell 注入关键字符：分号、管道、&&/||、反引号、$()
const SHELL_INJECTION_PATTERN = /[`]|\$\(|;\s*\S|\|\||&&|\|\s*\S/;

export class LocalScriptToolAdapter implements ToolAdapter {
  async invoke(input: ToolAdapterInput): Promise<ToolAdapterOutput> {
    const command = String(input.tool.effectiveConfig.command ?? "");
    if (!command.trim()) {
      throw new Error("local_script 工具缺少 command 配置");
    }
    if (SHELL_INJECTION_PATTERN.test(command)) {
      throw new Error("local_script 工具 command 包含不允许的 shell 注入字符");
    }

    const { stdout, stderr } = await execAsync(command, {
      timeout: input.timeoutMs,
      env: {
        ...process.env,
        TOOL_INPUT: JSON.stringify(input.input),
        TOOL_CONTEXT: JSON.stringify(input.context),
      },
      maxBuffer: 1024 * 1024,
    });

    return {
      data: parseStdout(stdout),
      meta: {
        stderr: stderr.trim() || undefined,
      },
    };
  }
}
