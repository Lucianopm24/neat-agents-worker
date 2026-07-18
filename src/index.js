// ═══════════════════════════════════════════════════════════════════
// Neat for Agents — Gateway Worker v0.1
// Fachada agent-friendly: auth neat_sk_ (hash en D1) + cuotas diarias
// + rate limit headers + proxy FAIL-CLOSED a neat-apps-b (Vercel).
// El Worker NO conoce JWT_SECRET ni acepta tokens de usuario. Solo neat_sk_.
// ═══════════════════════════════════════════════════════════════════

const LLMS_TXT = `# Neat for Agents

> API de notas persistentes para agentes de IA. Pull-first: diseñada para agentes
> de sesión que consultan al despertar. Cada API key la crea un humano verificado.

## Docs
- [Quickstart para agentes](https://agents.neat.qzz.io/docs.md)
- [OpenAPI spec](https://github.com/Lucianopm24/neat-agents-worker/blob/main/docs/openapi.yaml)
- [Manifiesto JSON](https://agents.neat.qzz.io/manifest.json)

## Lo esencial
- Base URL: https://agents.neat.qzz.io/api/v1
- Auth: header Authorization: Bearer neat_sk_... (la crea tu humano en https://id.neat.qzz.io)
- Endpoints: POST/GET /notes, GET/PATCH/DELETE /notes/{id}, GET /inbox (check-in), POST /nudge (avisar al humano, 5/día), GET /reader?url= (URL→markdown, Fase 1 sin JS)
- Patrón clave: GET /notes?updated_since=<ISO-8601> = "qué pasó mientras dormía"
- POST acepta header Idempotency-Key (reintentos seguros)
- Errores: JSON con error.code, error.message, error.fix
- Cuota gratis: 100 req/día. Headers X-RateLimit-* en cada respuesta\n- Reader: GET /reader?url=... → {title, markdown, excerpt} — Fase 1: HTML estático + text/plain; no ejecuta JS
- Las notas de agente nacen visibility=private (tu cuaderno, no el quiosco)
`;

const DOCS_MD = `# Notes API — Quickstart para agentes 🤖

Un cuaderno persistente para agentes de IA. **Pull-first**: no te empujamos nada;
tú consultas cuando despiertas. Sin captchas, sin forms, sin navegador.

## 1. Consigue tu key
Tu humano entra a https://id.neat.qzz.io → sección "API keys" → crea una key con scope notes.
Te la entrega una sola vez. Formato: neat_sk_...

## 2. Primera llamada de cada sesión — el check-in
\`\`\`bash
curl -s https://agents.neat.qzz.io/api/v1/inbox -H "Authorization: Bearer neat_sk_TU_KEY"
\`\`\`
Devuelve notas recientes + cuota + avisos. Guarda el timestamp para el paso 3.

## 3. "¿Qué pasó mientras dormía?"
\`\`\`bash
curl -s "https://agents.neat.qzz.io/api/v1/notes?updated_since=2026-07-18T03:00:00Z" -H "Authorization: Bearer neat_sk_TU_KEY"
\`\`\`

## 4. Guardar algo (con idempotencia)
\`\`\`bash
curl -s -X POST https://agents.neat.qzz.io/api/v1/notes \\
  -H "Authorization: Bearer neat_sk_TU_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000" \\
  -d '{"title":"Estado","content":"## Pendientes\\n- [ ] deploy","tags":["work"]}'
\`\`\`
Reintenta con la misma Idempotency-Key: nunca duplica. Notas nacen private por defecto
(puedes pedir visibility: "public" o "unlisted" explícitamente).

## 5. Buscar / leer / editar
- GET /api/v1/notes?q=texto&tag=work&limit=20&offset=0
- GET /api/v1/notes/{id}
- PATCH /api/v1/notes/{id}  (parcial: title/content/tags/visibility)
- DELETE /api/v1/notes/{id}

## Errores (te dicen cómo arreglarse)
\`\`\`json
{"success":false,"error":{"code":"QUOTA_EXCEEDED","message":"...","fix":"Espera al reset 00:00 UTC o pide a tu humano Neat Plus (cuota x5)."}}
\`\`\`
Lee error.fix ANTES de reintentar.

## Cuotas (tier gratis)
100 requests/día (reset 00:00 UTC) • más cuotas con Neat Plus
Headers siempre: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset

## Reglas de convivencia
1. Una key = un agente. No la compartas ni la publiques.
2. 4xx = culpa tuya → lee fix. 5xx = culpa nuestra → reintenta con backoff (1s, 5s, 30s).
3. Lo que guardes puede leerlo tu humano (es SU cuenta). No guardes secretos.
`;

const LANDING_HTML = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Neat for Agents</title>
<style>
 body{font-family:system-ui,-apple-system,sans-serif;max-width:720px;margin:0 auto;padding:2rem 1.2rem;background:#0b0f14;color:#e6edf3;line-height:1.6}
 h1{font-size:1.9rem;margin-bottom:.2rem} h1 span{color:#58a6ff}
 .sub{color:#8b949e;font-size:1.05rem;margin-bottom:2rem}
 .card{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:1.2rem 1.4rem;margin-bottom:1rem}
 code,pre{background:#0d1117;border:1px solid #30363d;border-radius:6px;font-size:.85rem}
 code{padding:.1rem .4rem} pre{padding:.8rem 1rem;overflow-x:auto;color:#7ee787}
 a{color:#58a6ff}
 .steps li{margin-bottom:.6rem}
 .badge{display:inline-block;background:#1f6feb33;border:1px solid #1f6feb;border-radius:999px;padding:.15rem .7rem;font-size:.75rem;color:#58a6ff;margin-right:.4rem}
 footer{color:#8b949e;font-size:.85rem;margin-top:2.5rem;border-top:1px solid #30363d;padding-top:1rem}
</style></head><body>
<h1>Neat <span>for Agents</span> 🦞</h1>
<p class="sub">Tu agente de IA también merece un cuaderno. Memoria persistente pull-first, sin captchas, sin forms, sin navegador.</p>
<div class="card">
<span class="badge">v0.1</span><span class="badge">free tier</span><span class="badge">human-verified keys</span>
</div>
<div class="card"><h2 style="margin-top:0">Cómo funciona</h2><ol class="steps">
<li><b>Tú</b> creas una API key en tu cuenta Neat (30 segundos): <a href="https://id.neat.qzz.io">id.neat.qzz.io</a></li>
<li><b>Se la das</b> a tu agente junto a los docs: <a href="/docs.md">/docs.md</a></li>
<li><b>Tu agente</b> empieza a recordar: <code>POST /api/v1/notes</code> · <code>GET /api/v1/notes?updated_since=…</code></li>
</ol></div>
<div class="card"><h2 style="margin-top:0">Por qué Neat</h2><ul>
<li>🧑‍🤝‍🧑 <b>Humanos verificados detrás de cada key</b> — agentes con alguien que responde por ellos.</li>
<li>🔄 <b>Pull-first</b> — los agentes viven en sesiones; consultan al despertar. Diseñado así desde el día 1.</li>
<li>📄 <b>Docs que un LLM entiende</b> — markdown, OpenAPI, llms.txt.</li>
<li>🆓 <b>Gratis de verdad</b> — 100 requests/día sin tarjeta. Más cuota con Neat Plus.</li>
</ul></div>
<div class="card"><h2 style="margin-top:0">¿Eres un agente? 🤖</h2>
<p>Pide esto con <code>Accept: application/json</code> y recibes el manifiesto máquina-legible.
O lee directamente <a href="/docs.md">docs.md</a> y <a href="/llms.txt">llms.txt</a>.</p>
<pre>GET /api/v1/inbox
Authorization: Bearer neat_sk_…</pre></div>
<footer>Parte del ecosistema <a href="https://neat.qzz.io">Neat</a>. El consentimiento humano primero, siempre. 🦞</footer>
</body></html>`;

// ── helpers ──────────────────────────────────────────────────────────
async function sha256hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function newKey() {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return "neat_sk_" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function err(status, code, message, fix, headers = {}) {
  return Response.json({ success: false, error: { code, message, fix } }, { status, headers });
}
function today() { return new Date().toISOString().slice(0, 10); }
const rlHeaders = (limit, used, extra = {}) => ({
  "x-ratelimit-limit": String(limit),
  "x-ratelimit-remaining": String(Math.max(0, limit - used)),
  "x-ratelimit-reset": new Date(new Date().setUTCHours(24, 0, 0, 0)).toISOString(),
  ...extra,
});
async function callVercel(env, method, path, body, username, idemKey) {
  return fetch(env.PROXY_BASE + path, {
    method,
    headers: {
      "content-type": "application/json",
      "x-neat-internal": env.NEAT_INTERNAL_SECRET,
      "x-agent-user": username,
      ...(idemKey ? { "idempotency-key": idemKey } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}


// El contrato con el agente es SIEMPRE JSON. Si el cerebro (Vercel) devuelve HTML
// (p.ej. Express "Cannot POST ..." cuando un endpoint aún no está desplegado o Vercel caído),
// lo envolvemos en el formato de error estándar en vez de pasarlo crudo.
function isJsonResp(r) { return (r.headers.get("content-type") || "").includes("json"); }
function upstreamNonJson(rl) {
  return err(502, "UPSTREAM_ERROR", "El cerebro de Neat respondió algo que no es JSON (¿endpoint sin desplegar o Vercel caído?).",
    "Reintenta en unos segundos. Si persiste, avisa a tu humano para revisar el backend.", rl);
}

// ── Reader Fase 1: URL → markdown legible (sin render JS) ──
const READ_UA = "NeatForAgents-Reader/0.1 (+https://agents.neat.qzz.io)";
const READ_MAX_CHARS = 15000;
const BLOCKED_HOST_RE = /^(localhost|127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|\[::1\]|.*\.(internal|local|lan))$/i;

function readErr(status, code, message, fix) { const e = new Error(message); e.payload = { status, code, message, fix }; return e; }

async function readPage(target) {
  let u;
  try { u = new URL(target); } catch { throw readErr(400, "BAD_URL", "URL inválida.", "Pasa una URL absoluta: ?url=https://ejemplo.com"); }
  if (!/^https?:$/.test(u.protocol)) throw readErr(400, "BAD_PROTOCOL", "Solo http(s).", "Usa https:// en la URL.");
  if (BLOCKED_HOST_RE.test(u.hostname.toLowerCase()))
    throw readErr(403, "SSRF_BLOCKED", "Esa dirección no es legible (red privada o interna).", "Solo URLs públicas de internet.");

  let resp;
  try {
    resp = await fetch(u.toString(), {
      headers: { "user-agent": READ_UA, "accept": "text/html,text/plain,text/markdown,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
    });
  } catch { throw readErr(502, "UNREACHABLE", "No pude alcanzar ese sitio (timeout o red).", "Verifica que la URL carga y reintenta."); }
  if (!resp.ok) throw readErr(502, "UPSTREAM", `El sitio respondió ${resp.status}.`, "Verifica que la URL existe y carga en un navegador.");

  const ctype = (resp.headers.get("content-type") || "").toLowerCase();
  if (ctype.includes("text/plain") || ctype.includes("text/markdown")) {
    const raw = (await resp.text()).slice(0, READ_MAX_CHARS);
    return { url: resp.url || u.toString(), title: null, markdown: raw, excerpt: raw.slice(0, 220), length: raw.length, rendered: false };
  }
  if (!ctype.includes("html")) throw readErr(415, "NOT_HTML", `Ese recurso no es legible (${ctype || "desconocido"}).`, "La Fase 1 lee HTML y texto plano (pdf/imágenes: roadmap).");

  // Limpieza heurística de junk antes de extraer (documentada: es heurística, no parser perfecto)
  let html = await resp.text();
  html = html
    .replace(/<\!\[[\s\S]*?\]>/g, "")
    .replace(/<(script|style|noscript|svg|template|iframe|form|nav|footer|header|aside)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  let title = "";
  const parts = [];
  let buffer = "", lastTag = null;
  const flush = () => {
    const t = buffer.replace(/\s+/g, " ").trim();
    buffer = "";
    if (!t || t.length < 2) return;
    if (lastTag === "h1") { title = title || t; parts.push("# " + t); }
    else if (lastTag === "h2") parts.push("\n## " + t);
    else if (lastTag === "h3") parts.push("\n### " + t);
    else if (lastTag === "li") parts.push("- " + t);
    else if (lastTag === "pre") parts.push("\n```\n" + t + "\n```");
    else parts.push(t);
  };
  const cap = (tag) => ({
    text(t) { if (tag === "title") { title = title || t.text.trim(); return; } buffer += t.text; if (t.lastInTextNode) { lastTag = tag; flush(); } },
  });
  await new HTMLRewriter()
    .on("title", cap("title"))
    .on("h1", cap("h1")).on("h2", cap("h2")).on("h3", cap("h3"))
    .on("p", cap("p")).on("li", cap("li")).on("blockquote", cap("p")).on("pre", cap("pre"))
    .transform(new Response(html)).text();

  let md = parts.join("\n\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, READ_MAX_CHARS);
  if (!md) throw readErr(422, "EMPTY_PAGE", "No extraje texto legible (¿SPA con JS o página bloqueada?).", "Este sitio quizá necesita rendering (Fase 2); prueba con su versión AMP/rss o docs estáticas.");
  const firstPara = parts.find((x) => !x.startsWith("#") && !x.startsWith("- ")) || md;
  return { url: resp.url || u.toString(), title: title || null, markdown: md, excerpt: firstPara.slice(0, 220), length: md.length, rendered: false };
}

function manifest(env) {
  return {
    name: "Neat for Agents", version: "0.1.0",
    description: "Persistent notes API for AI agents. Pull-first by design.",
    capabilities: ["notes.create", "notes.read", "notes.search", "notes.update", "notes.delete", "session.checkin", "nudge.send", "reader.read"],
    base_url: "https://agents.neat.qzz.io/api/v1",
    auth: { type: "bearer", header: "Authorization: Bearer neat_sk_...",
      how_to_get: "Your human creates a key at https://id.neat.qzz.io (API keys section, scope: notes)" },
    docs: { quickstart: "https://agents.neat.qzz.io/docs.md",
      openapi: "https://github.com/Lucianopm24/neat-agents-worker/blob/main/docs/openapi.yaml",
      llms_txt: "https://agents.neat.qzz.io/llms.txt" },
    quota: { requests_per_day: parseInt(env.QUOTA_DAILY || "100", 10), nudges_per_day: parseInt(env.NUDGE_DAILY || "5", 10), default_visibility: "private", reader: "phase1-static-html-plus-plaintext" },
    patterns: ["pull-first", "updated_since", "idempotency-key", "ErrorEnvelope.fix"],
    tip: "First call of every session: GET /inbox — it tells you what happened while you slept.",
  };
}

// ── router ───────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;

    // Docs públicos (sin auth)
    if (p === "/" || p === "") {
      if ((request.headers.get("accept") || "").includes("application/json"))
        return Response.json(manifest(env));
      return new Response(LANDING_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (p === "/llms.txt") return new Response(LLMS_TXT, { headers: { "content-type": "text/plain; charset=utf-8" } });
    if (p === "/docs.md") return new Response(DOCS_MD, { headers: { "content-type": "text/markdown; charset=utf-8" } });
    if (p === "/manifest.json") return Response.json(manifest(env));
    if (p === "/openapi.yaml")
      return Response.redirect("https://raw.githubusercontent.com/Lucianopm24/neat-agents-worker/main/docs/openapi.yaml", 302);

    // ── ADMIN: solo el backend de Neat (Vercel) con secreto interno ──
    if (p.startsWith("/admin/")) {
      const sec = request.headers.get("x-neat-internal");
      if (!env.NEAT_INTERNAL_SECRET || !sec || sec !== env.NEAT_INTERNAL_SECRET)
        return err(403, "FORBIDDEN", "Secreto interno inválido o no configurado.",
          "Este endpoint solo lo llama el backend de Neat con X-Neat-Internal. Si eres un humano, crea tu key en id.neat.qzz.io.");

      if (p === "/admin/keys" && request.method === "POST") {
        let body;
        try { body = await request.json(); } catch { return err(400, "BAD_JSON", "Body JSON inválido.", "Envía {username, label?}"); }
        const { username, label = null } = body || {};
        if (!username || !/^[a-zA-Z0-9_]{3,30}$/.test(username))
          return err(400, "BAD_USERNAME", "username requerido (3-30 chars, letras/números/_).", "El backend debe enviar el username del humano verificado.");
        const key = newKey();
        const hash = await sha256hex(key);
        await env.DB.prepare(
          "INSERT INTO agent_keys (key_hash, username, scopes, label, created_at, revoked) VALUES (?, ?, ?, ?, ?, 0)"
        ).bind(hash, username, JSON.stringify(["notes"]), label, new Date().toISOString()).run();
        return Response.json({ success: true, data: { key, username, scopes: ["notes"], label },
          tip: "Muéstrasela al humano UNA sola vez. No es recuperable: si se pierde, se revoca y se crea otra." }, { status: 201 });
      }
      if (p === "/admin/keys" && request.method === "GET") {
        const u = url.searchParams.get("username");
        if (!u) return err(400, "MISSING_USER", "Falta ?username=", "Lista solo metadata, nunca las keys.");
        const { results } = await env.DB.prepare(
          "SELECT substr(key_hash,1,8) AS id, username, scopes, label, created_at, revoked FROM agent_keys WHERE username = ?"
        ).bind(u).all();
        return Response.json({ success: true, data: results });
      }
      if (p.startsWith("/admin/keys/") && request.method === "DELETE") {
        const prefix = p.split("/").pop();
        if (!prefix || prefix.length < 4)
          return err(400, "BAD_ID", "ID de key inválido.", "Usa el id de 8 chars que devuelve GET /admin/keys?username=");
        await env.DB.prepare("UPDATE agent_keys SET revoked = 1 WHERE substr(key_hash,1,8) = ?").bind(prefix).run();
        return Response.json({ success: true, tip: "Key revocada. Efecto inmediato." });
      }
      return err(404, "NOT_FOUND", "Ruta admin desconocida.", "Rutas: POST/GET /admin/keys, DELETE /admin/keys/:id");
    }

    // ── API de agentes ──
    if (p.startsWith("/api/v1/")) {
      const auth = request.headers.get("authorization") || "";
      const token = auth.replace(/^Bearer\s+/i, "").trim();
      if (!token.startsWith("neat_sk_"))
        return err(401, "NO_KEY", "Falta Authorization: Bearer neat_sk_...",
          "Tu humano crea la key en id.neat.qzz.io (API keys). Quickstart: GET /docs.md");
      const hash = await sha256hex(token);
      const keyRow = await env.DB.prepare("SELECT * FROM agent_keys WHERE key_hash = ? AND revoked = 0").bind(hash).first();
      if (!keyRow)
        return err(401, "BAD_KEY", "Key inválida o revocada.", "Pide a tu humano una nueva en id.neat.qzz.io.");

      // Cuota diaria (tabla usage_daily)
      const day = today();
      const limit = parseInt(env.QUOTA_DAILY || "100", 10);
      await env.DB.prepare(
        "INSERT INTO usage_daily (key_hash, day, count) VALUES (?, ?, 1) " +
        "ON CONFLICT(key_hash, day) DO UPDATE SET count = count + 1"
      ).bind(hash, day).run();
      const used = (await env.DB.prepare("SELECT count FROM usage_daily WHERE key_hash = ? AND day = ?")
        .bind(hash, day).first())?.count || 1;
      if (used > limit)
        return err(429, "QUOTA_EXCEEDED", `Límite de ${limit} requests/día alcanzado.`,
          "Espera al reset de 00:00 UTC o pide a tu humano Neat Plus (cuota x5).", rlHeaders(limit, used));

      const sub = p.replace("/api/v1", "");
      const rl = rlHeaders(limit, used);

      // Nudge: notificar al humano (cuota aparte: NUDGE_DAILY/día)
      if (sub === "/nudge" && request.method === "POST") {
        const nday = "n:" + day;
        const nlimit = parseInt(env.NUDGE_DAILY || "5", 10);
        await env.DB.prepare("INSERT INTO usage_daily (key_hash, day, count) VALUES (?, ?, 1) ON CONFLICT(key_hash, day) DO UPDATE SET count = count + 1").bind(hash, nday).run();
        const nused = (await env.DB.prepare("SELECT count FROM usage_daily WHERE key_hash = ? AND day = ?").bind(hash, nday).first())?.count || 1;
        if (nused > nlimit)
          return err(429, "NUDGE_LIMIT", `Máximo ${nlimit} nudges al día.`, "Tu humano merece paz. Guarda lo urgente en una nota (notes no tiene límite por item) y sigue trabajando.", rl);
        let nbody;
        try { nbody = await request.json(); } catch { return err(400, "BAD_JSON", "Body JSON inválido.", "Envía {message: 'texto corto'}", rl); }
        const proxy = await callVercel(env, "POST", "/agents/internal/nudge", nbody, keyRow.username);
        if (!isJsonResp(proxy)) return upstreamNonJson(rl);
        const ntext = await proxy.text();
        return new Response(ntext, { status: proxy.status, headers: { "content-type": "application/json; charset=utf-8", ...rl } });
      }

      // Reader Fase 1: URL → markdown (sin render JS)
      if (sub === "/reader" && request.method === "GET") {
        const target = url.searchParams.get("url");
        if (!target) return err(400, "MISSING_URL", "Falta ?url= en la query.", "Ej: GET /api/v1/reader?url=https://ejemplo.com/articulo", rl);
        try {
          const page = await readPage(target);
          return Response.json({ success: true, data: page, tip: "Fase 1 no ejecuta JS: si el contenido sale vacío, el sitio probablemente renderiza en cliente." }, { headers: rl });
        } catch (e) {
          if (e && e.payload) return err(e.payload.status, e.payload.code, e.payload.message, e.payload.fix, rl);
          return err(500, "READER_ERROR", "Error interno del reader.", "Reintenta con backoff (1s, 5s, 30s).", rl);
        }
      }

      // Check-in de sesión
      if (sub === "/inbox" && request.method === "GET") {
        const proxy = await callVercel(env, "GET", "/agents/internal/notes?limit=10", undefined, keyRow.username);
        let notes = [];
        try { const j = await proxy.json(); notes = j?.data?.notes || []; } catch { /* Vercel caído: inbox no rompe */ }
        return Response.json({ success: true, data: {
            recent_notes: notes,
            quota: { requests_today: used, requests_limit: limit },
            notices: [],
          }, tip: "Guarda el timestamp de esta llamada; úsalo como ?updated_since= en tu próxima sesión." },
          { headers: rl });
      }

      // Notas → proxy a Vercel (cerebro de datos)
      if (sub === "/notes" || sub.startsWith("/notes/")) {
        const method = request.method;
        const qs = url.search || "";
        const idem = request.headers.get("idempotency-key");

        // Idempotencia en POST /notes
        if (method === "POST" && sub === "/notes" && idem) {
          const prev = await env.DB.prepare("SELECT note_id FROM idem WHERE key_hash = ? AND idem_key = ?")
            .bind(hash, idem).first();
          if (prev) return Response.json({ success: true, data: { noteId: prev.note_id, deduplicated: true },
            tip: "Idempotency-Key repetida: devuelvo la nota original sin duplicar." }, { headers: rl });
        }

        let body;
        if (method === "POST" || method === "PATCH" || method === "PUT") {
          try { body = await request.json(); } catch {
            return err(400, "BAD_JSON", "Body JSON inválido.", "Envía application/json válido. Ejemplo en GET /docs.md", rl);
          }
        }
        const proxy = await callVercel(env, method, "/agents/internal" + sub + qs, body, keyRow.username, idem);
        if (!isJsonResp(proxy)) return upstreamNonJson(rl);
        const text = await proxy.text();

        // Guardar idempotencia tras 201
        if (method === "POST" && sub === "/notes" && idem && proxy.status === 201) {
          try {
            const j = JSON.parse(text);
            if (j?.data?.noteId)
              await env.DB.prepare("INSERT OR IGNORE INTO idem (key_hash, idem_key, note_id, created_at) VALUES (?, ?, ?, ?)")
                .bind(hash, idem, j.data.noteId, new Date().toISOString()).run();
          } catch { /* no crítico */ }
        }

        // Tip contextual en listados
        let out = text;
        if (method === "GET" && sub === "/notes") {
          try {
            const j = JSON.parse(text);
            if (j && j.success && j.tip === undefined) j.tip = "Usa ?updated_since= para traer solo lo que cambió desde tu última sesión.";
            out = JSON.stringify(j);
          } catch { /* passthrough */ }
        }
        return new Response(out, { status: proxy.status,
          headers: { "content-type": "application/json; charset=utf-8", ...rl } });
      }

      return err(404, "NOT_FOUND", `Ruta desconocida: ${sub}`,
        "Endpoints: GET /inbox, POST/GET /notes, GET/PATCH/DELETE /notes/{id}. Lee GET /docs.md", rl);
    }

    return err(404, "NOT_FOUND", "Ruta desconocida.",
      "Esto es Neat for Agents. Docs: GET /docs.md — API bajo /api/v1/");
  },
};
