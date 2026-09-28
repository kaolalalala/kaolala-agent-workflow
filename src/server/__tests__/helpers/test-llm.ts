import { vi } from "vitest";

export const TEST_LLM_PROVIDER = "openai";
export const TEST_LLM_MODEL = "gpt-4.1-mini";
export const TEST_LLM_BASE_URL = "https://test-llm.local/v1";

type ChatMessage = {
  role?: string;
  content?: string | Array<{ text?: string; type?: string }>;
};

const nativeFetch = globalThis.fetch?.bind(globalThis);

function flattenContent(content: ChatMessage["content"]) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((item) => item.text ?? "").join("\n");
  return "";
}

function buildChatResponse(content: string, status = 200) {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            role: "assistant",
            content,
          },
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 10,
        total_tokens: 20,
      },
    }),
    {
      status,
      headers: {
        "Content-Type": "application/json",
      },
    },
  );
}

function normalizeText(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSection(prompt: string, heading: string) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = prompt.match(new RegExp(`${escaped}\\n([\\s\\S]*?)(?=\\n## |$)`));
  return match?.[1]?.trim() ?? "";
}

function extractNumberedLines(section: string) {
  return section
    .split("\n")
    .map((line) => line.replace(/^\s*\d+\.\s*/, "").trim())
    .filter(Boolean);
}

function extractCriteria(prompt: string) {
  return extractNumberedLines(extractSection(prompt, "## Acceptance Criteria"));
}

function extractEvidence(prompt: string) {
  return extractNumberedLines(extractSection(prompt, "## Criteria Evidence Provided by Executor"));
}

function extractOpenQuestions(prompt: string) {
  return extractNumberedLines(extractSection(prompt, "## Open Questions from Executor"));
}

function extractExecutorOutput(prompt: string) {
  return extractSection(prompt, "## Executor Output");
}

function criterionSatisfied(criterion: string, outputText: string, evidence: string[]) {
  const normalizedCriterion = normalizeText(criterion);
  const normalizedOutput = normalizeText(outputText);
  const normalizedEvidence = normalizeText(evidence.join(" "));

  if (!normalizedCriterion) return normalizedOutput.length > 0 || normalizedEvidence.length > 0;
  if (normalizedOutput.includes(normalizedCriterion) || normalizedEvidence.includes(normalizedCriterion)) {
    return true;
  }

  const tokens = normalizedCriterion.split(" ").filter((token) => token.length >= 2);
  if (tokens.length === 0) {
    return normalizedOutput.includes(normalizedCriterion) || normalizedEvidence.includes(normalizedCriterion);
  }

  const hitCount = tokens.filter((token) =>
    normalizedOutput.includes(token) || normalizedEvidence.includes(token),
  ).length;

  return hitCount >= Math.max(1, Math.ceil(tokens.length * 0.6));
}

function buildPlannerTodos() {
  return JSON.stringify({
    todos: [
      {
        id: "todo_scope",
        title: "Clarify scope",
        description: "Clarify task scope, expected output, and working assumptions for execution.",
        priority: "high",
        capability_type: "planning",
        assignee: "single_executor",
        depends_on: [],
        acceptance_criteria: [
          "task scope is explicit",
          "execution assumptions are documented",
        ],
        input_refs: [],
      },
      {
        id: "todo_execute",
        title: "Execute main work",
        description: "Execute the main task and produce a concrete intermediate result.",
        priority: "high",
        capability_type: "analysis",
        assignee: "single_executor",
        depends_on: ["todo_scope"],
        acceptance_criteria: [
          "main result is produced",
          "result is structured for review",
        ],
        input_refs: [],
      },
      {
        id: "todo_deliver",
        title: "Deliver final answer",
        description: "Prepare the final user-facing answer from the validated execution result.",
        priority: "high",
        capability_type: "writing",
        assignee: "single_executor",
        depends_on: ["todo_execute"],
        acceptance_criteria: [
          "final answer is complete",
          "final answer is readable",
        ],
        input_refs: [],
      },
    ],
  });
}

function buildExecutorPayload(prompt: string) {
  const titleMatch = prompt.match(/Todo Title:\s*(.+)/);
  const criteriaMatch = prompt.match(/Acceptance Criteria:\s*(.+)/);
  const title = titleMatch?.[1]?.trim() || "todo";
  const criteria = (criteriaMatch?.[1] ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);

  return JSON.stringify({
    summary: `${title} completed successfully`,
    output: [
      `Execution result for ${title}.`,
      criteria.length > 0 ? `Satisfied criteria: ${criteria.join("; ")}` : "Satisfied all requested criteria.",
    ].join("\n"),
    criteria_evidence: criteria.length > 0 ? criteria : ["structured result produced", "ready for downstream use"],
    artifact_type: "todo_result",
    artifact_summary: `${title} artifact prepared`,
  });
}

function buildReviewPayload(prompt: string) {
  const criteria = extractCriteria(prompt);
  const evidence = extractEvidence(prompt);
  const openQuestions = extractOpenQuestions(prompt);
  const outputText = extractExecutorOutput(prompt);

  const judgments = criteria.map((criterion) => {
    const satisfied = criterionSatisfied(criterion, outputText, evidence);
    return {
      criterion,
      satisfied,
      confidence: satisfied ? 0.92 : 0.78,
      reason: satisfied
        ? "Execution output substantively satisfied the criterion."
        : "Execution output did not provide sufficient evidence for this criterion.",
    };
  });

  const missingCriteria = judgments.filter((item) => !item.satisfied).map((item) => item.criterion);
  const missingRatio = missingCriteria.length / Math.max(1, criteria.length);
  const shouldSplit = openQuestions.length >= 3 && missingCriteria.length > 0;

  const overallVerdict = shouldSplit
    ? "split"
    : missingCriteria.length === 0
      ? "pass"
      : missingRatio >= 0.6
        ? "fail"
        : "revise";

  return JSON.stringify({
    criteria_judgments: judgments,
    overall_verdict: overallVerdict,
    overall_reason:
      overallVerdict === "pass"
        ? "All acceptance criteria are satisfied."
        : overallVerdict === "split"
          ? "The todo still has multiple unresolved questions and should be decomposed."
          : overallVerdict === "revise"
            ? "Some criteria are missing but the result is recoverable with another pass."
            : "Most criteria remain unsatisfied.",
    should_split: shouldSplit,
    split_reason: shouldSplit ? "Too many unresolved questions remain for a single retry." : undefined,
  });
}

function buildRetryAnalysisPayload() {
  return JSON.stringify({
    failure_diagnosis: "Previous attempt lacked enough concrete coverage.",
    improvement_directives: [
      "Address each missing acceptance criterion explicitly.",
      "Keep the result structured and reviewable.",
    ],
    criterion_fixes: [
      {
        criterion: "all criteria",
        what_went_wrong: "Coverage was incomplete.",
        how_to_fix: "Produce direct evidence for each criterion.",
      },
    ],
  });
}

function buildCompressionPayload(prompt: string) {
  const criteria = extractCriteria(prompt);
  const outputSection = extractSection(prompt, "Original output (may be long):");
  const summaryMatch = prompt.match(/Original summary:\s*([\s\S]*?)\n\s*\nOriginal output \(may be long\):/);
  const originalSummary = summaryMatch?.[1]?.trim() || "Compressed summary prepared.";
  const compressedOutput = outputSection
    ? outputSection.slice(0, 1400).trim()
    : "Compressed output prepared.";

  return JSON.stringify({
    compressed_summary: originalSummary.slice(0, 480),
    compressed_output: compressedOutput,
    compressed_evidence: criteria.length > 0 ? criteria : ["structured output preserved"],
  });
}

function buildReplanPayload() {
  return JSON.stringify({
    action: "no_change",
    reason: "current_plan_is_sufficient",
  });
}

function buildTaskAnalysisPayload() {
  return JSON.stringify({
    taskType: "analysis",
    complexity: 3,
    subtaskCount: 2,
    parallelizable: true,
    needsReview: true,
    needsTools: false,
    domains: ["general"],
    toolsNeeded: [],
  });
}

function buildWorkflowQualityPayload(prompt: string) {
  const nodeIdMatches = Array.from(prompt.matchAll(/nodeId=(.+)/g)).map((match) => match[1].trim());
  return JSON.stringify({
    nodeScores: nodeIdMatches.map((nodeId, index) => ({
      nodeId,
      nodeName: `Node ${index + 1}`,
      nodeRole: "worker",
      relevance: 0.9,
      completeness: 0.88,
      accuracy: 0.9,
      coherence: 0.91,
      overallScore: 0.9,
      feedback: "High quality structured output.",
    })),
    aggregateScore: 0.9,
    overallFeedback: "Workflow quality is strong.",
    topologyScore: 0.87,
    collaborationScore: 0.89,
  });
}

function buildAgentQualityPayload(prompt: string) {
  const dimensions = Array.from(prompt.matchAll(/- ([a-zA-Z_]+):/g)).map((match) => match[1]);
  const dimensionMap = Object.fromEntries(dimensions.map((name) => [name, 0.9]));
  return JSON.stringify({
    dimensions: dimensionMap,
    score: 0.9,
    rationale: "The output is strong across the requested dimensions.",
  });
}

function buildSpawnerPayload(prompt: string) {
  const result: Record<string, Record<string, string>> = {};
  const slotMatches = prompt.matchAll(/"([^"]+)": \{([^}]*)\}/g);
  for (const match of slotMatches) {
    const slot = match[1];
    const body = match[2];
    const vars = Array.from(body.matchAll(/"([^"]+)": "\.\.\."/g)).map((item) => item[1]);
    result[slot] = Object.fromEntries(vars.map((name) => [name, `${slot} ${name}`]));
  }
  return JSON.stringify(result);
}

function getRequestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if ("url" in input) return input.url;
  return "";
}

function buildDefaultResponse(combinedText: string) {
  if (combinedText.includes("婢惰精瑙﹂崚鍡樻暜濞村鐦?")) {
    return new Response("simulated llm failure", { status: 500 });
  }

  if (
    combinedText.includes("Generate initial supervisor todos for a todo-driven supervisor runtime.")
    || combinedText.includes("You are a planning model. Return only strict JSON for todos.")
  ) {
    return buildChatResponse(buildPlannerTodos());
  }

  if (
    combinedText.includes("You are a single-step supervisor executor.")
    || combinedText.includes("You are a strict JSON generator.")
  ) {
    return buildChatResponse(buildExecutorPayload(combinedText));
  }

  if (
    combinedText.includes("You are a strict quality reviewer for a todo execution system.")
    || combinedText.includes("You are a strict JSON-only quality reviewer.")
  ) {
    return buildChatResponse(buildReviewPayload(combinedText));
  }

  if (
    combinedText.includes("You are a failure analysis agent for a task retry system.")
    || combinedText.includes("You are a strict JSON-only failure analysis agent.")
  ) {
    return buildChatResponse(buildRetryAnalysisPayload());
  }

  if (
    combinedText.includes("You are a strict JSON-only replanning supervisor.")
    || combinedText.includes("Hard constraints for new_todos:")
  ) {
    return buildChatResponse(buildReplanPayload());
  }

  if (combinedText.includes("You are a task analysis assistant. Return JSON only.")) {
    return buildChatResponse(buildTaskAnalysisPayload());
  }

  if (
    combinedText.includes('"worker_name": "..."')
    || combinedText.includes("workflow variable filling agent")
  ) {
    return buildChatResponse(buildSpawnerPayload(combinedText));
  }

  if (combinedText.includes("You are a strict workflow quality judge. Return valid JSON only.")) {
    return buildChatResponse(buildWorkflowQualityPayload(combinedText));
  }

  if (
    combinedText.includes("You are a result compression agent.")
    || combinedText.includes("strict JSON-only result compression agent")
  ) {
    return buildChatResponse(buildCompressionPayload(combinedText));
  }

  if (combinedText.includes("You are a strict agent output quality judge. Return valid JSON only.")) {
    return buildChatResponse(buildAgentQualityPayload(combinedText));
  }

  if (
    combinedText.includes("You are a synthesis agent.")
    || combinedText.includes("expert synthesis agent")
    || combinedText.includes("final answer")
  ) {
    return buildChatResponse("Synthesis completed successfully.");
  }

  return buildChatResponse("Task completed successfully.");
}

export function installRuntimeTestLlm() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = getRequestUrl(input);
    if (!url.startsWith(TEST_LLM_BASE_URL)) {
      if (nativeFetch) {
        return nativeFetch(input as RequestInfo, init);
      }
      throw new Error(`Unhandled fetch in test environment: ${url || "<unknown-url>"}`);
    }

    const rawBody = typeof init?.body === "string" ? init.body : "";
    const body = rawBody ? JSON.parse(rawBody) as { messages?: ChatMessage[] } : {};
    const combinedText = (body.messages ?? [])
      .map((message) => flattenContent(message.content))
      .join("\n");

    return buildDefaultResponse(combinedText);
  });
}
