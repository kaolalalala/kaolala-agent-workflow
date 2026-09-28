import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("interview showcase ui regression", () => {
  it("renders the showcase page as a flow-diagram walkthrough instead of stacked explainer cards", () => {
    const consoleSource = readFileSync(
      path.resolve(process.cwd(), "src/features/showcase/interview-showcase-console.tsx"),
      "utf8",
    );

    expect(consoleSource.includes("平台完整使用链路")).toBe(true);
    expect(consoleSource.includes("资源 → 工作流 → 项目 → Run → 运行中心 → 运行详情 → 结果沉淀")).toBe(true);
    expect(consoleSource.includes("资源中心")).toBe(true);
    expect(consoleSource.includes("工作流编排")).toBe(true);
    expect(consoleSource.includes("挂载项目")).toBe(true);
    expect(consoleSource.includes("创建 Run")).toBe(true);
    expect(consoleSource.includes("运行中心")).toBe(true);
    expect(consoleSource.includes("运行详情")).toBe(true);
    expect(consoleSource.includes("结果沉淀")).toBe(true);
    expect(consoleSource.includes("System Design Highlights")).toBe(true);
    expect(consoleSource.includes("Platform Capability Loop")).toBe(true);
    expect(consoleSource.includes("Meta-Agent")).toBe(true);
    expect(consoleSource.includes("评测中心")).toBe(true);

    expect(consoleSource.includes("这段重点")).toBe(false);
    expect(consoleSource.includes("系统机制")).toBe(false);
    expect(consoleSource.includes("为什么值得讲")).toBe(false);
    expect(consoleSource.includes("能力覆盖")).toBe(false);
  });

  it("keeps the dedicated showcase entry registered in layout, route page, and dashboard", () => {
    const layoutSource = readFileSync(
      path.resolve(process.cwd(), "app/(platform)/layout.tsx"),
      "utf8",
    );
    const pageSource = readFileSync(
      path.resolve(process.cwd(), "app/(platform)/showcases/page.tsx"),
      "utf8",
    );
    const dashboardSource = readFileSync(
      path.resolve(process.cwd(), "app/(platform)/dashboard/page.tsx"),
      "utf8",
    );

    expect(layoutSource.includes("/showcases")).toBe(true);
    expect(layoutSource.includes("面试展示")).toBe(true);
    expect(pageSource.includes("InterviewShowcaseConsole")).toBe(true);
    expect(dashboardSource.includes("面试展示")).toBe(true);
    expect(dashboardSource.includes("/showcases?scenario=")).toBe(true);
  });
});
