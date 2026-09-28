import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  addArtifact,
  addTodo,
  createRunState,
} from "@/server/meta-agent/supervisor-runtime-state";
import { buildDelegationBrief } from "@/server/meta-agent/todo-driven/delegation-brief-builder";
import { buildTodoExecutionContext } from "@/server/meta-agent/todo-driven/execution-context-builder";
import { getSubagentById } from "@/server/meta-agent/todo-driven/subagent-registry";

const createdDirs: string[] = [];

function makeTempDir(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

function createPaperSet(root: string, startIndex: number, count: number) {
  const pdfDir = join(root, "pdfs");
  mkdirSync(pdfDir, { recursive: true });
  return Array.from({ length: count }, (_, offset) => {
    const index = startIndex + offset;
    const arxivId = `2401.${String(index).padStart(4, "0")}`;
    const filePath = join(pdfDir, `paper_${index}.pdf`);
    writeFileSync(filePath, `pdf:${index}\n`, "utf8");
    return {
      title: `Agent RL Paper ${index}`,
      arxivId,
      absUrl: `https://arxiv.org/abs/${arxivId}`,
      pdfUrl: `https://arxiv.org/pdf/${arxivId}.pdf`,
      filePath,
    };
  });
}

function writeManifest(filePath: string, query: string, papers: Array<Record<string, unknown>>) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify({ query, papers }, null, 2)}\n`, "utf8");
}

function runSkill(
  scriptRelativePath: string,
  input: Record<string, unknown>,
  outputDir: string,
) {
  const scriptPath = resolve(process.cwd(), scriptRelativePath);
  const raw = execFileSync(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      AGENT_INPUT: JSON.stringify(input),
      AGENT_OUTPUT_DIR: outputDir,
    },
  });
  return JSON.parse(raw) as Record<string, unknown>;
}

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("merge to delivery regression", () => {
  it("keeps the latest merged manifest discoverable for delivery after merge retries", () => {
    const root = makeTempDir("meta-merge-delivery-");
    const manifestsDir = join(root, "manifests");
    const mergeOutputDir = join(root, "merge-output");
    const deliveryOutputDir = join(root, "delivery-output");
    mkdirSync(manifestsDir, { recursive: true });
    mkdirSync(mergeOutputDir, { recursive: true });
    mkdirSync(deliveryOutputDir, { recursive: true });

    const manifestA = join(manifestsDir, "batch_a.json");
    const manifestB = join(manifestsDir, "batch_b.json");
    writeManifest(manifestA, "agent rl batch a", createPaperSet(root, 1, 5));
    writeManifest(manifestB, "agent rl batch b", createPaperSet(root, 6, 5));

    const firstMerge = runSkill(
      "scripts/skills/paper-manifest-merge-skill.mjs",
      {
        manifestPaths: [manifestA],
        requiredCount: 5,
        outputLabel: "merged",
      },
      mergeOutputDir,
    );
    const secondMerge = runSkill(
      "scripts/skills/paper-manifest-merge-skill.mjs",
      {
        manifestPaths: [manifestA, manifestB],
        requiredCount: 10,
        outputLabel: "retry_1",
      },
      mergeOutputDir,
    );

    const canonicalManifestPath = String(secondMerge.manifestPath);
    const latestMergedPayload = JSON.parse(readFileSync(canonicalManifestPath, "utf8")) as Record<string, unknown>;
    expect(latestMergedPayload.mergedCount).toBe(10);

    const state = createRunState("Merge and deliver agent RL papers.");
    addTodo(state, {
      id: "todo_collect_1",
      title: "Collect batch 1",
      description: "Collected the first five papers.",
      status: "done",
      priority: "high",
      assignee: "collector_agent",
      capability_type: "collection",
      depends_on: [],
      acceptance_criteria: ["batch_1_done"],
      input_refs: [],
    });
    addTodo(state, {
      id: "todo_collect_2",
      title: "Collect batch 2",
      description: "Collected the second five papers.",
      status: "done",
      priority: "high",
      assignee: "collector_agent",
      capability_type: "collection",
      depends_on: [],
      acceptance_criteria: ["batch_2_done"],
      input_refs: [],
    });
    addTodo(state, {
      id: "todo_merge",
      title: "Merge manifests",
      description: "Merge both collection manifests into one canonical bundle.",
      status: "done",
      priority: "high",
      assignee: "merge_agent",
      capability_type: "merge",
      depends_on: ["todo_collect_1", "todo_collect_2"],
      acceptance_criteria: ["merged_manifest_ready"],
      input_refs: [],
    });
    const deliveryTodo = addTodo(state, {
      id: "todo_deliver",
      title: "Deliver final paper package",
      description: "Use the merged manifest to produce the final delivery package.",
      status: "ready",
      priority: "high",
      assignee: "writer_agent",
      capability_type: "writing",
      depends_on: ["todo_merge"],
      acceptance_criteria: [
        "final_delivery_manifest_present",
        "final_delivery_contains_all_10_papers",
      ],
      input_refs: [],
    });

    addArtifact(state, {
      path: String(firstMerge.labeledManifestPath),
      type: "manifest",
      producer: "merge_agent",
      related_todo: "todo_merge",
      summary: "merge retry 0 stale labeled manifest with 5 papers",
    });
    addArtifact(state, {
      path: String(firstMerge.manifestPath),
      type: "manifest",
      producer: "merge_agent",
      related_todo: "todo_merge",
      summary: "merge retry 0 canonical path before retry",
    });
    addArtifact(state, {
      path: String(secondMerge.labeledManifestPath),
      type: "manifest",
      producer: "merge_agent",
      related_todo: "todo_merge",
      summary: "merge retry 1 labeled manifest with all 10 papers",
    });
    addArtifact(state, {
      path: canonicalManifestPath,
      type: "manifest",
      producer: "merge_agent",
      related_todo: "todo_merge",
      summary: "merge retry 1 canonical manifest with all 10 papers",
    });

    const agent = getSubagentById("writer_agent");
    if (!agent) {
      throw new Error("writer_agent missing");
    }

    const brief = buildDelegationBrief(state, deliveryTodo, agent);
    const context = buildTodoExecutionContext(state, deliveryTodo);
    const briefPaths = brief.artifact_summaries.map((artifact) => artifact.path);
    const contextPaths = context.input_artifacts.map((artifact) => artifact.path);

    expect(briefPaths).toContain(canonicalManifestPath);
    expect(briefPaths).toContain(String(secondMerge.labeledManifestPath));
    expect(briefPaths).not.toContain(String(firstMerge.labeledManifestPath));
    expect(contextPaths).toContain(canonicalManifestPath);
    expect(contextPaths).toContain(String(secondMerge.labeledManifestPath));
    expect(contextPaths).not.toContain(String(firstMerge.labeledManifestPath));

    const deliveryResult = runSkill(
      "scripts/skills/paper-delivery-package-skill.mjs",
      {
        manifestPath: canonicalManifestPath,
        requiredCount: 10,
        outputLabel: "delivery_retry",
      },
      deliveryOutputDir,
    );

    expect(deliveryResult.deliveredCount).toBe(10);
    expect(deliveryResult.missingFileCount).toBe(0);
    expect(String(deliveryResult.sourceManifestPath)).toBe(canonicalManifestPath);
  });

  it("infers requiredCount from the manifest size when verify and delivery skills are called without it", () => {
    const root = makeTempDir("meta-verify-delivery-default-count-");
    const manifestsDir = join(root, "manifests");
    const verifyOutputDir = join(root, "verify-output");
    const deliveryOutputDir = join(root, "delivery-output");
    mkdirSync(manifestsDir, { recursive: true });
    mkdirSync(verifyOutputDir, { recursive: true });
    mkdirSync(deliveryOutputDir, { recursive: true });

    const mergedManifestPath = join(manifestsDir, "merged_paper_manifest.json");
    writeManifest(mergedManifestPath, "agent rl merged", createPaperSet(root, 1, 10));

    const verifyResult = runSkill(
      "scripts/skills/paper-integrity-verify-skill.mjs",
      {
        manifestPath: mergedManifestPath,
      },
      verifyOutputDir,
    );
    const deliveryResult = runSkill(
      "scripts/skills/paper-delivery-package-skill.mjs",
      {
        manifestPath: mergedManifestPath,
      },
      deliveryOutputDir,
    );

    expect(verifyResult.requiredCount).toBe(10);
    expect(verifyResult.checkedCount).toBe(10);
    expect(verifyResult.allPassed).toBe(true);

    expect(deliveryResult.requiredCount).toBe(10);
    expect(deliveryResult.deliveredCount).toBe(10);
    expect(deliveryResult.missingFileCount).toBe(0);
  });
});
