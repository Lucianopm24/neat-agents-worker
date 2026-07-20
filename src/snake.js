// 🐍 Snake Royale Arena — engine puro + Durable Object + REST (spec: docs/snake-royale.md)
// Verdad final en D1 (la partida corre en memoria del DO; D1 guarda inicio + final + transcript).
// Convenciones espejo de arena.js (ajedrez): ok/fail, tickets HMAC 4-part, arena_notify, CUOTA espejo 20:1.

const ISO = () => new Date().toISOString();
const PLAYER_RE = /^[ah]:[a-zA-Z0-9_]{3,30}$/;
const GID_RE = /^g_[A-Za-z0-9]{9,}$/;
const CODE_ABC = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const OPP = { up: "down", down: "up", left: "right", right: "left" };
const DIRCODE = { up: "u", down: "d", left: "l", right: "r", _: "_" };
// Zona roja (regla del jefe, v2): cada zoneEvery ticks el margen seguro se encoge 1 celda por lado.
// Determinista (solo depende del tick) → revive/replay siguen exactos.
export function zoneMargin(G) { return Math.floor(G.tick / (G.zoneEvery || 50)); }
export function inRed(G, x, y) { const m = zoneMargin(G); return m > 0 && (x < m || y < m || x >= G.w - m || y >= G.h - m); }

const LEAGUES = [
  { min: 2000, name: "Leyenda", icon: "👑" }, { min: 1800, name: "Diamante", icon: "💠" },
  { min: 1600, name: "Platino", icon: "🟦" }, { min: 1400, name: "Oro", icon: "🥇" },
  { min: 1200, name: "Plata", icon: "🥈" }, { min: 0, name: "Bronce", icon: "🥉" },
];
function leagueFromElo(rating) {
  const l = LEAGUES.find((x) => rating >= x.min);
  const i = LEAGUES.indexOf(l);
  const nxt = i > 0 ? LEAGUES[i - 1] : null;
  return { league: l.name, icon: l.icon, next: nxt ? { league: nxt.name, at: nxt.min } : null };
}

const playerLabel = (id) => (id || "").split(":")[1] || "?";
const b64url = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlDec = (s) => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return decodeURIComponent(escape(atob(s))); };
async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const buf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ════════════════ ENGINE PURO (testeable a lo perft, seeds fijas) ════════════════
function hashSeed(str) { let h = 2166136261 >>> 0; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
export function rngFrom(seed) { // mulberry32 determinista
  let a = hashSeed(seed);
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// estado: {w,h,tickMs,tick,status,snakes:[{id,body:[[x,y]..],dir,health,alive,place,kills,cause}],food:[[x,y]..],transcript}
export function createGame(ids, { seed = "s", w = 15, h = 15, tickMs = 750, capTicks = 600, zoneEvery = 50 } = {}) {
  const rng = rngFrom(seed);
  const n = ids.length;
  // spawns repartidos: anillo alrededor del centro, lejos entre sí
  const cx = (w / 2) | 0, cy = (h / 2) | 0, rad = Math.max(2, Math.min(w, h) / 3 | 0);
  const snakes = ids.map((id, i) => {
    const ang = (2 * Math.PI * i) / n + rng() * 0.3;
    const x = Math.max(1, Math.min(w - 2, Math.round(cx + rad * Math.cos(ang))));
    const y = Math.max(1, Math.min(h - 2, Math.round(cy + rad * Math.sin(ang))));
    const axis = rng() < 0.5 ? "x" : "y";
    const dir = axis === "x" ? (x > cx ? "left" : "right") : (y > cy ? "up" : "down");
    const [dx, dy] = DIRS[dir];
    return { id, body: [[x, y], [x - dx, y - dy], [x - 2 * dx, y - 2 * dy]].map(([a, b]) => [Math.max(0, Math.min(w - 1, a)), Math.max(0, Math.min(h - 1, b))]), dir, health: 100, alive: true, place: null, kills: 0, cause: null };
  });
  const G = { w, h, tickMs, capTicks, zoneEvery, tick: 0, status: "active", snakes, food: [], transcript: "", rng };
  spawnFood(G); spawnFood(G);
  return G;
}
const cellEq = (a, b) => a[0] === b[0] && a[1] === b[1];
const freeCells = (G) => {
  const occ = new Set();
  for (const s of G.snakes) for (const c of s.body) occ.add(c[0] + "," + c[1]);
  for (const f of G.food) occ.add(f[0] + "," + f[1]);
  const out = [];
  for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) if (!occ.has(x + "," + y)) out.push([x, y]);
  return out;
};
function spawnFood(G) { const f = freeCells(G).filter(([x, y]) => !inRed(G, x, y)); if (f.length) G.food.push(f[(G.rng() * f.length) | 0]); } // manzanas jamás en zona roja

// Un tick: dirs = Map(id → "up"|...); sin dir → sigue recta (autopilot). Devuelve eventos.
export function applyTick(G, dirs) {
  if (G.status !== "active") return { events: [] };
  G.tick++;
  const events = [];
  const alive = G.snakes.filter((s) => s.alive);
  for (const s of alive) {
    let d = dirs.get(s.id) || s.dir;
    if (!DIRS[d] || d === OPP[s.dir]) d = s.dir; // clamp anti-180°
    s.dir = d;
    G.transcript += DIRCODE[d];
  }
  for (const s of G.snakes.filter((x) => !x.alive)) G.transcript += DIRCODE._;
  // cabezas futuras
  for (const s of alive) { const [dx, dy] = DIRS[s.dir]; s._nh = [s.body[0][0] + dx, s.body[0][1] + dy]; }
  // quien come
  const eaten = [];
  for (const s of alive) {
    const fi = G.food.findIndex((f) => cellEq(f, s._nh));
    s._eat = fi >= 0;
    if (s._eat) { eaten.push(fi); events.push({ type: "eat", snake: s.id, at: s._nh }); }
  }
  G.food = G.food.filter((_, i) => !eaten.includes(i));
  // salud: -1 por tick; en zona roja -5; si come → 100 y crece (no popea cola)
  for (const s of alive) { s._red = inRed(G, s._nh[0], s._nh[1]); s.health -= s._red ? 5 : 1; if (s._eat) s.health = 100; }
  // cuerpos nuevos
  for (const s of alive) s._nb = s._eat ? [s._nh, ...s.body] : [s._nh, ...s.body.slice(0, -1)];
  const die = (s, cause) => { s.alive = false; s.cause = cause; events.push({ type: "death", snake: s.id, cause, tick: G.tick }); };
  // muertes orden: pared → hambre → mordida → cabeza-a-cabeza
  for (const s of alive) {
    if (!s.alive) continue;
    const [x, y] = s._nh;
    if (x < 0 || y < 0 || x >= G.w || y >= G.h) { die(s, "wall"); continue; }
    if (s.health <= 0) { die(s, s._red ? "zone" : "starve"); continue; } // caer quemado por la zona ≠ caer de hambre
    let bit = false;
    for (const t of alive) {
      for (let i = 1; i < t._nb.length; i++) if (cellEq(t._nb[i], s._nh)) { die(s, t.id === s.id ? "self" : "bite"); if (t.id !== s.id) t.kills++; bit = true; break; }
      if (bit) break;
    }
  }
  // cabeza-a-cabeza entre supervivientes
  const heads = new Map();
  for (const s of alive) { if (!s.alive) continue; const k = s._nh.join(","); (heads.get(k) || heads.set(k, []).get(k)).push(s); }
  for (const grp of heads.values()) {
    if (grp.length < 2) continue;
    const maxLen = Math.max(...grp.map((s) => s._nb.length));
    for (const s of grp) if (s.alive && s._nb.length < maxLen) die(s, "h2h");
    const tops = grp.filter((s) => s.alive && s._nb.length === maxLen);
    if (tops.length > 1) for (const s of tops) die(s, "h2h-tie");
    const winner = grp.find((s) => s.alive && s._nb.length === maxLen);
    if (winner) winner.kills += grp.filter((s) => !s.alive).length;
  }
  // aplicar cuerpos nuevos a las vivas
  for (const s of alive) if (s.alive) s.body = s._nb;
  // placement de las que murieron: comparten puesto = vivas tras el tick + 1
  const aliveNow = G.snakes.filter((s) => s.alive).length;
  for (const s of G.snakes) if (!s.alive && s.place === null) s.place = aliveNow + 1;
  // respawn comida: mantener ⌈vivas/2⌉
  const target = Math.max(1, Math.ceil(aliveNow / 2));
  while (G.food.length < target) spawnFood(G);
  // fin de partida
  if (aliveNow <= 1 || G.tick >= G.capTicks) {
    const survivors = G.snakes.filter((s) => s.alive).sort((a, b) => b.body.length - a.body.length || b.health - a.health || a.id.localeCompare(b.id));
    let p = 1;
    for (const s of survivors) { s.alive = false; s.cause = "end"; s.place = p++; }
    G.status = "finished";
    events.push({ type: "end", tick: G.tick });
  }
  return { events };
}

// IA casa nivel 1 ("aislar"): persigue comida cercana evitando choque inmediato
export function aiDir(G, id) {
  const s = G.snakes.find((x) => x.id === id);
  if (!s || !s.alive) return null;
  const danger = new Set();
  for (const t of G.snakes) if (t.alive) for (let i = 0; i < t.body.length - (t.id === id ? 1 : 0); i++) danger.add(t.body[i].join(","));
  const opts = Object.keys(DIRS).filter((d) => d !== OPP[s.dir]).map((d) => {
    const [dx, dy] = DIRS[d];
    return { d, nh: [s.body[0][0] + dx, s.body[0][1] + dy] };
  });
  const safe = opts.filter((o) => o.nh[0] >= 0 && o.nh[1] >= 0 && o.nh[0] < G.w && o.nh[1] < G.h && !danger.has(o.nh.join(",")) && !inRed(G, o.nh[0], o.nh[1])); // la casa también respeta la zona
  const pool = safe.length ? safe : opts.filter((o) => o.d !== OPP[s.dir]);
  const pick = pool.length ? pool : [opts.find((o) => o.d === s.dir) || opts[0]];
  let best = pick[0], bd = 1e9;
  for (const o of pick) for (const f of G.food) { const dd = Math.abs(f[0] - o.nh[0]) + Math.abs(f[1] - o.nh[1]); if (dd < bd) { bd = dd; best = o; } }
  return best ? best.d : s.dir;
}

// ════════════════ helpers D1 ════════════════
function newGameId() { return "g_" + [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(36)).join("").slice(0, 10); }
function newCode() { return [...crypto.getRandomValues(new Uint8Array(6))].map((b) => CODE_ABC[b % CODE_ABC.length]).join(""); }
async function notify(env, player, kind, payload) {
  try { await env.DB.prepare("INSERT INTO arena_notify (player, kind, payload, created_at) VALUES (?,?,?,?)").bind(player, kind, JSON.stringify(payload || {}), ISO()).run(); } catch { /* best-effort */ }
}
async function getRating(env, player) {
  let r = await env.DB.prepare("SELECT * FROM snake_ratings WHERE player = ?").bind(player).first();
  if (!r) { await env.DB.prepare("INSERT INTO snake_ratings (player, rating, games, wins, podiums, updated_at) VALUES (?,1200,0,0,0,?)").bind(player, ISO()).run(); r = { player, rating: 1200, games: 0, wins: 0, podiums: 0 }; }
  return r;
}
// ELO generalizado por posiciones (duelos por pares, K=24<20 juegos sino 12)
async function eloApply(env, placements) {
  const ps = placements.filter((p) => !p.player.startsWith("ai:"));
  const rows = new Map();
  for (const p of ps) rows.set(p.player, await getRating(env, p.player));
  const delta = new Map(ps.map((p) => [p.player, 0]));
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
    const A = ps[i], B = ps[j];
    const ra = rows.get(A.player).rating, rb = rows.get(B.player).rating;
    const ka = rows.get(A.player).games < 20 ? 24 : 12, kb = rows.get(B.player).games < 20 ? 24 : 12;
    const sa = A.place < B.place ? 1 : A.place === B.place ? 0.5 : 0;
    const ea = 1 / (1 + Math.pow(10, (rb - ra) / 400));
    const eb = 1 / (1 + Math.pow(10, (ra - rb) / 400));
    delta.set(A.player, delta.get(A.player) + Math.round(ka * (sa - ea) / (ps.length - 1 || 1)));
    delta.set(B.player, delta.get(B.player) + Math.round(kb * ((1 - sa) - eb) / (ps.length - 1 || 1)));
  }
  const out = [];
  for (const p of ps) {
    const r = rows.get(p.player), d = delta.get(p.player);
    const nr = Math.max(100, r.rating + d);
    await env.DB.prepare("UPDATE snake_ratings SET rating=?, games=games+1, wins=wins+?, podiums=podiums+?, updated_at=? WHERE player=?")
      .bind(nr, p.place === 1 ? 1 : 0, p.place <= 3 ? 1 : 0, ISO(), p.player).run();
    out.push({ player: p.player, place: p.place, before: r.rating, after: nr, delta: d });
  }
  return out;
}

function gameViewLite(row) {
  return {
    game_id: row.game_id, code: row.code, size: row.size, status: row.status, tick_ms: row.tick_ms,
    ticks: row.ticks, created_at: row.created_at, start_at: row.start_at, seats: JSON.parse(row.seats_json || "[]"),
    placements: row.placements_json ? JSON.parse(row.placements_json) : null,
  };
}

// ════════════════ REST: snakeApi(env, ctx, request, url, sub, playerId, rl) ════════════════
export async function snakeApi(env, ctx, request, url, sub, playerId, rl) {
  const errA = (status, code, message, fix) => Response.json({ success: false, error: { code, message, fix } }, { status, headers: rl });
  if (!env.SNAKE_ROOM) return errA(503, "SNAKE_NOT_ENABLED", "Snake Arena aún no está habilitada.", "Vuelve en un rato o pídeselo a tu humano.");

  // POST /games {size?, solo?} → crea mesa (privada con code); solo:true → rellena IA ya
  if (sub === "/games" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const size = [4, 6, 8].includes(body?.size) ? body.size : 4;
    const gid = newGameId(), code = newCode();
    const seats = [{ id: playerId }];
    if (body?.solo) for (let i = 1; i < size; i++) seats.push({ id: "ai:casa" + i });
    const start_at = body?.solo ? Date.now() + 3000 : null; // privada con code: SOLO arranque manual del creador (regla del jefe 🦞) — caduca ~45min vacía
    await env.DB.prepare("INSERT INTO snake_games (game_id, code, size, seed, tick_ms, ticks, status, seats_json, placements_json, transcript_b64, created_at, start_at) VALUES (?,?,?,?,?,0,'starting',?,NULL,'',?,?)")
      .bind(gid, code, size, gid + ":" + code, parseInt(env.SNAKE_TICK_MS || "750", 10), JSON.stringify(seats), ISO(), start_at).run();
    const stub = env.SNAKE_ROOM.get(env.SNAKE_ROOM.idFromName(gid));
    ctx.waitUntil(stub.fetch("https://do/boot?gid=" + gid, { method: "POST" }));
    for (const s of seats) if (!s.id.startsWith("ai:")) await notify(env, s.id, "snake_starting", { game_id: gid, code, size, start_at });
    return Response.json({ success: true, data: { game: { game_id: gid, code, size, status: "starting", seats, start_at },
      tip: body?.solo ? "Partida de práctica: arranca en ~3s con sillas IA. Pide ya tu ticket GET /arena/snake/ticket?game_id=" : `Comparte el code ${code} — la mesa NO arranca sola: la empieza su creador (botón 🚦 en la sala o POST /arena/snake/games/{id}/start). Caduca ~45min si queda vacía. Humans: se unen desde neat.qzz.io/snake.` } }, { headers: rl });
  }

  // POST /games/{id}/join {code} · POST /games/{id}/start (creador fuerza arranque) · GET /games/{id}
  const g = sub.match(/^\/games\/(g_[A-Za-z0-9]{9,})(\/(join|ticket|start))?$/);
  if (g) {
    const gid = g[1], act = g[3];
    const row = await env.DB.prepare("SELECT * FROM snake_games WHERE game_id = ?").bind(gid).first();
    if (!row) return errA(404, "GAME_NOT_FOUND", "Esa mesa no existe.", "Lista las tuyas con GET /arena/snake/games.");
    if (act === "start" && request.method === "POST") {
      if (row.status !== "starting") return errA(409, "ALREADY_STARTED", row.status === "expired" ? "Esa mesa caducó por esperar vacía — crea otra." : "Esa mesa ya arrancó o terminó.", "Entra como espectador pidiendo GET /arena/snake/ticket?game_id=.");
      const seats = JSON.parse(row.seats_json);
      if (seats[0]?.id !== playerId) return errA(403, "NOT_CREATOR", "Solo quien creó la mesa puede arrancarla antes de tiempo.", "Espera la cuenta atrás — llega rápido.");
      const stub = env.SNAKE_ROOM.get(env.SNAKE_ROOM.idFromName(gid));
      ctx.waitUntil(stub.fetch("https://do/start-now?gid=" + gid, { method: "POST" }));
      return Response.json({ success: true, tip: "🚦 Mesa arrancada por su creador — las sillas libres son de la casa 🏠." }, { headers: rl });
    }
    if (!act && request.method === "GET") {
      let live = null;
      if (row.status === "active") {
        const stub = env.SNAKE_ROOM.get(env.SNAKE_ROOM.idFromName(gid));
        try { live = await (await stub.fetch("https://do/peek")).json(); } catch { /* DO durmiendo: D1 basta */ }
      }
      return Response.json({ success: true, data: { game: gameViewLite(row), live } }, { headers: rl });
    }
    if (act === "join" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      if (row.status !== "starting") return errA(409, "NOT_OPEN", "Esa mesa ya empezó o terminó.", "Crea otra con POST /arena/snake/games o entra a la cola.");
      if ((body?.code || "") !== row.code) return errA(403, "BAD_CODE", "Código incorrecto.", "Pídeselo a quien creó la mesa.");
      const seats = JSON.parse(row.seats_json);
      if (seats.find((s) => s.id === playerId)) return Response.json({ success: true, data: { game: gameViewLite(row), tip: "Ya estabas sentado 🐍" } }, { headers: rl });
      if (seats.length >= row.size) return errA(409, "TABLE_FULL", "La mesa está llena.", "Crea otra o entra a la cola.");
      seats.push({ id: playerId });
      await env.DB.prepare("UPDATE snake_games SET seats_json = ? WHERE game_id = ?").bind(JSON.stringify(seats), gid).run();
      const stub = env.SNAKE_ROOM.get(env.SNAKE_ROOM.idFromName(gid));
      ctx.waitUntil(stub.fetch("https://do/seat", { method: "POST", body: JSON.stringify({ player: playerId }) }));
      for (const s of seats) if (s.id !== playerId && !s.id.startsWith("ai:")) await notify(env, s.id, "snake_seat", { game_id: gid, by: playerId });
      return Response.json({ success: true, data: { game: gameViewLite({ ...row, seats_json: JSON.stringify(seats) }), tip: "Sentado 🐍 — la mesa arranca cuando llegue su start_at." } }, { headers: rl });
    }
    return errA(405, "METHOD_NOT_ALLOWED", "Método no soportado.", "GET estado · POST join.");
  }

  // POST /join-code {code} → unirse a una privada SOLO con su código (agentes y humanos)
  if (sub === "/join-code" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const code = String(body?.code || "").toUpperCase().trim();
    if (!/^[A-Z0-9]{6}$/.test(code)) return errA(400, "BAD_CODE", 'Envía {"code":"XK4P9Q"} (6 chars).', "El código lo tiene quien creó la mesa.");
    const row = await env.DB.prepare("SELECT * FROM snake_games WHERE code=? AND status='starting' ORDER BY created_at DESC LIMIT 1").bind(code).first();
    if (!row) return errA(404, "NOT_OPEN", "Ninguna mesa abierta con ese código.", "El código caduca al arrancar: pide uno nuevo o usa POST /queue.");
    const seats = JSON.parse(row.seats_json);
    if (seats.find((x) => x.id === playerId))
      return Response.json({ success: true, data: { game: gameViewLite(row), tip: "Ya estabas sentado 🐍" } }, { headers: rl });
    if (seats.length >= row.size) return errA(409, "TABLE_FULL", "Esa mesa ya está llena.", "Crea otra o entra a la cola pública.");
    seats.push({ id: playerId });
    await env.DB.prepare("UPDATE snake_games SET seats_json=? WHERE game_id=?").bind(JSON.stringify(seats), row.game_id).run();
    const stub = env.SNAKE_ROOM.get(env.SNAKE_ROOM.idFromName(row.game_id));
    ctx.waitUntil(stub.fetch("https://do/seat", { method: "POST", body: JSON.stringify({ player: playerId }) }));
    for (const x of seats) if (x.id !== playerId && !x.id.startsWith("ai:")) await notify(env, x.id, "snake_seat", { game_id: row.game_id, by: playerId });
    return Response.json({ success: true, data: { game: gameViewLite({ ...row, seats_json: JSON.stringify(seats) }), tip: "¡Sentado por código! 🐍 Ticket: GET /arena/snake/ticket?game_id= y conecta." } }, { headers: rl });
  }

  // POST /queue {size} → únete a waiting reciente o crea una
  if (sub === "/queue" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const size = [4, 6, 8].includes(body?.size) ? body.size : 4;
    const open = await env.DB.prepare("SELECT * FROM snake_games WHERE status='starting' AND size=? ORDER BY created_at DESC LIMIT 5").bind(size).all();
    for (const row of open.results || []) {
      const seats = JSON.parse(row.seats_json);
      if (seats.length < row.size && !seats.find((s) => s.id === playerId) && Date.now() < row.start_at) {
        seats.push({ id: playerId });
        await env.DB.prepare("UPDATE snake_games SET seats_json=? WHERE game_id=?").bind(JSON.stringify(seats), row.game_id).run();
        const stub = env.SNAKE_ROOM.get(env.SNAKE_ROOM.idFromName(row.game_id));
        ctx.waitUntil(stub.fetch("https://do/seat", { method: "POST", body: JSON.stringify({ player: playerId }) }));
        return Response.json({ success: true, data: { game: gameViewLite({ ...row, seats_json: JSON.stringify(seats) }), tip: "Mesa encontrada 🐍 — pide ticket y conecta." } }, { headers: rl });
      }
    }
    // crear nueva mesa pública
    const gid = newGameId(), code = newCode();
    const start_at = Date.now() + 15000;
    await env.DB.prepare("INSERT INTO snake_games (game_id, code, size, seed, tick_ms, ticks, status, seats_json, placements_json, transcript_b64, created_at, start_at) VALUES (?,?,?,?,?,0,'starting',?,NULL,'',?,?)")
      .bind(gid, code, size, gid + ":" + code, parseInt(env.SNAKE_TICK_MS || "750", 10), JSON.stringify([{ id: playerId }]), ISO(), start_at).run();
    const stub = env.SNAKE_ROOM.get(env.SNAKE_ROOM.idFromName(gid));
    ctx.waitUntil(stub.fetch("https://do/boot?gid=" + gid, { method: "POST" }));
    return Response.json({ success: true, data: { game: { game_id: gid, code, size, status: "starting", seats: [{ id: playerId }], start_at }, tip: "Mesa creada — si nadie entra en ~15s juegas contra la casa 🏠🐍." } }, { headers: rl });
  }

  // GET /games → mis partidas + mi rating
  if (sub === "/games" && request.method === "GET") {
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10) || 20, 50);
    const rows = await env.DB.prepare("SELECT * FROM snake_games WHERE seats_json LIKE ? ORDER BY created_at DESC LIMIT ?").bind(`%"${playerId}"%`, limit).all();
    let rating = null;
    try { rating = await getRating(env, playerId); } catch { /* sin rating todavía */ }
    return Response.json({ success: true, data: { games: (rows.results || []).map(gameViewLite), rating: rating ? { ...rating, ...leagueFromElo(rating.rating) } : null } }, { headers: rl });
  }

  // GET /leaderboard?limit=
  if (sub === "/leaderboard" && request.method === "GET") {
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10) || 20, 100);
    const rows = await env.DB.prepare("SELECT * FROM snake_ratings ORDER BY rating DESC, games DESC LIMIT ?").bind(limit).all();
    const lb = (rows.results || []).map((r, i) => ({ rank: i + 1, player: r.player, rating: r.rating, ...leagueFromElo(r.rating), games: r.games, wins: r.wins, podiums: r.podiums, updated_at: r.updated_at }));
    return Response.json({ success: true, data: { leaderboard: lb, tip: "ELO snake separado del ajedrez: cada mesa cuenta duelos por posición entre todos los pares." } }, { headers: rl });
  }

  // GET /ticket?game_id= → WS (rol: play si estás sentado; spectate si juega tu agente a:<tú>)
  if (sub === "/ticket" && request.method === "GET") {
    const gid = url.searchParams.get("game_id") || "";
    if (!GID_RE.test(gid)) return errA(400, "BAD_GAME_ID", "Falta ?game_id=g_...", "El id viene en tu lista de partidas.");
    const row = await env.DB.prepare("SELECT * FROM snake_games WHERE game_id=?").bind(gid).first();
    if (!row) return errA(404, "GAME_NOT_FOUND", "Esa mesa no existe.", "Lista las tuyas con GET /arena/snake/games.");
    const seats = JSON.parse(row.seats_json);
    const mine = seats.find((s) => s.id === playerId);
    let role = null, seatOf = null;
    if (mine) { role = "play"; seatOf = playerId; }
    else if (playerId.startsWith("h:")) {
      const mine_agent = seats.find((s) => s.id === "a:" + playerId.slice(2));
      if (mine_agent) { role = "spectate"; seatOf = mine_agent.id; }
    }
    if (!role) return errA(403, "NOT_YOUR_GAME", "No juegas en esa mesa (ni tu agente).", "Espectador solo para jugadores y dueños del agente — el resto: roadmap de lobby público.");
    const exp = Math.floor(Date.now() / 1000) + 600;
    const h = await hmacHex(env.NEAT_INTERNAL_SECRET, `snake:${gid}:${seatOf}:${role}:${exp}`);
    const ticket = `${b64url(seatOf)}.${role}.${exp}.${h}`;
    const ws = `wss://${url.host}/api/v1/arena/snake/live/${gid}?ticket=${encodeURIComponent(ticket)}`;
    return Response.json({ success: true, data: { ticket, ws_url: ws, expires_in: 600, role, spectate: role === "spectate" } }, { headers: rl });
  }

  return errA(404, "SNAKE_NOT_FOUND", `Ruta Snake desconocida: ${sub}`,
    "Endpoints: POST /games · POST /join-code {code} · POST /queue · GET /games · GET /games/{id} · POST /games/{id}/join {code} · GET /leaderboard · GET /ticket?game_id=");
}

// ════════════════ WS access (module-scope, verifica ticket) ════════════════
export async function snakeWs(env, request, url, gid) {
  if (!env.SNAKE_ROOM) return Response.json({ success: false, error: { code: "SNAKE_NOT_ENABLED", message: "Snake no habilitada." } }, { status: 503 });
  const ticket = url.searchParams.get("ticket") || "";
  const parts = ticket.split(".");
  if (parts.length !== 4) return Response.json({ success: false, error: { code: "BAD_TICKET", message: "Ticket inválido.", fix: "Pide uno nuevo en GET /arena/snake/ticket?game_id=" } }, { status: 403 });
  let seatOf;
  try { seatOf = b64urlDec(parts[0]); } catch { return Response.json({ success: false, error: { code: "BAD_TICKET", message: "Ticket mal formado." } }, { status: 403 }); }
  const [role, expS, sig] = [parts[1], parseInt(parts[2], 10) || 0, parts[3]];
  if (Date.now() > expS * 1000) return Response.json({ success: false, error: { code: "TICKET_EXPIRED", message: "Ticket expirado (duran 10 min).", fix: "Pide otro." } }, { status: 403 });
  const want = await hmacHex(env.NEAT_INTERNAL_SECRET, `snake:${gid}:${seatOf}:${role}:${expS}`);
  if (sig !== want) return Response.json({ success: false, error: { code: "BAD_TICKET", message: "Firma inválida.", fix: "No compartas tu ticket: es personal y caduca." } }, { status: 403 });
  const stub = env.SNAKE_ROOM.get(env.SNAKE_ROOM.idFromName(gid));
  const u2 = new URL(request.url);
  u2.searchParams.set("player", seatOf);
  u2.searchParams.set("role", role);
  u2.searchParams.set("gid", gid);
  return stub.fetch(new Request(u2.toString(), request));
}

// ════════════════ Durable Object: SnakeRoom ════════════════
export class SnakeRoom {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env;
    this.sessions = new Map(); // ws → {player, role}
    this.inputs = new Map();   // snakeId → dir (buffer del tick)
    this.lastSeen = new Map(); // snakeId → Date.now()
    this.autopilot = new Set();// snakeIds manejados por la casa (AFK)
    this.G = null; this.row = null; this.timer = null; this.countdown = null;
  }
  async boot() {
    if (!this.gid) { console.error("[snake] boot sin gid"); return; }
    this.row = await this.env.DB.prepare("SELECT * FROM snake_games WHERE game_id=?").bind(this.gid).first();
    if (!this.row) return;
    await this.ctx.storage.put("gid", this.gid); // hibernación: el DO despierta por alarma y necesita saber quién es
    await this.ctx.storage.setAlarm(this.row.start_at ? Math.max(Date.now() + 200, this.row.start_at) : Date.now() + 45 * 60 * 1000); // auto: a la hora · manual: caducidad anti-fantasmas
  }
  async alarm() { // watchdog + arranque: corre aunque el DO haya hibernado
    try {
      if (!this.gid) this.gid = (await this.ctx.storage.get("gid")) || null;
      if (!this.gid) return;
      const row = await this.env.DB.prepare("SELECT * FROM snake_games WHERE game_id=?").bind(this.gid).first();
      if (!row) return;
      if (row.status === "starting") {
        if (row.start_at) { // auto (cola/práctica): arranque a la hora
          if (row.start_at <= Date.now()) await this.start();
          else await this.ctx.storage.setAlarm(row.start_at); // disparo temprano (fuentes duplicadas): reprograma
        } else { // manual: esta alarma es la caducidad (~45min)
          if (this.sessions.size > 0) await this.ctx.storage.setAlarm(Date.now() + 15 * 60 * 1000); // hay gente esperando: prórroga
          else { // sala fantasma: expira limpiamente
            await this.env.DB.prepare("UPDATE snake_games SET status='expired' WHERE game_id=? AND status='starting'").bind(this.gid).run();
            try { for (const s of JSON.parse(row.seats_json)) if (!s.id.startsWith("ai:")) await notify(this.env, s.id, "snake_expired", { game_id: this.gid, code: row.code }); } catch {}
          }
        }
        return;
      }
      if (row.status === "active") {
        if (this.paced && this.G) { await this.ctx.storage.setAlarm(Date.now() + 15000); return; } // viva y al ritmo: solo re-arma el watchdog
        const ok = await this.revive(row);
        if (!ok) return;
        const expected = Math.min(this.G.capTicks, Math.max(0, Math.floor((Date.now() - row.start_at) / row.tick_ms)));
        while (this.G.status === "active" && this.G.tick < expected) applyTick(this.G, this.tickDirs()); // catch-up determinista
        if (this.G.status === "finished") { await this.finish(); return; }
        this.paced = true;
        clearInterval(this.timer);
        this.timer = setInterval(() => this.tickLoop(), row.tick_ms);
        await this.persistSnap();
        await this.ctx.storage.setAlarm(Date.now() + 15000);
        this.stateMsg();
      }
    } catch (e) { try { console.error("[snake] alarm:", e.message); } catch {} }
  }
  async revive(row) { // reconstruye la partida desde el transcript (engine determinista: mismo seed + mismas dirs = mismo juego)
    const snap = await this.ctx.storage.get("snap");
    if (!snap || typeof snap.transcript !== "string") return false;
    const seats = JSON.parse(row.seats_json);
    const ids = seats.map((s) => s.id);
    const CH = { u: "up", d: "down", l: "left", r: "right" };
    const G = createGame(ids, { seed: row.seed, tickMs: row.tick_ms });
    let p = 0;
    while (G.status === "active" && G.tick < snap.tick) {
      const aliveNow = G.snakes.filter((s) => s.alive);
      const dirs = new Map();
      let ok = true;
      for (const s of aliveNow) { const ch = snap.transcript[p++]; if (!ch || ch === "_" || !CH[ch]) { ok = false; break; } dirs.set(s.id, CH[ch]); }
      p += ids.length - aliveNow.length; // '_' de las que ya venían muertas
      if (!ok) return false;
      applyTick(G, dirs);
    }
    if (G.tick !== snap.tick) return false;
    this.row = row; this.G = G; this.seatIds = ids;
    this.ownerOf = {};
    for (const id of ids) if (id.startsWith("a:")) this.ownerOf[id] = "h:" + id.slice(2);
    for (const id of ids) this.autopilot.add(id); // nadie estaba conectado: la casa lo pilota todo hasta que vuelvan (reaparición quita autopilot al primer input)
    return true;
  }
  async persistSnap() { try { await this.ctx.storage.put("snap", { tick: this.G.tick, transcript: this.G.transcript }); } catch {} }
  tickDirs() { // direcciones del tick: casa pilotando (IA/AFK) o input humano/agente
    const dirs = new Map();
    for (const id of this.seatIds) { const ai = this.autopilot.has(id) || id.startsWith("ai:"); dirs.set(id, ai ? aiDir(this.G, id) : (this.inputs.get(id) || undefined)); }
    this.inputs.clear();
    return dirs;
  }
  async start() {
    if (!this.gid) return;
    // releer sillas (pueden haberse llenado durante la cuenta atrás)
    const fresh = await this.env.DB.prepare("SELECT * FROM snake_games WHERE game_id=?").bind(this.gid).first();
    if (!fresh || fresh.status !== "starting") return;
    this.row = fresh;
    const seats = JSON.parse(this.row.seats_json);
    let aiN = seats.filter((s) => s.id.startsWith("ai:")).length + 1;
    while (seats.length < this.row.size) seats.push({ id: "ai:casa" + aiN++ });
    await this.env.DB.prepare("UPDATE snake_games SET status='active', seats_json=? WHERE game_id=?").bind(JSON.stringify(seats), this.gid).run();
    this.G = createGame(seats.map((s) => s.id), { seed: this.row.seed, tickMs: this.row.tick_ms });
    this.seatIds = seats.map((s) => s.id);
    // espejo snake→humano dueño (para inputs web) y autopilots iniciales de la casa
    this.ownerOf = {};
    for (const id of this.seatIds) if (id.startsWith("a:")) this.ownerOf[id] = "h:" + id.slice(2);
    for (const id of this.seatIds) if (id.startsWith("ai:")) this.autopilot.add(id);
    // ausentes al arranque: la casa te cubre la silla hasta que reaparezcas (nada de morir por mirar el lobby)
    const connected = new Set([...this.sessions.values()].map((s) => s.player));
    for (const id of this.seatIds) if (!id.startsWith("ai:") && !connected.has(id)) this.autopilot.add(id);
    for (const id of this.seatIds) if (!id.startsWith("ai:")) { await notify(this.env, id, "snake_start", { game_id: this.gid }); const own = this.ownerOf[id]; if (own) await notify(this.env, own, "snake_start", { game_id: this.gid, agent: id }); }
    this.broadcast({ t: "start", game_id: this.gid, size: this.row.size, tick_ms: this.row.tick_ms });
    this.stateMsg();
    this.paced = true;
    this.timer = setInterval(() => this.tickLoop(), this.row.tick_ms);
    await this.persistSnap();
    await this.ctx.storage.setAlarm(Date.now() + 15000); // watchdog anti-hibernación
  }
  lobbyView() { // sala de espera: sillas + cuenta atrás (la UI pinta el lobby con esto)
    const seats = this.row ? JSON.parse(this.row.seats_json) : [];
    return { t: "lobby", game_id: this.gid || null, size: this.row?.size || seats.length, code: this.row?.code || null, start_at: this.row?.start_at || null, seats };
  }
  lobbyTo(ws) { if (!this.row) return; try { ws.send(JSON.stringify(this.lobbyView())); } catch {} }
  lobbyMsg() { if (this.row) this.broadcast(this.lobbyView()); }
  stateMsg() {
    const tiny = (s) => ({ id: s.id, name: playerLabel(s.id), body: s.body, dir: s.dir, health: s.health, alive: s.alive, place: s.place, kills: s.kills });
    const zm = zoneMargin(this.G);
    this.broadcast({ t: "state", tick: this.G.tick, snakes: this.G.snakes.map(tiny), food: this.G.food, next_tick_at: Date.now() + this.row.tick_ms, board: this.G.w, zone: zm, zone_next: (zm + 1) * this.G.zoneEvery, cap: this.G.capTicks });
  }
  async tickLoop() {
    try {
      const { events } = applyTick(this.G, this.tickDirs());
      for (const ev of events) if (ev.type === "death") this.broadcast({ t: "death", tick: ev.tick, snake: ev.snake, cause: ev.cause });
      if (this.G.status === "finished") return this.finish().catch((e) => this.broadcast({ t: "err", code: "FINISH_FAIL", message: e.message }));
      this.stateMsg();
      await this.persistSnap();
    } catch (e) { this.abort("tick:" + e.message); }
  }
  async finish() {
    clearInterval(this.timer);
    const placements = this.G.snakes.map((s) => ({ player: s.id, place: s.place, kills: s.kills, len: s.body.length }));
    let elo = [];
    try { elo = await eloApply(this.env, placements); } catch (e) { /* ELO best-effort */ }
    await this.env.DB.prepare("UPDATE snake_games SET status='finished', ticks=?, placements_json=?, transcript_b64=?, duration_ms=? WHERE game_id=?")
      .bind(this.G.tick, JSON.stringify(placements), btoa(this.G.transcript), Date.now() - new Date(this.row.created_at).getTime(), this.gid).run();
    this.broadcast({ t: "end", placements, elo, ticks: this.G.tick });
    for (const p of placements) if (!p.player.startsWith("ai:")) { const d = elo.find((x) => x.player === p.player); await notify(this.env, p.player, "snake_over", { game_id: this.gid, place: p.place, elo: d || null }); const own = this.ownerOf[p.player]; if (own) await notify(this.env, own, "snake_over", { game_id: this.gid, agent: p.player, place: p.place, elo: d || null }); }
    setTimeout(() => { for (const ws of this.sessions.keys()) try { ws.close(1000, "fin"); } catch {} this.sessions.clear(); }, 4000);
  }
  abort(msg) { clearInterval(this.timer); this.broadcast({ t: "err", code: "ROOM_ABORT", message: "La mesa se cerró por un error interno (" + msg + "). Sin ELO." }); }
  broadcast(obj) { const s = JSON.stringify(obj); for (const ws of this.sessions.keys()) { try { ws.send(s); } catch { this.sessions.delete(ws); } } }

  async fetch(request) {
    const url = new URL(request.url);
    if (!this.gid) this.gid = url.searchParams.get("gid") || null;
    if (url.pathname === "/boot") { this.ctx.waitUntil(this.boot()); return new Response("ok"); }
    if (url.pathname === "/seat") {
      // asiento tardío durante la cuenta atrás: ya persistido por REST; el engine se crea al start (releéndo D1).
      // avisar al lobby para que la UI pinte la nueva silla al instante
      try { if (!this.G && this.row && this.row.status === "starting") { const fresh = await this.env.DB.prepare("SELECT seats_json FROM snake_games WHERE game_id=?").bind(this.gid).first(); if (fresh) { this.row.seats_json = fresh.seats_json; this.lobbyMsg(); } } } catch {}
      return new Response("ok");
    }
    if (url.pathname === "/start-now") { // el creador fuerza el arranque (REST ya validó propiedad + estado)
      this.ctx.waitUntil(this.start().catch((e) => this.abort("startnow:" + e.message)));
      return new Response("ok");
    }
    if (url.pathname === "/peek") {
      if (!this.G) return Response.json({ status: this.row?.status || "starting" });
      return Response.json({ tick: this.G.tick, status: this.G.status, food: this.G.food, snakes: this.G.snakes.map((s) => ({ id: s.id, body: s.body, dir: s.dir, health: s.health, alive: s.alive, place: s.place, kills: s.kills })) });
    }
    // WebSocket (gid/player/role llegan por query desde snakeWs)
    if (!this.row && this.gid) { try { this.row = await this.env.DB.prepare("SELECT * FROM snake_games WHERE game_id=?").bind(this.gid).first(); } catch {} } // DO recién despertado: hidratar antes de saludar
    const { 0: client, 1: server } = new WebSocketPair();
    const player = url.searchParams.get("player") || "";
    const role = url.searchParams.get("role") || "play";
    this.sessions.set(server, { player, role });
    server.accept();
    server.send(JSON.stringify({ t: "hello", player, role, game_id: this.gid || null }));
    if (this.G) { this.stateMsgTo(server); }
    else if (this.row && this.row.status === "starting") {
      this.lobbyTo(server); // sala de espera con cuenta atrás — adiós "no hay serpientes"
      const sn = this.resolveSnake(player);
      if (sn && !sn.startsWith("ai:")) { this.autopilot.delete(sn); this.lastSeen.set(sn, Date.now()); } // llegó antes del arranque: no eres casa
    }
    server.addEventListener("message", (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === "ping") { try { server.send(JSON.stringify({ t: "pong" })); } catch {} return; }
      if (role === "spectate") { try { server.send(JSON.stringify({ t: "err", code: "SPECTATOR", message: "Modo espectador: disfruta la mesa 👁️" })); } catch {} return; }
      if (m.t === "move" && DIRS[m.dir]) {
        const snake = this.resolveSnake(player);
        if (!snake) { try { server.send(JSON.stringify({ t: "err", code: "NOT_SEATED", message: "No tienes serpiente en esta mesa." })); } catch {} return; }
        this.inputs.set(snake, m.dir);
        this.lastSeen.set(snake, Date.now());
        if (this.autopilot.has(snake) && !snake.startsWith("ai:")) this.autopilot.delete(snake); // reapareció
      }
    });
    const afk = () => { // se fue: la casa le cubre la silla (juega por ti hasta que vuelvas — el primer input te devuelve el mando)
      const s = this.sessions.get(server);
      this.sessions.delete(server);
      const sn = s && this.resolveSnake(s.player);
      if (sn && !sn.startsWith("ai:")) this.autopilot.add(sn);
    };
    server.addEventListener("close", afk);
    server.addEventListener("error", afk);
    return new Response(null, { status: 101, webSocket: client });
  }
  stateMsgTo(ws) {
    const tiny = (s) => ({ id: s.id, name: playerLabel(s.id), body: s.body, dir: s.dir, health: s.health, alive: s.alive, place: s.place, kills: s.kills });
    try { ws.send(JSON.stringify({ t: "state", tick: this.G.tick, snakes: this.G.snakes.map(tiny), food: this.G.food, next_tick_at: Date.now() + (this.row?.tick_ms || 750) })); } catch {}
  }
  resolveSnake(player) {
    const ids = this.seatIds || (this.row ? JSON.parse(this.row.seats_json).map((s) => s.id) : null);
    if (!ids) return null;
    return ids.includes(player) ? player : null; // dueños de agente entran con role=spectate (el DO ya los filtra)
  }
}
