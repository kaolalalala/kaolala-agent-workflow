import { NextResponse } from "next/server";
import JSZip from "jszip";
import YAML from "yaml";

import { runService } from "@/server/api/run-service";

type ImportFormat = "json" | "yaml" | "zip";

function parseManifest(format: ImportFormat, content: string) {
  if (format === "json") {
    return JSON.parse(content) as Record<string, unknown>;
  }
  if (format === "yaml") {
    return YAML.parse(content) as Record<string, unknown>;
  }
  throw new Error("unsupported manifest format");
}

async function extractManifestFromZip(base64: string) {
  const buffer = Buffer.from(base64, "base64");
  const zip = await JSZip.loadAsync(buffer);
  const candidates = Object.keys(zip.files).filter((name) => {
    const lower = name.toLowerCase();
    return lower.endsWith("tool.json") || lower.endsWith("tool.yaml") || lower.endsWith("tool.yml");
  });

  if (candidates.length === 0) {
    throw new Error("zip package must include tool.json or tool.yaml");
  }

  candidates.sort((a, b) => a.length - b.length);
  const manifestPath = candidates[0];
  const file = zip.file(manifestPath);
  if (!file) {
    throw new Error("unable to open manifest in zip");
  }

  const text = await file.async("string");
  if (manifestPath.toLowerCase().endsWith(".json")) {
    return JSON.parse(text) as Record<string, unknown>;
  }
  return YAML.parse(text) as Record<string, unknown>;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      format?: ImportFormat;
      content?: string;
      sourceName?: string;
    };

    if (!body.format || !body.content) {
      return NextResponse.json({ error: "format and content are required" }, { status: 400 });
    }

    const format = body.format;
    if (format !== "json" && format !== "yaml" && format !== "zip") {
      return NextResponse.json({ error: "unsupported package format" }, { status: 400 });
    }

    const manifest =
      format === "zip"
        ? await extractManifestFromZip(body.content)
        : parseManifest(format, body.content);

    const result = runService.importToolPackage({
      packageName: typeof manifest.packageName === "string" ? manifest.packageName : body.sourceName ?? "tool-package",
      version: typeof manifest.version === "string" ? manifest.version : "1.0.0",
      tools: Array.isArray(manifest.tools)
        ? (manifest.tools as Array<Record<string, unknown>>).map((item) => ({
            toolId: typeof item.toolId === "string" ? item.toolId : undefined,
            name: typeof item.name === "string" ? item.name : "",
            description: typeof item.description === "string" ? item.description : undefined,
            category: item.category as
              | "search"
              | "retrieval"
              | "automation"
              | "analysis"
              | "integration"
              | "custom"
              | undefined,
            sourceType: item.sourceType as "local_script" | "http_api" | "openclaw" | undefined,
            sourceConfig: (item.sourceConfig as Record<string, unknown> | undefined) ?? {},
            inputSchema: (item.inputSchema as Record<string, unknown> | undefined) ?? {},
            outputSchema: (item.outputSchema as Record<string, unknown> | undefined) ?? {},
            authRequirements: (item.authRequirements as Record<string, unknown> | undefined) as
              | {
                  type?: "none" | "credential_ref" | "api_key" | "oauth2" | "custom";
                  required?: boolean;
                  fields?: string[];
                  description?: string;
                }
              | undefined,
            policy: (item.policy as Record<string, unknown> | undefined) as
              | {
                  timeoutMs?: number;
                  maxRetries?: number;
                  retryBackoffMs?: number;
                }
              | undefined,
            enabled: typeof item.enabled === "boolean" ? item.enabled : undefined,
          }))
        : [],
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to import tool package";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
