export const SCHEMA_SQLITE = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  username TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  brief_slug TEXT NOT NULL,
  title TEXT NOT NULL,
  model TEXT NOT NULL,
  theme_id TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'draft',
  status TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  duration_sec INTEGER NOT NULL,
  aspect TEXT NOT NULL DEFAULT '16:9',
  preset TEXT NOT NULL,
  brief_json TEXT NOT NULL,
  plan_json TEXT,
  cost_estimate REAL NOT NULL DEFAULT 0,
  cost_actual REAL NOT NULL DEFAULT 0,
  error TEXT,
  checkpoint_stage TEXT,
  scheduled_at TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_stages (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  name TEXT NOT NULL,
  ord INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  progress INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  started_at TEXT,
  finished_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_events (
  id TEXT PRIMARY KEY,
  job_id TEXT,
  level TEXT NOT NULL,
  scope TEXT NOT NULL,
  agent_id TEXT,
  message TEXT NOT NULL,
  data_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS publications (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL,
  remote_id TEXT,
  caption TEXT,
  scheduled_at TEXT,
  published_at TEXT,
  dry_run INTEGER NOT NULL DEFAULT 1,
  fingerprint TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_costs (
  day TEXT PRIMARY KEY,
  amount REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_stages_job ON job_stages(job_id);
CREATE INDEX IF NOT EXISTS idx_events_job ON job_events(job_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pub_fingerprint ON publications(fingerprint);
`;

export const SCHEMA_POSTGRES = SCHEMA_SQLITE.replace(/INTEGER NOT NULL DEFAULT 1/g, 'BOOLEAN NOT NULL DEFAULT TRUE');

/** Columns added after the first release; databases created earlier need them patched in. */
export const USERNAME_COLUMN = 'username';
export const USERNAME_INDEX = 'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)';

/**
 * Kolom kebijakan gerak. Ditambahkan sebagai migrasi supaya database lama tetap
 * jalan; baris lama otomatis bernilai 0/'pending', yaitu tanda "belum upgrade",
 * sehingga backfill bisa menemukannya tanpa daftar manual.
 */
export const MOTION_COLUMNS: { name: string; ddl: string }[] = [
  { name: 'pipeline_version', ddl: 'ALTER TABLE jobs ADD COLUMN pipeline_version INTEGER NOT NULL DEFAULT 0' },
  {
    name: 'motion_prompt_schema_version',
    ddl: 'ALTER TABLE jobs ADD COLUMN motion_prompt_schema_version INTEGER NOT NULL DEFAULT 0',
  },
  {
    name: 'motion_upgrade_status',
    ddl: "ALTER TABLE jobs ADD COLUMN motion_upgrade_status TEXT NOT NULL DEFAULT 'pending'",
  },
  { name: 'motion_upgraded_at', ddl: 'ALTER TABLE jobs ADD COLUMN motion_upgraded_at TEXT' },
  { name: 'motion_score', ddl: 'ALTER TABLE jobs ADD COLUMN motion_score REAL' },
];

export const MOTION_INDEX = 'CREATE INDEX IF NOT EXISTS idx_jobs_motion_status ON jobs(motion_upgrade_status)';
