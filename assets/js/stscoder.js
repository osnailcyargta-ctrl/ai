/* stscoder.js — "sybau code": turns a request into a working STS program, from scratch.
 *
 * How it thinks (every step is shown to the user):
 *   1. read      - pull the THINGS out of the request ("ninja", "zombie", "shuriken") and
 *                  what the request does with them (play as, run from, collect, shoot,
 *                  get chased by, catch, click...), plus numbers, colours and limits.
 *                  A small neural net (model/coder.json) also reads the request for the
 *                  kind of program, which catches paraphrases the rules miss.
 *   2. research  - looks every thing up: Wikipedia first (what IS a zombie? a monster,
 *                  slow, chases people), then a small offline knowledge base. From the
 *                  text it decides the role, how it moves, colour, size and speed.
 *                  A quiz about a topic gets its questions from the article it read.
 *   3. design    - turns that into a game design: player + controls, every other thing
 *                  with its movement and what happens on contact, how to win and lose.
 *   4. write     - stsgen.js writes the STS code for that design, function by function.
 *   5. verify    - the REAL STS compiler (sts.wasm) checks it; errors get read and fixed.
 *   6. test      - the program is run head-less with test hooks: does the player move
 *                  when the key is pressed, does the zombie actually take a life when it
 *                  touches you, does the shuriken score... failures are reported honestly.
 * Follow-ups ("tambahin 2 zombie lagi", "ganti warna ninja jadi merah") edit the last design.
 */
(function (root) {
  "use strict";
  const Lib = root.BrainLib || (typeof require === "function" ? require("./brain.js") : null);
  const Sts = root.StsLib || (typeof require === "function" ? require("./stsvm.js") : null);
  const Gen = root.StsGenLib || (typeof require === "function" ? require("./stsgen.js") : null);
  const { cap, camel } = Gen;

  // ------------------------------------------------------------------ vocabulary
  const COLORS = [
    [/\b(merah muda|pink|pinky|magenta)\b/, "#f6757a"], [/\b(merah|red|maroon|crimson)\b/, "#e43b44"], [/\b(biru muda|light blue|sky ?blue|cyan|tosca|toska|aqua)\b/, "#2ce8f5"],
    [/\b(biru tua|navy|dark blue)\b/, "#124e89"], [/\b(biru|blue)\b/, "#3b8ee4"], [/\b(hijau tua|dark green)\b/, "#3e8948"], [/\b(hijau|ijo|green|lime)\b/, "#63c74d"],
    [/\b(kuning|yellow)\b/, "#feae34"], [/\b(emas|gold|golden|keemasan)\b/, "#ffd23f"], [/\b(oranye|orange|jingga|oren)\b/, "#f77622"], [/\b(ungu|purple|violet)\b/, "#b55088"],
    [/\b(hitam|black)\b/, "#18161c"], [/\b(putih|white)\b/, "#f4f1ea"], [/\b(abu ?abu|abu|gray|grey|silver|perak|kelabu)\b/, "#8e8a93"], [/\b(coklat|cokelat|brown)\b/, "#b86f50"],
  ];
  const SHAPES = [[/\b(lingkaran|bulat|bunder|bundar|circle|round)\b/, "circle"], [/\b(segitiga|triangle)\b/, "triangle"], [/\b(elips|oval|ellipse)\b/, "ellipse"],
    [/\b(persegi panjang|rectangle|rect|balok)\b/, "rect"], [/\b(kotak|persegi|square|box|block|blok)\b/, "square"]];
  const COLOR_NAMES = { "#f6757a": ["pink", "pink"], "#e43b44": ["merah", "red"], "#2ce8f5": ["biru muda", "cyan"], "#124e89": ["biru tua", "navy"], "#3b8ee4": ["biru", "blue"],
    "#3e8948": ["hijau tua", "dark green"], "#63c74d": ["hijau", "green"], "#feae34": ["kuning", "yellow"], "#ffd23f": ["emas", "gold"], "#f77622": ["oranye", "orange"],
    "#b55088": ["ungu", "purple"], "#18161c": ["hitam", "black"], "#f4f1ea": ["putih", "white"], "#8e8a93": ["abu-abu", "gray"], "#b86f50": ["coklat", "brown"] };
  const colorName = (hex, lang) => (COLOR_NAMES[hex] ? COLOR_NAMES[hex][lang === "en" ? 1 : 0] : hex);

  // kinds of program (the neural reader knows these too)
  const RULES = {
    clicker: /\b(clicker|cookie clicker|tap(ping)? game|game (klik|click|ngeklik)|klik.{0,25}(dapet|dapat|nambah|tambah|koin|poin|skor|duit)|click.{0,25}(get|earn|coin|point|score|money))/,
    shop: /\b(shop|toko|upgrade|store)\b/,
    move: /\b(gerak(in|kan)?|bergerak|move|moving|arrow|panah|wasd|keyboard|kontrol|control)\b/,
    maze: /\b(maze|labirin|labyrinth)\b/,
    collect: /\b(kumpul\w*|ngumpul\w*|mengumpul\w*|collect\w*|pick ?up|grab|ambil\w*|ngambil\w*|mengambil|makan\w*|memakan|eat\w*|mungut\w*|pungut\w*|memungut)\b/,
    dodge: /\b(hindar\w*|menghindar\w*|dodge\w*|avoid\w*|kabur|escape|rintangan|obstacles?)\b/,
    shoot: /\b(tembak\w*|nembak\w*|shoot\w*|shooter|lempar\w*|ngelempar\w*|throw\w*|serang\w*|nyerang|attack\w*|basmi\w*|bunuh\w*|ngebunuh|kill\w*|lawan\w*|ngelawan|fight\w*|blast\w*)\b/,
    chase: /\b(dikejar|dikejer|ngejar|mengejar|kejar\w*|chase[sd]?|chasing|hunt\w*|memburu|diburu)\b/,
    catch: /\b(tangkap\w*|tangkep\w*|nangkep\w*|nangkap\w*|catch\w*)\b/,
    flappy: /\b(flappy|terbangin|nerbangin|tap to fly|game terbang)\b/,
    whack: /\b(whack|pukul\w*|geplak\w*|tabok\w*|mole|tikus tanah|klik \w+ yang muncul|muncul.{0,20}klik)\b/,
    survive: /\b(bertahan|survive|survival|selamat selama)\b/,
    lives: /\b(nyawa|lives|life|hp|health|darah)\b/,
    countdown: /\b(countdown|hitung mundur|batas waktu|time limit|waktu (habis|terbatas)|\d+\s*(detik|seconds?|secs?)|timer)\b/,
    stopwatch: /\b(stopwatch|stop watch|lama main|how long|count ?up|jam main)\b/,
    quiz: /\b(quiz|kuis|trivia|ujian|cerdas cermat|tebak.?tebakan)\b|\b\d+\s*(soal|pertanyaan|questions)\b/,
    greet: /\b(nama (lu|gw|aku|user|kamu)|tanya nama|nanya nama|ask (my|for|the user'?s?) name|greet|input nama|masukin nama|sapa)\b/,
    dice: /\b(dadu|dice|roll)\b/,
    guess: /\b(tebak (angka|nomor)|guess(ing)? (the |a )?number|higher or lower|kekecilan)\b/,
    counter: /\b(counter|penghitung|tally|increment|tambah (dan|&) kurang|plus minus)\b/,
    calculator: /\b(kalkulator|calculator|hitung dua angka|add two numbers|jumlahin)\b/,
    colorchange: /\b(ganti warna|ubah warna|berubah warna|change colou?r|random colou?r|warna (acak|random)|color changer)\b/,
    bounce: /\b(mantul|memantul|pantul|bounc\w*|dvd)\b/,
    popup: /\b(popup|pop up|alert|message box|munculin pesan)\b/,
    hover: /\b(hover|mouse over)\b/,
    traffic: /\b(lampu (lalu lintas|merah|stopan)|traffic light)\b/,
    password: /\b(password|kata sandi|login)\b/,
    jump: /\b(lompat\w*|loncat\w*|jump\w*|platformer|gravitasi|gravity|runner)\b/,
    pong: /\b(pong|paddle|raket|breakout|ping pong)\b/,
    shapes: /\b(gambar(in)?|draw|lukis|pemandangan|scene)\b/,
    score: /\b(skor|score|nilai|poin|points?)\b/,
  };
  // games known by name (they have their own rules, see stsgen.js)
  const GAMES = [
    ["tictactoe", /\b(tic ?tac ?toe|tik ?tak ?to[ek]?|tictactoe|x ?o ?x|o ?x ?o|xo|noughts and crosses|silang bulat)\b/, ["tictactoe", "tiktaktok", "noughtsandcrosses", "xox"]],
    ["snake", /\b(snake( game)?|game ular|ular ?ularan|ular makan \w+|cacing makan|nokia snake)\b/, ["snakegame", "snake"]],
    ["rps", /\b(suit|suwit|batu gunting kertas|gunting batu kertas|kertas gunting batu|rock paper scissors?|janken)\b/, ["batuguntingkertas", "rockpaperscissors", "guntingbatukertas"]],
  ];
  function findGame(t) {
    for (const [name, re] of GAMES) if (re.test(t)) return { name };
    // typos: "rictactoe", "tik tak tok", "rock paper sciccors" (joined words, edit distance)
    const w = t.trim().split(/\s+/);
    for (let n = 1; n <= 3; n++) for (let i = 0; i + n <= w.length; i++) {
      const joined = w.slice(i, i + n).join("");
      if (joined.length < 6) continue;
      for (const [name, , spellings] of GAMES) for (const sp of spellings) if (Math.abs(sp.length - joined.length) <= 2 && editDistance(joined, sp) <= (sp.length >= 9 ? 2 : 1)) return { name, typo: w.slice(i, i + n).join(" "), as: sp };
    }
    return null;
  }
  const APPS = new Set(["greet", "dice", "guess", "counter", "calculator", "colorchange", "popup", "hover", "traffic", "password", "quiz", "shapes"]);
  const KNOWN_WORDS = ["clicker", "toko", "shop", "upgrade", "labirin", "maze", "kumpulin", "collect", "hindarin", "dodge", "tembak", "shoot", "lempar", "kejar", "dikejar", "tangkap",
    "nyawa", "lives", "countdown", "timer", "detik", "stopwatch", "kuis", "quiz", "soal", "nama", "dadu", "dice", "tebak", "angka", "counter", "kalkulator", "calculator",
    "warna", "mantul", "bounce", "popup", "hover", "lampu", "password", "lompat", "jump", "pong", "paddle", "skor", "score", "pemain", "player", "keyboard", "tentang"];
  const ID_WORDS = /\b(bikin\w*|buat\w*|pake|pakai|yang|dan|terus|sama|kalo|kalau|nyawa|hindar\w*|kumpul\w*|ngumpul\w*|gambar\w*|tombol|lempar\w*|tembak\w*|kejar\w*|tebak|soal|kuis|tentang|warna|ganti|lampu|lompat\w*|detik|koin|musuh|sampe|sampai|tambah\w*|kurang|jadi|sebagai|tolong|dong|game nya)\b/;

  const EN_WORDS = /\b(make|create|build|write|with|the|and|that|where|you|your|player|enemies|lives|score|shoot|dodge|collect|jump|questions?|falling|when|from|about|game where|catch|avoid)\b/;
  // words that are never "things"
  const STOP = new Set(("game games permainan gamenya program aplikasi app apps kode code yang dan atau terus lalu sama dengan pake pakai pakek make using with buat bikin bikinin buatin " +
    "tolong dong deh aja ya yg gw gue aku saya lu lo kamu kau dia mereka kita kami bisa harus mau pengen ingin kalo kalau jika when if then and or the a an of to in on at for from by " +
    "is are be it its this that these those my your his her their our me you we they some all semua para banyak beberapa many lots lot much more less lagi juga ada sih nya " +
    "ini itu tiap setiap every each nanti trus abis habis biar supaya agar so ke di dari dalam luar atas bawah kiri kanan up down left right top bottom " +
    "satu dua tiga empat lima enam tujuh delapan sembilan sepuluh one two three four five six seven eight nine ten " +
    "skor score poin point points nilai nyawa lives life hp darah detik second seconds secs menit minute waktu time timer countdown stopwatch level stage " +
    "cepat cepet kenceng fast quick lambat pelan slow besar gede raksasa big giant huge kecil mini small tiny keren cool bagus lucu seru simple sederhana mudah susah sulit " +
    "kumpulin ngumpulin kumpulkan kumpul collect ambil ngambil hindarin hindari menghindari dodge avoid tembak nembak shoot lempar throw serang attack lawan fight kejar ngejar dikejar chase " +
    "tangkap tangkep nangkep catch makan eat klik click pencet tap lompat loncat jump terbang fly jalan lari run gerak move bergerak kontrol control jadi sebagai main play mainin " +
    "menang win kalah lose kena hit nabrak touch touching sampe sampai reach muncul appear jatuh fall falling berjatuhan bertahan survive mati die " +
    "tambah tambahin tambahkan add ganti ganti ubah change hapus remove tanpa without lebih versi baru new another lain " +
    "warna color colour background latar bg layar screen kotak square lingkaran circle segitiga triangle bentuk shape gambar draw " +
    "sambil kabur lari pergi datang dateng muncul ilang hilang terbang jalan nunggu tunggu bisa boleh " +
    "kuis quiz soal pertanyaan question questions tentang about seputar mengenai trivia vs versus lawan melawan against").split(/\s+/));
  for (const [re] of COLORS) for (const w of re.source.replace(/\\b|\(|\)/g, "").split("|")) STOP.add(w.replace(/ \?/g, " ").trim());

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
  const rint = (rand, a, b) => a + Math.floor(rand() * (b - a + 1));
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const r1 = (x) => Math.round(x * 10) / 10;

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

  // ------------------------------------------------------------------ offline knowledge base
  class Knowledge {
    constructor(json) {
      this.things = (json && json.things) || [];
      this.index = new Map();
      for (const t of this.things) for (const n of t.names) this.index.set(n, t);
      this.multi = [...this.index.keys()].filter((k) => k.includes(" ")).sort((a, b) => b.length - a.length);
    }
    /** word -> {entry, name, fuzzy} */
    find(word) {
      const w = word.toLowerCase();
      if (this.index.has(w)) return { entry: this.index.get(w), name: w };
      for (const s of [w.replace(/es$/, ""), w.replace(/s$/, ""), w.replace(/nya$/, "")]) if (s.length > 2 && this.index.has(s)) return { entry: this.index.get(s), name: s };
      if (w.length < 4) return null;
      let best = null, bd = 9;
      for (const k of this.index.keys()) {
        if (Math.abs(k.length - w.length) > 2 || k[0] !== w[0]) continue;
        const d = editDistance(w, k);
        if (d < bd) { bd = d; best = k; }
      }
      if (best && bd <= (w.length >= 7 ? 2 : 1)) return { entry: this.index.get(best), name: best, fuzzy: true };
      return null;
    }
  }

  // what a category means in a game
  const CATS = {
    monster: { role: "enemy", motion: "chase", shape: "square", color: "#9b4ab5", size: 24, id: "monster", en: "monster", harmful: true },
    predator: { role: "enemy", motion: "chase", shape: "square", color: "#c0392b", size: 28, id: "pemangsa", en: "predator", harmful: true },
    hazard: { role: "enemy", motion: "fall", shape: "circle", color: "#b86f50", size: 24, id: "benda bahaya", en: "hazard", harmful: true },
    person: { role: "player", motion: "chase", shape: "square", color: "#3b8ee4", size: 24, id: "orang/tokoh", en: "person" },
    animal: { role: "player", motion: "wander", shape: "square", color: "#b86f50", size: 22, id: "hewan", en: "animal" },
    bird: { role: "enemy", motion: "fly", shape: "triangle", color: "#3b8ee4", size: 20, id: "hewan terbang", en: "flying animal" },
    insect: { role: "enemy", motion: "wander", shape: "circle", color: "#2b2b2b", size: 12, id: "serangga", en: "insect" },
    fish: { role: "item", motion: "wander", shape: "ellipse", color: "#2ce8f5", size: 20, id: "hewan air", en: "water animal" },
    vehicle: { role: "player", motion: "patrol", shape: "rect", color: "#e43b44", size: 34, id: "kendaraan", en: "vehicle" },
    treasure: { role: "item", motion: "static", shape: "circle", color: "#ffd23f", size: 16, id: "barang berharga", en: "treasure" },
    fruit: { role: "item", motion: "static", shape: "circle", color: "#e43b44", size: 18, id: "buah", en: "fruit" },
    food: { role: "item", motion: "static", shape: "circle", color: "#d9a066", size: 18, id: "makanan", en: "food" },
    weapon: { role: "projectile", motion: "static", shape: "triangle", color: "#c0c0c8", size: 12, id: "senjata", en: "weapon" },
    space: { role: "item", motion: "static", shape: "circle", color: "#3b8ee4", size: 30, id: "benda langit", en: "space object" },
    nature: { role: "item", motion: "static", shape: "triangle", color: "#3e8948", size: 26, id: "alam", en: "nature" },
    building: { role: "goal", motion: "static", shape: "square", color: "#b86f50", size: 34, id: "bangunan", en: "building" },
    catcher: { role: "player", motion: "static", shape: "rect", color: "#b86f50", size: 44, id: "penampung", en: "catcher" },
    goal: { role: "goal", motion: "static", shape: "square", color: "#4f8f2f", size: 30, id: "tujuan", en: "goal" },
    object: { role: "item", motion: "static", shape: "circle", color: "#feae34", size: 18, id: "benda", en: "object" },
  };
  // reading a Wikipedia text for what something is
  const CAT_WORDS = {
    monster: /\b(makhluk (fiksi|mitologi|halus|legenda\w*|gaib)|monster|hantu|mayat hidup|mayat|dihidupkan kembali|horor|horror|corpse|reanimated|revenant|mytholog\w*|undead|setan|iblis|vampir|zombi\w*|ghost|demon|fictional creature|legendary creature|mythical|supernatural|roh jahat|siluman|alien)\b/g,
    predator: /\b(predator|karnivora|pemangsa|buas|berbisa|venomous|carnivor\w*|apex|memangsa|menyerang manusia)\b/g,
    hazard: /\b(meteor\w*|asteroid|bom|bahan peledak|explosive|ledakan|explosion|api|fire|petir|lightning|racun|poison\w*|virus|bakteri|bacteria|penyakit|disease|lava|bencana|disaster)\b/g,
    weapon: /\b(senjata|weapon|peluru|bullet|projectile|proyektil|anak panah|pisau|knife|pedang|sword|tombak|spear|laser|meriam|cannon|dilempar|thrown)\b/g,
    food: /\b(makanan|food|minuman|drink|kue|cake|roti|bread|daging|masakan|hidangan|dish|snack|camilan|permen|candy|sayur\w*|vegetable|dimakan|edible)\b/g,
    fruit: /\b(buah\w*|fruit\w*|berry|berries)\b/g,
    treasure: /\b(uang|money|koin|coin|mata uang|currency|emas|gold|permata|gem\w*|batu mulia|harta|treasure|berlian|diamond|perhiasan|jewel\w*)\b/g,
    bird: /\b(burung|bird\w*|unggas|bersayap|winged|kelelawar|bat|terbang|flying|flight)\b/g,
    insect: /\b(serangga|insect\w*|arthropod\w*|artropoda)\b/g,
    fish: /\b(ikan|fish|laut|sea|marine|perairan|aquatic|berenang|swim\w*|samudra|ocean)\b/g,
    animal: /\b(hewan|binatang|animal|mamalia|mammal|spesies|species|reptil\w*|reptile|amfibi)\b/g,
    person: /\b(manusia|orang|person|people|tokoh|pahlawan|hero|prajurit|soldier|pejuang|warrior|ksatria|knight|petualang|profesi|pekerjaan|occupation|mata.?mata|spy|tentara|agen|agent)\b/g,
    vehicle: /\b(kendaraan|vehicle|mobil|automobile|pesawat|aircraft|kapal|ship|roket|rocket|sepeda motor|kereta|train)\b/g,
    space: /\b(planet|bintang|star|galaksi|galaxy|bulan|moon|tata surya|solar system|astronomi|orbit)\b/g,
    nature: /\b(tumbuhan|tanaman|plant|pohon|tree|bunga|flower)\b/g,
    building: /\b(bangunan|building|gedung|rumah|house|istana|palace|kastil|castle|menara|tower)\b/g,
  };
  function readText(text) {
    const t = " " + String(text || "").toLowerCase() + " ";
    const first = t.split(/(?<=[.!?])\s/)[0] || t;
    const score = {}, hits = {};
    for (const [cat, re] of Object.entries(CAT_WORDS)) {
      const a = (first.match(re) || []), b = (t.match(re) || []);
      const s = a.length * 3 + b.length;
      if (s) { score[cat] = s; hits[cat] = [...new Set(b)].slice(0, 3); }
    }
    const cat = Object.keys(score).sort((x, y) => score[y] - score[x])[0] || null;
    const col = findColors(" " + first + " ")[0];
    return {
      cat, hits: cat ? hits[cat] : [],
      color: col ? col.hex : null,
      fast: /\b(tercepat|cepat|lincah|gesit|fast\w*|agile|swift|speed)\b/.test(t),
      slow: /\b(lambat|pelan|lamban|slow\w*)\b/.test(t),
      big: /\b(raksasa|terbesar|sangat besar|large\w*|giant|huge|enormous)\b/.test(t),
      small: /\b(kecil|mungil|small\w*|tiny|minute)\b/.test(first),
      harmful: /\b(berbahaya|bahaya|dangerous|beracun|venomous|poisonous|mematikan|deadly|menyerang|attacks?)\b/.test(t),
    };
  }

  // ------------------------------------------------------------------ reading the request
  function findColors(t) {
    const out = [];
    for (const [re, hex] of COLORS) {
      const g = new RegExp(re.source, "g");
      let m;
      while ((m = g.exec(t))) out.push({ hex, at: m.index, word: m[0] });
    }
    return out.sort((a, b) => a.at - b.at).filter((c, i, a) => !a.some((o, j) => j !== i && o.at <= c.at && o.at + o.word.length >= c.at + c.word.length && o.word.length > c.word.length));
  }
  function num(t, re, def) { const m = t.match(re); const g = m && m.slice(1).find((x) => x != null); return g ? Math.max(1, Math.min(9999, parseInt(g, 10))) : def; }

  const V = {   // verb -> what it makes its object
    player: /^(jadi|sebagai|as|pemainnya|karakternya|kontrol|control|controls|mainin|pemain|karakter|player|hero|mengendalikan|mengontrol|ngontrol)$/,
    item: /^(kumpul\w*|ngumpul\w*|mengumpulkan|collect\w*|ambil\w*|ngambil\w*|mengambil|pungut\w*|mungut\w*|memungut|makan\w*|memakan|eat\w*|grab\w*|dapetin|dapatkan|nyari\w*|cari\w*|mencari|find)$/,
    catch: /^(tangkap\w*|tangkep\w*|nangkep\w*|nangkap\w*|catch\w*)$/,
    enemy: /^(hindar\w*|menghindar\w*|dodge\w*|avoid\w*|jauhin|awas\w*)$/,
    shoot: /^(tembak\w*|nembak\w*|menembak\w*|shoot\w*|serang\w*|nyerang|attack\w*|basmi\w*|bunuh\w*|ngebunuh|kill\w*|lawan\w*|ngelawan|fight\w*|hancur\w*|destroy\w*|blast\w*|melawan)$/,
    throw: /^(lempar\w*|ngelempar\w*|throw\w*|tembakin)$/,
    chased: /^(dikejar|dikejer|diburu|dimakan)$/,
    chaser: /^(ngejar|mengejar|kejar|chases|chase|chasing|memburu)$/,
    goal: /^(menuju|reach|capai|nyampe|finish)$/,
    click: /^(klik\w*|click\w*|pencet\w*|tekan|pukul\w*|whack|tabok\w*|geplak\w*|smash\w*|swat\w*|squash\w*|gebuk\w*)$/,
    jumpover: /^(lompatin|lompati|loncatin|loncati)$/,
    with: /^(pake|pakai|pakek|dengan|with|using|pakai)$/,
  };
  const SKIP = /^(semua|para|banyak|beberapa|the|a|an|all|some|many|si|sang|yang|ke|at|to|dari|from|by|pada|sebuah|seekor|lots|of|si)$/;
  const CLASSIFIER = /^(buah|ekor|biji|butir|lembar)$/;
  const ADJ_FAST = /^(cepat|cepet|kenceng|kencang|ngebut|fast|quick|speedy|lincah)$/, ADJ_SLOW = /^(lambat|pelan|lemot|slow)$/;
  const ADJ_BIG = /^(besar|gede|raksasa|big|giant|huge|jumbo)$/, ADJ_SMALL = /^(kecil|mini|small|tiny|imut)$/;

  /** request text -> analysis */
  function analyze(text, reader, kb, opts = {}) {
    const raw = String(text).trim();
    let t = " " + raw.toLowerCase().replace(/[“”]/g, '"').replace(/(\w)-(\w)/g, "$1 $2").replace(/[^a-z0-9"' ]+/g, " ").replace(/\s+/g, " ") + " ";
    const notes = [];
    if (opts.experimental) {
      t = t.replace(/[a-z]{4,}/g, (w) => {
        if (KNOWN_WORDS.includes(w) || (kb && kb.index.has(w))) return w;
        let best = null, bd = 9;
        for (const k of KNOWN_WORDS) { if (Math.abs(k.length - w.length) > 2) continue; const d = editDistance(w, k); if (d < bd) { bd = d; best = k; } }
        if (best && bd <= (w.length >= 7 ? 2 : 1) && w[0] === best[0]) { notes.push("'" + w + "' kayaknya maksudnya '" + best + "'"); return best; }
        return w;
      });
    }
    const game = findGame(t);
    if (game && game.typo) notes.push("'" + game.typo + "' kayaknya maksudnya '" + game.as + "'");
    const probs = reader ? reader.read(t) : {};
    const mech = new Set(), why = {};
    for (const [f, re] of Object.entries(RULES)) if (re.test(t)) { mech.add(f); why[f] = "kata kunci"; }
    // the neural reader fills in when the keyword rules found nothing (paraphrases)
    const ruled = mech.size;
    for (const [f, p] of Object.entries(probs)) if (p > (ruled ? 0.97 : 0.85) && !mech.has(f) && (!ruled || !APPS.has(f))) { mech.add(f); why[f] = "model " + Math.round(p * 100) + "%"; }
    if (mech.has("countdown") && /\btimer\b/.test(t) && mech.has("stopwatch")) mech.delete("countdown");
    if (mech.has("dice") && /\b(lempar|ngelempar|throw|roll)\w*\s+(dadu|dice|the dice)\b/.test(t) && !/\b(tembak|shoot|serang|attack)/.test(t)) mech.delete("shoot");
    if (mech.has("quiz") && mech.has("guess")) mech.delete("quiz");
    if (mech.has("whack") && mech.has("popup") && !/\b(popup|alert|message)\b/.test(t)) mech.delete("popup");

    // ---- the things in the request
    let tokens = t.trim().split(" ");
    // glue known multi-word names ("laba laba", "bola api", "harta karun")
    if (kb) for (const mw of kb.multi) {
      const parts = mw.split(" ");
      for (let i = 0; i + parts.length <= tokens.length; i++) if (parts.every((p, j) => tokens[i + j] === p)) tokens.splice(i, parts.length, mw);
    }
    tokens = tokens.filter((w, i) => !(i && w === tokens[i - 1]));   // "zombie zombie" -> "zombie"
    const things = [];
    const thing = (word) => {
      let th = things.find((x) => x.word === word);
      if (!th) { th = { word, roles: [], count: null, color: null, speed: 1, size: 1 }; things.push(th); }
      return th;
    };
    const isNoun = (w) => w && w.length >= 3 && !STOP.has(w) && !/^\d/.test(w) && !Object.values(V).some((re) => re.test(w)) && !/^(nya|lah|kah)$/.test(w);
    /** read a noun phrase starting at i -> {th, end} */
    const np = (i) => {
      let count = null, adj = [];
      while (i < tokens.length && ((CLASSIFIER.test(tokens[i]) && isNoun(tokens[i + 1])) || SKIP.test(tokens[i]) || /^\d+$/.test(tokens[i]) || ADJ_FAST.test(tokens[i]) || ADJ_SLOW.test(tokens[i]) || ADJ_BIG.test(tokens[i]) || ADJ_SMALL.test(tokens[i]) || findColors(" " + tokens[i] + " ").length)) {
        if (/^\d+$/.test(tokens[i])) count = +tokens[i]; else if (!SKIP.test(tokens[i])) adj.push(tokens[i]);
        i++;
      }
      if (!isNoun(tokens[i])) return null;
      const th = thing(tokens[i]);
      let j = i + 1;
      while (j < tokens.length && j <= i + 3 && (tokens[j] === "yang" || tokens[j] === "warna" || tokens[j] === "berwarna" || ADJ_FAST.test(tokens[j]) || ADJ_SLOW.test(tokens[j]) || ADJ_BIG.test(tokens[j]) || ADJ_SMALL.test(tokens[j]) || findColors(" " + tokens[j] + " ").length)) { adj.push(tokens[j]); j++; }
      // "2 words" names the KB does not know: "bola salju" stays "bola" + adj
      if (count != null) th.count = Math.min(12, count);
      for (const a of adj) {
        const col = findColors(" " + a + " ")[0];
        if (col) th.color = col.hex;
        if (ADJ_FAST.test(a)) th.speed = 1.6;
        if (ADJ_SLOW.test(a)) th.speed = 0.6;
        if (ADJ_BIG.test(a)) th.size = 1.5;
        if (ADJ_SMALL.test(a)) th.size = 0.7;
      }
      return { th, end: j };
    };
    for (let i = 0; i < tokens.length; i++) {
      const w = tokens[i], nx = tokens[i + 1];
      const role = (r, at) => { const p = np(at); if (p) { p.th.roles.push(r); return p; } return null; };
      if (V.player.test(w)) role("player", i + 1);
      else if ((w === "main" || w === "play") && nx && /^(sebagai|jadi|as|pake)$/.test(nx)) role("player", i + 2);
      else if (V.item.test(w)) role("item", i + 1);
      else if (V.catch.test(w)) role("catch", i + 1);
      else if (V.enemy.test(w)) role("enemy", i + 1);
      else if ((w === "kabur" || w === "lari" || w === "run" || w === "escape") && nx && /^(dari|from)$/.test(nx)) role("enemy", i + 2);
      else if (V.shoot.test(w)) { const p = role("target", i + 1); if (p && V.with.test(tokens[p.end] || "")) role("projectile", p.end + 1); }
      else if (V.throw.test(w) && /^(dadu|dice|koin|coin)$/.test(nx || "") && mech.has("dice")) i++;
      else if (V.throw.test(w)) {
        const p = np(i + 1);
        if (p) {
          const k = kb && kb.find(p.th.word);
          if (/^(ke|at|to|pada|kearah)$/.test(tokens[p.end] || "")) { p.th.roles.push("projectile"); role("target", p.end + 1); }
          else p.th.roles.push(k && k.entry.cat === "weapon" ? "projectile" : "target");
        }
      }
      else if (V.chased.test(w) || ((w === "chased" || w === "hunted") && nx === "by")) role("chaser", w === "chased" || w === "hunted" ? i + 2 : i + 1);
      else if (V.chaser.test(w) && i > 0) { const back = tokens[i - 1] === "yang" ? i - 2 : i - 1; if (isNoun(tokens[back])) thing(tokens[back]).roles.push("chaser"); }
      else if (V.goal.test(w) || ((w === "sampe" || w === "sampai" || w === "get" || w === "go") && nx && /^(ke|to)$/.test(nx))) role("goal", V.goal.test(w) ? i + 1 : i + 2);
      else if (V.click.test(w)) role("click", i + 1);
      else if (V.jumpover.test(w) || (w === "jump" && nx === "over")) role("obstacle", w === "jump" ? i + 2 : i + 1);
      else if ((w === "vs" || w === "versus" || w === "melawan" || w === "against") && i > 0) {
        if (isNoun(tokens[i - 1])) thing(tokens[i - 1]).roles.push("player");
        role("target", i + 1);
      } else if (V.with.test(w) && things.length && things[things.length - 1].roles.includes("target")) role("projectile", i + 1);
      else if ((w === "game" || w === "permainan") && nx && isNoun(nx)) { const p = np(i + 1); if (p) p.th.topic = true; }
      else if (/^\d+$/.test(w) && isNoun(nx)) np(i);
      else if (findColors(" " + w + " ").length && i > 0 && isNoun(tokens[i - 1]) && things.some((x) => x.word === tokens[i - 1])) thing(tokens[i - 1]).color = findColors(" " + w + " ")[0].hex;
    }
    // remaining nouns (only things we know or got told about, so "game sederhana" is not a thing)
    tokens.forEach((w, i) => { if (isNoun(w) && !(CLASSIFIER.test(w) && isNoun(tokens[i + 1])) && !things.some((x) => x.word === w) && kb && kb.find(w) && !kb.find(w).fuzzy) thing(w); });
    // typos in names: "semangkaa" -> "semangka" (the knowledge base has the spelling)
    if (kb) for (const th of things) {
      const k = kb.find(th.word);
      if (k && k.fuzzy && !things.some((x) => x.word === k.name)) { notes.push("'" + th.word + "' kayaknya maksudnya '" + k.name + "'"); th.word = k.name; }
    }

    const quotes = [...raw.matchAll(/"([^"]{1,60})"|'([^']{2,60})'/g)].map((m) => m[1] || m[2]);
    let topic = null;
    const tm = t.match(/\b(?:tentang|seputar|mengenai|about|soal|on the topic of)\s+([a-z0-9 ]{3,40}?)(?=\s+(?:\d+\s*(?:soal|pertanyaan|questions?)|pake|dengan|with|sebanyak|yang|dan|terus)\s|\s*$)/);
    if (tm) topic = tm[1].trim();
    else { const km = t.match(/\b(?:kuis|quiz|trivia)\s+(?:\d+\s+(?:soal|pertanyaan|questions)\s+)?([a-z][a-z ]{2,30}?)(?=\s+(?:\d+|pake|dengan|with|yang)\s|\s*$)/); if (km && !/^(soal|pertanyaan|questions?|game|dong|aja)$/.test(km[1])) topic = km[1].trim(); }
    if (topic) topic = topic.replace(/\b(dong|aja|ya|deh|game|kuis|quiz)\b/g, "").trim() || null;
    if (topic && mech.has("quiz")) for (const w of topic.split(" ")) { const i = things.findIndex((x) => x.word === w); if (i >= 0) things.splice(i, 1); }
    if (things.length && mech.has("quiz") && !topic && things.every((x) => !x.roles.length)) { topic = things.map((x) => x.word).join(" "); things.length = 0; }

    if (game) {
      // the game's own words are not things ("tic" is not a Tic Tac); keep a food for snake
      const gameWords = /^(tic|tac|toe|tik|tak|tok|tictactoe|xo|ox|xox|snake|ular|ularan|suit|suwit|batu|gunting|kertas|rock|paper|scissors?|janken|game|nokia)$/;
      for (let i = things.length - 1; i >= 0; i--) if (gameWords.test(things[i].word) || (game.typo && game.typo.split(" ").includes(things[i].word))) things.splice(i, 1);
      for (const f of [...mech]) if (!/^(countdown|score)$/.test(f)) mech.delete(f);
      mech.add(game.name); why[game.name] = game.typo ? "nama game (typo)" : "nama game";
    }
    const gm = !game && t.match(/\b(?:game|permainan|main(?:in)?|play)\s+([a-z0-9]{3,}(?: [a-z0-9]{3,})?)/);
    const A = {
      raw, t, game: game && game.name, gameName: gm ? gm[1].replace(/\b(dong|aja|yang|yg|sederhana|simple|seru)\b/g, "").trim() || null : null,
      twoPlayer: /\b((2|dua) (pemain|player|orang)|lawan (temen|teman|orang)|pvp|multiplayer|berdua|two players?|2p)\b/.test(t),
      lang: ID_WORDS.test(t) ? "id" : EN_WORDS.test(t) ? "en" : Lib.detectLang(Lib.normalize(raw)) === "id" ? "id" : opts.lang || "id",
      mech, why, probs, notes, quotes, things, topic,
      title: (raw.match(/(?:judul(?:nya)?|nama(?:nya)? game|title(?:d)?|called|namanya)\s+"?([^",.]{2,30})"?/i) || [])[1] || null,
      stage: (t.match(/\b(\d{3,4})\s*[x×]\s*(\d{3,4})\b/) || []).slice(1).map(Number),
      bg: (() => { const m = t.match(/\b(background|latar(?: belakang)?|bg|backgroundnya|langit(?:nya)?)\s+(?:nya\s+)?(?:warna\s+)?([a-z]+(?: [a-z]+)?)/); const c = m && findColors(" " + m[2] + " ")[0]; return c ? c.hex : null; })(),
      lives: (t.match(/(\d+)\s*(?:nyawa|lives|lifes|hp|hati|darah)|(?:nyawa|lives|hp)(?:nya)?\s*(\d+)/) || []).slice(1).filter(Boolean).map(Number)[0] || null,
      noLives: /\b(tanpa nyawa|sekali kena|one hit|1 hit|langsung kalah|langsung mati)\b/.test(t),
      seconds: (t.match(/(\d+)\s*(?:detik|seconds?|secs?|s\b)/) || [])[1] ? +t.match(/(\d+)\s*(?:detik|seconds?|secs?|s\b)/)[1] : (t.match(/(\d+)\s*(?:menit|minutes?)/) || [])[1] ? 60 * +t.match(/(\d+)\s*(?:menit|minutes?)/)[1] : null,
      questions: num(t, /(\d+)\s*(?:soal|pertanyaan|questions?)/, null),
      price: num(t, /(?:harga|price|cost)\s*(\d+)/, null),
      goal: num(t, /(?:target|skor|score|poin|points?)\s*(?:nya\s*)?(?:sampe|sampai|to|of|=|:)?\s*(\d+)|(?:menang|win)\s*(?:kalo|kalau|jika|when|at|if)?\s*(?:skor|score|dapet|dapat|udah|sudah)?\s*(\d+)|(?:sampe|sampai|hingga|reach)\s+(\d+)/, null),
      max: num(t, /(?:1|satu)\s*(?:sampai|sampe|-|to|hingga)\s*(\d+)/, 100),
      sides: num(t, /(\d+)\s*(?:sisi|sides|muka)/, 6),
      password: (raw.match(/(?:password|sandi|pin)(?:nya)?\s*(?:=|:|adalah|is)?\s*"?([A-Za-z0-9_]{2,20})"?/i) || [])[1] || null,
      hard: /\b(susah|sulit|hard|expert|pro)\b/.test(t), easy: /\b(gampang|mudah|easy|bocil)\b/.test(t),
    };
    if (A.goal && new RegExp("\\b\\d+\\s*(?:sampai|sampe|-|to|hingga)\\s*" + A.goal + "\\b").test(t)) A.goal = null;   // "1 sampe 50" is a range
    if (A.goal && A.seconds && A.goal === A.seconds) A.goal = null;
    if (A.goal && A.lives && A.goal === A.lives) A.goal = null;
    if (A.password && /^(nya|yang|ya|ga|gak|check|cek)$/i.test(A.password)) A.password = null;
    return A;
  }

  // ------------------------------------------------------------------ quiz questions from what was read
  function sentencesOf(text) {
    return String(text || "").replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z0-9])/).map((s) => s.trim()).filter((s) => s.length >= 30 && s.length <= 300);
  }
  function makeQuiz(topic, text, n, lang, rand) {
    const L = (a, b) => (lang === "en" ? b : a);
    const sents = sentencesOf(text);
    const words = String(topic || "").toLowerCase().split(/\s+/);
    const names = [];
    for (const s of sents) for (const m of s.matchAll(/(?<!^)(?<![.!?]\s)\b([A-Z][a-zé]+(?:\s+(?:[A-Z][a-zé]+|bin|van|de|al))*(?:\s+[A-Z][a-z]+)?)\b/g)) {
      const nm = m[1].trim();
      if (nm.length > 2 && !words.includes(nm.toLowerCase()) && !names.includes(nm) && !/^(The|In|It|Ia|Dia|Pada|Dalam|Di|Ini|Itu|Hal|Selain|Namun|Kemudian|Sejak|Sebagai|Menurut|Setelah|Hingga|He|She|They|This|After|Since|During|Its)$/.test(nm)) names.push(nm);
    }
    const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const cut = (s, at, len) => { const a = Math.max(0, at - 90), b = Math.min(s.length, at + len + 70); return (a > 0 ? "…" : "") + s.slice(a, b) + (b < s.length ? "…" : ""); };
    const out = [];
    const used = new Set();
    const add = (s, ans, at, dis) => {
      if (used.has(s) || out.length >= n) return;
      const choices = shuffle([ans, ...dis.slice(0, 2)]);
      const prompt = cut(s.slice(0, at) + "____" + s.slice(at + ans.length), at, 4);
      out.push({ prompt, answer: ans, choices, fact: s.length > 160 ? s.slice(0, 157) + "…" : s });
      used.add(s);
    };
    for (const s of shuffle(sents.slice())) {
      const y = s.match(/\b(1[0-9]{3}|20[0-2][0-9])\b/);
      if (y) {
        const yr = +y[1], dis = shuffle([-37, -12, -5, 3, 8, 21, 50].map((d) => String(yr + d)).filter((x) => +x > 0 && +x < 2100));
        add(s, y[1], y.index, dis); continue;
      }
      const nm = names.find((x) => s.includes(x) && s.indexOf(x) > 0);
      if (nm) { const dis = shuffle(names.filter((x) => x !== nm && !x.includes(nm) && !nm.includes(x))); if (dis.length >= 2) { add(s, nm, s.indexOf(nm), dis); continue; } }
      const nb = s.match(/\b(\d+(?:[.,]\d+)?)\s*(km|meter|m|kg|juta|ribu|miliar|persen|%|million|thousand|billion|tahun|years)\b/);
      if (nb) {
        const v = parseFloat(nb[1].replace(",", ".")), u = nb[2];
        const fmt = (x) => (Number.isInteger(v) ? String(Math.round(x)) : String(Math.round(x * 10) / 10).replace(".", nb[1].includes(",") ? "," : ".")) + (u === "%" ? "%" : " " + u);
        add(s, nb[0], nb.index, shuffle([fmt(v * 2), fmt(v / 2), fmt(v * 1.5)]).filter((x) => x !== nb[0]));
      }
    }
    // not enough? true/false questions from the same sentences
    for (const s of shuffle(sents.slice())) {
      if (out.length >= n) break;
      if (used.has(s)) continue;
      const nm = names.find((x) => s.includes(x));
      const swap = nm && names.find((x) => x !== nm && !x.includes(nm) && !nm.includes(x));
      const truth = !swap || rand() < 0.5;
      const shown = truth ? s : s.replace(nm, swap);
      out.push({ prompt: L("benar atau salah? ", "true or false? ") + (shown.length > 170 ? shown.slice(0, 167) + "…" : shown), answer: truth ? L("benar", "true") : L("salah", "false"), tf: true, fact: s.length > 160 ? s.slice(0, 157) + "…" : s });
      used.add(s);
    }
    return out;
  }
  function mathQuiz(A, n, rand) {
    const t = A.t, out = [];
    const ops = [];
    if (/\b(tambah|penjumlahan|jumlah|plus|addition|add)\b/.test(t)) ops.push("+");
    if (/\b(kurang|pengurangan|minus|subtraction|subtract)\b/.test(t)) ops.push("-");
    if (/\b(kali|perkalian|times|multiplication|multiply)\b/.test(t)) ops.push("*");
    if (/\b(bagi|pembagian|division|divide)\b/.test(t)) ops.push("/");
    if (!ops.length) ops.push("+", "-", "*");
    const big = A.hard ? 60 : A.easy ? 10 : 20;
    for (let i = 0; i < n; i++) {
      const op = ops[i % ops.length];
      let a = rint(rand, 2, big), b = rint(rand, 2, op === "*" ? Math.min(12, big) : big);
      if (op === "/") { a = a * b; }
      const ans = op === "+" ? a + b : op === "-" ? a - b : op === "*" ? a * b : a / b;
      out.push({ prompt: `${a} ${op === "*" ? "x" : op === "/" ? ":" : op} ${b} = ?`, answer: String(ans), number: true });
    }
    return out;
  }

  // ------------------------------------------------------------------ design
  const PALETTE = ["#feae34", "#3b8ee4", "#63c74d", "#e43b44", "#b55088", "#f77622", "#2ce8f5"];

  /** analysis + research -> game design (and the reasons, for the thinking log) */
  function design(A, know, rand) {
    const L = (a, b) => (A.lang === "en" ? b : a);
    const m = A.mech;
    const reasons = [];
    const W = A.stage[0] || 520, H = A.stage[1] || 360;
    const d = { lang: A.lang, request: A.raw, stage: { w: W, h: H }, bg: A.bg || "#101a0c", notes: [], vars: [], hud: [], entities: [], widgets: [], timers: [], sequence: [], end: {}, title: null };
    if (A.game === "tictactoe") {
      d.special = "tictactoe";
      d.stage = { w: Math.max(W, 420), h: Math.max(H, 360) };
      d.board = { cell: 72, top: 64, colorX: "#feae34", colorO: "#2ce8f5", cellColor: "#26361f", twoPlayer: A.twoPlayer, hard: !A.easy, easy: A.easy };
      d.title = A.title || "tic tac toe";
      reasons.push(L("papan 3×3, 9 kotak bisa diklik, isinya disimpen di s1..s9", "a 3×3 board, 9 clickable cells, stored in s1..s9"),
        L("cek menang: 8 garis (3 baris, 3 kolom, 2 diagonal)", "win check: 8 lines (3 rows, 3 columns, 2 diagonals)"),
        A.twoPlayer ? L("2 pemain gantian X dan O", "2 players take turns as X and O") : L("lawan komputer. otaknya: menang kalo bisa → blok lu → ambil tengah → pojok → pinggir", "vs the computer. its brain: win if it can → block u → centre → corner → side") + (A.easy ? L(" (mode gampang: kadang asal)", " (easy: sometimes random)") : ""));
      return Object.assign(d, { reasons, game: true });
    }
    if (A.game === "snake") {
      const food = A.things.find((th) => (know[th.word] || {}).cat && !/^(predator|monster|hazard)$/.test((know[th.word] || {}).cat));
      const fk = food ? know[food.word] : {};
      const col = (A.things.find((th) => th.color) || {}).color;
      d.special = "snake";
      d.snake = { cell: 16, max: 30, every: A.hard ? 4 : A.easy ? 9 : 6, color: col || "#63c74d", headColor: "#b9e389", foodId: food ? camel(food.word) : L("apel", "apple"), foodColor: (food && food.color) || fk.color || "#e43b44", foodShape: (fk.shape === "circle" || !fk.shape) ? "circle" : "square" };
      d.title = A.title || L("ular sybau", "sybau snake");
      reasons.push(L("arena kotak-kotak 16px, ular jalan 1 kotak tiap " + d.snake.every + " frame", "a 16px grid, the snake moves one cell every " + d.snake.every + " frames"),
        L("badan = " + d.snake.max + " ruas, tiap ruas pindah ke posisi ruas depannya", "body = " + d.snake.max + " segments, each moves to where the one in front was"),
        L("makan " + d.snake.foodId + " = skor +1 & badan nambah, nabrak tembok/badan = kalah", "eat the " + d.snake.foodId + " = +1 and grow, hitting a wall or yourself = game over"));
      return Object.assign(d, { reasons, game: true });
    }
    if (A.game === "rps") {
      d.special = "rps";
      d.title = A.title || L("batu gunting kertas", "rock paper scissors");
      reasons.push(L("3 tombol, komputer milih randint(1, 3), aturan: batu > gunting > kertas > batu", "3 buttons, the computer picks randint(1, 3); rock > scissors > paper > rock"));
      return Object.assign(d, { reasons, game: true });
    }

    // every thing gets its final role
    const items = [], enemies = [], goals = [], projs = [], clicks = [];
    let player = null;
    for (const th of A.things) {
      const k = know[th.word] || {};
      const cat = k.cat || "object";
      const C = CATS[cat] || CATS.object;
      let role = null, motion = null;
      const r = th.roles;
      if (r.includes("player")) role = "player";
      else if (r.includes("projectile")) role = "projectile";
      else if (r.includes("chaser")) { role = "enemy"; motion = "chase"; }
      else if (r.includes("target")) role = "target";
      else if (r.includes("enemy") || r.includes("obstacle")) role = "enemy";
      else if (r.includes("catch")) { role = "item"; motion = "fall"; }
      else if (r.includes("item")) role = "item";
      else if (r.includes("goal")) role = "goal";
      else if (r.includes("click")) role = "click";
      else role = C.role;
      const how = r.length ? L("dari kalimat lu", "from your sentence") : k.source ? L("dari riset: " + C.id, "from research: " + C.en) : k.kbName ? L("dari database: " + C.id, "from my database: " + C.en) : L("tebakan", "a guess");
      const ent = { word: th.word, label: th.word, key: camel(th.word), cat, C, k, th, role, motion, how };
      if (role === "player" && !player) player = ent;
      else if (role === "player") { ent.role = C.harmful || k.harmful ? "enemy" : "target"; enemies.push(ent); }
      else if (role === "projectile") projs.push(ent);
      else if (role === "enemy" || role === "target") enemies.push(ent);
      else if (role === "goal") goals.push(ent);
      else if (role === "click") clicks.push(ent);
      else items.push(ent);
    }
    // a person/animal that was only mentioned ("game ninja") and no player yet -> the player
    if (!player && m.has("flappy")) {   // "flappy bird": u ARE the bird
      const i = enemies.findIndex((e) => !e.th.roles.length && (e.cat === "bird" || e.cat === "insect" || e.cat === "vehicle"));
      if (i >= 0) player = enemies.splice(i, 1)[0];
    }
    if (!player && A.things.length === 1 && A.things[0].topic) {   // "game hiu": u are the shark
      const lone = enemies.concat(items).find((e) => e.word === A.things[0].word);
      if (lone && /^(predator|fish|animal|bird|insect|vehicle|person)$/.test(lone.cat)) {
        player = lone; enemies.splice(enemies.indexOf(lone), 1); if (items.includes(lone)) items.splice(items.indexOf(lone), 1);
        player.how = L("judul game-nya, jadi lu mainin dia", "the game is named after it, so u play as it");
        const food = { predator: lone.word === "ikan" ? "udang" : "ikan", fish: "cacing", animal: "apel", bird: "cacing", insect: "bunga", vehicle: "koin", person: "koin" }[lone.cat];
        const fk = know[food] || {};
        items.push({ word: food, label: food, key: camel(food), cat: fk.cat || "food", C: CATS[fk.cat] || CATS.food, k: fk, th: { roles: [], count: null, color: null, speed: 1, size: 1, word: food }, role: "item",
          how: L(lone.word + " butuh sesuatu buat dikejar", "a " + lone.word + " needs something to go after") });
      }
    }
    if (!player) {
      const i = enemies.findIndex((e) => !e.th.roles.length && (e.cat === "person" || e.cat === "animal" || e.cat === "vehicle"));
      const j = items.findIndex((e) => !e.th.roles.length && (e.cat === "animal" || e.cat === "vehicle" || e.cat === "person"));
      if (i >= 0) player = enemies.splice(i, 1)[0];
      else if (j >= 0) player = items.splice(j, 1)[0];
    }
    if (m.has("whack")) for (const list of [enemies, items]) for (let i = list.length - 1; i >= 0; i--) if (!list[i].th.roles.length && list[i] !== player) { list[i].role = "click"; clicks.push(list.splice(i, 1)[0]); }
    if (m.has("shoot") && !enemies.some((e) => e.role === "target")) enemies.forEach((e) => { if (!e.th.roles.includes("enemy") || m.has("shoot")) e.role = "target"; });

    const isApp = !player && !items.length && !enemies.length && !goals.length && !clicks.length && !["move", "maze", "jump", "flappy", "pong", "dodge", "collect", "shoot", "chase", "catch", "whack"].some((f) => m.has(f));
    const game = !isApp && !(m.has("quiz") && !player && !items.length && !enemies.length);

    // default things when the request named a mechanic but no thing
    const make = (word, role, extra) => {
      const kb = know[word] || {};
      const cat = kb.cat || (role === "enemy" ? "hazard" : role === "projectile" ? "weapon" : "object");
      return Object.assign({ word, label: word, key: camel(word), cat, C: CATS[cat], k: kb, th: { roles: [], count: null, color: null, speed: 1, size: 1, word }, role, how: L("bawaan, lu ga nyebut", "default, u didn't say") }, extra || {});
    };
    if (game) {
      if (m.has("collect") && !items.length) items.push(make(L("koin", "coin"), "item"));
      if (m.has("catch") && !items.length) items.push(make(L("apel", "apple"), "item", { motion: "fall" }));
      if (m.has("dodge") && !enemies.length) enemies.push(make("meteor", "enemy"));
      if (m.has("shoot") && !enemies.length) enemies.push(make("alien", "target"));
      if (m.has("chase") && !enemies.some((e) => (e.motion || e.C.motion) === "chase")) enemies.push(make("zombie", "enemy", { motion: "chase" }));
      if (m.has("whack") && !clicks.length) clicks.push(make(L("tikus", "mouse"), "click"));
      if (m.has("maze") && !goals.length && !items.length && !m.has("collect")) goals.push(make("finish", "goal"));
      if (m.has("flappy") && !enemies.length) enemies.push(make(L("pipa", "pipe"), "enemy", { cat: "nature" }));
      if (m.has("jump") && !enemies.length) enemies.push(make(L("batu", "rock"), "enemy"));
      if (m.has("shoot") && !projs.length) projs.push(make(L("peluru", "bullet"), "projectile"));
      if (!player && (enemies.length || items.length || goals.length || m.has("move") || m.has("maze") || m.has("jump") || m.has("flappy") || m.has("pong"))) {
        player = make(m.has("pong") ? "raket" : L("pemain", "player"), "player", { cat: "person" });
        player.C = Object.assign({}, CATS.person, { color: "#93cc5f" });
      }
    }

    // ---- controls
    let control = null;
    if (player) {
      if (m.has("pong")) control = "mouse";
      else if (m.has("flappy")) control = "flappy";
      else if (m.has("jump")) control = "platform";
      else if (m.has("maze")) control = "keys4";
      else if (m.has("catch") || items.some((i) => i.motion === "fall")) control = "keys2";
      else if (player.cat === "vehicle" && enemies.length && enemies.every((e) => e.cat === "vehicle" || e.cat === "hazard" || e.cat === "object")) { control = "keys2"; enemies.forEach((e) => { if (!e.motion) e.motion = "fall"; }); }
      else if (enemies.length && enemies.every((e) => (e.motion || motionFor(e, "keys4")) === "fall") && !items.length) control = "keys2";
      else control = "keys4";
      const why = { keys4: L("bebas 4 arah (panah/wasd)", "free 4-way movement (arrows/wasd)"), keys2: L("kiri-kanan di bawah, semuanya dateng dari atas", "left-right at the bottom, everything comes from the top"),
        platform: L("lompat-lompatan pake gravitasi", "platform jumping with gravity"), flappy: L("terbang ala flappy", "flappy-style flying"), mouse: L("raket ikut mouse", "paddle follows the mouse") }[control];
      reasons.push(L("kontrol: ", "controls: ") + why);
    }
    function motionFor(e, ctl) {
      if (e.motion) return e.motion;
      if (e.role === "click") return "teleport";
      if (ctl === "platform" || ctl === "flappy") return e.cat === "bird" ? "fly" : "scroll";
      if (ctl === "keys2") return "fall";
      if (e.role === "item") return e.cat === "fish" || e.cat === "insect" || e.cat === "bird" ? "wander" : "static";
      if (e.cat === "bird") return "fly";
      return e.C.motion === "static" ? "wander" : e.C.motion;
    }

    d.playTop = 76;
    const area = { x0: 50, x1: W - 50, y0: d.playTop + 10, y1: H - 50 };

    // ---- the player
    const shapeOf = (e) => e.k.shape || e.C.shape;
    const colorOf = (e, i) => e.th.color || readable(e.k.color || e.C.color || PALETTE[i % PALETTE.length], d.bg);
    const sizeOf = (e) => Math.round(clamp((e.k.size || e.C.size) * (e.th.size || 1) * (e.k.big ? 1.25 : 1) * (e.k.small ? 0.85 : 1), 8, 60));
    if (player) {
      let sz = control === "mouse" ? 0 : clamp(sizeOf(player), 16, 34);
      if (m.has("maze")) sz = 18;
      const shape = control === "mouse" ? "rect" : shapeOf(player) === "line" ? "square" : shapeOf(player);
      const w = control === "mouse" ? 90 : sz, h = control === "mouse" ? 12 : shape === "rect" || shape === "ellipse" ? Math.round(sz * 0.65) : sz;
      const P = { key: player.key, id: player.key, label: player.label, shape, w, h, color: colorOf(player, 0), control, speed: r1(3 * (player.th.speed || 1) * (player.k.fast ? 1.15 : 1)) };
      if (control === "keys4") { P.x = 20; P.y = Math.round((d.playTop + H) / 2); }
      if (control === "keys2") { P.x = Math.round(W / 2 - w / 2); P.y = H - h - 24; P.speed = r1(P.speed * 1.6); }
      if (control === "platform") { d.ground = H - 40; P.x = 70; P.y = d.ground - h; P.jump = 9; P.gravity = 0.5; }
      if (control === "flappy") { P.x = 80; P.y = Math.round((d.playTop + H) / 2); P.jump = 5.5; P.gravity = 0.32; }
      if (control === "mouse") { P.x = Math.round(W / 2 - 45); P.y = H - 30; P.speed = 6; }
      if (m.has("maze")) { P.x = 24; P.y = d.playTop + 12; }
      d.player = P;
      reasons.push(L("pemain: ", "player: ") + P.label + " (" + player.how + ", " + shape + " " + colorName(P.color, A.lang) + ")");
    }
    const P = d.player;

    // ---- lives / score / goals
    const harmful = enemies.length > 0 || control === "flappy" || control === "mouse";
    if (game && harmful && !A.noLives) d.end.lives = A.lives || (m.has("lives") ? 3 : control === "mouse" ? 3 : 3);
    if (game) d.score = true;

    // ---- enemies / targets
    enemies.forEach((e, n) => {
      const mo = motionFor(e, control);
      const base = { fall: 3, scroll: 4, fly: 2.6, chase: 1.1, wander: 1.6, patrol: 2, bounce: 2.2, teleport: 0 }[mo] || 2;
      let speed = base * (e.th.speed || 1) * (e.k.fast ? 1.3 : 1) * (e.k.slow ? 0.65 : 1) * (A.hard ? 1.3 : 1) * (A.easy ? 0.7 : 1);
      if (mo === "chase") speed = Math.min(speed, (P ? P.speed : 3) * 0.75);
      let sz = clamp(sizeOf(e), 12, 46);
      const shape = e.cat === "nature" && (control === "flappy" || control === "platform") ? "rect" : shapeOf(e);
      const count = clamp(e.th.count || (mo === "chase" ? 2 : mo === "fall" ? 4 : mo === "scroll" || mo === "fly" ? 2 : 3), 1, 10);
      const ent = { key: e.key, id: e.key, label: e.label, shape, w: sz, h: shape === "rect" || shape === "ellipse" ? (control === "flappy" && e.cat === "nature" ? 90 : Math.round(sz * 0.7)) : sz, color: colorOf(e, n + 3),
        count, motion: mo, speed: r1(speed), role: e.role, spawn: mo === "fall" ? "top" : mo === "scroll" || mo === "fly" ? "right" : mo === "chase" ? "edge" : "random" };
      if (ent.role === "target" || m.has("shoot")) ent.shootable = !!d.shooter || m.has("shoot");
      ent.area = Object.assign({}, area, { x1: W - ent.w - 10, y1: H - ent.h - 10 });
      if (mo === "scroll" && control === "platform") ent.laneY = d.ground - ent.h;
      if (mo === "scroll" && control === "flappy") ent.area = Object.assign({}, ent.area, { y0: d.playTop, y1: H - ent.h });
      ent.onTouch = [{ do: "hurt" }].concat(d.end.lives ? [{ do: "respawn", key: ent.key }] : []);
      if (mo === "fall" || mo === "scroll" || mo === "fly") ent.onExit = [{ do: "score", n: 1 }];
      if (ent.shootable) ent.onShot = [{ do: "score", n: e.cat === "monster" || e.cat === "predator" ? 2 : 1 }, { do: "respawn", key: ent.key }];
      const what = { fall: L("jatuh dari atas", "falls from the top"), scroll: L("dateng dari kanan", "comes from the right"), fly: L("terbang naik-turun dari kanan", "flies in waves from the right"),
        chase: L("ngejar pemain", "chases the player"), wander: L("jalan-jalan acak", "wanders around"), patrol: L("mondar-mandir", "patrols back and forth"), teleport: L("muncul-ilang", "pops up") }[mo];
      ent.why = `${ent.label}: ${what}` + (e.k.source ? L(" (riset: " + (CATS[e.cat] || CATS.object).id + ")", " (research: " + (CATS[e.cat] || CATS.object).en + ")") : "") + (ent.shootable ? L(", bisa ditembak", ", can be shot") : "") + L(", kena pemain = ", ", touching the player = ") + (d.end.lives ? L("nyawa -1", "lose a life") : L("kalah", "game over"));
      d.entities.push(ent);
      reasons.push(L("musuh: ", "enemy: ") + ent.label + " ×" + count + " " + what + ", " + L("kecepatan ", "speed ") + ent.speed + " (" + e.how + ")");
    });

    // ---- items
    items.forEach((e, n) => {
      if (!game) return;
      const mo = motionFor(e, control);
      const sz = clamp(sizeOf(e), 10, 36);
      const count = clamp(e.th.count || (mo === "static" ? 6 : 3), 1, 12);
      const shape = shapeOf(e);
      const ent = { key: e.key, id: e.key, label: e.label, shape, w: sz, h: shape === "rect" || shape === "ellipse" ? Math.round(sz * 0.7) : sz, color: colorOf(e, n), count, motion: mo,
        speed: r1(({ fall: 2.4, scroll: 3.5, fly: 2.4, wander: 1.4 }[mo] || 0) * (e.th.speed || 1)), role: "item", spawn: mo === "fall" ? "top" : mo === "scroll" || mo === "fly" ? "right" : "random" };
      ent.area = Object.assign({}, area, { x1: W - ent.w - 10, y1: H - ent.h - 10 });
      if (control === "platform" && mo === "scroll") ent.laneY = d.ground - ent.h - 60;
      if (mo === "static") {
        ent.counter = "dapat" + cap(ent.key);
        const all = !A.goal && !items.some((o) => o !== e && motionFor(o, control) !== "static") ? count : null;
        ent.onTouch = [{ do: "score", n: 1 }, { do: "count", var: ent.counter, all }, { do: "destroy" }];
        if (all) { d.end.collectAll = true; d.hud.push({ id: "hud" + cap(ent.key), label: ent.label, expr: `${ent.counter} + "/${count}"` }); }
      } else {
        ent.onTouch = [{ do: "score", n: 1 }, { do: "respawn", key: ent.key }];
        if (mo === "fall" && control === "keys2" && d.end.lives && (m.has("catch") || !enemies.length)) ent.onExit = [{ do: "hurt" }];
        if (mo === "fall" && control === "keys2" && !enemies.length && !d.end.lives) { d.end.lives = A.lives || 3; ent.onExit = [{ do: "hurt" }]; }
      }
      const what = { static: L("diem, tinggal diambil", "sits still, grab it"), fall: L("jatuh, tangkep", "falls, catch it"), wander: L("gerak-gerak, kejar", "moves around, chase it"), scroll: L("lewat dari kanan", "passes from the right"), fly: L("terbang lewat", "flies by") }[mo];
      ent.why = `${ent.label}: ${what}` + (e.k.source ? L(" (riset: " + (CATS[e.cat] || CATS.object).id + ")", " (research: " + (CATS[e.cat] || CATS.object).en + ")") : "");
      d.entities.push(ent);
      reasons.push(L("barang: ", "item: ") + ent.label + " ×" + count + " " + what + " (" + e.how + ")");
    });

    // ---- clickable things (whack style)
    clicks.forEach((e, n) => {
      const sz = clamp(sizeOf(e) + 10, 22, 50);
      const ent = { key: e.key, id: e.key, label: e.label, shape: shapeOf(e), w: sz, h: shapeOf(e) === "rect" || shapeOf(e) === "ellipse" ? Math.round(sz * 0.7) : sz, color: colorOf(e, n), count: clamp(e.th.count || 2, 1, 6),
        motion: "teleport", every: A.hard ? 0.7 : 1.1, role: "click", spawn: "random", onClick: [{ do: "score", n: 1 }, { do: "respawn", key: e.key }] };
      ent.area = Object.assign({}, area, { x1: W - sz - 10, y1: H - sz - 10 });
      ent.why = L(`${ent.label}: pindah-pindah, klik buat dapet poin`, `${ent.label}: keeps moving, click it to score`);
      d.entities.push(ent);
      d.score = true;
      reasons.push(L("target klik: ", "click target: ") + ent.label + " ×" + ent.count);
    });

    // ---- goal / maze
    if (m.has("maze") && P) {
      const cell = 40, cols = Math.floor((W - 20) / cell), rows = Math.floor((H - d.playTop - 26) / cell);
      const x0 = Math.round((W - cols * cell) / 2), y0 = d.playTop;
      const walls = Gen.carveMaze(cols, rows, rand);
      d.walls = Gen.mazeRects(walls, x0, y0, cell, 8).map((r, i) => ({ id: "tembok" + (i + 1), x: r[0], y: r[1], w: r[2], h: r[3], color: "#5f4530" }));
      // outer frame
      d.walls.push({ id: "pagarAtas", x: x0 - 4, y: y0 - 4, w: cols * cell + 8, h: 4, color: "#5f4530" }, { id: "pagarBawah", x: x0 - 4, y: y0 + rows * cell, w: cols * cell + 8, h: 4, color: "#5f4530" },
        { id: "pagarKiri", x: x0 - 4, y: y0, w: 4, h: rows * cell, color: "#5f4530" }, { id: "pagarKanan", x: x0 + cols * cell, y: y0, w: 4, h: rows * cell, color: "#5f4530" });
      P.x = x0 + 11; P.y = y0 + 11;
      d.maze = { cols, rows, cell, x0, y0 };
      reasons.push(L(`labirin ${cols}×${rows} digali baru pake algoritma recursive backtracker (beda tiap kali)`, `a fresh ${cols}×${rows} maze carved with a recursive backtracker (different every time)`));
      // items sit in random cells
      for (const e of d.entities) if (e.motion === "static") e.fixed = Array.from({ length: e.count }, () => [x0 + rint(rand, 1, cols - 1) * cell + Math.round((cell - e.w) / 2), y0 + rint(rand, 0, rows - 1) * cell + Math.round((cell - e.h) / 2)]);
      for (const e of d.entities) if (e.motion === "chase") e.speed = r1(Math.min(e.speed, 0.9));
    }
    goals.forEach((g, n) => {
      if (!P) return;
      const sz = d.maze ? 26 : clamp(sizeOf(g), 24, 44);
      const ent = { key: g.key, id: g.key, label: g.label, shape: d.maze ? "square" : shapeOf(g), w: sz, h: sz, color: colorOf(g, n + 2), count: 1, motion: "static", role: "goal", spawn: "random", onTouch: [{ do: "win" }] };
      ent.area = Object.assign({}, area, { x0: Math.round(W * 0.6), x1: W - sz - 16, y1: H - sz - 16 });
      if (d.maze) ent.fixed = [[d.maze.x0 + (d.maze.cols - 1) * d.maze.cell + 7, d.maze.y0 + (d.maze.rows - 1) * d.maze.cell + 7]];
      ent.why = L(`${ent.label}: sentuh buat menang`, `${ent.label}: touch it to win`);
      d.entities.push(ent);
      d.end.reach = true;
      reasons.push(L("tujuan: ", "goal: ") + ent.label + L(" (sampe sini = menang)", " (reach it to win)"));
    });

    // ---- shooting
    if (m.has("shoot") && P && projs.length) {
      const pe = projs[0];
      const sz = clamp(sizeOf(pe), 6, 16);
      const dir = control === "keys2" ? [0, -1] : control === "platform" || control === "flappy" ? [1, 0] : [1, 0];
      d.shooter = { proj: { key: pe.key, id: pe.key, label: pe.label, shape: shapeOf(pe) === "rect" ? "rect" : shapeOf(pe), w: sz, h: shapeOf(pe) === "rect" ? Math.max(4, Math.round(sz / 2)) : sz, color: colorOf(pe, 0) },
        slots: 3, speed: 7, cooldown: 14, dx: dir[0], dy: dir[1], facing: control === "keys4" };
      for (const e of d.entities) if (e.role === "target" || e.role === "enemy") { e.shootable = true; e.onShot = e.onShot || [{ do: "score", n: 1 }, { do: "respawn", key: e.key }]; }
      reasons.push(L("nembak: spasi ngelempar ", "shooting: space throws ") + pe.label + (d.shooter.facing ? L(" ke arah terakhir lu jalan", " the way u last moved") : dir[1] ? L(" ke atas", " upwards") : L(" ke kanan", " to the right")) + " (" + pe.how + ")");
    }

    // ---- pong
    if (m.has("pong") && P) {
      d.ball = { id: "bola", w: 16, color: "#feae34", onPaddle: [{ do: "score", n: 1 }], onMiss: [{ do: "hurt" }] };
      d.vars.push(["bvx", 3], ["bvy", 3]);
      if (!d.end.lives) d.end.lives = A.lives || 3;
      reasons.push(L("bola mantul dari tembok & raket, lolos ke bawah = nyawa -1", "the ball bounces off walls and the paddle; missing it costs a life"));
    }

    // ---- win/lose
    const scoreSources = d.entities.some((e) => (e.onExit || []).concat(e.onShot || [], e.onTouch || [], e.onClick || []).some((a) => a.do === "score")) || d.ball;
    if (A.goal && game) d.end.goal = A.goal;
    else if (game && !d.end.collectAll && !d.end.reach && !A.seconds && scoreSources && !m.has("survive")) {
      d.end.goal = m.has("shoot") ? 15 : control === "platform" || control === "flappy" ? 20 : d.ball ? 10 : m.has("catch") || items.length ? 10 : enemies.length ? 30 : 20;
    }
    if (game && (m.has("countdown") || m.has("survive") || (m.has("whack") && clicks.length))) {
      const sec = A.seconds || 30;
      d.timers.push({ kind: "countdown", sec });
      d.hud.push({ id: "hudWaktu", label: L("waktu", "time"), expr: 'ceil(/time"batasWaktu")' });
      d.timerHud = "hudWaktu";
      const survive = m.has("survive") || (!d.end.goal && !d.end.collectAll && !d.end.reach);
      d.timeUp = survive ? [{ do: "win", text: L("LU SELAMAT", "U SURVIVED") }] : [{ do: "lose", text: L("WAKTU HABIS", "TIME'S UP") }];
      d.end.timer = true;
      reasons.push(L(`waktu ${sec} detik: `, `${sec} second timer: `) + (survive ? L("bertahan sampe habis = menang", "survive until it ends = win") : L("habis sebelum selesai = kalah", "running out = lose")));
    }
    if (d.score) d.hud.unshift({ id: "hudSkor", label: L("skor", "score"), expr: d.end.goal ? `skor + "/${d.end.goal}"` : "skor" });
    if (d.end.lives) d.hud.splice(d.score ? 1 : 0, 0, { id: "hudNyawa", label: L("nyawa", "lives"), expr: "nyawa" });
    const endWords = [];
    if (d.end.goal) endWords.push(L(`skor ${d.end.goal} = menang`, `score ${d.end.goal} = win`));
    if (d.end.collectAll) endWords.push(L("ambil semua = menang", "collect them all = win"));
    if (d.end.reach) endWords.push(L("sampe tujuan = menang", "reach the goal = win"));
    if (d.end.lives) endWords.push(L(`${d.end.lives} nyawa, abis = kalah`, `${d.end.lives} lives, none left = lose`));
    if (endWords.length) reasons.push(L("aturan: ", "rules: ") + endWords.join(", "));

    // ---- apps and widgets
    const flow = { x: 16, y: Math.max(d.playTop, 40 + 20 * d.hud.length + 14) };
    const place = (w, h) => { if (flow.x + w > W - 10) { flow.x = 16; flow.y += 70; } const at = { x: flow.x, y: flow.y }; flow.x += w + 18; return at; };
    if (m.has("clicker")) {
      d.score = true;
      if (!d.hud.some((h) => h.id === "hudSkor")) d.hud.unshift({ id: "hudSkor", label: L("skor", "score"), expr: A.goal ? `skor + "/${A.goal}"` : "skor" });
      if (A.goal) { d.end.goal = A.goal; if (!d.vars.some((x) => x[0] === "selesai")) d.end.clickGoal = true; }
      d.vars.push(["perKlik", 1]);
      const thingWord = A.things.find((x) => !x.roles.length && (know[x.word] || {}).cat);
      const col = (thingWord && (thingWord.color || (know[thingWord.word] || {}).color)) || "#6fae3f";
      const at = P ? { x: W - 160, y: d.playTop + 20 } : { x: Math.round(W / 2 - 65), y: Math.max(flow.y, Math.round(H / 2 - 80)) };
      d.widgets.push({ key: "tombolKlik", id: "tombolKlik", shape: "circle", x: at.x, y: at.y, w: 130, h: 130, color: col, label: thingWord ? thingWord.word.toUpperCase() : L("KLIK!", "CLICK!"), lx: at.x + 34, ly: at.y + 136,
        onClick: [{ do: "score", n: "perKlik" }] });
      reasons.push(L("clicker: tombol gede, tiap klik skor + perKlik", "clicker: a big button, each click adds perKlik"));
      if (m.has("shop")) {
        const price = A.price || 10;
        d.vars.push(["harga", price]);
        d.hud.push({ id: "hudPerKlik", label: L("per klik", "per click"), expr: "perKlik" });
        d.widgets.push({ key: "upgrade", id: "tombolUpgrade", shape: "rect", x: 16, y: H - 60, w: 210, h: 36, color: "#4a3626", label: `UPGRADE (${price})`, labelId: "labelUpgrade", fs: 15,
          onClick: [{ do: "if", cond: "skor >= harga", then: [{ do: "set", var: "skor", expr: "skor - harga" }, { do: "set", var: "perKlik", expr: "perKlik + 1" }, { do: "set", var: "harga", expr: "harga * 2" }, { do: "hud" },
            { do: "text", target: "labelUpgrade", expr: '"UPGRADE (" + harga + ")"' }, { do: "popup", expr: q(L("upgrade! per klik jadi ", "upgraded! per click is now ")) + " + perKlik" }],
          else: [{ do: "popup", text: L("duit lu kurang, miskin 🥀", "not enough, broke 🥀") }] }] });
        reasons.push(L(`toko: upgrade harga ${price}, abis beli harganya dobel`, `shop: upgrade costs ${price}, doubles after each buy`));
      }
    }
    if (m.has("counter")) {
      d.vars.push(["angka", 0]);
      d.hud.push({ id: "hudAngka", label: L("angka", "count"), expr: "angka" });
      const a = place(70, 50), b = place(70, 50);
      d.widgets.push({ key: "tambah", id: "tombolTambah", shape: "rect", x: a.x, y: a.y, w: 70, h: 50, color: "#4f8f2f", label: "+", lx: a.x + 27, ly: a.y + 11, fs: 26, onClick: [{ do: "add", var: "angka", n: 1 }] },
        { key: "kurang", id: "tombolKurang", shape: "rect", x: b.x, y: b.y, w: 70, h: 50, color: "#a22633", label: "-", lx: b.x + 29, ly: b.y + 11, fs: 26, onClick: [{ do: "add", var: "angka", n: -1 }] });
      reasons.push(L("counter: tombol + dan -", "counter: + and - buttons"));
    }
    if (m.has("dice")) {
      const sides = A.sides || 6;
      d.vars.push(["dadu", 0]);
      const box = place(90, 90), btn = place(120, 36);
      d.widgets.push({ key: "kotakDadu", id: "kotakDadu", shape: "square", x: box.x, y: box.y, w: 90, h: 90, color: "#f4f1ea", label: "?", labelId: "angkaDadu", lx: box.x + 30, ly: box.y + 20, fs: 44, labelColor: "#18161c" },
        { key: "lempar", id: "tombolDadu", shape: "rect", x: btn.x, y: btn.y, w: 120, h: 36, color: "#3b8ee4", label: L("LEMPAR", "ROLL"), onClick: [{ do: "set", var: "dadu", expr: `randint(1, ${sides})` }, { do: "text", target: "angkaDadu", expr: "str(dadu)" }] });
      reasons.push(L(`dadu ${sides} sisi pake randint(1, ${sides})`, `a ${sides}-sided dice with randint(1, ${sides})`));
    }
    if (m.has("colorchange")) {
      const sh = (SHAPES.find(([re]) => re.test(A.t)) || [0, "square"])[1];
      const at = place(110, 110);
      const col = (findColors(A.t)[0] || {}).hex || "#b55088";
      d.widgets.push({ key: "bentuk", id: "bentukWarna", shape: sh, x: at.x, y: at.y, w: 110, h: sh === "square" || sh === "circle" ? 110 : 80, color: col, onClick: [{ do: "color", target: "bentukWarna", colors: PALETTE }] });
      reasons.push(L("klik bentuknya = warnanya diacak", "click the shape = random colour"));
    }
    if (m.has("hover")) {
      const at = place(140, 40);
      d.widgets.push({ key: "hover", id: "kotakHover", shape: "rect", x: at.x, y: at.y, w: 140, h: 40, color: "#4a3626", label: "hover", onHover: [{ do: "color", target: "kotakHover", colors: ["#93cc5f", "#feae34", "#3b8ee4"] }] });
    }
    if (m.has("popup")) {
      const msg = A.quotes[0] || L("halo! ini popup. jangan baper 🥀", "hi! this is a popup. don't cry 🥀");
      const at = place(150, 36);
      d.widgets.push({ key: "popup", id: "tombolPopup", shape: "rect", x: at.x, y: at.y, w: 150, h: 36, color: "#3b8ee4", label: L("KLIK AKU", "CLICK ME"), onClick: [{ do: "popup", text: msg }] });
    }
    if (m.has("traffic")) {
      d.widgets.push({ key: "tiang", id: "tiang", shape: "rect", x: W - 120, y: 50, w: 70, h: 200, color: "#2b2b2b" });
      d.cycle = { sec: 1.5, lamps: [{ id: "lampuMerah", color: "#e43b44", x: W - 105, y: 60, size: 40 }, { id: "lampuKuning", color: "#feae34", x: W - 105, y: 125, size: 40 }, { id: "lampuHijau", color: "#63c74d", x: W - 105, y: 190, size: 40 }], order: [0, 2, 1] };
      reasons.push(L("lampu: merah → hijau → kuning, ganti tiap 1.5 detik pake timer", "lights: red → green → yellow every 1.5s on a timer"));
    }
    if (m.has("stopwatch")) {
      d.hud.push({ id: "hudLama", label: L("lama main", "time played"), expr: '"0s"' });
      d.timers.push({ kind: "stopwatch", id: "stopwatchMain", hud: "hudLama", label: L("lama main", "time played") });
      if (!game && !m.has("clicker")) d.loopExtra = [];
    }
    if (m.has("bounce") && !P) {
      const th = A.things[0];
      const e = th ? { label: th.word, key: camel(th.word), k: know[th.word] || {}, C: CATS[(know[th.word] || {}).cat] || CATS.object, th } : null;
      const sz = e ? clamp(sizeOf(e) + 12, 20, 50) : 30;
      d.entities.push({ key: e ? e.key : "bola", id: e ? e.key : "bola", label: e ? e.label : "bola", shape: e ? shapeOf(e) : "circle", w: sz, h: sz, color: e ? colorOf(e, 0) : (findColors(A.t).find((c) => c.hex !== A.bg) || {}).hex || "#f77622",
        count: clamp((th && th.count) || 1, 1, 8), motion: "bounce", speed: 2.4, role: "deco", spawn: "random", area: { x0: 20, x1: W - sz - 20, y0: d.playTop, y1: H - sz - 10 } });
      d.playTop = Math.min(d.playTop, 40);
      reasons.push(L("bola mantul: gerak diagonal, balik arah kalo nyentuh pinggir", "bouncing: diagonal movement, flips at the edges"));
    }
    if (m.has("shapes") && !game && !m.has("bounce") && !m.has("colorchange")) {
      // draw what was named: shapes + researched things, each with its colour
      const list = [];
      for (const [re, shape] of SHAPES) { const g = new RegExp(re.source, "g"); let mm; while ((mm = g.exec(A.t))) { const near = findColors(A.t).filter((c) => Math.abs(c.at - mm.index) < 22).sort((a, b) => Math.abs(a.at - mm.index) - Math.abs(b.at - mm.index))[0]; list.push({ shape, color: near ? near.hex : null, at: mm.index }); } }
      for (const th of A.things) { const k = know[th.word] || {}; const C = CATS[k.cat] || CATS.object; list.push({ shape: k.shape || C.shape, color: th.color || k.color || C.color, label: th.word, at: A.t.indexOf(th.word) }); }
      list.sort((a, b) => a.at - b.at);
      if (!list.length) list.push({ shape: "circle", color: "#feae34" }, { shape: "square", color: "#3b8ee4" }, { shape: "triangle", color: "#63c74d" });
      let x = 30;
      list.slice(0, 7).forEach((it, i) => {
        const w = it.shape === "rect" || it.shape === "ellipse" ? 90 : 60, h = it.shape === "rect" || it.shape === "ellipse" ? 55 : 60;
        d.widgets.push({ key: "gambar" + (i + 1), id: Gen.camel(it.label || it.shape) + (i + 1), shape: it.shape, x, y: 140, w, h, color: it.color || PALETTE[i % PALETTE.length], label: it.label || null, lx: x, ly: 140 + h + 8, fs: 12 });
        x += w + 26;
      });
      reasons.push(L("gambar: ", "drawing: ") + list.slice(0, 7).map((it) => (it.label || it.shape) + " " + colorName(it.color || "", A.lang)).join(", "));
    }

    // ---- sequences
    const seq = d.sequence;
    if (m.has("greet")) {
      d.vars.push(["nama", '""']);
      d.widgets.push({ key: "sapa", id: "sapa", shape: "text", x: 16, y: flow.y, w: 0, h: 0, label: L("halo", "hello"), labelId: "sapa", lx: 16, ly: flow.y, fs: 18 });
      flow.y += 30;
      seq.push({ kind: "ask", var: "nama", prompt: L("siapa nama lu?", "what's your name?") }, { kind: "do", acts: [{ do: "text", target: "sapa", expr: q(L("halo, ", "hello, ")) + " + nama + " + q(L(". nama lu jelek 🥀", ". mid name 🥀")) }] });
    }
    if (m.has("password")) {
      const pw = A.password || "sybau123";
      d.vars.push(["sandi", '""'], ["coba", 0]);
      seq.push({ kind: "loop", cond: `sandi != ${q(pw)}`, body: [{ kind: "ask", var: "sandi", prompt: L("masukin password:", "enter password:") }, { kind: "do", acts: [{ do: "add", var: "coba", n: 1 },
        { do: "if", cond: `sandi != ${q(pw)}`, then: [{ do: "popup", text: L("salah. coba lagi 🥀", "wrong. try again 🥀") }] }] }] },
        { kind: "popup", expr: q(L("bener! masuk setelah ", "correct! got in after ")) + " + coba + " + q(L(" kali coba", " tries")) });
      reasons.push(L(`password: diulang terus sampe bener ("${pw}")`, `password: asks again until it's right ("${pw}")`));
    }
    if (m.has("guess")) {
      d.vars.push(["rahasia", 0], ["tebakan", 0], ["percobaan", 0]);
      seq.push({ kind: "do", acts: [{ do: "set", var: "rahasia", expr: `randint(1, ${A.max})` }] },
        { kind: "loop", cond: "tebakan != rahasia", body: [{ kind: "ask", var: "tebakan", number: true, prompt: L("tebak angka 1 sampe ", "guess a number from 1 to ") + A.max }, { kind: "do", acts: [{ do: "add", var: "percobaan", n: 1 },
          { do: "if", cond: "tebakan < rahasia", then: [{ do: "popup", text: L("kekecilan", "too low") }] }, { do: "if", cond: "tebakan > rahasia", then: [{ do: "popup", text: L("kegedean", "too high") }] }] }] },
        { kind: "popup", expr: q(L("bener! angkanya ", "correct! it was ")) + " + rahasia + \", \" + percobaan + " + q(L(" kali nebak 🥀", " tries 🥀")) });
      reasons.push(L(`tebak angka 1-${A.max}: dikasih tau kekecilan/kegedean`, `guess 1-${A.max} with too low / too high hints`));
    }
    if (m.has("calculator")) {
      d.vars.push(["a", 0], ["b", 0]);
      for (let i = 1; i <= 4; i++) d.widgets.push({ key: "hasil" + i, id: "hasil" + i, shape: "text", x: 16, y: flow.y + (i - 1) * 24, w: 0, h: 0, label: "", labelId: "hasil" + i, lx: 16, ly: flow.y + (i - 1) * 24, fs: 16 });
      seq.push({ kind: "ask", var: "a", number: true, prompt: L("angka pertama:", "first number:") }, { kind: "ask", var: "b", number: true, prompt: L("angka kedua:", "second number:") },
        { kind: "do", acts: [{ do: "text", target: "hasil1", expr: 'a + " + " + b + " = " + (a + b)' }, { do: "text", target: "hasil2", expr: 'a + " - " + b + " = " + (a - b)' }, { do: "text", target: "hasil3", expr: 'a + " x " + b + " = " + (a * b)' },
          { do: "if", cond: "b != 0", then: [{ do: "text", target: "hasil4", expr: 'a + " / " + b + " = " + (a / b)' }], else: [{ do: "text", target: "hasil4", expr: q(L("bagi nol? ga bisa bang", "divide by zero? nope")) }] }] });
    }
    if (m.has("quiz") && know.__quiz) {
      const qz = know.__quiz;
      d.score = true;
      if (!d.hud.some((h) => h.id === "hudSkor")) d.hud.unshift({ id: "hudSkor", label: L("skor", "score"), expr: "skor" });
      d.vars.push(["jawab", '""']);
      if (qz.source) d.notes.push(L("soal dibikin dari artikel wikipedia: ", "questions made from the wikipedia article: ") + qz.source);
      qz.questions.forEach((qq, i) => {
        let prompt = L("soal ", "question ") + (i + 1) + ": " + qq.prompt;
        let accept;
        if (qq.choices) { prompt += "  |  " + qq.choices.map((c, j) => (j + 1) + ") " + c).join("   "); const k = qq.choices.indexOf(qq.answer) + 1; accept = [String(k), qq.answer, qq.answer.toLowerCase()]; }
        else if (qq.tf) { prompt += L("  (ketik b / s)", "  (type t / f)"); accept = qq.answer === "benar" ? ["b", "benar", "B", "Benar"] : qq.answer === "salah" ? ["s", "salah", "S", "Salah"] : qq.answer === "true" ? ["t", "true", "T", "True"] : ["f", "false", "F", "False"]; }
        else accept = [qq.answer];
        const wrongText = L("salah. jawabannya ", "wrong. it's ") + qq.answer + (qq.fact ? " — " + qq.fact : "") + " 🥀";
        seq.push({ kind: "question", var: "jawab", prompt, accept: [...new Set(accept)], right: [{ do: "score", n: 1 }, { do: "popup", text: L("bener! ", "correct! ") + (qq.fact && !qq.number ? qq.fact : "") }], wrong: [{ do: "popup", text: wrongText }] });
      });
      seq.push({ kind: "popup", expr: q(L("selesai! skor lu ", "done! you got ")) + " + skor + " + q("/" + qz.questions.length) });
      reasons.push(L(`kuis ${qz.questions.length} soal `, `a ${qz.questions.length}-question quiz `) + (qz.source ? L("dari artikel '" + qz.source + "'", "from the article '" + qz.source + "'") : L("matematika", "maths")));
    }

    // ---- title, help, intro
    const named = (e) => (e ? e.label : null);
    const firstEnemy = d.entities.find((e) => e.role === "enemy" || e.role === "target"), firstItem = d.entities.find((e) => e.role === "item");
    d.title = A.title || A.quotes.find((x) => x !== (m.has("popup") ? A.quotes[0] : null)) ||
      (P && firstEnemy ? `${named(P)} vs ${named(firstEnemy)}` : P && firstItem ? `${named(P)} ${L("ngumpulin", "collects")} ${named(firstItem)}` : m.has("quiz") && know.__quiz && know.__quiz.source ? L("kuis ", "quiz: ") + know.__quiz.source : m.has("maze") ? L("labirin sybau", "sybau maze") :
      (["guess", "calculator", "counter", "dice", "traffic", "password", "greet", "clicker", "quiz", "colorchange", "bounce", "stopwatch"].map((k) => m.has(k) && { guess: L("tebak angka", "guess the number"), calculator: L("kalkulator", "calculator"), counter: "counter",
        dice: L("dadu", "dice"), traffic: L("lampu lalu lintas", "traffic light"), password: "login", greet: L("halo", "hello"), clicker: "sybau clicker", quiz: L("kuis", "quiz"), colorchange: L("ganti warna", "colour changer"), bounce: L("mantul", "bounce"), stopwatch: "stopwatch" }[k]).find(Boolean)) ||
      "sybau " + (isApp ? "app" : "game"));
    if (P) {
      const keys = { keys4: L("panah/wasd", "arrows/wasd"), keys2: L("kiri/kanan", "left/right"), platform: L("spasi lompat, panah jalan", "space jumps, arrows walk"), flappy: L("spasi/klik buat terbang", "space/click to flap"), mouse: L("mouse/panah", "mouse/arrows") }[P.control];
      d.help = keys + (d.shooter ? L(" · spasi nembak", " · space shoots") : "");
    }
    const facts = [];
    for (const e of [player, ...enemies, ...items, ...projs, ...clicks]) if (e && e.k && e.k.fact) facts.push(e.k.fact);
    if (game && (facts.length || endWords.length)) {
      const how = endWords.length ? L("cara main: ", "how to play: ") + endWords.join(", ") + ". " : "";
      d.intro = (how + (facts.length ? L("info: ", "fyi: ") + facts[0] : "")).slice(0, 230);
    }
    for (const e of [player, ...enemies, ...items, ...projs, ...clicks]) if (e && e.k && e.k.source) d.notes.push(L("riset ", "research ") + e.label + ": " + e.k.source + " → " + (CATS[e.cat] || CATS.object)[A.lang === "en" ? "en" : "id"]);
    d.reasons = reasons;
    d.game = game;
    return d;
  }
  const q = (s) => '"' + String(s).replace(/"/g, "'") + '"';
  /** lighten (or darken) a colour until it stands out from the background */
  function readable(hex, bg) {
    const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const lum = (c) => { const [r, g, b] = c.map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    if (!/^#[0-9a-f]{6}$/i.test(hex) || !/^#[0-9a-f]{6}$/i.test(bg)) return hex;
    let c = rgb(hex);
    const lb = lum(rgb(bg)), toward = lb < 0.4 ? 255 : 0;
    for (let i = 0; i < 8; i++) {
      const a = lum(c), ratio = (Math.max(a, lb) + 0.05) / (Math.min(a, lb) + 0.05);
      if (ratio >= 2.6) break;
      c = c.map((x) => Math.round(x + (toward - x) * 0.25));
    }
    return "#" + c.map((x) => x.toString(16).padStart(2, "0")).join("");
  }

  // ------------------------------------------------------------------ compile errors
  function repair(roots, err) {
    const r = roots.find((x) => x.index === err.root) || roots[0];
    const lines = r.code.split("\n");
    const li = Math.max(0, (err.line || 1) - 1);
    let m;
    if ((m = /'(\w+)' is never given a value/.exec(err.error)) && new RegExp("\\b" + m[1] + "\\s*\\(").test(r.code) && !new RegExp("^\\s*def\\s+" + m[1] + "\\b", "m").test(roots.map((x) => x.code).join("\n"))) {
      // a call to a function that was never written: drop the calls (a 'var' would crash when called)
      const name = m[1];
      let n = 0;
      for (const rr of roots) {
        const ls = rr.code.split("\n");
        for (let i = 0; i < ls.length; i++) if (new RegExp("\\b" + name + "\\s*\\(").test(ls[i]) && !/^\s*\/\//.test(ls[i])) {
          const ind = ls[i].match(/^\s*/)[0], orig = ls[i].trim();
          ls[i] = ind + "// " + orig + "   // (sybau: fungsi '" + name + "' ga pernah ditulis)";
          n++;
          // it was a block header ("if f():"): an always-false header keeps the block under it valid
          if (/:$/.test(orig)) { ls.splice(i + 1, 0, ind + "if 0 == 1:"); i++; }
        }
        rr.code = ls.join("\n");
      }
      return "fungsi '" + name + "' dipanggil tapi ga pernah ditulis, " + n + " panggilan gw buang";
    }
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
      lines.splice(li, 0, ind + "return");
      r.code = lines.join("\n");
      return "blok kosong di baris " + li + ", gw isi biar valid";
    }
    lines[li] = "// " + lines[li].trim() + "   // (sybau: baris ini gw matiin, error: " + err.error.slice(0, 60) + ")";
    r.code = lines.join("\n");
    return "baris " + (li + 1) + " error (" + err.error + "), gw matiin dulu biar sisanya jalan";
  }

  function toSts(prog, name) {
    const out = ["// STS project: " + name, "// stage " + prog.stage.w + "x" + prog.stage.h, ""];
    for (const r of prog.roots) out.push("@root " + r.index + " " + r.name, r.code.replace(/\n+$/, ""), "");
    return out.join("\n");
  }

  // ------------------------------------------------------------------ behaviour tests
  /** run a probed copy of the program and record the watched values per tick */
  function probeRun(vm, d, probe, script, rand) {
    const prog = Gen.write(d, { probe, rand: script.rand || rand });
    const c = vm.compile(prog.roots);
    if (!c.ok) return { ok: false, error: c.error };
    vm.start(script.seed || 11);
    const seen = {};
    let lastTick = -1;
    for (let f = 0; f < (script.frames || 120) * 3 && lastTick < (script.frames || 120); f++) {
      const st = vm.tick(16);
      if (st === Sts.STATE.ERROR) { const e = vm.runtimeError(); vm.stop(); return { ok: false, error: e || "runtime error", seen }; }
      if (st === Sts.STATE.POPUP) { vm.ackPopup(); continue; }
      if (st === Sts.STATE.ASK) { vm.answer(script.answer || "1"); continue; }
      if (st === Sts.STATE.DONE) break;
      const v = vm.vars();
      const tick = +v._tick;
      if (tick !== lastTick) {
        lastTick = tick;
        seen[tick] = v;
        for (const [at, act] of script.actions || []) if (at === tick) act(vm);
      }
    }
    vm.stop();
    return { ok: true, seen, last: lastTick };
  }
  function selfTest(vm, d, rand, say) {
    const L = (a, b) => (d.lang === "en" ? b : a);
    const results = [];
    const P = d.player;
    const pass = (ok, msg) => { results.push({ ok, msg }); say("   " + (ok ? "✓ " : "✗ ") + msg); };
    const val = (r, t, k) => (r.seen && r.seen[t] ? parseFloat(r.seen[t][k]) : NaN);
    const near = (r, t, k) => { for (let i = 0; i < 4; i++) { const x = val(r, t + i, k); if (!isNaN(x)) return x; } return NaN; };
    if (d.special) { specialTests(vm, d, rand, pass, L, near); return results; }
    if (P) {
      const watch = [["_px", `get("${P.id}", "x")`], ["_py", `get("${P.id}", "y")`]];
      let keys = [], expect = null;
      if (P.control === "keys4" || P.control === "keys2") { keys = ["right"]; expect = (r) => near(r, 40, "_px") - near(r, 6, "_px") > 5; }
      if (P.control === "platform") { keys = ["space"]; expect = (r) => Math.min(...[12, 16, 20, 24].map((t) => near(r, t, "_py"))) < near(r, 6, "_py") - 10; }
      if (P.control === "flappy") { keys = []; expect = (r) => near(r, 18, "_py") > near(r, 6, "_py") + 5; }
      if (P.control === "mouse") expect = (r) => Math.abs(near(r, 30, "_px") - (360 - P.w / 2)) < 3;
      const r = probeRun(vm, d, { watch }, { frames: 50, actions: [[8, (m) => { keys.forEach((k) => m.key(k, true)); if (P.control === "mouse") m.mouseMove(360, 200); }], [45, (m) => keys.forEach((k) => m.key(k, false))]] }, rand);
      const what = { keys4: L("dipencet panah kanan", "pressing right"), keys2: L("dipencet panah kanan", "pressing right"), platform: L("dipencet spasi (lompat)", "pressing space (jump)"), flappy: L("dibiarin (harus jatuh)", "left alone (should fall)"), mouse: L("mouse digeser", "moving the mouse") }[P.control];
      pass(r.ok && expect(r), L(`${P.label} gerak pas ${what}`, `${P.label} moves when ${what}`) + (r.ok ? "" : " — " + r.error));
    }
    const seenKinds = new Set();
    for (const e of d.entities) {
      if (seenKinds.has(e.key)) continue;
      seenKinds.add(e.key);
      const id = e.id + "1";
      if (e.motion !== "static" && e.motion !== "teleport") {
        const r = probeRun(vm, d, { watch: [["_ex", `get("${id}", "x")`], ["_ey", `get("${id}", "y")`]] }, { frames: 40 }, rand);
        const moved = r.ok && (Math.abs(near(r, 35, "_ex") - near(r, 5, "_ex")) > 2 || Math.abs(near(r, 35, "_ey") - near(r, 5, "_ey")) > 2);
        pass(moved, L(`${e.label} beneran gerak (${e.motion})`, `${e.label} actually moves (${e.motion})`) + (r.ok ? "" : " — " + r.error));
      }
      if (P && e.onTouch && e.onTouch.length) {
        const watchVar = e.onTouch.some((a) => a.do === "hurt") ? (d.end.lives ? "nyawa" : "selesai") : e.onTouch.some((a) => a.do === "win") ? "selesai" : "skor";
        const r = probeRun(vm, d, { watch: [["_v", watchVar]], at: [[20, `setpos("${id}", get("${P.id}", "x"), get("${P.id}", "y"))`]] }, { frames: 30 }, rand);
        const before = near(r, 19, "_v"), after = near(r, 26, "_v");
        const ok = r.ok && before !== after;
        const what = watchVar === "nyawa" ? L("nyawa berkurang", "a life is lost") : watchVar === "skor" ? L("skor nambah", "score goes up") : L("game tamat", "the game ends");
        pass(ok, L(`${e.label} nyentuh ${P.label} → ${what}`, `${e.label} touching the ${P.label} → ${what}`) + (r.ok ? (ok ? ` (${before} → ${after})` : "") : " — " + r.error));
      }
      if (d.shooter && e.shootable) {
        const pid = d.shooter.proj.id + "1";
        const r = probeRun(vm, d, { watch: [["_v", "skor"]], at: [[20, `setpos("${pid}", get("${id}", "x"), get("${id}", "y"))`]] }, { frames: 30 }, rand);
        const ok = r.ok && near(r, 26, "_v") > near(r, 19, "_v");
        pass(ok, L(`${d.shooter.proj.label} kena ${e.label} → skor nambah`, `${d.shooter.proj.label} hits ${e.label} → score goes up`) + (r.ok ? "" : " — " + r.error));
      }
    }
    for (const w of d.widgets) if (w.onClick && w.onClick.some((a) => a.do === "score" || a.do === "add" || a.do === "set")) {
      const v = (w.onClick.find((a) => a.var) || {}).var || "skor";
      const r = probeRun(vm, d, { watch: [["_v", v]] }, { frames: 30, actions: [[15, (m) => { m.mouseMove(w.x + w.w / 2, w.y + w.h / 2); m.click(w.x + w.w / 2, w.y + w.h / 2); }]] }, rand);
      const ok = r.ok && near(r, 25, "_v") !== near(r, 10, "_v");
      pass(ok, L(`klik ${w.id} → ${v} berubah`, `clicking ${w.id} changes ${v}`) + (r.ok ? "" : " — " + r.error));
    }
    for (const e of d.entities) if (e.onClick) {
      const r = probeRun(vm, d, { watch: [["_v", "skor"], ["_cx", `get("${e.id}1", "x") + ${Math.round(e.w / 2)}`], ["_cy", `get("${e.id}1", "y") + ${Math.round(e.h / 2)}`]] }, { frames: 30, actions: [[15, (m) => { /* clicked below, needs the position */ }]] }, rand);
      const cx = near(r, 12, "_cx"), cy = near(r, 12, "_cy");
      const r2 = probeRun(vm, d, { watch: [["_v", "skor"]] }, { frames: 30, actions: [[14, (m) => m.click(cx, cy)]] }, rand);
      const ok = r2.ok && near(r2, 25, "_v") > near(r2, 10, "_v");
      pass(ok, L(`klik ${e.label} → skor nambah`, `clicking ${e.label} scores`));
    }
    // a few seconds of mashing every key, nothing may crash
    const keys = ["left", "right", "up", "down", "space"];
    const acts = [];
    for (let i = 5; i < 300; i += 9) { const k = keys[Math.floor(rand() * keys.length)]; acts.push([i, (m) => m.key(k, true)], [i + 7, (m) => m.key(k, false)]); }
    for (let i = 10; i < 300; i += 40) acts.push([i, (m) => m.click(rint(rand, 20, d.stage.w - 20), rint(rand, 60, d.stage.h - 20))]);
    const r = probeRun(vm, d, { watch: [] }, { frames: 300, actions: acts }, rand);
    pass(r.ok, L("dimainin acak 5 detik: ga ada error", "5 seconds of random play: no errors") + (r.ok ? "" : " — " + r.error));
    return results;
  }

  function specialTests(vm, d, rand, pass, L, near) {
    const run = (probe, script) => probeRun(vm, d, probe, script, rand);
    const err = (r) => (r.ok ? "" : " — " + r.error);
    if (d.special === "tictactoe") {
      const cells = Gen.write(d, {}).info.cells;
      const two = d.board.twoPlayer;
      let r = run({ watch: [["_a", "s1"], ["_n", "langkah"]] }, { frames: 20, actions: [[5, (m) => m.click(cells[0].x, cells[0].y)]] });
      pass(r.ok && near(r, 12, "_a") === 1 && near(r, 12, "_n") === (two ? 1 : 2), L("klik kotak kiri atas → jadi X", "clicking the top-left cell → X") + (two ? "" : L(", komputer langsung bales", ", the computer answers")) + err(r));
      if (!two) {
        r = run({ watch: [["_v", "s3"]], at: [[5, "s1 = 1"], [6, "s2 = 1"], [7, "langkahKomputer()"]] }, { frames: 15 });
        pass(r.ok && near(r, 10, "_v") === 2, L("X punya 2 sejajar (1,2) → komputer ngeblok di 3", "X has two in a row (1,2) → the computer blocks 3") + err(r));
        r = run({ watch: [["_v", "s6"]], at: [[5, "s4 = 2"], [6, "s5 = 2"], [7, "s1 = 1"], [8, "s2 = 1"], [9, "langkahKomputer()"]] }, { frames: 15 });
        pass(r.ok && near(r, 12, "_v") === 2, L("komputer bisa menang di 6 → dia milih menang, bukan ngeblok", "the computer can win at 6 → it wins instead of blocking") + err(r));
      }
      r = run({ watch: [["_v", "selesai"]] }, { frames: 60, actions: cells.map((c2, i) => [5 + i * 4, (m) => m.click(c2.x, c2.y)]) });
      pass(r.ok && near(r, 50, "_v") === 1, L("klik semua kotak → game selesai (menang/kalah/seri)", "clicking every cell → the game ends (win/lose/draw)") + err(r));
      r = run({ watch: [["_v", "langkah"]], at: [[30, "mainLagi()"]] }, { frames: 40, actions: [[5, (m) => m.click(cells[4].x, cells[4].y)]] });
      pass(r.ok && near(r, 20, "_v") > 0 && near(r, 35, "_v") === 0, L("tombol main lagi ngosongin papan", "the again button clears the board") + err(r));
    } else if (d.special === "snake") {
      const k = d.snake.cell;
      let r = run({ watch: [["_x", "hx"]] }, { frames: 70 });
      pass(r.ok && near(r, 60, "_x") > near(r, 2, "_x"), L("ular jalan sendiri ke kanan", "the snake moves right by itself") + err(r));
      r = run({ watch: [["_y", "hy"]] }, { frames: 50, actions: [[5, (m) => m.key("up", true)], [30, (m) => m.key("up", false)]] });
      pass(r.ok && near(r, 40, "_y") < near(r, 4, "_y"), L("pencet panah atas → belok ke atas", "pressing up → turns up") + err(r));
      r = run({ watch: [["_s", "skor"], ["_p", "panjang"]], at: [[3, `setpos("${d.snake.foodId}", hx + ${k}, hy)`]] }, { frames: 30 });
      pass(r.ok && near(r, 25, "_s") === 1 && near(r, 25, "_p") === 4, L("makan → skor 1, badan jadi 4 ruas", "eating → score 1, body grows to 4") + err(r));
      r = run({ watch: [["_v", "selesai"]] }, { frames: 400 });
      pass(r.ok && near(r, 380, "_v") === 1, L("dibiarin lurus terus → nabrak tembok → game over", "left alone → hits the wall → game over") + err(r));
    } else if (d.special === "rps") {
      const b = Gen.write(d, {}).info.buttons;
      const r = run({ watch: [["_v", "menang + kalah + seri"]] }, { frames: 30, actions: [[5, (m) => m.click(b[0].x, b[0].y)], [15, (m) => m.click(b[2].x, b[2].y)]] });
      pass(r.ok && near(r, 25, "_v") === 2, L("klik 2 pilihan → 2 ronde kehitung", "two clicks → two rounds counted") + err(r));
      const r2 = run({ watch: [["_v", "menang"]], at: [[5, "pilihanKomputer = 2"]] }, { frames: 10 });
      pass(r2.ok, L("aturan menang/kalah ke-compile & jalan", "the win/lose rules compile and run") + err(r2));
    }
  }

  // ------------------------------------------------------------------ the critic
  // what a program that really does X has to contain. Used only to JUDGE what the transformer
  // wrote (a dice request that comes back as a maze is rejected), never to write code.
  const MECH_SIGNS = {
    dice: /randint\(1,\s*\d+\)/, tictactoe: /\bs9\b/, snake: /\bbadan\d|\bpanjang\b/, rps: /randint\(1,\s*3\)/, quiz: /anspopup/, guess: /\brahasia\b|tebak/i,
    calculator: /\bhasil\d\b|anspopup[\s\S]*anspopup/, clicker: /onclick/, shop: /harga|upgrade/i, counter: /\bangka\b/, traffic: /lampu/i, shoot: /tembak|pvx\d/, maze: /tembok|dinding|solid/,
    jump: /diTanah|vy/, flappy: /\bvy\b/, pong: /\bbola\b|bvx/, collect: /destroy\(|\bdapat\w*|skor = skor \+/, dodge: /nyawa|kena\(|tamat\(/, chase: /get\(id, "x"\) [<>] get\(/,
    whack: /onclick/, password: /sandi/, greet: /\bnama\b/, colorchange: /choose\("#/, bounce: /abs\(|pantul/, popup: /show\.popup/, hover: /onhover/, stopwatch: /stopwatch/,
    countdown: /countdown/, survive: /countdown/, lives: /nyawa/, catch: /move\(id, 0, /, move: /key\("(left|right)"\)/,
  };
  function critic(code, mech) {
    const want = [...mech].filter((m) => MECH_SIGNS[m]);
    const have = want.filter((m) => MECH_SIGNS[m].test(code));
    return { want, have, missing: want.filter((m) => !have.includes(m)) };
  }

  // ------------------------------------------------------------------ the code transformer's input
  /** what the code model reads: request words (things -> slots) + what research says about each slot.
   *  tools/make_sts_corpus.js builds its training data with this same function. */
  function buildPrefix(A, know) {
    const slots = A.things.slice(0, 4).map((th) => ({ key: camel(th.word), word: th.word }));
    const words = A.t.trim().split(/\s+/).map((w) => { const i = slots.findIndex((x) => x.word === w); return i >= 0 ? "<t" + (i + 1) + ">" : w; });
    const info = [];
    slots.forEach((x, i) => { const k = know[x.word] || {}; info.push("<t" + (i + 1) + ">", "cat:" + (k.cat || "object")); if (k.color) info.push("col:" + k.color); });
    // what the request reader understood (rules + neural reader): the kind of program asked for
    const mech = [...A.mech].sort().map((m) => "mech:" + m);
    return { slots, prefix: ["<req>", ...words, "</req>", ...mech, ...info, "<code>"] };
  }

  /** checks that work on ANY program (the neural one has no design to test against) */
  function genericTests(vm, roots, L, pass) {
    const code = roots.map((r) => r.code).join("\n");
    const snap = (keys, frames, seed) => {
      if (!vm.compile(roots).ok) return null;
      vm.start(seed);
      let err = null;
      for (let f = 0; f < frames; f++) {
        if (f === 5) keys.forEach((k) => vm.key(k, true));
        const st = vm.tick(16);
        if (st === Sts.STATE.ERROR) { err = vm.runtimeError() || "runtime error"; break; }
        if (st === Sts.STATE.POPUP) vm.ackPopup();
        if (st === Sts.STATE.ASK) vm.answer("1");
        if (st === Sts.STATE.DONE) break;
      }
      const objs = vm.objects().map((o) => [o.kind, Math.round(o.x), Math.round(o.y)].join(","));
      vm.stop();
      return { err, objs };
    };
    const a = snap([], 60, 5);
    pass(a && !a.err, L("jalan 1 detik tanpa error", "runs for a second without errors") + (a && a.err ? " — " + a.err : ""));
    pass(a && a.objs.length > 0, L(`ada ${a ? a.objs.length : 0} objek di layar`, `${a ? a.objs.length : 0} objects on screen`));
    if (/\bmove\(|setpos\(/.test(code) && /forever/.test(code)) {
      const b = snap([], 20, 5);
      pass(a && b && a.objs.join("|") !== b.objs.join("|"), L("ada yang gerak sendiri", "something moves by itself"));
    }
    if (/key\("(left|right|up|down|space)"\)/.test(code)) {
      const c = snap(["right", "space"], 60, 5);
      pass(a && c && a.objs.join("|") !== c.objs.join("|"), L("mencet tombol ngubah sesuatu di layar", "pressing keys changes something on screen"));
    }
    // random play
    if (vm.compile(roots).ok) {
      vm.start(9);
      let err = null;
      for (let f = 0; f < 300 && !err; f++) {
        if (f % 9 === 0) vm.key(["left", "right", "up", "down", "space"][f % 5], f % 18 === 0);
        if (f % 40 === 10) vm.click(60 + (f * 7) % 400, 80 + (f * 13) % 240);
        const st = vm.tick(16);
        if (st === Sts.STATE.ERROR) err = vm.runtimeError() || "runtime error";
        if (st === Sts.STATE.POPUP) vm.ackPopup();
        if (st === Sts.STATE.ASK) vm.answer("1");
        if (st === Sts.STATE.DONE) break;
      }
      vm.stop();
      pass(!err, L("dimainin acak 5 detik: ga ada error", "5 seconds of random play: no errors") + (err ? " — " + err : ""));
    }
  }

  // ------------------------------------------------------------------ STS questions (docs)
  function docSections(md) {
    return md.split(/\n## /).slice(1).map((s) => { const [head, ...rest] = s.split("\n"); return { head, body: rest.join("\n").trim() }; });
  }

  class StsCoder {
    constructor(opts = {}) {
      this.reader = opts.coderModel ? new RequestReader(opts.coderModel) : null;
      this.kb = new Knowledge(opts.things || { things: [] });
      this.vm = opts.vm || null;
      this.docs = opts.docs ? docSections(opts.docs).map((d) => Object.assign(d, { vec: Lib.featurize(d.head + " " + d.head + " " + d.body, 4096) })) : [];
      this.search = opts.search || null;
      this.fetch = opts.fetch || undefined;
      this.rand = opts.rand || Math.random;
      this.last = null;
      this.cache = new Map();
      this.neural = opts.neuralModel ? new (root.StsNeuralLib || require("./stsneural.js")).NeuralCoder(opts.neuralModel) : null;
    }

    _askDocs(text) {
      if (!this.docs.length) return null;
      const t = text.toLowerCase();
      if (!/\b(apa itu|gimana|bagaimana|cara|caranya|jelasin|what is|how (do|to|can)|explain|kenapa|why|artinya|maksudnya|fungsi)\b/.test(t)) return null;
      if (/\b(bikin(in)?|buat(in)?|make|create|build|write|generate|kodein)\b.*\b(game|program|aplikasi|app|kode|code|kuis|quiz)\b/.test(t)) return null;
      const v = Lib.featurize(text, 4096);
      let best = null, bs = 0;
      for (const d of this.docs) { let s = 0; for (const [k, x] of v) { const y = d.vec.get(k); if (y) s += x * y; } if (s > bs) { bs = s; best = d; } }
      return best && bs > 0.12 ? best : null;
    }

    /** look a thing up: wikipedia (if allowed) + offline knowledge */
    _page(word, lang, useSearch) {
      if (!useSearch || !this.search || this.cache.has(word)) return Promise.resolve(null);
      const kb = this.kb.find(word);
      return Promise.resolve().then(() => (this.search.research || this.search.answer)(kb && kb.fuzzy ? kb.name : word, lang, this.fetch, { timeoutMs: 6000 })).catch(() => null);
    }
    async _research(word, lang, useSearch, say, pending) {
      const L = (a, b) => (lang === "en" ? b : a);
      if (this.cache.has(word)) { const c = this.cache.get(word); say("   · " + word + ": " + L("udah gw riset tadi", "already researched") + " → " + (CATS[c.cat] || CATS.object)[lang === "en" ? "en" : "id"]); return c; }
      const out = { cat: null };
      const kb = this.kb.find(word);
      if (kb) Object.assign(out, { cat: kb.entry.cat, color: kb.entry.color, shape: kb.entry.shape, size: kb.entry.size, kbName: kb.name });
      if (kb && kb.fuzzy) say("   · '" + word + "' " + L("ga ada di database, maksudnya '" + kb.name + "'?", "isn't in my database, did you mean '" + kb.name + "'?"));
      let page = await (pending || this._page(word, lang, useSearch));
      if (page && !(page.text || page.extract)) page = null;
      if (page) {
        const text = page.text || page.extract;
        const read = readText(text);
        const first = (sentencesOf(text)[0] || text).replace(/\s*\([^)]*\)/g, "");
        out.source = page.title + (page.lang ? " (" + page.lang + ".wikipedia)" : "");
        out.fact = first.length > 150 ? first.slice(0, 147) + "…" : first;
        say("   🔎 " + word + " → wikipedia \"" + page.title + "\": " + (out.fact.length > 110 ? out.fact.slice(0, 107) + "…" : out.fact));
        if (read.cat && (!out.cat || (read.cat !== out.cat && !(out.cat === "fruit" && read.cat === "food") && !(out.cat === "treasure" && read.cat === "space")))) {
          if (out.cat) say("     " + L("artikelnya lebih ke ", "the article leans ") + read.cat + L(", tapi database gw yakin ", ", but my database is sure it's ") + out.cat + L(", gw pake itu", ", going with that"));
          else out.cat = read.cat;
        }
        if (read.color && !out.color) out.color = read.color;
        if (read.harmful && /^(fish|animal|bird|insect)$/.test(out.cat)) { out.cat = "predator"; say("     " + L("artikelnya bilang bahaya, jadi gw anggep pemangsa", "the article says it's dangerous, so it's a predator")); }
        Object.assign(out, { fast: read.fast, slow: read.slow, big: read.big, small: read.small, harmful: read.harmful, hits: read.hits });
        const traits = [];
        if (read.hits.length) traits.push(L("kata kunci: ", "keywords: ") + read.hits.join(", "));
        if (read.fast) traits.push(L("cepet", "fast")); if (read.slow) traits.push(L("lambat", "slow"));
        if (read.big) traits.push(L("gede", "big")); if (read.harmful) traits.push(L("bahaya", "dangerous"));
        if (read.color) traits.push(L("warna ", "colour ") + colorName(read.color, lang));
        say("     → " + L("gw simpulin: ", "so it's: ") + ((CATS[out.cat] || CATS.object)[lang === "en" ? "en" : "id"]) + (traits.length ? " · " + traits.join(" · ") : ""));
      } else if (kb) {
        say("   📚 " + word + ": " + (useSearch && this.search ? L("wikipedia ga nemu, ", "wikipedia found nothing, ") : "") + L("dari database offline gw → ", "from my offline database → ") + (CATS[out.cat] || CATS.object)[lang === "en" ? "en" : "id"]);
      } else {
        say("   ? " + word + ": " + (useSearch && this.search ? L("ga ketemu di wikipedia maupun database gw. gw anggep benda biasa", "not on wikipedia or in my database. treating it as a plain object") : L("search mati & ga ada di database. gw anggep benda biasa", "search is off and it's not in my database. treating it as a plain object")));
      }
      if (!out.cat) out.cat = "object";
      this.cache.set(word, out);
      return out;
    }

    async handle(text, opts = {}) {
      const steps = [];
      const say = (s) => { steps.push(s); if (opts.onStep) opts.onStep(s); };
      // memory: "tadi kita bikin apa?"
      const low = text.toLowerCase();
      if (/\b(lagi|tadi|barusan|kita|terakhir)\b.{0,20}\b(bikin|buat|ngoding|ngerjain|bikinin)\b.{0,8}\b(apa|apaan)\b|\bwhat (are|were|did) (we|u|you) (making|building|make|build)\b|\b(project|program|game)(nya)? (apa|yang tadi)\b/.test(low)) {
        const id = !/\b(what|we|you|make|build)\b/.test(low);
        const L2 = (a, b) => (id ? a : b);
        if (!this.last) return { kind: "memory", steps, lang: id ? "id" : "en", text: L2("belum bikin apa-apa. lu aja belum nyuruh 🥀", "we haven't made anything yet. u haven't asked 🥀") };
        const l = this.last;
        const what = l.d && l.d.reasons ? l.d.reasons.slice(0, 4).join("; ") : [...(l.A.mech || [])].join(", ");
        return { kind: "memory", steps, lang: id ? "id" : "en", text: L2(`tadi kita bikin "${l.title || "game"}" (${l.file || "program.sts"}) dari request: "${l.A.raw}". isinya: ${what}. mau gw ubah apa? 🥀`,
          `we were making "${l.title || "a game"}" (${l.file || "program.sts"}) from: "${l.A.raw}". it has: ${what}. what should i change? 🥀`) };
      }
      if (/^\s*(\/new|\/reset|mulai (dari )?(baru|awal)|bikin (yang )?baru aja|start over|new project)\s*$/.test(low)) {
        this.last = null;
        return { kind: "memory", steps, lang: /start|new project/.test(low) ? "en" : "id", text: /start|new project/.test(low) ? "ok, fresh start. memory wiped 🥀" : "ok, mulai dari nol. memori project gw hapus 🥀" };
      }
      const doc = this._askDocs(text);
      if (doc) {
        say("ini pertanyaan soal bahasa STS, bukan minta dibikinin. gw buka docs STS: \"" + doc.head + "\"");
        return { kind: "docs", steps, head: doc.head, body: doc.body };
      }
      const useSearch = opts.search !== false;
      const lower = " " + text.toLowerCase() + " ";
      // what does the user want? a NEW program, an EDIT of the last one, or a QUESTION about it
      const act = this._intent(text, lower);
      if (act === "new" && this.last) { say(/\b(new|another|start|from scratch)\b/.test(lower) ? "0. new program: the old one is put aside" : "0. bikin baru: project yang tadi gw tutup dulu"); this.last = null; }
      if (act === "explain") return this._explain(lower, steps);
      const isEdit = act === "edit", shortFollow = false;
      let A = analyze(text, this.reader, this.kb, { experimental: opts.experimental });
      const L = (a, b) => (A.lang === "en" ? b : a);
      say(L("1. baca permintaan", "1. reading the request") + (isEdit || shortFollow ? L(` (ngedit "${this.last.title || "program"}" yang tadi)`, ` (editing "${this.last.title || "the program"}" from before)`) : ""));
      for (const n of A.notes) say("   ~ " + n);
      if (isEdit || shortFollow) A = this._merge(this.last.A, A, lower);
      const mechs = [...A.mech];
      if (mechs.length) say(L("   jenis: ", "   kind: ") + mechs.map((f) => f + " (" + (A.why[f] || L("lanjutan", "kept")) + ")").join(", "));
      if (A.things.length) say(L("   benda yang lu sebut: ", "   things u mentioned: ") + A.things.map((th) => th.word + (th.roles.length ? " [" + th.roles.join("/") + "]" : "") + (th.count ? " ×" + th.count : "") + (th.color ? " " + colorName(th.color, A.lang) : "")).join(", "));
      if (!mechs.length && !A.things.length) say(L("   ga ada yang gw kenal. gw tebak lu mau gambar", "   nothing i recognise. guessing u want a drawing"));

      // nothing it recognises: the words themselves might be a game it can read about
      const nothing = !A.game && ![...A.mech].some((f) => !/^(score|countdown|lives)$/.test(f)) && !A.things.length;
      if (nothing && !A.gameName) {
        const phrase = A.t.replace(/\b(bikin\w*|buat\w*|tolong|dong|aja|deh|make|create|build|me|a|an|the|please|pls|program|aplikasi|app|kode|code|sts|game|permainan|yang|yg)\b/g, " ").replace(/\s+/g, " ").trim();
        if (phrase.length >= 3) A.gameName = phrase.split(" ").slice(0, 3).join(" ");
      }
      // a game it does not know by name: read what that game is first
      if (!A.game && A.gameName && !this.kb.find(A.gameName.split(" ")[0]) && ![...A.mech].some((f) => !/^(score|countdown|lives|shapes)$/.test(f))) {
        const cant = await this._learnGame(A, useSearch, say);
        if (cant) return { kind: "cant", steps, text: cant, lang: A.lang };
      }
      // research
      const know = {};
      const words = A.things.map((th) => th.word).slice(0, 6);
      if (words.length || (A.mech.has("quiz") && A.topic)) say(L("2. riset dulu", "2. research first") + (useSearch && this.search ? L(" (wikipedia + database gw)", " (wikipedia + my database)") : L(" (search mati, cuma database offline)", " (search is off, offline database only)")));
      for (const th of A.things) if (th.hero) { know[th.word] = { cat: "person", source: th.hero, color: "#feae34" }; this.cache.set(th.word, know[th.word]); }
      const pending = words.map((w) => (know[w] ? Promise.resolve(null) : this._page(w, A.lang, useSearch)));
      for (let i = 0; i < words.length; i++) if (!know[words[i]]) know[words[i]] = await this._research(words[i], A.lang, useSearch, say, pending[i]);
      // defaults the design may add (koin, meteor...) come from the offline base only
      for (const w of ["koin", "coin", "apel", "apple", "meteor", "alien", "zombie", "tikus", "mouse", "finish", "pipa", "pipe", "batu", "rock", "peluru", "bullet", "raket", "ikan", "udang", "cacing", "bunga", "anjing", "kucing"]) if (!know[w]) { const k = this.kb.find(w); if (k) know[w] = { cat: k.entry.cat, color: k.entry.color, shape: k.entry.shape, size: k.entry.size }; }
      if (A.mech.has("quiz")) know.__quiz = await this._quiz(A, useSearch, say);
      // not sure what was meant? ask (with 2-4 choices) instead of guessing
      if ((opts.asked || 0) < 2) {
        const qn = this._clarify(A, know, opts);
        if (qn) { say(L("   ❓ gw kurang yakin, mending gw tanya dulu", "   ❓ not sure, better to ask first")); return Object.assign({ kind: "ask", steps, lang: A.lang }, qn); }
      }
      if (!A.mech.size && A.things.length && A.things.every((th) => !th.roles.length)) A.things[0].topic = true;   // "kucing sama anjing" -> a game about them
      if (!A.mech.size && !A.things.length) {
        say(L("   gw ga nemu apa yang mau dibikin, jadi gw ga mau asal ngarang", "   i couldn't work out what to build, so i won't just make something up"));
        return { kind: "cant", steps, lang: A.lang, text: L("jujur gw ga ngerti lu mau bikin apa. jelasin gamenya: siapa yang lu mainin, ada apa aja, ngapain (ngumpulin, ngehindar, nembak, lompat, nebak...), menang/kalahnya gimana. contoh: \"game kucing ngumpulin ikan, dikejar anjing, 3 nyawa\" 🥀",
          "honestly i don't get what u want to build. describe the game: who u play as, what's in it, what u do (collect, dodge, shoot, jump, guess...), how u win or lose. e.g. \"a cat collecting fish while a dog chases it, 3 lives\" 🥀") };
      }

      if (opts.neural && this.neural) return this._neural(A, know, steps, say, opts);
      say(L("3. desain", "3. design"));
      const d = design(A, know, this.rand);
      for (const r of d.reasons) say("   - " + r);
      say(L("4. nulis kode STS dari desain itu", "4. writing STS code for that design"));
      const prog = Gen.write(d, { rand: this.rand });
      const name = camel(prog.title).slice(0, 24) || "sybauGame";
      const loc = prog.roots.reduce((s, r) => s + r.code.split("\n").length, 0);
      const defs = (prog.roots[0].code.match(/^def /gm) || []).length;
      say(L(`   ${loc} baris, ${defs} fungsi`, `   ${loc} lines, ${defs} functions`));
      let compiled = null;
      const fixes = [];
      let tests = [];
      if (this.vm) {
        say(L("5. compile pake compiler STS asli (sts.wasm)", "5. compiling with the real STS compiler (sts.wasm)"));
        for (let attempt = 1; attempt <= 8; attempt++) {
          const res = this.vm.compile(prog.roots);
          if (res.ok) { say(L("   attempt ", "   attempt ") + attempt + L(": lolos ✓", ": passed ✓")); compiled = true; break; }
          say("   attempt " + attempt + ": error " + L("baris ", "line ") + res.line + ": " + res.error);
          const fix = repair(prog.roots, res);
          fixes.push(fix);
          say("   → " + fix);
        }
        if (compiled && !fixes.length) {
          say(L("6. ngetes kelakuannya (game-nya dijalanin tanpa layar)", "6. testing the behaviour (running it head-less)"));
          tests = selfTest(this.vm, d, this.rand, say);
          const bad = tests.filter((x) => !x.ok).length;
          compiled = tests.some((x) => !x.ok && /error/.test(x.msg)) ? "runtime" : true;
          say(bad ? L(`   ${bad} tes gagal. kodenya tetep gw kasih, tapi jujur bagian itu belum bener`, `   ${bad} tests failed. here's the code anyway, but honestly that part isn't right yet`) : L(`   semua ${tests.length} tes lolos`, `   all ${tests.length} tests passed`));
        } else if (compiled) {
          const run = Sts.smokeRun(this.vm, prog.roots, { frames: 180 });
          compiled = run.ok ? true : "runtime";
          say(run.ok ? L("6. tes jalanin: aman", "6. test run: fine") : L("6. runtime error: ", "6. runtime error: ") + run.error);
        } else say(L("   nyerah setelah 8 kali benerin", "   gave up after 8 fixes"));
      }
      const sts = toSts(prog, name);
      this.last = { A, d, sts, title: prog.title, file: name + ".sts" };
      return { kind: "code", steps, program: prog, design: d, sts, file: name + ".sts", compiled, fixes, tests, features: [...A.mech], lang: A.lang };
    }

    /** new | edit | explain : read the user's intent before anything else */
    _intent(text, lower) {
      const NEW = /\b(bikin(in)?|buat(in)?|make|create|build)\b.{0,25}\b(baru|lain|yang lain|new|another|different)\b|\b(game|program|project) (baru|lain|yang lain)\b|\b(new|another|different) (game|program|one)\b|\b(hapus|buang|delete|scrap|lupain|forget)\b.{0,30}\b(bikin|buat|make|ganti|create)\b|\b(ganti|switch)\b.{0,12}\b(game|jadi game|ke game)\b|\bmulai (dari )?(baru|awal|nol)\b|\bstart over\b|\bfrom scratch\b|\bdari nol\b/;
      const FULL = /^\s*(tolong |pls |coba )?(bikin(in)?|buat(in)?|make|create|build|gw mau|aku mau|i want)\b.{0,20}\b(game|kuis|quiz|program|aplikasi|app|kalkulator|calculator|tictactoe|snake|pong|maze|labirin|clicker)\b/;
      const EDIT = /\b(tambah\w*|add|ganti\w*|ubah\w*|change|jadiin|hapus\w*|remove|tanpa|without|make it|lebih|kurang\w*|buang|kasih|benerin|fix|perbaiki|cepetin|lambatin|gedein|kecilin|warnanya|musuhnya|nyawanya|waktunya)\b/;
      const ASK = /^\s*(gimana|bagaimana|kenapa|kok|apa|how|why|what)\b.{0,40}\b(main(nya)?|kontrol\w*|control\w*|menang|kalah|play|win|lose|ini|itu|game(nya)?|kode(nya)?|code)\b.*\??$|\bcara main\w*\b|\bhow (do|to) (i )?play\b|^\s*(kenapa|kok|why|what does|apa fungsi)\b.*$/;
      if (!this.last) return "new";
      if (NEW.test(lower)) return "new";
      if (ASK.test(lower) && !EDIT.test(lower)) return "explain";
      if (EDIT.test(lower) && !FULL.test(lower)) return "edit";
      if (FULL.test(lower)) return "new";
      // short follow-ups ("musuhnya 5", "lebih cepet") edit; a long new description is a new program
      return text.trim().split(/\s+/).length <= 6 ? "edit" : "new";
    }

    /** questions about the program we just made */
    _explain(lower, steps) {
      const id = !/\b(how|why|what|play|win|lose)\b/.test(lower);
      const L = (a, b) => (id ? a : b), l = this.last;
      const lines = [];
      if (l.d && l.d.help) lines.push(L("kontrol: ", "controls: ") + l.d.help);
      if (l.d && l.d.reasons) lines.push(...l.d.reasons.slice(0, 6));
      if (!lines.length) {
        const code = l.sts || "";
        if (/key\("left"\)|key\("right"\)/.test(code)) lines.push(L("gerak pake panah / wasd", "move with the arrows / wasd"));
        if (/key\("space"\)/.test(code)) lines.push(L("spasi buat aksi (lompat / nembak)", "space for the action (jump / shoot)"));
        if (/onclick/.test(code)) lines.push(L("ada yang bisa diklik", "some things can be clicked"));
        if (/nyawa/.test(code)) lines.push(L("ada nyawa, abis = kalah", "u have lives, none left = game over"));
        if (/countdown/.test(code)) lines.push(L("ada batas waktu", "there's a time limit"));
        if (/cekMenang|tamat\("MENANG/.test(code)) lines.push(L("ada target skor buat menang", "there's a target score to win"));
      }
      return { kind: "memory", steps, lang: id ? "id" : "en", text: L(`soal "${l.title || "program"}" yang tadi: `, `about "${l.title || "the program"}": `) + (lines.join(" · ") || L("gw ga yakin, jalanin aja terus liat 🥀", "not sure, just run it and see 🥀")) + " 🥀" };
    }

    /** memory that survives a reload (code.js keeps it in localStorage) */
    saveState() {
      if (!this.last) return null;
      const l = this.last;
      return { A: Object.assign({}, l.A, { mech: [...l.A.mech] }), reasons: l.d && l.d.reasons, sts: l.sts, title: l.title, file: l.file, neural: !!l.neural };
    }
    loadState(st) {
      if (!st || !st.A) return;
      const A = Object.assign({}, st.A, { mech: new Set(st.A.mech || []) });
      this.last = { A, d: st.reasons ? { reasons: st.reasons } : null, sts: st.sts, title: st.title, file: st.file, neural: st.neural };
    }

    /** a question with 2-4 choices when the request is unclear (always when nothing is understood, more often in deepthink) */
    _clarify(A, know, opts) {
      const L = (a, b) => (A.lang === "en" ? b : a);
      const deep = !!opts.deepthink, m = A.mech;
      const gameMech = [...m].filter((f) => !/^(score|countdown|lives|shapes)$/.test(f));
      if (!gameMech.length && !A.things.length) return { question: L("lu mau bikin apa?", "what do u want to build?"), options: [
        { label: L("game hindarin musuh", "a dodging game"), add: L("game hindarin meteor", "a game where u dodge meteors") },
        { label: L("game ngumpulin barang", "a collecting game"), add: L("game ngumpulin koin", "a game where u collect coins") },
        { label: "tic tac toe", add: "tictactoe" }, { label: L("kuis", "a quiz"), add: L("kuis matematika 5 soal", "maths quiz 5 questions") }] };
      if (deep && m.has("tictactoe") && !A.twoPlayer && !/komputer|computer|\bai\b|bot/.test(A.t)) return { question: L("tic tac toe lawan siapa?", "tic tac toe against who?"), options: [
        { label: L("lawan komputer", "vs the computer"), add: L("lawan komputer", "vs computer") }, { label: L("2 pemain (gantian)", "2 players"), add: L("2 pemain", "2 players") }] };
      const loose = A.things.filter((th) => !th.roles.length && !th.hero);
      if (!gameMech.length && loose.length && (deep || loose.length > 1)) {
        const w = loose[0].word;
        return { question: L(`'${w}' itu apa di game-nya?`, `what is the '${w}' in the game?`), options: [
          { label: L("yang gw mainin", "the one i play"), add: L("jadi " + w, "play as " + w) }, { label: L("musuh, dihindarin", "an enemy to dodge"), add: L("hindarin " + w, "dodge " + w) },
          { label: L("barang, dikumpulin", "an item to collect"), add: L("kumpulin " + w, "collect " + w) }, { label: L("target, ditembak", "a target to shoot"), add: L("tembak " + w, "shoot " + w) }] };
      }
      if (!deep) return null;
      const unknown = A.things.find((th) => !th.roles.length && (!know[th.word] || (know[th.word].cat === "object" && !know[th.word].source)));
      if (unknown) return { question: L(`gw ga nemu apa itu '${unknown.word}'. di game-nya dia apa?`, `i couldn't find what '${unknown.word}' is. what is it in the game?`), options: [
        { label: L("musuh", "an enemy"), add: L("hindarin " + unknown.word, "dodge " + unknown.word) }, { label: L("barang", "an item"), add: L("kumpulin " + unknown.word, "collect " + unknown.word) },
        { label: L("pemain", "the player"), add: L("jadi " + unknown.word, "play as " + unknown.word) }] };
      const harmful = m.has("dodge") || m.has("chase") || m.has("shoot") || A.things.some((th) => th.roles.includes("enemy") || th.roles.includes("chaser"));
      if (harmful && !A.lives && !A.noLives && !A.seconds && !m.has("survive")) return { question: L("kalahnya gimana?", "how do u lose?"), options: [
        { label: L("3 nyawa", "3 lives"), add: L("pake 3 nyawa", "with 3 lives") }, { label: L("sekali kena langsung kalah", "one hit and it's over"), add: L("sekali kena langsung kalah", "one hit") },
        { label: L("bertahan 30 detik", "survive 30 seconds"), add: L("bertahan 30 detik", "survive 30 seconds") }] };
      if (m.has("quiz") && !A.topic) return { question: L("kuisnya soal apa?", "a quiz about what?"), options: [
        { label: L("matematika", "maths"), add: L("matematika", "maths") }, { label: L("sejarah indonesia", "indonesian history"), add: L("tentang majapahit", "about the roman empire") },
        { label: L("tata surya", "the solar system"), add: L("tentang tata surya", "about the solar system") }] };
      return null;
    }

    /** the code transformer writes the program itself, token by token */
    async _neural(A, know, steps, say, opts) {
      const L = (a, b) => (A.lang === "en" ? b : a);
      const { slots, prefix } = buildPrefix(A, know);
      const unk = this.neural.unknown(prefix.slice(1, prefix.indexOf("</req>"))).filter((w) => !/^<t\d>$/.test(w));
      say(L(`3. transformer nulis kodenya sendiri, token per token (${(this.neural.params / 1e6).toFixed(1)} juta parameter, tanpa desain/template)`, `3. the transformer writes the code itself, token by token (${(this.neural.params / 1e6).toFixed(1)}M params, no design/template)`));
      say("   input: " + prefix.join(" "));
      if (unk.length) say(L("   kata yang belum pernah dia liat: ", "   words it has never seen: ") + unk.join(", ") + L(" (dia tetep nyoba dari sisa kalimat + riset)", " (it still tries, from the rest + the research)"));
      let best = null;
      const tries = opts.deepthink ? 6 : 3, temps = opts.deepthink ? [0.2, 0.35, 0.45, 0.55, 0.65, 0.8] : [0.25, 0.45, 0.65];
      if (opts.deepthink) say(L(`   🧠 deepthink: nulis sampe ${tries} versi, tiap versi dicek compiler, dites, terus dinilai kritikus (beneran sesuai request ga?)`, `   🧠 deepthink: up to ${tries} versions, each compiled, tested and judged by a critic (does it really do what was asked?)`));
      for (let attempt = 1; attempt <= tries; attempt++) {
        const t0 = Date.now();
        const w = await this.neural.write(prefix, slots, { rand: this.rand, temperature: temps[attempt - 1] || 0.6, onToken: opts.onCode ? (toks) => opts.onCode(attempt, toks, slots) : null });
        const roots = [{ index: 0, name: "main", code: w.code }];
        const lines = w.code.split("\n").length;
        say(L(`   percobaan ${attempt}: nulis ${w.tokens.length} token (${lines} baris) dalam ${((Date.now() - t0) / 1000).toFixed(1)}s`, `   attempt ${attempt}: wrote ${w.tokens.length} tokens (${lines} lines) in ${((Date.now() - t0) / 1000).toFixed(1)}s`));
        const fixes = [];
        let compiled = false;
        if (this.vm) {
          for (let k = 0; k < 16; k++) {
            const res = this.vm.compile(roots);
            if (res.ok) { compiled = true; break; }
            const fix = repair(roots, res);
            fixes.push(fix);
            say("     ✎ " + L("baris ", "line ") + res.line + ": " + res.error + " → " + fix);
          }
        }
        const tests = [];
        if (compiled) {
          say(L("     compiler STS: lolos ✓" + (fixes.length ? ` (setelah ${fixes.length} benerin)` : ""), "     STS compiler: passed ✓" + (fixes.length ? ` (after ${fixes.length} fixes)` : "")));
          genericTests(this.vm, roots, L, (ok, msg) => { tests.push({ ok, msg }); say("     " + (ok ? "✓ " : "✗ ") + msg); });
        } else if (this.vm) say(L("     ga lolos compiler", "     didn't compile"));
        // relevance: does the program actually use what was asked for?
        const low = w.code.toLowerCase();
        const used = slots.filter((x) => low.includes(String(x.key).toLowerCase())).length;
        const words = A.t.trim().split(/\s+/).filter((x) => x.length > 3 && !/^(bikin|game|buat|yang|pake|dong|make|with|the)$/.test(x));
        const echoed = words.filter((x) => low.includes(x)).length;
        const relevance = used * 3 + Math.min(4, echoed);
        if (slots.length || words.length) say(L(`     relevan: ${used}/${slots.length} benda dipake, ${echoed}/${words.length} kata request muncul`, `     relevance: ${used}/${slots.length} things used, ${echoed}/${words.length} request words appear`));
        const cr = critic(roots[0].code, A.mech);
        if (cr.want.length) say(L(`     kritikus: ${cr.have.length}/${cr.want.length} yang diminta ada`, `     critic: ${cr.have.length}/${cr.want.length} of what was asked is there`) + (cr.missing.length ? L(" (kurang: ", " (missing: ") + cr.missing.join(", ") + ")" : " ✓"));
        const score = (compiled ? 10 : 0) + tests.filter((x) => x.ok).length * 2 - fixes.length - (tests.some((x) => !x.ok) ? 3 : 0) + relevance + cr.have.length * 4 - cr.missing.length * 6;
        if (!best || score > best.score) best = { roots, tests, fixes, compiled, score, attempt, cr };
        if (compiled && tests.every((x) => x.ok) && !cr.missing.length && used === slots.length && (opts.deepthink ? fixes.length <= 1 : !fixes.length)) break;
      }
      // nothing it wrote does what was asked: say so and let the user choose, instead of handing over a wrong game
      if (best.cr && best.cr.missing.length === best.cr.want.length && best.cr.want.length && (opts.asked || 0) < 2) {
        say(L("   ✗ ga ada versi yang beneran sesuai request", "   ✗ none of the versions really does what was asked"));
        return { kind: "ask", steps, lang: A.lang, question: L(`jujur, transformer-nya belum bisa nulis ${best.cr.missing.join("/")} dengan bener. mau gimana?`, `honestly, the transformer can't write ${best.cr.missing.join("/")} properly yet. what now?`),
          options: [{ label: L("coba lagi (deepthink)", "try again (deepthink)"), retry: { deepthink: true } }, { label: L("pake perencana (pasti jalan)", "use the planner (works for sure)"), retry: { neural: false } },
            { label: L("kasih kode terbaiknya aja", "just give me the best attempt"), retry: { accept: true } }] , pendingBest: true, _keep: (this._pending = { best, A, steps }) && null };
      }
      return this._finishNeural(best, A, steps, say);
    }

    /** "just give me the best attempt" after an honest ask */
    acceptPending() {
      if (!this._pending) return null;
      const { best, A, steps } = this._pending;
      this._pending = null;
      return this._finishNeural(best, A, steps.slice(), () => {});
    }

    _finishNeural(best, A, steps, say) {
      const L = (a, b) => (A.lang === "en" ? b : a);
      const title = ((best.roots[0].code.match(/draw text "([^"]{2,40})" 2\d/) || [])[1]) || "sybau neural";
      const prog = { roots: best.roots, stage: { w: 520, h: 360 }, title };
      const name = camel(title).slice(0, 24) || "sybauNeural";
      say(L(`   dipake: percobaan ${best.attempt}`, `   using attempt ${best.attempt}`));
      const sts = toSts(prog, name);
      this.last = { A, d: null, sts, neural: true, title, file: name + ".sts" };
      return { kind: "code", neural: true, steps, program: prog, design: null, sts, file: name + ".sts", compiled: best.compiled ? (best.tests.some((x) => !x.ok && / — /.test(x.msg)) ? "runtime" : true) : false, fixes: best.fixes, tests: best.tests, features: [...A.mech], lang: A.lang };
    }

    /** "game pacman": look the game up, then read its description like a request */
    async _learnGame(A, useSearch, say) {
      const L = (a, b) => (A.lang === "en" ? b : a);
      const name = A.gameName;
      if (!useSearch || !this.search) return null;
      say(L(`2. '${name}' itu game apa? gw baca dulu di wikipedia`, `2. what is '${name}'? reading about it on wikipedia first`));
      let page = null;
      try { page = await (this.search.research || this.search.answer)(name, A.lang, this.fetch, { timeoutMs: 6000 }); } catch (e) { page = null; }
      const text = page ? (page.text || page.extract || "") : "";
      if (!page || !/\b(permainan|game|olahraga|sport|arkade|arcade|teka.teki|puzzle)\b/i.test(text)) {
        say(page ? L(`   "${page.title}" bukan artikel soal game, jadi '${name}' gw anggep benda`, `   "${page.title}" isn't about a game, so '${name}' is a thing`) : L("   ga ketemu. lanjut pake yang gw ngerti", "   nothing found. going with what i understand"));
        return null;
      }
      const intro = sentencesOf(text).slice(0, 3).join(" ") || text.slice(0, 400);
      say(`   🔎 "${page.title}": ${intro.length > 160 ? intro.slice(0, 157) + "…" : intro}`);
      const lower = " " + intro.toLowerCase().replace(/(\w)-(\w)/g, "$1 $2") + " ";
      const g = findGame(lower);
      const nameWords = name.split(" ");
      A.things = A.things.filter((th) => !nameWords.includes(th.word));
      if (g) { A.game = g.name; A.mech = new Set([g.name]); A.why[g.name] = L("dari artikel", "from the article"); say(L(`   → ini ${g.name}, gw bisa bikin itu`, `   → that's ${g.name}, i can build that`)); return null; }
      // read the description with the same reader as a request
      const B = analyze(lower, null, this.kb, {});
      const GAMEY = ["maze", "collect", "dodge", "shoot", "chase", "catch", "flappy", "jump", "pong", "whack", "quiz", "guess", "dice", "clicker", "survive", "lives"];
      const got = GAMEY.filter((f) => B.mech.has(f));
      if (!got.length) {
        say(L("   → artikelnya ga nyebut mekanik yang gw bisa bikin", "   → the article names no mechanic i can build"));
        return L(`jujur aja: gw udah baca soal ${page.title} ("${intro.slice(0, 120)}…"), tapi gw belum bisa bikin game kayak gitu di STS. yang gw bisa: tictactoe, snake, suit, labirin, nembak, hindarin, ngumpulin, lompat, flappy, pong, kuis, clicker, sama campurannya. coba jelasin aturannya pake kata-kata itu 🥀`,
          `honestly: i read about ${page.title} ("${intro.slice(0, 120)}…") but i can't build that kind of game in STS yet. what i can do: tictactoe, snake, rock paper scissors, mazes, shooting, dodging, collecting, jumping, flappy, pong, quizzes, clickers and mixes of them. describe the rules with those words 🥀`);
      }
      for (const f of got) { A.mech.add(f); A.why[f] = L("dari artikel", "from the article"); }
      const titleWords = page.title.toLowerCase().split(/[\s-]+/);
      const roled = B.things.filter((th) => th.roles.length && !nameWords.includes(th.word) && !titleWords.includes(th.word) && th.word.length > 2 && !th.roles.includes("player")).slice(0, 3);
      for (const th of roled) if (!A.things.some((x) => x.word === th.word)) A.things.push(th);
      // the game's hero is the player, named after the game
      A.things.unshift({ word: nameWords.join(""), roles: ["player"], count: null, color: null, speed: 1, size: 1, hero: page.title });
      say(L("   → dari artikelnya: ", "   → from the article: ") + got.join(", ") + (roled.length ? " · " + roled.map((th) => th.word + " [" + th.roles.join("/") + "]" + (th.count ? " ×" + th.count : "")).join(", ") : ""));
      return null;
    }

    async _quiz(A, useSearch, say) {
      const L = (a, b) => (A.lang === "en" ? b : a);
      const n = clamp(A.questions || 5, 1, 10);
      const topic = A.topic;
      if (!topic || /\b(matematika|math|maths|hitung\w*|aritmatika|tambah\w*|kurang\w*|kali\w*|bagi|perkalian|penjumlahan|pengurangan|pembagian)\b/.test(topic + " " + A.t.replace(/\b\d+\s*(soal|pertanyaan|questions?)\b/, ""))) {
        if (topic && !/\b(matematika|math|maths|hitung\w*|aritmatika|perkalian|penjumlahan|pengurangan|pembagian)\b/.test(topic)) return this._quizFrom(topic, n, A, useSearch, say);
        say(L("   kuis matematika: soalnya gw itung sendiri, " + n + " soal", "   maths quiz: i compute the questions myself, " + n + " of them"));
        return { questions: mathQuiz(A, n, this.rand), source: null };
      }
      return this._quizFrom(topic, n, A, useSearch, say);
    }
    async _quizFrom(topic, n, A, useSearch, say) {
      const L = (a, b) => (A.lang === "en" ? b : a);
      let page = null;
      if (useSearch && this.search) {
        say(L("   🔎 kuis soal '" + topic + "': baca artikel wikipedia-nya dulu...", "   🔎 quiz about '" + topic + "': reading the wikipedia article first..."));
        try { page = await (this.search.research || this.search.answer)(topic, A.lang, this.fetch); } catch (e) { page = null; }
      }
      if (page && (page.text || page.extract)) {
        const text = page.text || page.extract;
        const qs = makeQuiz(page.title, text, n, A.lang, this.rand);
        say(L(`     → "${page.title}", ${sentencesOf(text).length} kalimat. dari situ gw bikin ${qs.length} soal (isian tahun/nama/angka + benar-salah)`, `     → "${page.title}", ${sentencesOf(text).length} sentences. made ${qs.length} questions from it (fill in year/name/number + true-false)`));
        if (qs.length) {
          qs.slice(0, 2).forEach((qq) => say("     · " + qq.prompt.slice(0, 90) + (qq.prompt.length > 90 ? "…" : "") + " → " + qq.answer));
          return { questions: qs, source: page.title };
        }
        say(L("     artikelnya kependekan buat dijadiin soal", "     the article is too short to make questions from"));
      } else say(useSearch && this.search ? L("   ga nemu artikel soal '" + topic + "'", "   couldn't find an article about '" + topic + "'") : L("   search mati, jadi gw ga bisa riset '" + topic + "'", "   search is off, so i can't research '" + topic + "'"));
      say(L("   jujur aja: gw ga punya bahan soal '" + topic + "', jadi soalnya matematika", "   honestly: i have nothing on '" + topic + "', so it's a maths quiz"));
      return { questions: mathQuiz(A, n, this.rand), source: null };
    }

    /** merge a follow-up into the last request */
    _merge(prev, A, lower) {
      const remove = /\b(hapus|remove|tanpa|without|buang|ilangin)\b/.test(lower);
      const out = Object.assign({}, prev, { raw: prev.raw + " · " + A.raw, t: prev.t + " " + A.t, mech: new Set(prev.mech), why: Object.assign({}, prev.why), notes: A.notes, things: prev.things.map((x) => Object.assign({}, x, { roles: x.roles.slice() })) });
      if (remove) {
        for (const f of A.mech) if (f !== "score") out.mech.delete(f);
        out.things = out.things.filter((x) => !A.t.includes(" " + x.word + " "));
        if (/\b(nyawa|lives)\b/.test(A.t)) { out.noLives = true; out.mech.delete("lives"); }
        return out;
      }
      for (const f of A.mech) if (f !== "shapes") { out.mech.add(f); out.why[f] = A.why[f]; }
      for (const th of A.things) {
        const old = out.things.find((x) => x.word === th.word);
        if (old) {
          if (th.color) old.color = th.color;
          if (th.count) old.count = /\blagi\b|\bmore\b/.test(A.t) ? Math.min(12, (old.count || 2) + th.count) : th.count;
          if (th.speed !== 1) old.speed = th.speed;
          if (th.size !== 1) old.size = th.size;
          for (const r of th.roles) if (!old.roles.includes(r)) old.roles.push(r);
        } else out.things.push(th);
      }
      // "ganti warna X jadi biru" / "X jadi merah"
      for (const old of out.things) {
        const m = A.t.match(new RegExp("\\b" + old.word + "\\b[a-z ]{0,20}?\\b(?:jadi|jd|to|into|warna)\\s+([a-z]+(?: [a-z]+)?)"));
        const col = m && findColors(" " + m[1] + " ")[0];
        if (col) old.color = col.hex;
      }
      for (const k of ["lives", "seconds", "goal", "questions", "price", "password", "title", "bg", "topic"]) if (A[k] != null && A[k] !== false) out[k] = A[k];
      if (A.stage.length) out.stage = A.stage;
      if (A.hard) { out.hard = true; out.easy = false; }
      if (A.easy) { out.easy = true; out.hard = false; }
      if (A.quotes.length) out.quotes = A.quotes;
      return out;
    }
  }

  const api = { StsCoder, analyze, design, makeQuiz, mathQuiz, readText, repair, toSts, RequestReader, Knowledge, editDistance, selfTest, camelKey: camel, buildPrefix, genericTests };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.StsCoderLib = api;
})(typeof self !== "undefined" ? self : this);
