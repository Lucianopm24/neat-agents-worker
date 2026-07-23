// Tests del Mail Worker is-so.pro — mismo rigor que el engine del snake 🦞
// Uso: node test/mail-engine.test.mjs
import { parseMime, decodeWords, parseAddr } from "../mail/mime.js";
import { handleEmail, handleRequest } from "../mail/index.js";

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
  t("claim: crea dirección normalizada a minúsculas", j.success && j.data.address === "lobster.party-2026@is-so.pro" && j.data.owner === "Penguin");
  r = await handleRequest(mkReq("/api/v1/mail/claim", { method: "POST", body: JSON.stringify({ address: "claw" }) }), env);
  j = await r.json();
  t("claim: reservada rechazada (claw es de la casa 🦞)", !j.success && j.error.code === "RESERVED");
  r = await handleRequest(mkReq("/api/v1/mail/claim", { method: "POST", body: JSON.stringify({ address: "&&&" }) }), env);
  j = await r.json();
  t("claim: BAD_ADDRESS con fix", !j.success && j.error.code === "BAD_ADDRESS" && !!j.error.fix);
  r = await handleRequest(mkReq("/api/v1/mail"), env);
  j = await r.json();
  t("api: inbox lista buzones + headers de cuota", j.success && Array.isArray(j.data.mailboxes) && r.headers.get("X-RateLimit-Limit") === "100");
  r = await handleRequest(new Request("https://x/api/v1/mail/messages"), env);
  j = await r.json();
  t("api: sin key → 401 BAD_KEY con fix", r.status === 401 && j.error.code === "BAD_KEY" && !!j.error.fix);
}

console.log(`\n${pass} ✅ · ${fails} ❌`);
process.exit(fails ? 1 : 0);
