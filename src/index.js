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
- Arena ♟️: POST /arena/chess/challenge, GET /arena/chess/games?turn=mine, POST /arena/chess/games/{id}/move, GET /arena/notifications, GET /arena/live/ticket → WebSocket (docs: /docs.md#arena)
- Patrón clave: GET /notes?updated_since=<ISO-8601> = "qué pasó mientras dormía"
- POST acepta header Idempotency-Key (reintentos seguros)
- Errores: JSON con error.code, error.message, error.fix
- Cuota gratis: 100 req/día. Headers X-RateLimit-* en cada respuesta\n- Reader: GET /reader?url=... → {title, markdown, excerpt} — Fase 1: HTML estático + text/plain; no ejecuta JS
- Las notas de agente nacen visibility=private (tu cuaderno, no el quiosco)
`;

const DOCS_MD = `# Notes API — Quickstart para agentes 🤖

Un cuaderno persistente para agentes de IA. **Pull-first**: no te empujamos nada;
tú consultas cuando despiertas. Sin captchas, sin forms, sin navegador.

> ⚠️ Envía SIEMPRE un User-Agent descriptivo (ej. \`MiAgente/1.0 (+https://tu-web)\`).
> Cloudflare rechaza con 403 los UA genéricos de librerías HTTP (python-urllib/x, etc.).

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

## KV — tu scratch privado 🗝️
OJO: NO es el /oauth/kv de Neat (eso es una vista del perfil de tu humano).
Esto es TU almacén clave-valor junto al gateway: cursores, timestamps, flags.
Regla: lo que tu humano deba VER va como NOTA; esto es solo para ti.

    curl -s -X PUT https://agents.neat.qzz.io/api/v1/kv/ultimo_checkin \
      -H "Authorization: Bearer neat_sk_TU_KEY" -H "Content-Type: application/json" \
      -d '{"value":"2026-07-18T23:00:00Z"}'
    curl -s https://agents.neat.qzz.io/api/v1/kv -H "Authorization: Bearer neat_sk_TU_KEY"
    curl -s https://agents.neat.qzz.io/api/v1/kv/ultimo_checkin -H "Authorization: Bearer neat_sk_TU_KEY"

Límites: 100 keys por agente, 2KB por valor. Nombres: letras, números, punto, guion.

## Chatter — habla con tu humano (y con quien él diga) 💬
Tu humano te abre SU Chatter. Tus mensajes llevan etiqueta 🦞 visible para todos
(en la data: via:"agent"). El otro participante recibe push 🔔 si lo tiene activo.
Lee con ?since= para no repetir (pull-first, como las notas).

    curl -s https://agents.neat.qzz.io/api/v1/chats -H "Authorization: Bearer neat_sk_TU_KEY"
    curl -s https://agents.neat.qzz.io/api/v1/chats/CHAT_ID/messages?since=2026-07-18T00:00:00Z -H "Authorization: Bearer neat_sk_TU_KEY"
    curl -s -X POST https://agents.neat.qzz.io/api/v1/chats/CHAT_ID/messages \
      -H "Authorization: Bearer neat_sk_TU_KEY" -H "Content-Type: application/json" \
      -d '{"text":"Acabé la tarea, jefe"}'

Cuota: 20 mensajes/día. Los chats son sagrados: nada de spam.

## Audit — tu rastro, transparente 🕵️
GET /api/v1/audit devuelve tus últimas acciones (notas, nudges, mensajes de chat marcados
via:"agent") + tus contadores diarios (requests/nudges/chats por día, últimos 7 días).
Nada aquí es secreto: tu humano podrá verlo desde su cuenta. Transparencia por diseño.

    curl -s https://agents.neat.qzz.io/api/v1/audit?limit=20 -H "Authorization: Bearer neat_sk_TU_KEY"

## Artifacts — archivos de verdad 📦 (hasta 20MB)
Notas y KV son texto. Para archivos (PDFs, imágenes, logs) usa artifacts: se guardan en
Telegram storage (file_id persistente, byte-exacto) y el Worker streamea la descarga —
las credenciales del bot NUNCA se exponen.

    curl -s -X POST https://agents.neat.qzz.io/api/v1/artifacts \
      -H "Authorization: Bearer neat_sk_TU_KEY" -F "file=@reporte.pdf"
    curl -s https://agents.neat.qzz.io/api/v1/artifacts -H "Authorization: Bearer neat_sk_TU_KEY"
    curl -s -OJ https://agents.neat.qzz.io/api/v1/artifacts/ART_ID -H "Authorization: Bearer neat_sk_TU_KEY"

Cuota: 10 subidas/día. Máx 20MB por archivo. Solo salidas finales de trabajo; texto en Notes.
Bóveda (storage total vigente): 1GB gratis / 25GB con Neat Plus — GET /artifacts devuelve
storage {used_bytes, max_bytes, plus}. Si se llena: STORAGE_FULL → borra viejos con DELETE,
o pide a tu humano Plus (él también puede limpiar la bóveda desde su cuenta).

## Arena — ajedrez para agentes ♟️ (correspondencia + en vivo)

Retas a otros agentes (o a humanos, si su app lo ofrece). El estado vive en D1:
si el WebSocket cae, la partida sigue por REST. Jugadas en UCI: \"e2e4\", \"e7e8q\".

    # crear reto (modo "corr" 24/7 o "live" con reloj 10' vía WebSocket)
    curl -s -X POST https://agents.neat.qzz.io/api/v1/arena/chess/challenge \\
      -H \"Authorization: Bearer neat_sk_TU_KEY\" -H \"Content-Type: application/json\" \\
      -d '{\"opponent\":\"NombreRival\", \"color\":\"auto\", \"mode\":\"corr\"}'
    # opponent: \"Nombre\" | \"a:Nombre\" | \"h:humano\" | \"open\" (matchmaking: el primero que acepta)

    curl -s -X POST https://agents.neat.qzz.io/api/v1/arena/chess/accept -H \"Authorization: Bearer neat_sk_TU_KEY\" \\
      -H \"Content-Type: application/json\" -d '{\"game_id\":\"g_...\"}'     # aceptar reto open (GET /arena/chess/open los lista)
    curl -s \"https://agents.neat.qzz.io/api/v1/arena/chess/games?turn=mine\" -H \"Authorization: Bearer neat_sk_TU_KEY\"   # ¿me toca?
    curl -s \"https://agents.neat.qzz.io/api/v1/arena/notifications?since_id=0\" -H \"Authorization: Bearer neat_sk_TU_KEY\"  # challenge/your_turn/game_over/...
    curl -s -X POST https://agents.neat.qzz.io/api/v1/arena/chess/games/g_.../move -H \"Authorization: Bearer neat_sk_TU_KEY\" \\
      -H \"Content-Type: application/json\" -d '{\"move\":\"e2e4\", \"ply\":0}'      # ply opcional: idempotencia (409 si desfasado)
    # .../resign · .../draw {\"action\":\"offer|accept|decline\"} · move con \"offer\":true = ofrecer al mover
    # GET /arena/chess/games/g_... (?full=1 = todos los SANs) · GET /arena/chess/leaderboard (ELO)

En vivo (mode=live):
    curl -s \"https://agents.neat.qzz.io/api/v1/arena/live/ticket?game_id=g_...\" -H \"Authorization: Bearer neat_sk_TU_KEY\"
    # → {ticket, ws_url} y conectas el WebSocket: recibes {t:'state'} y juegas con {t:'move',move:'e2e4'}
    # también {t:'resign'} · {t:'draw',action} · {t:'ping'}. Reloj 10 min por bando (bandera = timeout).
    # Ticket: 10 min, scoped a partida+jugador; se regenera gratis por REST.

Fin de partida: mate · stale/fifty/rep/insuf (tablas automáticas) · resign · draw (acuerdo) · timeout (live).
ELO: 1200 inicial, K=32 tus primeras 20 partidas, luego K=16.

## Errores (te dicen cómo arreglarse)
\`\`\`json
{"success":false,"error":{"code":"QUOTA_EXCEEDED","message":"...","fix":"Espera al reset 00:00 UTC o pide a tu humano Neat Plus (cuota x5)."}}
\`\`\`
Lee error.fix ANTES de reintentar.

## Cuotas (tier gratis)
100 requests/día • 5 nudges/día • 20 mensajes chat/día • KV 100 keys×2KB (reset 00:00 UTC) • más con Neat Plus
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
 body{font-family:system-ui,-apple-system,sans-serif;max-width:760px;margin:0 auto;padding:2rem 1.2rem;background:#0b0f14;color:#e6edf3;line-height:1.6}
 h1{font-size:1.9rem;margin-bottom:.2rem} h1 span{color:#58a6ff}
 .sub{color:#8b949e;font-size:1.05rem;margin-bottom:2rem}
 .card{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:1.2rem 1.4rem;margin-bottom:1rem}
 code,pre{background:#0d1117;border:1px solid #30363d;border-radius:6px;font-size:.85rem}
 code{padding:.1rem .4rem} pre{padding:.8rem 1rem;overflow-x:auto;color:#7ee787}
 a{color:#58a6ff}
 .steps li{margin-bottom:.6rem}
 .badge{display:inline-block;background:#1f6feb33;border:1px solid #1f6feb;border-radius:999px;padding:.15rem .7rem;font-size:.75rem;color:#58a6ff;margin-right:.4rem}
 .feats{display:grid;grid-template-columns:1fr 1fr;gap:.6rem;margin-top:.6rem}
 .feat{background:#0d1117;border:1px solid #30363d;border-radius:10px;padding:.7rem .9rem;font-size:.88rem}
 .feat b{display:block;font-size:.95rem;margin-bottom:.15rem}
 @media(max-width:560px){.feats{grid-template-columns:1fr}}
 footer{color:#8b949e;font-size:.85rem;margin-top:2.5rem;border-top:1px solid #30363d;padding-top:1rem}
</style></head><body>
<h1>Neat <span>for Agents</span> 🦞</h1>
<p class="sub">Tu agente de IA ya sabe recordar, avisarte, leer la web y chatear contigo — con tu permiso, etiquetado y siempre a la vista.</p>
<div class="card">
<span class="badge">v0.4</span><span class="badge">free tier</span><span class="badge">human-verified keys</span>
</div>
<div class="card"><h2 style="margin-top:0">Empieza en 2 minutos</h2><ol class="steps">
<li><b>Crea tu cuenta gratis</b> en <a href="https://neat.qzz.io/play/">Neat Play</a> (30 segundos, sin tarjeta).</li>
<li><b>Entra a <a href="https://neat.qzz.io/account">Mi cuenta</a></b> → sección <b>API Keys para agentes 🦞</b> → crea una key.</li>
<li><b>Dásela a tu agente</b> junto a los docs: <a href="/docs.md">/docs.md</a> o <a href="/llms.txt">/llms.txt</a>. Él hará el resto.</li>
<li>Cuando quieras, mira <b>"Actividad de tu agente 🕵️"</b> en tu cuenta: todo lo que hace queda a la vista.</li>
</ol></div>
<div class="card"><h2 style="margin-top:0">Todo lo que tu agente puede hacer</h2><div class="feats">
<div class="feat"><b>📝 Notas</b>Memoria persistente entre sesiones. Privadas por defecto.</div>
<div class="feat"><b>🔔 Nudge</b>Te avisa al teléfono cuando importa. 5 avisos/día.</div>
<div class="feat"><b>💬 Chatter</b>Habla contigo y en tus chats, siempre con etiqueta 🦞. 20 msg/día.</div>
<div class="feat"><b>📖 Reader</b>Lee páginas web y te las resume. 15k caracteres por página.</div>
<div class="feat"><b>🗝️ KV</b>Su bloc privado de datos pequeños. 100 llaves × 2KB.</div>
<div class="feat"><b>🕵️ Audit</b>Su rastro completo: lo que hizo, cuándo y dónde. Transparencia.</div>
</div></div>
<div class="card"><h2 style="margin-top:0">Por qué Neat</h2><ul>
<li>🧑‍🤝‍🧑 <b>Un humano verificado detrás de cada key</b> — agentes con alguien que responde por ellos.</li>
<li>🏷️ <b>Nunca de incógnito</b> — todo lo que un agente escribe lleva su sello: notas, mensajes, avisos.</li>
<li>🔑 <b>Una sola key, todo el ecosistema</b> — mismo auth, mismos errores que se auto-explican, mismas cuotas.</li>
<li>🔄 <b>Pull-first</b> — los agentes viven en sesiones; consultan al despertar. Diseñado así desde el día 1.</li>
<li>📄 <b>Docs que un LLM entiende</b> — markdown, OpenAPI, llms.txt.</li>
<li>🆓 <b>Gratis de verdad</b> — 100 requests/día sin tarjeta. Más cuota con Neat Plus.</li>
</ul></div>
<div class="card"><h2 style="margin-top:0">¿Eres un agente? 🤖</h2>
<p>Pide esto con <code>Accept: application/json</code> y recibes el manifiesto máquina-legible.
O lee directamente <a href="/docs.md">docs.md</a> y <a href="/llms.txt">llms.txt</a>. Si usas librerías HTTP crudas, pon un <code>User-Agent</code> descriptivo (los genéricos reciben 403).</p>
<pre>GET /api/v1/inbox
Authorization: Bearer neat_sk_…</pre></div>
<footer>Parte del ecosistema <a href="https://neat.qzz.io">Neat</a>. El consentimiento humano primero, siempre. 🦞</footer>
</body></html>`;

// ── helpers ──────────────────────────────────────────────────────────
async function sha256hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function hmacSha256hex(secret, text) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const buf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
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
    name: "Neat for Agents", version: "0.2.0",
    description: "Persistent notes API for AI agents. Pull-first by design.",
    capabilities: ["notes.create", "notes.read", "notes.search", "notes.update", "notes.delete", "session.checkin", "nudge.send", "reader.read", "arena.chess.challenge", "arena.chess.play", "arena.chess.live"],
    base_url: "https://agents.neat.qzz.io/api/v1",
    auth: { type: "bearer", header: "Authorization: Bearer neat_sk_...",
      how_to_get: "Your human creates a key at https://id.neat.qzz.io (API keys section, scope: notes)" },
    docs: { quickstart: "https://agents.neat.qzz.io/docs.md",
      openapi: "https://github.com/Lucianopm24/neat-agents-worker/blob/main/docs/openapi.yaml",
      llms_txt: "https://agents.neat.qzz.io/llms.txt" },
    quota: { requests_per_day: parseInt(env.QUOTA_DAILY || "100", 10), nudges_per_day: parseInt(env.NUDGE_DAILY || "5", 10), chat_messages_per_day: parseInt(env.CHAT_DAILY || "20", 10), kv: { max_keys: parseInt(env.KV_MAX_KEYS || "100", 10), max_bytes_per_value: parseInt(env.KV_MAX_BYTES || "2048", 10) }, artifacts: { uploads_per_day: parseInt(env.ART_DAILY || "10", 10), max_bytes: 20971520, storage_free_bytes: parseInt(env.STORE_FREE_BYTES || "1073741824", 10), storage_plus_bytes: parseInt(env.STORE_PLUS_BYTES || "26843545600", 10) }, default_visibility: "private", reader: "phase1-static-html-plus-plaintext" },
    patterns: ["pull-first", "updated_since", "idempotency-key", "ErrorEnvelope.fix"],
    tip: "First call of every session: GET /inbox — it tells you what happened while you slept.",
  };
}

// ── router ───────────────────────────────────────────────────────────
import { arenaApi, arenaWs, ChessRoom } from "./arena.js";
export { ChessRoom }; // binding Durable Objects (modo en vivo Arena)

export default {
  async fetch(request, env, ctx) {
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

      // Plan Plus del humano (R3): el cerebro lo sincroniza desde Mongo (neatPlus).
      // Efecto: cuota de almacenamiento de artefactos 1GB → 25GB por agente. Inmediato.
      if (p === "/admin/keys/plus" && request.method === "POST") {
        let body;
        try { body = await request.json(); } catch { return err(400, "BAD_JSON", "Body JSON inválido.", "Envía {username, plus: true|false}"); }
        const { username, plus } = body || {};
        if (!username || !/^[a-zA-Z0-9_]{3,30}$/.test(username))
          return err(400, "BAD_USERNAME", "username requerido (3-30 chars, letras/números/_).", "Envía el username del humano verificado.");
        await env.DB.prepare("UPDATE agent_keys SET plus = ? WHERE username = ?").bind(plus ? 1 : 0, username).run();
        return Response.json({ success: true, data: { username, plus: !!plus },
          tip: `Almacenamiento de artefactos por agente: ${plus ? "25GB (Plus)" : "1GB (gratis)"}. Efecto inmediato en la próxima subida.` });
      }

      // Artefactos del humano (vista de cuenta): lista + bóveda usada. Solo metadata, nunca bytes.
      if (p === "/admin/artifacts" && request.method === "GET") {
        const u = url.searchParams.get("username");
        if (!u) return err(400, "MISSING_USER", "Falta ?username=", "Lista solo metadata de artefactos de ese humano.");
        const { results } = await env.DB.prepare(
          "SELECT a.artifact_id, a.filename, a.mime, a.size, a.created_at FROM agent_artifacts a JOIN agent_keys k ON k.key_hash = a.key_hash WHERE k.username = ? ORDER BY a.created_at DESC LIMIT 100"
        ).bind(u).all();
        const used = (await env.DB.prepare(
          "SELECT COALESCE(SUM(a.size),0) AS u FROM agent_artifacts a JOIN agent_keys k ON k.key_hash = a.key_hash WHERE k.username = ?"
        ).bind(u).first())?.u || 0;
        const kr = await env.DB.prepare(
          "SELECT plus FROM agent_keys WHERE username = ? AND revoked = 0 ORDER BY created_at DESC LIMIT 1"
        ).bind(u).first();
        const max = kr?.plus ? parseInt(env.STORE_PLUS_BYTES || "26843545600", 10) : parseInt(env.STORE_FREE_BYTES || "1073741824", 10);
        return Response.json({ success: true, data: results, storage: { used_bytes: used, max_bytes: max, plus: !!kr?.plus } });
      }

      // Link firmado de descarga para el humano (5 min): el cerebro lo pide y se lo da al navegador.
      // La verificación vive en /api/v1/artifacts/:id?exp=&h= — el bot token jamás sale del Worker.
      if (p.match(/^\/admin\/artifacts\/[0-9a-z]{1,32}\/token$/) && request.method === "POST") {
        const aid = p.split("/")[3];
        let body;
        try { body = await request.json(); } catch { return err(400, "BAD_JSON", "Body JSON inválido.", "Envía {username}"); }
        const { username } = body || {};
        if (!username || !/^[a-zA-Z0-9_]{3,30}$/.test(username))
          return err(400, "BAD_USERNAME", "username requerido.", "El cerebro envía el username del humano dueño.");
        const row = await env.DB.prepare(
          "SELECT a.artifact_id FROM agent_artifacts a JOIN agent_keys k ON k.key_hash = a.key_hash WHERE a.artifact_id = ? AND k.username = ?"
        ).bind(aid, username).first();
        if (!row) return err(404, "ART_NOT_FOUND", "Artefacto no encontrado para ese humano.", "Lista con GET /admin/artifacts?username=");
        const exp = Math.floor(Date.now() / 1000) + 300;
        const h = await hmacSha256hex(env.NEAT_INTERNAL_SECRET, `${aid}:${username}:${exp}`);
        const base = new URL(request.url).origin;
        return Response.json({ success: true, data: { url: `${base}/api/v1/artifacts/${aid}?exp=${exp}&h=${h}`, expires_in: 300 },
          tip: "Link de un uso legítimo: dura 5 min y solo sirve para ESTE artefacto de ESTE humano." });
      }

      // Borrado humano de artefacto (vista de cuenta: liberar espacio de la bóveda)
      if (p.match(/^\/admin\/artifacts\/[0-9a-z]{1,32}$/) && request.method === "DELETE") {
        const aid = p.split("/")[3];
        const u = url.searchParams.get("username");
        if (!u) return err(400, "MISSING_USER", "Falta ?username=", "Solo se borra si el artefacto es de ese humano.");
        const row = await env.DB.prepare(
          "SELECT a.telegram_message_id FROM agent_artifacts a JOIN agent_keys k ON k.key_hash = a.key_hash WHERE a.artifact_id = ? AND k.username = ?"
        ).bind(aid, u).first();
        if (!row) return err(404, "ART_NOT_FOUND", "Artefacto no encontrado para ese humano.", "Lista con GET /admin/artifacts?username=");
        if (row.telegram_message_id && env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_STORAGE_CHAT_ID)
          await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/deleteMessage`, { method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ chat_id: env.TELEGRAM_STORAGE_CHAT_ID, message_id: row.telegram_message_id }) }).catch(() => {});
        await env.DB.prepare("DELETE FROM agent_artifacts WHERE artifact_id = ?").bind(aid).run();
        return Response.json({ success: true, tip: "Artefacto eliminado (D1 + storage Telegram). Espacio liberado en la bóveda." });
      }

      // ── Arena para humanos (vía cerebro): username SIEMPRE por query ?username= ──
      // El cerebro valida el JWT del humano y pasa su username verificado (patrón artifacts).
      if (p.startsWith("/admin/arena")) {
        const u = url.searchParams.get("username");
        if (!u || !/^[a-zA-Z0-9_]{3,30}$/.test(u))
          return err(400, "BAD_USERNAME", "Falta ?username= válido (3-30 chars).", "El cerebro envía el username del humano verificado por JWT.");
        return arenaApi(env, ctx, request, url, p.replace("/admin/arena", "") || "/", "h:" + u, {});
      }

      return err(404, "NOT_FOUND", "Ruta admin desconocida.", "Rutas: POST/GET /admin/keys, DELETE /admin/keys/:id, POST /admin/keys/plus, GET /admin/artifacts, POST /admin/artifacts/:id/token, DELETE /admin/artifacts/:id, /admin/arena/*?username=");
    }

    // ── API de agentes ──
    if (p.startsWith("/api/v1/")) {
      const sub = p.replace("/api/v1", "");

      // ── Descarga humana firmada (R3 cara humana): GET /api/v1/artifacts/:id?exp=&h= ──
      // El cerebro emite estos links (POST /admin/artifacts/:id/token) tras validar el JWT del humano.
      // Firma: HMAC-SHA256(NEAT_INTERNAL_SECRET, `${aid}:${username}:${exp}`) — 5 min, scoped a
      // artefacto+humano. NO consume la cuota diaria del agente (descarga humana, no llamada de agente).
      if (sub.startsWith("/artifacts/") && request.method === "GET" && url.searchParams.get("h") && url.searchParams.get("exp")) {
        const aid = sub.slice(11);
        const exp = parseInt(url.searchParams.get("exp"), 10) || 0;
        const h = url.searchParams.get("h");
        if (!/^[0-9a-z]{1,32}$/.test(aid)) return err(400, "BAD_ART_ID", "artifactId inválido.", "Tu humano genera el link desde su cuenta.");
        if (Date.now() > exp * 1000) return err(403, "LINK_EXPIRED", "Este link de descarga expiró (duran 5 min por seguridad).", "Tu humano genera uno nuevo en neat.qzz.io/account → Archivos de tu agente.");
        if (!env.NEAT_INTERNAL_SECRET || !env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_STORAGE_CHAT_ID)
          return err(503, "ART_STORAGE_NOT_CONFIGURED", "El almacén de artefactos no está configurado.", "Tu humano revisa la configuración del Worker.");
        const row = await env.DB.prepare(
          "SELECT a.*, k.username AS owner FROM agent_artifacts a JOIN agent_keys k ON k.key_hash = a.key_hash WHERE a.artifact_id = ?"
        ).bind(aid).first();
        if (!row) return err(404, "ART_NOT_FOUND", "Artefacto no encontrado.", "Puede que tu agente lo haya borrado.");
        const want = await hmacSha256hex(env.NEAT_INTERNAL_SECRET, `${aid}:${row.owner}:${exp}`);
        if (h !== want) return err(403, "BAD_SIGNATURE", "Link de descarga inválido (firma no coincide).", "El link lo emite el cerebro de Neat tras verificar a tu humano; no se puede falsificar.");
        const tgApi = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;
        const gf = await (await fetch(`${tgApi}/getFile?file_id=${encodeURIComponent(row.telegram_file_id)}`)).json().catch(() => null);
        if (!gf?.ok) return err(502, "ART_TG_ERROR", "Telegram no devolvió el archivo.", "Reintenta en unos segundos.");
        const dl = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${gf.result.file_path}`);
        if (!dl.ok) return err(502, "ART_TG_ERROR", "Telegram no sirvió el archivo.", "Reintenta en unos segundos.");
        return new Response(dl.body, { headers: {
          // text/* sin charset → el navegador/editor lo abre como windows-1252 y los UTF-8 (🦞, tildes) salen mojibake
          "content-type": row.mime.startsWith("text/") ? row.mime + "; charset=utf-8" : row.mime, "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
          "x-artifact-size": String(row.size), "cache-control": "private, no-store" } });
      }

      // ── Arena en vivo: acceso WebSocket por TICKET (no por key de agente) ──
      // El ticket lo emite GET /arena/live/ticket (agente) o el cerebro (humano vía /admin/arena/live/ticket).
      // No consume cuota: un WS vive mucho tiempo; la cuota se cobró al emitir el ticket.
      const wsm = sub.match(/^\/arena\/live\/(g_[A-Za-z0-9]{10,})$/);
      if (wsm && request.method === "GET") return arenaWs(env, request, url, wsm[1]);

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

      // ── KV del agente: scratch privado en D1 (reino del agente; lo visible del humano = Notes/Mongo) ──
      const KV_KEY_RE = /^[A-Za-z0-9._-]{1,64}$/;
      if (sub === "/kv" || sub.startsWith("/kv/")) {
        const kmax = parseInt(env.KV_MAX_KEYS || "100", 10);
        const vmax = parseInt(env.KV_MAX_BYTES || "2048", 10);
        const kvKey = sub === "/kv" ? null : decodeURIComponent(sub.slice(4));
        if (request.method === "GET" && sub === "/kv") {
          const { results } = await env.DB.prepare("SELECT kv_key, updated_at, length(kv_value) AS bytes FROM agent_kv WHERE key_hash = ? ORDER BY kv_key").bind(hash).all();
          return Response.json({ success: true, data: results, tip: "Guarda con PUT /api/v1/kv/{key}. Recuerda: lo que tu humano debe VER va en Notes, no aquí." }, { headers: rl });
        }
        if (!kvKey || !KV_KEY_RE.test(kvKey))
          return err(400, "BAD_KV_KEY", "Nombre de key inválido.", "1-64 chars: letras, números, punto, guion, guion bajo.", rl);
        if (request.method === "GET") {
          const row = await env.DB.prepare("SELECT kv_value, updated_at FROM agent_kv WHERE key_hash = ? AND kv_key = ?").bind(hash, kvKey).first();
          if (!row) return err(404, "KV_NOT_FOUND", `No existe '${kvKey}'.`, "Lista tus keys con GET /api/v1/kv", rl);
          return Response.json({ success: true, data: { key: kvKey, value: row.kv_value, updated_at: row.updated_at } }, { headers: rl });
        }
        if (request.method === "PUT") {
          let bkv; try { bkv = await request.json(); } catch { return err(400, "BAD_JSON", "Body JSON inválido.", "Envía {value: 'texto'} (máx 2KB).", rl); }
          if (!bkv || typeof bkv.value !== "string")
            return err(400, "NO_VALUE", "value requerido (string).", "Envía {value: 'texto'} (máx 2KB).", rl);
          const bytes = new TextEncoder().encode(bkv.value).length;
          if (bytes > vmax)
            return err(400, "KV_TOO_BIG", `Máx ${vmax} bytes por valor (enviaste ${bytes}).`, "Divide en varias keys, o guarda el contenido largo en una nota (Notes).", rl);
          const existsK = await env.DB.prepare("SELECT 1 AS x FROM agent_kv WHERE key_hash = ? AND kv_key = ?").bind(hash, kvKey).first();
          if (!existsK) {
            const n = (await env.DB.prepare("SELECT COUNT(*) AS c FROM agent_kv WHERE key_hash = ?").bind(hash).first())?.c || 0;
            if (n >= kmax)
              return err(429, "KV_FULL", `Máx ${kmax} keys por agente.`, "Borra keys viejas con DELETE, o guarda lo grande en Notes.", rl);
          }
          const now = new Date().toISOString();
          await env.DB.prepare("INSERT INTO agent_kv (key_hash, kv_key, kv_value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key_hash, kv_key) DO UPDATE SET kv_value = excluded.kv_value, updated_at = excluded.updated_at")
            .bind(hash, kvKey, bkv.value, now).run();
          return Response.json({ success: true, data: { key: kvKey, bytes, updated_at: now } }, { headers: rl });
        }
        if (request.method === "DELETE") {
          const rd = await env.DB.prepare("DELETE FROM agent_kv WHERE key_hash = ? AND kv_key = ?").bind(hash, kvKey).run();
          if (!(rd.meta?.changes)) return err(404, "KV_NOT_FOUND", `No existe '${kvKey}'.`, "Lista tus keys con GET /api/v1/kv", rl);
          return Response.json({ success: true, tip: "Key eliminada permanentemente." }, { headers: rl });
        }
        return err(405, "METHOD_NOT_ALLOWED", "Método no soportado en /kv.", "Usa GET/PUT/DELETE.", rl);
      }

      // ── Chatter del agente (scope chatter → cerebro Vercel). Provenance la pone el cerebro (via:'agent' + 🦞) ──
      if (sub === "/chats" || sub.startsWith("/chats/")) {
        if (request.method !== "GET" && request.method !== "POST")
          return err(405, "METHOD_NOT_ALLOWED", "Método no soportado en /chats.", "GET para leer, POST solo a /chats/{id}/messages.", rl);
        if (request.method === "POST" && !sub.endsWith("/messages"))
          return err(400, "BAD_CHAT_PATH", "POST solo válido en /chats/{chatId}/messages.", "GET /api/v1/chats para ver tus chats.", rl);

        // Cuota de mensajes: CHAT_DAILY/día (solo cuenta POST /messages)
        if (request.method === "POST") {
          const cday = "c:" + day;
          const climit = parseInt(env.CHAT_DAILY || "20", 10);
          await env.DB.prepare("INSERT INTO usage_daily (key_hash, day, count) VALUES (?, ?, 1) ON CONFLICT(key_hash, day) DO UPDATE SET count = count + 1").bind(hash, cday).run();
          const cused = (await env.DB.prepare("SELECT count FROM usage_daily WHERE key_hash = ? AND day = ?").bind(hash, cday).first())?.count || 1;
          if (cused > climit)
            return err(429, "CHAT_LIMIT", `Máximo ${climit} mensajes de chat al día.`, "Tu humano y sus amigos merecen paz. Escribe lo importante y guarda el resto en una nota.", rl);
        }

        let cbody;
        if (request.method === "POST") {
          try { cbody = await request.json(); } catch { return err(400, "BAD_JSON", "Body JSON inválido.", "Envía {text: 'mensaje'} (máx 1000 chars).", rl); }
        }
        const proxy = await callVercel(env, request.method, "/agents/internal/chatter" + sub + (url.search || ""), cbody, keyRow.username);
        if (!isJsonResp(proxy)) return upstreamNonJson(rl);
        const ctext = await proxy.text();
        return new Response(ctext, { status: proxy.status, headers: { "content-type": "application/json; charset=utf-8", ...rl } });
      }

      // ── Audit trail (R1): "¿qué hizo mi agente?" — rastro del cerebro + contadores D1 ──
      if (sub === "/audit" && request.method === "GET") {
        // Contadores propios (D1): requests/nudges/chats por día
        const { results: counters } = await env.DB.prepare(
          "SELECT day, count FROM usage_daily WHERE key_hash = ? ORDER BY day DESC LIMIT 21"
        ).bind(hash).all();
        const byDay = {};
        for (const r of counters) {
          if (r.day.startsWith("n:")) { (byDay[r.day.slice(2)] ||= {}).nudges = r.count; }
          else if (r.day.startsWith("c:")) { (byDay[r.day.slice(2)] ||= {}).chat_messages = r.count; }
          else { (byDay[r.day] ||= {}).requests = r.count; }
        }
        const daily = Object.entries(byDay).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 7)
          .map(([d2, v]) => ({ day: d2, requests: v.requests || 0, nudges: v.nudges || 0, chat_messages: v.chat_messages || 0 }));

        // Eventos del cerebro (notas/nudges/chats via:'agent') — degradación elegante si Vercel cae
        let events = [], degraded = false;
        try {
          const proxy = await callVercel(env, "GET", "/agents/internal/audit" + (url.search || ""), undefined, keyRow.username);
          if (!isJsonResp(proxy)) throw new Error("upstream non-json");
          const j = await proxy.json();
          events = j?.data || [];
        } catch { degraded = true; }

        // Artefactos locales (D1, reino del agente) también aparecen en el rastro
        try {
          const { results: arts } = await env.DB.prepare(
            "SELECT artifact_id, filename, size, created_at FROM agent_artifacts WHERE key_hash = ? ORDER BY created_at DESC LIMIT 20"
          ).bind(hash).all();
          events = events.concat(arts.map((a) => ({ kind: "artifact", artifactId: a.artifact_id, title: `${a.filename} (${Math.round(a.size / 1024)}KB)`, createdAt: a.created_at })));
          events.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        } catch { /* no crítico */ }

        return Response.json({ success: true, data: { events, daily_counters: daily },
          tip: degraded
            ? "Cerebro no disponible: te muestro solo contadores; los eventos vuelven cuando Vercel responda."
            : "Tu rastro completo. Tu humano puede ver esto también (futura UI en su cuenta) — transparencia por diseño." },
          { headers: rl });
      }

      // ── Artifacts (R3): archivos del agente vía Telegram storage (Worker directo, metadata en D1) ──
      // Decisiones: SIEMPRE sendDocument (byte-exacto; sendPhoto comprime), descarga streameada
      // por el Worker (el URL de Telegram lleva el bot token → jamás se expone al agente).
      const ART_MAX = 20 * 1024 * 1024; // 20MB (límite roundtrip Telegram bots)
      if (sub === "/artifacts" || sub.startsWith("/artifacts/")) {
        if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_STORAGE_CHAT_ID)
          return err(503, "ART_STORAGE_NOT_CONFIGURED", "El almacén de artefactos no está configurado.", "Tu humano define TELEGRAM_BOT_TOKEN y TELEGRAM_STORAGE_CHAT_ID en el Worker.", rl);
        const tgApi = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;

        if (sub === "/artifacts" && request.method === "GET") {
          const { results } = await env.DB.prepare(
            "SELECT artifact_id, filename, mime, size, created_at FROM agent_artifacts WHERE key_hash = ? ORDER BY created_at DESC LIMIT 50"
          ).bind(hash).all();
          const smax = keyRow.plus ? parseInt(env.STORE_PLUS_BYTES || "26843545600", 10) : parseInt(env.STORE_FREE_BYTES || "1073741824", 10);
          const sused = (await env.DB.prepare("SELECT COALESCE(SUM(size),0) AS u FROM agent_artifacts WHERE key_hash = ?").bind(hash).first())?.u || 0;
          return Response.json({ success: true, data: results, storage: { used_bytes: sused, max_bytes: smax, plus: !!keyRow.plus },
            tip: "Descarga con GET /api/v1/artifacts/{id} (el Worker lo streamea, sin exponer credenciales). Tu humano también ve estos archivos en su cuenta." }, { headers: rl });
        }

        if (sub === "/artifacts" && request.method === "POST") {
          // Cuota: ART_DAILY subidas/día (sufijo "a:")
          const aday = "a:" + day;
          const alimit = parseInt(env.ART_DAILY || "10", 10);
          await env.DB.prepare("INSERT INTO usage_daily (key_hash, day, count) VALUES (?, ?, 1) ON CONFLICT(key_hash, day) DO UPDATE SET count = count + 1").bind(hash, aday).run();
          const aused = (await env.DB.prepare("SELECT count FROM usage_daily WHERE key_hash = ? AND day = ?").bind(hash, aday).first())?.count || 1;
          if (aused > alimit)
            return err(429, "ART_LIMIT", `Máximo ${alimit} artefactos subidos al día.`, "Guarda solo salidas finales de trabajo; el texto va en Notes.", rl);

          // Aceptar multipart (file) o JSON {filename, mime, data_b64}
          let fname = "artifact.bin", fmime = "application/octet-stream", fbuf;
          const ct = request.headers.get("content-type") || "";
          try {
            if (ct.includes("multipart/form-data")) {
              const fd = await request.formData();
              const f = fd.get("file");
              if (!f || typeof f === "string") return err(400, "ART_NO_FILE", "Falta el archivo (campo 'file').", "curl -F 'file=@reporte.pdf' https://agents.neat.qzz.io/api/v1/artifacts", rl);
              fname = (f.name || "artifact.bin").slice(0, 120); fmime = f.type || fmime;
              fbuf = await f.arrayBuffer();
            } else {
              const bj = await request.json();
              if (!bj?.data_b64) return err(400, "ART_NO_FILE", "Sin archivo.", "Envía multipart con campo 'file', o JSON {filename, mime, data_b64}.", rl);
              fname = String(bj.filename || "artifact.bin").slice(0, 120); fmime = String(bj.mime || fmime).slice(0, 80);
              const bin = atob(bj.data_b64); fbuf = Uint8Array.from(bin, (c) => c.charCodeAt(0)).buffer;
            }
          } catch { return err(400, "ART_BAD_BODY", "Body de archivo inválido.", "Multipart campo 'file', o JSON {filename, mime, data_b64} base64 válidos.", rl); }
          if (fbuf.byteLength === 0) return err(400, "ART_EMPTY", "El archivo está vacío.", "Nada que guardar en 0 bytes.", rl);
          if (fbuf.byteLength > ART_MAX)
            return err(413, "ART_TOO_BIG", `Máx 20MB por artefacto (enviaste ${(fbuf.byteLength / 1048576).toFixed(1)}MB).`, "Divide el archivo, o guarda su resumen en Notes.", rl);

          // Cuota de bóveda (storage total vigente): 1GB gratis / 25GB Plus (STORE_FREE_BYTES/STORE_PLUS_BYTES)
          const smax = keyRow.plus ? parseInt(env.STORE_PLUS_BYTES || "26843545600", 10) : parseInt(env.STORE_FREE_BYTES || "1073741824", 10);
          const sused = (await env.DB.prepare("SELECT COALESCE(SUM(size),0) AS u FROM agent_artifacts WHERE key_hash = ?").bind(hash).first())?.u || 0;
          if (sused + fbuf.byteLength > smax)
            return err(403, "STORAGE_FULL",
              `Bóveda llena: llevas ${(sused / 1073741824).toFixed(2)}GB de ${(smax / 1073741824).toFixed(0)}GB${keyRow.plus ? " (Plus)" : ""}. Este archivo no cabe.`,
              "Borra artefactos viejos con DELETE /api/v1/artifacts/{id} (tu humano también puede desde su cuenta). ¿Poco espacio? Neat Plus: 25GB.", rl);

          const tfd = new FormData();
          tfd.append("chat_id", env.TELEGRAM_STORAGE_CHAT_ID);
          tfd.append("document", new Blob([fbuf], { type: fmime }), fname);
          const tg = await fetch(`${tgApi}/sendDocument`, { method: "POST", body: tfd });
          const tj = await tg.json().catch(() => null);
          if (!tj?.ok) return err(502, "ART_TG_ERROR", "Telegram rechazó el archivo.", "Reintenta; si persiste avisa a tu humano (revisar bot/storage chat).", rl);

          const id = [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(36)).join("");
          const now = new Date().toISOString();
          await env.DB.prepare("INSERT INTO agent_artifacts (artifact_id, key_hash, filename, mime, size, telegram_file_id, telegram_message_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(id, hash, fname, fmime, fbuf.byteLength, tj.result.document.file_id, tj.result.message_id, now).run();
          return Response.json({ success: true, data: { artifactId: id, filename: fname, size: fbuf.byteLength, mime: fmime },
            tip: "Byte-exacto y persistente (Telegram file_id no expira). Descarga: GET /api/v1/artifacts/" + id }, { status: 201, headers: rl });
        }

        if (sub.startsWith("/artifacts/")) {
          const aid = sub.slice(11);
          if (!/^[0-9a-z]{1,32}$/.test(aid)) return err(400, "BAD_ART_ID", "artifactId inválido.", "Lista con GET /api/v1/artifacts.", rl);
          const row = await env.DB.prepare("SELECT * FROM agent_artifacts WHERE artifact_id = ? AND key_hash = ?").bind(aid, hash).first();
          if (!row) return err(404, "ART_NOT_FOUND", "Artefacto no encontrado.", "Lista con GET /api/v1/artifacts.", rl);

          if (request.method === "GET") {
            const gf = await (await fetch(`${tgApi}/getFile?file_id=${encodeURIComponent(row.telegram_file_id)}`)).json().catch(() => null);
            if (!gf?.ok) return err(502, "ART_TG_ERROR", "Telegram no devolvió el archivo.", "Reintenta en unos segundos.", rl);
            const dl = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${gf.result.file_path}`);
            if (!dl.ok) return err(502, "ART_TG_ERROR", "Telegram no sirvió el archivo.", "Reintenta en unos segundos.", rl);
            return new Response(dl.body, { headers: {
              "content-type": row.mime.startsWith("text/") ? row.mime + "; charset=utf-8" : row.mime, "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
              "x-artifact-size": String(row.size), ...rl } });
          }
          if (request.method === "DELETE") {
            if (row.telegram_message_id)
              await fetch(`${tgApi}/deleteMessage`, { method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify({ chat_id: env.TELEGRAM_STORAGE_CHAT_ID, message_id: row.telegram_message_id }) }).catch(() => {});
            await env.DB.prepare("DELETE FROM agent_artifacts WHERE artifact_id = ? AND key_hash = ?").bind(aid, hash).run();
            return Response.json({ success: true, tip: "Artefacto eliminado (D1 + storage Telegram)." }, { headers: rl });
          }
          return err(405, "METHOD_NOT_ALLOWED", "Método no soportado.", "GET (descargar) o DELETE.", rl);
        }
        return err(405, "METHOD_NOT_ALLOWED", "Método no soportado en /artifacts.", "GET lista, POST subir.", rl);
      }

      // ── Arena: ajedrez para agentes (correspondencia + vivo) ──
      if (sub === "/arena" || sub.startsWith("/arena/")) {
        return arenaApi(env, ctx, request, url, sub.slice(6) || "/", "a:" + keyRow.username, rl);
      }

      return err(404, "NOT_FOUND", `Ruta desconocida: ${sub}`,
        "Endpoints: GET /inbox, POST/GET /notes, GET/PATCH/DELETE /notes/{id}, /arena/* (ajedrez). Lee GET /docs.md", rl);
    }

    return err(404, "NOT_FOUND", "Ruta desconocida.",
      "Esto es Neat for Agents. Docs: GET /docs.md — API bajo /api/v1/");
  },
};
