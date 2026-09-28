import { afterEach, describe, expect, it } from "vitest";

import {
  abortGate,
  getPendingInputInfo,
  persistInjectedInput,
  waitForInput,
} from "@/server/meta-agent/interrupt-gate";

describe("interrupt gate", () => {
  const sessionId = "meta_interrupt_gate_test";

  afterEach(() => {
    abortGate(sessionId);
  });

  it("resumes from persisted input when the submission arrives outside the in-memory worker", async () => {
    const gate = waitForInput(sessionId, "confirm plan", "", 5_000);
    const token = getPendingInputInfo(sessionId)?.token;
    if (!token) {
      throw new Error("missing pending input token");
    }

    setTimeout(() => {
      persistInjectedInput(sessionId, "wrong-token", "ignore me");
    }, 20);

    setTimeout(() => {
      persistInjectedInput(sessionId, token, "approved");
    }, 120);

    await expect(gate).resolves.toBe("approved");
  });
});
