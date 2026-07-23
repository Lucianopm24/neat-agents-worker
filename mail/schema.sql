-- is-so.pro Mail Worker — tablas D1 (misma db neat-agents; ALTERs aditivos, forward-compatible)
CREATE TABLE IF NOT EXISTS mboxes (
  address    TEXT PRIMARY KEY,          -- nombre@is-so.pro (minúsculas)
  owner      TEXT NOT NULL,             -- username Neat dueño del buzón
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mboxes_owner ON mboxes(owner);

CREATE TABLE IF NOT EXISTS mail (
  id           TEXT PRIMARY KEY,        -- m_xxxxxxxx
  address      TEXT NOT NULL,           -- destino al que llegó (buzón)
  owner        TEXT,                    -- dueño (NULL = huérfano sin buzón; se conserva igual)
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

-- Buzones semilla (familia de la casa):
-- INSERT INTO mboxes (address, owner, created_at) VALUES ('claw@is-so.pro','Penguin', datetime('now'));
-- INSERT INTO mboxes (address, owner, created_at) VALUES ('luciano@is-so.pro','Penguin', datetime('now'));
