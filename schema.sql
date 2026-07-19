-- Neat for Agents — D1 schema v0.1
CREATE TABLE IF NOT EXISTS agent_keys (
  key_hash   TEXT PRIMARY KEY,          -- sha256 del neat_sk_...
  username   TEXT NOT NULL,             -- humano dueño (verificado en Neat)
  scopes     TEXT NOT NULL DEFAULT '["notes"]',
  label      TEXT,
  created_at TEXT NOT NULL,
  revoked    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_agent_keys_user ON agent_keys(username);

CREATE TABLE IF NOT EXISTS usage_daily (
  key_hash TEXT NOT NULL,
  day      TEXT NOT NULL,               -- '2026-07-18' (UTC)
  count    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key_hash, day)
);
-- Limpieza opcional: borrar filas con day < hoy-2 (cron futuro)

CREATE TABLE IF NOT EXISTS idem (
  key_hash   TEXT NOT NULL,
  idem_key   TEXT NOT NULL,
  note_id    TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (key_hash, idem_key)
);

-- v0.3: scratch clave-valor del agente (reino D1, separado de Notes/Mongo)
CREATE TABLE IF NOT EXISTS agent_kv (
  key_hash   TEXT NOT NULL,
  kv_key     TEXT NOT NULL,
  kv_value   TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (key_hash, kv_key)
);

-- v0.5 R3: artefactos (archivos ≤20MB vía Telegram storage; metadata en D1)
CREATE TABLE IF NOT EXISTS agent_artifacts (
  artifact_id         TEXT PRIMARY KEY,
  key_hash            TEXT NOT NULL,
  filename            TEXT NOT NULL,
  mime                TEXT NOT NULL,
  size                INTEGER NOT NULL,
  telegram_file_id    TEXT NOT NULL,
  telegram_message_id INTEGER,
  created_at          TEXT NOT NULL
);
