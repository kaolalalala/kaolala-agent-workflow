import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { reviewTodoExecution } from "@/server/meta-agent/todo-driven/review";
import type { TodoExecutionContext, TodoExecutorResult } from "@/server/meta-agent/todo-driven/types";
import type { TodoItem } from "@/server/meta-agent/supervisor-runtime-state";

function createTodo(overrides: Partial<TodoItem>): TodoItem {
  return {
    id: "todo_default",
    title: "Default todo",
    description: "Default description",
    status: "reviewing",
    priority: "high",
    assignee: "collector_agent",
    capability_type: "collection",
    depends_on: [],
    acceptance_criteria: ["criterion 1", "criterion 2"],
    input_refs: [],
    retry_count: 0,
    delegation_status: "returned",
    assignee_history: ["collector_agent"],
    notes: [],
    ...overrides,
  };
}

function createContext(): TodoExecutionContext {
  return {
    goal: "Download papers",
    run_id: "run_test",
    current_todo: {
      id: "todo_default",
      title: "Default todo",
      description: "Default description",
      acceptance_criteria: ["criterion 1", "criterion 2"],
    },
    input_artifacts: [],
    history_summary: {
      completed_todos: [],
      recent_logs: [],
      open_issues: [],
    },
    resource_center: {
      skills: [
        {
          id: "skill_paper_delivery",
          name: "Paper Delivery Skill",
          runtime_profile_id: "paper_delivery_pipeline",
        },
      ],
    },
  };
}

describe("relaxed paper pipeline review", () => {
  it("passes collection review when manifest and required pdf bundle exist", async () => {
    const root = join(process.cwd(), ".output", "test-review-relaxed-collection");
    mkdirSync(root, { recursive: true });

    const pdfPaths = Array.from({ length: 5 }, (_, index) => {
      const path = join(root, `paper_${index + 1}.pdf`);
      writeFileSync(path, `pdf-${index + 1}`);
      return path;
    });
    const manifestPath = join(root, "manifest.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        papers: pdfPaths.map((filePath, index) => ({
          title: `Agent Paper ${index + 1}`,
          filePath,
        })),
      }, null, 2),
    );

    const todo = createTodo({
      id: "download_agent_batch_a",
      title: "Download 5 agent-related papers for batch A",
      description: "Collect a batch of agent papers with a manifest.",
      acceptance_criteria: [
        "Exactly 5 paper PDFs were downloaded for this batch",
        "A structured manifest JSON was produced for this batch",
      ],
      notes: ["review_expected_count:5"],
    });

    const executorResult: TodoExecutorResult = {
      status: "success",
      output: "Downloaded 5 papers and wrote a manifest.",
      summary: "batch complete",
      artifacts: [
        { path: manifestPath, type: "manifest", summary: "batch manifest" },
        ...pdfPaths.map((path) => ({ path, type: "pdf", summary: "paper pdf" })),
      ],
    };

    const review = await reviewTodoExecution(todo, executorResult, createContext());
    expect(review.status).toBe("pass");
    expect(review.missing_criteria).toEqual([]);
  });

  it("passes delivery review when final delivery manifest and report are complete", async () => {
    const root = join(process.cwd(), ".output", "test-review-relaxed-delivery");
    mkdirSync(root, { recursive: true });

    const pdfPaths = Array.from({ length: 10 }, (_, index) => {
      const path = join(root, `deliver_${index + 1}.pdf`);
      writeFileSync(path, `pdf-${index + 1}`);
      return path;
    });
    const manifestPath = join(root, "final_delivery_manifest.json");
    const reportPath = join(root, "final_delivery_report.md");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        deliveredCount: 10,
        missingFileCount: 0,
        papers: pdfPaths.map((filePath, index) => ({
          title: `Agent Paper ${index + 1}`,
          filePath,
        })),
      }, null, 2),
    );
    writeFileSync(reportPath, "# delivery ok\n");

    const todo = createTodo({
      id: "final_delivery",
      title: "Deliver final paper package",
      description: "Produce final delivery artifacts.",
      capability_type: "writing",
      assignee: "writer_agent",
      acceptance_criteria: [
        "final_delivery_manifest.json is present",
        "final delivery package references exactly 10 PDFs",
      ],
      notes: ["review_expected_count:10"],
    });

    const executorResult: TodoExecutorResult = {
      status: "success",
      output: "Final delivery package created.",
      summary: "delivery complete",
      artifacts: [
        { path: manifestPath, type: "manifest", summary: "delivery manifest" },
        { path: reportPath, type: "report", summary: "delivery report" },
      ],
    };

    const review = await reviewTodoExecution(todo, executorResult, createContext());
    expect(review.status).toBe("pass");
    expect(review.missing_criteria).toEqual([]);
  });

  it("prefers the best merge manifest when a stale partial manifest appears first", async () => {
    const root = join(process.cwd(), ".output", "test-review-relaxed-merge-best-manifest");
    mkdirSync(root, { recursive: true });

    const pdfPaths = Array.from({ length: 10 }, (_, index) => {
      const path = join(root, `merge_${index + 1}.pdf`);
      writeFileSync(path, `pdf-${index + 1}`);
      return path;
    });

    const partialDir = join(root, "stale");
    const finalDir = join(root, "final");
    mkdirSync(partialDir, { recursive: true });
    mkdirSync(finalDir, { recursive: true });

    const partialManifestPath = join(partialDir, "merged_paper_manifest.json");
    const finalManifestPath = join(finalDir, "merged_paper_manifest.json");
    writeFileSync(
      partialManifestPath,
      JSON.stringify({
        mergedCount: 8,
        requiredCount: 10,
        papers: pdfPaths.slice(0, 8).map((filePath, index) => ({
          title: `Partial Paper ${index + 1}`,
          filePath,
        })),
      }, null, 2),
    );
    writeFileSync(
      finalManifestPath,
      JSON.stringify({
        mergedCount: 10,
        requiredCount: 10,
        papers: pdfPaths.map((filePath, index) => ({
          title: `Final Paper ${index + 1}`,
          filePath,
        })),
      }, null, 2),
    );

    const todo = createTodo({
      id: "merge_paper_manifests",
      title: "Merge 10 downloaded paper entries into a final manifest",
      description: "Merge and deduplicate paper manifests from prior batches.",
      capability_type: "merge",
      assignee: "merge_agent",
      acceptance_criteria: [
        "The merged manifest contains 10 unique papers",
        "The output is ready for downstream verification",
      ],
      notes: ["review_expected_count:10"],
    });

    const executorResult: TodoExecutorResult = {
      status: "success",
      output: "Merged manifests and produced a final artifact.",
      summary: "merge complete",
      artifacts: [
        { path: partialManifestPath, type: "manifest", summary: "stale partial merge manifest" },
        { path: finalManifestPath, type: "manifest", summary: "final merge manifest" },
      ],
    };

    const review = await reviewTodoExecution(todo, executorResult, createContext());
    expect(review.status).toBe("pass");
    expect(review.reason).toContain("10");
  });

  it("prefers the best verification input manifest when older merge artifacts are still present", async () => {
    const root = join(process.cwd(), ".output", "test-review-relaxed-verification-best-manifest");
    mkdirSync(root, { recursive: true });

    const pdfPaths = Array.from({ length: 10 }, (_, index) => {
      const path = join(root, `verify_${index + 1}.pdf`);
      writeFileSync(path, `pdf-${index + 1}`);
      return path;
    });

    const partialDir = join(root, "stale");
    const finalDir = join(root, "final");
    mkdirSync(partialDir, { recursive: true });
    mkdirSync(finalDir, { recursive: true });

    const partialManifestPath = join(partialDir, "manifest_final.json");
    const finalManifestPath = join(finalDir, "manifest_final.json");
    const reportPath = join(root, "verification_report.md");
    writeFileSync(
      partialManifestPath,
      JSON.stringify({
        mergedCount: 8,
        requiredCount: 10,
        papers: pdfPaths.slice(0, 8).map((filePath, index) => ({
          title: `Partial Paper ${index + 1}`,
          filePath,
        })),
      }, null, 2),
    );
    writeFileSync(
      finalManifestPath,
      JSON.stringify({
        mergedCount: 10,
        requiredCount: 10,
        papers: pdfPaths.map((filePath, index) => ({
          title: `Final Paper ${index + 1}`,
          filePath,
        })),
      }, null, 2),
    );
    writeFileSync(reportPath, "# verification ok\n");

    const todo = createTodo({
      id: "verify_final_delivery",
      title: "Verify the final 10-paper package",
      description: "Validate the merged paper package before delivery.",
      capability_type: "verification",
      assignee: "verifier_agent",
      acceptance_criteria: [
        "A verification report is present",
        "The merged manifest references 10 reachable PDFs",
      ],
      notes: ["review_expected_count:10"],
    });

    const context = createContext();
    context.input_artifacts = [
      {
        id: "artifact_partial_manifest",
        path: partialManifestPath,
        type: "manifest",
        summary: "stale partial manifest",
        storage_mode: "workspace",
        read_mode: "workspace_full",
      },
      {
        id: "artifact_final_manifest",
        path: finalManifestPath,
        type: "manifest",
        summary: "final manifest",
        storage_mode: "workspace",
        read_mode: "workspace_full",
      },
    ];

    const executorResult: TodoExecutorResult = {
      status: "success",
      output: "Verified the final paper bundle.",
      summary: "verification complete",
      artifacts: [
        { path: reportPath, type: "report", summary: "verification report" },
      ],
    };

    const review = await reviewTodoExecution(todo, executorResult, context);
    expect(review.status).toBe("pass");
    expect(review.reason).toContain("10");
  });

  it("does not let profile review override executor error", async () => {
    const root = join(process.cwd(), ".output", "test-review-relaxed-error-precedence");
    mkdirSync(root, { recursive: true });

    const manifestPath = join(root, "final_delivery_manifest.json");
    const reportPath = join(root, "final_delivery_report.md");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        deliveredCount: 10,
        missingFileCount: 0,
        papers: Array.from({ length: 10 }, (_, index) => ({
          title: `Agent Paper ${index + 1}`,
          filePath: join(root, `deliver_${index + 1}.pdf`),
        })),
      }, null, 2),
    );
    writeFileSync(reportPath, "# delivery ok\n");

    const todo = createTodo({
      id: "final_delivery_error_case",
      title: "Deliver final paper package",
      description: "Produce final delivery artifacts.",
      capability_type: "writing",
      assignee: "writer_agent",
      acceptance_criteria: [
        "final_delivery_manifest.json is present",
        "final delivery package references exactly 10 PDFs",
      ],
      notes: ["review_expected_count:10"],
    });

    const executorResult: TodoExecutorResult = {
      status: "error",
      output: "tool failed after producing partial artifacts",
      error_message: "executor crashed after artifact write",
      artifacts: [
        { path: manifestPath, type: "manifest", summary: "delivery manifest" },
        { path: reportPath, type: "report", summary: "delivery report" },
      ],
    };

    const review = await reviewTodoExecution(todo, executorResult, createContext());
    expect(review.status).toBe("fail");
    expect(review.reason).toContain("executor crashed");
  });
});
