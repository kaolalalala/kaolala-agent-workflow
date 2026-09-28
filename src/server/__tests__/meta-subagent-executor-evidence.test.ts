import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import * as llmHelper from "@/server/meta-agent/llm-helper";
import { getSubagentById } from "@/server/meta-agent/todo-driven/subagent-registry";
import { runSubagentTodo } from "@/server/meta-agent/todo-driven/subagent-executor";
import type { DelegationBrief } from "@/server/meta-agent/todo-driven/types";

const createdDirs: string[] = [];
const createdRunOutputs: string[] = [];

function makeTempDir(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

function trackRunOutput(runId: string) {
  const dir = resolve(process.cwd(), ".output", "v0_2", runId);
  createdRunOutputs.push(dir);
  return dir;
}

function writeJson(filePath: string, payload: Record<string, unknown>) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeText(filePath: string, content: string) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf8");
}

function createDeliveryOutputs(root: string, deliveredCount: number) {
  const deliveryDir = join(root, "delivery_retry", "attempt_2");
  const manifestPath = join(deliveryDir, "final_delivery_manifest.json");
  const reportPath = join(deliveryDir, "final_delivery_report.md");
  writeJson(manifestPath, {
    ok: true,
    deliveredCount,
    requiredCount: deliveredCount,
    missingFileCount: 0,
    manifestPath,
    reportPath,
    papers: Array.from({ length: deliveredCount }, (_, index) => ({
      title: `Paper ${index + 1}`,
      filePath: `D:\\papers\\paper_${index + 1}.pdf`,
    })),
  });
  writeText(reportPath, `delivered=${deliveredCount}\n`);
  return { manifestPath, reportPath };
}

function createMergeOutputs(root: string, mergedCount: number) {
  const mergeDir = join(root, "merge_retry", "attempt_1");
  const manifestPath = join(mergeDir, "merged_paper_manifest.json");
  const reportPath = join(mergeDir, "merged_paper_manifest.md");
  writeJson(manifestPath, {
    ok: true,
    mergedCount,
    requiredCount: mergedCount,
    missingCount: 0,
    manifestPath,
    reportPath,
    papers: Array.from({ length: mergedCount }, (_, index) => ({
      title: `Merged Paper ${index + 1}`,
      filePath: `D:\\papers\\merged_${index + 1}.pdf`,
    })),
  });
  writeText(reportPath, `merged=${mergedCount}\n`);
  return { manifestPath, reportPath };
}

function buildDeliveryBrief(runId: string): DelegationBrief {
  return {
    run_id: runId,
    todo_id: "todo_deliver",
    goal: "Deliver the final paper package with deterministic proof.",
    todo_title: "Deliver final downloaded paper package",
    todo_description: "Produce the final delivery manifest and report for the merged paper bundle.",
    acceptance_criteria: [
      "Final output contains 10 downloaded papers",
      "Evidence includes final_delivery_manifest.json",
    ],
    input_refs: [],
    artifact_summaries: [],
    constraints: [],
    expected_output_schema: "strict json",
    resource_center: {
      skills: [
        {
          id: "asset_skill_paper_delivery_package",
          name: "Paper Delivery Package Skill",
          runtime_profile_id: "paper_delivery_pipeline",
        },
      ],
    },
    workspace_file_ids: [],
    resolved_tools: [
      {
        toolId: "skill:paper_delivery_package_skill",
        name: "Paper Delivery Package Skill",
        description: "Create the final delivery manifest and report.",
        inputSchema: { type: "object" },
      },
    ],
    recovery_context: {
      retry_count: 1,
      reroute_count: 0,
      last_missing_criteria: [],
      guidance_notes: [],
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  while (createdRunOutputs.length > 0) {
    const dir = createdRunOutputs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("subagent executor evidence synthesis", () => {
  it("prefers delivery evidence over merge evidence when recovering from a tool-loop error", async () => {
    const agent = getSubagentById("writer_agent");
    if (!agent) {
      throw new Error("writer_agent missing");
    }

    const tempRoot = makeTempDir("meta-subagent-recovery-");
    const mergeOutputs = createMergeOutputs(tempRoot, 10);
    const deliveryOutputs = createDeliveryOutputs(tempRoot, 10);
    const runId = "run_subagent_recovery_evidence_test";
    trackRunOutput(runId);

    vi.spyOn(llmHelper, "callLLMWithTools").mockRejectedValue(
      new llmHelper.LLMToolLoopError("tool loop ended without final json", {
        latest_text: "partial tool transcript",
        usage: {
          prompt_tokens: 20,
          completion_tokens: 10,
          total_tokens: 30,
          source: "estimated",
        },
        tool_calls_made: [
          {
            tool_name: "skill:paper_manifest_merge_skill",
            arguments: {},
            result: {
              ok: true,
              mergedCount: 10,
              missingCount: 0,
              manifestPath: mergeOutputs.manifestPath,
              reportPath: mergeOutputs.reportPath,
            },
          },
          {
            tool_name: "skill:paper_delivery_package_skill",
            arguments: {},
            result: {
              ok: true,
              deliveredCount: 10,
              missingFileCount: 0,
              manifestPath: deliveryOutputs.manifestPath,
              reportPath: deliveryOutputs.reportPath,
            },
          },
        ],
      }),
    );

    const result = await runSubagentTodo(agent, buildDeliveryBrief(runId));
    const canonicalManifestPath = resolve(
      process.cwd(),
      ".output",
      "v0_2",
      runId,
      "todo_deliver",
      "final_delivery",
      "final_delivery_manifest.json",
    );

    expect(result.status).toBe("success");
    expect(result.summary).toContain("delivered 10");
    expect(result.criteria_evidence).toContain("deliveredCount=10");
    expect(result.criteria_evidence).toContain(`finalDeliveryManifestPath=${canonicalManifestPath}`);
    expect(result.artifacts.some((artifact) => artifact.path === canonicalManifestPath)).toBe(true);
    expect(existsSync(canonicalManifestPath)).toBe(true);
  });

  it("auto-injects structured delivery evidence even when the model omits criteria_evidence", async () => {
    const agent = getSubagentById("writer_agent");
    if (!agent) {
      throw new Error("writer_agent missing");
    }

    const tempRoot = makeTempDir("meta-subagent-normal-");
    const deliveryOutputs = createDeliveryOutputs(tempRoot, 10);
    const runId = "run_subagent_normal_evidence_test";
    trackRunOutput(runId);

    vi.spyOn(llmHelper, "callLLMWithTools").mockResolvedValue({
      content: JSON.stringify({
        summary: "delivery completed",
        artifacts: [
          {
            path: deliveryOutputs.manifestPath,
            type: "manifest",
            summary: "nested retry delivery manifest",
          },
          {
            path: deliveryOutputs.reportPath,
            type: "report",
            summary: "nested retry delivery report",
          },
        ],
        open_questions: [],
        completion_notes: [],
        criteria_evidence: [],
      }),
      usage: {
        prompt_tokens: 12,
        completion_tokens: 9,
        total_tokens: 21,
        source: "estimated",
      },
      tool_calls_made: [
        {
          tool_name: "skill:paper_delivery_package_skill",
          arguments: {},
          result: {
            ok: true,
            deliveredCount: 10,
            missingFileCount: 0,
            manifestPath: deliveryOutputs.manifestPath,
            reportPath: deliveryOutputs.reportPath,
          },
        },
      ],
    });

    const result = await runSubagentTodo(agent, buildDeliveryBrief(runId));
    const canonicalManifestPath = resolve(
      process.cwd(),
      ".output",
      "v0_2",
      runId,
      "todo_deliver",
      "final_delivery",
      "final_delivery_manifest.json",
    );

    expect(result.status).toBe("success");
    expect(result.criteria_evidence).toContain("deliveredCount=10");
    expect(result.criteria_evidence).toContain(`finalDeliveryManifestPath=${canonicalManifestPath}`);
    expect(result.artifacts.some((artifact) => artifact.path === canonicalManifestPath)).toBe(true);
  });
});
