/* stscoder.js — "sybau code": turns a request into a working STS program.
 *
 * How it thinks, step by step (every step is shown to the user):
 *   1. understand  - a neural multi-label model (model/coder.json) + keyword rules
 *                    find the building blocks asked for (clicker, maze, quiz, ...);
 *                    colours, shapes, numbers, names and quoted text are pulled out.
 *                    Experimental mode: unknown words get fuzzy-matched to known ones,
 *                    unknown things get looked up on Wikipedia for a colour/shape.
 *   2. plan        - resolve dependencies (a shop needs a clicker, coins need a
 *                    player...) and lay the stage out.
 *   3. write       - every block contributes variables, objects, handlers, loop
 *                    lines and roots; they are stitched into one .sts project.
 *   4. verify      - the code is compiled by the REAL STS compiler (sts.wasm). On an
 *                    error the message is read and a fix is applied (declare the
 *                    missing variable, quote the file name, fill the empty block,
 *                    ...), then it compiles again. Finally the program is run
 *                    head-less for a few seconds to catch runtime errors.
 * Follow-ups ("tambahin nyawa", "ganti warna jadi biru") edit the last program.
 */
(function (root) {
  "use strict";
  const Lib = root.BrainLib || (typeof require === "function" ? require("./brain.js") : null);
  const Sts = root.StsLib || (typeof require === "function" ? require("./stsvm.js") : null);

  // ------------------------------------------------------------------ vocabulary
  const COLORS = [
    [/\b(merah muda|pink|pinky|magenta)\b/, "#f6757a"], [/\b(merah|red|maroon)\b/, "#e43b44"], [/\b(biru muda|light blue|sky ?blue|cyan|tosca|toska|aqua)\b/, "#2ce8f5"],
    [/\b(biru tua|navy|dark blue)\b/, "#124e89"], [/\b(biru|blue)\b/, "#3b8ee4"], [/\b(hijau tua|dark green)\b/, "#3e8948"], [/\b(hijau|ijo|green|lime)\b/, "#63c74d"],
    [/\b(kuning|yellow)\b/, "#feae34"], [/\b(emas|gold|golden)\b/, "#ffd23f"], [/\b(oranye|orange|jingga|oren)\b/, "#f77622"], [/\b(ungu|purple|violet)\b/, "#b55088"],
    [/\b(hitam|black)\b/, "#18161c"], [/\b(putih|white)\b/, "#f4f1ea"], [/\b(abu ?abu|abu|gray|grey|silver|perak)\b/, "#8e8a93"], [/\b(coklat|cokelat|brown)\b/, "#b86f50"],
  ];
  const SHAPES = [[/\b(lingkaran|bulat|bunder|bundar|bola|circle|ball|round)\b/, "circle"], [/\b(segitiga|triangle)\b/, "triangle"], [/\b(elips|oval|ellipse)\b/, "ellipse"],
    [/\b(persegi panjang|rectangle|rect|balok)\b/, "rect"], [/\b(kotak|persegi|square|box|block|blok)\b/, "square"], [/\b(garis|line)\b/, "line"]];
  const COLOR_NAMES = { "#f6757a": ["pink", "pink"], "#e43b44": ["merah", "red"], "#2ce8f5": ["biru muda", "cyan"], "#124e89": ["biru tua", "navy"], "#3b8ee4": ["biru", "blue"],
    "#3e8948": ["hijau tua", "dark green"], "#63c74d": ["hijau", "green"], "#feae34": ["kuning", "yellow"], "#ffd23f": ["emas", "gold"], "#f77622": ["oranye", "orange"],
    "#b55088": ["ungu", "purple"], "#18161c": ["hitam", "black"], "#f4f1ea": ["putih", "white"], "#8e8a93": ["abu-abu", "gray"], "#b86f50": ["coklat", "brown"] };

  // keyword rules (the neural model covers the paraphrases these miss)
  const RULES = {
    clicker: /\b(clicker|cookie|tap(ping)? game|game (klik|click|ngeklik)|klik.{0,25}(dapet|dapat|nambah|tambah|koin|poin|skor|duit)|click.{0,25}(get|earn|coin|point|score|money)|pencet.{0,20}(poin|koin|skor))/,
    shop: /\b(shop|toko|upgrade|beli|buy|store)\b/,
    move: /\b(gerak(in|kan)?|bergerak|jalan(in)?|move|moving|arrow|panah|wasd|keyboard|kontrol|control|player|pemain|karakter|character)\b/,
    maze: /\b(maze|labirin|tembok|wall|walls|dinding)\b/,
    collect: /\b(kumpul\w*|ngumpul\w*|collect\w*|pick ?up|grab|ambil semua)\b/,
    dodge: /\b(hindar\w*|menghindar\w*|dodge|avoid|musuh|enemy|enemies|jatuh|falling|meteor|asteroid|rintangan|obstacle\w*|berjatuhan)\b/,
    lives: /\b(nyawa|lives|life|hp|health|darah)\b/,
    countdown: /\b(countdown|hitung mundur|batas waktu|time limit|waktu (habis|terbatas)|\d+\s*(detik|seconds?|secs?)|timer)\b/,
    stopwatch: /\b(stopwatch|stop watch|lama main|how long|count ?up|jam main)\b/,
    quiz: /\b(quiz|kuis|soal|pertanyaan|questions?|trivia|ujian)\b/,
    greet: /\b(nama (lu|gw|aku|user|kamu)|tanya nama|nanya nama|ask (my|for|the user'?s?) name|greet|input nama|masukin nama|sapa)\b/,
    dice: /\b(dadu|dice|roll)\b/,
    guess: /\b(tebak (angka|nomor)|guess(ing)? (the |a )?number|higher or lower|kekecilan)\b/,
    counter: /\b(counter|penghitung|tally|increment|tambah (dan|&) kurang|plus minus)\b/,
    calculator: /\b(kalkulator|calculator|hitung dua angka|add two numbers|jumlahin)\b/,
    colorchange: /\b(ganti warna|ubah warna|berubah warna|change colou?r|random colou?r|warna (acak|random)|color changer)\b/,
    bounce: /\b(mantul|memantul|pantul|bounc\w*|animasi|animat\w*|gerak sendiri|bergerak sendiri|dvd)\b/,
    popup: /\b(popup|pop up|alert|message box|muncul (pesan|tulisan)|munculin pesan)\b/,
    hover: /\b(hover|mouse over|kursor|cursor)\b/,
    traffic: /\b(lampu (lalu lintas|merah|stopan)|traffic light)\b/,
    password: /\b(password|kata sandi|sandi|pin|login)\b/,
    jump: /\b(lompat|loncat|jump\w*|platformer|gravitasi|gravity|flappy|runner)\b/,
    pong: /\b(pong|paddle|raket|breakout|ping pong)\b/,
    shapes: /\b(gambar|draw|lingkaran|kotak|segitiga|elips|persegi|circle|square|triangle|ellipse|rectangle|shapes?|bentuk|pemandangan|scene)\b/,
    score: /\b(skor|score|nilai|poin|points?)\b/,
  };
  const KNOWN_WORDS = ["clicker", "toko", "shop", "upgrade", "labirin", "maze", "tembok", "kumpulin", "collect", "hindarin", "dodge", "musuh", "enemy", "meteor", "nyawa", "lives",
    "countdown", "timer", "detik", "stopwatch", "kuis", "quiz", "soal", "nama", "dadu", "dice", "tebak", "angka", "counter", "kalkulator", "calculator", "warna", "color",
    "mantul", "bounce", "animasi", "popup", "hover", "lampu", "password", "sandi", "lompat", "jump", "gravitasi", "pong", "paddle", "lingkaran", "kotak", "segitiga",
    "circle", "square", "triangle", "skor", "score", "gerak", "pemain", "player", "keyboard", "panah", "arrow", "koin", "coin", "bintang", "bola", "tombol", "button"];

  const ID_WORDS = /\b(bikin\w*|buat\w*|pake|pakai|yang|dan|terus|sama|kalo|kalau|nyawa|hindar\w*|kumpul\w*|ngumpul\w*|gambar\w*|tombol|lempar|tebak|soal|kuis|warna|ganti|lampu|lompat\w*|loncat|detik|koin|musuh|sampe|sampai|tambah\w*|kurang|mantul|memantul|labirin|tanya|nanya|nama|kotak|lingkaran|segitiga|jatuh|gerak\w*|panah|merah|biru|hijau|kuning|hitam|putih|ungu|tolong|dong)\b/;
  const DEPENDS = { shop: ["clicker"], collect: ["move", "score"], dodge: ["move"], maze: ["move"], clicker: ["score"], quiz: ["score"], pong: ["score"] };

  function editDistance(a, b) {
    const n = a.length, m = b.length, d = [];
    for (let i = 0; i <= n; i++) { d.push(new Array(m + 1).fill(0)); d[i][0] = i; }
    for (let j = 0; j <= m; j++) d[0][j] = j;
    for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
    return d[n][m];
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const camel = (s) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").trim().split(/\s+/).map((w, i) => (i ? cap(w) : w)).join("") || "benda";

  // ------------------------------------------------------------------ neural request reader
  function dequant(d) {
    if (d.f) return { rows: 1, cols: d.f.length, data: Float32Array.from(d.f) };
    const [rows, cols] = d.shape;
    const bin = typeof atob === "function" ? atob(d.q) : Buffer.from(d.q, "base64").toString("binary");
    const data = new Float32Array(rows * cols);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) data[r * cols + c] = ((bin.charCodeAt(r * cols + c) << 24) >> 24) * d.scale[r];
    return { rows, cols, data };
  }
  class RequestReader {
    constructor(json) {
      this.features = json.features;
      this.dim = json.feat_dim;
      this.W1T = dequant(json.W1); this.b1 = dequant(json.b1).data; this.W2 = dequant(json.W2); this.b2 = dequant(json.b2).data;
      this.params = this.W1T.data.length + this.b1.length + this.W2.data.length + this.b2.length;
    }
    /** text -> {feature: probability} */
    read(text) {
      const x = Lib.featurize(text, this.dim);
      const H = this.W1T.rows, D = this.W1T.cols, h = new Float32Array(H);
      for (let j = 0; j < H; j++) { let s = this.b1[j]; for (const [k, v] of x) s += v * this.W1T.data[j * D + k]; h[j] = s > 0 ? s : 0; }
      const out = {};
      this.features.forEach((f, i) => {
        let s = this.b2[i];
        for (let j = 0; j < H; j++) s += h[j] * this.W2.data[j * this.W2.cols + i];
        out[f] = 1 / (1 + Math.exp(-s));
      });
      return out;
    }
  }

  // ------------------------------------------------------------------ understanding
  function findColors(t) {
    const out = [];
    for (const [re, hex] of COLORS) {
      const g = new RegExp(re.source, "g");
      let m;
      while ((m = g.exec(t))) out.push({ hex, at: m.index, word: m[0] });
    }
    return out.sort((a, b) => a.at - b.at);
  }
  /** the colour word closest to a noun position (within a few words) */
  function colorNear(t, re, isBg) {
    const m = t.match(re);
    if (!m) return null;
    const colors = findColors(t).filter((c) => Math.abs(c.at - m.index) < 28 && (isBg || !/background|latar|bg/.test(t.slice(Math.max(0, c.at - 14), c.at))));
    colors.sort((a, b) => Math.abs(a.at - m.index) - Math.abs(b.at - m.index));
    return colors.length ? colors[0].hex : null;
  }
  function num(t, re, def) { const m = t.match(re); return m ? Math.max(1, Math.min(9999, parseInt(m[1], 10))) : def; }

  function understand(text, reader, opts = {}) {
    const raw = String(text).trim();
    let t = " " + raw.toLowerCase().replace(/[“”]/g, '"') + " ";
    const notes = [];
    // experimental: fix typos in words close to the STS vocabulary
    if (opts.experimental) {
      t = t.replace(/[a-z]{4,}/g, (w) => {
        if (KNOWN_WORDS.includes(w)) return w;
        let best = null, bd = 9;
        for (const k of KNOWN_WORDS) { if (Math.abs(k.length - w.length) > 2) continue; const d = editDistance(w, k); if (d < bd) { bd = d; best = k; } }
        if (best && bd <= (w.length >= 7 ? 2 : 1) && w[0] === best[0]) { notes.push("'" + w + "' kayaknya maksudnya '" + best + "'"); return best; }
        return w;
      });
    }
    const probs = reader ? reader.read(t) : {};
    const features = new Set();
    const why = {};
    for (const [f, re] of Object.entries(RULES)) if (re.test(t)) { features.add(f); why[f] = "kata kunci"; }
    for (const [f, p] of Object.entries(probs)) if (p > 0.5 && !features.has(f)) { features.add(f); why[f] = "model " + Math.round(p * 100) + "%"; }
    // "shapes" only when nothing more specific was asked, or explicit shape words
    if (features.has("shapes") && features.size > 1 && !SHAPES.some(([re]) => re.test(t))) features.delete("shapes");
    if (features.has("countdown") && /\btimer\b/.test(t) && features.has("stopwatch")) features.delete("countdown");
    const quotes = [...raw.matchAll(/"([^"]{1,60})"|'([^']{2,60})'/g)].map((m) => m[1] || m[2]);
    const spec = {
      features, why, probs, notes, quotes,
      lang: Lib.detectLang(Lib.normalize(raw)) === "id" || ID_WORDS.test(t) ? "id" : "en",
      title: (raw.match(/(?:judul(?:nya)?|nama(?:nya)? game|title(?:d)?|called|namanya)\s+"?([^",.]{2,30})"?/i) || [])[1] || null,
      stage: (t.match(/\b(\d{3,4})\s*[x×]\s*(\d{3,4})\b/) || []).slice(1).map(Number),
      bg: colorNear(t, /\b(background|latar(?: belakang)?|bg|backgroundnya|langit)\b/, true) || null,
      colors: findColors(t),
      lives: num(t, /(\d+)\s*(?:nyawa|lives|lifes|hp|hati|darah)/, 3),
      seconds: num(t, /(\d+)\s*(?:detik|seconds?|secs?|s\b)/, 30),
      items: Math.min(12, num(t, /(\d+)\s*(?:koin|coins?|bintang|stars?|items?|buah|permata|gems?|apel|apples?)/, 6)),
      enemies: Math.min(8, num(t, /(\d+)\s*(?:musuh|enem(?:y|ies)|meteor|bom|bombs?|rintangan|obstacles?|asteroid)/, 3)),
      questions: Math.min(10, num(t, /(\d+)\s*(?:soal|pertanyaan|questions?)/, 3)),
      price: num(t, /(?:harga|price|cost)\s*(\d+)/, 10),
      goal: num(t, /(?:target|menang (?:kalo|kalau|jika)(?: skor)?|win (?:at|when)(?: score)?|sampai|sampe)\s*(\d+)/, 0),
      max: num(t, /(?:1|satu)\s*(?:sampai|sampe|-|to|hingga)\s*(\d+)/, 100),
      password: (raw.match(/(?:password|sandi|pin)(?:nya)?\s*(?:=|:|adalah|is)?\s*"?([A-Za-z0-9_]{2,20})"?/i) || [])[1] || null,
      playerColor: colorNear(t, /\b(pemain|player|karakter|character|kotak|square|hero)\b/),
      enemyColor: colorNear(t, /\b(musuh|enem(?:y|ies)|meteor|bom|bombs?|rintangan|obstacles?|asteroid)\b/),
      itemColor: colorNear(t, /\b(koin|coins?|bintang|stars?|items?|permata|gems?)\b/),
      buttonColor: colorNear(t, /\b(tombol|button|bola|ball|lingkaran|circle)\b/),
      itemName: null, enemyName: null,
    };
    if (spec.password && /^(nya|yang|ya|ga|gak)$/i.test(spec.password)) spec.password = null;
    // names for things the user brought ("kumpulin semangka", "hindarin zombie")
    const it = t.match(/(?:kumpul\w*|ngumpul\w*|collect\w*|ambil(?: semua)?|pick ?up|grab)\s+([a-z]{3,15})/);
    if (it && !/^(semua|the|all|yang|ini|itu)$/.test(it[1])) spec.itemName = it[1];
    const en = t.match(/(?:hindar\w*|dodge|avoid)\s+(?:the\s+)?([a-z]{3,15})/);
    if (en && !/^(semua|the|all|yang|ini|itu|dari)$/.test(en[1])) spec.enemyName = en[1];
    // nothing recognisable: draw what was said, honestly
    if (!features.size) { features.add("shapes"); why.shapes = "tebakan (ga ada fitur yang gw kenal)"; spec.guessed = true; }
    // dependencies
    let changed = true;
    while (changed) {
      changed = false;
      for (const f of [...features]) for (const d of DEPENDS[f] || []) if (!features.has(d)) { features.add(d); why[d] = "dibutuhin " + f; changed = true; }
    }
    if (features.has("jump") && features.has("move")) features.delete("move"); // jump has its own controls
    if (features.has("pong") && features.has("move")) features.delete("move");
    return spec;
  }

  // ------------------------------------------------------------------ the program builder
  class Prog {
    constructor(lang, w, h) {
      this.lang = lang; this.W = w; this.H = h;
      this.vars = new Map(); this.head = []; this.setup = []; this.handlers = []; this.loop = []; this.roots = []; this.defs = [];
      this.hudY = 44; this.ids = new Set(); this.flags = new Set();
    }
    L(id, en) { return this.lang === "id" ? id : en; }
    v(name, init) { if (!this.vars.has(name)) this.vars.set(name, init); return name; }
    id(base) { let n = base, i = 2; while (this.ids.has(n)) n = base + i++; this.ids.add(n); return n; }
    hud(label, expr) {
      const id = this.id("teks" + cap(camel(label)));
      this.setup.push(`on 16 ${this.hudY} draw text "${label}: 0" 15 color "#e6ecdd". ${id}`);
      this.hudY += 22;
      const update = `set("${id}", "text", "${label}: " + ${expr})`;
      return { id, update };
    }
    root(name, lines) { this.roots.push({ name, lines }); return this.roots.length; }
    text(id, s) { return String(s).replace(/"/g, "'"); }
  }

  const rint = (rand, a, b) => a + Math.floor(rand() * (b - a + 1));

  /** the blocks. each one writes into the Prog */
  function build(spec, rand) {
    const f = spec.features, lang = spec.lang;
    const W = spec.stage[0] || 520, H = spec.stage[1] || 360;
    const p = new Prog(lang, W, H);
    const L = (a, b) => p.L(a, b);
    const accent = "#b9e389";
    const playArea = { x0: 20, y0: 110, x1: W - 40, y1: H - 40 };
    const title = spec.title || spec.quotes[0] || L("sybau game", "sybau game");
    p.head.push(`background("${spec.bg || "#101a0c"}")`);
    p.setup.push(`on 16 12 draw text "${p.text(0, title)}" 22 color "${accent}". judul`);
    const ended = f.has("lives") || f.has("countdown") || f.has("maze") || f.has("collect") || f.has("dodge") || f.has("pong") || (f.has("clicker") && spec.goal);
    if (ended) { p.v("selesai", 0); }
    const winRoot = () => {
      if (p.flags.has("win")) return p.winIdx;
      p.flags.add("win"); p.v("menang", 0);
      p.winIdx = p.root(L("menang", "win"), ["if menang == 0:", "    return", "if selesai == 1:", "    return", "selesai = 1",
        `show.popup("${L("MENANG! skor lu: ", "YOU WIN! score: ")}" + skor)`, `on ${Math.round(W / 2 - 90)} ${Math.round(H / 2 - 24)} draw text "${L("MENANG", "YOU WIN")}" 40 color "${accent}". banner`]);
      if (!p.vars.has("skor")) p.v("skor", 0);
      return p.winIdx;
    };
    const loseRoot = () => {
      if (p.flags.has("lose")) return p.loseIdx;
      p.flags.add("lose"); p.v("kalah", 0);
      p.loseIdx = p.root(L("kalah", "lose"), ["if kalah == 0:", "    return", "if selesai == 1:", "    return", "selesai = 1",
        `show.popup("${L("GAME OVER. skor lu: ", "GAME OVER. score: ")}" + skor + "${L(". cupu 🥀", ". skill issue 🥀")}")`,
        `on ${Math.round(W / 2 - 110)} ${Math.round(H / 2 - 24)} draw text "GAME OVER" 40 color "#e43b44". banner`]);
      if (!p.vars.has("skor")) p.v("skor", 0);
      return p.loseIdx;
    };
    const winCall = () => `menang = 1; goto #${winRoot()}`;
    const loseLines = (ind) => [ind + "kalah = 1", ind + `goto #${loseRoot()}`];

    let score = null;
    if (f.has("score")) { p.v("skor", 0); score = p.hud(L("skor", "score"), "skor"); }
    const bumpScore = (ind, n) => (score ? [ind + `skor = skor + ${n || 1}`, ind + score.update] : []);

    let lives = null;
    if (f.has("lives")) { p.v("nyawa", spec.lives); lives = p.hud(L("nyawa", "lives"), "nyawa"); p.setup.push(lives.update); }

    // ---- player (move / maze / collect / dodge)
    const player = { id: "pemain", size: 24, x: playArea.x0, y: Math.round((playArea.y0 + playArea.y1) / 2) };
    if (f.has("move")) {
      const col = spec.playerColor || "#93cc5f";
      p.setup.push(`on ${player.x} ${player.y} draw square ${player.size} color "${col}". pemain`);
      p.v("speed", 3);
      const mv = [`if key("left") or key("a"):`, `    move("pemain", 0 - speed, 0)`, `if key("right") or key("d"):`, `    move("pemain", speed, 0)`];
      if (!f.has("dodge") || f.has("maze") || f.has("collect")) mv.push(`if key("up") or key("w"):`, `    move("pemain", 0, 0 - speed)`, `if key("down") or key("s"):`, `    move("pemain", 0, speed)`);
      if (f.has("dodge") && !f.has("maze") && !f.has("collect")) { player.y = H - 50; p.setup[p.setup.length - 1] = `on ${Math.round(W / 2)} ${player.y} draw square ${player.size} color "${col}". pemain`; }
      p.loop.push(...mv);
      if (f.has("maze")) {
        p.setup.push(`setup coll -40 0 40 ${H} solid. batasKiri`, `setup coll ${W} 0 40 ${H} solid. batasKanan`, `setup coll 0 -40 ${W} 40 solid. batasAtas`, `setup coll 0 ${H} ${W} 40 solid. batasBawah`,
          `setup coll /id"pemain" solid. badanPemain`);
      } else {
        p.loop.push(`if get("pemain", "x") < 0:`, `    set("pemain", "x", 0)`, `if get("pemain", "x") > ${W - player.size}:`, `    set("pemain", "x", ${W - player.size})`,
          `if get("pemain", "y") < 40:`, `    set("pemain", "y", 40)`, `if get("pemain", "y") > ${H - player.size}:`, `    set("pemain", "y", ${H - player.size})`);
      }
      p.setup.push(`on 16 ${H - 22} draw text "${L("gerak: panah / wasd", "move: arrow keys / wasd")}" 12 color "#767d75". petunjuk`);
    }

    if (f.has("maze")) {
      const wc = "#5f4530";
      const walls = [[0, 0.45, 0.6, 0.05], [0.35, 0.12, 0.04, 0.3], [0.62, 0.6, 0.04, 0.4], [0.78, 0.15, 0.04, 0.35]];
      walls.forEach(([x, y, w, h], i) => {
        const id = "tembok" + (i + 1);
        p.setup.push(`on ${Math.round(x * W)} ${Math.round(40 + y * (H - 40))} draw rect ${Math.max(14, Math.round(w * W))} ${Math.max(14, Math.round(h * (H - 40)))} color "${wc}". ${id}`,
          `setup coll /id"${id}" solid. w${i + 1}`);
      });
      p.setup.push(`on ${W - 60} ${H - 60} draw square 40 color "#4f8f2f". gawang`, `setup coll /id"gawang" detect(${winCall()}). zonaMenang`);
      if (!p.vars.has("skor")) p.v("skor", 0);
    }

    if (f.has("collect")) {
      const n = spec.items, name = spec.itemName || L("koin", "coin"), col = spec.itemColor || "#feae34";
      const total = p.hud(name, "skor");
      for (let i = 1; i <= n; i++) {
        const id = camel(name) + i;
        p.setup.push(`on ${rint(rand, 60, W - 40)} ${rint(rand, 90, H - 50)} draw circle 16 color "${col}". ${id}`);
        p.loop.push(`if exists("${id}"):`, `    if touching("pemain", "${id}"):`, `        destroy("${id}")`, `        skor = skor + 1`, `        ${total.update}`, ...(score ? [`        ${score.update}`] : []));
      }
      p.loop.push(`if skor >= ${n}:`, `    menang = 1`, `    goto #${winRoot()}`);
    }

    if (f.has("dodge")) {
      const n = spec.enemies, name = spec.enemyName || L("musuh", "enemy"), col = spec.enemyColor || "#e43b44";
      const horizontal = f.has("jump");
      p.v("kecepatanMusuh", 3);
      for (let i = 1; i <= n; i++) {
        const id = camel(name) + i;
        if (horizontal) p.setup.push(`on ${W + i * 180} ${H - 50} draw square 22 color "${col}". ${id}`);
        else p.setup.push(`on {randint(0, ${W - 22})} {randint(-300, -30)} draw square 22 color "${col}". ${id}`);
        const hit = lives
          ? [`    nyawa = nyawa - 1`, `    ${lives.update}`, horizontal ? `    setpos("${id}", ${W + 40}, ${H - 50})` : `    setpos("${id}", randint(0, ${W - 22}), -40)`, `    if nyawa <= 0:`, ...loseLines("        ")]
          : loseLines("    ");
        if (horizontal) p.loop.push(`move("${id}", 0 - kecepatanMusuh, 0)`, `if get("${id}", "x") < -30:`, `    setpos("${id}", ${W} + randint(0, 200), ${H - 50})`, ...bumpScore("    "));
        else p.loop.push(`move("${id}", 0, kecepatanMusuh)`, `if get("${id}", "y") > ${H}:`, `    setpos("${id}", randint(0, ${W - 22}), -30)`, ...bumpScore("    "));
        p.loop.push(`if touching("pemain", "${id}"):`, ...hit);
      }
      if (score) p.loop.push(`kecepatanMusuh = 3 + skor / 15`);
    }

    if (f.has("jump")) {
      const ground = H - 50, col = spec.playerColor || "#93cc5f";
      p.setup.push(`on 60 ${ground} draw square 24 color "${col}". pemain`, `on 0 ${ground + 24} draw rect ${W} 26 color "#4a3626". tanah`,
        `on 16 ${H - 22} draw text "${L("lompat: spasi / panah atas", "jump: space / up arrow")}" 12 color "#767d75". petunjuk`);
      p.v("vy", 0); p.v("diTanah", 1);
      p.loop.push(`if key("space") or key("up"):`, `    if diTanah == 1:`, `        vy = 0 - 9`, `        diTanah = 0`, `vy = vy + 0.5`, `move("pemain", 0, vy)`,
        `if get("pemain", "y") > ${ground}:`, `    set("pemain", "y", ${ground})`, `    vy = 0`, `    diTanah = 1`,
        `if key("left"):`, `    move("pemain", -3, 0)`, `if key("right"):`, `    move("pemain", 3, 0)`);
    }

    if (f.has("pong")) {
      const pw = 90;
      p.setup.push(`on ${Math.round(W / 2 - pw / 2)} ${H - 30} draw rect ${pw} 12 color "${spec.playerColor || "#93cc5f"}". paddle`,
        `on ${Math.round(W / 2)} 120 draw circle 16 color "${spec.buttonColor || "#feae34"}". bola`,
        `on 16 ${H - 22} draw text "${L("geser: mouse / panah", "move: mouse / arrows")}" 12 color "#767d75". petunjuk`);
      p.v("vx", 3); p.v("vy", 3);
      p.loop.push(`if key("left"):`, `    move("paddle", -6, 0)`, `if key("right"):`, `    move("paddle", 6, 0)`, `if mousex() > 0:`, `    set("paddle", "x", mousex() - ${pw / 2})`,
        `move("bola", vx, vy)`, `if get("bola", "x") < 0 or get("bola", "x") > ${W - 16}:`, `    vx = 0 - vx`, `if get("bola", "y") < 40:`, `    vy = abs(vy)`,
        `if touching("bola", "paddle"):`, `    vy = 0 - abs(vy)`, ...bumpScore("    "), `if get("bola", "y") > ${H}:`, `    setpos("bola", ${Math.round(W / 2)}, 120)`,
        ...(lives ? [`    nyawa = nyawa - 1`, `    ${lives.update}`, `    if nyawa <= 0:`, ...loseLines("        ")] : loseLines("    ")));
    }

    if (f.has("bounce")) {
      const col = spec.buttonColor || spec.colors.map((c) => c.hex).find((h) => h !== spec.bg) || "#f77622";
      p.setup.push(`on ${Math.round(W / 3)} ${Math.round(H / 2)} draw circle 30 color "${col}". bolaMantul`);
      p.v("bx", 3); p.v("by", 2);
      p.loop.push(`move("bolaMantul", bx, by)`, `if get("bolaMantul", "x") < 0 or get("bolaMantul", "x") > ${W - 30}:`, `    bx = 0 - bx`,
        `if get("bolaMantul", "y") < 40 or get("bolaMantul", "y") > ${H - 30}:`, `    by = 0 - by`);
    }

    // ---- click things
    let bx = 170;
    if (f.has("clicker")) {
      const col = spec.buttonColor || "#6fae3f";
      p.v("perKlik", 1);
      const size = 130, cx = Math.round(W / 2 - size / 2), cy = Math.max(110, Math.round(H / 2 - size / 2));
      p.setup.push(`on ${cx} ${cy} draw circle ${size} color "${col}". tombolKlik`, `on ${cx + 34} ${cy + size + 6} draw text "${L("KLIK!", "CLICK!")}" 16 color "#e6ecdd". labelKlik`);
      const body = [`    skor = skor + perKlik`, `    ${score.update}`];
      if (spec.goal) body.push(`    if skor >= ${spec.goal}:`, `        ${winCall().replace("; ", "\n        ")}`);
      p.handlers.push([`onclick /id"tombolKlik" check:`, ...body]);
      bx = cx + size + 20;
    }
    if (f.has("shop")) {
      p.v("harga", spec.price); p.v("beli", 0);
      const info = p.hud(L("per klik", "per click"), "perKlik");
      p.setup.push(info.update, `on 16 ${H - 50} draw rect 200 36 color "#4a3626". tombolUpgrade`, `on 28 ${H - 41} draw text "UPGRADE (${spec.price})" 15 color "#e6ecdd". labelUpgrade`);
      p.handlers.push([`onclick /id"tombolUpgrade" check:`, `    beli = 1`, `    goto #${p.roots.length + 1}`]);
      p.root(L("toko", "shop"), ["if beli == 0:", "    return", "beli = 0", "if skor >= harga:", "    skor = skor - harga", "    perKlik = perKlik + 1", "    harga = harga * 2",
        "    " + score.update, "    " + info.update, `    set("labelUpgrade", "text", "UPGRADE (" + harga + ")")`, `    show.popup("${L("upgrade! per klik jadi ", "upgraded! per click is now ")}" + perKlik)`,
        "else:", `    show.popup("${L("duit lu kurang, miskin 🥀", "not enough coins, broke 🥀")}")`]);
    }
    if (f.has("counter")) {
      p.v("angka", 0);
      const c = p.hud(L("angka", "count"), "angka");
      p.setup.push(`on 40 140 draw rect 70 50 color "#4f8f2f". tombolTambah`, `on 66 152 draw text "+" 26 color "#e6ecdd". labelTambah`,
        `on 130 140 draw rect 70 50 color "#a22633". tombolKurang`, `on 158 152 draw text "-" 26 color "#e6ecdd". labelKurang`);
      p.handlers.push([`onclick /id"tombolTambah" check:`, `    angka = angka + 1`, `    ${c.update}`], [`onclick /id"tombolKurang" check:`, `    angka = angka - 1`, `    ${c.update}`]);
    }
    if (f.has("dice")) {
      p.v("dadu", 0);
      p.setup.push(`on 40 130 draw square 90 color "#f4f1ea". kotakDadu`, `on 70 148 draw text "?" 48 color "#18161c". angkaDadu`,
        `on 40 240 draw rect 120 36 color "${spec.buttonColor || "#3b8ee4"}". tombolDadu`, `on 54 249 draw text "${L("LEMPAR", "ROLL")}" 16 color "#e6ecdd". labelDadu`);
      p.handlers.push([`onclick /id"tombolDadu" check:`, `    dadu = randint(1, 6)`, `    set("angkaDadu", "text", str(dadu))`]);
    }
    if (f.has("colorchange")) {
      const shape = (SHAPES.find(([re]) => re.test(" " + String(spec.raw || "").toLowerCase() + " ")) || [0, "square"])[1];
      const sh = shape === "line" ? "square" : shape;
      p.setup.push(`on ${W - 170} 130 draw ${sh} 110${sh === "rect" || sh === "ellipse" || sh === "triangle" ? " 80" : ""} color "${spec.buttonColor || "#b55088"}". bentukWarna`,
        `on ${W - 170} 250 draw text "${L("klik buat ganti warna", "click to change color")}" 12 color "#767d75". labelWarna`);
      p.handlers.push([`onclick /id"bentukWarna" check:`, `    set("bentukWarna", "color", choose("#e43b44", "#3b8ee4", "#63c74d", "#feae34", "#b55088", "#f77622", "#2ce8f5"))`]);
    }
    if (f.has("hover")) {
      p.setup.push(`on ${W - 170} 290 draw rect 140 30 color "#4a3626". kotakHover`);
      p.handlers.push([`onhover /id"kotakHover":`, `    set("kotakHover", "color", choose("#93cc5f", "#feae34", "#3b8ee4"))`]);
    }
    if (f.has("popup")) {
      const msg = spec.quotes[1] || (spec.quotes[0] && spec.title ? spec.quotes[0] : null) || L("halo! ini popup. jangan baper 🥀", "hi! this is a popup. don't cry 🥀");
      p.setup.push(`on 16 ${H - 90} draw rect 150 34 color "${spec.buttonColor || "#3b8ee4"}". tombolPopup`, `on 28 ${H - 82} draw text "${L("KLIK AKU", "CLICK ME")}" 15 color "#e6ecdd". labelPopup`);
      p.handlers.push([`onclick /id"tombolPopup" check:`, `    show.popup("${p.text(0, msg)}")`]);
    }
    if (f.has("traffic")) {
      p.v("lampu", 0);
      p.setup.push(`on ${W - 110} 50 draw rect 70 200 color "#2b2b2b". tiang`, `on ${W - 95} 60 draw circle 40 color "#e43b44". lampuMerah`,
        `on ${W - 95} 125 draw circle 40 color "#3a3a3a". lampuKuning`, `on ${W - 95} 190 draw circle 40 color "#3a3a3a". lampuHijau`);
      p.defs.push(["def gantiLampu():", "    lampu = lampu + 1", "    if lampu > 2:", "        lampu = 0", `    set("lampuMerah", "color", "#3a3a3a")`, `    set("lampuKuning", "color", "#3a3a3a")`,
        `    set("lampuHijau", "color", "#3a3a3a")`, "    if lampu == 0:", `        set("lampuMerah", "color", "#e43b44")`, "    elif lampu == 1:", `        set("lampuHijau", "color", "#63c74d")`, "    else:", `        set("lampuKuning", "color", "#feae34")`]);
      p.setup.push(`timer every 1 (gantiLampu()). jamLampu`);
      p.flags.add("needLoop");
    }

    if (f.has("countdown")) {
      const t = p.hud(L("waktu", "time"), "ceil(/time\"batasWaktu\")");
      p.v("habis", 0);
      if (!p.vars.has("skor")) p.v("skor", 0);
      const idx = p.root(L("waktuHabis", "timeUp"), ["if habis == 0:", "    return", "if selesai == 1:", "    return", "selesai = 1",
        `show.popup("${L("waktu habis! skor lu: ", "time's up! score: ")}" + skor)`, `on ${Math.round(W / 2 - 110)} ${Math.round(H / 2 - 24)} draw text "${L("WAKTU HABIS", "TIME UP")}" 34 color "#feae34". banner`]);
      p.setup.push(`countdown ${spec.seconds} (habis = 1; goto #${idx}). batasWaktu`);
      p.loop.unshift(t.update);
      if (!ended) p.v("selesai", 0);
    }
    if (f.has("stopwatch")) {
      const t = p.hud(L("lama main", "time played"), "round(/time\"stopwatchMain\")");
      p.setup.push(`stopwatch start. stopwatchMain`);
      p.loop.unshift(`set("${t.id}", "text", "${L("lama main", "time played")}: " + round(/time"stopwatchMain") + "s")`);
      p.flags.add("needLoop");
    }

    // ---- shapes scene
    if (f.has("shapes")) {
      const t = " " + (spec.raw || "").toLowerCase() + " ";
      const items = [];
      for (const [re, shape] of SHAPES) {
        const g = new RegExp(re.source, "g");
        let m;
        while ((m = g.exec(t))) {
          const near = spec.colors.filter((c) => Math.abs(c.at - m.index) < 22).sort((a, b) => Math.abs(a.at - m.index) - Math.abs(b.at - m.index))[0];
          items.push({ shape, color: near ? near.hex : null, at: m.index });
        }
      }
      items.sort((a, b) => a.at - b.at);
      if (spec.lookups) for (const l of spec.lookups) items.push({ shape: l.shape, color: l.color, label: l.word });
      if (!items.length) items.push({ shape: "circle", color: "#feae34" }, { shape: "square", color: "#3b8ee4" }, { shape: "triangle", color: "#63c74d" });
      if (/\brumah|house\b/.test(t) && !items.some((i) => i.house)) items.unshift({ house: true });
      let x = 30;
      const y = Math.max(140, p.hudY + 40);
      const palette = ["#feae34", "#3b8ee4", "#63c74d", "#e43b44", "#b55088", "#f77622"];
      items.slice(0, 8).forEach((it, i) => {
        if (it.house) {
          p.setup.push(`on ${x} ${y + 30} draw square 90 color "#b86f50". dindingRumah`, `on ${x - 10} ${y - 30} draw triangle 110 60 color "#a22633". atapRumah`,
            `on ${x + 33} ${y + 75} draw rect 24 45 color "#4a3626". pintuRumah`);
          x += 130; return;
        }
        const id = p.id(camel(it.label || it.shape));
        const col = it.color || palette[i % palette.length];
        const sz = it.shape === "rect" ? "90 50" : it.shape === "ellipse" ? "90 55" : it.shape === "triangle" ? "70 60" : it.shape === "line" ? `${x + 80} ${y + 60}` : "60";
        p.setup.push(`on ${x} ${y} draw ${it.shape} ${sz} color "${col}". ${id}`);
        if (it.label) p.setup.push(`on ${x} ${y + 70} draw text "${p.text(0, it.label)}" 12 color "#e6ecdd". ${p.id("label" + cap(camel(it.label)))}`);
        x += it.shape === "rect" || it.shape === "ellipse" ? 110 : 90;
        if (x > W - 70) x = 30;
      });
    }

    // ---- sequential programs in main (popups): greet, password, quiz, guess, calculator
    const seq = [];
    if (f.has("greet")) {
      p.v("nama", "\"\"");
      p.setup.push(`on 16 ${p.hudY} draw text "${L("halo", "hello")}" 18 color "#e6ecdd". sapa`); p.hudY += 26;
      seq.push(`nama = show.anspopup("${L("siapa nama lu?", "what's your name?")}")`, `set("sapa", "text", "${L("halo, ", "hello, ")}" + nama + "${L(". nama lu jelek 🥀", ". mid name 🥀")}")`);
    }
    if (f.has("password")) {
      const pw = spec.password || "sybau123";
      p.v("sandi", "\"\""); p.v("coba", 0);
      seq.push(`while sandi != "${pw}":`, `    sandi = show.anspopup("${L("masukin password:", "enter password:")}")`, `    coba = coba + 1`, `    if sandi != "${pw}":`,
        `        show.popup("${L("salah. coba lagi 🥀", "wrong. try again 🥀")}")`, `show.popup("${L("bener! masuk setelah ", "correct! got in after ")}" + coba + "${L(" kali coba", " tries")}")`);
    }
    if (f.has("quiz")) {
      if (!p.vars.has("skor")) { p.v("skor", 0); score = p.hud(L("skor", "score"), "skor"); }
      p.v("jawab", "\"\"");
      for (let i = 0; i < spec.questions; i++) {
        const a = rint(rand, 2, 20), b = rint(rand, 2, 12), op = ["+", "-", "*"][i % 3];
        const ans = op === "+" ? a + b : op === "-" ? a - b : a * b;
        seq.push(`jawab = show.anspopup("${L("soal", "question")} ${i + 1}: ${a} ${op === "*" ? "x" : op} ${b} = ?")`, `if num(jawab) == ${ans}:`, `    skor = skor + 1`, `    ${score.update}`,
          `    show.popup("${L("bener", "correct")}")`, "else:", `    show.popup("${L("salah, jawabannya ", "wrong, it's ")}${ans}${L(". sd lagi sana 🥀", ". back to school 🥀")}")`);
      }
      seq.push(`show.popup("${L("selesai! skor lu ", "done! you got ")}" + skor + "/${spec.questions}")`);
    }
    if (f.has("guess")) {
      p.v("rahasia", 0); p.v("tebakan", 0); p.v("percobaan", 0);
      seq.push(`rahasia = randint(1, ${spec.max})`, `while tebakan != rahasia:`, `    tebakan = num(show.anspopup("${L("tebak angka 1 sampe ", "guess a number from 1 to ")}${spec.max}"))`,
        `    percobaan = percobaan + 1`, `    if tebakan < rahasia:`, `        show.popup("${L("kekecilan", "too low")}")`, `    elif tebakan > rahasia:`, `        show.popup("${L("kegedean", "too high")}")`,
        `show.popup("${L("bener! angkanya ", "correct! it was ")}" + rahasia + ", " + percobaan + "${L(" kali nebak 🥀", " tries 🥀")}")`);
    }
    if (f.has("calculator")) {
      p.v("a", 0); p.v("b", 0);
      p.setup.push(`on 16 ${p.hudY} draw text "" 16 color "#e6ecdd". hasil1`, `on 16 ${p.hudY + 22} draw text "" 16 color "#e6ecdd". hasil2`,
        `on 16 ${p.hudY + 44} draw text "" 16 color "#e6ecdd". hasil3`, `on 16 ${p.hudY + 66} draw text "" 16 color "#e6ecdd". hasil4`);
      p.hudY += 92;
      seq.push(`a = num(show.anspopup("${L("angka pertama:", "first number:")}"))`, `b = num(show.anspopup("${L("angka kedua:", "second number:")}"))`,
        `set("hasil1", "text", a + " + " + b + " = " + (a + b))`, `set("hasil2", "text", a + " - " + b + " = " + (a - b))`, `set("hasil3", "text", a + " x " + b + " = " + (a * b))`,
        `if b != 0:`, `    set("hasil4", "text", a + " / " + b + " = " + (a / b))`, "else:", `    set("hasil4", "text", "${L("bagi nol? ga bisa bang", "divide by zero? nope")}")`);
    }

    // ---- assemble
    const out = [];
    out.push(...p.head);
    out.push("");
    for (const [k, v] of p.vars) out.push(`var ${k} = ${v}`);
    if (p.vars.size) out.push("");
    for (const d of p.defs) out.push(...d, "");
    out.push(...p.setup);
    for (const h of p.handlers) out.push("", ...h);
    if (seq.length) out.push("", ...seq);
    if (p.loop.length || p.flags.has("needLoop")) {
      out.push("", "forever:");
      const body = p.loop.length ? p.loop : ["selesai = selesai"];
      if (!p.loop.length) p.v("selesai", 0);
      if (p.vars.has("selesai") && p.loop.length) { out.push("    if selesai == 0:"); body.forEach((l) => out.push("        " + l)); }
      else body.forEach((l) => out.push("    " + l));
    }
    const roots = [{ index: 0, name: "main", code: out.join("\n") + "\n" }];
    // vars added late (by roots) must be declared in main too
    const declared = new Set([...out.join("\n").matchAll(/^var (\w+)/gm)].map((m) => m[1]));
    const missing = [...p.vars.keys()].filter((k) => !declared.has(k));
    if (missing.length) roots[0].code = missing.map((k) => `var ${k} = ${p.vars.get(k)}`).join("\n") + "\n" + roots[0].code;
    p.roots.forEach((r, i) => roots.push({ index: i + 1, name: r.name, code: r.lines.join("\n") + "\n" }));
    return { roots, stage: { w: W, h: H }, title };
  }

  // ------------------------------------------------------------------ verify + repair with the real compiler
  function repair(roots, err) {
    const r = roots.find((x) => x.index === err.root) || roots[0];
    const lines = r.code.split("\n");
    const li = Math.max(0, (err.line || 1) - 1);
    let m;
    if ((m = /'(\w+)' is never given a value/.exec(err.error))) {
      roots[0].code = `var ${m[1]} = 0\n` + roots[0].code;
      return "variabel '" + m[1] + "' belum dikasih nilai, gw tambahin 'var " + m[1] + " = 0'";
    }
    if (/file name in quotes/.test(err.error)) {
      lines[li] = lines[li].replace(/draw (image|video|img|picture)\s+([^\s"]+\.\w+)/, 'draw $1 "$2"');
      r.code = lines.join("\n");
      return "nama file belum dikutip, gw kasih tanda kutip";
    }
    if (/block is empty/.test(err.error)) {
      const ind = (lines[li - 1] || "").match(/^\s*/)[0] + "    ";
      lines.splice(li, 0, ind + 'log("")');
      r.code = lines.join("\n");
      return "blok kosong di baris " + (li) + ", gw isi biar valid";
    }
    // last resort: comment the line out so the rest still works
    lines[li] = "// " + lines[li].trim() + "   // (sybau: baris ini gw matiin, error: " + err.error.slice(0, 60) + ")";
    r.code = lines.join("\n");
    return "baris " + (li + 1) + " error (" + err.error + "), gw matiin dulu biar sisanya jalan";
  }

  function toSts(prog, name) {
    const out = ["// STS project: " + name, "// stage " + prog.stage.w + "x" + prog.stage.h, "// dibikin sama sybau code. jangan bangga, gw yang mikir 🥀", ""];
    for (const r of prog.roots) out.push("@root " + r.index + " " + r.name, r.code.replace(/\n+$/, ""), "");
    return out.join("\n");
  }

  // ------------------------------------------------------------------ STS questions (docs)
  function docSections(md) {
    const parts = md.split(/\n## /).slice(1).map((s) => { const [head, ...rest] = s.split("\n"); return { head, body: rest.join("\n").trim() }; });
    return parts;
  }

  class StsCoder {
    constructor(opts = {}) {
      this.reader = opts.coderModel ? new RequestReader(opts.coderModel) : null;
      this.vm = opts.vm || null;
      this.docs = opts.docs ? docSections(opts.docs).map((d) => Object.assign(d, { vec: Lib.featurize(d.head + " " + d.head + " " + d.body, 4096) })) : [];
      this.search = opts.search || null;
      this.rand = opts.rand || Math.random;
      this.last = null;
    }

    /** is this a question about STS rather than a request to write code? */
    _askDocs(text) {
      if (!this.docs.length) return null;
      const t = text.toLowerCase();
      if (!/\b(apa itu|gimana|bagaimana|cara|caranya|jelasin|what is|how (do|to|can)|explain|kenapa|why|artinya|maksudnya|fungsi)\b/.test(t)) return null;
      if (/\b(bikin(in)?|buat(in)?|make|create|build|write|generate|kodein)\b.*\b(game|program|aplikasi|app|kode|code)\b/.test(t)) return null;
      const v = Lib.featurize(text, 4096);
      let best = null, bs = 0;
      for (const d of this.docs) { let s = 0; for (const [k, x] of v) { const y = d.vec.get(k); if (y) s += x * y; } if (s > bs) { bs = s; best = d; } }
      return best && bs > 0.12 ? best : null;
    }

    /** main entry: text -> {kind:"code"|"docs", steps[], program, sts, file, ...} */
    async handle(text, opts = {}) {
      const steps = [];
      const say = (s) => { steps.push(s); if (opts.onStep) opts.onStep(s); };
      const doc = this._askDocs(text);
      if (doc) {
        say("ini pertanyaan soal bahasa STS, bukan minta dibikinin. gw buka docs STS: \"" + doc.head + "\"");
        return { kind: "docs", steps, head: doc.head, body: doc.body };
      }
      const lower = " " + text.toLowerCase() + " ";
      const isEdit = !!this.last && /\b(tambah\w*|add|ganti\w*|ubah|change|jadiin|hapus|remove|tanpa|without|make it|lebih|buang)\b/.test(lower) &&
        !/\b(bikin(in)?|buat(in)?|make|create|build)\b.{0,20}\b(game|program|aplikasi|app)\b.{0,6}(baru|lain|new|another)?/.test(lower.replace(/make it/, ""));
      say("1. baca permintaan" + (isEdit ? " (ini ngedit program yang tadi)" : ""));
      let spec = understand(text, this.reader, { experimental: opts.experimental });
      spec.raw = text;
      for (const n of spec.notes) say("   ~ " + n);
      // experimental: look up words it has never seen, to guess a colour and shape
      if (opts.experimental && this.search && (spec.guessed || spec.itemName || spec.enemyName)) {
        const words = [spec.itemName, spec.enemyName].filter(Boolean);
        if (spec.guessed) words.push(...(text.toLowerCase().match(/[a-z]{4,}/g) || []).filter((w) => !/^(bikin|bikinin|buat|buatin|tolong|gambar|game|yang|dong|aja|make|draw|create|with|please)$/.test(w)).slice(0, 2));
        spec.lookups = [];
        for (const w of words.slice(0, 3)) {
          say("   ? gw ga punya data soal '" + w + "', nyari artinya di wikipedia dulu...");
          let res = null;
          try { res = await this.search.answer(w, spec.lang); } catch (e) { res = null; }
          const ex = res ? ((res.extract || "") + " " + (res.title || "")).toLowerCase() : "";
          const col = findColors(" " + ex + " ")[0];
          const shape = (SHAPES.find(([re]) => re.test(" " + ex + " ")) || [0, null])[1];
          if (res) say("     → '" + w + "' = " + (res.title || w) + (col ? ", warnanya " + COLOR_NAMES[col.hex][0] : "") + (shape ? ", bentuknya " + shape : ""));
          else say("     → ga ketemu. gw tebak aja");
          if (w === spec.itemName && col) spec.itemColor = spec.itemColor || col.hex;
          if (w === spec.enemyName && col) spec.enemyColor = spec.enemyColor || col.hex;
          if (spec.guessed) spec.lookups.push({ word: w, color: col ? col.hex : null, shape: shape || "circle" });
        }
      }
      if (isEdit) {
        const prev = this.last.spec;
        const removed = [...spec.features].filter(() => /\b(hapus|remove|tanpa|without|buang)\b/.test(lower));
        const merged = new Set(prev.features);
        if (removed.length) { for (const fe of spec.features) if (fe !== "score" && fe !== "move") merged.delete(fe); }
        else for (const fe of spec.features) if (!spec.guessed) merged.add(fe);
        const keep = Object.assign({}, prev, { features: merged, raw: prev.raw + " " + text });
        for (const k of ["bg", "playerColor", "enemyColor", "itemColor", "buttonColor", "title", "password", "itemName", "enemyName"]) if (spec[k]) keep[k] = spec[k];
        const defaults = { lives: 3, seconds: 30, items: 6, enemies: 3, questions: 3, price: 10, goal: 0, max: 100 };
        for (const k of Object.keys(defaults)) if (/\d/.test(text) && spec[k] !== defaults[k]) keep[k] = spec[k];
        keep.colors = spec.colors.length ? spec.colors : prev.colors;
        keep.quotes = spec.quotes.length ? spec.quotes : prev.quotes;
        keep.why = Object.assign({}, prev.why, spec.why);
        keep.guessed = false;
        spec = keep;
        let ch = true;
        while (ch) { ch = false; for (const fe of [...spec.features]) for (const dd of DEPENDS[fe] || []) if (!spec.features.has(dd)) { spec.features.add(dd); ch = true; } }
      }
      const feats = [...spec.features];
      say("   paham: " + feats.map((fe) => fe + " (" + (spec.why[fe] || "lanjutan") + ")").join(", "));
      const facts = [];
      if (spec.features.has("lives")) facts.push(spec.lives + " nyawa");
      if (spec.features.has("countdown")) facts.push(spec.seconds + " detik");
      if (spec.features.has("collect")) facts.push(spec.items + " " + (spec.itemName || "koin"));
      if (spec.features.has("dodge")) facts.push(spec.enemies + " " + (spec.enemyName || "musuh"));
      if (spec.features.has("quiz")) facts.push(spec.questions + " soal");
      if (spec.bg) facts.push("background " + COLOR_NAMES[spec.bg][0]);
      if (spec.playerColor) facts.push("pemain " + COLOR_NAMES[spec.playerColor][0]);
      if (facts.length) say("   detail: " + facts.join(", "));
      if (spec.guessed && !spec.lookups) say("   ga ada fitur yang gw kenal, jadi gw gambar yang lu sebut aja (jujur nih, ini tebakan)");
      say("2. rencana: " + planText(spec));
      say("3. nulis kode STS...");
      const prog = build(spec, this.rand);
      const name = camel(prog.title).slice(0, 24) || "sybauGame";
      const loc = prog.roots.reduce((s, r) => s + r.code.split("\n").length, 0);
      say("   " + prog.roots.length + " root, " + loc + " baris");
      let compiled = null;
      const fixes = [];
      if (this.vm) {
        say("4. compile pake compiler STS asli (sts.wasm)...");
        for (let attempt = 1; attempt <= 8; attempt++) {
          const res = this.vm.compile(prog.roots);
          if (res.ok) { say("   attempt " + attempt + ": lolos ✓"); compiled = true; break; }
          const where = res.root > 0 ? "root #" + res.root : "main";
          say("   attempt " + attempt + ": error di " + where + " baris " + res.line + ": " + res.error);
          const fix = repair(prog.roots, res);
          fixes.push(fix);
          say("   → " + fix);
        }
        if (compiled) {
          const run = Sts.smokeRun(this.vm, prog.roots, { frames: 180 });
          say(run.ok ? "5. tes jalanin 3 detik: aman, " + run.objects + " objek di layar ✓" : "5. tes jalanin: runtime error: " + run.error + " (ini kodenya tetep gw kasih, cek bagian itu)");
          compiled = run.ok ? true : "runtime";
        } else say("   nyerah setelah 8 kali benerin. kode tetep gw kasih, tapi ada yang masih rusak");
      }
      const sts = toSts(prog, name);
      this.last = { spec, prog, sts };
      return { kind: "code", steps, program: prog, sts, file: name + ".sts", compiled, fixes, features: feats, lang: spec.lang };
    }
  }

  function planText(spec) {
    const f = spec.features, out = [];
    const id = spec.lang === "id";
    const P = { clicker: id ? "tombol gede yang nambah skor tiap diklik" : "a big button that adds score", shop: id ? "toko upgrade (root sendiri)" : "an upgrade shop root",
      move: id ? "pemain digerakin panah/wasd" : "a player on arrow keys/wasd", maze: id ? "tembok solid + gawang finish" : "solid walls and a goal",
      collect: id ? "barang random buat dikumpulin" : "random items to collect", dodge: id ? "musuh jatuh yang harus dihindarin" : "falling enemies to dodge",
      lives: id ? "sistem nyawa" : "lives", countdown: id ? "hitung mundur" : "a countdown", stopwatch: "stopwatch", quiz: id ? "kuis pake popup jawaban" : "a quiz with answer popups",
      greet: id ? "nanya nama terus nyapa" : "ask the name and greet", dice: id ? "dadu" : "a dice", guess: id ? "tebak angka" : "number guessing",
      counter: id ? "tombol + dan -" : "+ and - buttons", calculator: id ? "kalkulator 2 angka" : "a 2-number calculator", colorchange: id ? "bentuk ganti warna" : "a color changer",
      bounce: id ? "bola mantul" : "a bouncing ball", popup: id ? "tombol popup" : "a popup button", hover: id ? "efek hover" : "a hover effect", traffic: id ? "lampu lalu lintas pake timer" : "traffic lights on a timer",
      password: id ? "cek password" : "a password check", jump: id ? "lompat + gravitasi" : "jumping with gravity", pong: id ? "paddle sama bola" : "a paddle and ball",
      shapes: id ? "gambar bentuk-bentuk" : "draw shapes", score: id ? "skor di pojok" : "a score display" };
    for (const k of Object.keys(P)) if (f.has(k)) out.push(P[k]);
    return out.join(" + ");
  }

  const api = { StsCoder, understand, build, repair, toSts, RequestReader, editDistance };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.StsCoderLib = api;
})(typeof self !== "undefined" ? self : this);
