-- Neat Mail Worker — tablas D1 (misma db neat-agents; ALTERs aditivos, forward-compatible)
CREATE TABLE IF NOT EXISTS mboxes (
  address    TEXT PRIMARY KEY,          -- nombre@neat.qzz.io | nombre@is-so.pro (minúsculas)
  owner      TEXT NOT NULL,             -- cuenta Neat (humano) o username de agente dueño
  source     TEXT NOT NULL DEFAULT 'seed', -- auto (login) | claim (usuario) | admin (panel) | seed (semilla)
  blocked    INTEGER NOT NULL DEFAULT 0,   -- 1 = suspendido: no entra correo y queda oculto al dueño
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mboxes_owner ON mboxes(owner);

CREATE TABLE IF NOT EXISTS mail (
  id           TEXT PRIMARY KEY,        -- m_xxxxxxxx
  address      TEXT NOT NULL,           -- destino al que llegó (buzón)
  owner        TEXT,                    -- dueño (NULL = huérfano sin buzón; se adopta al crear el buzón)
  sender       TEXT,
  subject      TEXT,
  text_body    TEXT,                    -- recortado a 128KB; NULL si >10MB
  html_body    TEXT,
  size         INTEGER,                 -- bytes totales del RAW
  has_attach   INTEGER NOT NULL DEFAULT 0,
  attach_names TEXT,                    -- JSON ["reporte.pdf", ...]
  is_read      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mail_owner ON mail(owner, is_read, created_at);

-- Migración v1 → v2 (idempotente; correr una vez sobre la db live):
-- ALTER TABLE mboxes ADD COLUMN source TEXT NOT NULL DEFAULT 'seed';
-- ALTER TABLE mboxes ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0;

-- Buzones semilla de la casa:
-- INSERT INTO mboxes (address, owner, source, created_at) VALUES ('claw@is-so.pro','Penguin','seed', datetime('now'));
-- INSERT INTO mboxes (address, owner, source, created_at) VALUES ('luciano@is-so.pro','Penguin','seed', datetime('now'));
