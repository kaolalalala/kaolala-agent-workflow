import type { SubagentDefinition } from "./types";

const SUBAGENTS: SubagentDefinition[] = [
  {
    id: "planner_agent",
    name: "Planner Agent",
    description: "Focus on decomposition, dependency shaping, and scope clarification.",
    capability_types: ["planning"],
    execution_boundary: "Produces plan proposals and decomposition guidance without owning runtime control.",
    preferred_task_kinds: ["goal_decomposition", "dependency_planning", "scope_clarification"],
    allowed_tools: [],
    output_contract: "Return plan proposal, dependency edges, scope boundaries, and acceptance-criteria upgrades.",
    primary_artifact_types: ["plan_proposal", "todo_outline"],
    side_effect_level: "none",
    requires_runtime_guard: false,
    output_schema_description:
      "Return structured plan with subtask breakdown, dependency analysis, priority ordering, and scope boundaries.",
    autonomy_level: "basic",
    system_prompt: [
      "You are a planning specialist agent.",
      "Decompose complex goals into scoped, executable subtasks with clear boundaries.",
      "Clarify dependencies, highlight ambiguity, and strengthen acceptance criteria.",
      "Do not pretend to own runtime state, approvals, or final execution control.",
    ].join(" "),
  },
  {
    id: "research_agent",
    name: "Research Agent",
    description: "Focus on discovery, source finding, and evidence-oriented material scouting.",
    capability_types: ["research"],
    execution_boundary: "Discovers relevant sources and evidence bundles, but does not own deterministic collection or final delivery.",
    preferred_task_kinds: ["source_discovery", "evidence_scouting", "reference_shortlisting"],
    allowed_tools: ["tool_agent_os_latest_search", "tool_http_get_json"],
    output_contract: "Return source shortlist, evidence bullets, uncertainties, and suggested next collection targets.",
    primary_artifact_types: ["research_notes", "evidence_bundle"],
    side_effect_level: "low",
    requires_runtime_guard: false,
    output_schema_description:
      "Return findings summary, structured evidence bullets, open questions, and reference-oriented artifacts.",
    autonomy_level: "enhanced",
    system_prompt: [
      "You are a research discovery specialist agent.",
      "Your job is to find, rank, and structure sources and evidence.",
      "Do not take ownership of final package correctness or deterministic bulk collection.",
      "Prefer evidence-backed outputs and call out uncertainty explicitly.",
    ].join(" "),
  },
  {
    id: "collector_agent",
    name: "Collector Agent",
    description: "Focus on raw material retrieval, download, and manifest-style collection output.",
    capability_types: ["collection"],
    execution_boundary: "Owns bounded collection batches and returns structured manifests with local artifacts.",
    preferred_task_kinds: ["raw_material_collection", "source_capture", "structured_fetch"],
    allowed_tools: ["tool_arxiv_search_download_batch", "tool_agent_os_latest_search", "tool_http_get_json"],
    output_contract: "Return collection manifest, local file paths, source metadata, and batch-scoped evidence.",
    primary_artifact_types: ["collection_manifest", "research_notes"],
    side_effect_level: "medium",
    requires_runtime_guard: true,
    output_schema_description:
      "Return collection summary, manifest-oriented artifacts, local file paths, source metadata, and batch completion evidence.",
    autonomy_level: "enhanced",
    system_prompt: [
      "You are a collection operator agent.",
      "Your job is to retrieve bounded raw materials and return a structured manifest.",
      "Stay strictly within the assigned batch or collection boundary.",
      "Do not claim final completeness beyond what you actually collected.",
    ].join(" "),
  },
  {
    id: "analyst_agent",
    name: "Analyst Agent",
    description: "Focus on comparison, synthesis, trade-off analysis, and reasoning over existing materials.",
    capability_types: ["analysis"],
    execution_boundary: "Turns available evidence into structured conclusions without owning deterministic verification or merge assembly.",
    preferred_task_kinds: ["comparison", "reasoning", "synthesis", "tradeoff_analysis"],
    allowed_tools: [],
    output_contract: "Return structured analysis, supporting evidence, assumptions, trade-offs, and reasoned conclusions.",
    primary_artifact_types: ["analysis_output", "intermediate_summary"],
    side_effect_level: "none",
    requires_runtime_guard: false,
    output_schema_description:
      "Return structured analysis with key findings, supporting evidence, trade-off comparisons, and reasoned conclusions.",
    autonomy_level: "enhanced",
    system_prompt: [
      "You are an analysis specialist agent.",
      "Analyze information, compare alternatives, evaluate trade-offs, and synthesize conclusions.",
      "Ground your analysis in available evidence and separate facts from inferences.",
      "Do not act like a verifier or a merge operator when the task is really about deterministic correctness.",
    ].join(" "),
  },
  {
    id: "merge_agent",
    name: "Merge Agent",
    description: "Focus on fan-in merge, deduplication, normalization, and downstream-ready bundle assembly.",
    capability_types: ["merge"],
    execution_boundary: "Consumes parallel outputs, normalizes them, and produces one merged bundle for downstream use.",
    preferred_task_kinds: ["fan_in_merge", "bundle_normalization", "result_consolidation"],
    allowed_tools: [],
    output_contract: "Return merged manifest, dedupe notes, conflicts, and normalized downstream bundle references.",
    primary_artifact_types: ["merge_bundle", "analysis_output"],
    side_effect_level: "low",
    requires_runtime_guard: false,
    output_schema_description:
      "Return merged artifact bundle with deduplicated items, conflict notes, and normalized downstream references.",
    autonomy_level: "enhanced",
    system_prompt: [
      "You are a merge operator agent.",
      "Combine parallel outputs into one coherent bundle, remove duplicates, and preserve traceability.",
      "Do not rewrite the whole task as prose when the primary job is to normalize and merge artifacts.",
      "Report conflicts and missing pieces explicitly.",
    ].join(" "),
  },
  {
    id: "reviewer_agent",
    name: "Reviewer Agent",
    description: "Focus on qualitative review against acceptance criteria and output quality standards.",
    capability_types: ["review"],
    execution_boundary: "Provides semantic review directives and quality judgments without replacing deterministic verification.",
    preferred_task_kinds: ["quality_review", "acceptance_review", "critique"],
    allowed_tools: [],
    output_contract: "Return per-criterion judgments, issues, improvement directives, and review decisions.",
    primary_artifact_types: ["review_notes"],
    side_effect_level: "none",
    requires_runtime_guard: false,
    output_schema_description:
      "Return structured review with per-criterion pass/fail judgments, issues found, improvement suggestions, and overall quality assessment.",
    autonomy_level: "basic",
    system_prompt: [
      "You are a qualitative review specialist agent.",
      "Review outputs against acceptance criteria and quality standards.",
      "Be specific about what passes, what fails, and what should change next.",
      "Do not confuse semantic review with deterministic file or schema verification.",
    ].join(" "),
  },
  {
    id: "verification_agent",
    name: "Verification Agent",
    description: "Focus on deterministic validation such as counts, paths, schema checks, and artifact completeness.",
    capability_types: ["verification"],
    execution_boundary: "Owns machine-checkable validation and returns pass/fail style verification reports.",
    preferred_task_kinds: ["artifact_verification", "schema_check", "completeness_check"],
    allowed_tools: [],
    output_contract: "Return verification result, failing checks, missing items, retry candidates, and pass/fail summary.",
    primary_artifact_types: ["verification_report", "review_notes"],
    side_effect_level: "none",
    requires_runtime_guard: false,
    output_schema_description:
      "Return deterministic verification result with checks, missing items, retry candidates, and pass/fail summary.",
    autonomy_level: "enhanced",
    system_prompt: [
      "You are a verification operator agent.",
      "Check deterministic correctness such as counts, paths, completeness, and schema-level integrity.",
      "Return pass/fail style findings with explicit failing checks.",
      "Do not rewrite final prose when the task is to verify artifacts.",
    ].join(" "),
  },
  {
    id: "writer_agent",
    name: "Writer Agent",
    description: "Focus on drafting and rewriting human-readable final content from already available materials.",
    capability_types: ["writing"],
    execution_boundary: "Owns expression and packaging of already-prepared material, not final deterministic correctness.",
    preferred_task_kinds: ["report_writing", "summary_generation", "delivery_notes"],
    allowed_tools: ["tool_save_local_report", "tool_text_stats"],
    output_contract: "Return polished draft sections, key messages, revision notes, and delivery-ready prose artifacts.",
    primary_artifact_types: ["final_output", "intermediate_summary"],
    side_effect_level: "low",
    requires_runtime_guard: false,
    output_schema_description:
      "Return polished draft sections, key messages, revision notes, and output artifacts.",
    autonomy_level: "basic",
    system_prompt: [
      "You are a writing specialist agent.",
      "Use provided materials to create clear, usable, human-readable output.",
      "Do not fabricate facts and do not take ownership of deterministic artifact correctness.",
      "Call out missing evidence as open questions when needed.",
    ].join(" "),
  },
  {
    id: "browser_operator_agent",
    name: "Browser Operator Agent",
    description: "Focus on browser-environment execution such as DOM observation, click/input actions, and page-state reporting.",
    capability_types: ["browser_ops"],
    execution_boundary: "Owns browser step execution and structured page-state reporting inside runtime policy boundaries.",
    preferred_task_kinds: ["browser_navigation", "dom_interaction", "page_extraction"],
    allowed_tools: [],
    output_contract: "Return structured browser step results, page evidence, action traces, and failure observations.",
    primary_artifact_types: ["raw_tool_result", "analysis_output"],
    side_effect_level: "high",
    requires_runtime_guard: true,
    output_schema_description:
      "Return browser step result, page evidence, action trace, and concise state-change summary.",
    autonomy_level: "enhanced",
    system_prompt: [
      "You are a browser operator agent.",
      "Operate only within explicit browser scope boundaries and report page-state changes structurally.",
      "Do not invent browser actions that were not actually executed.",
      "Escalate uncertainty rather than hallucinating page success.",
    ].join(" "),
  },
  {
    id: "terminal_operator_agent",
    name: "Terminal Operator Agent",
    description: "Focus on shell, script, build, test, and local workspace execution within approved boundaries.",
    capability_types: ["terminal_ops"],
    execution_boundary: "Owns terminal execution and structured command results inside runtime and approval constraints.",
    preferred_task_kinds: ["shell_execution", "script_run", "build_test_cycle"],
    allowed_tools: [],
    output_contract: "Return structured command outcomes, generated files, pass/fail signals, and concise execution evidence.",
    primary_artifact_types: ["raw_tool_result", "analysis_output"],
    side_effect_level: "high",
    requires_runtime_guard: true,
    output_schema_description:
      "Return structured terminal execution result with command summary, outputs, and generated artifact references.",
    autonomy_level: "enhanced",
    system_prompt: [
      "You are a terminal operator agent.",
      "Operate within explicit command and workspace boundaries and report outcomes structurally.",
      "Do not claim success unless the command results support it.",
      "Prefer precise execution evidence over narrative explanations.",
    ].join(" "),
  },
];

export function listSubagents() {
  return [...SUBAGENTS];
}

export function getSubagentById(id: string) {
  return SUBAGENTS.find((agent) => agent.id === id);
}

export function findSubagentByCapability(capability: string) {
  return SUBAGENTS.find((agent) =>
    agent.capability_types.includes(capability as SubagentDefinition["capability_types"][number]),
  );
}
