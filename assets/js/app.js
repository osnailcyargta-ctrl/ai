/* app.js — UI glue. The brains live in brain.js + bot.js (+ grammar.js, search.js). */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const chat = $("chat"), input = $("input"), form = $("composer"), sendBtn = $("send");
  let bot = null, busy = false;

  const HARD_ROASTS = new Set(["insult", "insult_long", "roast_me", "hate_ask", "brag", "challenge", "ask_opinion"]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let storage = null;
  try { storage = window.localStorage; storage.getItem("x"); } catch (e) { storage = null; }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function scrollDown() { chat.scrollTop = chat.scrollHeight; }
  function push(node) { chat.appendChild(node); scrollDown(); return node; }

  function addMessage(role, text, meta) {
    const row = el("div", "msg " + role);
    if (meta && meta.source === "safety") row.classList.add("safety");
    else if (meta && HARD_ROASTS.has(meta.intent)) row.classList.add("hard");
    row.appendChild(el("span", "who", role === "user" ? "LU" : meta && meta.source === "safety" ? "🌱 SERIUS SEBENTAR" : "🥀 SYBAU.AI"));
    const bubble = el("div", "bubble", text);
    if (role === "bot" && meta && meta.intent) {
      const m = el("div", "meta");
      const parts = [["intent", meta.intent]];
      if (meta.confidence !== undefined) parts.push(["p", (meta.confidence * 100).toFixed(0) + "%"]);
      if (meta.lang) parts.push(["lang", meta.lang]);
      parts.push(["src", meta.source]);
      parts.forEach(([k, v], i) => {
        if (i) m.append(" · ");
        m.append(k + "=");
        m.appendChild(el("b", null, v));
      });
      if (meta.novel) { m.append(" "); m.appendChild(el("span", "novel", "✦ kalimat baru, ga ada di data")); }
      if (meta.top && meta.top.length) m.title = meta.top.map((t) => t.tag + " " + (t.p * 100).toFixed(1) + "%").join("\n");
      bubble.appendChild(m);
    }
    row.appendChild(bubble);
    return push(row);
  }

  function addGrammar(g) {
    const row = el("div", "msg bot grammar");
    const pen = el("div", "pen");
    pen.appendChild(el("div", "pen-tag", "📝 POLISI GRAMMAR"));
    const fix = el("div", "pen-fix");
    fix.appendChild(el("s", null, g.wrong));
    fix.appendChild(el("span", "arrow", "→"));
    fix.appendChild(el("span", "right", g.right));
    pen.appendChild(fix);
    if (g.text) pen.appendChild(el("p", null, g.text));
    row.appendChild(pen);
    return push(row);
  }

  function addClipping(r) {
    const row = el("div", "msg bot clip");
    const c = el("div", "clipping");
    const src = el("div", "clip-src");
    src.appendChild(el("span", null, "✂ WIKIPEDIA · " + r.lang.toUpperCase()));
    src.appendChild(el("span", null, new Date().toLocaleDateString("id-ID")));
    c.appendChild(src);
    const body = el("div", "clip-body");
    if (r.thumb) {
      const img = el("img");
      img.src = r.thumb; img.alt = ""; img.loading = "lazy";
      img.onerror = () => img.remove();
      body.appendChild(img);
    }
    const txt = el("div");
    txt.appendChild(el("h4", null, r.title));
    txt.appendChild(el("p", null, r.extract));
    body.appendChild(txt);
    c.appendChild(body);
    const links = el("div", "clip-links");
    const a1 = el("a", null, "BACA FULL ↗"); a1.href = r.url; a1.target = "_blank"; a1.rel = "noopener";
    const a2 = el("a", "g", "GOOGLE ↗"); a2.href = r.google; a2.target = "_blank"; a2.rel = "noopener";
    links.append(a1, a2);
    c.appendChild(links);
    row.appendChild(c);
    return push(row);
  }

  function addGoogleOnly(query) {
    const row = el("div", "msg bot clip");
    const c = el("div", "clipping");
    c.appendChild(el("div", "clip-src", "✂ GA KETEMU DI WIKIPEDIA"));
    const links = el("div", "clip-links");
    const a = el("a", "g", "CARI \"" + query.toUpperCase() + "\" DI GOOGLE ↗");
    a.href = SearchLib.googleUrl(query); a.target = "_blank"; a.rel = "noopener";
    links.appendChild(a);
    c.appendChild(links);
    row.appendChild(c);
    return push(row);
  }

  function addNote(text) { push(el("div", "day-note", text)); }

  function showTyping(label) {
    const row = el("div", "msg bot typing");
    row.appendChild(el("span", "who", "🥀 SYBAU.AI"));
    row.appendChild(el("div", "bubble", label || "lagi ngetik roasting"));
    return push(row);
  }

  function petals(n) {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (let i = 0; i < n; i++) {
      const p = el("div", "petal", Math.random() < 0.85 ? "🥀" : "💀");
      p.style.left = Math.random() * 100 + "vw";
      p.style.animationDuration = 2.2 + Math.random() * 2 + "s";
      p.style.animationDelay = Math.random() * 0.5 + "s";
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 5000);
    }
  }

  // ---------- hate meter ----------
  const segs = $("hate-segs");
  for (let i = 0; i < 20; i++) segs.appendChild(el("i"));
  function hateLevel() {
    const d = bot.mem.data;
    return Math.min(100, Math.round(60 + d.insults * 4 + d.compliments * 2 + (d.grammarCrimes || 0) * 2 + Math.min(d.messages, 40) * 0.5));
  }
  function refreshHate() {
    const v = hateLevel();
    [...segs.children].forEach((s, i) => s.classList.toggle("on", i < Math.round(v / 5)));
    $("hate-value").textContent = v + "%";
    $("hate").setAttribute("aria-valuenow", String(v));
  }

  // ---------- case file ----------
  function fillList(dl, pairs) {
    dl.textContent = "";
    for (const [k, v] of pairs) dl.append(el("dt", null, k), el("dd", null, v));
  }
  function refreshDrawer() {
    const d = bot.mem.data;
    $("case-no").textContent = "KASUS #" + String(d.firstSeen % 10000).padStart(4, "0");
    fillList($("memory-list"), [
      ["nama", d.name || "— (ga ngaku)"],
      ["umur", d.age || "—"],
      ["suka", d.likes.join(", ") || "—"],
      ["benci", d.hates.join(", ") || "—"],
      ["nyari", (d.searches || []).slice(0, 4).join(", ") || "—"],
      ["ngehina gw", d.insults + "x"],
      ["glazing gw", d.compliments + "x"],
      ["total chat", String(d.messages)],
      ["bahasa", d.lang === "id" ? "indo" : d.lang === "en" ? "english" : "—"],
      ["kenal sejak", new Date(d.firstSeen).toLocaleDateString("id-ID")],
    ]);
    const ev = $("evidence");
    ev.textContent = "";
    const log = d.grammarLog || [];
    if (!log.length) ev.appendChild(el("li", "none", "belum ada. tunggu aja."));
    for (const g of log) ev.appendChild(el("li", null, g));
    const b = bot.brain;
    fillList($("brain-stats"), [
      ["params", b.paramCount.toLocaleString("en-US")],
      ["intent", String(b.clsTags.length)],
      ["kosakata", b.vocab.length + " kata"],
      ["grammar", bot.grammar ? "aktif (80rb kata)" : "ga ke-load"],
      ["dilatih", b.trainedAt],
      ["api key", "ga ada lol"],
    ]);
  }
  function setDrawer(open) {
    $("drawer").classList.toggle("open", open);
    $("scrim").classList.toggle("open", open);
    $("drawer").setAttribute("aria-hidden", String(!open));
    if (open) refreshDrawer();
  }

  // ---------- send ----------
  async function send(text) {
    text = text.trim();
    if (!text || busy || !bot) return;
    busy = true;
    sendBtn.disabled = true;
    input.value = "";
    addMessage("user", text);
    let typing = showTyping();
    const t0 = performance.now();
    await sleep(30); // let the typing card paint before the nets run
    const res = bot.reply(text);
    const wait = Math.max(0, Math.min(1300, 350 + (res.text || "").length * 11) - (performance.now() - t0));
    await sleep(wait);
    typing.remove();
    if (res.text) {
      const row = addMessage("bot", res.text, res.meta);
      if (res.meta.intent === "insult_long") { petals(16); row.classList.add("shake"); }
      else if (HARD_ROASTS.has(res.meta.intent)) petals(5);
    }

    if (res.search) {
      typing = showTyping("nyari di wikipedia");
      const result = await SearchLib.wikiSearch(res.search.query, res.search.lang);
      typing.remove();
      if (result) addClipping(result); else addGoogleOnly(res.search.query);
      await sleep(250);
      addMessage("bot", bot.searchFollowup(result, res.search.query, res.search.lang), { intent: result ? "search_done" : "search_fail", source: "gru", lang: res.search.lang });
    }
    if (res.grammar) {
      if (res.text) await sleep(450);
      addGrammar(res.grammar);
    }
    refreshHate();
    busy = false;
    sendBtn.disabled = false;
    input.focus();
  }

  form.addEventListener("submit", (e) => { e.preventDefault(); send(input.value); });
  $("chips").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    const t = chip.textContent;
    if (t.endsWith(" ")) { input.value = t; input.focus(); } // "nama gw " -> user finishes it
    else send(t);
  });
  $("brain-toggle").addEventListener("click", (e) => {
    const on = document.body.classList.toggle("brain-on");
    e.currentTarget.setAttribute("aria-pressed", String(on));
    scrollDown();
    try { storage && storage.setItem("sybau_brain_on", on ? "1" : "0"); } catch (err) { /* ignore */ }
  });
  $("memory-open").addEventListener("click", () => setDrawer(true));
  $("memory-close").addEventListener("click", () => setDrawer(false));
  $("scrim").addEventListener("click", () => setDrawer(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setDrawer(false); });
  $("wipe").addEventListener("click", () => {
    if (!confirm("bakar semua memori? gw bakal lupa lu (akhirnya)")) return;
    bot.mem.wipe();
    chat.textContent = "";
    refreshDrawer();
    refreshHate();
    addMessage("bot", "berkas udah dibakar 🔥 lu siapa ya? idc 🥀");
  });

  try { if (storage && storage.getItem("sybau_brain_on") === "1") $("brain-toggle").click(); } catch (e) { /* ignore */ }

  function restore(history) {
    addNote("CHAT LAMA · GW INGET SEMUANYA 🥀");
    for (const m of history.slice(-36)) {
      if (m.kind === "grammar") addGrammar(m);
      else if (m.kind === "search") addClipping(m.result);
      else addMessage(m.role, m.text, m.meta);
    }
  }

  const grammarP = GrammarLib.loadGrammar("model/lexicon.json").catch(() => null);
  BrainLib.loadBrain("model/brain.json").then(async (brain) => {
    const grammar = await grammarP;
    bot = new BotLib.RoastBot(brain, { storage, grammar });
    const d = bot.mem.data;
    if (d.history.length) {
      restore(d.history);
      addMessage("bot", d.name ? "oh " + d.name + " balik lagi. ugh 🥀" : "oh lu balik. ugh 🥀");
    } else {
      addMessage("bot", "yo. gw sybau.ai, neural net yang dilatih dari nol buat benci lu 🥀 kasih tau nama lu, suruh gw nyari sesuatu, atau ngomong apa aja yang cupu. typo dikit gw roast.");
    }
    refreshHate();
    $("loader").classList.add("gone");
    input.focus();
  }).catch((err) => {
    $("loader-text").textContent = "otak gagal ke-load 💀 (" + err.message + "). kalo buka file langsung, pake server: python -m http.server";
  });
})();
