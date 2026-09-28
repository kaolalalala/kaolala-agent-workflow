import type { TodoItem } from "../../supervisor-runtime-state";
import { getExecutionContextRuntimeProfiles, hasRuntimeProfile, PAPER_DELIVERY_PIPELINE_PROFILE } from "../runtime-profiles";
import type { TodoExecutionContext, TodoExecutorResult, TodoReviewResult } from "../types";
import {
  buildPaperPipelineRelaxedPromptBlock,
  maybeRunPaperPipelineRelaxedReview,
} from "./paper-pipeline-relaxed";

export function buildReviewProfilePromptBlock(
  todo: TodoItem,
  context: TodoExecutionContext,
) {
  const activeProfiles = getExecutionContextRuntimeProfiles(todo, context);
  return buildPaperPipelineRelaxedPromptBlock(
    hasRuntimeProfile(activeProfiles, PAPER_DELIVERY_PIPELINE_PROFILE),
  );
}

export function runReviewProfile(
  todo: TodoItem,
  executorResult: TodoExecutorResult,
  context: TodoExecutionContext,
): TodoReviewResult | null {
  const activeProfiles = getExecutionContextRuntimeProfiles(todo, context);
  return maybeRunPaperPipelineRelaxedReview(
    todo,
    executorResult,
    context,
    hasRuntimeProfile(activeProfiles, PAPER_DELIVERY_PIPELINE_PROFILE),
  );
}
