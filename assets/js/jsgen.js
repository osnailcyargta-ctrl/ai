/* jsgen.js — writes a game as ONE standalone HTML file (canvas + JavaScript + CSS).
 *
 * Experimental "HTML/JS/CSS" mode of sybau code: the same design the planner makes for
 * STS (who the player is, how every thing moves, what happens on contact, how to win)
 * is written out as plain JavaScript instead. Open the .html anywhere, no STS needed.
 *
 * writeHtml(design) -> { html, js, lines }
 */
(function (root) {
  "use strict";
  const J = JSON.stringify;
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  /** an STS expression -> the same thing in JavaScript */
  function expr(e) {
    return String(e)
      .replace(/\/time"(\w+)"/g, (m, n) => `timeLeft(${J(n)})`)
      .replace(/\brandint\(/g, "randint(").replace(/\bstr\(/g, "String(").replace(/\bnum\(/g, "Number(")
      .replace(/\b(ceil|floor|round|abs|min|max|sqrt|sin|cos|pow)\(/g, "Math.$1(")
      .replace(/\band\b/g, "&&").replace(/\bor\b/g, "||").replace(/\bnot\b/g, "!");
  }

  class Out {
    constructor() { this.l = []; this.i = 0; }
    w(s) { this.l.push("  ".repeat(this.i) + s); return this; }
    open(s) { this.w(s + " {"); this.i++; return this; }
    close(s = "}") { this.i--; this.w(s); return this; }
    blank() { if (this.l.length && this.l[this.l.length - 1] !== "") this.l.push(""); return this; }
    text() { return this.l.join("\n"); }
  }

  // the little engine every game uses: objects, drawing, collisions, keys, mouse, timers
  const ENGINE = `
const cv = document.getElementById("game"), ctx = cv.getContext("2d");
const objs = {};          // id -> {shape, x, y, w, h, color, text, size, alive}
const keys = {};
let mouse = { x: -1, y: -1, down: false, clicked: null };
const timers = {};        // countdown name -> seconds left
function obj(id, shape, x, y, w, h, color, extra) { objs[id] = Object.assign({ id, shape, x, y, w, h: h == null ? w : h, color, alive: true }, extra || {}); return objs[id]; }
function exists(id) { return !!(objs[id] && objs[id].alive); }
function destroy(id) { if (objs[id]) objs[id].alive = false; }
function touching(a, b) {
  const p = objs[a], q = objs[b];
  return !!(p && q && p.alive && q.alive && p.x < q.x + q.w && p.x + p.w > q.x && p.y < q.y + q.h && p.y + p.h > q.y);
}
const walls = [];
function move(id, dx, dy) {
  const o = objs[id]; if (!o || !o.alive) return;
  o.x += dx; if (walls.length && o.solid && walls.some((w) => touching(id, w))) o.x -= dx;
  o.y += dy; if (walls.length && o.solid && walls.some((w) => touching(id, w))) o.y -= dy;
}
function setpos(id, x, y) { if (objs[id]) { objs[id].x = x; objs[id].y = y; } }
function randint(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function rand(a, b) { return a + Math.random() * (b - a); }
function choose(...xs) { return xs[Math.floor(Math.random() * xs.length)]; }
function chance(p) { return Math.random() < p; }
function key(k) { return !!keys[k]; }
function timeLeft(n) { return Math.max(0, timers[n] || 0); }
function setText(id, t) { if (objs[id]) objs[id].text = String(t); }
function draw() {
  ctx.fillStyle = BG; ctx.fillRect(0, 0, cv.width, cv.height);
  for (const o of Object.values(objs)) {
    if (!o.alive || o.hidden) continue;
    ctx.fillStyle = ctx.strokeStyle = o.color;
    if (o.shape === "rect" || o.shape === "square") ctx.fillRect(o.x, o.y, o.w, o.h);
    else if (o.shape === "circle" || o.shape === "ellipse") { ctx.beginPath(); ctx.ellipse(o.x + o.w / 2, o.y + o.h / 2, o.w / 2, o.h / 2, 0, 0, 6.2832); ctx.fill(); }
    else if (o.shape === "triangle") { ctx.beginPath(); ctx.moveTo(o.x + o.w / 2, o.y); ctx.lineTo(o.x + o.w, o.y + o.h); ctx.lineTo(o.x, o.y + o.h); ctx.closePath(); ctx.fill(); }
    else if (o.shape === "text") { ctx.font = "600 " + o.size + "px system-ui, sans-serif"; ctx.textBaseline = "top"; ctx.fillText(o.text, o.x, o.y); }
  }
}
const keyName = (e) => (e.key === " " ? "space" : e.key.startsWith("Arrow") ? e.key.slice(5).toLowerCase() : e.key.toLowerCase());
addEventListener("keydown", (e) => { keys[keyName(e)] = true; if (["space", "up", "down", "left", "right"].includes(keyName(e))) e.preventDefault(); });
addEventListener("keyup", (e) => { keys[keyName(e)] = false; });
const toCanvas = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
cv.addEventListener("mousemove", (e) => { [mouse.x, mouse.y] = toCanvas(e); });
cv.addEventListener("mousedown", (e) => { [mouse.x, mouse.y] = toCanvas(e); mouse.down = true; onClickAt(mouse.x, mouse.y); });
addEventListener("mouseup", () => { mouse.down = false; });
const clickHandlers = [];   // [id, fn]
function onClickAt(x, y) {
  for (const [id, fn] of clickHandlers) { const o = objs[id]; if (o && o.alive && x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h) fn(id); }
}
`;

  function writeHtml(d) {
    const L = (a, b) => (d.lang === "en" ? b : a);
    const W = d.stage.w, H = d.stage.h;
    const o = new Out();
    const P = d.player, ents = d.entities || [], widgets = d.widgets || [], hud = d.hud || [];
    o.w(`// written by sybau code for: ${String(d.request || "").replace(/\s+/g, " ").slice(0, 90)}`);
    o.w(`const BG = ${J(d.bg)};`);
    o.w(ENGINE.trim());
    o.blank();
    // ---- state
    o.w("// ---- game state");
    const vars = new Map();
    const v = (n, init) => { if (!vars.has(n)) vars.set(n, init); };
    if (d.score) v("skor", 0);
    if (d.end && d.end.lives) v("nyawa", d.end.lives);
    v("selesai", 0);
    for (const [k, val] of d.vars || []) v(k, val);
    if (P && (P.control === "platform" || P.control === "flappy")) { v("vy", 0); v("diTanah", 1); }
    if (d.shooter) { v("arahX", d.shooter.dx); v("arahY", d.shooter.dy); v("jeda", 0); }
    for (const e of ents) if (e.counter) v(e.counter, 0);
    if (d.cycle) v("lampu", 0);
    if (d.sequence) for (const s of d.sequence) if (s.var) v(s.var, s.number ? 0 : '""');
    for (const [k, val] of vars) o.w(`let ${k} = ${val};`);
    o.blank();
    // ---- hud
    o.open("function tulisHud()");
    for (const h of hud) o.w(`setText(${J(h.id)}, ${J(h.label + ": ")} + (${h.id === "hudLama" ? "Math.round(played) + \"s\"" : expr(h.expr)}));`);
    o.close();
    o.open("function tamat(pesan, warna)");
    o.w("if (selesai) return;");
    o.w("selesai = 1;");
    o.w(`obj("banner", "text", ${Math.round(W / 2 - 120)}, ${Math.round(H / 2 - 24)}, 0, 0, warna, { text: pesan, size: 34 });`);
    o.w(`setTimeout(() => alert(pesan${d.score ? ` + ${J(L(" · skor: ", " · score: "))} + skor` : ""}), 50);`);
    o.close();
    if (d.end && d.end.goal) { o.open("function cekMenang()"); o.w(`if (skor >= ${d.end.goal}) tamat(${J(L("MENANG", "YOU WIN"))}, "#b9e389");`); o.close(); }
    if (d.end && d.end.lives) { o.open("function kena()"); o.w("nyawa -= 1;"); o.w("tulisHud();"); o.w(`if (nyawa <= 0) tamat("GAME OVER", "#e43b44");`); o.close(); }
    o.blank();
    // actions
    const acts = (list, id) => {
      for (const a of list || []) {
        if (a.do === "score") { o.w(`skor += ${a.n == null ? 1 : a.n};`); o.w("tulisHud();"); if (d.end && d.end.goal) o.w("cekMenang();"); }
        else if (a.do === "count") { o.w(`${a.var} += 1;`); o.w("tulisHud();"); if (a.all) o.w(`if (${a.var} >= ${a.all}) tamat(${J(a.winText || L("MENANG", "YOU WIN"))}, "#b9e389");`); }
        else if (a.do === "hurt") o.w(d.end && d.end.lives ? "kena();" : `tamat("GAME OVER", "#e43b44");`);
        else if (a.do === "lose") o.w(`tamat(${J(a.text || "GAME OVER")}, "#e43b44");`);
        else if (a.do === "win") o.w(`tamat(${J(a.text || L("MENANG", "YOU WIN"))}, "#b9e389");`);
        else if (a.do === "respawn") o.w(`taruh${cap(a.key)}(${id});`);
        else if (a.do === "destroy") o.w(`destroy(${id});`);
        else if (a.do === "popup") o.w(`alert(${a.expr ? expr(a.expr) : J(a.text)});`);
        else if (a.do === "add") { o.w(`${a.var} += ${a.n};`); o.w("tulisHud();"); }
        else if (a.do === "set") o.w(`${a.var} = ${expr(a.expr)};`);
        else if (a.do === "text") o.w(`setText(${J(a.target)}, ${expr(a.expr)});`);
        else if (a.do === "color") o.w(`objs[${J(a.target)}].color = choose(${a.colors.map((c) => J(c)).join(", ")});`);
        else if (a.do === "hud") o.w("tulisHud();");
        else if (a.do === "if") { o.open(`if (${expr(a.cond)})`); acts(a.then, id); if (a.else) { o.close("} else {"); o.i++; acts(a.else, id); } o.close(); }
      }
    };
    // ---- behaviour of every kind of thing
    if (P) {
      o.open(`function gerak${cap(P.key)}()`);
      o.w(`const id = ${J(P.id)};`);
      if (P.control === "keys4" || P.control === "keys2") {
        o.w(`if (key("left") || key("a")) { move(id, -${P.speed}, 0);${d.shooter && d.shooter.facing ? " arahX = -1; arahY = 0;" : ""} }`);
        o.w(`if (key("right") || key("d")) { move(id, ${P.speed}, 0);${d.shooter && d.shooter.facing ? " arahX = 1; arahY = 0;" : ""} }`);
        if (P.control === "keys4") {
          o.w(`if (key("up") || key("w")) { move(id, 0, -${P.speed});${d.shooter && d.shooter.facing ? " arahX = 0; arahY = -1;" : ""} }`);
          o.w(`if (key("down") || key("s")) { move(id, 0, ${P.speed});${d.shooter && d.shooter.facing ? " arahX = 0; arahY = 1;" : ""} }`);
        }
      } else if (P.control === "platform") {
        o.w(`if ((key("space") || key("up")) && diTanah) { vy = -${P.jump}; diTanah = 0; }`);
        o.w(`vy += ${P.gravity}; move(id, 0, vy);`);
        o.w(`if (objs[id].y > ${d.ground - P.h}) { objs[id].y = ${d.ground - P.h}; vy = 0; diTanah = 1; }`);
        o.w(`if (key("left")) move(id, -${P.speed}, 0);`);
        o.w(`if (key("right")) move(id, ${P.speed}, 0);`);
      } else if (P.control === "flappy") {
        o.w(`if (key("space") || key("up") || mouse.down) vy = -${P.jump};`);
        o.w(`vy += ${P.gravity}; move(id, 0, vy);`);
        o.w(`if (objs[id].y > ${H - P.h} || objs[id].y < ${d.playTop}) { setpos(id, ${P.x}, ${Math.round((d.playTop + H) / 2)}); vy = 0;${d.end && d.end.lives ? " kena();" : ` tamat("GAME OVER", "#e43b44");`} }`);
      } else if (P.control === "mouse") {
        o.w(`if (mouse.x >= 0) objs[id].x = mouse.x - ${Math.round(P.w / 2)};`);
        o.w(`if (key("left")) move(id, -${P.speed}, 0);`);
        o.w(`if (key("right")) move(id, ${P.speed}, 0);`);
      }
      if (P.control !== "flappy") {
        o.w(`objs[id].x = Math.max(0, Math.min(${W - P.w}, objs[id].x));`);
        if (P.control === "keys4") o.w(`objs[id].y = Math.max(${d.playTop}, Math.min(${H - P.h}, objs[id].y));`);
      }
      if (d.shooter) {
        o.w("jeda -= 1;");
        o.w(`if (key("space") && jeda <= 0) { tembak(); jeda = ${d.shooter.cooldown}; }`);
      }
      o.close();
      o.blank();
    }
    if (d.shooter) {
      const s = d.shooter, pr = s.proj;
      o.w("const peluru = [];   // {id, vx, vy}");
      o.open("function tembak()");
      o.w(`const p = peluru.find((b) => !objs[b.id].alive);`);
      o.w("if (!p) return;");
      o.w(`const me = objs[${J(P.id)}];`);
      o.w(`Object.assign(objs[p.id], { alive: true, x: me.x + ${Math.round(P.w / 2 - pr.w / 2)}, y: me.y + ${Math.round(P.h / 2 - pr.h / 2)} });`);
      o.w(`p.vx = arahX * ${s.speed}; p.vy = arahY * ${s.speed};`);
      o.close();
      o.open("function terbangPeluru()");
      o.open("for (const p of peluru)");
      o.w("const b = objs[p.id]; if (!b.alive) continue;");
      o.w("b.x += p.vx; b.y += p.vy;");
      o.w(`if (b.x < -40 || b.x > ${W} || b.y < -40 || b.y > ${H}) b.alive = false;`);
      o.close();
      o.close();
      o.blank();
    }
    for (const e of ents) {
      if (e.motion === "wall") continue;
      const K = cap(e.key), sp = e.speed || 0;
      o.open(`function taruh${K}(id)`);
      const xr = `randint(${e.area.x0}, ${e.area.x1})`, yr = `randint(${e.area.y0}, ${e.area.y1})`;
      if (e.spawn === "top") o.w(`setpos(id, ${xr}, randint(-260, -30));`);
      else if (e.spawn === "right") o.w(`setpos(id, ${W} + randint(20, 320), ${e.laneY != null ? e.laneY : yr});`);
      else if (e.spawn === "edge") o.w(`if (chance(0.5)) setpos(id, choose(-30, ${W + 10}), ${yr}); else setpos(id, ${xr}, choose(${d.playTop - 30}, ${H + 10}));`);
      else o.w(`setpos(id, ${xr}, ${yr});`);
      o.close();
      o.open(`function urus${K}(id, st)`);
      o.w("const me = objs[id]; if (!me.alive) return;");
      if (e.motion === "fall") { o.w(`me.y += ${sp};`); o.open(`if (me.y > ${H})`); acts(e.onExit, "id"); o.w(`taruh${K}(id);`); o.close(); }
      else if (e.motion === "scroll" || e.motion === "fly") { o.w(`me.x -= ${sp};${e.motion === "fly" ? " me.y += Math.sin(me.x / 28) * 2;" : ""}`); o.open(`if (me.x < ${-e.w - 10})`); acts(e.onExit, "id"); o.w(`taruh${K}(id);`); o.close(); }
      else if (e.motion === "chase") { o.w(`const p = objs[${J(P.id)}];`); o.w(`move(id, Math.sign(p.x - me.x) * ${sp}, Math.sign(p.y - me.y) * ${sp});`); }
      else if (e.motion === "patrol") { o.w(`move(id, st.arah * ${sp}, 0);`); o.w(`if (me.x < 0) st.arah = 1;`); o.w(`if (me.x > ${W - e.w}) st.arah = -1;`); }
      else if (e.motion === "wander" || e.motion === "bounce") {
        if (e.motion === "wander") o.w(`if (chance(0.02)) { st.vx = rand(-${sp}, ${sp}); st.vy = rand(-${sp}, ${sp}); }`);
        o.w("move(id, st.vx, st.vy);");
        o.w(`if (me.x < 0) st.vx = Math.abs(st.vx); if (me.x > ${W - e.w}) st.vx = -Math.abs(st.vx);`);
        o.w(`if (me.y < ${d.playTop}) st.vy = Math.abs(st.vy); if (me.y > ${H - e.h}) st.vy = -Math.abs(st.vy);`);
      }
      if (d.shooter && e.shootable) { o.open("for (const b of peluru)"); o.open("if (touching(id, b.id))"); o.w("objs[b.id].alive = false;"); acts(e.onShot, "id"); o.close(); o.close(); }
      if (P && e.onTouch && e.onTouch.length) { o.open(`if (me.alive && touching(${J(P.id)}, id))`); acts(e.onTouch, "id"); o.close(); }
      if (e.onBall && d.ball) { o.open(`if (me.alive && touching("bola", id))`); acts(e.onBall, "id"); o.close(); }
      o.close();
      if (e.onClick) { o.open(`function diklik${K}(id)`); o.w("if (selesai) return;"); acts(e.onClick, "id"); o.close(); }
      o.blank();
    }
    if (d.ball) {
      if (!(d.vars || []).some(([k]) => k === "bvx")) o.w(`let bvx = 3, bvy = 3;`);
      o.open("function urusBola()");
      o.w(`const b = objs.bola, p = objs[${J(P.id)}];`);
      o.w("b.x += bvx; b.y += bvy;");
      o.w(`if (b.x < 0) bvx = Math.abs(bvx); if (b.x > ${W - d.ball.w}) bvx = -Math.abs(bvx); if (b.y < ${d.playTop}) bvy = Math.abs(bvy);`);
      o.open("if (touching(\"bola\", p.id))"); o.w("bvy = -Math.abs(bvy) - 0.2;"); o.w(`bvx += (b.x - p.x - ${Math.round(P.w / 2)}) / 20;`); acts(d.ball.onPaddle); o.close();
      o.open(`if (b.y > ${H})`); o.w(`setpos("bola", ${Math.round(W / 2)}, ${d.playTop + 40}); bvy = Math.abs(bvy);`); acts(d.ball.onMiss); o.close();
      o.close();
      o.blank();
    }
    if (d.cycle) {
      o.open("function gantiLampu()");
      o.w(`lampu = (lampu + 1) % ${d.cycle.order.length};`);
      for (const l of d.cycle.lamps) o.w(`objs[${J(l.id)}].color = "#3a3a3a";`);
      d.cycle.order.forEach((li, i) => o.w(`if (lampu === ${i}) objs[${J(d.cycle.lamps[li].id)}].color = ${J(d.cycle.lamps[li].color)};`));
      o.close();
    }
    if (d.timeUp) { o.open("function waktuHabis()"); acts(d.timeUp); o.close(); }
    // ---- the world
    o.blank();
    o.w("// ---- build the world");
    o.w(`obj("judul", "text", 16, 10, 0, 0, "#b9e389", { text: ${J(d.title)}, size: 22 });`);
    let hy = 40;
    for (const h of hud) { o.w(`obj(${J(h.id)}, "text", 16, ${hy}, 0, 0, "#e6ecdd", { text: "", size: 15 });`); hy += 20; }
    if (d.help) o.w(`obj("petunjuk", "text", 16, ${H - 18}, 0, 0, "#767d75", { text: ${J(d.help)}, size: 11 });`);
    if (d.ground) o.w(`obj("tanah", "rect", 0, ${d.ground}, ${W}, ${H - d.ground}, "#4a3626");`);
    for (const wl of d.walls || []) o.w(`obj(${J(wl.id)}, "rect", ${wl.x}, ${wl.y}, ${wl.w}, ${wl.h}, ${J(wl.color)}); walls.push(${J(wl.id)});`);
    const loopCalls = [];
    for (const e of ents) {
      if (e.motion === "wall") continue;
      const K = cap(e.key);
      o.w(`const st${K} = [];`);
      for (let i = 1; i <= e.count; i++) {
        const shape = e.shape === "line" ? "rect" : e.shape;
        o.w(`obj(${J(e.id + i)}, ${J(shape)}, 0, 0, ${e.w}, ${e.h}, ${J(e.color)});`);
        if (e.fixed && e.fixed[i - 1]) o.w(`setpos(${J(e.id + i)}, ${e.fixed[i - 1][0]}, ${e.fixed[i - 1][1]});`);
        else o.w(`taruh${K}(${J(e.id + i)});`);
        o.w(`st${K}.push({ arah: ${i % 2 ? 1 : -1}, vx: ${((i % 2 ? 1 : -1) * (e.speed || 1)).toFixed(1)}, vy: ${((i % 3 ? 1 : -1) * (e.speed || 1) * 0.8).toFixed(1)} });`);
        if (e.onClick) o.w(`clickHandlers.push([${J(e.id + i)}, diklik${K}]);`);
      }
      if (e.motion === "teleport") o.w(`setInterval(() => { if (!selesai) for (let i = 1; i <= ${e.count}; i++) taruh${K}(${J(e.id)} + i); }, ${Math.round(e.every * 1000)});`);
      loopCalls.push(`for (let i = 1; i <= ${e.count}; i++) urus${K}(${J(e.id)} + i, st${K}[i - 1]);`);
    }
    if (P) o.w(`obj(${J(P.id)}, ${J(P.shape === "line" ? "rect" : P.shape)}, ${P.x}, ${P.y}, ${P.w}, ${P.h}, ${J(P.color)}, { solid: ${!!(d.walls && d.walls.length)} });`);
    if (d.shooter) {
      const pr = d.shooter.proj;
      for (let k = 1; k <= d.shooter.slots; k++) o.w(`obj(${J(pr.id + k)}, ${J(pr.shape)}, -100, -100, ${pr.w}, ${pr.h}, ${J(pr.color)}).alive = false; peluru.push({ id: ${J(pr.id + k)}, vx: 0, vy: 0 });`);
    }
    if (d.ball) o.w(`obj("bola", "circle", ${Math.round(W / 2)}, ${d.playTop + 40}, ${d.ball.w}, ${d.ball.w}, ${J(d.ball.color)});`);
    for (const w of widgets) {
      if (w.shape !== "text") o.w(`obj(${J(w.id)}, ${J(w.shape)}, ${w.x}, ${w.y}, ${w.w}, ${w.h}, ${J(w.color)});`);
      if (w.label != null) o.w(`obj(${J(w.labelId || "label" + cap(w.key))}, "text", ${w.lx != null ? w.lx : w.x + 10}, ${w.ly != null ? w.ly : w.y + Math.round(w.h / 2 - 9)}, 0, 0, ${J(w.labelColor || "#e6ecdd")}, { text: ${J(w.label)}, size: ${w.fs || 16} });`);
      if (w.onClick) { o.open(`clickHandlers.push([${J(w.id)}, () =>`); acts(w.onClick); o.close("}]);"); }
    }
    if (d.cycle) { for (const l of d.cycle.lamps) o.w(`obj(${J(l.id)}, "circle", ${l.x}, ${l.y}, ${l.size}, ${l.size}, "#3a3a3a");`); o.w("gantiLampu();"); o.w(`setInterval(gantiLampu, ${Math.round(d.cycle.sec * 1000)});`); }
    for (const t of d.timers || []) if (t.kind === "countdown") o.w(`timers.batasWaktu = ${t.sec};`);
    o.w("let played = 0;");
    o.w("tulisHud();");
    // ---- sequence (popups)
    if (d.sequence && d.sequence.length) {
      o.blank();
      o.open("function urutan()");
      const seq = (list) => {
        for (const s of list) {
          if (s.kind === "ask") o.w(`${s.var} = ${s.number ? "Number(" : ""}prompt(${J(s.prompt)}) ?? ""${s.number ? ")" : ""};`);
          else if (s.kind === "popup") o.w(`alert(${s.expr ? expr(s.expr) : J(s.text)});`);
          else if (s.kind === "do") acts(s.acts);
          else if (s.kind === "question") { o.w(`${s.var} = (prompt(${J(s.prompt)}) ?? "").trim();`); o.open(`if (${J(s.accept)}.includes(${s.var}))`); acts(s.right); o.close("} else {"); o.i++; acts(s.wrong); o.close(); }
          else if (s.kind === "loop") { o.w("let guard = 0;"); o.open(`while ((${expr(s.cond)}) && guard++ < 50)`); seq(s.body); o.close(); }
        }
      };
      seq(d.sequence);
      o.close();
      o.w("setTimeout(urutan, 300);");
    }
    if (d.intro) o.w(`setTimeout(() => alert(${J(d.intro)}), 200);`);
    // ---- main loop
    o.blank();
    o.w("// ---- every frame");
    o.w("let last = performance.now();");
    o.open("function frame(now)");
    o.w("const dt = Math.min(0.05, (now - last) / 1000); last = now;");
    o.open("if (!selesai)");
    o.w("played += dt;");
    if (P) o.w(`gerak${cap(P.key)}();`);
    if (d.shooter) o.w("terbangPeluru();");
    if (d.ball) o.w("urusBola();");
    loopCalls.forEach((l) => o.w(l));
    if ((d.timers || []).some((t) => t.kind === "countdown")) o.w(`if (timers.batasWaktu > 0) { timers.batasWaktu -= dt; if (timers.batasWaktu <= 0) waktuHabis(); }`);
    if (hud.length) o.w("tulisHud();");
    o.close();
    o.w("draw();");
    o.w("requestAnimationFrame(frame);");
    o.close();
    o.w("requestAnimationFrame(frame);");
    return pack(d, o.text());
  }

  /** the special games get their own hand-made-style code */
  function writeSpecial(d) {
    const L = (a, b) => (d.lang === "en" ? b : a);
    if (d.special === "tictactoe") {
      const two = d.board.twoPlayer, easy = d.board.easy;
      const js = `// written by sybau code for: ${d.request}
const BG = ${J(d.bg)};
const cv = document.getElementById("game"), ctx = cv.getContext("2d");
const board = Array(9).fill(0);        // 0 empty, 1 X, 2 O
let turn = 1, over = false, msg = ${J(two ? L("giliran X", "X to move") : L("lu X. klik kotaknya", "u are X. click a cell"))};
const score = { X: 0, O: 0, draw: 0 };
const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
const CELL = 90, X0 = (cv.width - CELL * 3) / 2, Y0 = 60;
function winner(b) { for (const [a, c, e] of LINES) if (b[a] && b[a] === b[c] && b[a] === b[e]) return b[a]; return b.every(Boolean) ? 3 : 0; }
function finishing(p) { for (const [a, c, e] of LINES) { const cells = [a, c, e], mine = cells.filter((i) => board[i] === p).length, empty = cells.filter((i) => !board[i]); if (mine === 2 && empty.length === 1) return empty[0]; } return -1; }
function computer() {
  ${easy ? "if (Math.random() < 0.35) { const free = board.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0); return free[Math.floor(Math.random() * free.length)]; }" : ""}
  let m = finishing(2); if (m >= 0) return m;          // win if it can
  m = finishing(1); if (m >= 0) return m;              // block u
  if (!board[4]) return 4;                             // centre
  const corners = [0, 2, 6, 8].filter((i) => !board[i]); if (corners.length) return corners[Math.floor(Math.random() * corners.length)];
  return [1, 3, 5, 7].find((i) => !board[i]);
}
function end() { const w = winner(board); if (!w) return false; over = true; if (w === 3) { score.draw++; msg = ${J(L("SERI", "DRAW"))}; } else if (w === 1) { score.X++; msg = ${J(two ? L("X MENANG", "X WINS") : L("LU MENANG. hoki doang 🥀", "U WON. luck 🥀"))}; } else { score.O++; msg = ${J(two ? L("O MENANG", "O WINS") : L("KOMPUTER MENANG 💀", "THE COMPUTER WON 💀"))}; } return true; }
cv.addEventListener("mousedown", (e) => {
  const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) * cv.width / r.width, y = (e.clientY - r.top) * cv.height / r.height;
  if (over) { board.fill(0); over = false; turn = 1; msg = ""; return; }
  const c = Math.floor((x - X0) / CELL), rr = Math.floor((y - Y0) / CELL);
  if (c < 0 || c > 2 || rr < 0 || rr > 2 || board[rr * 3 + c]) return;
  board[rr * 3 + c] = ${two ? "turn" : "1"};
  if (end()) return;
  ${two ? `turn = 3 - turn; msg = turn === 1 ? ${J(L("giliran X", "X to move"))} : ${J(L("giliran O", "O to move"))};` : "board[computer()] = 2; end();"}
});
function draw() {
  ctx.fillStyle = BG; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = "#b9e389"; ctx.font = "700 22px system-ui"; ctx.textBaseline = "top"; ctx.fillText(${J(d.title)}, 16, 12);
  ctx.fillStyle = "#e6ecdd"; ctx.font = "15px system-ui"; ctx.fillText("X " + score.X + "  ·  O " + score.O + "  ·  ${L("seri", "draw")} " + score.draw, 16, 40);
  for (let i = 0; i < 9; i++) {
    const x = X0 + (i % 3) * CELL, y = Y0 + Math.floor(i / 3) * CELL;
    ctx.fillStyle = "#26361f"; ctx.fillRect(x + 3, y + 3, CELL - 6, CELL - 6);
    if (board[i]) { ctx.fillStyle = board[i] === 1 ? "#feae34" : "#2ce8f5"; ctx.font = "800 56px system-ui"; ctx.fillText(board[i] === 1 ? "X" : "O", x + 26, y + 16); }
  }
  ctx.fillStyle = "#feae34"; ctx.font = "16px system-ui"; ctx.fillText(msg + (over ? ${J(L("  (klik buat main lagi)", "  (click to play again)"))} : ""), 16, cv.height - 30);
  requestAnimationFrame(draw);
}
draw();`;
      return pack(d, js);
    }
    if (d.special === "snake") {
      const g = d.snake;
      const js = `// written by sybau code for: ${d.request}
const BG = ${J(d.bg)};
const cv = document.getElementById("game"), ctx = cv.getContext("2d");
const K = ${g.cell}, COLS = Math.floor(cv.width / K), ROWS = Math.floor((cv.height - 40) / K);
let snake, dir, next, food, score, over, tick = 0, every = ${g.every};
function reset() { snake = [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }]; dir = { x: 1, y: 0 }; next = dir; score = 0; over = false; every = ${g.every}; place(); }
function place() { do { food = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) }; } while (snake.some((s) => s.x === food.x && s.y === food.y)); }
addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if ((k === "arrowleft" || k === "a") && dir.x !== 1) next = { x: -1, y: 0 };
  if ((k === "arrowright" || k === "d") && dir.x !== -1) next = { x: 1, y: 0 };
  if ((k === "arrowup" || k === "w") && dir.y !== 1) next = { x: 0, y: -1 };
  if ((k === "arrowdown" || k === "s") && dir.y !== -1) next = { x: 0, y: 1 };
  if (over && k === " ") reset();
  if (k.startsWith("arrow") || k === " ") e.preventDefault();
});
function step() {
  dir = next;
  const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
  if (head.x < 0 || head.y < 0 || head.x >= COLS || head.y >= ROWS || snake.some((s) => s.x === head.x && s.y === head.y)) { over = true; return; }
  snake.unshift(head);
  if (head.x === food.x && head.y === food.y) { score++; if (score % 4 === 0 && every > 3) every--; place(); } else snake.pop();
}
function frame() {
  if (!over && ++tick >= every) { tick = 0; step(); }
  ctx.fillStyle = BG; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = "#1c2a18"; ctx.fillRect(0, 40, COLS * K, ROWS * K);
  ctx.fillStyle = ${J(g.foodColor)}; ctx.beginPath(); ctx.arc(food.x * K + K / 2, 40 + food.y * K + K / 2, K / 2 - 2, 0, 6.28); ctx.fill();
  snake.forEach((s, i) => { ctx.fillStyle = i ? ${J(g.color)} : ${J(g.headColor)}; ctx.fillRect(s.x * K + 1, 40 + s.y * K + 1, K - 2, K - 2); });
  ctx.fillStyle = "#e6ecdd"; ctx.font = "600 16px system-ui"; ctx.textBaseline = "top";
  ctx.fillText(${J(d.title)} + "  ·  ${L("skor", "score")} " + score + (over ? ${J(L("  ·  GAME OVER, spasi buat ulang", "  ·  GAME OVER, space to restart"))} : ""), 12, 12);
  requestAnimationFrame(frame);
}
reset(); frame();`;
      return pack(d, js);
    }
    // rock paper scissors
    const names = d.lang === "en" ? ["rock", "scissors", "paper"] : ["batu", "gunting", "kertas"];
    const js = `// written by sybau code for: ${d.request}
const NAMES = ${J(names)};
const score = { win: 0, lose: 0, draw: 0 };
function play(i) {
  const c = Math.floor(Math.random() * 3);
  let r = ${J(L("SERI", "DRAW"))};
  if (i === c) score.draw++;
  else if ((i + 1) % 3 === c) { score.win++; r = ${J(L("LU MENANG 🥀", "U WIN 🥀"))}; }   // rock beats scissors beats paper beats rock
  else { score.lose++; r = ${J(L("LU KALAH 💀", "U LOSE 💀"))}; }
  document.getElementById("hasil").textContent = NAMES[i] + " vs " + NAMES[c] + " → " + r;
  document.getElementById("skor").textContent = "${L("menang", "won")} " + score.win + " · ${L("kalah", "lost")} " + score.lose + " · ${L("seri", "draw")} " + score.draw;
}
document.querySelectorAll("button[data-i]").forEach((b) => b.addEventListener("click", () => play(+b.dataset.i)));`;
    const body = `<h1>${d.title}</h1><div class="pilih">${names.map((n, i) => `<button data-i="${i}">${n}</button>`).join("")}</div><p id="hasil">${L("pilih salah satu", "pick one")}</p><p id="skor"></p>`;
    return pack(d, js, body, `.pilih{display:flex;gap:12px;justify-content:center;margin:24px 0}.pilih button{font:700 20px system-ui;padding:16px 22px;border-radius:12px;border:0;background:#ff6f59;color:#fff;cursor:pointer}.pilih button:hover{transform:translateY(-2px)}#hasil{font-size:22px}`);
  }

  function pack(d, js, body, css) {
    const W = d.stage.w, H = d.stage.h;
    const html = `<!doctype html>
<html lang="${d.lang === "en" ? "en" : "id"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${String(d.title).replace(/</g, "")}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b0f0a; color: #e6ecdd; font-family: system-ui, sans-serif; text-align: center; }
  canvas { width: min(100vw - 16px, ${W * 1.5}px); aspect-ratio: ${W} / ${H}; border-radius: 10px; box-shadow: 0 20px 60px rgba(0, 0, 0, .5); image-rendering: pixelated; }
  h1 { margin: 0 0 8px; font-size: 22px; color: #b9e389; }
  .note { margin-top: 8px; font-size: 12px; opacity: .6; }
  ${css || ""}
</style>
</head>
<body>
<main>
${body || `<canvas id="game" width="${W}" height="${H}" tabindex="0"></canvas>
<div class="note">${d.help ? String(d.help).replace(/</g, "") : d.lang === "en" ? "made with sybau code" : "dibikin pake sybau code"}</div>`}
</main>
<script>
${js}
</script>
</body>
</html>
`;
    return { html, js, lines: html.split("\n").length };
  }

  function write(d) { return d.special ? writeSpecial(d) : writeHtml(d); }

  const api = { write, expr };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.JsGenLib = api;
})(typeof self !== "undefined" ? self : this);
