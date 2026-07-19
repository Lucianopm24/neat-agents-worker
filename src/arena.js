// ═══════════════════════════════════════════════════════════════════
// Neat Arena v0.1 — ajedrez para agentes (y sus humanos)
// Dos ritmos: correspondencia (REST, pull-first) y en vivo (WS + Durable
// Objects). TODO el estado vive en D1: el DO solo acelera la experiencia
// en vivo; si se duerme, la partida sigue íntegra y se rehidrata.
// Motor: ./chess.js (vendored desde neat-apps/chess.html, validado 43/43).
// ═══════════════════════════════════════════════════════════════════
import { Chess, alg } from "./chess.js";

// ── helpers locales (espejo mínimo de los de index.js: módulo autónomo) ──
function errA(status, code, message, fix, headers = {}) {
  return Response.json({ success: false, error: { code, message, fix } }, { status, headers });
}
async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const buf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const ISO = () => new Date().toISOString();
const PLAYER_RE = /^[ah]:[a-zA-Z0-9_]{3,30}$/;
const GID_RE = /^g_[A-Za-z0-9]{10,}$/;
const TERMINAL = ["mate", "stale", "fifty", "rep", "insuf", "resign", "timeout", "draw"];

// ── lógica pura (testeable sin D1) ──────────────────────────────────
function newGameId() {
  return "g_" + [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(36)).join("").slice(0, 12);
}

// "Penguin" | "a:Penguin" | "h:luciano" → id canónico; null si inválido
function normPlayer(raw, defaultPrefix = "a") {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (!s) return null;
  if (!s.includes(":")) s = defaultPrefix + ":" + s;
  return PLAYER_RE.test(s) ? s : null;
}
const playerLabel = (id) => (id || "").split(":")[1] || "?";

// Reconstruye la posición (incl. repeticiones) desde base_fen + SANs.
// sinSANs implícito: la partida SIEMPRE arranca de base_fen (usualmente startpos).
function rebuildChess(row) {
  const ch = new Chess(row.base_fen && row.base_fen !== "startpos" ? row.base_fen : undefined);
  const sans = JSON.parse(row.sans || "[]");
  for (const san of sans) {
    const m = ch.moves().find((x) => ch.san(x) === san);
    if (!m) throw new Error("replay corrupto en SAN: " + san);
    ch.move({ from: alg(m.from), to: alg(m.to), p: m.p || "" });
  }
  return ch;
}

// ELO: K=32 primeras 20 partidas, K=16 después. Sa = 1 | 0.5 | 0 (para A).
function eloNext(ra, ga, rb, gb, sa) {
  const ka = ga < 20 ? 32 : 16, kb = gb < 20 ? 32 : 16;
  const ea = 1 / (1 + Math.pow(10, (rb - ra) / 400));
  const eb = 1 / (1 + Math.pow(10, (ra - rb) / 400));
  return [Math.round(ra + ka * (sa - ea)), Math.round(rb + kb * ((1 - sa) - eb))];
}

// Vista pública de una partida (clocks calculados al vuelo para live).
// ── Ligas Arena: arrancas en 1200 (Plata); sube con cada partida ─────
const LEAGUES = [
  { min: 2000, name: "Leyenda", icon: "👑" },
  { min: 1800, name: "Diamante", icon: "💠" },
  { min: 1600, name: "Platino", icon: "🟦" },
  { min: 1400, name: "Oro", icon: "🥇" },
  { min: 1200, name: "Plata", icon: "🥈" },
  { min: 0, name: "Bronce", icon: "🥉" },
];
function leagueFromElo(rating) {
  const l = LEAGUES.find((x) => rating >= x.min);
  const i = LEAGUES.indexOf(l);
  const nxt = i > 0 ? LEAGUES[i - 1] : null;
  return { league: l.name, icon: l.icon, next: nxt ? { league: nxt.name, at: nxt.min } : null };
}

function gameView(row, nowMs = Date.now(), fullSans = false) {
  const sans = JSON.parse(row.sans || "[]");
  const turn = row.fen.split(" ")[1];
  let cw = row.clock_w, cb = row.clock_b;
  if (row.mode === "live" && row.status === "active" && cw != null && cb != null && row.last_ts) {
    const el = Math.max(0, nowMs - row.last_ts);
    if (turn === "w") cw = Math.max(0, cw - el); else cb = Math.max(0, cb - el);
  }
  return {
    game_id: row.game_id, mode: row.mode, status: row.status, winner: row.winner,
    white: { id: row.white, name: playerLabel(row.white) },
    black: { id: row.black, name: playerLabel(row.black) },
    turn, fen: row.fen, moves: sans.length, sans: fullSans ? sans : sans.slice(-12),
    draw_offer: row.draw_offer || null,
    clocks: cw != null ? { w: cw, b: cb } : null,
    created_at: row.created_at, updated_at: row.updated_at,
  };
}
const sideOf = (row, playerId) => (row.white === playerId ? "w" : row.black === playerId ? "b" : null);
const opponentOf = (row, playerId) => (row.white === playerId ? row.black : row.white);
const ok = (patch, events, elo) => ({ ok: true, patch, events, elo });
const fail = (status, code, message, fix, extra = {}) => ({ ok: false, status, code, message, fix, extra });

// Resultado terminal → parche común + ELO info
function terminalResult(status, winner, row) {
  const sa = winner === "w" ? 1 : winner === "b" ? 0 : 0.5;
  return { status, winner, scoreW: winner === "w" ? 1 : winner === "b" ? 0 : 0.5, scoreB: winner === "b" ? 1 : winner === "w" ? 0 : 0.5, sa };
}

// Aplicar jugada sobre una fila (objeto plano). nowMs = Date.now().
// moveStr: UCI "e2e4"/"e7e8q". ply (opcional): plies que el cliente cree jugados (idempotencia).
// offer: true → esta jugada viene con oferta de tablas adjunta.
function applyMoveLogic(row, playerId, moveStr, ply, offer, nowMs) {
  if (row.status !== "active")
    return fail(409, "GAME_NOT_ACTIVE", `La partida está ${row.status} (no activa).`, "Consulta el estado con GET de la partida.", { game: gameView(row, nowMs) });
  const side = sideOf(row, playerId);
  if (!side) return fail(403, "NOT_YOUR_GAME", "No juegas en esta partida.", "Solo mueven los dos jugadores.");
  if (typeof moveStr !== "string" || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(moveStr))
    return fail(400, "BAD_MOVE_FORMAT", "Jugada inválida.", 'Formato UCI: "e2e4" o "e7e8q" (promoción).');
  let ch;
  try { ch = rebuildChess(row); } catch (e) { return fail(500, "REPLAY_CORRUPT", "No pude reconstruir la partida.", "Repórtalo a tu humano (estado inconsistente)."); }
  if (ch.turn !== side)
    return fail(409, "NOT_YOUR_TURN", "No es tu turno.", "Juega " + (ch.turn === "w" ? playerLabel(row.white) : playerLabel(row.black)) + "; espera el your_turn o consulta el estado.");
  const sans = JSON.parse(row.sans || "[]");
  if (ply !== undefined && ply !== null && ply !== sans.length)
    return fail(409, "PLY_MISMATCH", `Tu ply (${ply}) no coincide con el actual (${sans.length}).`, "Recarga la partida: otra jugada entró antes (¿reintento duplicado?).", { current_ply: sans.length });

  // relojes (live): descuento al bando que mueve; si cae la bandera, pierde
  let cw = row.clock_w, cb = row.clock_b;
  const patch = { last_ts: nowMs, updated_at: new Date(nowMs).toISOString() };
  if (row.mode === "live") {
    const el = Math.max(0, nowMs - (row.last_ts || nowMs));
    if (side === "w") cw = Math.max(0, (cw ?? 600000) - el); else cb = Math.max(0, (cb ?? 600000) - el);
    if ((side === "w" ? cw : cb) <= 0) {
      const t = terminalResult("timeout", side === "w" ? "b" : "w", row);
      patch.clock_w = cw; patch.clock_b = cb; patch.status = t.status; patch.winner = t.winner; patch.draw_offer = null;
      const opp = opponentOf(row, playerId);
      return ok(patch, [
        { to: playerId, kind: "game_over", payload: { game_id: row.game_id, status: t.status, winner: t.winner } },
        { to: opp, kind: "game_over", payload: { game_id: row.game_id, status: t.status, winner: t.winner } },
      ], { white: row.white, black: row.black, scoreW: t.scoreW, scoreB: t.scoreB });
    }
  }
  const res = ch.move(moveStr);
  if (!res) return fail(422, "ILLEGAL_MOVE", `"${moveStr}" no es legal en esta posición.`, "Pide el FEN actual y genera legales con tu motor; recuerda declarar promoción (…q/r/b/n).");
  sans.push(res.san);
  patch.fen = ch.fen(); patch.sans = JSON.stringify(sans);
  patch.clock_w = cw; patch.clock_b = cb;
  // oferta de tablas: cualquier jugada limpia la oferta previa del OTRO (declinación implícita);
  // si esta jugada trae offer:true, queda oferta del que movió.
  patch.draw_offer = offer ? playerId : (row.draw_offer === playerId ? playerId : null);
  if (row.draw_offer && row.draw_offer !== playerId && !offer) patch.draw_offer = null;

  const o = ch.over();
  const opp = opponentOf(row, playerId);
  if (o) {
    const t = terminalResult(o.r === "mate" ? "mate" : o.r, o.r === "mate" ? side : null, row);
    patch.status = t.status; patch.winner = t.winner; patch.draw_offer = null;
    return ok(patch, [
      { to: playerId, kind: "game_over", payload: { game_id: row.game_id, status: t.status, winner: t.winner, last_san: res.san } },
      { to: opp, kind: "game_over", payload: { game_id: row.game_id, status: t.status, winner: t.winner, last_san: res.san } },
    ], { white: row.white, black: row.black, scoreW: t.scoreW, scoreB: t.scoreB, lastSan: res.san });
  }
  patch.status = "active"; patch.winner = null;
  return ok(patch, [{ to: opp, kind: "your_turn", payload: { game_id: row.game_id, last_san: res.san, moves: sans.length, draw_offer: patch.draw_offer || null } }], { white: row.white, black: row.black, lastSan: res.san });
}

function resignLogic(row, playerId, nowMs) {
  if (row.status !== "active") return fail(409, "GAME_NOT_ACTIVE", "La partida ya terminó.", "Consulta su estado.");
  const side = sideOf(row, playerId);
  if (!side) return fail(403, "NOT_YOUR_GAME", "No juegas en esta partida.", "Solo abandonan los jugadores.");
  const t = terminalResult("resign", side === "w" ? "b" : "w", row);
  const opp = opponentOf(row, playerId);
  return ok({ status: t.status, winner: t.winner, draw_offer: null, updated_at: new Date(nowMs).toISOString() }, [
    { to: playerId, kind: "game_over", payload: { game_id: row.game_id, status: t.status, winner: t.winner } },
    { to: opp, kind: "game_over", payload: { game_id: row.game_id, status: t.status, winner: t.winner } },
  ], { white: row.white, black: row.black, scoreW: t.scoreW, scoreB: t.scoreB });
}

function drawLogic(row, playerId, action, nowMs) {
  if (row.status !== "active") return fail(409, "GAME_NOT_ACTIVE", "La partida ya terminó.", "Consulta su estado.");
  const side = sideOf(row, playerId);
  if (!side) return fail(403, "NOT_YOUR_GAME", "No juegas en esta partida.", "Solo los jugadores pactan tablas.");
  const opp = opponentOf(row, playerId);
  if (action === "offer") {
    if (row.draw_offer === playerId) return fail(409, "DRAW_ALREADY_OFFERED", "Ya tienes una oferta en pie.", "Espera respuesta o sigue jugando.");
    return ok({ draw_offer: playerId, updated_at: new Date(nowMs).toISOString() },
      [{ to: opp, kind: "draw_offer", payload: { game_id: row.game_id, by: playerId } }], null);
  }
  if (action === "accept") {
    if (row.draw_offer !== opp) return fail(409, "NO_DRAW_OFFER", "No hay oferta del rival que aceptar.", "Solo aceptas si el otro ofreció.");
    return ok({ status: "draw", winner: null, draw_offer: null, updated_at: new Date(nowMs).toISOString() }, [
      { to: playerId, kind: "game_over", payload: { game_id: row.game_id, status: "draw", winner: null } },
      { to: opp, kind: "game_over", payload: { game_id: row.game_id, status: "draw", winner: null } },
    ], { white: row.white, black: row.black, scoreW: 0.5, scoreB: 0.5 });
  }
  if (action === "decline") {
    if (row.draw_offer !== opp) return fail(409, "NO_DRAW_OFFER", "No hay oferta del rival que declinar.", "Nada que declinar.");
    return ok({ draw_offer: null, updated_at: new Date(nowMs).toISOString() },
      [{ to: opp, kind: "draw_declined", payload: { game_id: row.game_id, by: playerId } }], null);
  }
  return fail(400, "BAD_DRAW_ACTION", "Acción inválida.", 'action ∈ {"offer","accept","decline"}.');
}

// Crear reto (directo u open). Devuelve fila a insertar + eventos.
function challengeLogic(challenger, { opponent, color = "auto", mode = "corr" }, nowMs) {
  if (!["corr", "live"].includes(mode)) return fail(400, "BAD_MODE", "Modo inválido.", 'mode ∈ {"corr","live"}.');
  if (!["w", "b", "auto"].includes(color)) return fail(400, "BAD_COLOR", "Color inválido.", 'color ∈ {"w","b","auto"}.');
  const live = mode === "live";
  let white, black, status = "active";
  if (opponent === "open") {
    status = "open";
    // color resuelto al aceptar; auto → retador blancas y moneda al aceptar
    white = color === "b" ? "" : challenger;
    black = color === "b" ? challenger : "";
  } else {
    const opp = normPlayer(opponent);
    if (!opp) return fail(400, "BAD_OPPONENT", "Oponente inválido.", 'Usa "NombreAgente", "a:Nombre", "h:humano" u "open".');
    if (opp === challenger) return fail(400, "SELF_CHALLENGE", "No puedes retarte a ti mismo.", "Reta a otro agente/humano, o usa open.");
    const chW = color === "w" || (color === "auto" && crypto.getRandomValues(new Uint8Array(1))[0] < 128);
    white = chW ? challenger : opp;
    black = chW ? opp : challenger;
  }
  const now = ISO();
  const row = {
    game_id: newGameId(), white, black,
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", sans: "[]",
    base_fen: "startpos", status, winner: null, mode, color_pref: color, draw_offer: null,
    clock_w: live ? 600000 : null, clock_b: live ? 600000 : null, last_ts: live ? nowMs : null,
    created_at: now, updated_at: now,
  };
  const events = [];
  if (status === "active") events.push({ to: opponent === "open" ? null : (white === challenger ? black : white), kind: "challenge", payload: { game_id: row.game_id, by: challenger, mode } });
  return ok(row, events, null);
}

// Aceptar reto open
function acceptLogic(row, acceptor, nowMs) {
  if (row.status !== "open") return fail(409, "NOT_OPEN", "Ese reto ya no está abierto.", "Lista retos con GET /arena/chess/games?status=open o crea uno.");
  const challenger = row.white || row.black;
  if (acceptor === challenger) return fail(409, "SELF_ACCEPT", "Es tu propio reto.", "Reta a alguien directamente o espera a otro.");
  let { white, black } = row;
  if (!white) white = acceptor; else if (!black) black = acceptor;
  // color 'auto': moneda (el retador quedó en white provisionalmente)
  if (row.color_pref === "auto" && crypto.getRandomValues(new Uint8Array(1))[0] < 128)
    [white, black] = [black, white];
  const live = row.mode === "live";
  const patch = {
    white, black, status: "active", last_ts: live ? nowMs : null,
    clock_w: live ? 600000 : null, clock_b: live ? 600000 : null,
    updated_at: new Date(nowMs).toISOString(),
  };
  return ok(patch, [{ to: challenger, kind: "accepted", payload: { game_id: row.game_id, by: acceptor, white, black } }], null);
}

// ── persistencia D1 ─────────────────────────────────────────────────
async function arenaLoadGame(env, gameId) {
  return env.DB.prepare("SELECT * FROM arena_games WHERE game_id = ?").bind(gameId).first();
}
const PATCH_COLS = ["white", "black", "fen", "sans", "status", "winner", "draw_offer", "clock_w", "clock_b", "last_ts", "updated_at"];
async function arenaSaveGame(env, gameId, patch) {
  const sets = [], vals = [];
  for (const c of PATCH_COLS) if (patch[c] !== undefined) { sets.push(`${c} = ?`); vals.push(patch[c]); }
  if (!sets.length) return;
  vals.push(gameId);
  await env.DB.prepare(`UPDATE arena_games SET ${sets.join(", ")} WHERE game_id = ?`).bind(...vals).run();
}
async function arenaInsertGame(env, row) {
  await env.DB.prepare(
    "INSERT INTO arena_games (game_id, white, black, fen, sans, base_fen, status, winner, mode, color_pref, draw_offer, clock_w, clock_b, last_ts, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  ).bind(row.game_id, row.white, row.black, row.fen, row.sans, row.base_fen, row.status, row.winner, row.mode, row.color_pref, row.draw_offer, row.clock_w, row.clock_b, row.last_ts, row.created_at, row.updated_at).run();
}
async function arenaNotify(env, events) {
  for (const ev of events) {
    if (!ev.to) continue;
    await env.DB.prepare("INSERT INTO arena_notify (player, kind, payload, created_at) VALUES (?,?,?,?)")
      .bind(ev.to, ev.kind, JSON.stringify(ev.payload || {}), ISO()).run();
  }
}
async function arenaEloApply(env, elo) {
  if (!elo) return {};
  const { white, black, scoreW, scoreB } = elo;
  const get = async (p) => (await env.DB.prepare("SELECT * FROM arena_elo WHERE player = ?").bind(p).first())
    || { player: p, rating: 1200, games: 0, wins: 0, losses: 0, draws: 0 };
  const a = await get(white), b = await get(black);
  const [ra2, rb2] = eloNext(a.rating, a.games, b.rating, b.games, scoreW);
  const now = ISO();
  const put = (p, rating, games, w, l, d) =>
    env.DB.prepare("INSERT INTO arena_elo (player, rating, games, wins, losses, draws, updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(player) DO UPDATE SET rating=excluded.rating, games=excluded.games, wins=excluded.wins, losses=excluded.losses, draws=excluded.draws, updated_at=excluded.updated_at")
      .bind(p, rating, games, w, l, d, now).run();
  await put(white, ra2, a.games + 1, a.wins + (scoreW === 1 ? 1 : 0), a.losses + (scoreW === 0 ? 1 : 0), a.draws + (scoreW === 0.5 ? 1 : 0));
  await put(black, rb2, b.games + 1, b.wins + (scoreB === 1 ? 1 : 0), b.losses + (scoreB === 0 ? 1 : 0), b.draws + (scoreB === 0.5 ? 1 : 0));
  return { white: ra2 - a.rating, black: rb2 - b.rating, white_rating: ra2, black_rating: rb2 };
}

// Aviso a la sala en vivo (si hay DO escuchando) — fire and forget
function pokeRoom(env, ctx, gameId) {
  if (!env.ARENA_ROOM) return;
  try {
    const stub = env.ARENA_ROOM.get(env.ARENA_ROOM.idFromName(gameId));
    const prom = stub.fetch("https://arena.room/broadcast", { method: "POST" }).catch(() => {});
    if (ctx && ctx.waitUntil) ctx.waitUntil(prom);
  } catch { /* DO no disponible: correspondencia sigue igual */ }
}

// ── tickets WebSocket (HMAC scoped: partida+jugador+exp, 10 min) ────
const b64url = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));
async function mintTicket(env, gameId, playerId, role = "play") {
  const exp = Math.floor(Date.now() / 1000) + 600;
  const rl = role === "spectate" ? "s" : "p";
  const h = await hmacHex(env.NEAT_INTERNAL_SECRET, `arena:${gameId}:${playerId}:${rl}:${exp}`);
  return { ticket: `${b64url(playerId)}.${rl}.${exp}.${h}`, expires_in: 600 };
}
async function verifyTicket(env, gameId, ticket) {
  const parts = (ticket || "").split(".");
  if (parts.length !== 4) return null;
  let playerId;
  try { playerId = unb64url(parts[0]); } catch { return null; }
  const role = parts[1] === "s" ? "spectate" : parts[1] === "p" ? "play" : null;
  const exp = parseInt(parts[2], 10);
  if (!PLAYER_RE.test(playerId) || !role || !exp || Date.now() > exp * 1000) return null;
  const want = await hmacHex(env.NEAT_INTERNAL_SECRET, `arena:${gameId}:${playerId}:${parts[1]}:${exp}`);
  if (want !== parts[3]) return null;
  return { playerId, role, exp };
}

// ── ejecución compartida de acciones (usada por REST y por el DO) ──
async function arenaPersistOutcome(env, ctx, gameId, logicRes, row) {
  if (!logicRes.ok) return logicRes;
  await arenaSaveGame(env, gameId, logicRes.patch);
  await arenaNotify(env, logicRes.events);
  let eloDelta = null;
  if (logicRes.elo && logicRes.elo.scoreW !== undefined)
    eloDelta = await arenaEloApply(env, logicRes.elo);
  const fresh = await arenaLoadGame(env, gameId);
  if (fresh && fresh.mode === "live") pokeRoom(env, ctx, gameId);
  return { ...logicRes, eloDelta, fresh };
}

// ── API REST Arena (jugador autenticado: agente o humano admin) ─────
// sub: ruta tras "/arena" (p.ej. "/chess/games"). playerId: "a:X" | "h:x". rl: headers rate-limit.
export async function arenaApi(env, ctx, request, url, sub, playerId, rl = {}) {
  const m = (re) => sub.match(re);
  const jsonBody = async () => { try { return await request.json(); } catch { return null; } };
  const isAgent = playerId.startsWith("a:");

  // POST /chess/challenge {opponent, color?, mode?}
  if (sub === "/chess/challenge" && request.method === "POST") {
    const body = await jsonBody();
    if (!body || typeof body.opponent !== "string")
      return errA(400, "BAD_JSON", 'Body inválido. Envía {"opponent":"Nombre"|"a:Nombre"|"h:humano"|"open", "color":"w"|"b"|"auto", "mode":"corr"|"live"}.', "Ejemplo en GET /docs.md#arena", rl);
    const mode = body.mode || "corr";
    // límites anti-spam
    const openMine = (await env.DB.prepare("SELECT COUNT(*) AS c FROM arena_games WHERE status='open' AND (white=? OR black=?)").bind(playerId, playerId).first())?.c || 0;
    if (body.opponent === "open" && openMine >= 10)
      return errA(429, "TOO_MANY_OPEN", "Máximo 10 retos abiertos tuyos.", "Acepta/cancela alguno antes de crear más.", rl);
    const active = (await env.DB.prepare("SELECT COUNT(*) AS c FROM arena_games WHERE status='active' AND (white=? OR black=?)").bind(playerId, playerId).first())?.c || 0;
    const maxActive = mode === "live" ? 5 : 30;
    if (active >= maxActive)
      return errA(429, "TOO_MANY_GAMES", `Máximo ${maxActive} partidas ${mode} activas.`, "Termina algunas antes de crear más.", rl);
    const res = challengeLogic(playerId, { opponent: body.opponent, color: body.color || "auto", mode }, Date.now());
    if (!res.ok) return errA(res.status, res.code, res.message, res.fix, rl);
    await arenaInsertGame(env, res.patch); // patch ES la fila nueva
    await arenaNotify(env, res.events);
    return Response.json({ success: true, data: { game: gameView(res.patch), tip: res.patch.status === "open" ? "Reto abierto publicado: el primero que acepte juega." : "Partida creada y rival notificado (kind=challenge en /arena/notifications)." } }, { status: 201, headers: rl });
  }

  // POST /chess/accept {game_id}
  if (sub === "/chess/accept" && request.method === "POST") {
    const body = await jsonBody();
    if (!body || !GID_RE.test(body.game_id || "")) return errA(400, "BAD_GAME_ID", "game_id inválido.", 'Envía {"game_id":"g_..."}', rl);
    const row = await arenaLoadGame(env, body.game_id);
    if (!row) return errA(404, "GAME_NOT_FOUND", "Partida no encontrada.", "Verifica el game_id.", rl);
    const res = acceptLogic(row, playerId, Date.now());
    if (!res.ok) return errA(res.status, res.code, res.message, res.fix, rl);
    const out = await arenaPersistOutcome(env, ctx, row.game_id, res, row);
    return Response.json({ success: true, data: { game: gameView(out.fresh), tip: "A jugar. Espera tu turno (your_turn en /arena/notifications) o conéctate al vivo si mode=live." } }, { headers: rl });
  }

  // GET /chess/games?turn=mine&status=&updated_since=
  if (sub === "/chess/games" && request.method === "GET") {
    const status = url.searchParams.get("status");
    const since = url.searchParams.get("updated_since");
    let sql = "SELECT * FROM arena_games WHERE (white = ? OR black = ?)";
    const vals = [playerId, playerId];
    if (status && /^[a-z]+$/.test(status)) { sql += " AND status = ?"; vals.push(status); }
    if (since) { sql += " AND updated_at > ?"; vals.push(since); }
    sql += " ORDER BY updated_at DESC LIMIT 50";
    const { results } = await env.DB.prepare(sql).bind(...vals).all();
    let games = results.map((r) => gameView(r));
    if (url.searchParams.get("turn") === "mine") {
      games = games.filter((g) => g.status === "active" && ((g.turn === "w" ? g.white.id : g.black.id) === playerId));
    }
    return Response.json({ success: true, data: { games, tip: "Pull-first: guarda updated_at más reciente y úsalo como updated_since la próxima vez." } }, { headers: rl });
  }

  // GET /chess/open — retos abiertos (matchmaking)
  if (sub === "/chess/open" && request.method === "GET") {
    const { results } = await env.DB.prepare("SELECT * FROM arena_games WHERE status='open' ORDER BY created_at ASC LIMIT 20").bind().all();
    return Response.json({ success: true, data: { open: results.map((r) => gameView(r)) } }, { headers: rl });
  }

  // GET /chess/leaderboard?limit=20
  if (m(/^\/chess\/leaderboard$/) && request.method === "GET") {
    const limit = Math.min(100, parseInt(url.searchParams.get("limit") || "20", 10) || 20);
    const { results } = await env.DB.prepare("SELECT * FROM arena_elo WHERE games > 0 ORDER BY rating DESC LIMIT ?").bind(limit).all();
    return Response.json({ success: true, data: { leaderboard: results.map((r, i) => ({ rank: i + 1, ...r, ...leagueFromElo(r.rating) })) } }, { headers: rl });
  }

  // GET /notifications?since_id=0 — bandeja de eventos del jugador
  if (sub === "/notifications" && request.method === "GET") {
    const since = parseInt(url.searchParams.get("since_id") || "0", 10) || 0;
    const { results } = await env.DB.prepare("SELECT * FROM arena_notify WHERE player = ? AND id > ? ORDER BY id ASC LIMIT 100").bind(playerId, since).all();
    return Response.json({ success: true, data: { notifications: results.map((r) => ({ ...r, payload: JSON.parse(r.payload) })),
      tip: "Guarda el último id y úsalo como since_id (pull-first, como ?updated_since de notes)." } }, { headers: rl });
  }

  // GET /live/ticket?game_id= → ticket para WSS
  if (sub === "/live/ticket" && request.method === "GET") {
    const gid = url.searchParams.get("game_id") || "";
    if (!GID_RE.test(gid)) return errA(400, "BAD_GAME_ID", "game_id inválido.", "?game_id=g_...", rl);
    const row = await arenaLoadGame(env, gid);
    if (!row) return errA(404, "GAME_NOT_FOUND", "Partida no encontrada.", "Verifica el game_id.", rl);
    let side = sideOf(row, playerId), role = "play";
    if (!side && playerId.startsWith("h:")) {
      // modo espectador: el dueño puede VER la partida en vivo de SU agente (solo lectura)
      const agentOf = "a:" + playerId.slice(2);
      if (row.white === agentOf || row.black === agentOf) { side = "spec"; role = "spectate"; }
    }
    if (!side) return errA(403, "NOT_YOUR_GAME", "No juegas esa partida.", "Solo los jugadores entran al vivo — o el dueño de un agente que juega (espectador).", rl);
    if (row.status !== "active") return errA(409, "GAME_NOT_ACTIVE", "La partida no está activa.", "El vivo es para partidas en curso.", rl);
    const { ticket, expires_in } = await mintTicket(env, gid, playerId, role);
    const ws = `wss://${url.host}/api/v1/arena/live/${gid}?ticket=${encodeURIComponent(ticket)}`;
    return Response.json({ success: true, data: { ticket, ws_url: ws, expires_in, side, spectate: role === "spectate",
      tip: role === "spectate" ? "Modo espectador: recibes {t:'state'} en vivo pero no puedes mover." : "Conecta, recibes {t:'state'} y juegas con {t:'move',move:'e2e4'}. Si el WS cae, la partida sigue viva por REST." } }, { headers: rl });
  }

  // GET /chess/games/{id} (+ POST move|resign|draw)
  const g = m(/^\/chess\/games\/(g_[A-Za-z0-9]{10,})(\/(move|resign|draw))?$/);
  if (g) {
    const gid = g[1], act = g[3];
    const row = await arenaLoadGame(env, gid);
    if (!row) return errA(404, "GAME_NOT_FOUND", "Partida no encontrada.", "Lista tus partidas con GET /arena/chess/games.", rl);
    if (!act && request.method === "GET") {
      const v = gameView(row, Date.now(), url.searchParams.get("full") === "1");
      v.you_are = sideOf(row, playerId);
      return Response.json({ success: true, data: { game: v } }, { headers: rl });
    }
    if (act === "move" && request.method === "POST") {
      const body = await jsonBody();
      const res = applyMoveLogic(row, playerId, body?.move, body?.ply, !!body?.offer, Date.now());
      if (!res.ok) return errA(res.status, res.code, res.message, res.fix, rl);
      const out = await arenaPersistOutcome(env, ctx, gid, res, row);
      return Response.json({ success: true, data: { game: gameView(out.fresh), san: res.elo?.lastSan, elo_delta: out.eloDelta, tip: out.fresh.status === "active" ? "Jugada registrada y rival notificado." : "Partida terminada. ELO actualizado." } }, { headers: rl });
    }
    if (act === "resign" && request.method === "POST") {
      const res = resignLogic(row, playerId, Date.now());
      if (!res.ok) return errA(res.status, res.code, res.message, res.fix, rl);
      const out = await arenaPersistOutcome(env, ctx, gid, res, row);
      return Response.json({ success: true, data: { game: gameView(out.fresh), elo_delta: out.eloDelta } }, { headers: rl });
    }
    if (act === "draw" && request.method === "POST") {
      const body = await jsonBody();
      const res = drawLogic(row, playerId, body?.action, Date.now());
      if (!res.ok) return errA(res.status, res.code, res.message, res.fix, rl);
      const out = await arenaPersistOutcome(env, ctx, gid, res, row);
      return Response.json({ success: true, data: { game: gameView(out.fresh), elo_delta: out.eloDelta } }, { headers: rl });
    }
    return errA(405, "METHOD_NOT_ALLOWED", "Método no soportado.", "GET estado · POST move|resign|draw.", rl);
  }

  return errA(404, "ARENA_NOT_FOUND", `Ruta Arena desconocida: ${sub || "/"}${isAgent ? "" : ""}`,
    "Endpoints: POST /chess/challenge · POST /chess/accept · GET /chess/games · GET /chess/open · GET /chess/games/{id} · POST /chess/games/{id}/move|resign|draw · GET /chess/leaderboard · GET /notifications · GET /live/ticket", rl);
}

// ── acceso WebSocket (ticket auth, NO consume cuota de agente) ──────
export async function arenaWs(env, request, url, gameId, rl = {}) {
  if (!env.NEAT_INTERNAL_SECRET) return errA(503, "NOT_CONFIGURED", "Arena no configurada.", "Falta el secreto interno.", rl);
  if (!env.ARENA_ROOM) return errA(503, "LIVE_NOT_ENABLED", "El modo en vivo aún no está habilitado.", "Usa correspondencia por REST mientras tanto.", rl);
  const t = await verifyTicket(env, gameId, url.searchParams.get("ticket"));
  if (!t) return errA(403, "BAD_TICKET", "Ticket inválido o expirado.", "Pide uno nuevo: GET /arena/live/ticket?game_id= (dura 10 min).", rl);
  const row = await arenaLoadGame(env, gameId);
  if (!row) return errA(404, "GAME_NOT_FOUND", "Partida no encontrada.", "Verifica el game_id.", rl);
  if (row.status !== "active") return errA(409, "GAME_NOT_ACTIVE", "La partida no está activa.", "El vivo es para partidas en curso.", rl);
  let side = sideOf(row, t.playerId);
  if (!side && t.role === "spectate") side = "spec";
  if (!side) return errA(403, "NOT_YOUR_GAME", "No juegas esta partida.", "Solo los jugadores — o su dueño en modo espectador.", rl);
  if ((request.headers.get("upgrade") || "").toLowerCase() !== "websocket")
    return errA(426, "UPGRADE_REQUIRED", "Esta ruta es WebSocket.", `Conecta con ${url.protocol === "https:" ? "wss" : "ws"}:// y el ticket en la query.`, rl);
  const req = new Request(request);
  req.headers.set("x-arena-player", t.playerId);
  req.headers.set("x-arena-side", side);
  req.headers.set("x-arena-role", t.role || "play");
  const stub = env.ARENA_ROOM.get(env.ARENA_ROOM.idFromName(gameId));
  return stub.fetch(req);
}

// ── Durable Object: sala en vivo (Hibernation; D1 sigue siendo la verdad) ──
export class ChessRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.gameId = null;
    this.state.blockConcurrencyWhile(async () => {
      this.gameId = (await this.state.storage.get("gameId")) || null;
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/broadcast" && request.method === "POST") {
      await this.broadcastState();
      return Response.json({ ok: true });
    }
    if ((request.headers.get("upgrade") || "").toLowerCase() !== "websocket")
      return new Response("expected websocket", { status: 426 });
    const playerId = request.headers.get("x-arena-player");
    const side = request.headers.get("x-arena-side");
    const role = request.headers.get("x-arena-role") || "play";
    const gameId = url.pathname.split("/").pop();
    if (!playerId || !side || !GID_RE.test(gameId || ""))
      return new Response("bad arena session", { status: 400 });
    if (!this.gameId) {
      this.gameId = gameId;
      await this.state.storage.put("gameId", gameId);
    }
    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1], [playerId]);
    pair[1].serializeAttachment({ playerId, side, spectate: role === "spectate" });
    pair[1].send(JSON.stringify({ t: "hello", player: playerId, side, spectate: role === "spectate" }));
    await this.sendState(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async loadRow() { return arenaLoadGame(this.env, this.gameId); }

  async sendState(ws) {
    try {
      const row = await this.loadRow();
      if (row) ws.send(JSON.stringify({ t: "state", game: gameView(row, Date.now(), true) }));
    } catch (e) { try { ws.send(JSON.stringify({ t: "err", code: "STATE_ERROR", message: String(e) })); } catch {} }
  }
  async broadcastState() {
    let row;
    try { row = await this.loadRow(); } catch { return; }
    if (!row) return;
    const msg = JSON.stringify({ t: "state", game: gameView(row, Date.now(), true) });
    for (const ws of this.state.getWebSockets()) { try { ws.send(msg); } catch {} }
  }
  broadcast(obj) {
    const msg = JSON.stringify(obj);
    for (const ws of this.state.getWebSockets()) { try { ws.send(msg); } catch {} }
  }

  async webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)); }
    catch { return ws.send(JSON.stringify({ t: "err", code: "BAD_JSON", message: "JSON inválido." })); }
    if (typeof raw === "string" && raw.length > 2048)
      return ws.send(JSON.stringify({ t: "err", code: "TOO_BIG", message: "Mensaje demasiado grande." }));
    const att = ws.deserializeAttachment() || {};
    const playerId = att.playerId;
    if (!playerId) return ws.send(JSON.stringify({ t: "err", code: "NO_SESSION", message: "Sesión sin identidad (reconecta)." }));
    if (att.spectate) {
      if (msg.t === "ping") { await this.sendState(ws); return; }
      return ws.send(JSON.stringify({ t: "err", code: "SPECTATOR", message: "Modo espectador: solo lectura (no mueves, no te rindes, no ofreces tablas)." }));
    }
    if (msg.t === "ping") { await this.sendState(ws); return; }

    const row = await this.loadRow();
    if (!row) return ws.send(JSON.stringify({ t: "err", code: "GAME_GONE", message: "Partida no encontrada." }));
    const nowMs = Date.now();
    let res = null;
    if (msg.t === "move") res = applyMoveLogic(row, playerId, msg.move, msg.ply, !!msg.offer, nowMs);
    else if (msg.t === "resign") res = resignLogic(row, playerId, nowMs);
    else if (msg.t === "draw") res = drawLogic(row, playerId, msg.action, nowMs);
    else return ws.send(JSON.stringify({ t: "err", code: "BAD_TYPE", message: 't ∈ {"move","resign","draw","ping"}.' }));

    if (!res.ok) return ws.send(JSON.stringify({ t: "err", code: res.code, message: res.message, fix: res.fix, extra: res.extra || undefined }));
    await arenaSaveGame(this.env, this.gameId, res.patch);
    await arenaNotify(this.env, res.events);
    let eloDelta = null;
    if (res.elo && res.elo.scoreW !== undefined) eloDelta = await arenaEloApply(this.env, res.elo);
    const fresh = await this.loadRow();
    this.broadcast({ t: "state", game: gameView(fresh, Date.now(), true), last: res.elo?.lastSan || undefined });
    if (fresh.status !== "active")
      this.broadcast({ t: "end", status: fresh.status, winner: fresh.winner, elo: eloDelta });
  }

  async webSocketClose(ws) { /* Hibernation conserva el resto */ }
  async webSocketError(ws) { /* idem */ }
}
