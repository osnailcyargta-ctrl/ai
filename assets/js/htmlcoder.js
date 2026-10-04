/* htmlcoder.js — sybau code: writes HTML/JS/CSS games and apps with its own transformer.
 *
 *   what the user means    -> the code NLU (codenlu.js): new / add / setvar / replace /
 *                             remove / reset / undo / ask / chat, plus which words are things,
 *                             settings and values
 *   writing a new page     -> the code transformer (htmlneural.js) writes every token itself;
 *                             each attempt is run in a sandbox and must work (no JS errors,
 *                             something on screen) before it is shown
 *   changing the page      -> edits on the real code: a setting ("ubah speed jadi 10"), the
 *                             background colour, a thing for another ("ganti zombie jadi alien")
 *   questions              -> answered from the code itself (settings, controls, size)
 * No templates, no planner: if the transformer can't write it, it says so.
 */
(function (root) {
  "use strict";
  const Tok = root.HtmlTokLib || (typeof require === "function" ? require("./htmltok.js") : null);
  const Req = root.HtmlReqLib || (typeof require === "function" ? require("./htmlreq.js") : null);

  const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pick = (a, rand = Math.random) => a[Math.floor(rand() * a.length)];
  const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);

  const COLOR_WORDS = {
    merah: "#7a1c1c", red: "#7a1c1c", biru: "#1d3557", blue: "#1d3557", hijau: "#1b4332", green: "#1b4332", ijo: "#1b4332",
    kuning: "#7a6a12", yellow: "#7a6a12", ungu: "#3c1361", purple: "#3c1361", hitam: "#0b0b0b", black: "#0b0b0b", item: "#0b0b0b",
    putih: "#f1f1f1", white: "#f1f1f1", pink: "#7a2650", oranye: "#7a3b0c", orange: "#7a3b0c", jingga: "#7a3b0c",
    abu: "#3a3a3a", grey: "#3a3a3a", gray: "#3a3a3a", coklat: "#4a2f1b", cokelat: "#4a2f1b", brown: "#4a2f1b", emas: "#6b5a12", gold: "#6b5a12", cyan: "#0e5a66", tosca: "#0e5a66",
  };
  // which words mean which setting (the comments in the code are matched too)
  const SYN = [
    ["speed", "kecepatan", "cepet", "cepat", "laju", "fast", "slow", "lambat", "pelan", "ngebut"],
    ["lives", "nyawa", "hp", "darah", "health", "life", "hati", "nyawanya", "darahnya"],
    ["gravity", "gravitasi"],
    ["jump", "lompat", "lompatan", "loncat", "jumppower"],
    ["time", "waktu", "detik", "durasi", "lama", "timer", "seconds", "gametime", "menit"],
    ["goal", "target", "menang", "win", "winscore", "skor"],
    ["size", "ukuran", "besar", "gede", "kecil", "radius"],
    ["count", "jumlah", "banyak", "berapa", "total"],
    ["foe", "musuh", "enemy", "enemies", "lawan"],
    ["shot", "peluru", "tembakan", "bullet", "shot", "shuriken"],
    ["gap", "celah"], ["wind", "angin"], ["volume", "suara"], ["power", "kekuatan", "dorongan", "thrust", "power"],
  ];
  const ROLE_WORDS = { foe: ["musuh", "musuhnya", "enemy", "enemies", "lawan", "monster"], hero: ["pemain", "pemainnya", "player", "karakter", "karakternya", "hero", "tokoh", "tokohnya"], item: ["item", "itemnya", "barang", "makanan", "koinnya"], shot: ["peluru", "pelurunya", "senjata", "senjatanya", "weapon", "bullet"] };

  function splitName(n) { return (n.match(/[A-Z]?[a-z]+|\d+/g) || [n]).map((x) => x.toLowerCase()); }

  /** the settings block every page starts its script with: let speed = 4; // kecepatan pemain */
  function settings(html) {
    const out = [];
    const re = /^(\s*)let (\w+) = (-?\d+(?:\.\d+)?|"[^"]*"); \/\/ (.*)$/gm;
    let m;
    while ((m = re.exec(html))) out.push({ name: m[2], value: m[3], comment: m[4], index: m.index });
    return out;
  }
  function synOf(w) { const g = SYN.find((s) => s.includes(w)); return g ? g[0] : w; }

  function findSetting(html, words, things) {
    const list = settings(html);
    if (!list.length) return null;
    const want = words.map((w) => w.toLowerCase().replace(/nya$/, "")).filter((w) => w.length > 1);
    let best = null, bestScore = 0;
    for (const s of list) {
      const have = splitName(s.name).concat(s.comment.toLowerCase().match(/[a-z]+/g) || []);
      const haveSyn = new Set(have.map(synOf));
      let score = 0;
      for (const w of want) {
        if (have.includes(w)) score += 2;
        else if (haveSyn.has(synOf(w))) score += 1;
        else if (things.some((t) => t === w) && have.includes(w)) score += 1;
      }
      // "kecepatan" alone means the player's speed, the first speed setting
      if (score > bestScore) { best = s; bestScore = score; }
    }
    return bestScore > 0 ? best : null;
  }

  function parseValue(values, text) {
    for (const v of values) {
      if (/^\d+(?:[.,]\d+)?$/.test(v)) return { kind: "num", value: +v.replace(",", ".") };
      if (/^\d+x$/.test(v)) return { kind: "mul", value: +v.slice(0, -1) };
      if (COLOR_WORDS[v]) return { kind: "color", value: COLOR_WORDS[v], word: v };
    }
    const t = " " + String(text).toLowerCase() + " ";
    const num = t.match(/(?:jadi|ke|to|=|jadiin)\s*(-?\d+(?:[.,]\d+)?)\b/) || t.match(/\s(-?\d+(?:[.,]\d+)?)\s/);
    if (/\b(2x|dua kali|double|twice)\b/.test(t)) return { kind: "mul", value: 2 };
    if (/\b(3x|tiga kali|triple)\b/.test(t)) return { kind: "mul", value: 3 };
    if (/\b(setengah|half)\b/.test(t)) return { kind: "mul", value: 0.5 };
    if (num) return { kind: "num", value: +num[1].replace(",", ".") };
    for (const w of t.match(/[a-z]+/g) || []) if (COLOR_WORDS[w]) return { kind: "color", value: COLOR_WORDS[w], word: w };
    if (/\b(lebih cepet|lebih cepat|cepetin|faster|ngebut|kencengin)\b/.test(t)) return { kind: "mul", value: 1.5 };
    if (/\b(lebih lambat|lebih pelan|pelanin|slower|lambatin)\b/.test(t)) return { kind: "mul", value: 0.6 };
    if (/\b(gedein|naikin|tambahin|lebih tinggi|higher|more|increase|tambah)\b/.test(t)) return { kind: "mul", value: 1.5 };
    if (/\b(kecilin|turunin|kurangin|lower|less|decrease|kurang)\b/.test(t)) return { kind: "mul", value: 0.6 };
    return null;
  }

  function setSetting(html, s, val) {
    const re = new RegExp("^(\\s*let " + s.name + " = )(-?\\d+(?:\\.\\d+)?|\"[^\"]*\")(;)", "m");
    const old = +s.value;
    let nv = val.kind === "mul" ? old * val.value : val.value;
    if (Number.isInteger(old) && val.kind === "mul") nv = Math.max(1, Math.round(nv));
    nv = Math.round(nv * 1000) / 1000;
    return { html: html.replace(re, (m, a, v, c) => a + nv + c), from: s.value, to: String(nv) };
  }

  function setBackground(html, hex) {
    const reCanvas = /(canvas \{[^}]*?background: )(#[0-9a-fA-F]{3,6}|linear-gradient\([^)]*\)|radial-gradient\([^)]*\))/;
    const reBody = /(body \{[^}]*?background: )(#[0-9a-fA-F]{3,6}|linear-gradient\([^)]*\)|radial-gradient\([^)]*\))/;
    // a canvas game paints its own background every frame with fillStyle + fillRect(0, 0, ...)
    let out = html;
    if (reCanvas.test(out)) out = out.replace(reCanvas, (m, a) => a + hex);
    else if (reBody.test(out)) out = out.replace(reBody, (m, a) => a + hex);
    else return null;
    out = out.replace(/(ctx\.fillStyle = ")(#[0-9a-fA-F]{3,6})(";\s*\n\s*ctx\.fillRect\(0, 0, )/g, (m, a, c, b) => a + hex + b);
    return out;
  }

  class HtmlCoder {
    /** opts: {nlu, writers: [HtmlWriter], pool: things.json, check: async (html) => {ok, error}, chat: (text) => string} */
    constructor(opts) {
      this.nlu = opts.nlu;
      this.writers = (opts.writers || []).filter(Boolean);
      this.pool = opts.pool || {};
      this.check = opts.check || null;
      this.chat = opts.chat || null;
      this.state = { request: "", html: "", file: "", things: [], history: [] };
      const names = new Map();
      for (const [role, list] of Object.entries(this.pool)) for (const [id, en, emoji] of list) {
        for (const n of [id, en]) if (!names.has(n)) names.set(n, { name: n, role, emoji, id, en });
      }
      this.names = names;
    }
    get params() { return this.writers.reduce((n, w) => n + w.params, 0); }
    saveState() { const s = this.state; return { request: s.request, html: s.html, file: s.file, things: s.things, history: s.history.slice(-5) }; }
    loadState(s) { if (s && typeof s.html === "string") this.state = Object.assign({ request: "", html: "", file: "", things: [], history: [] }, s); }

    /** which things are in this page: names from the request, plus every known emoji in the code */
    thingsIn(html, request) {
      const found = [];
      for (const s of Req.slotsFor(request || "", [...this.names.keys()])) { const e = this.names.get(s.key); if (e) found.push({ name: s.key, emoji: e.emoji, role: e.role }); }
      for (const e of this.names.values()) {
        if (e.emoji.length > 1 && html.includes('"' + e.emoji + '"') && !found.some((f) => f.emoji === e.emoji)) {
          const word = [e.id, e.en].find((n) => new RegExp("\\b" + esc(n) + "\\b", "i").test(html)) || e.id;
          found.push({ name: word, emoji: e.emoji, role: e.role });
        }
      }
      return found;
    }

    /** the main entry: what does the user want? */
    async handle(text, o = {}) {
      const steps = [];
      const step = (s) => { steps.push(s); if (o.onStep) o.onStep(s); };
      const lang = o.lang || (/\b(the|make|with|and|change|what|how|please|game where)\b/i.test(text) ? "en" : "id");
      const id = lang === "id";
      const r = this.nlu ? this.nlu.read(text) : { intent: "new", confidence: 1, words: Req.words(text), tags: [], things: [], newThings: [], vars: [], values: [] };
      const has = !!this.state.html;
      let intent = r.intent;
      step((id ? "baca maksud lu: " : "reading what u mean: ") + intent + " (" + Math.round(r.confidence * 100) + "%)" +
        (r.things.length ? " · " + (id ? "benda: " : "things: ") + r.things.join(", ") : "") + (r.vars.length ? " · setting: " + r.vars.join(", ") : "") + (r.values.length ? " · " + (id ? "nilai: " : "value: ") + r.values.join(", ") : ""));
      // nothing to change yet -> it can only be a new page
      if (!has && ["add", "setvar", "replace", "remove", "undo"].includes(intent)) { intent = "new"; step(id ? "belum ada game, jadi gw bikin baru" : "no game yet, so i'll make a new one"); }
      if (intent === "reset") return this._reset(id);
      if (intent === "undo") return this._undo(id, step, steps);
      if (intent === "ask") return this._ask(text, r, id, steps);
      if (intent === "chat") return { kind: "chat", text: this.chat ? this.chat(text) : (id ? "oke. mau bikin apa?" : "ok. what should i build?"), steps, lang };
      if (intent === "setvar") return this._setvar(text, r, id, step, steps, o);
      if (intent === "replace") return this._replace(text, r, id, step, steps, o);
      if (intent === "remove") return this._remove(text, r, id, step, steps, o);
      if (intent === "add") {
        const req = this.state.request + " " + text;
        step((id ? "nambahin ke game yang ada: " : "adding to the current game: ") + "\"" + req + "\"");
        return this._write(req, r, id, step, steps, o, true);
      }
      return this._write(text, r, id, step, steps, o, false);
    }

    _reset(id) {
      if (this.state.html) this.state.history.push({ request: this.state.request, html: this.state.html, file: this.state.file });
      this.state = { request: "", html: "", file: "", things: [], history: this.state.history };
      return { kind: "memory", text: id ? "udah gw hapus semua. bersih. mau bikin apa sekarang?" : "deleted everything. clean slate. what now?", steps: [], lang: id ? "id" : "en" };
    }

    _undo(id, step, steps) {
      const prev = this.state.history.pop();
      if (!prev) return { kind: "memory", text: id ? "ga ada versi sebelumnya buat dibalikin" : "there's no previous version to go back to", steps, lang: id ? "id" : "en" };
      Object.assign(this.state, prev, { things: this.thingsIn(prev.html, prev.request) });
      step(id ? "balik ke versi sebelumnya" : "back to the previous version");
      return this._result(prev.html, id, steps, { undo: true, text: id ? "nih, udah gw balikin ke yang sebelumnya" : "there, back to the previous one" });
    }

    _ask(text, r, id, steps) {
      const html = this.state.html;
      if (!html) return { kind: "memory", text: id ? "belum ada kode. suruh gw bikin sesuatu dulu, contoh: \"game ninja vs zombie\"" : "there's no code yet. tell me to build something first, e.g. \"ninja vs zombie game\"", steps, lang: id ? "id" : "en" };
      const t = text.toLowerCase(), set = settings(html);
      const lines = html.split("\n").length;
      const keys = [];
      if (/Arrow(Left|Right|Up|Down)/.test(html)) keys.push(id ? "panah" : "arrow keys");
      if (/keys\[["']?[wasd]["']?\]|"w"|'w'/.test(html)) keys.push("WASD");
      if (/" "/.test(html) && /key/.test(html)) keys.push(id ? "spasi" : "space");
      if (/"Enter"/.test(html)) keys.push("Enter");
      if (/onclick|onmousedown|addEventListener\("click"|\.onclick/.test(html)) keys.push(id ? "klik mouse" : "mouse click");
      if (/onmousemove/.test(html)) keys.push(id ? "gerakin mouse" : "mouse move");
      const listSet = set.length ? set.map((s) => s.name + " = " + s.value + "  (" + s.comment + ")").join("\n") : (id ? "(ga ada settingan di atas kodenya)" : "(no settings at the top)");
      let answer;
      if (/variab|setting|atur|nilai|value|config/.test(t)) answer = (id ? "settingan yang bisa lu ubah (bilang aja \"ubah " + (set[0] ? set[0].name : "speed") + " jadi 10\"):\n" : "settings u can change (just say \"change " + (set[0] ? set[0].name : "speed") + " to 10\"):\n") + listSet;
      else if (/main|kontrol|control|tombol|key|gerak|play/.test(t)) answer = (id ? "kontrolnya: " : "controls: ") + (keys.length ? keys.join(", ") : (id ? "ga pake keyboard/mouse" : "no keyboard or mouse"));
      else if (/error|jalan|work|rusak|bug|kenapa|why/.test(t)) answer = this.state.lastCheck && !this.state.lastCheck.ok ? (id ? "error terakhir: " : "last error: ") + this.state.lastCheck.error : (id ? "pas gw tes ga ada error JavaScript. kalo ada yang aneh, bilang bagian mana (contoh: \"musuhnya diem\")" : "no JavaScript errors when i tested it. if something looks off, tell me which part");
      else if (/bahasa|language|html|css|javascript/.test(t)) answer = id ? "ini 1 file HTML: CSS buat tampilan (di <style>), JavaScript buat logika game (di <script>). " + lines + " baris" : "it's one HTML file: CSS for the looks (in <style>), JavaScript for the game logic (in <script>). " + lines + " lines";
      else {
        const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || "?";
        answer = (id ? "\"" + title + "\", dibikin dari request \"" + this.state.request + "\". " + lines + " baris HTML/CSS/JS.\nkontrol: " : "\"" + title + "\", made from \"" + this.state.request + "\". " + lines + " lines of HTML/CSS/JS.\ncontrols: ") +
          (keys.join(", ") || "-") + "\n" + (id ? "settingan:\n" : "settings:\n") + listSet;
      }
      return { kind: "answer", text: answer, steps, lang: id ? "id" : "en" };
    }

    _setvar(text, r, id, step, steps) {
      let html = this.state.html;
      const val = parseValue(r.values, text);
      if (val && val.kind === "color" && (/\b(background|latar|bg|warna|color|colour)\b/i.test(text) || !r.vars.length)) {
        const out = setBackground(html, val.value);
        if (!out) return { kind: "memory", text: id ? "gw ga nemu background di kode ini buat diganti" : "couldn't find a background in this code to change", steps, lang: id ? "id" : "en" };
        step((id ? "ganti background jadi " : "background -> ") + val.word + " (" + val.value + ")");
        return this._commit(out, id, steps, id ? "background udah jadi " + val.word : "background is " + val.word + " now");
      }
      const words = r.vars.join(" ").split(" ").concat(r.words.filter((w, k) => r.tags[k] === "V" || r.tags[k] === "O"));
      let s = findSetting(html, r.vars.length ? r.vars.join(" ").split(" ") : words, this.state.things.map((t) => t.name));
      if (!s && val && val.kind === "mul") s = settings(html).find((x) => /speed/i.test(x.name));
      if (!s) {
        const list = settings(html).map((x) => x.name + " (" + x.comment + ")").join(", ");
        return { kind: "memory", text: (id ? "gw ga nemu setting \"" + (r.vars.join(" ") || text) + "\" di kode ini. yang ada: " : "no setting called \"" + (r.vars.join(" ") || text) + "\" in this code. there is: ") + (list || "-"), steps, lang: id ? "id" : "en" };
      }
      if (!val || val.kind === "color") return { kind: "memory", text: id ? s.name + " sekarang " + s.value + ". mau diganti jadi berapa? contoh: \"" + s.name + " jadi 10\"" : s.name + " is " + s.value + " now. to what? e.g. \"" + s.name + " to 10\"", steps, lang: id ? "id" : "en" };
      const ch = setSetting(html, s, val);
      step("let " + s.name + " = " + ch.from + "  →  " + ch.to + "   // " + s.comment);
      return this._commit(ch.html, id, steps, id ? s.name + " (" + s.comment + ") udah gw ubah dari " + ch.from + " jadi " + ch.to : "changed " + s.name + " (" + s.comment + ") from " + ch.from + " to " + ch.to);
    }

    _target(r, words) {
      // a thing in the game, by name, or by what it is ("musuhnya" = the enemy)
      const things = this.state.things;
      for (const w of r.things.concat(words)) {
        const t = things.find((x) => x.name === w || x.name + "nya" === w || x.name + "s" === w);
        if (t) return t;
      }
      for (const w of words) for (const [role, list] of Object.entries(ROLE_WORDS)) {
        if (list.includes(w)) { const t = things.find((x) => x.role === role || (role === "foe" && x.role === "critter")); if (t) return t; }
      }
      return null;
    }

    _replace(text, r, id, step, steps) {
      const words = r.words;
      const old = this._target(r, words);
      const nw = (r.newThings[0] || r.things.find((x) => !old || x !== old.name) || "").toLowerCase();
      if (!old) return { kind: "memory", text: (id ? "yang mau diganti yang mana? di game ini ada: " : "replace which one? this game has: ") + (this.state.things.map((t) => t.emoji + " " + t.name).join(", ") || "-"), steps, lang: id ? "id" : "en" };
      if (!nw) return { kind: "memory", text: id ? old.name + " mau diganti jadi apa?" : "replace " + old.name + " with what?", steps, lang: id ? "id" : "en" };
      const e = this.names.get(nw);
      const emoji = e ? e.emoji : old.emoji;
      let html = this.state.html.replace(new RegExp("\\b" + esc(old.name) + "\\b", "gi"), (m) => (/^[A-Z]/.test(m) ? cap(nw) : nw));
      if (emoji !== old.emoji) html = html.split('"' + old.emoji + '"').join('"' + emoji + '"').split(old.emoji).join(emoji);
      step((id ? "ganti " : "replace ") + old.emoji + " " + old.name + " → " + emoji + " " + nw + (e ? "" : (id ? " (gw ga kenal \"" + nw + "\", jadi gambarnya tetep)" : " (don't know \"" + nw + "\", so the picture stays)")));
      this.state.request = this.state.request.replace(new RegExp("\\b" + esc(old.name) + "\\b", "gi"), nw);
      return this._commit(html, id, steps, id ? old.name + " udah jadi " + nw + " " + emoji : old.name + " is now a " + nw + " " + emoji);
    }

    async _remove(text, r, id, step, steps, o) {
      const words = r.words;
      const t = this._target(r, words);
      if (!t) {
        const what = r.things.join(" ") || words.filter((w) => !/^(hapus|hapusin|ilangin|buang|delete|remove|apus|the|dong|aja|nya)$/.test(w)).join(" ");
        return { kind: "memory", text: (id ? "ga ada \"" + what + "\" di game ini. isinya: " : "there's no \"" + what + "\" in this game. it has: ") + (this.state.things.map((x) => x.emoji + " " + x.name).join(", ") || "-") +
          (id ? ". kalo maksud lu hapus gamenya, bilang \"hapus semua\"" : ". if u mean delete the whole game, say \"delete everything\""), steps, lang: id ? "id" : "en" };
      }
      // taking a thing out changes how the game works, so the transformer writes it again without it
      const req = this.state.request.replace(new RegExp("\\b" + esc(t.name) + "\\w*\\b", "gi"), "").replace(/\s+/g, " ").trim() + (id ? " tanpa " : " without ") + t.name;
      step((id ? "nulis ulang tanpa " : "rewriting without ") + t.emoji + " " + t.name);
      return this._write(req, r, id, step, steps, o, true, t);
    }

    async _write(request, r, id, step, steps, o, keepHistory, removed) {
      if (!this.writers.length) return { kind: "cant", text: id ? "otak coding-nya belum ke-load" : "the coding brain didn't load", steps, lang: id ? "id" : "en" };
      const nameList = [...this.names.keys()].concat(r.things, r.newThings);
      let slots = Req.slotsFor(request, nameList);
      if (removed) slots = slots.filter((s) => s.key !== removed.name);
      const prefix = Req.prefix(request, slots);
      const w0 = this.writers[0];
      const unk = w0.unknown(prefix.filter((x) => !/^<t\d>$/.test(x)));
      step("prompt: " + prefix.join(" "));
      if (unk.length) step((id ? "kata yang belum pernah gw liat: " : "words i've never seen: ") + unk.join(", ") + (slots.length ? (id ? " (bendanya tetep gw salin)" : " (things still get copied)") : ""));
      const tries = o.deepthink ? 6 : 3;
      let best = null;
      for (let k = 0; k < tries; k++) {
        const writer = this.writers[k % this.writers.length];
        step((id ? "transformer nulis, percobaan " : "transformer writing, attempt ") + (k + 1) + "/" + tries + (this.writers.length > 1 ? " (" + writer.name + ")" : ""));
        const res = await writer.write(prefix, slots, { temperature: k === 0 ? 0.6 : 0.75 + 0.05 * k, topP: 0.92, rand: o.rand, onToken: o.onCode ? (toks) => o.onCode(k + 1, toks, slots) : null, signal: o.signal });
        const verdict = await this._verify(res, slots);
        step((verdict.ok ? "✓ " : "× ") + verdict.note);
        if (!best || verdict.score > best.verdict.score) best = { res, verdict };
        if (verdict.ok && verdict.score >= 3 && !o.deepthink) break;
        if (o.signal && o.signal.stop) break;
      }
      const { res, verdict } = best;
      if (!verdict.ok) {
        this.state.lastCheck = { ok: false, error: verdict.note };
        return { kind: "failed", text: id ? "jujur: transformer gw belum bisa nulis ini dengan bener (" + verdict.note + "). coba bilang dengan cara lain, atau yang lebih simpel" : "honestly: my transformer couldn't write this properly (" + verdict.note + "). try saying it differently, or something simpler", html: res.html, steps, lang: id ? "id" : "en" };
      }
      if (keepHistory && this.state.html) this.state.history.push({ request: this.state.request, html: this.state.html, file: this.state.file });
      else if (this.state.html) this.state.history.push({ request: this.state.request, html: this.state.html, file: this.state.file });
      this.state.request = request;
      this.state.lastCheck = { ok: true };
      return this._result(res.html, id, steps, { neural: true, request });
    }

    async _verify(res, slots) {
      const html = res.html;
      if (!res.closed) return { ok: false, score: 0, note: "halamannya ga selesai ditulis" };
      if (!/<script>[\s\S]*<\/script>/.test(html) && !/<body>[\s\S]*<\/body>/.test(html)) return { ok: false, score: 0, note: "ga ada isinya" };
      let score = 1;
      if (this.check) {
        const c = await this.check(html);
        if (!c.ok) return { ok: false, score: 0.5, note: "error pas dijalanin: " + c.error };
        score += 1;
      }
      // it should be about what was asked: the slot names / their pictures appear in the page
      const named = slots.filter((s) => new RegExp("\\b" + esc(s.key) + "\\b", "i").test(html) || (this.names.get(s.key) && html.includes(this.names.get(s.key).emoji))).length;
      score += slots.length ? named / slots.length : 1;
      return { ok: true, score, note: "jalan tanpa error" + (slots.length ? ", " + named + "/" + slots.length + " benda dari request ada di game" : "") };
    }

    async _commit(html, id, steps, text) {
      if (this.check) {
        const c = await this.check(html);
        if (!c.ok) return { kind: "memory", text: (id ? "abis diubah malah error (" : "that change breaks it (") + c.error + (id ? "), jadi ga gw pake" : "), so i didn't keep it"), steps, lang: id ? "id" : "en" };
      }
      this.state.history.push({ request: this.state.request, html: this.state.html, file: this.state.file });
      return this._result(html, id, steps, { edit: true, text });
    }

    _result(html, id, steps, extra) {
      const title = ((html.match(/<title>([^<]*)<\/title>/) || [])[1] || "game").trim();
      const file = (title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "game") + ".html";
      this.state.html = html;
      this.state.file = file;
      this.state.things = this.thingsIn(html, this.state.request);
      return Object.assign({ kind: "code", html, file, title, lines: html.split("\n").length, steps, lang: id ? "id" : "en", settings: settings(html) }, extra);
    }
  }

  const api = { HtmlCoder, settings, findSetting, parseValue, setSetting, setBackground };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HtmlCoderLib = api;
})(typeof self !== "undefined" ? self : this);
