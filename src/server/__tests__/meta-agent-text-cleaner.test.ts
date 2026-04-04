import { describe, expect, it } from "vitest";

import { sanitizeJsonLikeText, sanitizeModelText } from "@/server/meta-agent/text-cleaner";

describe("meta-agent text cleaner", () => {
  it("removes think blocks from display text", () => {
    const cleaned = sanitizeModelText("<think>internal reasoning</think>\nFinal answer");
    expect(cleaned).toBe("Final answer");
  });

  it("removes think blocks and fences from json-like text", () => {
    const cleaned = sanitizeJsonLikeText("<think>reasoning</think>\n```json\n{\"ok\":true}\n```");
    expect(cleaned).toBe("{\"ok\":true}");
  });
});
