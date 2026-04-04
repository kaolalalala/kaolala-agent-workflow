import type { TodoExecutionContext } from "./types";

function estimateChars(context: TodoExecutionContext) {
  return JSON.stringify(context).length;
}

function truncateText(text: string | undefined, maxChars: number) {
  if (!text) return text;
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...(truncated)`;
}

export function compactExecutionContext(
  context: TodoExecutionContext,
  budgetChars = 6000,
): TodoExecutionContext {
  if (estimateChars(context) <= budgetChars) return context;

  const primaryArtifacts = context.input_artifacts.slice(0, 3).map((artifact) => ({
    ...artifact,
    summary: truncateText(artifact.summary, 240) ?? "",
    content: truncateText(artifact.content, 1200),
  }));

  const overflowArtifacts = context.input_artifacts.slice(3);
  if (overflowArtifacts.length > 0) {
    primaryArtifacts.push({
      id: "__compacted_artifacts__",
      path: "context://compacted-artifacts",
      type: "compacted_artifact_summary",
      summary: overflowArtifacts
        .map((artifact) => `${artifact.id}:${truncateText(artifact.summary, 80)}`)
        .join(" | "),
      storage_mode: "inline",
      read_mode: "inline_preview",
      content: undefined,
      inline_preview: overflowArtifacts
        .map((artifact) => truncateText(artifact.summary, 60))
        .join(" | "),
      kind: "intermediate_summary",
    });
  }

  const compacted: TodoExecutionContext = {
    ...context,
    input_artifacts: primaryArtifacts,
    history_summary: {
      completed_todos: context.history_summary.completed_todos.slice(-5),
      recent_logs: context.history_summary.recent_logs.slice(-5).map((entry) => ({
        ...entry,
        message: truncateText(entry.message, 180) ?? "",
      })),
      open_issues: context.history_summary.open_issues.slice(-3).map((issue) => ({
        ...issue,
        message: truncateText(issue.message, 160) ?? "",
      })),
    },
  };

  return estimateChars(compacted) <= budgetChars
    ? compacted
    : {
        ...compacted,
        input_artifacts: compacted.input_artifacts.map((artifact) => ({
          ...artifact,
          summary: truncateText(artifact.summary, 120) ?? "",
          content: truncateText(artifact.content, 600),
          inline_preview: truncateText(artifact.inline_preview, 120),
        })),
      };
}
