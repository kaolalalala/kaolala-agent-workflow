import type { LLMWithToolsResult } from "../../llm-helper";
import { getDelegationBriefRuntimeProfiles, hasRuntimeProfile, PAPER_DELIVERY_PIPELINE_PROFILE } from "../runtime-profiles";
import type { DelegationBrief } from "../types";
import {
  collectPaperPipelineArtifactCriteriaEvidence,
  collectPaperPipelineStructuredCriteriaEvidence,
  normalizePaperPipelineArtifacts,
  scorePaperPipelineRecoveredToolCall,
  summarizePaperPipelineRecoveredToolResult,
  type ExecutionArtifact,
} from "./paper-pipeline";

export type { ExecutionArtifact } from "./paper-pipeline";

export function collectProfileStructuredCriteriaEvidence(
  activeProfiles: string[],
  result?: Record<string, unknown> | null,
) {
  if (!hasRuntimeProfile(activeProfiles, PAPER_DELIVERY_PIPELINE_PROFILE)) {
    return [];
  }
  return collectPaperPipelineStructuredCriteriaEvidence(result);
}

export function collectProfileArtifactCriteriaEvidence(
  activeProfiles: string[],
  artifacts: ExecutionArtifact[],
) {
  if (!hasRuntimeProfile(activeProfiles, PAPER_DELIVERY_PIPELINE_PROFILE)) {
    return [];
  }
  return collectPaperPipelineArtifactCriteriaEvidence(artifacts);
}

export function summarizeRecoveredToolResultWithProfiles(
  activeProfiles: string[],
  toolName: string,
  result: Record<string, unknown>,
) {
  if (!hasRuntimeProfile(activeProfiles, PAPER_DELIVERY_PIPELINE_PROFILE)) {
    return null;
  }
  return summarizePaperPipelineRecoveredToolResult(toolName, result);
}

export function scoreRecoveredToolCallWithProfiles(
  activeProfiles: string[],
  call: LLMWithToolsResult["tool_calls_made"][number],
  index: number,
) {
  if (!hasRuntimeProfile(activeProfiles, PAPER_DELIVERY_PIPELINE_PROFILE)) {
    return null;
  }
  return scorePaperPipelineRecoveredToolCall(call, index);
}

export function normalizeArtifactsWithProfiles(
  brief: DelegationBrief,
  artifacts: ExecutionArtifact[],
) {
  const activeProfiles = getDelegationBriefRuntimeProfiles(brief);
  if (!hasRuntimeProfile(activeProfiles, PAPER_DELIVERY_PIPELINE_PROFILE)) {
    return artifacts;
  }
  return normalizePaperPipelineArtifacts(brief, artifacts);
}
