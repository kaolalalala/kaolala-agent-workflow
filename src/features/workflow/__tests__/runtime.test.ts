import { afterEach, describe, expect, it, vi } from "vitest";

import { MockRuntimeEngine } from "@/lib/runtime/mock-runtime";

describe("mock runtime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits run events in order for success flow", () => {
    vi.useFakeTimers();
    const engine = new MockRuntimeEngine();
    const blueprint = engine.submitRootTask({ title: "测试成功流程" });

    const types: string[] = [];
    engine.subscribeRunEvents(blueprint.run.id, (event) => {
      types.push(event.type);
    });

    engine.startRun(blueprint.run.id);
    vi.runAllTimers();

    expect(types[0]).toBe("run_started");
    expect(types).toContain("node_started");
    expect(types).toContain("node_completed");
    expect(types.at(-1)).toBe("output_generated");
  });

  it("emits failure path when title contains failure keyword", () => {
    vi.useFakeTimers();
    const engine = new MockRuntimeEngine();
    const blueprint = engine.submitRootTask({ title: "失败分支验证" });

    const types: string[] = [];
    engine.subscribeRunEvents(blueprint.run.id, (event) => {
      types.push(event.type);
    });

    engine.startRun(blueprint.run.id);
    vi.runAllTimers();

    expect(types).toContain("node_failed");
    expect(types.at(-1)).toBe("output_generated");
  });
});
