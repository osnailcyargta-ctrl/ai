/* app.js — UI glue. The brains live in brain.js + bot.js. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const chat = $("chat"), input = $("input"), form = $("composer"), sendBtn = $("send");
  let bot = null, busy = false;

  const HARD_ROASTS = new Set(["insult", "insult_long", "roast_me", "hate_ask", "brag"]);

  let storage = null;
  try { storage = window.localStorage; storage.getItem("x"); } catch (e) { storage = null; }

  function scrollDown() { chat.scrollTop = chat.scrollHeight; }

  function addMessage(role, text, meta) {
    const row = document.createElement("div");
    row.className = "msg " + role;
    if (meta && meta.source === "safety") row.classList.add("safety");
    else if (meta && HARD_ROASTS.has(meta.intent)) row.classList.add("hard");
    if (role === "bot") {
      const av = document.createElement("div");
      av.className = "mini-avatar";
      av.textContent = meta && meta.source === "safety" ? "🌱" : "🥀";
      row.appendChild(av);
    }
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = text;
    if (role === "bot" && meta && meta.intent) {
      const m = document.createElement("div");
      m.className = "meta";
      const conf = meta.confidence !== undefined ? " · " + Math.round(meta.confidence * 100) + "%" : "";
      m.textContent = "intent: " + meta.intent + conf + " · " + meta.source;
      if (meta.novel) {
        const n = document.createElement("span");
        n.className = "novel";
        n.textContent = " · ✨ new sentence (not in training data)";
        m.appendChild(n);
      }
      if (meta.top && meta.top.length) m.title = meta.top.map((t) => t.tag + " " + (t.p * 100).toFixed(1) + "%").join("\n");
      bubble.appendChild(m);
    }
    row.appendChild(bubble);
    chat.appendChild(row);
    scrollDown();
    return row;
  }

  function addNote(text) {
    const n = document.createElement("div");
    n.className = "day-note";
    n.textContent = text;
    chat.appendChild(n);
  }

  function showTyping() {
    const row = document.createElement("div");
    row.className = "msg bot typing";
    row.innerHTML = '<div class="mini-avatar">🥀</div><div class="bubble"><span></span><span></span><span></span></div>';
    chat.appendChild(row);
    scrollDown();
    return row;
  }

  function petals(n) {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (let i = 0; i < n; i++) {
      const p = document.createElement("div");
      p.className = "petal";
      p.textContent = Math.random() < 0.8 ? "🥀" : "💀";
      p.style.left = Math.random() * 100 + "vw";
      p.style.animationDuration = 2.2 + Math.random() * 2 + "s";
      p.style.animationDelay = Math.random() * 0.6 + "s";
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 5000);
    }
  }

  function hateLevel() {
    const d = bot.mem.data;
    return Math.min(100, Math.round(66 + d.insults * 4 + d.compliments * 2 + Math.min(d.messages, 40) * 0.5));
  }

  function refreshHate() {
    const v = hateLevel();
    $("hate-fill").style.width = v + "%";
    $("hate-value").textContent = v + "%";
  }

  function fillList(dl, pairs) {
    dl.textContent = "";
    for (const [k, v] of pairs) {
      const dt = document.createElement("dt"); dt.textContent = k;
      const dd = document.createElement("dd"); dd.textContent = v;
      dl.append(dt, dd);
    }
  }

  function refreshDrawer() {
    const d = bot.mem.data;
    fillList($("memory-list"), [
      ["nama", d.name || "— (belum bilang)"],
      ["umur", d.age || "—"],
      ["suka", d.likes.join(", ") || "—"],
      ["benci", d.hates.join(", ") || "—"],
      ["ngehina gw", d.insults + "x"],
      ["glazing gw", d.compliments + "x"],
      ["total chat", String(d.messages)],
      ["kenal sejak", new Date(d.firstSeen).toLocaleDateString("id-ID")],
    ]);
    const b = bot.brain;
    fillList($("brain-stats"), [
      ["params", b.paramCount.toLocaleString("en-US")],
      ["intents", String(b.clsTags.length)],
      ["vocab", b.vocab.length + " kata"],
      ["trained", b.trainedAt],
      ["api key", "none lol"],
    ]);
  }

  function setDrawer(open) {
    $("drawer").classList.toggle("open", open);
    $("scrim").classList.toggle("open", open);
    $("drawer").setAttribute("aria-hidden", String(!open));
    if (open) refreshDrawer();
  }

  async function send(text) {
    text = text.trim();
    if (!text || busy || !bot) return;
    busy = true;
    sendBtn.disabled = true;
    input.value = "";
    addMessage("user", text);
    const typing = showTyping();
    const t0 = performance.now();
    const res = bot.reply(text);
    const wait = Math.max(0, Math.min(1400, 350 + res.text.length * 12) - (performance.now() - t0));
    await new Promise((r) => setTimeout(r, wait));
    typing.remove();
    const row = addMessage("bot", res.text, res.meta);
    if (res.meta.intent === "insult_long") { petals(18); row.classList.add("shake"); }
    else if (HARD_ROASTS.has(res.meta.intent)) petals(6);
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
    if (!confirm("hapus semua memori? gw bakal lupa lu (finally)")) return;
    bot.mem.wipe();
    chat.textContent = "";
    refreshDrawer();
    refreshHate();
    addMessage("bot", "memory wiped. who r u again? idc 🥀");
  });

  try { if (storage && storage.getItem("sybau_brain_on") === "1") $("brain-toggle").click(); } catch (e) { /* ignore */ }

  BrainLib.loadBrain("model/brain.json").then((brain) => {
    bot = new BotLib.RoastBot(brain, { storage });
    const d = bot.mem.data;
    if (d.history.length) {
      addNote("chat lama (gw inget semuanya 🥀)");
      for (const m of d.history.slice(-30)) addMessage(m.role, m.text, m.meta);
      addMessage("bot", d.name ? "oh " + d.name + " is back. ugh 🥀" : "oh ur back. ugh 🥀");
    } else {
      addMessage("bot", "yo. i'm sybau.ai, a neural net trained from scratch to hate u 🥀 tell me ur name or just say something mid");
    }
    refreshHate();
    $("loader").classList.add("gone");
    input.focus();
  }).catch((err) => {
    $("loader-text").textContent = "brain failed to load 💀 (" + err.message + "). kalo buka file langsung, pake server: python -m http.server";
  });
})();
