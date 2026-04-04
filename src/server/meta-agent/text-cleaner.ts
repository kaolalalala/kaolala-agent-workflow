function stripFence(text: string) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed.replace(/^```(?:json|markdown|md|text)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

export function stripReasoningBlocks(raw: string) {
  return String(raw ?? "")
    .replace(/<think[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking[\s\S]*?<\/thinking>/gi, "")
    .trim();
}

export function sanitizeModelText(raw: string) {
  return stripReasoningBlocks(String(raw ?? "")).replace(/^\uFEFF/, "").trim();
}

export function sanitizeJsonLikeText(raw: string) {
  return stripFence(sanitizeModelText(raw));
}
