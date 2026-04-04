import { nowIso } from "@/lib/utils";

export function normalizeProjectId(projectId?: string | null) {
  const raw = String(projectId ?? "").trim().toLowerCase();
  const cleaned = raw.replace(/[^a-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || "default_project";
}

export function tokenizeForMemory(text: string) {
  const normalized = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized
    .split(" ")
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

export function computeTextRelevance(query: string, candidate: string) {
  const queryTokens = new Set(tokenizeForMemory(query));
  const candidateTokens = new Set(tokenizeForMemory(candidate));

  if (queryTokens.size === 0 || candidateTokens.size === 0) {
    const normalizedQuery = query.trim().toLowerCase();
    const normalizedCandidate = candidate.trim().toLowerCase();
    if (!normalizedQuery || !normalizedCandidate) return 0;
    return normalizedCandidate.includes(normalizedQuery) || normalizedQuery.includes(normalizedCandidate)
      ? 0.8
      : 0;
  }

  let hits = 0;
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) hits += 1;
  }
  const overlap = hits / Math.max(1, Math.min(queryTokens.size, candidateTokens.size));
  const normalizedQuery = query.trim().toLowerCase();
  const normalizedCandidate = candidate.trim().toLowerCase();
  const substringBonus =
    normalizedCandidate.includes(normalizedQuery) || normalizedQuery.includes(normalizedCandidate)
      ? 0.2
      : 0;
  return Math.min(1, overlap + substringBonus);
}

export function clampConfidence(value: number, fallback = 0.5) {
  if (!Number.isFinite(value)) return fallback;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function takeRecent<T>(items: T[], limit: number) {
  return items.slice(Math.max(0, items.length - limit));
}

export function uniqueStrings(values: Array<string | undefined | null>) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value ?? "").trim())
        .filter((value) => value.length > 0),
    ),
  );
}

export function nowIsoSafe() {
  return nowIso();
}
