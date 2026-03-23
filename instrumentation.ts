/**
 * Next.js instrumentation hook — runs once when the server starts.
 * Used here to recover interrupted agent workflow runs (durable execution).
 */
export async function register() {
  // Only run on the server side (not during build or client)
  if (typeof globalThis.window === "undefined") {
    // Dynamic import to avoid pulling server modules into client bundles
    const { runtimeEngine } = await import("@/server/runtime/runtime-engine");

    // Give the server a moment to fully initialize before attempting recovery
    setTimeout(async () => {
      try {
        const result = await runtimeEngine.recoverInterruptedRuns();
        if (result.recovered.length > 0 || result.failed.length > 0) {
          console.log(
            `[Instrumentation] Durable execution recovery: ${result.recovered.length} recovered, ${result.failed.length} failed`,
          );
        }
      } catch (error) {
        console.error("[Instrumentation] Failed to recover interrupted runs:", error);
      }
    }, 2000);
  }
}
