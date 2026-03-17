import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";

const dbPath = resolve(process.cwd(), ".data", process.env.AGENT_WORKFLOW_DB_FILE || "agent-workflow.sqlite");
const db = new DatabaseSync(dbPath);

function hasTable(name) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name));
}

function hasColumn(table, column) {
  return (db.prepare(`PRAGMA table_info(${table})`).all()).some((item) => item.name === column);
}

function safeExec(sql) {
  try {
    db.exec(sql);
    console.log(`[ok] ${sql}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("duplicate column name")) {
      console.log(`[skip] ${sql} (${message})`);
      return;
    }
    throw error;
  }
}

if (!hasTable("workspace_config")) {
  safeExec(`
    CREATE TABLE workspace_config (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      default_provider TEXT,
      default_model TEXT,
      default_base_url TEXT,
      default_credential_id TEXT,
      default_temperature REAL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
}

if (!hasTable("workflow_definition")) {
  safeExec(`
    CREATE TABLE workflow_definition (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      root_task_input TEXT,
      nodes_json TEXT NOT NULL,
      edges_json TEXT NOT NULL,
      tasks_json TEXT NOT NULL,
      is_example INTEGER NOT NULL DEFAULT 0,
      current_version_id TEXT,
      published_version_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
}

if (!hasTable("workflow_version")) {
  safeExec(`
    CREATE TABLE workflow_version (
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
    )
  `);
}

if (hasTable("workspace_config") && !hasColumn("workspace_config", "default_base_url")) {
  safeExec("ALTER TABLE workspace_config ADD COLUMN default_base_url TEXT");
}

if (hasTable("workflow_definition") && !hasColumn("workflow_definition", "root_task_input")) {
  safeExec("ALTER TABLE workflow_definition ADD COLUMN root_task_input TEXT");
}
if (hasTable("workflow_definition") && !hasColumn("workflow_definition", "is_example")) {
  safeExec("ALTER TABLE workflow_definition ADD COLUMN is_example INTEGER NOT NULL DEFAULT 0");
}
if (hasTable("workflow_definition") && !hasColumn("workflow_definition", "current_version_id")) {
  safeExec("ALTER TABLE workflow_definition ADD COLUMN current_version_id TEXT");
}
if (hasTable("workflow_definition") && !hasColumn("workflow_definition", "published_version_id")) {
  safeExec("ALTER TABLE workflow_definition ADD COLUMN published_version_id TEXT");
}

if (hasTable("workflow_version") && !hasColumn("workflow_version", "version_label")) {
  safeExec("ALTER TABLE workflow_version ADD COLUMN version_label TEXT NOT NULL DEFAULT ''");
}
if (hasTable("workflow_version") && !hasColumn("workflow_version", "version_notes")) {
  safeExec("ALTER TABLE workflow_version ADD COLUMN version_notes TEXT");
}
if (hasTable("workflow_version") && !hasColumn("workflow_version", "root_task_input")) {
  safeExec("ALTER TABLE workflow_version ADD COLUMN root_task_input TEXT");
}
if (hasTable("workflow_version") && !hasColumn("workflow_version", "published_at")) {
  safeExec("ALTER TABLE workflow_version ADD COLUMN published_at TEXT");
}

safeExec("UPDATE workflow_version SET version_label = 'v' || CAST(version_number AS TEXT) WHERE COALESCE(TRIM(version_label), '') = ''");
safeExec("UPDATE workflow_definition SET is_example = 0 WHERE is_example IS NULL");

console.log(`[done] upgraded database: ${dbPath}`);
