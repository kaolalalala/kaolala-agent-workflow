import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("runs center UI regression", () => {
  it("surfaces Meta-Agent as a first-class scope", () => {
    const filePath = path.join(process.cwd(), "app/(platform)/runs/page.tsx");
    const source = readFileSync(filePath, "utf8");

    expect(source.includes(`"meta_agent_run"`)).toBe(true);
    expect(source.includes("Meta-Agent 分析")).toBe(true);
    expect(source.includes("打开 Meta-Agent")).toBe(true);
    expect(source.includes("全部项目")).toBe(true);
    expect(source.includes("项目筛选")).toBe(true);
    expect(source.includes("useSearchParams")).toBe(true);
    expect(source.includes("运行中心")).toBe(true);
    expect(source.includes("查看 Meta-Agent 会话、控制进度")).toBe(true);
  });
});
