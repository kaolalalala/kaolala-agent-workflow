import { beforeEach, describe, expect, it } from "vitest";

import { stateMachine } from "@/server/runtime/state-machine";

describe("state machine", () => {
  beforeEach(() => {
    // no-op
  });

  it("allows valid transitions", () => {
    expect(stateMachine.run("idle", "running")).toBe("running");
    expect(stateMachine.node("idle", "ready")).toBe("ready");
    expect(stateMachine.task("pending", "running")).toBe("running");
  });

  it("rejects invalid transitions", () => {
    expect(() => stateMachine.run("idle", "completed")).toThrow();
    expect(() => stateMachine.node("completed", "running")).toThrow();
    expect(() => stateMachine.task("pending", "completed")).toThrow();
  });
});
