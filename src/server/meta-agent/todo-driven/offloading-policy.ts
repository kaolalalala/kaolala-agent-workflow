import type { TodoItem, WorkspaceFileKind } from "../supervisor-runtime-state";

export type OffloadMode = "inline" | "summary_plus_file" | "structured_file";

export interface OffloadingPolicyOptions {
  inlineMaxChars?: number;
  inlinePreviewChars?: number;
  largeJsonChars?: number;
  longListItemThreshold?: number;
  fullReadMaxChars?: number;
}

export interface OffloadingDecision {
  should_offload: boolean;
  reason: string;
  offload_mode: OffloadMode;
  artifact_kind: WorkspaceFileKind;
  keep_inline_summary: boolean;
}

export interface OffloadingInput {
  content: string;
  result_type: string;
  related_todo: TodoItem;
  producer: string;
  options?: OffloadingPolicyOptions;
}

export const DEFAULT_OFFLOADING_POLICY: Required<OffloadingPolicyOptions> = {
  inlineMaxChars: 1400,
  inlinePreviewChars: 900,
  largeJsonChars: 1200,
  longListItemThreshold: 18,
  fullReadMaxChars: 4500,
};

function countListLikeItems(text: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.filter((line) => /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)).length;
}

function looksLikeJson(text: string) {
  const trimmed = text.trim();
  return (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  );
}

function inferArtifactKind(resultType: string, todo: TodoItem): WorkspaceFileKind {
  const normalized = resultType.toLowerCase();
  if (normalized.includes("tool")) return "raw_tool_result";
  if (normalized.includes("review")) return "review_notes";
  if (normalized.includes("verify")) return "verification_report";
  if (normalized.includes("merge")) return "merge_bundle";
  if (normalized.includes("final")) return "final_output";
  if (todo.capability_type === "research" || todo.capability_type === "collection") return "research_notes";
  if (todo.capability_type === "verification") return "verification_report";
  if (todo.capability_type === "merge") return "merge_bundle";
  if (todo.capability_type === "browser_ops" || todo.capability_type === "terminal_ops") return "raw_tool_result";
  return "intermediate_summary";
}

export function buildInlinePreview(content: string, options?: OffloadingPolicyOptions) {
  const limit = options?.inlinePreviewChars ?? DEFAULT_OFFLOADING_POLICY.inlinePreviewChars;
  const normalized = String(content ?? "").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit)}...(truncated)`;
}

export function decideOffload(input: OffloadingInput): OffloadingDecision {
  const options = {
    ...DEFAULT_OFFLOADING_POLICY,
    ...(input.options ?? {}),
  };
  const content = String(input.content ?? "").trim();
  const artifactKind = inferArtifactKind(input.result_type, input.related_todo);
  const listCount = countListLikeItems(content);
  const jsonLike = looksLikeJson(content);
  const contentLength = content.length;
  const normalizedType = input.result_type.toLowerCase();

  if (!content) {
    return {
      should_offload: false,
      reason: "empty_content_kept_inline",
      offload_mode: "inline",
      artifact_kind: artifactKind,
      keep_inline_summary: true,
    };
  }

  if (artifactKind === "review_notes" && contentLength <= options.inlineMaxChars * 1.2) {
    return {
      should_offload: false,
      reason: "review_feedback_should_remain_inline",
      offload_mode: "inline",
      artifact_kind: artifactKind,
      keep_inline_summary: true,
    };
  }

  if (contentLength > options.inlineMaxChars * 2) {
    return {
      should_offload: true,
      reason: "content_exceeds_hard_inline_threshold",
      offload_mode: jsonLike ? "structured_file" : "summary_plus_file",
      artifact_kind: artifactKind,
      keep_inline_summary: true,
    };
  }

  if (jsonLike && contentLength > options.largeJsonChars) {
    return {
      should_offload: true,
      reason: "large_json_result_should_be_offloaded",
      offload_mode: "structured_file",
      artifact_kind: artifactKind,
      keep_inline_summary: true,
    };
  }

  if (listCount >= options.longListItemThreshold) {
    return {
      should_offload: true,
      reason: "long_list_result_should_be_offloaded",
      offload_mode: "summary_plus_file",
      artifact_kind: artifactKind,
      keep_inline_summary: true,
    };
  }

  if (
    artifactKind === "research_notes" &&
    (contentLength > options.inlineMaxChars || normalizedType.includes("search"))
  ) {
    return {
      should_offload: true,
      reason: "research_material_should_prefer_workspace_offload",
      offload_mode: "summary_plus_file",
      artifact_kind: artifactKind,
      keep_inline_summary: true,
    };
  }

  if (artifactKind === "raw_tool_result" && contentLength > Math.floor(options.inlineMaxChars * 0.8)) {
    return {
      should_offload: true,
      reason: "raw_tool_result_should_not_stay_inline_when_large",
      offload_mode: jsonLike ? "structured_file" : "summary_plus_file",
      artifact_kind: artifactKind,
      keep_inline_summary: true,
    };
  }

  if (artifactKind === "final_output" && contentLength <= options.inlineMaxChars) {
    return {
      should_offload: false,
      reason: "compact_final_output_can_stay_inline",
      offload_mode: "inline",
      artifact_kind: artifactKind,
      keep_inline_summary: true,
    };
  }

  return {
    should_offload: false,
    reason: "content_is_small_enough_for_inline_context",
    offload_mode: "inline",
    artifact_kind: artifactKind,
    keep_inline_summary: true,
  };
}
