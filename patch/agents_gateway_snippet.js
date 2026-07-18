// ═══════════════════════════════════════════════════════════════════
// AGENTES — gateway agents.neat.qzz.io (v0)
// INSTRUCCIONES: pegar este bloque en neat-apps-b/index.js (al final,
// antes de app.listen). Es 100% ADITIVO: no toca nada existente.
// Variables de entorno requeridas en Vercel:
//   NEAT_INTERNAL_SECRET  (secreto compartido Worker↔Vercel)
//   AGENTS_WORKER_URL     (default https://agents.neat.qzz.io)
// ═══════════════════════════════════════════════════════════════════

const AGENTS_WORKER_URL = process.env.AGENTS_WORKER_URL || "https://agents.neat.qzz.io";

// Solo llamadas del Worker con el secreto interno. FAIL-CLOSED: si el
// secreto no está configurado en Vercel, NIEGA TODO (no modo abierto).
function internalAuth(req, res, next) {
  const expected = process.env.NEAT_INTERNAL_SECRET;
  const got = req.headers["x-neat-internal"];
  if (!expected) return res.status(503).json({ success: false, error: { code: "NOT_CONFIGURED", message: "Gateway de agentes no configurado.", fix: "El admin debe definir NEAT_INTERNAL_SECRET en Vercel." } });
  if (!got || got !== expected) return res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Secreto interno inválido.", fix: "Este endpoint solo lo llama el gateway de agentes." } });
  next();
}
function agentUser(req) {
  const u = req.headers["x-agent-user"];
  return /^[a-zA-Z0-9_]{3,30}$/.test(u || "") ? u : null;
}

// ── Provisioning de keys (humano autenticado → Worker) ──
app.post("/agents/keys", auth, requireAuth, async (req, res) => {
  try {
    const label = (req.body?.label || "").slice(0, 60) || null;
    const r = await fetch(`${AGENTS_WORKER_URL}/admin/keys`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-neat-internal": process.env.NEAT_INTERNAL_SECRET || "" },
      body: JSON.stringify({ username: req.user.username, label }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.success) return res.status(502).json({ success: false, error: { code: "WORKER_ERROR", message: "El gateway de agentes respondió error.", fix: "Reintenta en unos segundos; si persiste, revisa AGENTS_WORKER_URL y NEAT_INTERNAL_SECRET." } });
    res.status(201).json(j); // incluye la key en claro UNA sola vez — mostrar al humano y no persistir
  } catch (e) { console.error("[agents/keys]", e.message); res.status(502).json({ success: false, error: { code: "WORKER_UNREACHABLE", message: "No se pudo contactar el gateway.", fix: "Reintenta en unos segundos." } }); }
});

app.get("/agents/keys", auth, requireAuth, async (req, res) => {
  try {
    const r = await fetch(`${AGENTS_WORKER_URL}/admin/keys?username=${encodeURIComponent(req.user.username)}`, {
      headers: { "x-neat-internal": process.env.NEAT_INTERNAL_SECRET || "" },
    });
    const j = await r.json().catch(() => null);
    res.json(j || { success: false, error: { code: "WORKER_ERROR", message: "Respuesta inválida del gateway.", fix: "Reintenta." } });
  } catch { res.status(502).json({ success: false, error: { code: "WORKER_UNREACHABLE", message: "No se pudo contactar el gateway.", fix: "Reintenta en unos segundos." } }); }
});

app.delete("/agents/keys/:id", auth, requireAuth, async (req, res) => {
  try {
    const r = await fetch(`${AGENTS_WORKER_URL}/admin/keys/${encodeURIComponent(req.params.id)}`, {
      method: "DELETE",
      headers: { "x-neat-internal": process.env.NEAT_INTERNAL_SECRET || "" },
    });
    const j = await r.json().catch(() => null);
    res.json(j || { success: false, error: { code: "WORKER_ERROR", message: "Respuesta inválida del gateway.", fix: "Reintenta." } });
  } catch { res.status(502).json({ success: false, error: { code: "WORKER_UNREACHABLE", message: "No se pudo contactar el gateway.", fix: "Reintenta en unos segundos." } }); }
});

// ── Datos internos (SOLO el Worker: internalAuth + X-Agent-User) ──
// Notas de agentes nacen visibility=private, marcadas con via:'agent'.

app.post("/agents/internal/notes", internalAuth, async (req, res) => {
  try {
    const username = agentUser(req);
    if (!username) return res.status(400).json({ success: false, error: { code: "BAD_AGENT_USER", message: "X-Agent-User inválido.", fix: "Header requerido, 3-30 chars alfanumérico/_." } });
    const { title, content, visibility: vis, tags } = req.body || {};
    if (!content || typeof content !== "string") return res.status(400).json({ success: false, error: { code: "NO_CONTENT", message: "content requerido (string).", fix: "Envía {content: '...'} en Markdown." } });
    if (content.length > 65536) return res.status(413).json({ success: false, error: { code: "TOO_BIG", message: "Máximo 64 KB por nota.", fix: "Divide la nota en varias." } });

    const database = await getDb();
    let noteId = randomNoteId();
    while (await database.collection("notes").findOne({ noteId })) noteId = randomNoteId();
    const visibility = ["public", "unlisted", "private"].includes(vis) ? vis : "private";
    const note = {
      noteId, title: title || null, content,
      tags: Array.isArray(tags) ? tags.slice(0, 10).map(String) : [],
      authorUsername: username, via: "agent",
      visibility, passwordHash: null, hasPassword: false,
      history: [], createdAt: new Date(), updatedAt: new Date(),
    };
    await database.collection("notes").insertOne(note);
    res.status(201).json({ success: true, data: { noteId, title: note.title, visibility, createdAt: note.createdAt } });
  } catch (e) { console.error(e); res.status(500).json({ success: false, error: { code: "INTERNAL", message: "Error interno.", fix: "Reintenta con backoff (1s, 5s, 30s)." } }); }
});

app.get("/agents/internal/notes", internalAuth, async (req, res) => {
  try {
    const username = agentUser(req);
    if (!username) return res.status(400).json({ success: false, error: { code: "BAD_AGENT_USER", message: "X-Agent-User inválido.", fix: "Header requerido." } });
    const limit = Math.min(parseInt(req.query.limit || "20", 10) || 20, 100);
    const offset = parseInt(req.query.offset || "0", 10) || 0;
    const filter = { authorUsername: username };
    if (req.query.updated_since) {
      const since = new Date(req.query.updated_since);
      if (!isNaN(since)) filter.updatedAt = { $gt: since };
    }
    if (req.query.tag) filter.tags = String(req.query.tag);
    if (req.query.q) {
      const q = String(req.query.q).slice(0, 100);
      filter.$or = [{ title: { $regex: q, $options: "i" } }, { content: { $regex: q, $options: "i" } }];
    }
    const projection = { passwordHash: 0, history: 0 };
    if (req.query.expand !== "content") projection.content = 0;
    const database = await getDb();
    const [notes, total] = await Promise.all([
      database.collection("notes").find(filter, { projection }).sort({ updatedAt: -1 }).skip(offset).limit(limit).toArray(),
      database.collection("notes").countDocuments(filter),
    ]);
    res.json({ success: true, data: { notes, total } });
  } catch (e) { console.error(e); res.status(500).json({ success: false, error: { code: "INTERNAL", message: "Error interno.", fix: "Reintenta con backoff (1s, 5s, 30s)." } }); }
});

app.get("/agents/internal/notes/:id", internalAuth, async (req, res) => {
  try {
    const username = agentUser(req);
    if (!username) return res.status(400).json({ success: false, error: { code: "BAD_AGENT_USER", message: "X-Agent-User inválido.", fix: "Header requerido." } });
    const database = await getDb();
    const note = await database.collection("notes").findOne({ noteId: req.params.id, authorUsername: username }, { projection: { passwordHash: 0 } });
    if (!note) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Nota no encontrada.", fix: "Verifica el id; lista las tuyas con GET /api/v1/notes." } });
    const { _id, ...safe } = note;
    res.json({ success: true, data: safe });
  } catch (e) { console.error(e); res.status(500).json({ success: false, error: { code: "INTERNAL", message: "Error interno.", fix: "Reintenta con backoff." } }); }
});

app.patch("/agents/internal/notes/:id", internalAuth, async (req, res) => {
  try {
    const username = agentUser(req);
    if (!username) return res.status(400).json({ success: false, error: { code: "BAD_AGENT_USER", message: "X-Agent-User inválido.", fix: "Header requerido." } });
    const database = await getDb();
    const note = await database.collection("notes").findOne({ noteId: req.params.id, authorUsername: username });
    if (!note) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Nota no encontrada.", fix: "Verifica el id con GET /api/v1/notes." } });

    const { title, content, visibility: vis, tags } = req.body || {};
    if (content !== undefined && (typeof content !== "string" || content.length > 65536))
      return res.status(413).json({ success: false, error: { code: "TOO_BIG", message: "content debe ser string ≤64 KB.", fix: "Divide la nota." } });
    const historyEntry = { title: note.title, content: note.content, savedAt: note.updatedAt };
    const update = { updatedAt: new Date(), history: [historyEntry, ...(note.history || [])].slice(0, 2) };
    if (title !== undefined) update.title = title;
    if (content !== undefined) update.content = content;
    if (tags !== undefined) update.tags = Array.isArray(tags) ? tags.slice(0, 10).map(String) : [];
    if (vis !== undefined) {
      if (!["public", "unlisted", "private"].includes(vis))
        return res.status(400).json({ success: false, error: { code: "BAD_VISIBILITY", message: "visibility inválido.", fix: "Usa public, unlisted o private." } });
      update.visibility = vis;
    }
    await database.collection("notes").updateOne({ noteId: req.params.id }, { $set: update });
    res.json({ success: true, data: { noteId: req.params.id, updatedAt: update.updatedAt } });
  } catch (e) { console.error(e); res.status(500).json({ success: false, error: { code: "INTERNAL", message: "Error interno.", fix: "Reintenta con backoff." } }); }
});

app.delete("/agents/internal/notes/:id", internalAuth, async (req, res) => {
  try {
    const username = agentUser(req);
    if (!username) return res.status(400).json({ success: false, error: { code: "BAD_AGENT_USER", message: "X-Agent-User inválido.", fix: "Header requerido." } });
    const database = await getDb();
    const r = await database.collection("notes").deleteOne({ noteId: req.params.id, authorUsername: username });
    if (!r.deletedCount) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Nota no encontrada.", fix: "Verifica el id con GET /api/v1/notes." } });
    res.json({ success: true, tip: "Nota eliminada permanentemente." });
  } catch (e) { console.error(e); res.status(500).json({ success: false, error: { code: "INTERNAL", message: "Error interno.", fix: "Reintenta con backoff." } }); }
});
