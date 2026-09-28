import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("project detail ui regression", () => {
  it("exposes project-level meta-agent activity entry points", () => {
    const source = readFileSync(
      path.resolve(process.cwd(), "app/(platform)/projects/[projectId]/project-detail-client.tsx"),
      "utf8",
    );

    expect(source.includes("Meta-Agent Sessions")).toBe(true);
    expect(source.includes("Meta-Agent Activity")).toBe(true);
    expect(source.includes("/runs?scope=meta_agent_run&projectId=")).toBe(true);
    expect(source.includes("/meta-agent?sessionId=")).toBe(true);
    expect(source.includes("/meta-agent?projectId=")).toBe(true);
  });
});
