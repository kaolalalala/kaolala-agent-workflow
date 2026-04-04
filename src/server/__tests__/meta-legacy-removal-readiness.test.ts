import { describe, expect, it } from "vitest";

import {
  auditLegacyDependencies,
  checkLegacyRemovalReadiness,
} from "@/server/meta-agent/legacy-removal-readiness";

describe("legacy removal readiness", () => {
  it("produces structured dependency audit", () => {
    const audit = auditLegacyDependencies();
    expect(Array.isArray(audit.legacy_only_paths)).toBe(true);
    expect(Array.isArray(audit.legacy_compatible_paths)).toBe(true);
    expect(Array.isArray(audit.safe_to_delete)).toBe(true);
    expect(Array.isArray(audit.unknown_dependency)).toBe(true);
  });

  it("returns ready_to_delete=true when regressions pass and no legacy blockers", () => {
    const readiness = checkLegacyRemovalReadiness({
      api: true,
      ui: true,
      e2e: true,
      tsc: true,
      tests: true,
      deadPathGuardTriggeredCount: 0,
    });

    expect(readiness.blocking_reasons).toEqual([]);
    expect(readiness.ready_to_delete).toBe(true);
  });
});

