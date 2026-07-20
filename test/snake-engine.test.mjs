// Tests del engine Snake — mismo rigor que el perft del ajedrez 🦞
// Uso: node test/snake-engine.test.mjs
import { createGame, applyTick, aiDir, rngFrom } from "../src/snake.js";

let pass = 0, fails = 0;
const t = (name, cond) => { if (cond) { pass++; console.log("✅", name); } else { fails++; console.log("❌", name); } };
const mkSnake = (id, body, dir, extra = {}) => ({ id, body, dir, health: 100, alive: true, place: null, kills: 0, cause: null, ...extra });
const mkG = (snakes, extra = {}) => ({ w: 11, h: 11, tickMs: 750, capTicks: 200, tick: 0, status: "active", snakes, food: [], transcript: "", rng: rngFrom("test"), ...extra });

// ── 1. pared mata ──
{
  const G = mkG([mkSnake("a:x", [[0, 5], [1, 5], [2, 5]], "left")]);
  applyTick(G, new Map());
  t("pared: muere al salir (cause=wall)", !G.snakes[0].alive && G.snakes[0].cause === "wall");
  t("pared: termina con 0 vivas", G.status === "finished");
}

// ── 2. hambre mata (salud 1, sin comida al alcance) ──
{
  const G = mkG([mkSnake("a:x", [[5, 5], [5, 6], [5, 7]], "up", { health: 1 }), mkSnake("a:y", [[8, 8], [8, 9], [9, 9]], "left")]);
  applyTick(G, new Map());
  t("hambre: health 1→0 muere (cause=starve)", !G.snakes[0].alive && G.snakes[0].cause === "starve");
  t("hambre: la otra gana la mesa (place 1)", G.snakes[1].place === 1 && G.status === "finished");
}

// ── 3. comer crece y restaura salud ──
{
  const G = mkG([mkSnake("a:x", [[5, 5], [5, 6], [5, 7]], "up", { health: 42 })]);
  G.food = [[5, 4]];
  applyTick(G, new Map());
  const s = G.snakes[0];
  t("comer: largo 3→4", s.body.length === 4);
  t("comer: salud restaurada a 100", s.health === 100);
  t("comer: comida retirada y respawn ⌈vivas/2⌉", !G.food.some((f) => f.join() === "5,4") && G.food.length >= 1);
}

// ── 4. moverse a la cola que se RETIRA es legal ──
{
  // baja a (5,4) liberando (5,7)
  const G = mkG([mkSnake("a:x", [[5, 5], [5, 6], [5, 7]], "up"), mkSnake("a:y", [[0, 0], [1, 0], [2, 0]], "down")]); // dummy lejana para que la mesa no cierre
  applyTick(G, new Map());
  t("cola fantasma: no muere al entrar en la casilla que deja su propia cola", G.snakes[0].alive && G.status === "active");
  t("cola fantasma: nuevo cuerpo correcto", JSON.stringify(G.snakes[0].body) === JSON.stringify([[5, 4], [5, 5], [5, 6]]));
}

// ── 5. mordida a cuerpo ajeno mata al intruso y da kill al dueño ──
{
  const A = mkSnake("a:A", [[2, 2], [2, 3], [2, 4]], "right");   // nh=(3,2)
  const B = mkSnake("a:B", [[3, 2], [4, 2], [5, 2], [6, 2]], "down"); // su cabeza/segmento 0 está en (3,2) → A muerde la CABEZA = h2h no bite; mejor usar segmento 1:
  A.body = [[2, 3], [2, 4], [2, 5]]; A.dir = "right"; // nh=(3,3)
  B.body = [[3, 1], [3, 2], [3, 3], [3, 4]]; B.dir = "left"; // B se mueve: nh=(2,1); cuerpo nuevo [(2,1),(3,1),(3,2),(3,3)]
  const G = mkG([A, B]);
  applyTick(G, new Map());
  t("mordida: A muere al entrar en el cuerpo de B (cause=bite)", !A.alive && A.cause === "bite");
  t("mordida: B suma kill", B.kills === 1);
}

// ── 6. cabeza-a-cabeza: gana la larga; empate mueren ambas ──
{
  const G = mkG([
    mkSnake("a:A", [[4, 5], [4, 6], [4, 7], [4, 8]], "right"), // len4, nh=(5,5)
    mkSnake("a:B", [[6, 5], [7, 5], [7, 6]], "left"),          // len3, nh=(5,5)
  ]);
  applyTick(G, new Map());
  t("h2h: la corta muere (cause=h2h)", !G.snakes[1].alive && G.snakes[1].cause === "h2h");
  t("h2h: la larga vive el choque y gana la mesa (cause=end, kill, place 1)", G.snakes[0].cause === "end" && G.snakes[0].kills === 1 && G.snakes[0].place === 1);
}
{
  const G = mkG([
    mkSnake("a:A", [[4, 5], [4, 6], [4, 7]], "right"),
    mkSnake("a:B", [[6, 5], [7, 5], [7, 6]], "left"),
  ]);
  applyTick(G, new Map());
  t("h2h empate: ambas mueren (h2h-tie)", !G.snakes[0].alive && !G.snakes[1].alive && G.snakes[0].cause === "h2h-tie");
  t("h2h empate: comparten place 1", G.snakes[0].place === 1 && G.snakes[1].place === 1);
}

// ── 7. anti-180°: pedir la contraria = seguir recto ──
{
  const G = mkG([mkSnake("a:x", [[5, 5], [4, 5], [3, 5]], "right"), mkSnake("a:y", [[0, 0], [0, 1], [0, 2]], "right")]); // dummy lejana (right: no muerde su cola)
  applyTick(G, new Map([["a:x", "left"]]));
  t("anti-180: ignora reversa (sigue right)", G.snakes[0].dir === "right" && G.snakes[0].alive);
}

// ── 8. determinismo (mismo seed+moves ⇒ mismo JSON final) ──
{
  const run = (seed) => {
    const G = createGame(["a:A", "a:B", "ai:c1", "ai:c2"], { seed });
    let guard = 0;
    while (G.status === "active" && guard++ < 500) {
      const dirs = new Map(G.snakes.filter((s) => s.alive).map((s) => [s.id, aiDir(G, s.id)]));
      applyTick(G, dirs);
    }
    const { rng, ...rest } = G;
    return JSON.stringify(rest);
  };
  t("determinismo: misma seed → mismo resultado byte-exacto", run("revancha") === run("revancha"));
  t("determinismo: seeds distintas divergen", run("s1") !== run("s2"));
}

// ── 9. INVARIANTE montecarlo (el perft del snake): 30 partidas all-AI ──
{
  let okInv = true, allEnded = true, minTicks = 1e9, maxTicks = 0;
  for (let si = 0; si < 30 && okInv; si++) {
    const G = createGame(["a:A", "a:B", "a:C", "ai:c1"], { seed: "mc" + si });
    let guard = 0;
    while (G.status === "active") {
      if (guard++ > 210) { allEnded = false; break; }
      const dirs = new Map(G.snakes.filter((s) => s.alive).map((s) => [s.id, aiDir(G, s.id)]));
      applyTick(G, dirs);
      // invariante: ninguna casilla ocupada por dos serpientes vivas
      const occ = new Set();
      for (const s of G.snakes.filter((x) => x.alive)) for (const c of s.body) {
        const k = c.join(",");
        if (occ.has(k)) { okInv = false; console.log("  💥 solape en", G.seed || "mc" + si, "tick", G.tick, k); }
        occ.add(k);
      }
      // transcript: 1 char por serpiente por tick
      if (G.transcript.length !== G.tick * 4) { okInv = false; console.log("  💥 transcript", G.transcript.length, "vs tick*4", G.tick * 4); }
    }
    minTicks = Math.min(minTicks, G.tick); maxTicks = Math.max(maxTicks, G.tick);
    for (const s of G.snakes) if (s.place == null) { okInv = false; console.log("  💥 serpiente sin place al final", s.id); }
  }
  t(`montecarlo×30: invariante anti-solape + transcripts exactos + places completos (ticks ${minTicks}-${maxTicks})`, okInv);
  t("montecarlo×30: todas terminan dentro del cap", allEnded);
}

// ── 10. la IA no se suicida en campo abierto (duelo de IAs dura, no acaba en 3 ticks) ──
{
  const G = createGame(["ai:casa1", "ai:casa2"], { seed: "duelo" });
  let guard = 0;
  while (G.status === "active" && guard++ < 200) { const dirs = new Map(G.snakes.filter((x) => x.alive).map((x) => [x.id, aiDir(G, x.id)])); applyTick(G, dirs); }
  t(`duelo de IAs dura ≥10 ticks (duró ${G.tick})`, G.tick >= 10);
  t("duelo de IAs termina dentro del cap", G.status === "finished" && G.tick <= 200);
}


// ── Revive (anti-hibernación): reconstruir desde transcript reproduce el estado exacto ──
{
  const ids = ["a:X", "ai:casa1", "h:Y", "ai:casa2"];
  const seed = "revive-test-s1";
  const dirsOf = (G) => { const d = new Map(); for (const id of ids) d.set(id, aiDir(G, id)); return d; };
  const live = createGame(ids, { seed });
  while (live.status === "active" && live.tick < 60) applyTick(live, dirsOf(live));
  // replay estilo DO.revive: dirs de vivas en orden primero, luego "_" de las ya muertas
  const CH = { u: "up", d: "down", l: "left", r: "right" };
  const re = createGame(ids, { seed });
  let p = 0, corrupt = false;
  while (re.status === "active" && re.tick < live.tick) {
    const aliveNow = re.snakes.filter((s) => s.alive);
    const m = new Map();
    for (const s of aliveNow) { const ch = live.transcript[p++]; if (!CH[ch]) { corrupt = true; break; } m.set(s.id, CH[ch]); }
    p += ids.length - aliveNow.length;
    if (corrupt) break;
    applyTick(re, m);
  }
  t("revive: transcript no corrupto en replay", !corrupt);
  t("revive: tick reconstruido", re.tick === live.tick);
  t("revive: transcript idéntico", re.transcript === live.transcript);
  t("revive: estado serpientes idéntico", JSON.stringify(re.snakes.map((s) => [s.body, s.alive, s.health, s.kills])) === JSON.stringify(live.snakes.map((s) => [s.body, s.alive, s.health, s.kills])));
  t("revive: comida idéntica", JSON.stringify(re.food) === JSON.stringify(live.food));
  t("revive: status idéntico (" + re.status + ", tick " + re.tick + ")", re.status === live.status);
}

console.log(`\n${pass} ✅ · ${fails} ❌`);
process.exit(fails ? 1 : 0);

