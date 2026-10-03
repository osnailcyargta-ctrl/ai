/* app.js — the terminal UI. Brains live in brain.js + bot.js (+ grammar.js, search.js). */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const screen = $("screen"), input = $("input"), form = $("prompt");
  const suggestEl = $("suggest"), shortcutsEl = $("shortcuts"), hintEl = $("hint"), statusEl = $("status");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let bot = null, busy = false, interrupted = false;
  let storage = null;
  try { storage = window.localStorage; storage.getItem("x"); } catch (e) { storage = null; }
  const load = (k, d) => { try { const v = storage && storage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const save = (k, v) => { try { storage && storage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } };

  // ---------------------------------------------------------------- settings
  const settings = Object.assign({ lang: "auto", search: true, grammar: true, experimental: false, brain: false, theme: "auto" }, load("sybau_settings", {}));
  delete settings.learn; // old setting, removed
  const CONNECT_KEY = "sybau-ck-7f3a9c2e1b8d4f60a5e3"; // same everywhere, forever (see sdk/core.js)
  const SITE = location.origin + location.pathname.replace(/[^/]*$/, "");
  let learner = null, pixels = null, pending = null; // pending = last uploaded file
  const uiLang = () => (settings.lang === "en" ? "en" : "id");

  const T = {
    id: {
      welcome: "Selamat datang di sybau.ai!", sub: "ai yang benci lu. dilatih dari nol, tanpa api key.",
      help: "/help buat bantuan, /settings buat pengaturan", cwd: "cwd: ~/ur-life (cooked)",
      tipsHead: "Tips biar ga keliatan cupu:",
      tips: ["Tanya apa aja: \"ibukota kazakhstan\", \"berapa umur elon musk\"", "\"gambar kucing\" (beta, 16x16, masih bego)",
        "Upload file pake + file, terus /learn biar gw baca isinya", "/connect buat pake sybau di app lain", "Typo dikit, polisi grammar dateng", "Tab sc di atas = sybau code, buat bikin game/program STS"],
      placeholder: "Coba \"ibukota kazakhstan\" atau \"roast gw\"", hint: "? buat shortcut", busyHint: "esc buat stop",
      verbs: ["Roasting", "Nge-judge", "Masak lu", "Mikirin hinaan", "Aura farming", "Ngetawain lu", "Ngumpulin dendam", "Fanum tax", "Mewing", "Crash out", "Ngeliatin typo lu"],
      searching: "Nyari di Wikipedia + Wikidata", interrupted: "Dihentiin. bagus, gw juga males jawab",
      noResult: "Ga ketemu apa-apa", openGoogle: "buka di Google", readFull: "baca full",
      restored: (n) => "dipulihin " + n + " pesan · gw inget semuanya",
      unknownCmd: (c) => "Command ga dikenal: " + c + " · ketik /help",
      set: (k, v) => "Set " + k + " → " + v,
      sTitle: "Settings", sFoot: "↑↓ pilih · enter/spasi ganti · ←→ ganti · esc tutup",
      sExp: ["Eksperimental: pahamin semua kata", "kalo ga ngerti, mikir dulu: benerin typo, cari kalimat mirip, cari arti kata asing. masih beta"],
      thinking: "mikir", understanding: "Cari arti",
      sLang: ["Bahasa balesan", "auto = ngikutin bahasa lu"], sSearch: ["Auto search", "nanya fakta → otomatis cari di Wikipedia/Wikidata"],
      sGrammar: ["Polisi grammar", "roast typo & salah ejaan"], sBrain: ["Tampilin otak", "liat intent, confidence, bahasa (debug)"],
      sTheme: ["Tema", "auto ngikutin sistem"],
      sConnect: ["Connect key", "enter = liat key + kode buat app lain"],
      on: "on", off: "off", hate: "hate",
      drawing: "Ngegambar", reading: "Baca file", learning: "Belajar",
      learnHint: "ketik /learn NAMA buat gw pelajarin gambar ini (buat generator gambar)", learnHintText: "ketik /learn buat gw pelajarin file ini",
      nothingToLearn: "ga ada file buat dipelajarin. upload dulu (+ file / drag & drop / paste)",
      copied: "kesalin", copy: "salin", save: "simpen png",
      shortcuts: [["/", "buat command"], ["↑ ↓", "riwayat pesan"], ["esc", "stop jawaban"], ["tab", "lengkapin command"], ["ctrl + l", "bersihin layar"], ["shift + enter", "baris baru"]],
    },
    en: {
      welcome: "Welcome to sybau.ai!", sub: "the ai that hates u. trained from scratch, no api key.",
      help: "/help for help, /settings for settings", cwd: "cwd: ~/ur-life (cooked)",
      tipsHead: "Tips for getting started (and roasted):",
      tips: ["Ask anything: \"capital of kazakhstan\", \"how old is elon musk\"", "\"draw a cat\" (beta, 16x16, still dumb)",
        "Upload a file with + file, then /learn so i read it", "/connect to use sybau in other apps", "Make a typo and the grammar police shows up", "The sc tab up top = sybau code, it builds STS games/programs"],
      placeholder: "Try \"capital of kazakhstan\" or \"roast me\"", hint: "? for shortcuts", busyHint: "esc to interrupt",
      verbs: ["Roasting", "Judging", "Cooking u", "Yapping", "Aura farming", "Crashing out", "Fanum taxing", "Mewing", "Glazing (jk)", "Clowning", "Reading ur typos"],
      searching: "Searching Wikipedia + Wikidata", interrupted: "Interrupted by user. good, didn't wanna answer anyway",
      noResult: "No results", openGoogle: "open in Google", readFull: "read more",
      restored: (n) => "restored " + n + " messages · i remember everything",
      unknownCmd: (c) => "Unknown command: " + c + " · type /help",
      set: (k, v) => "Set " + k + " to " + v,
      sTitle: "Settings", sFoot: "↑↓ navigate · enter/space change · ←→ cycle · esc close",
      sExp: ["Experimental: understand any word", "when lost, think first: fix typos, find a similar sentence, look up unknown words. beta"],
      thinking: "thinking", understanding: "Look up",
      sLang: ["Reply language", "auto = match whatever u type"], sSearch: ["Auto search", "factual questions → look up Wikipedia/Wikidata"],
      sGrammar: ["Grammar police", "roast typos & bad spelling"], sBrain: ["Show brain", "intent, confidence, language (debug)"],
      sTheme: ["Theme", "auto follows ur system"],
      sConnect: ["Connect key", "enter = show key + code for other apps"],
      on: "on", off: "off", hate: "hate",
      drawing: "Drawing", reading: "Reading file", learning: "Learning",
      learnHint: "type /learn NAME so i learn this picture (for the image generator)", learnHintText: "type /learn so i learn this file",
      nothingToLearn: "nothing to learn. upload a file first (+ file / drag & drop / paste)",
      copied: "copied", copy: "copy", save: "save png",
      shortcuts: [["/", "for commands"], ["↑ ↓", "message history"], ["esc", "interrupt"], ["tab", "complete command"], ["ctrl + l", "clear screen"], ["shift + enter", "new line"]],
    },
  };
  const t = () => T[uiLang()];

  function applySettings() {
    if (bot) bot.settings = { lang: settings.lang, search: settings.search, grammar: settings.grammar, experimental: !!settings.experimental };
    if (settings.theme === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", settings.theme);
    document.body.classList.toggle("brain-on", !!settings.brain);
    document.documentElement.lang = uiLang();
    input.placeholder = t().placeholder;
    if (!busy) hintEl.textContent = t().hint;
    const mc = document.querySelector('meta[name="theme-color"]');
    if (mc) mc.content = getComputedStyle(document.body).getPropertyValue("--bg").trim() || "#100e0e";
    save("sybau_settings", settings);
    refreshStatus();
  }

  // ---------------------------------------------------------------- rendering
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  const atBottom = () => screen.scrollHeight - screen.scrollTop - screen.clientHeight < 80;
  function scrollDown(force) { if (force || atBottom()) screen.scrollTop = screen.scrollHeight; }
  function put(node) { const stick = atBottom(); screen.appendChild(node); if (stick) screen.scrollTop = screen.scrollHeight; return node; }

  function welcome() {
    const box = el("div", "welcome");
    const hi = el("div", "line");
    hi.append(el("span", "accent", "✻ "), el("span", "hi", t().welcome));
    box.append(hi, el("div", "line dim", "  " + t().sub), el("div", "gap"),
      el("div", "line dim", "  " + t().help), el("div", "gap"), el("div", "line dim", "  " + t().cwd));
    put(box);
    const tips = el("div", "tips");
    tips.appendChild(el("div", "line dim", t().tipsHead));
    t().tips.forEach((tip, i) => tips.appendChild(el("div", "line dim", (i + 1) + ". " + tip)));
    put(tips);
  }

  function userEcho(text) {
    const b = el("div", "u");
    b.append(el("span", "gt", ">"), document.createTextNode(text));
    return put(b);
  }

  function row(kind, dotChar) {
    const r = el("div", "block row " + (kind || ""));
    r.appendChild(el("span", "dot", dotChar || "●"));
    const body = el("div", "txt");
    r.appendChild(body);
    put(r);
    return { r, body };
  }

  function outBlock(parent, lines) {
    // lines: array of Node|string. first gets the ⎿ elbow
    const o = el("div", "out");
    lines.forEach((ln, i) => {
      o.appendChild(el("span", "elbow", i === 0 ? "⎿" : ""));
      const b = el("div", "body");
      if (typeof ln === "string") b.textContent = ln; else b.appendChild(ln);
      o.appendChild(b);
    });
    (parent || screen).appendChild(o);
    scrollDown();
    return o;
  }

  function metaNode(meta) {
    const m = el("div", "meta");
    const parts = ["intent=" + meta.intent];
    if (meta.confidence !== undefined) parts.push("p=" + (meta.confidence * 100).toFixed(0) + "%");
    if (meta.lang) parts.push("lang=" + meta.lang);
    parts.push("src=" + meta.source);
    m.textContent = parts.join(" · ");
    if (meta.novel) m.appendChild(el("span", "novel", "  ✦ new sentence (not in training data)"));
    return m;
  }

  async function typeText(node, text, animate) {
    if (!animate || reduced) { node.textContent = text; scrollDown(); return; }
    const words = text.split(/(\s+)/);
    const step = Math.max(8, Math.min(28, 900 / Math.max(1, words.length)));
    let shown = "";
    for (const w of words) {
      if (interrupted) break;
      shown += w;
      node.textContent = shown;
      scrollDown();
      await sleep(step);
    }
    node.textContent = interrupted ? shown : text;
  }

  async function botSay(text, meta, animate = true) {
    const kind = meta && meta.source === "safety" ? "safety" : "";
    const { r, body } = row(kind, meta && meta.source === "safety" ? "+" : "●");
    const span = el("span");
    body.appendChild(span);
    await typeText(span, text, animate);
    if (meta && meta.intent) body.appendChild(metaNode(meta));
    return r;
  }

  function sys(lines, kind) {
    const r = el("div", "block");
    outBlock(r, lines.map((l) => (typeof l === "string" ? el("span", kind || "dim", l) : l)));
    return put(r);
  }

  const GLYPHS = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];
  function spinner(label) {
    const r = el("div", "block line spin");
    const g = el("span", "glyph", "✻"), l = el("span", null, label + "…"), m = el("span", "meta-s", "");
    r.append(g, l, document.createTextNode(" "), m);
    put(r);
    const t0 = Date.now();
    let i = 0;
    const tick = () => {
      g.textContent = GLYPHS[i++ % GLYPHS.length];
      m.textContent = "(" + Math.floor((Date.now() - t0) / 1000) + "s · " + t().busyHint + ")";
    };
    tick();
    const id = setInterval(tick, 110);
    return { stop() { clearInterval(id); r.remove(); } };
  }

  function link(text, href) {
    const a = el("a", null, text);
    a.href = href; a.target = "_blank"; a.rel = "noopener";
    return a;
  }

  function renderSearch(res, query, understand) {
    const { r, body } = row("tool" + (res ? "" : " fail"));
    const head = el("span");
    head.append(el("span", "toolname", understand ? t().understanding : res && res.kind === "fact" ? "Wikidata" : "Search"), document.createTextNode("(" + query + ")"));
    body.appendChild(head);
    if (!res) {
      outBlock(body, [el("span", "red", t().noResult), linksLine(null, SearchLib.googleUrl(query))]);
      return r;
    }
    const lines = [];
    if (res.kind === "fact") {
      const a = el("span");
      a.append(el("span", "dim", res.relation + " " + res.subject + ": "), el("span", "wiki-title", res.answer));
      lines.push(a);
    } else {
      const head2 = el("span");
      head2.append(el("span", "wiki-title", res.title), el("span", "dim", "  wikipedia/" + res.lang));
      lines.push(head2);
    }
    if (res.extract) {
      const ex = el("span", "dim");
      if (res.thumb) {
        const img = el("img", "wiki-thumb");
        img.src = res.thumb; img.alt = ""; img.loading = "lazy"; img.onerror = () => img.remove();
        ex.appendChild(img);
      }
      ex.appendChild(document.createTextNode(res.extract));
      lines.push(ex);
    }
    lines.push(linksLine(res.url, res.google || SearchLib.googleUrl(query)));
    outBlock(body, lines);
    return r;
  }

  function linksLine(url, google) {
    const s = el("span", "dim");
    if (url) { s.append("→ "); s.appendChild(link(t().readFull, url)); s.append("   "); }
    s.append("→ "); s.appendChild(link(t().openGoogle, google));
    return s;
  }

  function renderGrammar(g) {
    const { r, body } = row("tool");
    const head = el("span");
    head.append(el("span", "toolname", "GrammarPolice"), document.createTextNode("(\"" + g.wrong + "\")"));
    body.appendChild(head);
    const diff = el("div");
    diff.append(el("span", "diff del", "- " + g.wrong), el("span", "diff add", "+ " + g.right));
    const lines = [diff];
    if (g.text) lines.push(el("span", null, g.text));
    outBlock(body, lines);
    return r;
  }

  // ---------------------------------------------------------------- status line
  function refreshStatus() {
    statusEl.textContent = "";
    const flag = (name, on) => {
      const s = el("span", "opt-flags");
      s.append(name + " ", el("span", on ? "on" : "off", on ? "●" : "○"), "  ");
      return s;
    };
    const lang = el("span", "opt-flags", "lang:" + settings.lang + "  ");
    statusEl.append(lang, flag("search", settings.search), flag("grammar", settings.grammar));
    if (bot) {
      const d = bot.mem.data;
      const v = Math.min(100, Math.round(60 + d.insults * 4 + d.compliments * 2 + (d.grammarCrimes || 0) * 2 + Math.min(d.messages, 40) * 0.5));
      const bars = Math.round(v / 10);
      statusEl.appendChild(el("span", "hate", t().hate + " " + "▰".repeat(bars) + "▱".repeat(10 - bars) + " " + v + "%"));
    }
  }

  // ---------------------------------------------------------------- commands
  const BOOL = ["on", "off"];
  const COMMANDS = [
    { name: "/help", desc: { id: "liat semua command", en: "show all commands" }, run: cmdHelp },
    { name: "/settings", alias: ["/config"], desc: { id: "buka pengaturan", en: "open settings" }, run: () => openSettings() },
    { name: "/lang", choices: ["auto", "id", "en"], desc: { id: "bahasa balesan: auto | id | en", en: "reply language: auto | id | en" }, run: (a) => setOpt("lang", a, ["auto", "id", "en"]) },
    { name: "/search", choices: BOOL, desc: { id: "auto search on | off", en: "auto search on | off" }, run: (a) => setOpt("search", a) },
    { name: "/grammar", choices: BOOL, desc: { id: "polisi grammar on | off", en: "grammar police on | off" }, run: (a) => setOpt("grammar", a) },
    { name: "/brain", choices: BOOL, desc: { id: "tampilin isi otak (debug)", en: "show the neural net's thoughts" }, run: (a) => setOpt("brain", a) },
    { name: "/theme", choices: ["auto", "dark", "light"], desc: { id: "tema: auto | dark | light", en: "theme: auto | dark | light" }, run: (a) => setOpt("theme", a, ["auto", "dark", "light"]) },
    { name: "/memory", desc: { id: "liat berkas lu yang gw simpen", en: "show what i remember about u" }, run: cmdMemory },
    { name: "/stats", desc: { id: "spesifikasi otak gw", en: "model stats" }, run: cmdStats },
    { name: "/draw", desc: { id: "gambar pixel art: /draw kucing [32]", en: "draw pixel art: /draw cat [32]" }, run: (a) => chat((uiLang() === "id" ? "gambar " : "draw ") + (a || "random"), true) },
    { name: "/learn", desc: { id: "pelajarin file yang lu upload (/learn NAMA buat gambar)", en: "learn the uploaded file (/learn NAME for pictures)" }, run: cmdLearn },
    { name: "/unlearn", desc: { id: "hapus semua file & gambar yang gw pelajarin", en: "forget all learned files & pictures" }, run: cmdUnlearn },
    { name: "/upload", desc: { id: "upload file (png, jpg, txt, md, csv, json)", en: "upload a file (png, jpg, txt, md, csv, json)" }, run: () => $("file").click() },
    { name: "/connect", desc: { id: "connect key + kode buat pake sybau di app lain", en: "connect key + code to use sybau in other apps" }, run: cmdConnect },
    { name: "/roast", desc: { id: "minta di-roast", en: "get roasted" }, run: () => chat(uiLang() === "id" ? "roast gw" : "roast me", true) },
    { name: "/clear", desc: { id: "bersihin layar (memori tetep)", en: "clear screen (keeps memory)" }, run: cmdClear },
    { name: "/forget", desc: { id: "hapus semua memori soal lu", en: "wipe everything i know about u" }, run: cmdForget },
    { name: "/exit", desc: { id: "keluar (coba aja)", en: "quit (try it)" }, run: () => sys([uiLang() === "id" ? "lu ga bisa kabur. tutup aja tab-nya kalo berani" : "u can't escape. close the tab if u dare"], "accent") },
  ];
  const findCmd = (name) => COMMANDS.find((c) => c.name === name || (c.alias || []).includes(name));

  function cmdHelp() {
    const tbl = el("div", "cmd-table");
    for (const c of COMMANDS) tbl.append(el("span", "k", c.name + (c.choices ? " [" + c.choices.join("|") + "]" : "")), el("span", "dim", c.desc[uiLang()]));
    const sc = el("div", "cmd-table");
    for (const [k, v] of t().shortcuts) sc.append(el("span", "k", k), el("span", "dim", v));
    sys([el("span", "bold", "sybau.ai · commands"), tbl, el("span", "bold", "shortcuts"), sc]);
  }

  function kvTable(pairs) {
    const kv = el("div", "kv");
    for (const [k, v] of pairs) kv.append(el("span", "k", k), el("span", null, v));
    return kv;
  }

  function cmdMemory() {
    const d = bot.mem.data;
    const { body } = row("tool");
    const head = el("span");
    head.append(el("span", "toolname", "Read"), document.createTextNode("(~/.sybau/ur-file.json)"));
    body.appendChild(head);
    outBlock(body, [kvTable([
      ["name", d.name || "—"], ["age", d.age || "—"], ["likes", d.likes.join(", ") || "—"], ["hates", d.hates.join(", ") || "—"],
      ["searched", (d.searches || []).slice(0, 5).join(", ") || "—"], ["insults", d.insults + "x"], ["glazing", d.compliments + "x"],
      ["grammar crimes", (d.grammarCrimes || 0) + "x" + ((d.grammarLog || []).length ? "  (" + d.grammarLog.slice(0, 3).join(", ") + ")" : "")],
      ["messages", String(d.messages)], ["lang", d.lang || "—"], ["first seen", new Date(d.firstSeen).toLocaleDateString(uiLang() === "id" ? "id-ID" : "en-GB")],
    ]), el("span", "dim", uiLang() === "id" ? "disimpen di localStorage browser lu doang. /forget buat hapus." : "stored only in ur browser's localStorage. /forget to wipe.")]);
  }

  function cmdStats() {
    const b = bot.brain;
    const { body } = row("tool");
    const head = el("span");
    head.append(el("span", "toolname", "Stats"), document.createTextNode("(model/brain.json)"));
    body.appendChild(head);
    outBlock(body, [kvTable([
      ["params", b.paramCount.toLocaleString("en-US")], ["classifier", "MLP 4096 → " + b.W1T.rows + " → " + b.clsTags.length + " intents"],
      ["generator", "GRU " + b.H + " · vocab " + b.vocab.length + " · lang-conditioned"], ["grammar", bot.grammar ? "80k-word lexicon + rules" : "not loaded"],
      ["search", "Wikipedia + Wikidata (no key)"], ["trained", b.trainedAt], ["api key", uiLang() === "id" ? "ga ada lol" : "none lol"],
    ])]);
  }

  function cmdClear() {
    screen.textContent = "";
    welcome();
  }

  let forgetArmed = false;
  function cmdForget(arg) {
    if (arg === "yes" || arg === "ya" || forgetArmed) {
      bot.mem.wipe();
      forgetArmed = false;
      cmdClear();
      sys([uiLang() === "id" ? "memori udah dihapus. lu siapa ya? idc" : "memory wiped. who r u again? idc"], "accent");
      refreshStatus();
      return;
    }
    forgetArmed = true;
    sys([uiLang() === "id" ? "yakin? ketik /forget lagi buat hapus semua (nama, kesukaan, riwayat chat)." : "sure? run /forget again to wipe everything (name, likes, chat history)."], "yellow");
  }

  function setOpt(key, arg, choices) {
    choices = choices || BOOL;
    let v;
    if (!arg) {
      v = choices === BOOL ? !settings[key] : choices[(choices.indexOf(settings[key]) + 1) % choices.length];
    } else {
      arg = arg.toLowerCase();
      if (choices === BOOL) {
        if (!["on", "off", "true", "false", "1", "0"].includes(arg)) return sys([uiLang() === "id" ? "pake: on / off" : "usage: on / off"], "red");
        v = ["on", "true", "1"].includes(arg);
      } else {
        const map = { indo: "id", indonesia: "id", english: "en", inggris: "en", gelap: "dark", terang: "light" };
        v = map[arg] || arg;
        if (!choices.includes(v)) return sys([(uiLang() === "id" ? "pilihan: " : "options: ") + choices.join(" | ")], "red");
      }
    }
    settings[key] = v;
    applySettings();
    sys([t().set(key, typeof v === "boolean" ? (v ? "on" : "off") : v)]);
  }

  function runCommand(text) {
    const [name, ...rest] = text.trim().split(/\s+/);
    const c = findCmd(name.toLowerCase());
    if (name.toLowerCase() !== "/forget") forgetArmed = false;
    if (!c) return sys([t().unknownCmd(name)], "red");
    c.run(rest.join(" "));
  }

  // ---------------------------------------------------------------- chat
  async function chat(text, noEcho) {
    if (!noEcho) userEcho(text);
    busy = true;
    interrupted = false;
    form.classList.add("busy");
    hintEl.textContent = t().busyHint;
    const verbs = t().verbs;
    let sp = spinner(verbs[Math.floor(Math.random() * verbs.length)]);
    const t0 = performance.now();
    await sleep(40);
    const res = bot.reply(text);
    const wait = Math.max(0, Math.min(1400, 450 + (res.text || "").length * 9) - (performance.now() - t0));
    for (let w = 0; w < wait && !interrupted; w += 50) await sleep(50);
    sp.stop();

    if (interrupted) {
      sys([t().interrupted], "red");
    } else {
      if (res.meta.thinking && res.meta.thinking.length) {
        const th = el("div", "block think");
        th.appendChild(el("div", "line accent", "✻ " + t().thinking + "…"));
        for (const s of res.meta.thinking) th.appendChild(el("div", "line dim", "  ⎿ " + s));
        put(th);
        await sleep(reduced ? 0 : 250);
      }
      if (res.text) await botSay(res.text, res.meta);
      if (res.search && !interrupted) {
        sp = spinner(t().searching);
        const result = await SearchLib.answer(res.search.question, res.search.lang);
        sp.stop();
        renderSearch(result, res.search.query, res.search.understand);
        if (!interrupted) {
          await sleep(200);
          await botSay(bot.searchFollowup(result, res.search.query, res.search.lang),
            { intent: result ? "search_done" : "search_fail", source: "gru", lang: res.search.lang });
        }
      }
      if (res.draw && !interrupted) await doDraw(res.draw);
      if (res.connect && !interrupted) cmdConnect();
      if (res.grammar && !interrupted) {
        if (res.text) await sleep(300);
        renderGrammar(res.grammar);
      }
      if (interrupted) sys([t().interrupted], "red");
    }
    busy = false;
    form.classList.remove("busy");
    hintEl.textContent = t().hint;
    refreshStatus();
    scrollDown(true);
    input.focus();
  }

  // ---------------------------------------------------------------- pictures
  function toolHead(body, name, arg) {
    const head = el("span");
    head.append(el("span", "toolname", name), document.createTextNode("(" + arg + ")"));
    body.appendChild(head);
  }

  function pictureNode(grid, size, filename) {
    const wrap = el("div", "pix-row");
    const url = pixels.toDataURL(grid, size, size === 16 ? 8 : 4);
    const img = el("img", "pix");
    img.src = url; img.alt = "pixel art"; img.width = 128; img.height = 128;
    wrap.appendChild(img);
    const dl = el("a", null, t().save);
    dl.href = url; dl.download = (filename || "sybau") + "-" + size + "x" + size + ".png";
    wrap.appendChild(dl);
    return wrap;
  }

  function renderPicture(grid, size, label, note) {
    const { r, body } = row("tool");
    toolHead(body, "Draw", (label || "?") + ", " + size + "x" + size);
    outBlock(body, (note ? [el("span", "yellow", note)] : []).concat([pictureNode(grid, size, (label || "sybau").replace(/[^a-z0-9]+/gi, "-"))]));
    return r;
  }

  async function doDraw(req) {
    if (!pixels) return sys(["image generator failed to load (model/pixels.json)"], "red");
    const sp = spinner(t().drawing);
    await sleep(reduced ? 0 : 450);
    const d = pixels.draw(req.prompt, { size: req.size });
    sp.stop();
    const mean = d.fixes.length ? "did you mean " + d.fixes.map((f) => f.to).join(" + ") + "?" : null;
    renderPicture(d.grid, d.size, d.known ? d.prompt || d.labels.join(" + ") : req.prompt + " (??)", mean);
    await botSay(bot.drawFollowup(d, req), { intent: d.known ? "draw" : "draw_unknown", source: "gru", lang: bot._lang() });
  }

  // ---------------------------------------------------------------- connect key
  function copyBtn(text) {
    const b = el("button", "btn", t().copy);
    b.type = "button";
    b.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(text); }
      catch (e) { const ta = el("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (e2) { /* ignore */ } ta.remove(); }
      b.textContent = t().copied;
      setTimeout(() => (b.textContent = t().copy), 1500);
    });
    return b;
  }
  function codeBlock(text) {
    const wrap = el("div");
    wrap.append(el("span", "code", text), copyBtn(text));
    return wrap;
  }
  function cmdConnect() {
    const id = uiLang() === "id";
    const html = '<script src="' + SITE + 'sybau.js"></' + 'script>\n<script>\n  const sybau = new Sybau({ connectKey: "' + CONNECT_KEY + '" });\n  sybau.chat("halo").then((r) => console.log(r.full));\n</' + 'script>';
    const iframe = '<iframe src="' + SITE + 'embed.html?key=' + CONNECT_KEY + '" width="420" height="600" style="border:0"></iframe>';
    const node = '// node 18+: download ' + SITE + 'sybau.js once, then\nconst { Sybau } = require("./sybau.js");\nconst sybau = new Sybau({ connectKey: "' + CONNECT_KEY + '" });\nsybau.chat("roast me").then((r) => console.log(r.full));';
    const { body } = row("tool");
    toolHead(body, "Connect", "sybau.ai");
    const key = el("div", "keybox");
    key.append(el("code", null, CONNECT_KEY), copyBtn(CONNECT_KEY));
    outBlock(body, [
      el("span", "bold", id ? "connect key (sama di mana aja, kapan aja):" : "connect key (the same everywhere, forever):"), key,
      el("span", "dim", id ? "1. tempel di HTML mana pun:" : "1. paste into any HTML page:"), codeBlock(html),
      el("span", "dim", id ? "2. atau widget chat siap pakai (iframe):" : "2. or a ready-made chat widget (iframe):"), codeBlock(iframe),
      el("span", "dim", id ? "3. atau di Node.js:" : "3. or in Node.js:"), codeBlock(node),
      el("span", "dim", id ? "Cara kerjanya: ga ada server. sybau.js download otak sybau dari situs ini terus jalan di app lu sendiri, jadi gratis dan ga ada limit. Key ini bukan rahasia, cuma buat ngecek lu pake sybau beneran."
        : "How it works: there is no server. sybau.js downloads sybau's brain from this site and runs it inside ur app, so it's free with no limits. The key isn't a secret, it just checks u're using the real sybau."),
    ]);
  }

  // ---------------------------------------------------------------- files: upload, read, learn
  const TEXT_EXT = /\.(txt|md|csv|tsv|json|log|html?|js|py|css|xml|ya?ml)$/i;
  function readAs(file, how) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => rej(fr.error);
      if (how === "url") fr.readAsDataURL(file); else fr.readAsText(file);
    });
  }
  function loadImage(src) {
    return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error("not an image")); im.src = src; });
  }
  function pixelsOf(img, w, h) {
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h).data;
  }

  // ---- attachment: a picked/dropped/pasted file waits above the prompt until Enter
  let attached = null;
  const chipEl = el("div", "chip-row");
  chipEl.hidden = true;
  form.parentNode.insertBefore(chipEl, form);
  function attach(file) {
    if (!file) return;
    attached = file;
    chipEl.textContent = "";
    const chip = el("span", "file-chip");
    chip.append(el("span", "accent", "[file] "), document.createTextNode(file.name + " (" + Math.max(1, Math.round(file.size / 1024)) + " KB)"));
    const x = el("button", "chip-x", "×");
    x.type = "button";
    x.title = uiLang() === "id" ? "hapus lampiran" : "remove attachment";
    x.addEventListener("click", detach);
    chip.appendChild(x);
    chipEl.append(chip, el("span", "dim chip-hint", uiLang() === "id" ? "enter = buka · /learn = pelajarin · atau tanya soal file ini" : "enter = open · /learn = learn it · or ask about it"));
    chipEl.hidden = false;
    input.focus();
  }
  function detach() { attached = null; chipEl.hidden = true; chipEl.textContent = ""; input.focus(); }

  async function handleFile(file, opts = {}) {
    if (!file || busy || !bot) return;
    const id = uiLang() === "id";
    const kb = Math.max(1, Math.round(file.size / 1024));
    userEcho("[file] " + file.name + " (" + kb + " KB)" + (opts.text ? "  " + opts.text : ""));
    busy = true;
    form.classList.add("busy");
    const sp = spinner(t().reading);
    try {
      if (/^image\//.test(file.type)) {
        const src = await readAs(file, "url");
        const img = await loadImage(src);
        const w = img.naturalWidth, h = img.naturalHeight;
        const sw = Math.min(256, w), sh = Math.max(1, Math.round(sw * h / w));
        const info = PixelLib.describeImage(pixelsOf(img, sw, sh), sw, sh);
        info.width = w; info.height = h;
        const grid = pixels ? pixels.quantize(pixelsOf(img, 16, 16)) : null;
        pending = { kind: "image", name: file.name, grid };
        sp.stop();
        const { body } = row("tool");
        toolHead(body, "Read", file.name);
        const thumb = el("img", "upload-thumb"); thumb.src = src; thumb.alt = file.name;
        const colors = info.colors.map((c) => (id ? c.id : c.en) + " " + c.pct + "%").join(", ");
        const lines = [thumb, el("span", null, w + "x" + h + " px · " + (id ? "warna: " : "colors: ") + colors + " · " + (id ? "terang " : "brightness ") + info.brightness + "%" + (info.transparentPct ? " · " + (id ? "transparan " : "transparent ") + info.transparentPct + "%" : ""))];
        if (grid) { lines.push(el("span", "dim", id ? "yang gw liat (16x16):" : "what i see (16x16):")); lines.push(pictureNode(grid, 16, file.name.replace(/\.\w+$/, ""))); }
        if (!opts.quiet) lines.push(el("span", "yellow", t().learnHint));
        outBlock(body, lines);
        const summary = w + "x" + h + ", " + (id ? "kebanyakan " : "mostly ") + (info.colors[0] ? (id ? info.colors[0].id : info.colors[0].en) : "?");
        await botSay(bot.fileOpened("image", summary), { intent: "file_image", source: "gru", lang: bot._lang() });
      } else if (TEXT_EXT.test(file.name) || /^text\//.test(file.type) || file.type === "application/json") {
        if (file.size > 2 * 1024 * 1024) throw new Error(id ? "file kegedean (max 2 MB)" : "file too big (max 2 MB)");
        const text = await readAs(file, "text");
        pending = { kind: "text", name: file.name, text };
        sp.stop();
        const lines = text.split("\n");
        const { body } = row("tool");
        toolHead(body, "Read", file.name);
        outBlock(body, [el("span", null, lines.length + (id ? " baris · " : " lines · ") + text.length + (id ? " karakter" : " chars")),
          el("span", "code", lines.slice(0, 10).join("\n").slice(0, 900) + (lines.length > 10 ? "\n…" : ""))].concat(opts.quiet ? [] : [el("span", "yellow", t().learnHintText)]));
        await botSay(bot.fileOpened("text", lines.length + (id ? " baris" : " lines")), { intent: "file_text", source: "gru", lang: bot._lang() });
      } else {
        throw new Error(id ? "format ga didukung. bisa: png, jpg, gif, webp, txt, md, csv, json" : "unsupported format. try png, jpg, gif, webp, txt, md, csv, json");
      }
    } catch (e) {
      sp.stop();
      sys([e.message], "red");
    }
    busy = false;
    form.classList.remove("busy");
    refreshStatus();
    input.focus();
  }

  async function cmdLearn(arg, auto) {
    const id = uiLang() === "id";
    if (!pending) return sys([t().nothingToLearn], "yellow");
    const sp = spinner(t().learning);
    await sleep(40);
    if (pending.kind === "image") {
      if (!pixels || !pending.grid) { sp.stop(); return sys(["image generator not loaded"], "red"); }
      const name = (arg || pending.name.replace(/\.\w+$/, "")).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ")[0] || "thing";
      const r = pixels.learn(pending.grid);
      pixels.addLearned([{ name, z: r.z }]);
      learner.addImage(name, r.z, pending.grid);
      sp.stop();
      const { body } = row("tool");
      toolHead(body, "Learn", name);
      outBlock(body, [pictureNode(r.preview, 16, name), el("span", "dim", (id ? "akurasi rekonstruksi " : "reconstruction accuracy ") + Math.round(r.acc * 100) + "% · " + (id ? "coba: gambar " : "try: draw ") + name)]);
      await botSay(bot.learnedImage(name), { intent: "learned_image", source: "gru", lang: bot._lang() });
    } else {
      const sum = learner.learnText(pending.name, pending.text);
      sp.stop();
      const { body } = row("tool");
      toolHead(body, "Learn", pending.name);
      const desc = sum.kind === "notes" ? sum.chunks + (id ? " potongan catatan (tanya aja isinya)" : " passages of notes (ask me about it)") + (sum.truncated ? (id ? " · dipotong, kegedean" : " · truncated, too big") : "")
        : sum.pairs + (id ? " pasangan tanya-jawab (" : " question/answer pairs (") + sum.kind + ")";
      outBlock(body, [el("span", "green", desc)].concat(sum.saveFailed ? [el("span", "red", id ? "storage browser penuh, sebagian ga kesimpen" : "browser storage full, some of it wasn't saved")] : []));
      if (!auto) await botSay(bot.fileOpened("text", desc), { intent: "file_text", source: "gru", lang: bot._lang() });
    }
    pending = null;
  }

  function cmdUnlearn() {
    learner.wipe();
    if (pixels) pixels.labels = pixels.labels.filter((l) => l.builtin);
    sys([uiLang() === "id" ? "semua yang gw pelajarin dari lu udah dihapus. otak gw bersih lagi" : "forgot everything i learned from u. clean brain again"]);
  }

  $("attach").addEventListener("click", () => $("file").click());
  $("file").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; attach(f); });
  let dragDepth = 0;
  window.addEventListener("dragenter", (e) => { if (!(window.SybauCode && window.SybauCode.tab === "sc") && [...(e.dataTransfer.types || [])].includes("Files")) { dragDepth++; $("dropzone").hidden = false; e.preventDefault(); } });
  window.addEventListener("dragover", (e) => { if ([...(e.dataTransfer.types || [])].includes("Files")) e.preventDefault(); });
  window.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $("dropzone").hidden = true; });
  window.addEventListener("drop", (e) => { e.preventDefault(); dragDepth = 0; $("dropzone").hidden = true; if (window.SybauCode && window.SybauCode.tab === "sc") return; const f = e.dataTransfer.files[0]; if (f) attach(f); });
  document.addEventListener("paste", (e) => { if (window.SybauCode && window.SybauCode.tab === "sc") return; const f = e.clipboardData && [...e.clipboardData.files][0]; if (f) { e.preventDefault(); attach(f); } });

  // ---------------------------------------------------------------- input: history, autocomplete, keys
  const history = load("sybau_cmd_history", []);
  let hIndex = -1, hDraft = "";
  let sugg = [], sel = 0;

  function autoresize() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 160) + "px";
  }

  function computeSuggestions() {
    const v = input.value;
    if (!v.startsWith("/")) return [];
    const m = v.match(/^(\/\S*)(?:\s+(\S*))?$/);
    if (!m) return [];
    if (m[2] === undefined && !/\s$/.test(v)) {
      const q = m[1].toLowerCase();
      return COMMANDS.filter((c) => c.name.startsWith(q) || (c.alias || []).some((a) => a.startsWith(q)))
        .map((c) => ({ value: c.name, label: c.name, desc: c.desc[uiLang()], run: !c.choices }));
    }
    const c = findCmd(m[1].toLowerCase());
    if (!c || !c.choices) return [];
    const arg = (m[2] || "").toLowerCase();
    return c.choices.filter((ch) => ch.startsWith(arg))
      .map((ch) => ({ value: c.name + " " + ch, label: c.name + " " + ch, desc: (settings[c.name.slice(1)] === ch || (settings[c.name.slice(1)] === true && ch === "on") || (settings[c.name.slice(1)] === false && ch === "off")) ? "← now" : "", run: true }));
  }

  function renderSuggest() {
    sugg = computeSuggestions();
    if (!sugg.length) { suggestEl.hidden = true; return; }
    sel = Math.min(sel, sugg.length - 1);
    suggestEl.textContent = "";
    sugg.forEach((s, i) => {
      const o = el("div", "opt" + (i === sel ? " sel" : ""));
      o.setAttribute("role", "option");
      o.append(el("span", "c", s.label), el("span", null, s.desc));
      o.addEventListener("mousedown", (e) => { e.preventDefault(); pickSuggestion(i, true); });
      suggestEl.appendChild(o);
    });
    suggestEl.hidden = false;
    shortcutsEl.hidden = true;
  }

  function pickSuggestion(i, execute) {
    const s = sugg[i];
    if (!s) return;
    const c = findCmd(s.value.split(" ")[0]);
    if (execute && s.run) {
      input.value = s.value;
      submit();
    } else {
      input.value = s.value + (c && c.choices && !s.value.includes(" ") ? " " : "");
      sel = 0;
      renderSuggest();
    }
    autoresize();
  }

  async function submit() {
    const text = input.value.replace(/\s+$/, "");
    if ((!text.trim() && !attached) || busy || !bot) return;
    if (attached) {
      // send the file together with whatever was typed: nothing, /learn [name], or a question
      const file = attached, msg = text.trim();
      const learnCmd = /^\/learn\b/i.test(msg) || /^(?:tolong\s+)?(?:pelajarin|pelajari|belajar|pahamin|learn|study)\b/i.test(msg);
      detach();
      input.value = "";
      autoresize();
      suggestEl.hidden = true;
      shortcutsEl.hidden = true;
      await handleFile(file, { text: msg, quiet: learnCmd });
      if (!pending) return; // file could not be read
      if (learnCmd) await cmdLearn(/^\/learn\b/i.test(msg) ? msg.replace(/^\/learn\s*/i, "") : "");
      else if (msg.startsWith("/")) runCommand(msg);
      else if (msg) {
        if (pending && pending.kind === "text") await cmdLearn("", true); // so the question can be answered from the file
        await chat(msg, true);
      }
      scrollDown(true);
      input.focus();
      return;
    }
    input.value = "";
    autoresize();
    suggestEl.hidden = true;
    shortcutsEl.hidden = true;
    if (history[history.length - 1] !== text) { history.push(text); if (history.length > 50) history.shift(); save("sybau_cmd_history", history); }
    hIndex = -1;
    if (text.trim().startsWith("/")) { userEcho(text.trim()); runCommand(text.trim()); scrollDown(true); input.focus(); }
    else if (pending && /^(?:tolong\s+)?(?:pelajarin|pelajari|belajar|pahamin|learn|study)\b/i.test(text.trim())) { userEcho(text.trim()); cmdLearn(""); }
    else chat(text.trim());
  }

  function renderShortcuts() {
    shortcutsEl.textContent = "";
    for (const [k, v] of t().shortcuts) { const s = el("span"); s.append(el("b", null, k), " " + v); shortcutsEl.appendChild(s); }
  }

  input.addEventListener("input", () => { sel = 0; renderSuggest(); autoresize(); if (input.value) shortcutsEl.hidden = true; });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (busy) { interrupted = true; e.preventDefault(); return; }
      if (attached && !input.value && suggestEl.hidden) { detach(); return; }
      if (!suggestEl.hidden) { suggestEl.hidden = true; return; }
      if (!shortcutsEl.hidden) { shortcutsEl.hidden = true; return; }
    }
    if (!suggestEl.hidden && sugg.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); sel = (sel + 1) % sugg.length; renderSuggest(); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); sel = (sel - 1 + sugg.length) % sugg.length; renderSuggest(); return; }
      if (e.key === "Tab") { e.preventDefault(); pickSuggestion(sel, false); return; }
      if (e.key === "Enter" && !e.shiftKey) {
        const exact = sugg[sel] && sugg[sel].value === input.value.trim();
        if (!exact) { e.preventDefault(); pickSuggestion(sel, true); return; }
      }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); return; }
    if (e.key === "?" && !input.value) {
      e.preventDefault();
      renderShortcuts();
      shortcutsEl.hidden = !shortcutsEl.hidden;
      return;
    }
    if ((e.key === "l" || e.key === "L") && e.ctrlKey) { e.preventDefault(); cmdClear(); return; }
    if (e.key === "ArrowUp" && history.length && !input.value.slice(0, input.selectionStart).includes("\n")) {
      e.preventDefault();
      if (hIndex === -1) { hDraft = input.value; hIndex = history.length; }
      hIndex = Math.max(0, hIndex - 1);
      input.value = history[hIndex];
      autoresize();
      return;
    }
    if (e.key === "ArrowDown" && hIndex !== -1 && !input.value.slice(input.selectionEnd).includes("\n")) {
      e.preventDefault();
      hIndex++;
      if (hIndex >= history.length) { hIndex = -1; input.value = hDraft; } else input.value = history[hIndex];
      autoresize();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && busy) interrupted = true;
  });
  form.addEventListener("submit", (e) => { e.preventDefault(); submit(); });
  screen.addEventListener("click", () => { if (!window.getSelection().toString()) input.focus(); });

  // ---------------------------------------------------------------- settings modal
  const modal = $("settings"), list = $("settings-list");
  const ITEMS = [
    { key: "lang", choices: ["auto", "id", "en"], label: () => t().sLang },
    { key: "search", label: () => t().sSearch },
    { key: "grammar", label: () => t().sGrammar },
    { key: "experimental", label: () => t().sExp },
    { key: "connect", action: () => { closeSettings(); cmdConnect(); }, label: () => t().sConnect, value: () => CONNECT_KEY.slice(0, 13) + "…" },
    { key: "brain", label: () => t().sBrain },
    { key: "theme", choices: ["auto", "dark", "light"], label: () => t().sTheme },
  ];
  let sIndex = 0;

  function valueNode(item) {
    const v = settings[item.key];
    const s = el("span", "val");
    if (item.action) { s.appendChild(el("span", "dim", item.value() + " →")); return s; }
    if (item.choices) {
      s.append(el("span", "dim", "‹ "), el("span", "choice", item.key === "lang" ? ({ auto: "auto", id: "indonesia", en: "english" })[v] : v), el("span", "dim", " ›"));
    } else s.appendChild(el("span", v ? "on" : "off", v ? "✓ " + t().on : "× " + t().off));
    return s;
  }

  function renderSettings() {
    $("settings-title").lastChild.textContent = " " + t().sTitle;
    $("settings-foot").textContent = t().sFoot;
    list.textContent = "";
    ITEMS.forEach((item, i) => {
      const b = el("button", "setting" + (i === sIndex ? " sel" : ""));
      b.type = "button";
      const [name, desc] = item.label();
      const nm = el("span", "name", name);
      nm.appendChild(el("span", "desc", desc));
      b.append(el("span", "ptr", "❯"), nm, valueNode(item));
      if (!item.choices && !item.action) { b.setAttribute("role", "switch"); b.setAttribute("aria-checked", String(!!settings[item.key])); }
      b.addEventListener("click", () => { sIndex = i; change(item, 1); });
      b.addEventListener("focus", () => { sIndex = i; [...list.children].forEach((c, j) => c.classList.toggle("sel", j === i)); });
      list.appendChild(b);
    });
  }

  function change(item, dir) {
    if (item.action) { item.action(); return; }
    if (item.choices) {
      const i = item.choices.indexOf(settings[item.key]);
      settings[item.key] = item.choices[(i + dir + item.choices.length) % item.choices.length];
    } else settings[item.key] = !settings[item.key];
    applySettings();
    renderSettings();
    list.children[sIndex].focus();
    const v = settings[item.key];
    sys([t().set(item.key, typeof v === "boolean" ? (v ? "on" : "off") : v)]);
  }

  function openSettings() {
    sIndex = 0;
    renderSettings();
    modal.hidden = false;
    list.children[0].focus();
  }
  function closeSettings() { modal.hidden = true; if (window.SybauCode && window.SybauCode.tab === "sc") window.SybauCode.focus(); else input.focus(); }

  modal.addEventListener("keydown", (e) => {
    const item = ITEMS[sIndex];
    if (e.key === "Escape") { e.preventDefault(); closeSettings(); }
    else if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) { e.preventDefault(); sIndex = (sIndex + 1) % ITEMS.length; list.children[sIndex].focus(); }
    else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) { e.preventDefault(); sIndex = (sIndex - 1 + ITEMS.length) % ITEMS.length; list.children[sIndex].focus(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); change(item, 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); change(item, -1); }
  });
  modal.addEventListener("click", (e) => { if (e.target === modal) closeSettings(); });
  $("settings-close").addEventListener("click", closeSettings);
  $("settings-btn").addEventListener("click", openSettings);

  // ---------------------------------------------------------------- restore + boot
  function restore(h) {
    const items = h.slice(-40);
    for (const m of items) {
      if (m.role === "user") userEcho(m.text);
      else if (m.kind === "grammar") renderGrammar(m);
      else if (m.kind === "search") renderSearch(m.result, m.result && (m.result.query || m.result.title));
      else if (m.kind === "image") { if (pixels && m.grid) renderPicture(m.grid.split(",").map(Number), m.size, (m.labels || []).join(" + ")); }
      else if (m.text) {
        const { body } = row(m.meta && m.meta.source === "safety" ? "safety" : "", m.meta && m.meta.source === "safety" ? "+" : "●");
        body.appendChild(el("span", null, m.text));
        if (m.meta && m.meta.intent) body.appendChild(metaNode(m.meta));
      }
    }
    sys([t().restored(items.filter((m) => m.role === "user").length)]);
  }

  applySettings();
  const grammarP = GrammarLib.loadGrammar("model/lexicon.json").catch(() => null);
  const pixelsP = PixelLib.loadPixels("model/pixels.json").catch(() => null);
  learner = new LearnLib.Learner(storage);
  BrainLib.loadBrain("model/brain.json").then(async (brain) => {
    $("boot-1").textContent = "  ⎿ " + brain.paramCount.toLocaleString("en-US") + " params · " + brain.clsTags.length + " intents · " + brain.vocab.length + " words";
    const grammar = await grammarP;
    $("boot-2").textContent = "  ⎿ grammar police " + (grammar ? "ready (80k words)" : "failed to load") + " · image gen " + ((await pixelsP) ? "ready (beta)" : "failed to load");
    pixels = await pixelsP;
    if (pixels) pixels.addLearned(learner.data.images);
    learner._index(); // re-index with the brain's slang table loaded
    bot = new BotLib.RoastBot(brain, { storage, grammar, learner,
      settings: { lang: settings.lang, search: settings.search, grammar: settings.grammar, experimental: !!settings.experimental } });
    await sleep(reduced ? 0 : 350);
    screen.textContent = "";
    welcome();
    const d = bot.mem.data;
    if (d.history.length) {
      restore(d.history);
      await botSay(d.name ? (uiLang() === "id" ? "oh " + d.name + " balik lagi. ugh" : "oh " + d.name + " is back. ugh") : (uiLang() === "id" ? "oh lu balik. ugh" : "oh ur back. ugh"), null, false);
    }
    input.disabled = false;
    applySettings();
    input.focus();
  }).catch((err) => {
    $("boot-2").textContent = "  ⎿ error: brain failed to load (" + err.message + "). opening the file directly? run: python -m http.server";
    $("boot-2").className = "line red";
  });
})();
