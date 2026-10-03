/* stsgen.js — writes STS source from a game design, statement by statement.
 *
 * sybau code does not keep finished programs around. The planner (stscoder.js)
 * decides WHAT the program is: which things exist, how each one moves, what happens
 * when two things touch, how you win or lose. This file decides HOW to say that in
 * STS: it declares the variables, writes one function per behaviour, places the
 * objects, wires the events and writes the main loop. A maze is carved fresh every
 * time, quiz questions come from whatever the planner researched.
 *
 * write(design, opts) -> { roots, stage, title, info }
 *   opts.probe = { watch: [[name, expr]], at: [[tick, line]] } adds test hooks (used by
 *   the self-test, never shipped).
 */
(function (root) {
  "use strict";

  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const camel = (s) => String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").trim().split(/\s+/).map((w, i) => (i ? cap(w) : w)).join("") || "benda";
  const q = (s) => '"' + String(s).replace(/"/g, "'").replace(/\n/g, " ") + '"';
  const r1 = (x) => Math.round(x * 10) / 10;

  // ------------------------------------------------------------------ a tiny code writer
  class Code {
    constructor() { this.out = []; this.ind = 0; }
    line(s) { this.out.push("    ".repeat(this.ind) + s); return this; }
    lines(a) { a.forEach((s) => this.line(s)); return this; }
    blank() { if (this.out.length && this.out[this.out.length - 1] !== "") this.out.push(""); return this; }
    note(s) { return this.line("// " + s); }
    block(head, fn) {
      this.line(head + ":");
      this.ind++;
      const n = this.out.length;
      fn();
      if (this.out.length === n) this.line("return");
      this.ind--;
      return this;
    }
    if(c, fn) { return this.block("if " + c, fn); }
    elif(c, fn) { return this.block("elif " + c, fn); }
    else(fn) { return this.block("else", fn); }
    while(c, fn) { return this.block("while " + c, fn); }
    def(name, params, fn) { return this.block("def " + name + "(" + params.join(", ") + ")", fn); }
    text() { return this.out.join("\n").replace(/\n{3,}/g, "\n\n") + "\n"; }
  }

  // ------------------------------------------------------------------ maze carving (recursive backtracker)
  function carveMaze(cols, rows, rand) {
    const seen = Array.from({ length: rows }, () => new Array(cols).fill(false));
    // walls[r][c] = {e: wall on the east side, s: wall on the south side}
    const walls = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ e: true, s: true })));
    const stack = [[0, 0]];
    seen[0][0] = true;
    while (stack.length) {
      const [r, c] = stack[stack.length - 1];
      const next = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].filter(([y, x]) => y >= 0 && x >= 0 && y < rows && x < cols && !seen[y][x]);
      if (!next.length) { stack.pop(); continue; }
      const [y, x] = next[Math.floor(rand() * next.length)];
      if (y === r) walls[r][Math.min(c, x)].e = false; else walls[Math.min(r, y)][c].s = false;
      seen[y][x] = true;
      stack.push([y, x]);
    }
    return walls;
  }
  /** maze walls -> merged wall rectangles */
  function mazeRects(walls, x0, y0, cell, th) {
    const rows = walls.length, cols = walls[0].length, out = [];
    for (let r = 0; r < rows; r++) {   // horizontal runs (south walls)
      let start = -1;
      for (let c = 0; c <= cols; c++) {
        const on = c < cols && walls[r][c].s && r < rows - 1;
        if (on && start < 0) start = c;
        if (!on && start >= 0) { out.push([x0 + start * cell, y0 + (r + 1) * cell - th / 2, (c - start) * cell + th / 2, th]); start = -1; }
      }
    }
    for (let c = 0; c < cols - 1; c++) {   // vertical runs (east walls)
      let start = -1;
      for (let r = 0; r <= rows; r++) {
        const on = r < rows && walls[r][c].e;
        if (on && start < 0) start = r;
        if (!on && start >= 0) { out.push([x0 + (c + 1) * cell - th / 2, y0 + start * cell, th, (r - start) * cell + th / 2]); start = -1; }
      }
    }
    return out.map((a) => a.map(Math.round));
  }


  // ------------------------------------------------------------------ named games with their own rules
  /** tic-tac-toe: 3x3 board, X = you, O = the computer (or a 2nd player) */
  function writeTicTacToe(d, opts) {
    const L = (id, en) => (d.lang === "en" ? en : id);
    const g = d.board, c = new Code();
    const W = d.stage.w, H = d.stage.h, cell = g.cell, x0 = Math.round((W - cell * 3) / 2), y0 = g.top;
    const LINES = [[1, 2, 3], [4, 5, 6], [7, 8, 9], [1, 4, 7], [2, 5, 8], [3, 6, 9], [1, 5, 9], [3, 5, 7]];
    const cells = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    c.note(L("dibikin dari nol sama sybau code buat: ", "written from scratch by sybau code for: ") + String(d.request || "").slice(0, 90));
    for (const n of d.notes || []) c.note(n);
    c.line(`background(${q(d.bg)})`);
    c.blank();
    c.note(L("isi papan: 0 = kosong, 1 = X, 2 = O", "board: 0 = empty, 1 = X, 2 = O"));
    for (const n of cells) c.line(`var s${n} = 0`);
    c.line("var giliran = 1   // " + L("siapa yang jalan", "whose turn"));
    c.line("var langkah = 0   // " + L("udah berapa kotak keisi", "cells filled"));
    c.line("var selesai = 0");
    c.line("var menangX = 0");
    c.line("var menangO = 0");
    c.line("var seri = 0");
    if (opts.probe) { c.line("var _tick = 0"); for (const [n] of opts.probe.watch || []) c.line(`var ${n} = 0`); }
    c.blank();
    c.def("isi", ["n"], () => { for (const n of cells) c.if(`n == ${n}`, () => c.line(`return s${n}`)); c.line("return -1"); });
    c.blank();
    c.def("tandai", ["n", "p"], () => {
      for (const n of cells) c.if(`n == ${n}`, () => c.line(`s${n} = p`));
      c.if("p == 1", () => { c.line(`set("tanda" + n, "text", "X")`); c.line(`set("tanda" + n, "color", ${q(g.colorX)})`); });
      c.else(() => { c.line(`set("tanda" + n, "text", "O")`); c.line(`set("tanda" + n, "color", ${q(g.colorO)})`); });
      c.line("langkah = langkah + 1");
    });
    c.blank();
    c.def("punyaGaris", ["p"], () => {
      c.note(L("8 garis: 3 baris, 3 kolom, 2 diagonal", "8 lines: 3 rows, 3 columns, 2 diagonals"));
      for (const [a, b, e] of LINES) c.if(`s${a} == p and s${b} == p and s${e} == p`, () => c.line("return 1"));
      c.line("return 0");
    });
    c.blank();
    c.def("kotakPenentu", ["p"], () => {
      c.note(L("kotak kosong yang bikin p punya 3 sejajar (0 kalo ga ada)", "an empty cell that gives p three in a row (0 if none)"));
      for (const [a, b, e] of LINES) for (const [x, y, z] of [[a, b, e], [a, e, b], [b, e, a]]) c.if(`s${x} == p and s${y} == p and s${z} == 0`, () => c.line(`return ${z}`));
      c.line("return 0");
    });
    c.blank();
    if (!g.twoPlayer) {
      c.def("langkahKomputer", [], () => {
        c.note(L("otak O: menang kalo bisa, blok X, ambil tengah, pojok, terus pinggir", "O's brain: win if it can, block X, take the centre, a corner, then a side"));
        if (g.easy) c.if("chance(0.35)", () => { c.line("var r = randint(1, 9)"); c.if("isi(r) == 0", () => { c.line("tandai(r, 2)"); c.line("return"); }); });
        c.line("var n = kotakPenentu(2)");
        c.if("n == 0", () => c.line("n = kotakPenentu(1)"));
        c.if("n == 0 and s5 == 0", () => c.line("n = 5"));
        if (g.hard) {
          c.note(L("kalo X ambil 2 pojok berseberangan, jangan ambil pojok (biar ga kena jebakan)", "if X holds opposite corners, take a side (avoids the fork trap)"));
          c.if("n == 0 and ((s1 == 1 and s9 == 1) or (s3 == 1 and s7 == 1))", () => { for (const k of [2, 4, 6, 8]) c.if(`n == 0 and s${k} == 0`, () => c.line(`n = ${k}`)); });
        }
        c.line("var mulai = randint(0, 3)   // " + L("pojok mana dulu, biar ga ketebak", "which corner first, so it's not predictable"));
        for (let r = 0; r < 4; r++) c.if(`n == 0 and mulai == ${r}`, () => { for (const k of [1, 3, 9, 7, 1, 3, 9].slice(r, r + 4)) c.if(`n == 0 and s${k} == 0`, () => c.line(`n = ${k}`)); });
        for (const k of [2, 4, 6, 8]) c.if(`n == 0 and s${k} == 0`, () => c.line(`n = ${k}`));
        c.if("n > 0", () => c.line("tandai(n, 2)"));
      });
      c.blank();
    }
    c.def("cekAkhir", [], () => {
      c.if("punyaGaris(1) == 1", () => { c.line("selesai = 1"); c.line("menangX = menangX + 1"); c.line(`set("status", "text", ${q(g.twoPlayer ? L("X MENANG", "X WINS") : L("LU MENANG. hoki doang 🥀", "U WON. pure luck 🥀"))})`); });
      c.elif("punyaGaris(2) == 1", () => { c.line("selesai = 1"); c.line("menangO = menangO + 1"); c.line(`set("status", "text", ${q(g.twoPlayer ? L("O MENANG", "O WINS") : L("KOMPUTER MENANG. kalah sama kode 50 baris 💀", "THE COMPUTER WON. lost to 50 lines of code 💀"))})`); });
      c.elif("langkah >= 9", () => { c.line("selesai = 1"); c.line("seri = seri + 1"); c.line(`set("status", "text", ${q(L("SERI", "DRAW"))})`); });
      c.line(`set("skor", "text", "X " + menangX + "  ·  O " + menangO + "  ·  ${L("seri", "draw")} " + seri)`);
    });
    c.blank();
    c.def("pilih", ["n"], () => {
      c.if("selesai == 1 or isi(n) != 0", () => c.line("return"));
      if (g.twoPlayer) {
        c.line("tandai(n, giliran)");
        c.line("cekAkhir()");
        c.if("selesai == 0", () => { c.line("giliran = 3 - giliran"); c.if("giliran == 1", () => c.line(`set("status", "text", ${q(L("giliran X", "X to move"))})`)); c.else(() => c.line(`set("status", "text", ${q(L("giliran O", "O to move"))})`)); });
      } else {
        c.line("tandai(n, 1)");
        c.line("cekAkhir()");
        c.if("selesai == 0", () => { c.line("langkahKomputer()"); c.line("cekAkhir()"); });
      }
    });
    c.blank();
    c.def("mainLagi", [], () => {
      for (const n of cells) { c.line(`s${n} = 0`); c.line(`set("tanda${n}", "text", "")`); }
      c.line("langkah = 0"); c.line("selesai = 0"); c.line("giliran = 1");
      c.line(`set("status", "text", ${q(g.twoPlayer ? L("giliran X", "X to move") : L("lu X. klik kotaknya", "u are X. click a cell"))})`);
    });
    c.blank();
    c.note(L("---- papan", "---- the board"));
    c.line(`on 16 10 draw text ${q(d.title)} 22 color "#b9e389". judul`);
    c.line(`on 16 40 draw text "X 0  ·  O 0  ·  ${L("seri", "draw")} 0" 14 color "#e6ecdd". skor`);
    cells.forEach((n) => {
      const x = x0 + ((n - 1) % 3) * cell, y = y0 + Math.floor((n - 1) / 3) * cell;
      c.line(`on ${x + 3} ${y + 3} draw square ${cell - 6} color ${q(g.cellColor)}. sel${n}`);
      c.line(`on ${x + Math.round(cell / 2 - cell * 0.18)} ${y + Math.round(cell * 0.18)} draw text "" ${Math.round(cell * 0.6)} color "#ffffff". tanda${n}`);
    });
    c.line(`on 16 ${H - 50} draw text ${q(g.twoPlayer ? L("giliran X", "X to move") : L("lu X. klik kotaknya", "u are X. click a cell"))} 15 color "#feae34". status`);
    c.line(`on ${W - 130} ${H - 56} draw rect 114 32 color "#4a3626". tombolUlang`);
    c.line(`on ${W - 116} ${H - 48} draw text "${L("main lagi", "again")}" 14 color "#e6ecdd". labelUlang`);
    for (const n of cells) { c.blank(); c.block(`onclick /id"sel${n}" check`, () => c.line(`pilih(${n})`)); }
    c.blank();
    c.block(`onclick /id"tombolUlang" check`, () => c.line("mainLagi()"));
    if (opts.probe) {
      c.blank();
      c.block("forever", () => {
        c.line("_tick = _tick + 1");
        for (const [n, expr] of opts.probe.watch || []) c.line(`${n} = ${expr}`);
        for (const [tk, line] of opts.probe.at || []) c.if(`_tick == ${tk}`, () => c.line(line));
      });
    }
    return { roots: [{ index: 0, name: "main", code: c.text() }], stage: d.stage, title: d.title, info: { cells: cells.map((n) => ({ n, x: x0 + ((n - 1) % 3) * cell + cell / 2, y: y0 + Math.floor((n - 1) / 3) * cell + cell / 2 })) } };
  }

  /** snake on a grid; the body is N segment objects that follow the head */
  function writeSnake(d, opts) {
    const L = (id, en) => (d.lang === "en" ? en : id);
    const g = d.snake, c = new Code();
    const W = d.stage.w, H = d.stage.h, k = g.cell, cols = Math.floor((W - 20) / k), rows = Math.floor((H - 80) / k), x0 = Math.round((W - cols * k) / 2), y0 = 66;
    c.note(L("dibikin dari nol sama sybau code buat: ", "written from scratch by sybau code for: ") + String(d.request || "").slice(0, 90));
    for (const n of d.notes || []) c.note(n);
    c.line(`background(${q(d.bg)})`);
    c.blank();
    c.lines(["var skor = 0", "var selesai = 0", "var panjang = 3   // " + L("panjang badan", "body length"), "var arahX = 1", "var arahY = 0", "var nextX = 1", "var nextY = 0",
      `var hx = ${x0 + 5 * k}`, `var hy = ${y0 + 4 * k}`, "var jeda = 0", `var tiap = ${g.every}   // ` + L("frame per langkah (makin kecil makin cepet)", "frames per step (smaller = faster)")]);
    if (opts.probe) { c.line("var _tick = 0"); for (const [n] of opts.probe.watch || []) c.line(`var ${n} = 0`); }
    c.blank();
    c.def("taruhMakanan", [], () => c.line(`setpos("${g.foodId}", ${x0} + randint(0, ${cols - 1}) * ${k}, ${y0} + randint(0, ${rows - 1}) * ${k})`));
    c.blank();
    c.def("tamat", ["pesan"], () => { c.if("selesai == 1", () => c.line("return")); c.line("selesai = 1"); c.line(`on ${Math.round(W / 2 - 110)} ${Math.round(H / 2 - 20)} draw text pesan 30 color "#e43b44". banner`); c.line(`show.popup(pesan + ${q(L(" · skor: ", " · score: "))} + skor)`); });
    c.blank();
    c.def("baca", [], () => {
      c.note(L("panah ganti arah, tapi ga boleh langsung balik badan", "arrows turn, but never straight back into yourself"));
      c.if(`(key("left") or key("a")) and arahX != 1`, () => c.lines(["nextX = -1", "nextY = 0"]));
      c.if(`(key("right") or key("d")) and arahX != -1`, () => c.lines(["nextX = 1", "nextY = 0"]));
      c.if(`(key("up") or key("w")) and arahY != 1`, () => c.lines(["nextX = 0", "nextY = -1"]));
      c.if(`(key("down") or key("s")) and arahY != -1`, () => c.lines(["nextX = 0", "nextY = 1"]));
    });
    c.blank();
    c.def("jalan", [], () => {
      c.note(L("tiap ruas pindah ke tempat ruas di depannya, dari ekor ke kepala", "each segment moves to where the one in front was, tail first"));
      for (let i = g.max; i >= 2; i--) c.if(`panjang >= ${i}`, () => c.line(`setpos("badan${i}", get("badan${i - 1}", "x"), get("badan${i - 1}", "y"))`));
      c.line(`setpos("badan1", hx, hy)`);
      c.lines(["arahX = nextX", "arahY = nextY", `hx = hx + arahX * ${k}`, `hy = hy + arahY * ${k}`]);
      c.if(`hx < ${x0} or hx > ${x0 + (cols - 1) * k} or hy < ${y0} or hy > ${y0 + (rows - 1) * k}`, () => c.line(`tamat(${q(L("NABRAK TEMBOK", "HIT THE WALL"))})`));
      c.line(`setpos("kepala", hx, hy)`);
      c.note(L("nabrak badan sendiri? (ruas 1-2 nempel kepala, jadi mulai dari 3)", "bit yourself? (segments 1-2 touch the head anyway, so from 3)"));
      for (let i = 3; i <= g.max; i++) c.if(`panjang >= ${i} and get("badan${i}", "x") == hx and get("badan${i}", "y") == hy`, () => c.line(`tamat(${q(L("GIGIT BADAN SENDIRI", "BIT YOURSELF"))})`));
      c.if(`get("${g.foodId}", "x") == hx and get("${g.foodId}", "y") == hy`, () => {
        c.line("skor = skor + 1");
        c.line(`set("hudSkor", "text", ${q(L("skor: ", "score: "))} + skor)`);
        c.if(`panjang < ${g.max}`, () => { c.line("panjang = panjang + 1"); for (let i = 4; i <= g.max; i++) c.if(`panjang == ${i}`, () => c.lines([`showobj("badan${i}")`, `setpos("badan${i}", get("badan${i - 1}", "x"), get("badan${i - 1}", "y"))`])); });
        c.if("tiap > 4 and skor % 4 == 0", () => c.line("tiap = tiap - 1"));
        c.line("taruhMakanan()");
      });
    });
    c.blank();
    c.line(`on 16 10 draw text ${q(d.title)} 22 color "#b9e389". judul`);
    c.line(`on 16 38 draw text "${L("skor", "score")}: 0" 15 color "#e6ecdd". hudSkor`);
    c.line(`on ${x0 - 2} ${y0 - 2} draw rect ${cols * k + 4} ${rows * k + 4} color "#1c2a18". arena`);
    for (let i = 1; i <= g.max; i++) { c.line(`on ${x0 + (5 - Math.min(i, 3)) * k} ${y0 + 4 * k} draw square ${k - 2} color ${q(g.color)}. badan${i}`); if (i > 3) c.line(`hide("badan${i}")`); }
    c.line(`on ${x0 + 5 * k} ${y0 + 4 * k} draw square ${k - 2} color ${q(g.headColor)}. kepala`);
    c.line(`on 0 0 draw ${g.foodShape} ${k - 4} color ${q(g.foodColor)}. ${g.foodId}`);
    c.line("taruhMakanan()");
    c.line(`on 16 ${H - 16} draw text "${L("panah/wasd", "arrows/wasd")}" 11 color "#767d75". petunjuk`);
    c.blank();
    c.block("forever", () => {
      if (opts.probe) { c.line("_tick = _tick + 1"); for (const [n, expr] of opts.probe.watch || []) c.line(`${n} = ${expr}`); for (const [tk, line] of opts.probe.at || []) c.if(`_tick == ${tk}`, () => c.line(line)); }
      c.if("selesai == 0", () => { c.line("baca()"); c.line("jeda = jeda + 1"); c.if("jeda >= tiap", () => { c.line("jeda = 0"); c.line("jalan()"); }); });
    });
    return { roots: [{ index: 0, name: "main", code: c.text() }], stage: d.stage, title: d.title, info: { x0, y0, k } };
  }

  /** rock paper scissors against the computer */
  function writeRps(d, opts) {
    const L = (id, en) => (d.lang === "en" ? en : id);
    const c = new Code(), W = d.stage.w;
    const names = d.lang === "en" ? ["rock", "scissors", "paper"] : ["batu", "gunting", "kertas"];
    c.note(L("dibikin dari nol sama sybau code buat: ", "written from scratch by sybau code for: ") + String(d.request || "").slice(0, 90));
    c.line(`background(${q(d.bg)})`);
    c.blank();
    c.lines(["var menang = 0", "var kalah = 0", "var seri = 0", "var pilihanLu = 0", "var pilihanKomputer = 0"]);
    if (opts.probe) { c.line("var _tick = 0"); for (const [n] of opts.probe.watch || []) c.line(`var ${n} = 0`); }
    c.blank();
    c.def("nama", ["n"], () => { names.forEach((nm, i) => c.if(`n == ${i + 1}`, () => c.line(`return ${q(nm)}`))); c.line('return "?"'); });
    c.blank();
    c.def("main", ["n"], () => {
      c.note(L(`1 ${names[0]} ngalahin 2 ${names[1]}, 2 ngalahin 3 ${names[2]}, 3 ngalahin 1`, `1 ${names[0]} beats 2 ${names[1]}, 2 beats 3 ${names[2]}, 3 beats 1`));
      c.line("pilihanLu = n");
      c.line("pilihanKomputer = randint(1, 3)");
      c.line(`set("teksKomputer", "text", ${q(L("komputer: ", "computer: "))} + nama(pilihanKomputer))`);
      c.if("pilihanLu == pilihanKomputer", () => { c.line("seri = seri + 1"); c.line(`set("hasil", "text", ${q(L("SERI", "DRAW"))})`); });
      c.elif("(pilihanLu == 1 and pilihanKomputer == 2) or (pilihanLu == 2 and pilihanKomputer == 3) or (pilihanLu == 3 and pilihanKomputer == 1)", () => { c.line("menang = menang + 1"); c.line(`set("hasil", "text", ${q(L("LU MENANG (hoki) 🥀", "U WIN (luck) 🥀"))})`); });
      c.else(() => { c.line("kalah = kalah + 1"); c.line(`set("hasil", "text", ${q(L("LU KALAH 💀", "U LOSE 💀"))})`); });
      c.line(`set("skor", "text", ${q(L("menang ", "won "))} + menang + ${q(L(" · kalah ", " · lost "))} + kalah + ${q(L(" · seri ", " · draw "))} + seri)`);
    });
    c.blank();
    c.line(`on 16 10 draw text ${q(d.title)} 22 color "#b9e389". judul`);
    c.line(`on 16 40 draw text "${L("menang 0 · kalah 0 · seri 0", "won 0 · lost 0 · draw 0")}" 14 color "#e6ecdd". skor`);
    const cols = ["#8e8a93", "#e43b44", "#f4f1ea"], shapes = ["circle", "triangle", "rect"];
    names.forEach((nm, i) => {
      const x = Math.round(W / 2 - 200 + i * 140);
      c.line(`on ${x} 100 draw ${shapes[i]} ${shapes[i] === "circle" ? 100 : "100 80"} color ${q(cols[i])}. tombol${i + 1}`);
      c.line(`on ${x + 18} 210 draw text ${q(nm.toUpperCase())} 16 color "#e6ecdd". label${i + 1}`);
    });
    c.line(`on 16 250 draw text "" 16 color "#feae34". teksKomputer`);
    c.line(`on 16 280 draw text "${L("pilih salah satu", "pick one")}" 24 color "#b9e389". hasil`);
    for (let i = 1; i <= 3; i++) { c.blank(); c.block(`onclick /id"tombol${i}" check`, () => c.line(`main(${i})`)); }
    if (opts.probe) { c.blank(); c.block("forever", () => { c.line("_tick = _tick + 1"); for (const [n, expr] of opts.probe.watch || []) c.line(`${n} = ${expr}`); for (const [tk, line] of opts.probe.at || []) c.if(`_tick == ${tk}`, () => c.line(line)); }); }
    return { roots: [{ index: 0, name: "main", code: c.text() }], stage: d.stage, title: d.title, info: { buttons: [0, 1, 2].map((i) => ({ x: Math.round(W / 2 - 200 + i * 140) + 50, y: 140 })) } };
  }

  const SPECIAL = { tictactoe: writeTicTacToe, snake: writeSnake, rps: writeRps };

  // ------------------------------------------------------------------ the writer
  function write(d, opts = {}) {
    if (d.special && SPECIAL[d.special]) return SPECIAL[d.special](d, opts);
    const L = (id, en) => (d.lang === "en" ? en : id);
    const W = d.stage.w, H = d.stage.h;
    const rand = opts.rand || Math.random;
    const c = new Code();
    const vars = new Map();
    const v = (name, init, why) => { if (!vars.has(name)) vars.set(name, { init, why }); return name; };
    const info = { ids: {}, clicks: [], player: d.player ? d.player.id : null };
    const P = d.player;
    const top = d.playTop;
    const ents = d.entities || [];
    const widgets = d.widgets || [];
    const hasEnd = !!(d.end && (d.end.lives || d.end.goal || d.end.collectAll || d.end.reach || d.end.timer));

    // ---------- header comments
    c.note(L("dibikin dari nol sama sybau code buat: ", "written from scratch by sybau code for: ") + String(d.request || "").replace(/\s+/g, " ").slice(0, 90));
    for (const n of d.notes || []) c.note(n);
    c.line(`background(${q(d.bg)})`);

    // ---------- variables
    if (d.score) v("skor", 0, L("skor", "score"));
    if (d.end && d.end.lives) v("nyawa", d.end.lives, L("sisa nyawa", "lives left"));
    if (hasEnd || P) v("selesai", 0, L("1 kalo game udah tamat", "1 once the game is over"));
    for (const [k, val] of d.vars || []) v(k, val);
    if (P) {
      v("speed", P.speed, L("kecepatan " + P.label, P.label + " speed"));
      if (P.control === "platform" || P.control === "flappy") { v("vy", 0, L("kecepatan jatuh", "falling speed")); if (P.control === "platform") v("diTanah", 1); }
      if (d.shooter) { v("arahX", d.shooter.dx); v("arahY", d.shooter.dy); v("jeda", 0, L("jeda antar tembakan", "time between shots")); }
    }
    for (const e of ents) {
      if (e.speed != null && e.motion !== "static" && e.motion !== "wall" && e.motion !== "teleport") v("speed" + cap(e.key), r1(e.speed), L("kecepatan " + e.label, e.label + " speed"));
      if (e.counter) v(e.counter, 0, L(e.label + " yang udah didapet", e.label + " collected"));
      for (let i = 1; i <= e.count; i++) {
        if (e.motion === "patrol") v("arah" + cap(e.key) + i, (i % 2 ? 1 : -1));
        if (e.motion === "wander" || e.motion === "bounce") { v("vx" + cap(e.key) + i, r1((i % 2 ? 1 : -1) * e.speed)); v("vy" + cap(e.key) + i, r1((i % 3 ? 1 : -1) * e.speed * 0.8)); }
      }
    }
    if (d.shooter) for (let k = 1; k <= d.shooter.slots; k++) { v("pvx" + k, 0); v("pvy" + k, 0); }
    if (d.cycle) v("lampu", 0, L("lampu yang lagi nyala", "which light is on"));
    if (opts.probe) { v("_tick", 0); (opts.probe.watch || []).forEach(([n]) => v(n, 0)); }
    if (d.sequence) for (const s of d.sequence) if (s.var) v(s.var, s.number ? 0 : '""');
    c.blank();
    for (const [k, o] of vars) c.line(`var ${k} = ${o.init}` + (o.why ? "   // " + o.why : ""));
    c.blank();

    // ---------- functions
    const hud = d.hud || [];
    if (hud.length) {
      c.def("tulisHud", [], () => { for (const h of hud) c.line(`set(${q(h.id)}, "text", ${q(h.label + ": ")} + ${h.expr})`); });
      c.blank();
    }
    if (hasEnd || P) {
      c.def("tamat", ["pesan", "warna"], () => {
        c.if("selesai == 1", () => c.line("return"));
        c.line("selesai = 1");
        c.line(`on ${Math.round(W / 2 - 120)} ${Math.round(H / 2 - 24)} draw text pesan 34 color warna. banner`);
        c.line(`show.popup(pesan${d.score ? ` + ${q(L(" · skor: ", " · score: "))} + skor` : ""})`);
      });
      c.blank();
    }
    const winCall = (why) => `tamat(${q(why || L("MENANG", "YOU WIN"))}, "#b9e389")`;
    const loseCall = (why) => `tamat(${q(why || "GAME OVER")}, "#e43b44")`;
    if (d.end && d.end.goal) {
      c.def("cekMenang", [], () => c.if(`skor >= ${d.end.goal}`, () => c.line(winCall())));
      c.blank();
    }
    if (d.end && d.end.lives) {
      c.def("kena", [], () => {
        c.note(L("kena sesuatu yang bahaya: nyawa berkurang", "hit something dangerous: lose a life"));
        c.line("nyawa = nyawa - 1");
        c.line("tulisHud()");
        c.if("nyawa <= 0", () => c.line(loseCall()));
      });
      c.blank();
    }

    // actions -> statements
    const doActs = (acts, id) => {
      for (const a of acts) {
        if (a.do === "score") { c.line(`skor = skor + ${a.n || 1}`); c.line("tulisHud()"); if (d.end && d.end.goal) c.line("cekMenang()"); }
        else if (a.do === "count") { c.line(`${a.var} = ${a.var} + 1`); c.line("tulisHud()"); if (a.all) c.if(`${a.var} >= ${a.all}`, () => c.line(winCall(a.winText))); }
        else if (a.do === "hurt") { if (d.end && d.end.lives) c.line("kena()"); else c.line(loseCall()); }
        else if (a.do === "lose") c.line(loseCall(a.text));
        else if (a.do === "win") c.line(winCall(a.text));
        else if (a.do === "respawn") c.line(`taruh${cap(a.key)}(${id})`);
        else if (a.do === "destroy") c.line(`destroy(${id})`);
        else if (a.do === "popup") c.line(`show.popup(${a.expr || q(a.text)})`);
        else if (a.do === "add") { c.line(`${a.var} = ${a.var} + ${a.n}`); if (hud.some((h) => h.expr === a.var)) c.line("tulisHud()"); }
        else if (a.do === "set") c.line(`${a.var} = ${a.expr}`);
        else if (a.do === "text") c.line(`set(${q(a.target)}, "text", ${a.expr})`);
        else if (a.do === "color") c.line(`set(${q(a.target)}, "color", choose(${a.colors.map(q).join(", ")}))`);
        else if (a.do === "hud") c.line("tulisHud()");
        else if (a.do === "if") { c.if(a.cond, () => doActs(a.then, id)); if (a.else) c.else(() => doActs(a.else, id)); }
        else if (a.do === "call") c.line(a.name + "()");
      }
    };

    // player
    if (P) {
      c.def("gerak" + cap(P.key), [], () => {
        const id = q(P.id);
        if (P.control === "keys4" || P.control === "keys2") {
          c.note(L("dikontrol pake panah / wasd", "arrow keys / wasd"));
          const dirs = [["left", "a", "0 - speed", "0", "-1", "0"], ["right", "d", "speed", "0", "1", "0"]];
          if (P.control === "keys4") dirs.push(["up", "w", "0", "0 - speed", "0", "-1"], ["down", "s", "0", "speed", "0", "1"]);
          for (const [k, k2, dx, dy, ax, ay] of dirs) c.if(`key(${q(k)}) or key(${q(k2)})`, () => { c.line(`move(${id}, ${dx}, ${dy})`); if (d.shooter && d.shooter.facing) { c.line(`arahX = ${ax}`); c.line(`arahY = ${ay}`); } });
        } else if (P.control === "platform") {
          c.note(L("gravitasi: tiap frame jatuh makin cepet, spasi / panah atas buat lompat", "gravity pulls every frame, space / up to jump"));
          c.if(`key("space") or key("up") or key("w")`, () => c.if("diTanah == 1", () => { c.line(`vy = 0 - ${P.jump}`); c.line("diTanah = 0"); }));
          c.line(`vy = vy + ${P.gravity}`);
          c.line(`move(${id}, 0, vy)`);
          c.if(`get(${id}, "y") > ${d.ground - P.h}`, () => { c.line(`set(${id}, "y", ${d.ground - P.h})`); c.line("vy = 0"); c.line("diTanah = 1"); });
          c.if(`key("left") or key("a")`, () => c.line(`move(${id}, 0 - speed, 0)`));
          c.if(`key("right") or key("d")`, () => c.line(`move(${id}, speed, 0)`));
        } else if (P.control === "flappy") {
          c.note(L("kayak flappy: spasi / klik buat naik, sisanya jatuh", "flappy style: space / click flaps, gravity does the rest"));
          c.if(`key("space") or key("up") or mousedown()`, () => c.line(`vy = 0 - ${P.jump}`));
          c.line(`vy = vy + ${P.gravity}`);
          c.line(`move(${id}, 0, vy)`);
          c.if(`get(${id}, "y") > ${H - P.h} or get(${id}, "y") < ${top}`, () => { c.line(`setpos(${id}, ${P.x}, ${Math.round((top + H) / 2)})`); c.line("vy = 0"); doActs([{ do: "hurt" }]); });
        } else if (P.control === "mouse") {
          c.note(L("ngikutin mouse, atau pake panah", "follows the mouse, or use the arrows"));
          c.if("mousex() > 0", () => c.line(`set(${id}, "x", mousex() - ${Math.round(P.w / 2)})`));
          c.if(`key("left")`, () => c.line(`move(${id}, 0 - speed, 0)`));
          c.if(`key("right")`, () => c.line(`move(${id}, speed, 0)`));
        }
        if (P.control !== "flappy") {
          c.note(L("jangan sampe keluar layar", "stay on screen"));
          c.line(`set(${id}, "x", max(0, min(${W - P.w}, get(${id}, "x"))))`);
          if (P.control === "keys4") c.line(`set(${id}, "y", max(${top}, min(${H - P.h}, get(${id}, "y"))))`);
        }
        if (d.shooter) {
          c.line("jeda = jeda - 1");
          c.if(`key("space") and jeda <= 0`, () => { c.line("tembak()"); c.line(`jeda = ${d.shooter.cooldown}`); });
        }
      });
      c.blank();
    }

    // shooting
    if (d.shooter) {
      const s = d.shooter, pr = s.proj;
      c.def("tembak", [], () => {
        c.note(L(`lempar ${pr.label} dari posisi ${P.label}, pake slot yang lagi nganggur`, `throw a ${pr.label} from the ${P.label}, using a free slot`));
        for (let k = 1; k <= s.slots; k++) {
          const id = q(pr.id + k);
          c[k === 1 ? "if" : "elif"](`get(${id}, "x") < -50`, () => {
            c.line(`setpos(${id}, get(${q(P.id)}, "x") + ${Math.round(P.w / 2 - pr.w / 2)}, get(${q(P.id)}, "y") + ${Math.round(P.h / 2 - pr.h / 2)})`);
            c.line(`pvx${k} = arahX * ${s.speed}`);
            c.line(`pvy${k} = arahY * ${s.speed}`);
          });
        }
      });
      c.blank();
      c.def("terbang" + cap(pr.key), ["id", "vx", "vy"], () => {
        c.if(`get(id, "x") > -50`, () => {
          c.line("move(id, vx, vy)");
          c.if(`get(id, "x") > ${W} or get(id, "x") < -40 or get(id, "y") < -40 or get(id, "y") > ${H}`, () => c.line("setpos(id, -100, -100)"));
        });
      });
      c.blank();
    }

    // every other kind of thing
    for (const e of ents) {
      if (e.motion === "wall") continue;
      const K = cap(e.key), sp = "speed" + K;
      // where it (re)appears
      c.def("taruh" + K, ["id"], () => {
        const xr = `randint(${e.area.x0}, ${e.area.x1})`, yr = `randint(${e.area.y0}, ${e.area.y1})`;
        if (e.spawn === "top") c.line(`setpos(id, ${xr}, randint(-260, -30))`);
        else if (e.spawn === "right") c.line(`setpos(id, ${W} + randint(20, 320), ${e.laneY != null ? e.laneY : yr})`);
        else if (e.spawn === "edge") c.lines([`if chance(0.5):`, `    setpos(id, choose(-30, ${W + 10}), ${yr})`, `else:`, `    setpos(id, ${xr}, choose(${top - 30}, ${H + 10}))`]);
        else c.line(`setpos(id, ${xr}, ${yr})`);
      });
      c.blank();
      const params = ["id"];
      if (e.motion === "patrol") params.push("arah");
      c.def("urus" + K, params, () => {
        c.if("not exists(id)", () => c.line(e.motion === "patrol" ? "return arah" : "return"));
        if (e.why) c.note(e.why);
        if (e.motion === "fall") {
          c.line(`move(id, 0, ${sp})`);
          c.if(`get(id, "y") > ${H}`, () => { doActs(e.onExit || []); c.line(`taruh${K}(id)`); });
        } else if (e.motion === "scroll") {
          c.line(`move(id, 0 - ${sp}, 0)`);
          c.if(`get(id, "x") < ${-e.w - 10}`, () => { doActs(e.onExit || []); c.line(`taruh${K}(id)`); });
        } else if (e.motion === "fly") {
          c.line(`move(id, 0 - ${sp}, sin(get(id, "x") / 28) * 2)`);
          c.if(`get(id, "x") < ${-e.w - 10}`, () => { doActs(e.onExit || []); c.line(`taruh${K}(id)`); });
        } else if (e.motion === "chase") {
          const pid = q(P.id);
          c.if(`get(id, "x") < get(${pid}, "x")`, () => c.line(`move(id, ${sp}, 0)`));
          c.elif(`get(id, "x") > get(${pid}, "x")`, () => c.line(`move(id, 0 - ${sp}, 0)`));
          c.if(`get(id, "y") < get(${pid}, "y")`, () => c.line(`move(id, 0, ${sp})`));
          c.elif(`get(id, "y") > get(${pid}, "y")`, () => c.line(`move(id, 0, 0 - ${sp})`));
        } else if (e.motion === "patrol") {
          c.line(`move(id, arah * ${sp}, 0)`);
          c.if(`get(id, "x") < 0`, () => c.line("arah = 1"));
          c.if(`get(id, "x") > ${W - e.w}`, () => c.line("arah = -1"));
        }
        // hits from the player's projectiles
        if (d.shooter && e.shootable) for (let k = 1; k <= d.shooter.slots; k++) {
          c.if(`touching(id, ${q(d.shooter.proj.id + k)})`, () => { c.line(`setpos(${q(d.shooter.proj.id + k)}, -100, -100)`); doActs(e.onShot || [], "id"); });
        }
        if (P && e.onTouch && e.onTouch.length) c.if(`exists(id) and touching(${q(P.id)}, id)`, () => doActs(e.onTouch, "id"));
        if (e.onBall && d.ball) c.if(`exists(id) and touching(${q(d.ball.id)}, id)`, () => doActs(e.onBall, "id"));
        if (e.motion === "patrol") c.line("return arah");
      });
      c.blank();
      if (e.motion === "wander" || e.motion === "bounce") {
        c.def("pantulX" + K, ["id", "vx"], () => {
          if (e.motion === "wander") c.if("chance(0.02)", () => c.line(`vx = rand(0 - ${sp}, ${sp})`));
          c.if(`get(id, "x") < 0`, () => c.line("return abs(vx)"));
          c.if(`get(id, "x") > ${W - e.w}`, () => c.line("return 0 - abs(vx)"));
          c.line("return vx");
        });
        c.def("pantulY" + K, ["id", "vy"], () => {
          if (e.motion === "wander") c.if("chance(0.02)", () => c.line(`vy = rand(0 - ${sp}, ${sp})`));
          c.if(`get(id, "y") < ${top}`, () => c.line("return abs(vy)"));
          c.if(`get(id, "y") > ${H - e.h}`, () => c.line("return 0 - abs(vy)"));
          c.line("return vy");
        });
        c.blank();
      }
      if (e.onClick) { c.def("diklik" + K, ["id"], () => doActs(e.onClick, "id")); c.blank(); }
      if (e.motion === "teleport") {
        c.def("pindah" + K, [], () => {
          c.note(L(`${e.label} loncat ke tempat lain tiap ${e.every} detik`, `${e.label} jumps somewhere else every ${e.every}s`));
          c.if("selesai == 1", () => c.line("return"));
          for (let i = 1; i <= e.count; i++) c.line(`taruh${K}(${q(e.id + i)})`);
        });
        c.blank();
      }
    }

    // the ball (pong / breakout)
    if (d.ball) {
      const b = d.ball, id = q(b.id);
      c.def("urusBola", [], () => {
        c.line("move(" + id + ", bvx, bvy)");
        c.if(`get(${id}, "x") < 0`, () => c.line("bvx = abs(bvx)"));
        c.if(`get(${id}, "x") > ${W - b.w}`, () => c.line("bvx = 0 - abs(bvx)"));
        c.if(`get(${id}, "y") < ${top}`, () => c.line("bvy = abs(bvy)"));
        c.if(`touching(${id}, ${q(P.id)})`, () => {
          c.note(L("mantul dari raket, makin lama makin cepet", "bounce off the paddle, a bit faster each time"));
          c.line("bvy = 0 - abs(bvy) - 0.2");
          c.line(`bvx = bvx + (get(${id}, "x") - get(${q(P.id)}, "x") - ${Math.round(P.w / 2)}) / 20`);
          doActs(b.onPaddle || []);
        });
        c.if(`get(${id}, "y") > ${H}`, () => { c.line(`setpos(${id}, ${Math.round(W / 2)}, ${top + 40})`); c.line("bvy = abs(bvy)"); doActs(b.onMiss || []); });
      });
      c.blank();
    }

    // traffic-light style cycles
    if (d.cycle) {
      const cy = d.cycle;
      c.def("gantiLampu", [], () => {
        c.line("lampu = lampu + 1");
        c.if(`lampu >= ${cy.order.length}`, () => c.line("lampu = 0"));
        for (const l of cy.lamps) c.line(`set(${q(l.id)}, "color", "#3a3a3a")`);
        cy.order.forEach((li, i) => c[i === 0 ? "if" : "elif"](`lampu == ${i}`, () => c.line(`set(${q(cy.lamps[li].id)}, "color", ${q(cy.lamps[li].color)})`)));
      });
      c.blank();
    }

    // widget handlers as functions
    for (const w of widgets) if (w.onClick && w.onClick.length > 2) { c.def("klik" + cap(w.key), [], () => doActs(w.onClick)); c.blank(); }
    if (d.timeUp) { c.def("waktuHabis", [], () => doActs(d.timeUp)); c.blank(); }

    // ---------- the world
    c.note(L("---- bikin dunianya", "---- build the world"));
    c.line(`on 16 10 draw text ${q(d.title)} 22 color "#b9e389". judul`);
    let hy = 40;
    for (const h of hud) { c.line(`on 16 ${hy} draw text ${q(h.label + ":")} 15 color "#e6ecdd". ${h.id}`); hy += 20; }
    if (d.help) c.line(`on 16 ${H - 18} draw text ${q(d.help)} 11 color "#767d75". petunjuk`);
    if (d.ground) c.line(`on 0 ${d.ground} draw rect ${W} ${H - d.ground} color "#4a3626". tanah`);
    for (const wl of d.walls || []) {
      c.line(`on ${wl.x} ${wl.y} draw rect ${wl.w} ${wl.h} color ${q(wl.color)}. ${wl.id}`);
      c.line(`setup coll /id${q(wl.id)} solid. dinding${cap(wl.id)}`);
    }
    for (const e of ents) {
      if (e.motion === "wall") continue;
      for (let i = 1; i <= e.count; i++) {
        const id = e.id + i;
        const size = e.shape === "circle" || e.shape === "square" ? `${e.w}` : `${e.w} ${e.h}`;
        c.line(`on 0 0 draw ${e.shape} ${size} color ${q(e.color)}. ${id}`);
        if (e.fixed && e.fixed[i - 1]) c.line(`setpos(${q(id)}, ${e.fixed[i - 1][0]}, ${e.fixed[i - 1][1]})`);
        else c.line(`taruh${cap(e.key)}(${q(id)})`);
      }
      info.ids[e.key] = e.id + "1";
    }
    if (P) {
      const size = P.shape === "circle" || P.shape === "square" ? `${P.w}` : `${P.w} ${P.h}`;
      c.line(`on ${P.x} ${P.y} draw ${P.shape} ${size} color ${q(P.color)}. ${P.id}`);
      if (d.walls && d.walls.length) c.line(`setup coll /id${q(P.id)} solid. badan${cap(P.id)}`);
    }
    if (d.shooter) {
      const pr = d.shooter.proj;
      for (let k = 1; k <= d.shooter.slots; k++) c.line(`on -100 -100 draw ${pr.shape} ${pr.shape === "circle" || pr.shape === "square" ? pr.w : pr.w + " " + pr.h} color ${q(pr.color)}. ${pr.id + k}`);
    }
    if (d.ball) c.line(`on ${Math.round(W / 2)} ${top + 40} draw circle ${d.ball.w} color ${q(d.ball.color)}. ${d.ball.id}`);
    for (const w of widgets) {
      const size = w.shape === "circle" || w.shape === "square" ? `${w.w}` : `${w.w} ${w.h}`;
      if (w.shape !== "text") c.line(`on ${w.x} ${w.y} draw ${w.shape} ${size} color ${q(w.color)}. ${w.id}`);
      if (w.label != null) c.line(`on ${w.lx != null ? w.lx : w.x + 10} ${w.ly != null ? w.ly : w.y + Math.round(w.h / 2 - 9)} draw text ${q(w.label)} ${w.fs || 16} color ${q(w.labelColor || "#e6ecdd")}. ${w.labelId || "label" + cap(w.key)}`);
      if (w.onClick) info.clicks.push({ key: w.key, x: w.x + Math.round(w.w / 2), y: w.y + Math.round(w.h / 2) });
    }
    if (d.cycle) for (const l of d.cycle.lamps) c.line(`on ${l.x} ${l.y} draw circle ${l.size} color "#3a3a3a". ${l.id}`);
    for (const t of d.timers || []) {
      if (t.kind === "countdown") c.line(`countdown ${t.sec} (waktuHabis()). batasWaktu`);
      if (t.kind === "stopwatch") c.line(`stopwatch start. ${t.id}`);
    }
    if (hud.length) c.line("tulisHud()");
    for (const e of ents) if (e.motion === "teleport") c.line(`timer every ${e.every} (pindah${cap(e.key)}()). jam${cap(e.key)}`);
    if (d.cycle) { c.line("gantiLampu()"); c.line(`timer every ${d.cycle.sec} (gantiLampu()). jamLampu`); }

    // ---------- events
    for (const e of ents) if (e.onClick) for (let i = 1; i <= e.count; i++) {
      c.blank();
      c.block(`onclick /id${q(e.id + i)} check`, () => c.line(`diklik${cap(e.key)}(${q(e.id + i)})`));
      info.clicks.push({ key: e.key, ent: e.id + i });
    }
    for (const w of widgets) {
      if (w.onClick) {
        c.blank();
        c.block(`onclick /id${q(w.id)} check`, () => (w.onClick.length > 2 ? c.line("klik" + cap(w.key) + "()") : doActs(w.onClick)));
      }
      if (w.onHover) { c.blank(); c.block(`onhover /id${q(w.id)}`, () => doActs(w.onHover)); }
    }

    // ---------- a sequence of questions (quiz / name / password / guess / calculator)
    if (d.intro) { c.blank(); c.line(`show.popup(${q(d.intro)})`); }
    if (d.sequence && d.sequence.length) {
      c.blank();
      for (const s of d.sequence) {
        if (s.note) c.note(s.note);
        if (s.kind === "ask") c.line(`${s.var} = ${s.number ? "num(" : ""}show.anspopup(${q(s.prompt)})${s.number ? ")" : ""}`);
        else if (s.kind === "popup") c.line(`show.popup(${s.expr || q(s.text)})`);
        else if (s.kind === "do") doActs(s.acts);
        else if (s.kind === "question") {
          c.line(`${s.var} = show.anspopup(${q(s.prompt)})`);
          const conds = s.accept.map((a) => `${s.var} == ${q(a)}`).join(" or ");
          c.if(conds, () => doActs(s.right));
          c.else(() => doActs(s.wrong));
        } else if (s.kind === "loop") {
          c.while(s.cond, () => {
            for (const x of s.body) {
              if (x.kind === "ask") c.line(`${x.var} = ${x.number ? "num(" : ""}show.anspopup(${q(x.prompt)})${x.number ? ")" : ""}`);
              else if (x.kind === "do") doActs(x.acts);
            }
          });
        }
      }
    }

    // ---------- main loop
    const loop = [];
    if (P) loop.push(`gerak${cap(P.key)}()`);
    if (d.shooter) for (let k = 1; k <= d.shooter.slots; k++) loop.push(`terbang${cap(d.shooter.proj.key)}(${q(d.shooter.proj.id + k)}, pvx${k}, pvy${k})`);
    if (d.ball) loop.push("urusBola()");
    for (const e of ents) {
      if (e.motion === "wall") continue;
      const K = cap(e.key);
      for (let i = 1; i <= e.count; i++) {
        const id = q(e.id + i);
        if (e.motion === "patrol") loop.push(`arah${K}${i} = urus${K}(${id}, arah${K}${i})`);
        else if (e.motion === "wander" || e.motion === "bounce") loop.push(`vx${K}${i} = pantulX${K}(${id}, vx${K}${i})`, `vy${K}${i} = pantulY${K}(${id}, vy${K}${i})`, `move(${id}, vx${K}${i}, vy${K}${i})`, `urus${K}(${id})`);
        else loop.push(`urus${K}(${id})`);
      }
    }
    if (d.loopExtra) loop.push(...d.loopExtra);
    if (d.timers && d.timers.some((t) => t.kind === "countdown")) loop.push(`set("${d.timerHud}", "text", ${q(L("waktu: ", "time: "))} + ceil(/time"batasWaktu"))`);
    for (const t of d.timers || []) if (t.kind === "stopwatch") loop.push(`set(${q(t.hud)}, "text", ${q(t.label + ": ")} + round(/time${q(t.id)}) + "s")`);
    if (loop.length || opts.probe) {
      c.blank();
      c.note(L("---- jalan terus tiap frame", "---- runs every frame"));
      c.block("forever", () => {
        if (opts.probe) {
          c.line("_tick = _tick + 1");
          for (const [n, expr] of opts.probe.watch || []) c.line(`${n} = ${expr}`);
          for (const [tk, line] of opts.probe.at || []) c.if(`_tick == ${tk}`, () => c.line(line));
        }
        if (vars.has("selesai") && loop.length) c.if("selesai == 0", () => c.lines(loop));
        else c.lines(loop);
      });
    }
    return { roots: [{ index: 0, name: "main", code: c.text() }], stage: { w: W, h: H }, title: d.title, info };
  }

  const api = { write, Code, carveMaze, mazeRects, camel, cap };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.StsGenLib = api;
})(typeof self !== "undefined" ? self : this);
