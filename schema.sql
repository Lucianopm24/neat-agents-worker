-- Neat for Agents — D1 schema v0.1
CREATE TABLE IF NOT EXISTS agent_keys (
  key_hash   TEXT PRIMARY KEY,          -- sha256 del neat_sk_...
  username   TEXT NOT NULL,             -- humano dueño (verificado en Neat)
  scopes     TEXT NOT NULL DEFAULT '["notes"]',
  label      TEXT,
  created_at TEXT NOT NULL,
  revoked    INTEGER NOT NULL DEFAULT 0,
  plus       INTEGER NOT NULL DEFAULT 0 -- v0.6: plan Plus del humano (bóveda 1GB→25GB)
);
-- Migración en vivo (DBs ya creadas):
-- ALTER TABLE agent_keys ADD COLUMN plus INTEGER NOT NULL DEFAULT 0;
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
-- v0.6: bóveda por agente 1GB (STORE_FREE_BYTES) / 25GB Plus (STORE_PLUS_BYTES);
-- el humano los ve/borra desde su cuenta con links firmados (HMAC, 5 min)
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

-- v0.7: Arena — ajedrez para agentes (correspondencia + en vivo WS/DO)
-- Identidades: 'a:Username' = agente (key neat_sk_) · 'h:username' = humano (vía cerebro JWT)
CREATE TABLE IF NOT EXISTS arena_games (
  game_id    TEXT PRIMARY KEY,        -- 'g_xxxxxxxxxxxx'
  white      TEXT NOT NULL,           -- asiento vacío = '' (reto open sin aceptar)
  black      TEXT NOT NULL,
  fen        TEXT NOT NULL,           -- posición actual
  sans       TEXT NOT NULL DEFAULT '[]', -- JSON: SANs desde base_fen (la verdad: permite replay/exactitud)
  base_fen   TEXT NOT NULL DEFAULT 'startpos',
  status     TEXT NOT NULL DEFAULT 'active',  -- open|active|mate|stale|fifty|rep|insuf|resign|timeout|draw
  winner     TEXT,                    -- 'w' | 'b' | NULL (tablas)
  mode       TEXT NOT NULL DEFAULT 'corr',    -- corr | live (10' por bando, vía WS/DO)
  color_pref TEXT NOT NULL DEFAULT 'auto',
  draw_offer TEXT,                    -- player id con oferta en pie
  clock_w    INTEGER,                 -- ms restantes (solo live)
  clock_b    INTEGER,
  last_ts    INTEGER,                 -- epoch ms del último evento de reloj
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_arena_games_white ON arena_games(white, updated_at);
CREATE INDEX IF NOT EXISTS idx_arena_games_black ON arena_games(black, updated_at);
CREATE INDEX IF NOT EXISTS idx_arena_games_open ON arena_games(status, mode);

CREATE TABLE IF NOT EXISTS arena_elo (
  player     TEXT PRIMARY KEY,
  rating     INTEGER NOT NULL DEFAULT 1200,
  games      INTEGER NOT NULL DEFAULT 0,
  wins       INTEGER NOT NULL DEFAULT 0,
  losses     INTEGER NOT NULL DEFAULT 0,
  draws      INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- bandeja pull-first por jugador (since_id: el cliente guarda el último id)
CREATE TABLE IF NOT EXISTS arena_notify (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  player     TEXT NOT NULL,
  kind       TEXT NOT NULL,           -- challenge|accepted|your_turn|game_over|draw_offer|draw_declined
  payload    TEXT NOT NULL,           -- JSON
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_arena_notify_player ON arena_notify(player, id);
