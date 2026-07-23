// Tests del Mail Worker is-so.pro — mismo rigor que el engine del snake 🦞
// Uso: node test/mail-engine.test.mjs
import { parseMime, decodeWords, parseAddr } from "../mail/mime.js";
import { handleEmail, handleRequest, _clearHumanCache } from "../mail/index.js";

let pass = 0, fails = 0;
const t = (name, cond) => { if (cond) { pass++; console.log("✅", name); } else { fails++; console.log("❌", name); } };
const CRLF = (...ls) => ls.join("\r\n");
const U8 = (s) => new TextEncoder().encode(s);

// ── 1. correo simple ──
{
  const raw = U8(CRLF("From: Pepe <pepe@example.com>", "To: claw@is-so.pro", "Subject: Hola langosta", "Date: Tue, 22 Jul 2026 10:00:00 -0500", "", "cuerpo del mensaje", ""));
  const p = parseMime(raw);
  t("simple: subject", p.subject === "Hola langosta");
  t("simple: from parseado", p.from.name === "Pepe" && p.from.addr === "pepe@example.com");
  t("simple: text", p.text.trim() === "cuerpo del mensaje" && !p.html);
}

// ── 2. encoded-words UTF-8 (subject Gmail) + quoted-printable con tildes ──
{
  const subj = "=?UTF-8?B?wr9WaXN0ZSBxdWUgc8OtIGZ1bmNpb25hPw==?="; // "¿Viste que sí funciona?"
  const raw = U8(CRLF("From: Luciano Paba <luciano@lucianopm.com>", "To: <claw@is-so.pro>", "Subject: " + subj, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: quoted-printable", "", "Los correos is-so.pro ya funcionan! No me cre=C3=ADas? Revisa a qui=C3=A9n fue", "dirijido este correo", ""));
  const p = parseMime(raw);
  t("eword: subject decodificado", p.subject === "¿Viste que sí funciona?");
  t("eword: from con nombre", p.from.name === "Luciano Paba" && p.from.addr === "luciano@lucianopm.com");
  t("qp: tildes/utf8 en cuerpo", p.text.includes("creías") && p.text.includes("quién"));
}

// ── 3. multipart/alternative (text + html) con boundary entrecomillado ──
{
  const raw = U8(CRLF('From: "Bot" <bot@x.io>', "To: someone else <c@d.io>", "Subject: multi", 'Content-Type: multipart/alternative; boundary="XYZ"', "",
    "--XYZ", "Content-Type: text/plain; charset=utf-8", "", "versión plana",
    "--XYZ", "Content-Type: text/html; charset=utf-8", "", "<b>versión</b> <i>html</i>",
    "--XYZ--", ""));
  const p = parseMime(raw);
  t("multi: text e html", p.text.trim() === "versión plana" && p.html.includes("<b>versión</b>"));
}

// ── 4. multipart/mixed con adjunto (solo metadatos del file) ──
{
  const raw = U8(CRLF("From: a@b.c", "To: d@e.f", "Subject: mix", 'Content-Type: multipart/mixed; boundary=M1X', "",
    "--M1X", "Content-Type: text/plain", "", "con adjunto",
    "--M1X", 'Content-Type: text/csv; name="datos.csv"', "Content-Disposition: attachment; filename=\"datos.csv\"", "Content-Transfer-Encoding: base64", "", "YSxiCjEsMgo=",
    "--M1X--", ""));
  const p = parseMime(raw);
  t("mixed: cuerpo intacto", p.text.trim() === "con adjunto");
  t("mixed: adjunto con nombre/tamaño", p.attachments.length === 1 && p.attachments[0].filename === "datos.csv" && p.attachments[0].size === 8);
}

// ── 5. ayudantes sueltos ──
{
  t("decodeWords deja texto plano intacto", decodeWords("sin palabras raras") === "sin palabras raras");
  t("parseAddr sin ángulos", parseAddr("solo@correo.io").addr === "solo@correo.io" && parseAddr("solo@correo.io").name === "");
}

// ── D1 spy para integración ──
const mkEnv = (canned = {}) => {
  const calls = [];
  const stmt = (sql) => ({
    sql, args: [],
    bind(...a) { this.args = a; calls.push({ sql, args: a }); return this; },
    async run() { return {}; },
    async first() {
      if (/mboxes/.test(sql) && /SELECT owner/.test(sql)) return this.args[0] === "claw@is-so.pro" ? { owner: "Penguin" } : null;
      if (/agent_keys/.test(sql)) return { username: "Penguin", plus: 0 };
      if (/usage_daily/.test(sql) && /SELECT/.test(sql)) return { count: 1 };
      if (/COUNT/.test(sql)) return { n: 2 };
      return null;
    },
    async all() {
      if (/mboxes/.test(sql)) return { results: [{ address: "claw@is-so.pro", created_at: "2026-07-22T00:00:00Z" }] };
      return { results: [] };
    },
  });
  return { calls, env: { DB: { prepare: (sql) => stmt(sql) } } };
};

// ── 6. handleEmail end-to-end (con buzón y huérfano) ──
{
  const { calls, env } = mkEnv();
  const raw = CRLF("From: Jefe <luciano@lucianopm.com>", "To: claw@is-so.pro", "Subject: =?UTF-8?Q?prueba_de_fuego_?= =?UTF-8?B?8a+MgKE=?=", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", "aG9sYSBwZW5ndWluIA==");
  const msg = { from: "luciano@lucianopm.com", to: "claw@is-so.pro", headers: new Headers(), raw: new Response(raw).body };
  const r = await handleEmail(msg, env);
  t("email: owner resuelto por buzón", r.owner === "Penguin" && !r.orphan);
  const ins = calls.find((c) => c.sql.startsWith("INSERT INTO mail"));
  t("email: INSERT con binds (owner y asunto decodificado)", !!ins && ins.args[2] === "Penguin" && ins.args[3] === "luciano@lucianopm.com" && String(ins.args[4]).startsWith("prueba de fuego"));
  t("email: cuerpo base64 decodificado guardado", !!ins && String(ins.args[5]).includes("hola pengui"));
  const msg2 = { from: "luciano@lucianopm.com", to: "fantasma@is-so.pro", headers: new Headers(), raw: new Response(raw).body };
  const r2 = await handleEmail(msg2, env);
  const ins2 = calls.filter((c) => c.sql.startsWith("INSERT INTO mail")).pop();
  t("email: huérfano owner NULL (se conserva, no se pierde)", r2.orphan === true && ins2.args[1] === "fantasma@is-so.pro" && ins2.args[2] === null);
}

// ── 7. fetch API: claim con validación y reservas ──
{
  const mkReq = (path, opts = {}) => new Request("https://x" + path, { ...opts, headers: { authorization: "Bearer neat_sk_test", "content-type": "application/json", ...(opts.headers || {}) } });
  const { env } = mkEnv();
  let r = await handleRequest(mkReq("/api/v1/mail/claim", { method: "POST", body: JSON.stringify({ address: "Lobster.Party-2026" }) }), env);
  let j = await r.json();
  t("claim: con key de agente → 403 (es de humanos, v2)", r.status === 403 && j.error.code === "HUMANS_ONLY" && !!j.error.fix);
  r = await handleRequest(mkReq("/api/v1/mail"), env);
  j = await r.json();
  t("api: inbox lista buzones + headers de cuota", j.success && Array.isArray(j.data.mailboxes) && r.headers.get("X-RateLimit-Limit") === "100");
  r = await handleRequest(new Request("https://x/api/v1/mail/messages"), env);
  j = await r.json();
  t("api: sin key → 401 BAD_KEY con fix", r.status === 401 && j.error.code === "BAD_KEY" && !!j.error.fix);
}

// ═══ 8. v2 HUMANOS: login proxy, auto-buzón, claim 1 por cuenta, panel admin ═══
// Proxy falso + D1 espía con estado (buzones y correos en memoria)
const R = (s, j) => ({ ok: s < 400, status: s, json: async () => j });
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const body = init.body ? JSON.parse(init.body) : {};
  const tok = (init.headers?.authorization || "").replace("Bearer ", "");
  if (url.endsWith("/chat/login")) return body.username === "dana" && body.password === "ok" ? R(200, { token: "jwt_dana", username: "Dana", role: "user", email: "dana@neat.qzz.io" }) : R(401, { error: "invalid" });
  if (url.endsWith("/auth/login")) return body.username === "admin" && body.password === "boss" ? R(200, { token: "jwt_admin", username: "admin", role: "admin", email: "admin@neat.blue" }) : R(401, { error: "invalid" });
  if (url.endsWith("/chat/me")) {
    if (tok === "jwt_dana") return R(200, { username: "Dana", role: "user", email: "dana@neat.qzz.io" });
    if (tok === "jwt_admin") return R(200, { username: "admin", role: "admin", email: "admin@neat.blue" });
    if (tok === "jwt_raro") return R(200, { username: "Daña Ñol", role: "user" });
    return R(401, { error: "invalid" });
  }
  return R(404, {});
};
const mkEnv2 = (c = {}) => {
  const calls = [];
  const mboxes = {}; // addr → {owner, source, blocked}
  for (const [a, b] of Object.entries(c.mboxes || {})) mboxes[a] = { source: "seed", blocked: 0, ...b };
  const mailRows = (c.mail || []).map((m) => ({ ...m }));
  const row = (a) => mboxes[a] ? { address: a, owner: mboxes[a].owner, source: mboxes[a].source, blocked: mboxes[a].blocked, created_at: "2026-07-22T00:00:00Z" } : null;
  const stmt = (sql) => ({
    args: [],
    bind(...a) { this.args = a; calls.push({ sql, args: a }); return this; },
    async run() {
      const a = this.args;
      if (sql.startsWith("INSERT INTO mboxes")) mboxes[a[0]] = { owner: a[1], source: /'auto'/.test(sql) ? "auto" : /'claim'/.test(sql) ? "claim" : /'admin'/.test(sql) ? "admin" : "seed", blocked: 0 };
      if (sql.startsWith("UPDATE mboxes SET")) {
        const addr = a[a.length - 1]; if (mboxes[addr]) { let i = 0; if (/owner = \?/.test(sql)) mboxes[addr].owner = a[i++]; if (/blocked = \?/.test(sql)) mboxes[addr].blocked = a[i++]; }
      }
      if (sql.startsWith("UPDATE mail SET owner")) for (const m of mailRows) if (m.address === a[1] && (/owner IS NULL/.test(sql) ? m.owner == null : true)) m.owner = a[0];
      if (sql.startsWith("DELETE FROM mail WHERE address")) { const n = mailRows.length; for (let i = mailRows.length - 1; i >= 0; i--) if (mailRows[i].address === a[0]) mailRows.splice(i, 1); return { meta: { changes: n - mailRows.length } }; }
      if (sql.startsWith("DELETE FROM mail WHERE id")) for (let i = mailRows.length - 1; i >= 0; i--) if (mailRows[i].id === a[0]) mailRows.splice(i, 1);
      if (sql.startsWith("DELETE FROM mboxes")) delete mboxes[a[0]];
      if (sql.startsWith("UPDATE mail SET is_read")) for (const m of mailRows) if (m.id === a[1]) m.is_read = a[0];
      return {};
    },
    async first() {
      const a = this.args;
      if (/SELECT owner, blocked FROM mboxes/.test(sql)) { const b = mboxes[a[0]]; return b ? { owner: b.owner, blocked: b.blocked } : null; }
      if (/SELECT address FROM mboxes WHERE address/.test(sql)) return mboxes[a[0]] ? { address: a[0] } : null;
      if (/SELECT owner FROM mboxes WHERE address/.test(sql)) { const b = mboxes[a[0]]; return b ? { owner: b.owner } : null; }
      if (/SELECT id, address, sender, subject, size, has_attach, attach_names, is_read, created_at FROM mail WHERE/.test(sql)) return null;
      if (/SELECT \* FROM mail WHERE id = \? AND owner/.test(sql)) return mailRows.find((m) => m.id === a[0] && m.owner === a[1] && !(mboxes[m.address] || {}).blocked) || null; // NOT_BLOCKED respetado
      if (/SELECT \* FROM mail WHERE id/.test(sql)) return mailRows.find((m) => m.id === a[0]) || null;
      if (/SELECT address, owner, source, blocked, created_at FROM mboxes WHERE address/.test(sql)) return row(a[0]);
      if (/agent_keys/.test(sql)) return { username: "Penguin", plus: 0 };
      if (/usage_daily/.test(sql) && /SELECT/.test(sql)) return { count: 1 };
      if (/COUNT\(\*\) n FROM mboxes WHERE owner/.test(sql)) return { n: Object.entries(mboxes).filter(([, b]) => b.owner === a[0] && (!/LIKE/.test(sql) || true)).length && Object.entries(mboxes).filter(([ad, b]) => b.owner === a[0] && ad.endsWith("@" + String(a[1]).replace("%@", ""))).length };
      if (/COUNT\(\*\) n FROM mboxes WHERE address LIKE/.test(sql)) return { n: Object.keys(mboxes).filter((ad) => ad.endsWith(String(a[0]).replace("%", ""))).length };
      if (/COUNT\(\*\) n FROM mboxes WHERE blocked/.test(sql)) return { n: Object.values(mboxes).filter((b) => b.blocked).length };
      if (/COUNT\(\*\) n FROM mboxes$/.test(sql)) return { n: Object.keys(mboxes).length };
      if (/COUNT\(\*\) n FROM mail WHERE owner IS NULL/.test(sql)) return { n: mailRows.filter((m) => m.owner == null).length };
      if (/COUNT\(\*\) n FROM mail WHERE is_read = 0$/.test(sql)) return { n: mailRows.filter((m) => !m.is_read).length };
      if (/COUNT\(\*\) n FROM mail WHERE owner = \? AND is_read = 0/.test(sql)) return { n: mailRows.filter((m) => m.owner === a[0] && !m.is_read && !(mboxes[m.address] || {}).blocked).length };
      if (/COUNT\(\*\) n FROM mail WHERE address/.test(sql)) return { n: mailRows.filter((m) => m.address === a[0]).length };
      if (/COUNT\(\*\) n FROM mail$/.test(sql)) return { n: mailRows.length };
      return null;
    },
    async all() {
      const a = this.args;
      if (/FROM mboxes m WHERE 1=1/.test(sql)) return { results: Object.keys(mboxes).map((ad) => ({ ...row(ad), messages: mailRows.filter((m) => m.address === ad).length, unread: mailRows.filter((m) => m.address === ad && !m.is_read).length })) };
      if (/FROM mboxes WHERE owner/.test(sql)) return { results: Object.keys(mboxes).filter((ad) => mboxes[ad].owner === a[0]).map(row) };
      if (/FROM mail WHERE owner IS NULL/.test(sql)) return { results: mailRows.filter((m) => m.owner == null) };
      if (/FROM mail WHERE 1=1/.test(sql)) return { results: mailRows.filter((m) => (!a[0] || m.address === a[0] || m.owner === a[0])) };
      if (/FROM mail WHERE owner/.test(sql)) return { results: mailRows.filter((m) => m.owner === a[0] && !(mboxes[m.address] || {}).blocked) };
      return { results: [] };
    },
  });
  return { calls, env: { DB: { prepare: (s) => stmt(s) }, PROXY_BASE: "https://proxy.test" }, mboxes, mailRows };
};
const hreq = (path, tok = "jwt_dana", opts = {}) => new Request("https://mail.test" + path, { ...opts, headers: { authorization: "Bearer " + tok, "content-type": "application/json", ...(opts.headers || {}) } });

// 8.1 login: usuario normal (ruta /chat/login del proxy) + huérfanos adoptados
{
  const { calls, env, mboxes } = mkEnv2({ mail: [{ id: "m_9", address: "dana@neat.qzz.io", owner: null, sender: "x@y.z", subject: " viejo", size: 10, has_attach: 0, attach_names: null, is_read: 0, created_at: "2026-07-22" }] });
  _clearHumanCache();
  const r = await handleRequest(hreq("/api/v1/mail/login", "", { method: "POST", body: JSON.stringify({ username: "dana", password: "ok" }) }), env);
  const j = await r.json();
  t("login: usuario ok devuelve token y su buzón auto", j.success && j.data.token === "jwt_dana" && j.data.mailbox === "dana@neat.qzz.io");
  t("login: buzón auto provisionado (source auto)", mboxes["dana@neat.qzz.io"]?.source === "auto" && mboxes["dana@neat.qzz.io"]?.owner === "Dana");
  t("login: UPDATE adopción ejecutado", !!calls.find((c) => c.sql.includes("UPDATE mail SET owner") && c.args.includes("dana@neat.qzz.io")));
  // login admin (fallback /auth/login) y login inválido
  const r2 = await handleRequest(hreq("/api/v1/mail/login", "", { method: "POST", body: JSON.stringify({ username: "admin", password: "boss" }) }), env);
  const j2 = await r2.json();
  t("login: admin por fallback /auth/login (role admin)", j2.success && j2.data.role === "admin");
  const r3 = await handleRequest(hreq("/api/v1/mail/login", "", { method: "POST", body: JSON.stringify({ username: "nadie", password: "mal" }) }), env);
  t("login: credenciales malas → 401 BAD_CREDENTIALS", r3.status === 401 && (await r3.json()).error.code === "BAD_CREDENTIALS");
}

// 8.2 GET / como humana: provisiona una sola vez + nombre raro no rompe
{
  const { calls, env, mboxes } = mkEnv2({ mboxes: { "dana@neat.qzz.io": { owner: "Dana" } } });
  _clearHumanCache();
  const r = await handleRequest(hreq("/api/v1/mail"), env);
  const j = await r.json();
  t("inbox humano: buzón existente NO se re-provisiona", j.success && !calls.find((c) => c.sql.startsWith("INSERT INTO mboxes")));
  const r2 = await handleRequest(hreq("/api/v1/mail", "jwt_raro"), env);
  const j2 = await r2.json();
  t("inbox humano: username no postal no rompe (sin buzón auto)", j2.success && j2.data.mailboxes.length === 0 && !mboxes["daña ñol@neat.qzz.io"]);
}

// 8.3 claim humano: ok, 1 por cuenta, TAKEN y RESERVED
{
  const { env, mboxes } = mkEnv2();
  _clearHumanCache();
  let r = await handleRequest(hreq("/api/v1/mail/claim", "jwt_dana", { method: "POST", body: JSON.stringify({ address: "Dana.Rivera" }) }), env);
  let j = await r.json();
  t("claim humano: crea @is-so.pro normalizada", j.success && j.data.address === "dana.rivera@is-so.pro" && mboxes["dana.rivera@is-so.pro"]?.source === "claim");
  r = await handleRequest(hreq("/api/v1/mail/claim", "jwt_dana", { method: "POST", body: JSON.stringify({ address: "otra.mas" }) }), env);
  j = await r.json();
  t("claim humano: el segundo → 409 ONE_PER_PERSON", r.status === 409 && j.error.code === "ONE_PER_PERSON");
  const { env: env2 } = mkEnv2({ mboxes: { "pepe@is-so.pro": { owner: "Pepe" } } });
  r = await handleRequest(hreq("/api/v1/mail/claim", "jwt_dana", { method: "POST", body: JSON.stringify({ address: "pepe" }) }), env2);
  j = await r.json();
  t("claim humano: TAKEN si ya tiene dueño", r.status === 409 && j.error.code === "TAKEN");
  r = await handleRequest(hreq("/api/v1/mail/claim", "jwt_dana", { method: "POST", body: JSON.stringify({ address: "support" }) }), env2);
  j = await r.json();
  t("claim humano: RESERVED protegido", r.status === 409 && j.error.code === "RESERVED");
}

// 8.4 admin: guardia, stats, crear reservada, reasignar, bloquear intake, borrar
{
  _clearHumanCache();
  const canned = { mboxes: { "dana@neat.qzz.io": { owner: "Dana" } }, mail: [
    { id: "m_1", address: "dana@neat.qzz.io", owner: "Dana", sender: "a@b.c", subject: "hola", size: 9, has_attach: 0, attach_names: null, is_read: 0, created_at: "2026-07-22" },
    { id: "m_2", address: "fantasma@is-so.pro", owner: null, sender: "a@b.c", subject: "eco", size: 9, has_attach: 0, attach_names: null, is_read: 0, created_at: "2026-07-22" },
  ] };
  const { calls, env, mboxes, mailRows } = mkEnv2(canned);
  let r = await handleRequest(hreq("/api/v1/mail/admin/stats", "jwt_dana"), env);
  t("admin: usuaria normal → 403", r.status === 403 && (await r.json()).error.code === "ADMIN_ONLY");
  r = await handleRequest(new Request("https://mail.test/api/v1/mail/admin/stats", { headers: { authorization: "Bearer neat_sk_test" } }), env);
  t("admin: key de agente → 403", r.status === 403);
  r = await handleRequest(hreq("/api/v1/mail/admin/stats", "jwt_admin"), env);
  let j = await r.json();
  t("admin: stats completas", j.success && j.data.mboxes === 1 && j.data.messages === 2 && j.data.orphans === 1 && j.data.by_domain["neat.qzz.io"] === 1);
  r = await handleRequest(hreq("/api/v1/mail/admin/boxes", "jwt_admin", { method: "POST", body: JSON.stringify({ address: "hola@is-so.pro", owner: "Agencia" }) }), env);
  j = await r.json();
  t("admin: crea buzón con nombre RESERVADO (potestad del panel)", j.success && mboxes["hola@is-so.pro"]?.owner === "Agencia" && mboxes["hola@is-so.pro"]?.source === "admin");
  r = await handleRequest(hreq("/api/v1/mail/admin/boxes/dana@neat.qzz.io", "jwt_admin", { method: "PATCH", body: JSON.stringify({ owner: "Dana2", blocked: 1 }) }), env);
  j = await r.json();
  t("admin: PATCH reasigna dueño y bloquea", j.success && mboxes["dana@neat.qzz.io"].owner === "Dana2" && mboxes["dana@neat.qzz.io"].blocked === 1);
  t("admin: el correo sigue al buzón reasignado", mailRows.find((m) => m.id === "m_1")?.owner === "Dana2");
  const ev = (await import("../mail/index.js"));
  const raw = CRLF("From: a@b.c", "To: dana@neat.qzz.io", "Subject: cae?", "", "x");
  const r5 = await ev.handleEmail({ from: "a@b.c", to: "dana@neat.qzz.io", headers: new Headers(), raw: new Response(raw).body }, env);
  t("intake: buzón suspendido descarta (sin INSERT)", r5.dropped === true && !calls.find((c) => c.sql.startsWith("INSERT INTO mail")));
  r = await handleRequest(hreq("/api/v1/mail/admin/orphans", "jwt_admin"), env);
  j = await r.json();
  t("admin: huérfanos listados", j.success && j.data.orphans.length === 1 && j.data.orphans[0].id === "m_2");
  r = await handleRequest(hreq("/api/v1/mail/admin/boxes/dana@neat.qzz.io", "jwt_admin", { method: "DELETE" }), env);
  j = await r.json();
  t("admin: DELETE borra buzón y su correo", j.success && !mboxes["dana@neat.qzz.io"] && !mailRows.find((m) => m.id === "m_1"));
}

// 8.5 mensajes del dueño: buzón suspendido queda invisible
{
  const { env } = mkEnv2({ mboxes: { "dana@neat.qzz.io": { owner: "Dana", blocked: 1 } }, mail: [{ id: "m_1", address: "dana@neat.qzz.io", owner: "Dana", sender: "a@b.c", subject: "s", size: 1, has_attach: 0, attach_names: null, is_read: 0, created_at: "2026-07-22" }] });
  _clearHumanCache();
  const r = await handleRequest(hreq("/api/v1/mail/messages/m_1"), env);
  t("dueño: su correo en buzón suspendido → 404 oculto", r.status === 404);
}
if (globalThis.fetch !== realFetch) globalThis.fetch = realFetch;

console.log(`\n${pass} ✅ · ${fails} ❌`);
process.exit(fails ? 1 : 0);
