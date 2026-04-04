import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("meta-agent UI regression", () => {
  it("contains todo-driven terminal states and no legacy runtime mode toggles", () => {
    const filePath = path.join(process.cwd(), "app/(platform)/meta-agent/page.tsx");
    const source = readFileSync(filePath, "utf8");

    expect(source.includes("completed")).toBe(true);
    expect(source.includes("failed")).toBe(true);
    expect(source.includes("blocked")).toBe(true);
    expect(source.includes("idle")).toBe(true);
    expect(source.includes("历史运行")).toBe(true);
    expect(source.includes("运行概览")).toBe(true);
    expect(source.includes("任务流转图")).toBe(true);
    expect(source.includes("运行信号")).toBe(true);
    expect(source.includes("恢复与路由")).toBe(true);
    expect(source.includes("关键交付物")).toBe(true);
    expect(source.includes("控制平面")).toBe(true);
    expect(source.includes("控制轨迹与护栏")).toBe(true);
    expect(source.includes("检查点与回放候选")).toBe(true);
    expect(source.includes("项目记忆与规划上下文")).toBe(true);
    expect(source.includes("执行轨迹面板")).toBe(true);
    expect(source.includes("展开高级调试")).toBe(true);
    expect(source.includes("useSearchParams")).toBe(true);

    expect(source.includes("META_AGENT_PRIMARY_RUNTIME_MODE")).toBe(false);
    expect(/\bmode\s*===\s*["']legacy["']/.test(source)).toBe(false);
  });
});
