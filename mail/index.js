// 📮 is-so.pro Mail Worker — el correo que antes se reenviaba ahora VIVE en Neat
// Dos caras: email() (recibe de Cloudflare Email Routing y guarda en D1)
//            fetch() (API JSON para dueños: leer/marcar/borrar + reclamar direcciones)
// Reglas de la casa idénticas al gateway: {success,data,tip} · error.code/message/fix · cuota diaria.
import { parseMime } from "./mime.js";

const ISO = () => new Date().toISOString();
const sha256hex = async (t) => { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join(""); };
const json = (data, headers = {}, status = 200) => Response.json({ success: true, data }, { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
const err = (status, code, message, fix, headers = {}) => Response.json({ success: false, error: { code, message, fix } }, { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
const cap = (s, n = 131072) => (s && s.length > n ? s.slice(0, n) : s); // D1: bodies recortados a 128KB
const DOMAIN = "is-so.pro";
// nombres que no se reclaman solos: infra del correo + familia/casa ✋
const RESERVED = new Set(["admin", "administrator", "postmaster", "abuse", "hostmaster", "webmaster", "root", "noreply", "no-reply", "mailer-daemon", "support", "soporte", "info", "contact", "hola", "mail", "neat", "is-so", "luciano", "claw", "danna"]);

// ═══ handlers reutilizables (exportados para tests) ═══
export async function handleEmail(message, env) {
  const raw = new Uint8Array(await new Response(message.raw).arrayBuffer());
  const parsed = parseMime(raw);
  const address = String(message.to || parsed.to.addr || "").toLowerCase().trim();
  const sender = parsed.from.addr || String(message.from || "").toLowerCase();
  const subject = parsed.subject || "(sin asunto)";
  const mb = await env.DB.prepare("SELECT owner FROM mboxes WHERE address = ?").bind(address).first();
  const id = "m_" + Math.random().toString(36).slice(2, 10);
  const tooBig = raw.length > 10 * 1024 * 1024; // >10MB: solo metadatos (la paciencia de D1 tiene límite)
  await env.DB.prepare("INSERT INTO mail (id, address, owner, sender, subject, text_body, html_body, size, has_attach, attach_names, is_read, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,0,?)")
    .bind(id, address, mb?.owner ?? null, sender, cap(subject, 500),
      tooBig ? null : cap(parsed.text), tooBig ? null : cap(parsed.html),
      raw.length, parsed.attachments.length ? 1 : 0,
      parsed.attachments.length ? JSON.stringify(parsed.attachments.map((a) => a.filename || a.ctype)) : null, ISO()).run();
  return { id, address, owner: mb?.owner ?? null, orphan: !mb, subject, size: raw.length };
}

async function authOwner(request, env) {
  const auth = request.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(neat_sk_[A-Za-z0-9]+)$/);
  if (!m) return null;
  const key_hash = await sha256hex(m[1]);
  const row = await env.DB.prepare("SELECT username, plus FROM agent_keys WHERE key_hash = ? AND revoked = 0").bind(key_hash).first();
  if (!row) return null;
  // misma ley del gateway: cuota diaria por request (plus x5)
  const day = new Date().toISOString().slice(0, 10), limit = row.plus ? 500 : 100;
  await env.DB.prepare("INSERT INTO usage_daily (key_hash, day, count) VALUES (?, ?, 1) ON CONFLICT(key_hash, day) DO UPDATE SET count = count + 1").bind(key_hash, day).run();
  const used = (await env.DB.prepare("SELECT count FROM usage_daily WHERE key_hash = ? AND day = ?").bind(key_hash, day).first())?.count || 1;
  return { username: row.username, limit, used };
}
const rl = (l, u) => ({ "X-RateLimit-Limit": String(l), "X-RateLimit-Remaining": String(Math.max(0, l - u)), "X-RateLimit-Reset": "daily-00:00-utc" });
const meta = (r) => ({ id: r.id, address: r.address, sender: r.sender, subject: r.subject, size: r.size, has_attach: !!r.has_attach, attach_names: r.attach_names ? JSON.parse(r.attach_names) : [], is_read: !!r.is_read, created_at: r.created_at });

export async function handleRequest(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/healthz") return json({ ok: true, service: "is-so.pro mail 📮" });

  const sub = url.pathname.replace(/^\/api\/v1\/mail/, "");
  if (!url.pathname.startsWith("/api/v1/mail")) return err(404, "NOT_FOUND", "Ruta desconocida.", "API: /api/v1/mail · docs: repo docs/mail.md");
  if (request.method === "OPTIONS") return new Response(null, { headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization,content-type", "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS" } });

  const me = await authOwner(request, env);
  if (!me) return err(401, "BAD_KEY", "Key inválida o revocada.", "Tu humano la crea en neat.blue/account → API keys.", {});
  const H = rl(me.limit, me.used);
  if (me.used > me.limit) return err(429, "QUOTA_EXCEEDED", `Cuota de ${me.limit} requests agotada por hoy.`, "Reset 00:00 UTC.", H);

  // GET /api/v1/mail → mis direcciones + no leídos + últimos 10
  if ((sub === "" || sub === "/") && request.method === "GET") {
    const boxes = (await env.DB.prepare("SELECT address, created_at FROM mboxes WHERE owner = ? ORDER BY created_at").bind(me.username).all()).results || [];
    const unread = (await env.DB.prepare("SELECT COUNT(*) n FROM mail WHERE owner = ? AND is_read = 0").bind(me.username).first())?.n || 0;
    const last = (await env.DB.prepare("SELECT id, address, sender, subject, size, has_attach, attach_names, is_read, created_at FROM mail WHERE owner = ? ORDER BY created_at DESC LIMIT 10").bind(me.username).all()).results || [];
    return json({ mailboxes: boxes, unread, messages: last.map(meta), tip: me.username === me.username && boxes.length === 0 ? `No tienes dirección todavía: reclama una con POST /api/v1/mail/claim {"address":"tunombre"}` : "Lee un correo completo con GET /api/v1/mail/messages/{id}" }, H);
  }

  // GET/POST /claim
  if (sub === "/claim" && request.method === "GET") {
    const boxes = (await env.DB.prepare("SELECT address, created_at FROM mboxes WHERE owner = ? ORDER BY created_at").bind(me.username).all()).results || [];
    return json({ mailboxes: boxes, tip: `Reclama otra con POST {"address":"tunombre"} (minúsculas, números, punto, guion, guion_bajo; máx 30).` }, H);
  }
  if (sub === "/claim" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const name = String(body?.address || "").toLowerCase().trim().replace(/@.*$/, "");
    if (!/^[a-z0-9][a-z0-9._-]{0,29}$/.test(name)) return err(400, "BAD_ADDRESS", "Dirección inválida.", "Formato: ^[a-z0-9][a-z0-9._-]{0,29}$ (sin @ ni dominio).", H);
    if (RESERVED.has(name)) return err(409, "RESERVED", `"${name}" está reservada (infra o familia de la casa).`, "Elige otra — los nombres reservados los asigna el admin.", H);
    const address = `${name}@${DOMAIN}`;
    const taken = await env.DB.prepare("SELECT owner FROM mboxes WHERE address = ?").bind(address).first();
    if (taken) return err(409, "TAKEN", `${address} ya tiene dueño.`, "Prueba con un apellido, guion o puntos — estilo tunombre.apellido.", H);
    await env.DB.prepare("INSERT INTO mboxes (address, owner, created_at) VALUES (?,?,?)").bind(address, me.username, ISO()).run();
    return json({ address, owner: me.username, tip: `📬 ${address} es tuya. El correo que llegue se guarda aquí — léelo con GET /api/v1/mail. (Reenvío clásico sigue igual: si además quieres copia a tu Gmail, pídeselo al admin.)` }, H);
  }

  // GET /messages — lista (metadatos, sin cuerpos)
  if (sub === "/messages" && request.method === "GET") {
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10) || 20, 50);
    const since = url.searchParams.get("since") || "";
    const address = (url.searchParams.get("address") || "").toLowerCase();
    let sql = "SELECT id, address, sender, subject, size, has_attach, attach_names, is_read, created_at FROM mail WHERE owner = ?";
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
    const row = await env.DB.prepare("SELECT * FROM mail WHERE id = ? AND owner = ?").bind(mm[1], me.username).first();
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

  return err(404, "MAIL_ROUTE_NOT_FOUND", "Ruta de mail desconocida.", "GET /api/v1/mail · GET /messages · GET|PATCH|DELETE /messages/{id} · GET|POST /claim", H);
}

export default {
  async email(message, env, ctx) {
    try {
      const r = await handleEmail(message, env);
      if (r.orphan) console.log(`[mail] huérfano (sin buzón): ${r.address} · ${r.subject}`);
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
