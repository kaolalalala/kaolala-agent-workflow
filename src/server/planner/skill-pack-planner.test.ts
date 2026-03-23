import { describe, expect, it } from "vitest";
import JSZip from "jszip";

import {
  extractMarkdownFilesFromUploads,
  planWorkflowFromSkillPack,
} from "@/server/planner/skill-pack-planner";

function toBytes(value: string) {
  return new TextEncoder().encode(value);
}

describe("skill-pack-planner", () => {
  it("只提取白名单信息并忽略代码/命令内容", async () => {
    const markdown = [
      "# 角色",
      "角色: Research Planner",
      "角色定位: 负责拆解任务并规划执行步骤",
      "职责:",
      "- 分析输入目标",
      "- 拆解子任务",
      "```bash",
      "python scripts/run.py",
      "```",
      "命令: npm run dangerous",
      "输入: 用户任务",
      "输出: 子任务列表",
      "边界: 不直接输出最终答案",
    ].join("\n");

    const result = await planWorkflowFromSkillPack({
      markdownFiles: [{ name: "planner.md", content: markdown }],
      preferLlm: false,
    });

    expect(result.roleSummaries).toHaveLength(1);
    expect(result.roleSummaries[0].roleName).toContain("Research Planner");
    expect(result.roleSummaries[0].responsibilities.join("\n")).not.toMatch(/python|npm|script/i);
    expect(result.roleSummaries[0].warnings.join("\n")).toMatch(/忽略/);
  });

  it("可生成最小可用 workflow 草稿（包含输入/输出与连线）", async () => {
    const markdownFiles = [
      {
        name: "planner.md",
        content: ["角色: Planner", "角色定位: 负责规划", "职责: 拆解任务", "输出: 任务计划"].join("\n"),
      },
      {
        name: "worker.md",
        content: ["角色: Worker", "角色定位: 负责执行", "职责: 执行任务并返回结果", "输入: 任务计划"].join("\n"),
      },
    ];

    const result = await planWorkflowFromSkillPack({
      markdownFiles,
      workflowName: "测试草稿",
      preferLlm: false,
    });

    expect(result.draft.name).toBe("测试草稿");
    expect(result.draft.nodes.some((node) => node.role === "input")).toBe(true);
    expect(result.draft.nodes.some((node) => node.role === "output")).toBe(true);
    expect(result.draft.edges.length).toBeGreaterThan(0);
    expect(result.draft.tasks.length).toBeGreaterThan(0);
  });

  it("支持从 zip 包提取 markdown 文件", async () => {
    const zip = new JSZip();
    zip.file("roles/planner.md", "角色: Planner\n职责: 规划任务");
    zip.file("roles/worker.markdown", "角色: Worker\n职责: 执行任务");
    const bytes = new Uint8Array(await zip.generateAsync({ type: "uint8array" }));

    const extracted = await extractMarkdownFilesFromUploads([
      {
        name: "roles.zip",
        bytes,
      },
      {
        name: "manual.md",
        bytes: toBytes("角色: Reviewer\n职责: 复核结果"),
      },
    ]);

    expect(extracted.length).toBe(3);
    expect(extracted.map((item) => item.name).join("\n")).toMatch(/roles\.zip:roles\/planner\.md/);
    expect(extracted.map((item) => item.name).join("\n")).toMatch(/manual\.md/);
  });
});

