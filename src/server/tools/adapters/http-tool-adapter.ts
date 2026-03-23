import type { ToolAdapter, ToolAdapterInput, ToolAdapterOutput } from "@/server/tools/adapters/tool-adapter";

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function toHeaders(value: unknown) {
  const input = asRecord(value);
  const headers = new Headers();
  for (const [key, raw] of Object.entries(input)) {
    if (typeof raw === "string") {
      headers.set(key, raw);
    }
  }
  return headers;
}

export class HttpToolAdapter implements ToolAdapter {
  async invoke(input: ToolAdapterInput): Promise<ToolAdapterOutput> {
    const config = asRecord(input.tool.effectiveConfig);
    const url = String(config.url ?? "");
    if (!url) {
      throw new Error("http_api 工具缺少 url 配置");
    }
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        throw new Error(`http_api 工具 url 协议不支持: ${parsedUrl.protocol}，仅允许 http/https`);
      }
    } catch (error) {
      if (error instanceof TypeError) {
        throw new Error(`http_api 工具 url 格式无效: ${url}`);
      }
      throw error;
    }

    const method = String(config.method ?? "POST").toUpperCase();
    const headers = toHeaders(config.headers);
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (input.apiKey && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${input.apiKey}`);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs);

    try {
      const requestUrl = method === "GET" ? this.toUrlWithQuery(url, input.input) : url;
      const response = await fetch(requestUrl, {
        method,
        headers,
        signal: controller.signal,
        body:
          method === "GET"
            ? undefined
            : JSON.stringify({
                input: input.input,
                context: input.context,
                toolId: input.tool.toolId,
              }),
      });

      const text = await response.text();
      const body = this.parseBody(text);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
      }

      return {
        data: typeof body === "string" ? { text: body } : asRecord(body),
        meta: {
          status: response.status,
        },
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private parseBody(text: string) {
    if (!text.trim()) {
      return {};
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  private toUrlWithQuery(url: string, input: Record<string, unknown>) {
    const target = new URL(url);
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined || value === null) {
        continue;
      }
      target.searchParams.set(key, String(value));
    }
    return target.toString();
  }
}
