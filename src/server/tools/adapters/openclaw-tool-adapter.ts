import { HttpToolAdapter } from "@/server/tools/adapters/http-tool-adapter";
import type { ToolAdapter, ToolAdapterInput, ToolAdapterOutput } from "@/server/tools/adapters/tool-adapter";

export class OpenClawToolAdapter implements ToolAdapter {
  private readonly httpAdapter = new HttpToolAdapter();

  async invoke(input: ToolAdapterInput): Promise<ToolAdapterOutput> {
    const endpoint = String(input.tool.effectiveConfig.endpoint ?? "");
    if (!endpoint) {
      throw new Error("openclaw 工具缺少 endpoint 配置");
    }

    const nextInput: ToolAdapterInput = {
      ...input,
      tool: {
        ...input.tool,
        sourceType: "http_api",
        effectiveConfig: {
          ...input.tool.effectiveConfig,
          url: endpoint,
          method: input.tool.effectiveConfig.method ?? "POST",
        },
      },
    };

    return this.httpAdapter.invoke(nextInput);
  }
}
