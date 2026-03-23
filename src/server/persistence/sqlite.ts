import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const isTest = process.env.VITEST === "true" || process.env.NODE_ENV === "test";
const defaultDbFile = isTest
  ? `agent-workflow-test-${process.pid}-${process.env.VITEST_POOL_ID ?? "0"}.sqlite`
  : "agent-workflow.sqlite";
const dbFile = resolve(process.cwd(), ".data", process.env.AGENT_WORKFLOW_DB_FILE || defaultDbFile);
mkdirSync(dirname(dbFile), { recursive: true });

const db = new DatabaseSync(dbFile);
db.exec("PRAGMA busy_timeout = 5000;");
db.exec(`
CREATE TABLE IF NOT EXISTS workspace_config (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  default_provider TEXT,
  default_model TEXT,
  default_base_url TEXT,
  default_credential_id TEXT,
  default_temperature REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS node_config (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  responsibility TEXT,
  system_prompt TEXT,
  additional_prompt TEXT,
  use_workspace_model_default INTEGER NOT NULL,
  provider TEXT,
  model TEXT,
  credential_id TEXT,
  base_url TEXT,
  output_path TEXT,
  temperature REAL,
  allow_human_input INTEGER NOT NULL,
  tool_policy TEXT,
  execution_mode TEXT NOT NULL DEFAULT 'standard',
  workspace_id TEXT,
  entry_file TEXT,
  run_command TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(run_id, node_id)
);

CREATE TABLE IF NOT EXISTS secret_credential (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  label TEXT NOT NULL,
  encrypted_value TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_document (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  owner_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  doc_type TEXT NOT NULL,
  name TEXT NOT NULL,
  format TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_definition (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  root_task_input TEXT,
  nodes_json TEXT NOT NULL,
  edges_json TEXT NOT NULL,
  tasks_json TEXT NOT NULL,
  is_example INTEGER NOT NULL,
  current_version_id TEXT,
  published_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  default_provider TEXT,
  default_model TEXT,
  default_base_url TEXT,
  default_credential_id TEXT,
  default_temperature REAL,
  project_notes TEXT,
  archived_at TEXT,
  settings_updated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_file (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  run_id TEXT,
  workflow_id TEXT,
  workflow_name TEXT,
  name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  size_bytes INTEGER,
  source_type TEXT NOT NULL,
  content_text TEXT,
  content_json TEXT,
  path_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_version (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  version_label TEXT NOT NULL,
  version_notes TEXT,
  root_task_input TEXT,
  nodes_json TEXT NOT NULL,
  edges_json TEXT NOT NULL,
  tasks_json TEXT NOT NULL,
  published_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(workflow_id, version_number)
);

CREATE TABLE IF NOT EXISTS tool_definition (
  id TEXT PRIMARY KEY,
  plugin_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  input_schema TEXT NOT NULL,
  output_schema TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_config_json TEXT NOT NULL,
  auth_requirements_json TEXT NOT NULL,
  default_timeout_ms INTEGER,
  default_max_retries INTEGER,
  default_retry_backoff_ms INTEGER,
  enabled INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_binding (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  priority INTEGER NOT NULL,
  override_config_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(scope_type, scope_id, tool_id)
);

CREATE TABLE IF NOT EXISTS tool_plugin (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  description TEXT,
  manifest_json TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_asset (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  base_url TEXT,
  credential_id TEXT,
  enabled INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_template_asset (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  template_type TEXT NOT NULL,
  description TEXT,
  content TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_template (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  root_task_input TEXT,
  nodes_json TEXT NOT NULL,
  edges_json TEXT NOT NULL,
  tasks_json TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_template (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  role TEXT NOT NULL,
  default_prompt TEXT,
  task_summary TEXT,
  responsibility_summary TEXT,
  enabled INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_asset_reference (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workflow_id, asset_type, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_node_config_run_node ON node_config(run_id, node_id);
CREATE INDEX IF NOT EXISTS idx_tool_binding_scope ON tool_binding(scope_type, scope_id);
CREATE INDEX IF NOT EXISTS idx_agent_document_owner ON agent_document(owner_type, owner_id);
CREATE INDEX IF NOT EXISTS idx_agent_document_run ON agent_document(run_id);
CREATE INDEX IF NOT EXISTS idx_workflow_version_workflow ON workflow_version(workflow_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_model_asset_updated ON model_asset(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_prompt_template_updated ON prompt_template_asset(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_template_updated ON workflow_template(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_template_updated ON agent_template(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_asset_ref_workflow ON workflow_asset_reference(workflow_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_asset_ref_asset ON workflow_asset_reference(asset_type, asset_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS run_snapshot (
  run_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  run_mode TEXT NOT NULL DEFAULT 'standard',
  name TEXT NOT NULL,
  root_task_id TEXT NOT NULL,
  workflow_id TEXT,
  workflow_version_id TEXT,
  task_input TEXT,
  memory_isolation_mode TEXT NOT NULL DEFAULT 'default',
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  output TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS run_task (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  parent_task_id TEXT,
  assigned_node_id TEXT,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run_node (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  task_id TEXT,
  parent_node_id TEXT,
  position_json TEXT,
  width REAL,
  height REAL,
  responsibility TEXT,
  task_brief TEXT,
  latest_input TEXT,
  latest_output TEXT,
  inbound_messages_json TEXT NOT NULL,
  outbound_messages_json TEXT NOT NULL,
  resolved_input TEXT,
  error TEXT,
  blocked_reason TEXT,
  execution_order INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  agent_definition_id TEXT NOT NULL,
  context_id TEXT
);

CREATE TABLE IF NOT EXISTS run_edge (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  source_node_id TEXT NOT NULL,
  target_node_id TEXT NOT NULL,
  type TEXT NOT NULL,
  condition TEXT,
  max_iterations INTEGER,
  convergence_keyword TEXT
);

CREATE TABLE IF NOT EXISTS run_message (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  from_node_id TEXT NOT NULL,
  to_node_id TEXT NOT NULL,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run_event (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  type TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  run_event_seq INTEGER,
  related_node_id TEXT,
  related_task_id TEXT,
  message TEXT NOT NULL,
  payload_json TEXT
);

CREATE TABLE IF NOT EXISTS run_agent_definition (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  system_prompt TEXT,
  responsibility TEXT,
  input_schema TEXT,
  output_schema TEXT,
  allow_human_input INTEGER NOT NULL,
  model TEXT,
  temperature REAL,
  provider TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run_agent_context (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  system_prompt TEXT,
  task_brief TEXT,
  inbound_messages_json TEXT NOT NULL,
  outbound_messages_json TEXT NOT NULL,
  resolved_input TEXT,
  human_messages_json TEXT NOT NULL,
  recent_outputs_json TEXT NOT NULL,
  latest_summary TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run_human_message (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  target_node_id TEXT NOT NULL,
  content TEXT NOT NULL,
  attachments_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS long_term_memory (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  run_id TEXT,
  workflow_id TEXT,
  node_id TEXT,
  source_type TEXT NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  summary TEXT,
  keywords_json TEXT NOT NULL,
  term_weights_json TEXT NOT NULL,
  importance REAL NOT NULL,
  access_count INTEGER NOT NULL DEFAULT 0,
  last_accessed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run_node_trace (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  role TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER,
  resolved_input TEXT,
  latest_output TEXT,
  error TEXT,
  provider TEXT,
  model TEXT,
  llm_round_count INTEGER DEFAULT 0,
  tool_call_count INTEGER DEFAULT 0,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run_prompt_trace (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  round INTEGER NOT NULL DEFAULT 0,
  provider TEXT,
  model TEXT,
  system_prompt TEXT,
  user_prompt TEXT,
  message_history_json TEXT,
  tools_json TEXT,
  completion TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  status_code INTEGER,
  error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run_tool_trace (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  round INTEGER NOT NULL DEFAULT 0,
  tool_id TEXT,
  tool_name TEXT,
  source_type TEXT,
  status TEXT NOT NULL,
  input_json TEXT,
  output_json TEXT,
  error_json TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run_state_trace (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  checkpoint TEXT NOT NULL,
  node_status TEXT,
  context_snapshot_json TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_run_node_trace_run ON run_node_trace(run_id, node_id);
CREATE INDEX IF NOT EXISTS idx_run_node_trace_exec ON run_node_trace(execution_id);
CREATE INDEX IF NOT EXISTS idx_run_prompt_trace_run ON run_prompt_trace(run_id, node_id);
CREATE INDEX IF NOT EXISTS idx_run_prompt_trace_exec ON run_prompt_trace(execution_id, round);
CREATE INDEX IF NOT EXISTS idx_run_tool_trace_run ON run_tool_trace(run_id, node_id);
CREATE INDEX IF NOT EXISTS idx_run_tool_trace_exec ON run_tool_trace(execution_id, round);
CREATE INDEX IF NOT EXISTS idx_run_state_trace_run ON run_state_trace(run_id, node_id);
CREATE INDEX IF NOT EXISTS idx_run_state_trace_exec ON run_state_trace(execution_id, checkpoint);

CREATE INDEX IF NOT EXISTS idx_run_task_run ON run_task(run_id);
CREATE INDEX IF NOT EXISTS idx_run_node_run ON run_node(run_id);
CREATE INDEX IF NOT EXISTS idx_run_edge_run ON run_edge(run_id);
CREATE INDEX IF NOT EXISTS idx_run_message_run ON run_message(run_id);
CREATE INDEX IF NOT EXISTS idx_run_event_run ON run_event(run_id);
CREATE INDEX IF NOT EXISTS idx_run_def_run ON run_agent_definition(run_id);
CREATE INDEX IF NOT EXISTS idx_run_ctx_run ON run_agent_context(run_id);
CREATE INDEX IF NOT EXISTS idx_run_ctx_node ON run_agent_context(node_id);
CREATE INDEX IF NOT EXISTS idx_run_hm_run ON run_human_message(run_id);
CREATE INDEX IF NOT EXISTS idx_ltm_scope ON long_term_memory(scope_type, scope_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ltm_run ON long_term_memory(run_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ltm_workflow ON long_term_memory(workflow_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ltm_node ON long_term_memory(node_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_file_project ON project_file(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_file_run ON project_file(run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_file_workflow ON project_file(workflow_id, created_at DESC);
`);

function hasColumn(table: string, column: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return columns.some((item) => item.name === column);
}

function safeAlter(sql: string) {
  try {
    db.exec(sql);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("duplicate column name") && !message.includes("database is locked")) {
      throw error;
    }
  }
}

if (!hasColumn("workspace_config", "default_base_url")) {
  safeAlter("ALTER TABLE workspace_config ADD COLUMN default_base_url TEXT");
}

if (!hasColumn("node_config", "output_path")) {
  safeAlter("ALTER TABLE node_config ADD COLUMN output_path TEXT");
}
if (!hasColumn("node_config", "tool_policy")) {
  safeAlter("ALTER TABLE node_config ADD COLUMN tool_policy TEXT");
}

// Legacy DB compatibility for early workflow schemas.
if (!hasColumn("workflow_definition", "root_task_input")) {
  safeAlter("ALTER TABLE workflow_definition ADD COLUMN root_task_input TEXT");
}
if (!hasColumn("workflow_definition", "is_example")) {
  safeAlter("ALTER TABLE workflow_definition ADD COLUMN is_example INTEGER NOT NULL DEFAULT 0");
}
if (!hasColumn("workflow_definition", "current_version_id")) {
  safeAlter("ALTER TABLE workflow_definition ADD COLUMN current_version_id TEXT");
}
if (!hasColumn("workflow_definition", "published_version_id")) {
  safeAlter("ALTER TABLE workflow_definition ADD COLUMN published_version_id TEXT");
}
if (!hasColumn("workflow_definition", "project_id")) {
  safeAlter("ALTER TABLE workflow_definition ADD COLUMN project_id TEXT");
}
safeAlter("CREATE INDEX IF NOT EXISTS idx_workflow_definition_project ON workflow_definition(project_id, updated_at DESC)");

if (!hasColumn("workflow_version", "version_label")) {
  safeAlter("ALTER TABLE workflow_version ADD COLUMN version_label TEXT NOT NULL DEFAULT ''");
}
if (!hasColumn("workflow_version", "version_notes")) {
  safeAlter("ALTER TABLE workflow_version ADD COLUMN version_notes TEXT");
}
if (!hasColumn("workflow_version", "root_task_input")) {
  safeAlter("ALTER TABLE workflow_version ADD COLUMN root_task_input TEXT");
}
if (!hasColumn("workflow_version", "published_at")) {
  safeAlter("ALTER TABLE workflow_version ADD COLUMN published_at TEXT");
}

if (!hasColumn("project", "default_provider")) {
  safeAlter("ALTER TABLE project ADD COLUMN default_provider TEXT");
}
if (!hasColumn("project", "default_model")) {
  safeAlter("ALTER TABLE project ADD COLUMN default_model TEXT");
}
if (!hasColumn("project", "default_base_url")) {
  safeAlter("ALTER TABLE project ADD COLUMN default_base_url TEXT");
}
if (!hasColumn("project", "default_credential_id")) {
  safeAlter("ALTER TABLE project ADD COLUMN default_credential_id TEXT");
}
if (!hasColumn("project", "default_temperature")) {
  safeAlter("ALTER TABLE project ADD COLUMN default_temperature REAL");
}
if (!hasColumn("project", "project_notes")) {
  safeAlter("ALTER TABLE project ADD COLUMN project_notes TEXT");
}
if (!hasColumn("project", "archived_at")) {
  safeAlter("ALTER TABLE project ADD COLUMN archived_at TEXT");
}
if (!hasColumn("project", "settings_updated_at")) {
  safeAlter("ALTER TABLE project ADD COLUMN settings_updated_at TEXT");
}

if (!hasColumn("run_snapshot", "run_mode")) {
  safeAlter("ALTER TABLE run_snapshot ADD COLUMN run_mode TEXT NOT NULL DEFAULT 'standard'");
}
if (!hasColumn("run_snapshot", "workflow_id")) {
  safeAlter("ALTER TABLE run_snapshot ADD COLUMN workflow_id TEXT");
}
if (!hasColumn("run_snapshot", "workflow_version_id")) {
  safeAlter("ALTER TABLE run_snapshot ADD COLUMN workflow_version_id TEXT");
}
if (!hasColumn("run_snapshot", "task_input")) {
  safeAlter("ALTER TABLE run_snapshot ADD COLUMN task_input TEXT");
}
if (!hasColumn("run_snapshot", "memory_isolation_mode")) {
  safeAlter("ALTER TABLE run_snapshot ADD COLUMN memory_isolation_mode TEXT NOT NULL DEFAULT 'default'");
}

if (!hasColumn("tool_definition", "plugin_id")) {
  safeAlter("ALTER TABLE tool_definition ADD COLUMN plugin_id TEXT");
}
safeAlter("CREATE INDEX IF NOT EXISTS idx_tool_definition_plugin ON tool_definition(plugin_id)");

if (!hasColumn("agent_template", "default_prompt")) {
  safeAlter("ALTER TABLE agent_template ADD COLUMN default_prompt TEXT");
}

if (!hasColumn("run_node", "width")) {
  safeAlter("ALTER TABLE run_node ADD COLUMN width REAL");
}
if (!hasColumn("run_node", "height")) {
  safeAlter("ALTER TABLE run_node ADD COLUMN height REAL");
}

if (!hasColumn("run_edge", "max_iterations")) {
  safeAlter("ALTER TABLE run_edge ADD COLUMN max_iterations INTEGER");
}
if (!hasColumn("run_edge", "convergence_keyword")) {
  safeAlter("ALTER TABLE run_edge ADD COLUMN convergence_keyword TEXT");
}

// Local project mode config
db.exec(`
CREATE TABLE IF NOT EXISTS local_project_config (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL UNIQUE,
  local_path TEXT NOT NULL,
  entry_file TEXT,
  run_command TEXT,
  environment_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);

// Dev Mode Agent fields on node_config
if (!hasColumn("node_config", "execution_mode")) {
  safeAlter("ALTER TABLE node_config ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'standard'");
}
if (!hasColumn("node_config", "workspace_id")) {
  safeAlter("ALTER TABLE node_config ADD COLUMN workspace_id TEXT");
}
if (!hasColumn("node_config", "entry_file")) {
  safeAlter("ALTER TABLE node_config ADD COLUMN entry_file TEXT");
}
if (!hasColumn("node_config", "run_command")) {
  safeAlter("ALTER TABLE node_config ADD COLUMN run_command TEXT");
}

// Script & Skill asset library
db.exec(`
CREATE TABLE IF NOT EXISTS script_asset (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  local_path TEXT NOT NULL,
  run_command TEXT NOT NULL,
  parameter_schema TEXT NOT NULL DEFAULT '{}',
  default_environment_id TEXT,
  enabled INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_asset (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  script_id TEXT NOT NULL,
  parameter_mapping TEXT NOT NULL DEFAULT '{}',
  output_description TEXT,
  enabled INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_binding (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(run_id, node_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_script_asset_updated ON script_asset(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_skill_asset_updated ON skill_asset(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_skill_binding_node ON skill_binding(run_id, node_id);
`);

// Dev run tracking
if (!hasColumn("run_snapshot", "run_type")) {
  safeAlter("ALTER TABLE run_snapshot ADD COLUMN run_type TEXT NOT NULL DEFAULT 'workflow_run'");
}

db.exec(`
CREATE TABLE IF NOT EXISTS dev_run_detail (
  id TEXT PRIMARY KEY,
  run_snapshot_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  entry_file TEXT,
  run_command TEXT NOT NULL,
  exit_code INTEGER,
  stdout TEXT,
  stderr TEXT,
  duration_ms INTEGER,
  environment_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dev_run_detail_snapshot ON dev_run_detail(run_snapshot_id);
`);

// ── Durable Execution: checkpoint & schedule state ──
db.exec(`
CREATE TABLE IF NOT EXISTS run_checkpoint (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  status TEXT NOT NULL,
  wave_index INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(run_id, node_id)
);

CREATE TABLE IF NOT EXISTS run_schedule_state (
  run_id TEXT PRIMARY KEY,
  dag_json TEXT NOT NULL,
  scope_json TEXT NOT NULL,
  executed_json TEXT NOT NULL,
  pending_dependencies_json TEXT NOT NULL,
  current_wave_index INTEGER NOT NULL DEFAULT 0,
  rerun_mode INTEGER NOT NULL DEFAULT 0,
  rerun_start_node_id TEXT,
  loop_state_json TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_run_checkpoint_run ON run_checkpoint(run_id, wave_index);
CREATE INDEX IF NOT EXISTS idx_run_schedule_state_status ON run_schedule_state(status);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS run_replay_link (
  id TEXT PRIMARY KEY,
  baseline_run_id TEXT NOT NULL,
  replay_run_id TEXT NOT NULL UNIQUE,
  replay_mode TEXT NOT NULL,
  replay_node_id TEXT,
  include_downstream INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run_compare_report (
  id TEXT PRIMARY KEY,
  baseline_run_id TEXT NOT NULL,
  candidate_run_id TEXT NOT NULL,
  report_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(baseline_run_id, candidate_run_id)
);

CREATE INDEX IF NOT EXISTS idx_run_replay_link_baseline ON run_replay_link(baseline_run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_run_compare_report_baseline ON run_compare_report(baseline_run_id, updated_at DESC);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS evaluation_suite (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  workflow_id TEXT,
  workflow_version_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evaluation_case (
  id TEXT PRIMARY KEY,
  suite_id TEXT NOT NULL,
  name TEXT NOT NULL,
  task_input TEXT NOT NULL,
  replay_mode TEXT NOT NULL DEFAULT 'full',
  expected_output_contains TEXT,
  expected_output_regex TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evaluation_run (
  id TEXT PRIMARY KEY,
  suite_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  baseline_run_id TEXT,
  replay_run_id TEXT,
  status TEXT NOT NULL,
  score REAL,
  verdict TEXT,
  report_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_evaluation_case_suite ON evaluation_case(suite_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_evaluation_run_suite ON evaluation_run(suite_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_evaluation_run_case ON evaluation_run(case_id, created_at DESC);
`);

// ── Agent autonomy: reflection + tool rounds config ──
if (!hasColumn("node_config", "reflection_enabled")) {
  safeAlter("ALTER TABLE node_config ADD COLUMN reflection_enabled INTEGER NOT NULL DEFAULT 0");
}
if (!hasColumn("node_config", "max_reflection_rounds")) {
  safeAlter("ALTER TABLE node_config ADD COLUMN max_reflection_rounds INTEGER");
}
if (!hasColumn("node_config", "max_tool_rounds")) {
  safeAlter("ALTER TABLE node_config ADD COLUMN max_tool_rounds INTEGER");
}

// ── Node-level base_url override ──
if (!hasColumn("node_config", "base_url")) {
  safeAlter("ALTER TABLE node_config ADD COLUMN base_url TEXT");
}

// ── Memory system v2: embedding + memory_type + decay ──
if (!hasColumn("long_term_memory", "embedding_json")) {
  safeAlter("ALTER TABLE long_term_memory ADD COLUMN embedding_json TEXT");
}
if (!hasColumn("long_term_memory", "memory_type")) {
  safeAlter("ALTER TABLE long_term_memory ADD COLUMN memory_type TEXT NOT NULL DEFAULT 'fact'");
}
if (!hasColumn("long_term_memory", "decay_score")) {
  safeAlter("ALTER TABLE long_term_memory ADD COLUMN decay_score REAL NOT NULL DEFAULT 1.0");
}
if (!hasColumn("long_term_memory", "parent_id")) {
  safeAlter("ALTER TABLE long_term_memory ADD COLUMN parent_id TEXT");
}
if (!hasColumn("long_term_memory", "merged_into")) {
  safeAlter("ALTER TABLE long_term_memory ADD COLUMN merged_into TEXT");
}
if (!hasColumn("long_term_memory", "version")) {
  safeAlter("ALTER TABLE long_term_memory ADD COLUMN version INTEGER NOT NULL DEFAULT 1");
}
safeAlter("CREATE INDEX IF NOT EXISTS idx_ltm_memory_type ON long_term_memory(memory_type)");
safeAlter("CREATE INDEX IF NOT EXISTS idx_ltm_decay ON long_term_memory(decay_score DESC)");
safeAlter("CREATE INDEX IF NOT EXISTS idx_ltm_merged ON long_term_memory(merged_into)");

export { db };
