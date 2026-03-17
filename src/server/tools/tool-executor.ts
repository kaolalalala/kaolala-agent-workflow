import { configService } from "@/server/config/config-service";
import { HttpToolAdapter } from "@/server/tools/adapters/http-tool-adapter";
import { LocalScriptToolAdapter } from "@/server/tools/adapters/local-script-adapter";
import { OpenClawToolAdapter } from "@/server/tools/adapters/openclaw-tool-adapter";
import type { ToolAdapterContext } from "@/server/tools/adapters/tool-adapter";
import type { ResolvedTool, ToolExecutionError, ToolExecutionResult } from "@/server/tools/contracts";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 0;
const DEFAULT_RETRY_BACKOFF_MS = 300;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeError(error: unknown, source: ResolvedTool["sourceType"] | "platform"): ToolExecutionError {
  const message = error instanceof Error ? error.message : "未知错误";
  return {
    code: "TOOL_EXECUTION_FAILED",
    message,
    retriable: !/missing|缺少|不存在|非法/i.test(message),
    source,
    details: error instanceof Error ? { name: error.name } : undefined,
  };
}

class ToolExecutor {
  private readonly localAdapter = new LocalScriptToolAdapter();
  private readonly httpAdapter = new HttpToolAdapter();
  private readonly openClawAdapter = new OpenClawToolAdapter();

  async execute(
    tool: ResolvedTool,
    input: Record<string, unknown>,
    context: ToolAdapterContext,
    overrides?: {
      timeoutMs?: number;
      maxRetries?: number;
    },
  ): Promise<ToolExecutionResult> {
    const timeoutMs = overrides?.timeoutMs ?? tool.policy.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxRetries = overrides?.maxRetries ?? tool.policy.maxRetries ?? DEFAULT_MAX_RETRIES;
    const backoffMs = tool.policy.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS;

    const authResult = this.resolveAuth(tool);
    if (!authResult.ok) {
      return {
        ok: false,
        durationMs: 0,
        error: authResult.error,
      };
    }

    const start = Date.now();
    let attempt = 0;
    let lastError: ToolExecutionError | undefined;

    while (attempt <= maxRetries) {
      try {
        const adapter = this.resolveAdapter(tool.sourceType);
        const output = await adapter.invoke({
          tool,
          input,
          timeoutMs,
          context,
          apiKey: authResult.apiKey,
        });
        return {
          ok: true,
          data: output.data,
          meta: {
            ...output.meta,
            attempt,
          },
          durationMs: Date.now() - start,
        };
      } catch (error) {
        lastError = normalizeError(error, tool.sourceType);
        if (attempt >= maxRetries || !lastError.retriable) {
          break;
        }
        await sleep(backoffMs);
      }
      attempt += 1;
    }

    return {
      ok: false,
      durationMs: Date.now() - start,
      error: lastError ?? normalizeError("工具执行失败", tool.sourceType),
    };
  }

  private resolveAdapter(sourceType: ResolvedTool["sourceType"]) {
    if (sourceType === "local_script") {
      return this.localAdapter;
    }
    if (sourceType === "http_api") {
      return this.httpAdapter;
    }
    if (sourceType === "openclaw") {
      return this.openClawAdapter;
    }
    throw new Error(`不支持的工具来源: ${sourceType}`);
  }

  private resolveAuth(tool: ResolvedTool): { ok: true; apiKey?: string } | { ok: false; error: ToolExecutionError } {
    const auth = tool.authRequirements;
    if (!auth.required || auth.type === "none") {
      return { ok: true };
    }

    if (auth.type !== "credential_ref" && auth.type !== "api_key") {
      return { ok: true };
    }

    const credentialId = String(tool.effectiveConfig.credentialId ?? "");
    if (!credentialId) {
      return {
        ok: false,
        error: {
          code: "TOOL_AUTH_MISSING",
          message: "工具缺少 credentialId",
          retriable: false,
          source: "platform",
        },
      };
    }

    const apiKey = configService.resolveCredentialApiKey(credentialId);
    if (!apiKey) {
      return {
        ok: false,
        error: {
          code: "TOOL_AUTH_INVALID",
          message: "工具凭证不存在或不可用",
          retriable: false,
          source: "platform",
        },
      };
    }

    return { ok: true, apiKey };
  }
}

export const toolExecutor = new ToolExecutor();
