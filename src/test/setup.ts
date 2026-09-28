import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, vi } from "vitest";

import { installRuntimeTestLlm } from "@/server/__tests__/helpers/test-llm";

class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

(globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver = ResizeObserver;

beforeEach(() => {
  installRuntimeTestLlm();
});

afterEach(() => {
  vi.restoreAllMocks();
});
