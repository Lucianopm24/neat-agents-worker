// 📮 Neat Mail Worker v2 — el correo de la casa, para HUMANOS (y sus agentes)
//
// Tres caras:
//   email()  Cloudflare Email Routing entrega aquí; se guarda en D1 (nunca rebota:
//            si el buzón no existe, queda huérfano y se adopta al crearse el buzón).
//   fetch()  API JSON bajo /api/v1/mail · autenticación dual:
//              · humano  → Bearer <JWT de sesión Neat> (se valida contra el proxy /chat/me)
//              · agente  → Bearer neat_sk_… (misma key del gateway, cuota diaria propia)
//   páginas  GET / → webmail · GET /admin → panel admin (servidas aquí mismo;
//            pensadas para mail.neat.blue y mail.is-so.pro, la sesión es Neat).
//
// Modelo de buzones:
//   · usuario nuevo   → username@neat.qzz.io se auto-provisiona en su primer login
//                       (y adopta los huérfanos que hayan llegado antes).
//   · is-so.pro       → 1 por cuenta Neat, se reclama desde el webmail o la API.
//   · @neat.blue      → NO se gestiona aquí (la casa tiene su propio correo).
// Reglas de la casa idénticas al gateway: {success,data,tip} · error.code/message/fix.
import { parseMime } from "./mime.js";
import { WEBMAIL_HTML, ADMIN_HTML } from "./page.js";

const ISO = () => new Date().toISOString();
const sha256hex = async (t) => { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join(""); };
const json = (data, headers = {}, status = 200) => Response.json({ success: true, data }, { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
const err = (status, code, message, fix, headers = {}) => Response.json({ success: false, error: { code, message, fix } }, { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
const cap = (s, n = 131072) => (s && s.length > n ? s.slice(0, n) : s); // D1: bodies recortados a 128KB

const DOMAIN_USER = "neat.qzz.io"; // buzón automático de cada cuenta Neat
const DOMAIN_CLAIM = "is-so.pro";  // dominio comunitario, 1 por cuenta
const MAIL_DOMAINS = [DOMAIN_USER, DOMAIN_CLAIM];
const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,29}$/;
// nombres no reclamables por vía pública: infra del correo + familia/casa ✋ (el admin sí puede asignarlos)
const RESERVED = new Set(["admin", "administrator", "postmaster", "abuse", "hostmaster", "webmaster", "root", "noreply", "no-reply", "mailer-daemon", "support", "soporte", "info", "contact", "hola", "mail", "neat", "is-so", "luciano", "claw", "danna"]);
const NOT_BLOCKED = "address NOT IN (SELECT address FROM mboxes WHERE blocked = 1)";

// ═══ email(): intake desde Cloudflare Email Routing ═══
export async function handleEmail(message, env) {
  const raw = new Uint8Array(await new Response(message.raw).arrayBuffer());
  const parsed = parseMime(raw);
  const address = String(message.to || parsed.to.addr || "").toLowerCase().trim();
  const sender = parsed.from.addr || String(message.from || "").toLowerCase();
  const subject = parsed.subject || "(sin asunto)";
  const mb = await env.DB.prepare("SELECT owner, blocked FROM mboxes WHERE address = ?").bind(address).first();
  if (mb?.blocked) return { dropped: true, address, reason: "blocked", subject }; // buzón suspendido: no entra nada
  const id = "m_" + Math.random().toString(36).slice(2, 10);
  const tooBig = raw.length > 10 * 1024 * 1024; // >10MB: solo metadatos (la paciencia de D1 tiene límite)
  await env.DB.prepare("INSERT INTO mail (id, address, owner, sender, subject, text_body, html_body, size, has_attach, attach_names, is_read, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,0,?)")
    .bind(id, address, mb?.owner ?? null, sender, cap(subject, 500),
      tooBig ? null : cap(parsed.text), tooBig ? null : cap(parsed.html),
      raw.length, parsed.attachments.length ? 1 : 0,
      parsed.attachments.length ? JSON.stringify(parsed.attachments.map((a) => a.filename || a.ctype)) : null, ISO()).run();
  return { id, address, owner: mb?.owner ?? null, orphan: !mb, subject, size: raw.length };
}

// ═══ autenticación dual ═══
async function authAgent(token, env) {
  const key_hash = await sha256hex(token);
  const row = await env.DB.prepare("SELECT username, plus FROM agent_keys WHERE key_hash = ? AND revoked = 0").bind(key_hash).first();
  if (!row) return null;
  const used = await bumpQuota(env, key_hash);
  return { username: row.username, kind: "agent", limit: row.plus ? 500 : 100, used };
}
const humanCache = new Map(); // tokenHash → {me, exp} · vive por isolate, TTL corto
export function _clearHumanCache() { humanCache.clear(); } // solo tests
async function authHuman(token, env) {
  if (!env.PROXY_BASE) return null;
  const h = await sha256hex("t:" + token);
  const hit = humanCache.get(h);
  if (hit && hit.exp > Date.now()) return hit.me;
  let r;
  try { r = await fetch(`${env.PROXY_BASE}/chat/me`, { headers: { authorization: `Bearer ${token}` } }); }
  catch { return null; } // proxy inalcanzable → nulo temporal (no cacheado)
  if (!r.ok) { humanCache.set(h, { me: null, exp: Date.now() + 30_000 }); return null; }
  const u = await r.json().catch(() => null);
  if (!u?.username) return null;
  const me = { username: u.username, role: u.role === "admin" ? "admin" : "user", kind: "human" };
  humanCache.set(h, { me, exp: Date.now() + 300_000 });
  const used = await bumpQuota(env, await sha256hex("h:" + me.username));
  return { ...me, limit: me.role === "admin" ? 500 : 100, used };
}
async function bumpQuota(env, key) { // misma ley del gateway: cuota diaria por request
  const day = ISO().slice(0, 10);
  await env.DB.prepare("INSERT INTO usage_daily (key_hash, day, count) VALUES (?, ?, 1) ON CONFLICT(key_hash, day) DO UPDATE SET count = count + 1").bind(key, day).run();
  return (await env.DB.prepare("SELECT count FROM usage_daily WHERE key_hash = ? AND day = ?").bind(key, day).first())?.count || 1;
}
const rl = (l, u) => ({ "X-RateLimit-Limit": String(l), "X-RateLimit-Remaining": String(Math.max(0, l - u)), "X-RateLimit-Reset": "daily-00:00-utc" });
const meta = (r) => ({ id: r.id, address: r.address, sender: r.sender, subject: r.subject, size: r.size, has_attach: !!r.has_attach, attach_names: r.attach_names ? JSON.parse(r.attach_names) : [], is_read: !!r.is_read, created_at: r.created_at });

// auto-buzón de la cuenta: username@neat.qzz.io + adopción de huérfanos que llegaran antes
async function provisionUserBox(env, username) {
  const lp = String(username || "").toLowerCase();
  if (!NAME_RE.test(lp)) return null; // usernames con caracteres no postales: sin buzón auto (el admin puede crear uno manual)
  const address = `${lp}@${DOMAIN_USER}`;
  const ex = await env.DB.prepare("SELECT address FROM mboxes WHERE address = ?").bind(address).first();
  if (!ex) await env.DB.prepare("INSERT INTO mboxes (address, owner, source, created_at) VALUES (?,?,'auto',?)").bind(address, username, ISO()).run();
  return address;
}
async function adoptOrphans(env, address, owner) {
  await env.DB.prepare("UPDATE mail SET owner = ? WHERE address = ? AND owner IS NULL").bind(owner, address).run();
}
async function listBoxes(env, owner) {
  return (await env.DB.prepare("SELECT address, owner, source, blocked, created_at FROM mboxes WHERE owner = ? ORDER BY created_at").bind(owner).all()).results || [];
}

// ═══ router principal ═══
export async function handleRequest(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/healthz") return json({ ok: true, service: "neat mail 📮", domains: MAIL_DOMAINS });

  // páginas (webmail + panel admin) — la sesión la gestiona el JS con la API
  if (url.pathname === "/" || url.pathname === "/index.html") return new Response(WEBMAIL_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
  if (url.pathname === "/admin") return new Response(ADMIN_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });

  if (request.method === "OPTIONS") return new Response(null, { headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization,content-type", "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS" } });
  const sub = url.pathname.replace(/^\/api\/v1\/mail/, "") || "/";
  if (!url.pathname.startsWith("/api/v1/mail")) return err(404, "NOT_FOUND", "Ruta desconocida.", "Webmail: GET / · API: /api/v1/mail · docs: repo docs/mail.md");

  // login: server-side contra el proxy (oculta infra, esquiva CORS)
  if (sub === "/login" && request.method === "POST") {
    if (!env.PROXY_BASE) return err(503, "LOGIN_UNAVAILABLE", "Login no configurado en este despliegue.", "Falta el var PROXY_BASE en el worker.");
    const body = await request.json().catch(() => ({}));
    const { username, password } = body || {};
    if (!username || !password) return err(400, "BAD_JSON", "Envía {username, password} de tu cuenta Neat.", "¿Sin cuenta? Regístrate primero en Neat.");
    for (const path of ["/chat/login", "/auth/login"]) { // usuarios, luego admin de la casa
      let r;
      try { r = await fetch(`${env.PROXY_BASE}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) }); } catch { continue; }
      if (!r.ok) continue;
      const j = await r.json().catch(() => null);
      if (!j?.token) continue;
      const box = j.username ? await provisionUserBox(env, j.username).catch(() => null) : null;
      if (box) await adoptOrphans(env, box, j.username).catch(() => null);
      return json({ token: j.token, username: j.username, role: j.role || "user", mailbox: box, tip: box ? `Tu buzón automático es ${box}. Los correos que llegaran antes de hoy ya están adoptados 📬` : "Sesión lista. Tu buzón automático se crea en tu primera visita al inbox." });
    }
    return err(401, "BAD_CREDENTIALS", "Usuario o contraseña incorrectos.", "Son los mismos de tu cuenta Neat (el proxy los verifica).");
  }

  // autenticación dual
  const auth = request.headers.get("authorization") || "";
  const mSk = auth.match(/^Bearer\s+(neat_sk_[A-Za-z0-9]+)$/);
  const mJwt = auth.match(/^Bearer\s+(\S+)$/);
  let me = null;
  if (mSk) me = await authAgent(mSk[1], env);
  else if (mJwt) me = await authHuman(mJwt[1], env);
  if (!me) return err(401, "BAD_KEY", "Sesión inválida o vencida.", "Humanos: entra por el webmail (POST /api/v1/mail/login). Agentes: Bearer neat_sk_… de neat.blue/account.");
  const H = rl(me.limit, me.used);
  if (me.used > me.limit) return err(429, "QUOTA_EXCEEDED", `Cuota de ${me.limit} requests agotada por hoy.`, "Reset 00:00 UTC.", H);

  // ═══ panel admin (humano role=admin) ═══
  if (sub.startsWith("/admin")) return adminRoutes(sub, request, env, me, H);

  // GET /api/v1/mail → mis buzones + no leídos + últimos 10
  if ((sub === "" || sub === "/") && request.method === "GET") {
    if (me.kind === "human") {
      const box = await provisionUserBox(env, me.username);
      if (box) await adoptOrphans(env, box, me.username);
    }
    const boxes = await listBoxes(env, me.username);
    const unread = (await env.DB.prepare(`SELECT COUNT(*) n FROM mail WHERE owner = ? AND is_read = 0 AND ${NOT_BLOCKED}`).bind(me.username).first())?.n || 0;
    const last = (await env.DB.prepare(`SELECT id, address, sender, subject, size, has_attach, attach_names, is_read, created_at FROM mail WHERE owner = ? AND ${NOT_BLOCKED} ORDER BY created_at DESC LIMIT 10`).bind(me.username).all()).results || [];
    return json({ mailboxes: boxes.map((b) => ({ ...b, blocked: !!b.blocked })), unread, messages: last.map(meta), role: me.role || "agent", kind: me.kind, tip: boxes.length ? "Lee un correo completo con GET /api/v1/mail/messages/{id}" : `Sin buzones todavía: tu ${DOMAIN_USER} llega solo; reclama tu @${DOMAIN_CLAIM} con POST /api/v1/mail/claim {"address":"tunombre"}` }, H);
  }

  // claim is-so.pro — SOLO humanos (1 por cuenta)
  if (sub === "/claim" && request.method === "GET") {
    const boxes = (await listBoxes(env, me.username)).filter((b) => b.address.endsWith("@" + DOMAIN_CLAIM));
    return json({ mailboxes: boxes, domain: DOMAIN_CLAIM, tip: `Reclama la tuya con POST {"address":"tunombre"} — 1 por cuenta. ${NAME_RE}` }, H);
  }
  if (sub === "/claim" && request.method === "POST") {
    if (me.kind !== "human") return err(403, "HUMANS_ONLY", `El claim de @${DOMAIN_CLAIM} es para cuentas Neat (humanos), no para keys de agente.`, "Tu humano la reclama desde el webmail o con su sesión; tú lees con tu neat_sk_… si te asigna un buzón.", H);
    const body = await request.json().catch(() => ({}));
    const name = String(body?.address || "").toLowerCase().trim().replace(/@.*$/, "");
    if (!NAME_RE.test(name)) return err(400, "BAD_ADDRESS", "Dirección inválida.", "Formato: ^[a-z0-9][a-z0-9._-]{0,29}$ (sin @ ni dominio).", H);
    if (RESERVED.has(name)) return err(409, "RESERVED", `"${name}" está reservada (infra o familia de la casa).`, "Elige otra — los nombres reservados los asigna el admin desde el panel.", H);
    const mine = (await env.DB.prepare("SELECT COUNT(*) n FROM mboxes WHERE owner = ? AND address LIKE ?").bind(me.username, "%@" + DOMAIN_CLAIM).first())?.n || 0;
    if (mine >= 1) return err(409, "ONE_PER_PERSON", `Ya tienes tu @${DOMAIN_CLAIM} — es 1 por cuenta.`, "Si quieres cambiarla, pide al admin que la reasigne desde el panel.", H);
    const address = `${name}@${DOMAIN_CLAIM}`;
    if (await env.DB.prepare("SELECT owner FROM mboxes WHERE address = ?").bind(address).first()) return err(409, "TAKEN", `${address} ya tiene dueño.`, "Prueba con un apellido, guion o puntos — estilo tunombre.apellido.", H);
    await env.DB.prepare("INSERT INTO mboxes (address, owner, source, created_at) VALUES (?,?,'claim',?)").bind(address, me.username, ISO()).run();
    await adoptOrphans(env, address, me.username);
    return json({ address, owner: me.username, tip: `📬 ${address} es tuya (1/1). El correo que llegue se guarda aquí — léelo en el webmail o con GET /api/v1/mail.` }, H);
  }

  // GET /messages — lista (metadatos, sin cuerpos); buzones bloqueados quedan fuera
  if (sub === "/messages" && request.method === "GET") {
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10) || 20, 50);
    const since = url.searchParams.get("since") || "";
    const address = (url.searchParams.get("address") || "").toLowerCase();
    let sql = `SELECT id, address, sender, subject, size, has_attach, attach_names, is_read, created_at FROM mail WHERE owner = ? AND ${NOT_BLOCKED}`;
    const args = [me.username];
    if (address) { sql += " AND address = ?"; args.push(address); }
    if (since) { sql += " AND created_at > ?"; args.push(since); }
    sql += " ORDER BY created_at DESC LIMIT ?"; args.push(limit);
    const rows = (await env.DB.prepare(sql).bind(...args).all()).results || [];
    return json({ messages: rows.map(meta), tip: "Cuerpos con GET /messages/{id} · marca leído/no-leído con PATCH · ?address= para filtrar por buzón" }, H);
  }

  // /messages/{id}: GET (lee + marca leído) · PATCH {is_read} · DELETE
  const mm = sub.match(/^\/messages\/(m_[a-z0-9]+)$/);
  if (mm) {
    const row = await env.DB.prepare(`SELECT * FROM mail WHERE id = ? AND owner = ? AND ${NOT_BLOCKED}`).bind(mm[1], me.username).first();
    if (!row) return err(404, "MAIL_NOT_FOUND", "Ese correo no existe (o no es tuyo).", "Lista los tuyos con GET /api/v1/mail/messages.", H);
    if (request.method === "GET") {
      if (!row.is_read) await env.DB.prepare("UPDATE mail SET is_read = 1 WHERE id = ?").bind(row.id).run();
      return json({ ...meta(row), text: row.text_body, html: row.html_body, tip: "El HTML del remitente se entrega tal cual: sanitiza antes de renderizar (riqueza peligrosa 🐟)." }, H);
    }
    if (request.method === "PATCH") {
      const body = await request.json().catch(() => ({}));
      if (body?.is_read !== 0 && body?.is_read !== 1) return err(400, "BAD_JSON", "Envía {is_read: 0|1}.", "0 = pendiente, 1 = leído.", H);
      await env.DB.prepare("UPDATE mail SET is_read = ? WHERE id = ?").bind(body.is_read, row.id).run();
      return json({ id: row.id, is_read: !!body.is_read }, H);
    }
    if (request.method === "DELETE") {
      await env.DB.prepare("DELETE FROM mail WHERE id = ?").bind(row.id).run();
      return json({ id: row.id, deleted: true }, H);
    }
    return err(405, "METHOD_NOT_ALLOWED", "Método no soportado.", "GET lee · PATCH marca · DELETE borra.", H);
  }

  return err(404, "MAIL_ROUTE_NOT_FOUND", "Ruta de mail desconocida.", "GET /api/v1/mail · POST /login · GET|POST /claim · GET|PATCH|DELETE /messages/{id} · /admin/* (admin)", H);
}

// ═══ /admin/* — control total de buzones (humano role=admin) ═══
async function adminRoutes(sub, request, env, me, H) {
  if (me.kind !== "human" || me.role !== "admin") return err(403, "ADMIN_ONLY", "Esto es del admin de la casa.", "Entra al panel con la cuenta Neat admin: /admin", H);
  const url = new URL(request.url);

  if (sub === "/admin/stats" && request.method === "GET") {
    const one = async (sql, ...a) => (await env.DB.prepare(sql).bind(...a).first())?.n ?? 0;
    return json({
      mboxes: await one("SELECT COUNT(*) n FROM mboxes"),
      blocked: await one("SELECT COUNT(*) n FROM mboxes WHERE blocked = 1"),
      messages: await one("SELECT COUNT(*) n FROM mail"),
      unread: await one("SELECT COUNT(*) n FROM mail WHERE is_read = 0"),
      orphans: await one("SELECT COUNT(*) n FROM mail WHERE owner IS NULL"),
      by_domain: {
        [DOMAIN_USER]: await one("SELECT COUNT(*) n FROM mboxes WHERE address LIKE ?", "%@" + DOMAIN_USER),
        [DOMAIN_CLAIM]: await one("SELECT COUNT(*) n FROM mboxes WHERE address LIKE ?", "%@" + DOMAIN_CLAIM),
      },
      tip: "Panel: /admin · API: /admin/boxes · /admin/orphans · /admin/messages/{id}",
    }, H);
  }

  if (sub === "/admin/orphans" && request.method === "GET") {
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 200);
    const rows = (await env.DB.prepare("SELECT id, address, sender, subject, size, created_at FROM mail WHERE owner IS NULL ORDER BY created_at DESC LIMIT ?").bind(limit).all()).results || [];
    return json({ orphans: rows, tip: "Se adoptan solos cuando se crea su buzón (auto en login, claim, o POST /admin/boxes)." }, H);
  }

  if (sub === "/admin/boxes" && request.method === "GET") {
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10) || 100, 500);
    const q = (url.searchParams.get("q") || "").toLowerCase();
    const owner = url.searchParams.get("owner") || "";
    const domain = url.searchParams.get("domain") || "";
    let sql = "SELECT m.address, m.owner, m.source, m.blocked, m.created_at, (SELECT COUNT(*) FROM mail WHERE address = m.address) messages, (SELECT COUNT(*) FROM mail WHERE address = m.address AND is_read = 0) unread FROM mboxes m WHERE 1=1";
    const args = [];
    if (q) { sql += " AND m.address LIKE ?"; args.push(`%${q}%`); }
    if (owner) { sql += " AND m.owner = ?"; args.push(owner); }
    if (domain) { sql += " AND m.address LIKE ?"; args.push("%@" + domain); }
    sql += " ORDER BY m.created_at DESC LIMIT ?"; args.push(limit);
    const rows = (await env.DB.prepare(sql).bind(...args).all()).results || [];
    return json({ boxes: rows.map((b) => ({ ...b, blocked: !!b.blocked })), tip: "Acciones: POST crea · PATCH reasigna/bloquea · DELETE borra buzón y su correo." }, H);
  }
  if (sub === "/admin/boxes" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const address = String(body?.address || "").toLowerCase().trim();
    const owner = String(body?.owner || "").trim();
    const [name, dom] = address.split("@");
    if (!NAME_RE.test(name || "") || !MAIL_DOMAINS.includes(dom)) return err(400, "BAD_ADDRESS", "Dirección inválida.", `Formato nombre@dominio con dominio ∈ ${MAIL_DOMAINS.join(" | ")}. (El admin SÍ puede usar nombres reservados.)`, H);
    if (!owner) return err(400, "BAD_JSON", "Falta owner (cuenta Neat dueña).", "Envía {address, owner}.", H);
    if (await env.DB.prepare("SELECT address FROM mboxes WHERE address = ?").bind(address).first()) return err(409, "TAKEN", `${address} ya existe.`, "Reasígnala con PATCH si debe cambiar de dueño.", H);
    await env.DB.prepare("INSERT INTO mboxes (address, owner, source, created_at) VALUES (?,?,'admin',?)").bind(address, owner, ISO()).run();
    await adoptOrphans(env, address, owner);
    return json({ address, owner, source: "admin", tip: "Buzón creado y huérfanos adoptados si los había." }, H);
  }

  const bmm = sub.match(/^\/admin\/boxes\/([a-z0-9][a-z0-9._-]{0,29}@[a-z0-9.]+)$/);
  if (bmm) {
    const box = await env.DB.prepare("SELECT address, owner, source, blocked, created_at FROM mboxes WHERE address = ?").bind(bmm[1]).first();
    if (!box) return err(404, "BOX_NOT_FOUND", "Ese buzón no existe.", "Lístalo con GET /admin/boxes?q=…", H);
    if (request.method === "PATCH") {
      const body = await request.json().catch(() => ({}));
      const sets = [], args = [];
      if (typeof body?.owner === "string" && body.owner.trim() && body.owner.trim() !== box.owner) { sets.push("owner = ?"); args.push(body.owner.trim()); }
      if (body?.blocked === 0 || body?.blocked === 1) { sets.push("blocked = ?"); args.push(body.blocked); }
      if (!sets.length) return err(400, "BAD_JSON", "Nada que cambiar.", "PATCH {owner} para reasignar · {blocked:0|1} para suspender/reactivar.", H);
      await env.DB.prepare(`UPDATE mboxes SET ${sets.join(", ")} WHERE address = ?`).bind(...args, box.address).run();
      if (args.length && sets[0].startsWith("owner")) { // el correo sigue al buzón
        await env.DB.prepare("UPDATE mail SET owner = ? WHERE address = ?").bind(args[0], box.address).run();
        await adoptOrphans(env, box.address, args[0]);
      }
      return json({ address: box.address, changed: sets.join(" + "), tip: box.blocked === 0 && sets.includes("blocked = ?") ? "Buzón suspendido: su correo entrante se descarta y queda oculto al dueño." : "Listo." }, H);
    }
    if (request.method === "DELETE") {
      const n = (await env.DB.prepare("SELECT COUNT(*) n FROM mail WHERE address = ?").bind(box.address).first())?.n || 0;
      await env.DB.prepare("DELETE FROM mail WHERE address = ?").bind(box.address).run();
      await env.DB.prepare("DELETE FROM mboxes WHERE address = ?").bind(box.address).run();
      return json({ address: box.address, deleted: true, messages_deleted: n }, H);
    }
    return err(405, "METHOD_NOT_ALLOWED", "Método no soportado.", "PATCH reasigna/bloquea · DELETE borra buzón y su correo.", H);
  }

  if (sub === "/admin/messages" && request.method === "GET") {
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 200);
    const address = (url.searchParams.get("address") || "").toLowerCase();
    const owner = url.searchParams.get("owner") || "";
    let sql = "SELECT id, address, owner, sender, subject, size, has_attach, is_read, created_at FROM mail WHERE 1=1";
    const args = [];
    if (address) { sql += " AND address = ?"; args.push(address); }
    if (owner) { sql += " AND owner = ?"; args.push(owner); }
    sql += " ORDER BY created_at DESC LIMIT ?"; args.push(limit);
    const rows = (await env.DB.prepare(sql).bind(...args).all()).results || [];
    return json({ messages: rows, tip: "Cuerpo completo con GET /admin/messages/{id}.", }, H);
  }
  const amm = sub.match(/^\/admin\/messages\/(m_[a-z0-9]+)$/);
  if (amm) {
    const row = await env.DB.prepare("SELECT * FROM mail WHERE id = ?").bind(amm[1]).first();
    if (!row) return err(404, "MAIL_NOT_FOUND", "Ese correo no existe.", "Búscalo en /admin/messages o /admin/orphans.", H);
    if (request.method === "GET") return json({ ...meta(row), owner: row.owner, text: row.text_body, html: row.html_body }, H);
    if (request.method === "DELETE") {
      await env.DB.prepare("DELETE FROM mail WHERE id = ?").bind(row.id).run();
      return json({ id: row.id, deleted: true }, H);
    }
    return err(405, "METHOD_NOT_ALLOWED", "Método no soportado.", "GET lee · DELETE borra.", H);
  }

  return err(404, "ADMIN_ROUTE_NOT_FOUND", "Ruta admin desconocida.", "GET /admin/stats · GET|POST /admin/boxes · PATCH|DELETE /admin/boxes/{addr} · GET /admin/orphans · GET /admin/messages[/{id}] · DELETE /admin/messages/{id}", H);
}

export default {
  async email(message, env, ctx) {
    try {
      const r = await handleEmail(message, env);
      if (r.dropped) console.log(`[mail] descartado (buzón suspendido): ${r.address} · ${r.subject}`);
      else if (r.orphan) console.log(`[mail] huérfano (sin buzón): ${r.address} · ${r.subject}`);
    } catch (e) {
      console.error("[mail] email handler:", e?.message || e);
      throw e; // que CF reintente — el correo no se pierde por silencio
    }
  },
  async fetch(request, env, ctx) {
    try { return await handleRequest(request, env); }
    catch (e) { return err(500, "INTERNAL", "Error interno del buzón.", "Reintenta en un rato; si persiste, avisa al admin.", {}); }
  },
};
