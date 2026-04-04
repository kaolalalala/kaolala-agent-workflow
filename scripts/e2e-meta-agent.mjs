/**
 * E2E smoke test for the meta-agent pipeline.
 * Usage:
 *   node scripts/e2e-meta-agent.mjs
 *   node scripts/e2e-meta-agent.mjs --baseUrl=http://127.0.0.1:3000 --timeoutMs=600000
 */

const args = Object.fromEntries(
  process.argv.slice(2).map((item) => {
    const [k, ...rest] = item.replace(/^--/, "").split("=");
    return [k, rest.join("=") || "true"];
  }),
);

const BASE_URL = String(args.baseUrl || "http://127.0.0.1:3000").replace(/\/$/, "");
const TIMEOUT_MS = Number(args.timeoutMs || 600_000);   // 10 min default
const POLL_MS = Number(args.pollMs || 3000);
const PROJECT_ID = String(args.projectId || "e2e_memory_papers");

const GOAL =
  "下载10篇关于 agent memory 的 arxiv 论文 PDF，" +
  "分两个并行子任务同时下载：batch1 下载前5篇，batch2 下载后5篇，" +
  "最后合并成一份清单并完成交付。";

// ── helpers ──────────────────────────────────────────────────────────────────

async function api(path, init = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${path}: ${JSON.stringify(body).slice(0, 200)}`);
  }
  return body;
}

function fmt(ms) {
  const s = Math.floor(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m${s % 60}s` : `${s}s`;
}

function todoLine(todo) {
  const bar = { done: "✅", failed: "❌", in_progress: "🔄", reviewing: "🔍", todo: "⬜", ready: "▶️", blocked: "🚫", pruned: "✂️" };
  const icon = bar[todo.status] ?? "❓";
  return `  ${icon} [${todo.id}] ${todo.title} (${todo.capability_type}, retry=${todo.retry_count ?? 0})`;
}

// ── start session ─────────────────────────────────────────────────────────────

console.log("━".repeat(60));
console.log("🧠 Meta-Agent E2E Smoke Test");
console.log(`   Goal: ${GOAL}`);
console.log(`   Server: ${BASE_URL}`);
console.log(`   Timeout: ${fmt(TIMEOUT_MS)}`);
console.log("━".repeat(60));

const startRes = await api("/api/meta-agent", {
  method: "POST",
  body: JSON.stringify({
    goal: GOAL,
    projectId: PROJECT_ID,
    maxStepLimit: 16,
    maxPlanningRounds: 3,
    qualityThreshold: 0.7,
    mode: "async",
  }),
});

const sessionId = startRes.sessionId;
if (!sessionId) {
  console.error("❌ No sessionId returned from POST /api/meta-agent");
  console.error(JSON.stringify(startRes, null, 2));
  process.exit(1);
}

console.log(`\n▶️  Session started: ${sessionId}`);
if (startRes.planningContextSummary) {
  const ctx = startRes.planningContextSummary;
  console.log(`   Planning context: ${ctx.skillCount ?? 0} skills, hints=${JSON.stringify(ctx.hints ?? []).slice(0, 120)}`);
}

// ── poll loop ────────────────────────────────────────────────────────────────

const startedAt = Date.now();
let lastStep = -1;
let lastTodoSnapshot = "";

while (Date.now() - startedAt < TIMEOUT_MS) {
  await new Promise((r) => setTimeout(r, POLL_MS));

  let session;
  try {
    session = await api(`/api/meta-agent?sessionId=${sessionId}`);
  } catch (err) {
    console.warn(`⚠️  Poll error: ${err.message}`);
    continue;
  }

  const status = session.status;
  const state = session.supervisorRunState;
  const elapsed = fmt(Date.now() - startedAt);

  // Print new steps
  const currentStep = Array.isArray(session.iterations) ? session.iterations.length : 0;
  if (currentStep !== lastStep) {
    lastStep = currentStep;
    const latest = session.iterations?.[session.iterations.length - 1];
    const score = latest?.reflectionScore != null ? ` score=${latest.reflectionScore.toFixed(2)}` : "";
    const verdict = latest?.reflectionVerdict ? ` verdict=${latest.reflectionVerdict}` : "";
    console.log(`\n[${elapsed}] Step ${currentStep}${score}${verdict}`);

    // Print todo list if changed
    if (state?.todos) {
      const snapshot = state.todos.map((t) => `${t.id}:${t.status}`).join(",");
      if (snapshot !== lastTodoSnapshot) {
        lastTodoSnapshot = snapshot;
        console.log("  Todos:");
        for (const todo of state.todos) {
          console.log(todoLine(todo));
        }
        const tokens = Number(state.metadata?.llm_total_tokens ?? 0);
        const calls = Number(state.metadata?.llm_call_count ?? 0);
        console.log(`  Tokens used: ${tokens.toLocaleString()} (${calls} LLM calls)`);
      }
    }
  }

  if (status === "done" || status === "error") {
    const elapsed2 = fmt(Date.now() - startedAt);
    const result = session.result;
    const runStatus = result?.status ?? state?.status;

    console.log("\n" + "━".repeat(60));
    console.log(`🏁 Session finished in ${elapsed2}`);
    console.log(`   Result status : ${runStatus}`);
    console.log(`   Session status: ${status}`);

    if (state) {
      const done = state.todos.filter((t) => t.status === "done").length;
      const failed = state.todos.filter((t) => t.status === "failed").length;
      const total = state.todos.length;
      const tokens = Number(state.metadata?.llm_total_tokens ?? 0);
      const calls = Number(state.metadata?.llm_call_count ?? 0);
      const replanCount = Number(state.metadata?.replan_count ?? 0);

      console.log(`   Todos         : ${done}/${total} done, ${failed} failed`);
      console.log(`   Tokens        : ${tokens.toLocaleString()} (${calls} LLM calls, ${replanCount} replans)`);

      if (state.issues?.length) {
        const open = state.issues.filter((i) => i.status === "open");
        if (open.length) {
          console.log(`   Open issues   : ${open.length}`);
          for (const issue of open.slice(0, 5)) {
            console.log(`     ⚠️  [${issue.type}] ${issue.message.slice(0, 120)}`);
          }
        }
      }

      // Artifact summary
      if (state.artifacts?.length) {
        console.log(`\n   Artifacts (${state.artifacts.length}):`);
        for (const a of state.artifacts.slice(0, 10)) {
          console.log(`     • [${a.type}] ${a.summary?.slice(0, 100)} @ ${a.path?.slice(-80)}`);
        }
      }
    }

    // Final output preview
    if (result?.finalOutput) {
      console.log(`\n   Final output preview:`);
      console.log("   " + result.finalOutput.slice(0, 600).replace(/\n/g, "\n   "));
    }

    // Health checks
    console.log("\n   Health checks:");
    const checks = {
      "Session completed (not error)": status === "done",
      "Run status is success or max_steps": ["success", "max_steps_reached", "max_iterations_reached"].includes(result?.status ?? ""),
      "At least 1 todo done": (state?.todos?.filter((t) => t.status === "done").length ?? 0) >= 1,
      "No open critical issues": !(state?.issues ?? []).some((i) => i.status === "open" && /critical/.test(i.type)),
      "Has artifacts": (state?.artifacts?.length ?? 0) > 0,
      "Token count > 0": Number(state?.metadata?.llm_total_tokens ?? 0) > 0,
      "Parallel wave occurred": (state?.execution_log ?? []).some((e) => e.action === "wave_created") ?? false,
    };

    let allPassed = true;
    for (const [label, passed] of Object.entries(checks)) {
      console.log(`     ${passed ? "✅" : "❌"} ${label}`);
      if (!passed) allPassed = false;
    }

    console.log("\n" + "━".repeat(60));
    if (allPassed) {
      console.log("✅ All health checks passed.");
    } else {
      console.log("⚠️  Some health checks failed — review output above.");
    }

    process.exit(allPassed ? 0 : 1);
  }
}

console.error(`\n❌ Timed out after ${fmt(TIMEOUT_MS)}`);
process.exit(1);
