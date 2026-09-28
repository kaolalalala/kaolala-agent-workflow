import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const repoRoot = process.cwd();
const isTest = process.env.VITEST === "true" || process.env.NODE_ENV === "test";
const defaultDbFile = isTest
  ? `agent-workflow-test-${process.pid}-${process.env.VITEST_POOL_ID ?? "0"}.sqlite`
  : "agent-workflow.sqlite";
const dbPath = resolve(repoRoot, ".data", process.env.AGENT_WORKFLOW_DB_FILE || defaultDbFile);
const scriptsDir = resolve(repoRoot, "scripts", "skills");

const assets = [
  {
    scriptId: "asset_script_arxiv_paper_download_skill",
    scriptName: "arXiv 论文下载脚本",
    scriptDescription: "根据检索词与批次参数，从 arXiv 真实下载论文 PDF，并生成 manifest。",
    runCommand: "node arxiv-paper-download-skill.mjs",
    parameterSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string", description: "用于 arXiv 检索的主题词，建议用英文短语。" },
        startIndex: { type: "integer", minimum: 0, description: "批次起始偏移，从 0 开始。" },
        count: { type: "integer", minimum: 1, maximum: 20, description: "本批次需要下载的论文数量。" },
        outputLabel: { type: "string", description: "可选输出标签，用来区分不同批次或不同子任务。" },
      },
    },
    skillId: "asset_skill_arxiv_paper_download",
    skillName: "arXiv 论文下载",
    skillDescription: "当任务需要从 arXiv 搜索并下载论文、生成批次清单、返回本地 PDF 路径时使用此技能。",
    guideContent: `---
name: arxiv-论文下载
description: 当任务需要从 arXiv 搜索、分批下载论文 PDF、生成 manifest 并返回本地文件路径时使用此技能。
---

# arXiv 论文下载技能

## 技能用途

把“搜索主题论文并真实下载 PDF”这类动作交给绑定脚本执行。Meta-Agent 不需要自己手写下载逻辑，只需要在合适的时候调用此技能，并提供检索词和批次参数。

## 何时使用

- 当任务明确要求下载论文、保存 PDF、输出 manifest 或返回本地路径时使用。
- 当总任务需要多个子 Agent 并行下载时，让每个子 Agent 传入不同的 \`startIndex\` 与 \`count\`。
- 当任务只是做方向综述、主题分析、论文归纳，而不需要真实文件落盘时，不优先使用此技能。

## 输入参数

- \`query\`：必填。用于 arXiv 检索的主题词，建议使用英文短语。
- \`startIndex\`：可选。本批次从搜索结果中的第几篇开始下载。
- \`count\`：可选。本批次需要下载的论文数量。
- \`outputLabel\`：可选。输出目录标签，便于区分不同批次。

## 推荐做法

1. 先把用户目标转换成明确的英文检索词。
2. 如果要并行下载，先把总数拆成互不重叠的批次。
3. 每个批次单独调用一次本技能，保证 \`startIndex\` 不重叠。
4. 下载完成后，继续把各批次 manifest 交给“论文清单合并去重”技能做汇总。

## 输出重点

- \`manifestPath\`：当前批次的 JSON 清单路径。
- \`downloadedCount\`：本批次成功下载数量。
- \`papers\`：论文列表，含标题、arXiv ID、来源链接、本地 PDF 路径。
- \`failures\`：失败项列表，为空表示本批次无失败。
`,
    outputDescription: "返回批次 manifest 路径、下载成功数量、论文列表、本地 PDF 路径和失败信息。",
  },
  {
    scriptId: "asset_script_paper_manifest_merge_skill",
    scriptName: "论文清单合并去重脚本",
    scriptDescription: "读取多个论文 manifest，按 arXiv ID 去重，生成统一汇总清单与摘要。",
    runCommand: "node paper-manifest-merge-skill.mjs",
    parameterSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        manifestPaths: {
          type: "array",
          items: { type: "string" },
          description: "待合并的 manifest 路径列表。优先传入 manifest.json，也可传 manifest.md。",
        },
        requiredCount: { type: "integer", minimum: 1, description: "期望最终唯一论文数量（如不指定则使用所有已下载论文）。" },
        query: { type: "string", description: "可选检索词。若合并后数量不足，可用它指导继续补充下载。" },
        sourceDirs: {
          type: "array",
          items: { type: "string" },
          description: "可选目录列表。脚本会在目录中递归查找 manifest.json。",
        },
        outputLabel: { type: "string", description: "可选输出标签，用于区分本次合并结果目录。" },
      },
    },
    skillId: "asset_skill_paper_manifest_merge",
    skillName: "论文清单合并去重",
    skillDescription: "当任务需要把多个论文下载批次的 manifest 合并、按 arXiv ID 去重、生成最终交付清单时使用此技能。",
    guideContent: `---
name: 论文清单合并去重
description: 当任务需要汇总多个论文下载批次、按 arXiv ID 去重并输出最终清单时使用此技能。
---

# 论文清单合并去重技能

## 技能用途

把多个下载批次产出的 manifest 做统一合并与去重，生成一个机器可读的总清单和一个便于查看的 Markdown 摘要。

## 何时使用

- 当多个子 Agent 已经分别下载了论文，并各自生成 manifest。
- 当任务要求去重后汇总、给出统一清单时。
- 当你需要确认最终唯一论文数量是否满足目标要求时。

## 输入参数

- \`manifestPaths\`：优先使用。传入一个或多个批次 manifest 路径。
- \`sourceDirs\`：可选。如果只知道目录，也可以传目录，让脚本递归发现 manifest.json。
- \`requiredCount\`：可选。目标论文数量，由用户目标决定，不要硬编码固定数值。
- \`outputLabel\`：可选。用于区分本次合并结果目录。

## 推荐做法

1. 优先收集每个下载批次产出的 \`manifest.json\` 路径。
2. 把所有批次路径一起传给本技能。
3. 如果用户目标有明确数量，传入 \`requiredCount\`；否则省略，脚本会汇总全部已有论文。
4. 合并完成后，检查 \`mergedCount\` 和 \`missingCount\`。
5. 如果 \`missingCount > 0\`，优先继续调用”arXiv 论文下载”技能补齐缺口，再重新调用本技能，而不是伪造结果。

## 输出重点

- \`manifestPath\`：最终合并后的 JSON 清单路径。
- \`reportPath\`：最终合并后的 Markdown 摘要路径。
- \`mergedCount\`：去重后的唯一论文数量。
- \`duplicateCount\`：检测到的重复论文数量。
- \`missingCount\`：距离目标数量还差多少篇（目标未设定时为 0）。
- \`papers\`：最终交付论文列表，含标题、arXiv ID、来源链接、本地路径。
`,
    outputDescription: "返回合并后 JSON/Markdown 清单路径、唯一论文数量、重复数量、缺口提示和最终论文列表。",
  },
  {
    scriptId: "asset_script_paper_delivery_package_skill",
    scriptName: "论文交付打包脚本",
    scriptDescription: "读取最终论文 manifest，整理交付清单，并输出最终交付报告。",
    runCommand: "node paper-delivery-package-skill.mjs",
    parameterSchema: {
      type: "object",
      additionalProperties: false,
      required: ["manifestPath"],
      properties: {
        manifestPath: { type: "string", description: "合并后的论文 manifest.json 路径。" },
        requiredCount: { type: "integer", minimum: 1, description: "最终需要交付的论文数量（如不指定则使用 manifest 中全部论文）。" },
        outputLabel: { type: "string", description: "可选输出标签，用于区分本次交付目录。" },
      },
    },
    skillId: "asset_skill_paper_delivery_package",
    skillName: "论文交付打包",
    skillDescription: "当任务需要基于最终 manifest 生成交付清单、列出论文文件路径、输出最终交付报告时使用此技能。",
    guideContent: `---
name: 论文交付打包
description: 当任务需要把已经准备好的论文结果整理成最终交付包、交付清单和报告时使用此技能。
---

# 论文交付打包技能

## 技能用途

基于已经合并好的最终 manifest，生成最终交付 JSON 清单与 Markdown 报告，列出要交付的论文、来源链接和本地文件路径。

## 何时使用

- 当下载与合并已经完成，需要形成最终交付包时。
- 当任务要求“输出最终清单”“列出文件路径”“给出交付报告”时。
- 不要在下载阶段直接调用本技能，它依赖已经存在的合并结果。

## 输入参数

- \`manifestPath\`：必填。通常传入合并后的 \`merged_paper_manifest.json\`。
- \`requiredCount\`：可选。最终需要交付的论文数量。
- \`outputLabel\`：可选。用于区分本次交付目录。

## 输出重点

- \`manifestPath\`：最终交付 JSON 清单路径。
- \`reportPath\`：最终交付 Markdown 报告路径。
- \`deliveredCount\`：本次交付的论文数量。
- \`missingFileCount\`：交付时发现缺失文件的数量。
- \`papers\`：最终交付论文列表，包含本地路径。
`,
    outputDescription: "返回最终交付 JSON/Markdown 路径、交付数量、缺失文件数量和论文文件列表。",
  },
  {
    scriptId: "asset_script_paper_integrity_verify_skill",
    scriptName: "论文完整性校验脚本",
    scriptDescription: "对最终论文 manifest 执行文件存在性和大小校验，生成通过/失败报告。",
    runCommand: "node paper-integrity-verify-skill.mjs",
    parameterSchema: {
      type: "object",
      additionalProperties: false,
      required: ["manifestPath"],
      properties: {
        manifestPath: { type: "string", description: "待校验的论文 manifest.json 路径。" },
        requiredCount: { type: "integer", minimum: 1, description: "需要校验的论文数量（如不指定则校验 manifest 中全部论文）。" },
        outputLabel: { type: "string", description: "可选输出标签，用于区分本次校验目录。" },
      },
    },
    skillId: "asset_skill_paper_integrity_verify",
    skillName: "论文完整性校验",
    skillDescription: "当任务需要验证论文 PDF 是否真实存在、大小是否正常、并输出 pass/fail 报告时使用此技能。",
    guideContent: `---
name: 论文完整性校验
description: 当任务需要验证论文 PDF 是否真实存在且可交付，并输出 pass/fail 结果时使用此技能。
---

# 论文完整性校验技能

## 技能用途

对最终 manifest 中的论文文件做确定性校验，检查文件是否存在、大小是否大于 0，并生成 pass/fail 校验报告。

## 何时使用

- 当下载与交付打包已经完成，需要做最终验收时。
- 当任务要求”验证 PDF 是否都存在””输出校验结果”时。
- 当 reviewer 要求明确的 machine-checkable 结果时。

## 输入参数

- \`manifestPath\`：必填。交付 manifest 或合并 manifest 的 JSON 路径。
- \`requiredCount\`：可选。预期需要通过校验的论文数量（由用户目标决定，不要硬编码）。
- \`outputLabel\`：可选。用于区分本次校验目录。

## 输出重点

- \`manifestPath\`：校验结果 JSON 路径。
- \`reportPath\`：校验报告 Markdown 路径。
- \`passedCount\` / \`failedCount\`：通过与失败数量。
- \`allPassed\`：是否全部通过。
- \`checks\`：逐篇论文的检查结果。
`,
    outputDescription: "返回校验 JSON/Markdown 路径、通过/失败数量、allPassed 状态和逐篇检查结果。",
  },
];

function nowIso() {
  return new Date().toISOString();
}

if (!existsSync(dbPath)) {
  throw new Error(`database not found: ${dbPath}`);
}

for (const asset of assets) {
  const scriptPath = resolve(scriptsDir, asset.runCommand.replace(/^node\s+/, ""));
  if (!existsSync(scriptPath)) {
    throw new Error(`skill script not found: ${scriptPath}`);
  }
}

const db = new DatabaseSync(dbPath);
const now = nowIso();

db.exec(`
CREATE TABLE IF NOT EXISTS script_asset (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  local_path TEXT NOT NULL,
  run_command TEXT NOT NULL,
  parameter_schema TEXT NOT NULL DEFAULT '{}',
  default_environment_id TEXT,
  enabled INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_asset (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  guide_content TEXT,
  script_id TEXT NOT NULL,
  parameter_mapping TEXT NOT NULL DEFAULT '{}',
  output_description TEXT,
  enabled INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);

const skillColumns = db.prepare("PRAGMA table_info(skill_asset)").all();
if (!skillColumns.some((column) => column.name === "guide_content")) {
  db.exec("ALTER TABLE skill_asset ADD COLUMN guide_content TEXT");
}

for (const asset of assets) {
  const existingScript = db
    .prepare("SELECT id, created_at FROM script_asset WHERE id = ?")
    .get(asset.scriptId);

  db.prepare(`
    INSERT INTO script_asset (
      id, name, description, local_path, run_command, parameter_schema,
      default_environment_id, enabled, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      local_path = excluded.local_path,
      run_command = excluded.run_command,
      parameter_schema = excluded.parameter_schema,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `).run(
    asset.scriptId,
    asset.scriptName,
    asset.scriptDescription,
    scriptsDir,
    asset.runCommand,
    JSON.stringify(asset.parameterSchema),
    null,
    1,
    existingScript?.created_at ?? now,
    now,
  );

  const existingSkill = db
    .prepare("SELECT id, created_at FROM skill_asset WHERE id = ?")
    .get(asset.skillId);

  db.prepare(`
    INSERT INTO skill_asset (
      id, name, description, guide_content, script_id, parameter_mapping, output_description,
      enabled, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      guide_content = excluded.guide_content,
      script_id = excluded.script_id,
      parameter_mapping = excluded.parameter_mapping,
      output_description = excluded.output_description,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `).run(
    asset.skillId,
    asset.skillName,
    asset.skillDescription,
    asset.guideContent,
    asset.scriptId,
    JSON.stringify({}),
    asset.outputDescription,
    1,
    existingSkill?.created_at ?? now,
    now,
  );
}

const installed = {
  scripts: db.prepare(
    `SELECT * FROM script_asset WHERE id IN (${assets.map(() => "?").join(", ")}) ORDER BY id`,
  ).all(...assets.map((asset) => asset.scriptId)),
  skills: db.prepare(
    `SELECT * FROM skill_asset WHERE id IN (${assets.map(() => "?").join(", ")}) ORDER BY id`,
  ).all(...assets.map((asset) => asset.skillId)),
};

process.stdout.write(JSON.stringify(installed, null, 2));
