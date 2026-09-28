import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const createdDirs: string[] = [];

function makeTempDir(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

function writeManifest(
  filePath: string,
  query: string,
  startIndex: number,
  count: number,
) {
  const papers = Array.from({ length: count }, (_, index) => ({
    title: `Paper ${startIndex + index}`,
    arxivId: `2401.${String(startIndex + index).padStart(4, "0")}`,
    absUrl: `https://arxiv.org/abs/2401.${String(startIndex + index).padStart(4, "0")}`,
    pdfUrl: `https://arxiv.org/pdf/2401.${String(startIndex + index).padStart(4, "0")}.pdf`,
    filePath: `D:\\papers\\paper_${startIndex + index}.pdf`,
  }));

  writeFileSync(filePath, `${JSON.stringify({ query, papers }, null, 2)}\n`, "utf8");
}

function readJson(filePath: string) {
  return JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
}

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("paper-manifest-merge-skill", () => {
  it("keeps the canonical merged manifest at the AGENT_OUTPUT_DIR root across labeled retries", () => {
    const root = makeTempDir("meta-merge-skill-");
    const manifestsDir = join(root, "manifests");
    const outputDir = join(root, "skill-output");
    mkdirSync(manifestsDir, { recursive: true });
    mkdirSync(outputDir, { recursive: true });

    const manifestA = join(manifestsDir, "batch_a.json");
    const manifestB = join(manifestsDir, "batch_b.json");
    writeManifest(manifestA, "agent rl batch a", 1, 5);
    writeManifest(manifestB, "agent rl batch b", 6, 5);

    const scriptPath = resolve(process.cwd(), "scripts/skills/paper-manifest-merge-skill.mjs");
    const runSkill = (input: Record<string, unknown>) =>
      JSON.parse(
        execFileSync(process.execPath, [scriptPath], {
          cwd: process.cwd(),
          encoding: "utf8",
          env: {
            ...process.env,
            AGENT_INPUT: JSON.stringify(input),
            AGENT_OUTPUT_DIR: outputDir,
          },
        }),
      ) as Record<string, unknown>;

    const first = runSkill({
      manifestPaths: [manifestA],
      requiredCount: 5,
      outputLabel: "merged",
    });
    const second = runSkill({
      manifestPaths: [manifestA, manifestB],
      requiredCount: 10,
      outputLabel: "retry_1",
    });

    const canonicalManifestPath = join(outputDir, "merged_paper_manifest.json");
    const labeledFirstManifestPath = join(outputDir, "merged", "merged_paper_manifest.json");
    const labeledSecondManifestPath = join(outputDir, "retry_1", "merged_paper_manifest.json");

    expect(first.manifestPath).toBe(canonicalManifestPath);
    expect(second.manifestPath).toBe(canonicalManifestPath);
    expect(first.labeledManifestPath).toBe(labeledFirstManifestPath);
    expect(second.labeledManifestPath).toBe(labeledSecondManifestPath);

    expect(existsSync(canonicalManifestPath)).toBe(true);
    expect(existsSync(labeledFirstManifestPath)).toBe(true);
    expect(existsSync(labeledSecondManifestPath)).toBe(true);

    expect(readJson(labeledFirstManifestPath).mergedCount).toBe(5);
    expect(readJson(labeledSecondManifestPath).mergedCount).toBe(10);
    expect(readJson(canonicalManifestPath).mergedCount).toBe(10);
  });
});
