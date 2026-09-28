import type { TodoItem } from "../supervisor-runtime-state";
import type { DelegationBrief, TodoExecutionContext } from "./types";

export const PAPER_DELIVERY_PIPELINE_PROFILE = "paper_delivery_pipeline";

function collectProfilesFromNotes(notes?: string[]) {
  const profiles: string[] = [];
  for (const note of notes ?? []) {
    if (note.startsWith("runtime_profile:")) {
      const value = note.slice("runtime_profile:".length).trim();
      if (value) profiles.push(value);
      continue;
    }
    if (note.startsWith("runtime_profile=")) {
      const value = note.slice("runtime_profile=".length).trim();
      if (value) profiles.push(value);
    }
  }
  return profiles;
}

function dedupeProfiles(values: Array<string | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value && value.trim())).map((value) => value.trim())));
}

export function getExecutionContextRuntimeProfiles(
  todo: TodoItem,
  context: TodoExecutionContext,
) {
  return dedupeProfiles([
    ...collectProfilesFromNotes(todo.notes),
    ...((context.resource_center?.skills ?? []).map((skill) => skill.runtime_profile_id)),
  ]);
}

export function getDelegationBriefRuntimeProfiles(brief: DelegationBrief) {
  return dedupeProfiles((brief.resource_center?.skills ?? []).map((skill) => skill.runtime_profile_id));
}

export function hasRuntimeProfile(
  activeProfiles: string[],
  profileId: string,
) {
  return activeProfiles.includes(profileId);
}
