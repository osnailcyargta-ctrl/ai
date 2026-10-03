/* code.js — sybau code: a coding chat that writes STS programs (see stscoder.js). */
(function () {
  "use strict";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  let ui = null, coder = null, previewVM = null, loading = null, busy = false, running = null;

  const settings = () => { try { return JSON.parse(localStorage.getItem("sybau_settings") || "{}"); } catch (e) { return {}; } };
  const lang = () => (settings().lang === "en" ? "en" : "id");
  const T = {
    id: { title: "sybau code", sub: "bikin program STS · dicek compiler STS asli", ph: "mau bikin apa? contoh: game hindarin meteor pake 3 nyawa", foot: "enter kirim · shift+enter baris baru · tab s di atas buat balik ngobrol",
      hello: "yo. gw sybau code. bilang mau program STS apa. gw riset dulu bendanya di wikipedia, ngedesain gamenya, nulis kodenya dari nol, compile, terus gw tes mainin sendiri. lu tinggal bengong 🥀",
      think: "mikir", dl: "download .sts", copy: "salin", copied: "kesalin", run: "jalanin", stop: "stop", ok: "lolos compiler STS", warn: "masih ada error", tests: "tes lolos", loading: "loading otak coding + compiler STS…" },
    en: { title: "sybau code", sub: "writes STS programs · checked by the real STS compiler", ph: "what should i build? e.g. dodge falling meteors with 3 lives", foot: "enter send · shift+enter new line · tab s up top to go back to chat",
      hello: "yo. i'm sybau code. tell me what STS program u want. i research the things on wikipedia, design it, write it from scratch, compile it and play-test it myself. u just sit there 🥀",
      think: "thinking", dl: "download .sts", copy: "copy", copied: "copied", run: "run", stop: "stop", ok: "passed the STS compiler", warn: "still has errors", tests: "tests passed", loading: "loading coding brain + STS compiler…" },
  };
  const t = () => T[lang()];
  const LINES = {
    id: { ok: ["nih. gw riset, desain, terus nulis {n} baris dari nol. lolos compiler, semua tes lolos. jangan bangga, yang mikir gw 🥀", "udah jadi. compiler sama tes gw aja setuju, beda sama lu 💀", "beres. {n} baris STS, gamenya udah gw mainin sendiri dan jalan. kalo lu yang ngetik pasti udah 40 error 🥀"],
      tests: ["kodenya lolos compiler, tapi {k} tes kelakuan gagal. jujur aja, bagian itu belum bener 💀"],
      fixed: ["sempet error {k}x, udah gw benerin sendiri. lu mah ga bakal bisa 🥀"], runtime: ["kodenya lolos compile tapi pas dijalanin ada error. jujur aja ya, cek bagian itu 🥀"],
      fail: ["gw udah nyoba benerin tapi masih rusak. jujur, ini di luar kemampuan gw sekarang 💀"], docs: ["nih dari docs STS. baca pelan pelan 🥀", "dokumentasinya bilang gini. lain kali baca sendiri 💀"],
      guess: ["jujur gw ga terlalu ngerti lu mau apa, jadi ini tebakan. mau yang lain? jelasin lebih detail 🥀"] },
    en: { ok: ["researched, designed, wrote {n} lines from scratch. compiler passed, every test passed. don't be proud, i did the thinking 🥀", "done. even the compiler and my tests agree with me, unlike u 💀"],
      tests: ["it compiles, but {k} behaviour tests failed. being honest, that part isn't right yet 💀"],
      fixed: ["it errored {k}x, i fixed it myself. u never would 🥀"], runtime: ["it compiles but hits an error when it runs. being honest, check that part 🥀"],
      fail: ["tried to fix it, still broken. honestly beyond me right now 💀"], docs: ["straight from the STS docs. read slowly 🥀"], guess: ["honestly not sure what u want, so this is a guess. describe it more 🥀"] },
  };
  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  // ---------------------------------------------------------------- STS highlighting
  const KW = "on|draw|setup|coll|solid|detect|click|hover|if|elif|else|while|forever|repeat|def|return|goto|wait|break|continue|var|and|or|not|onclick|onhover|oncollide|check|show|timer|stopwatch|countdown|every|start|stop|reset|clear|color|true|false|nil";
  const SH = "rect|square|circle|ellipse|triangle|line|text|image|video";
  function highlight(code) {
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return code.split("\n").map((line) => {
      if (/^@root/.test(line)) return '<span class="sx-root">' + esc(line) + "</span>";
      const ci = line.indexOf("//");
      let codePart = ci >= 0 ? line.slice(0, ci) : line, comment = ci >= 0 ? line.slice(ci) : "";
      const parts = codePart.split(/("[^"]*")/);
      const out = parts.map((p, i) => {
        if (i % 2) return '<span class="sx-str">' + esc(p) + "</span>";
        return esc(p).replace(new RegExp("\\b(" + KW + ")\\b", "g"), '<span class="sx-kw">$1</span>').replace(new RegExp("\\b(" + SH + ")\\b", "g"), '<span class="sx-shape">$1</span>')
          .replace(/(\/(?:var|id|time))/g, '<span class="sx-ref">$1</span>').replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="sx-num">$1</span>').replace(/(#\d+)\b/g, '<span class="sx-num">$1</span>');
      }).join("");
      return out + (comment ? '<span class="sx-com">' + esc(comment) + "</span>" : "");
    }).join("\n");
  }

  // ---------------------------------------------------------------- the "sc" tab
  function build() {
    const view = document.getElementById("code-view");
    const log = el("div", "cx-log");
    const form = el("form", "prompt cx-prompt");
    const input = el("textarea");
    input.rows = 1;
    input.spellcheck = false;
    input.setAttribute("aria-label", "sybau code");
    form.append(el("span", "caret", ">"), input);
    const foot = el("div", "cx-foot dim");
    view.append(log, form, foot);
    form.addEventListener("submit", (e) => { e.preventDefault(); send(); });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
    input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 140) + "px"; });
    log.addEventListener("click", () => { if (!window.getSelection().toString() && !(running && document.activeElement && document.activeElement.tagName === "CANVAS")) input.focus(); });
    ui = { view, log, input, foot };
    relabel();
  }
  function relabel() {
    ui.input.placeholder = t().ph;
    ui.foot.textContent = t().foot;
  }
  const put = (n) => { ui.log.appendChild(n); ui.log.scrollTop = ui.log.scrollHeight; return n; };
  function say(text) {
    const r = el("div", "block row");
    r.append(el("span", "dot", "●"), el("div", "txt", text));
    return put(r);
  }

  async function ensure() {
    if (coder) return coder;
    if (!loading) loading = (async () => {
      const [wasm, wasm2, model, docs, things] = await Promise.all([
        fetch("assets/sts/sts.wasm").then((r) => r.arrayBuffer()), fetch("assets/sts/sts.wasm").then((r) => r.arrayBuffer()),
        fetch("model/coder.json").then((r) => r.json()), fetch("data/sts/docs.md").then((r) => r.text()), fetch("data/sts/things.json").then((r) => r.json())]);
      const vm = await StsLib.StsVM.load(wasm);
      previewVM = await StsLib.StsVM.load(wasm2, { onPopup: (k, txt) => running && running.popup(k, txt), onBackground: (c) => { if (running) running.bg = c; } });
      coder = new StsCoderLib.StsCoder({ coderModel: model, vm, docs, things, search: window.SearchLib });
      return coder;
    })();
    return loading;
  }

  async function open() {
    if (!ui) build();
    relabel();
    ui.input.focus();
    if (!ui.log.childElementCount) {
      const note = put(el("div", "line dim", t().loading));
      try { await ensure(); note.remove(); say(t().hello); }
      catch (e) { note.textContent = "error: " + e.message; note.className = "line red"; }
    }
  }

  // ---------------------------------------------------------------- tabs: s (chat) | sc (code)
  const TITLES = { s: ["sybau.ai", "— ~/ur-life (cooked)"], sc: ["sybau code", "— ~/projects (also cooked)"] };
  function setTab(tab, remember = true) {
    tab = tab === "sc" ? "sc" : "s";
    document.body.dataset.tab = tab;
    for (const b of document.querySelectorAll(".tab")) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
    document.getElementById("screen").hidden = tab !== "s";
    document.querySelector(".dock").hidden = tab !== "s";
    document.getElementById("code-view").hidden = tab !== "sc";
    const title = document.getElementById("win-title");
    title.textContent = TITLES[tab][0] + " ";
    title.appendChild(el("span", "dim", TITLES[tab][1]));
    document.title = TITLES[tab][0];
    if (remember) { try { localStorage.setItem("sybau_tab", tab); } catch (e) { /* ignore */ } if (location.hash !== "#" + tab) history.replaceState(null, "", tab === "sc" ? "#sc" : location.pathname + location.search); }
    if (tab === "sc") open();
    else { stopRun(); const i = document.getElementById("input"); if (i && !i.disabled) i.focus(); }
  }
  window.SybauCode = { setTab, focus: () => ui && ui.input.focus(), get tab() { return document.body.dataset.tab || "s"; } };

  async function send() {
    const text = ui.input.value.trim();
    if (!text || busy) return;
    busy = true;
    ui.input.value = "";
    ui.input.style.height = "auto";
    const u = el("div", "u");
    u.append(el("span", "gt", ">"), document.createTextNode(text));
    put(u);
    const think = el("details", "cx-think");
    think.open = true;
    const sum = el("summary", null, "✻ " + t().think + "…");
    const lines = el("div", "cx-steps");
    think.append(sum, lines);
    put(think);
    const t0 = performance.now();
    let res;
    try {
      await ensure();
      res = await coder.handle(text, { experimental: !!settings().experimental, search: settings().search !== false, lang: lang(), onStep: (s) => { lines.appendChild(el("div", "line dim", s)); ui.log.scrollTop = ui.log.scrollHeight; } });
    } catch (e) {
      lines.appendChild(el("div", "line red", "error: " + e.message));
      busy = false;
      return;
    }
    await sleep(Math.max(0, 500 - (performance.now() - t0)));
    sum.textContent = "✻ " + t().think + " · " + res.steps.length + (lang() === "id" ? " langkah · " : " steps · ") + ((performance.now() - t0) / 1000).toFixed(1) + "s";
    if (res.steps.length > 6) think.open = false;
    const L = LINES[res.lang === "en" ? "en" : "id"];
    if (res.kind === "cant") {
      say(res.text);
    } else if (res.kind === "docs") {
      say(pick(L.docs));
      const d = el("div", "cx-doc");
      d.append(el("div", "bold", res.head), el("div", "cx-doc-body", res.body));
      put(d);
    } else {
      const n = res.program.roots.reduce((s, r) => s + r.code.split("\n").length, 0);
      const failed = (res.tests || []).filter((x) => !x.ok).length;
      let line = res.compiled === true ? (failed ? pick(L.tests).replace("{k}", failed) : res.fixes.length ? pick(L.fixed).replace("{k}", res.fixes.length) : pick(L.ok)) : res.compiled === "runtime" ? pick(L.runtime) : pick(L.fail);
      if (res.program && res.features.length === 1 && res.features[0] === "shapes" && /ga ada yang gw kenal|nothing i recognise/.test(res.steps.join(" "))) line = pick(L.guess);
      say(line.replace("{n}", n));
      put(codeBlock(res, n));
    }
    busy = false;
    ui.input.focus();
  }

  function codeBlock(res, n) {
    const box = el("div", "cx-code");
    const head = el("div", "cx-code-head");
    const tests = res.tests || [], passed = tests.filter((x) => x.ok).length;
    const good = res.compiled === true && passed === tests.length;
    const status = el("span", good ? "green" : "red", (res.compiled === true ? "✓ " + t().ok : "× " + t().warn) + (tests.length ? " · " + passed + "/" + tests.length + " " + t().tests : ""));
    head.append(el("span", "bold", res.file), el("span", "dim", " · " + n + (lang() === "id" ? " baris · " : " lines · ")), status);
    const btns = el("span", "cx-btns");
    const dl = el("button", "btn", t().dl);
    dl.type = "button";
    dl.addEventListener("click", () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([res.sts], { type: "text/plain" }));
      a.download = res.file;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
    const cp = el("button", "btn", t().copy);
    cp.type = "button";
    cp.addEventListener("click", async () => { try { await navigator.clipboard.writeText(res.sts); } catch (e) { /* ignore */ } cp.textContent = t().copied; setTimeout(() => (cp.textContent = t().copy), 1400); });
    const run = el("button", "btn", t().run);
    run.type = "button";
    btns.append(dl, cp, run);
    head.appendChild(btns);
    const pre = el("pre", "cx-pre");
    pre.innerHTML = highlight(res.sts);
    const stage = el("div", "cx-stage");
    stage.hidden = true;
    run.addEventListener("click", () => {
      if (running && running.box === stage) { stopRun(); run.textContent = t().run; return; }
      stopRun();
      startRun(res.program, stage, () => (run.textContent = t().run));
      run.textContent = t().stop;
    });
    if (res.compiled !== true) run.disabled = true;
    box.append(head, pre, stage);
    return box;
  }

  // ---------------------------------------------------------------- live preview on the real STS VM
  function startRun(prog, box, onEnd) {
    box.hidden = false;
    box.textContent = "";
    const cv = el("canvas", "cx-canvas");
    cv.width = prog.stage.w; cv.height = prog.stage.h;
    cv.tabIndex = 0;
    const pop = el("div", "cx-pop");
    pop.hidden = true;
    const info = el("div", "dim cx-runinfo", lang() === "id" ? "klik layar biar keyboard nyambung · panah/wasd/spasi" : "click the stage to give it the keyboard · arrows/wasd/space");
    box.append(cv, pop, info);
    const ctx = cv.getContext("2d");
    const res = previewVM.compile(prog.roots);
    if (!res.ok) { info.textContent = "compile error: " + res.error; info.className = "red"; return; }
    previewVM.start();
    const st = { box, bg: "#101a0c", raf: 0, waiting: false, onEnd };
    st.popup = (kind, text) => {
      st.waiting = true;
      pop.textContent = "";
      pop.appendChild(el("div", null, text));
      let inp = null;
      if (kind === 1) { inp = el("input"); pop.appendChild(inp); }
      const ok = el("button", "btn", "ok");
      ok.type = "button";
      ok.addEventListener("click", () => { pop.hidden = true; st.waiting = false; if (kind === 1) previewVM.answer(inp.value); else previewVM.ackPopup(); cv.focus(); });
      pop.appendChild(ok);
      pop.hidden = false;
      (inp || ok).focus();
      if (inp) inp.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") ok.click(); });
    };
    const keyName = (e) => (e.key === " " ? "space" : e.key.startsWith("Arrow") ? e.key.slice(5).toLowerCase() : e.key.toLowerCase());
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
    cv.addEventListener("keydown", (e) => { e.preventDefault(); e.stopPropagation(); previewVM.key(keyName(e), true); });
    cv.addEventListener("keyup", (e) => { e.stopPropagation(); previewVM.key(keyName(e), false); });
    cv.addEventListener("mousemove", (e) => previewVM.mouseMove(...pos(e)));
    cv.addEventListener("mousedown", (e) => { cv.focus(); previewVM.mouseDown(1); previewVM.click(...pos(e)); });
    cv.addEventListener("mouseup", () => previewVM.mouseDown(0));
    let last = performance.now();
    const frame = (now) => {
      st.raf = requestAnimationFrame(frame);
      const dt = Math.min(50, now - last); last = now;
      if (!st.waiting) {
        const s = previewVM.tick(dt);
        if (s === StsLib.STATE.ERROR) { info.textContent = "runtime error: " + previewVM.runtimeError(); info.className = "red"; cancelAnimationFrame(st.raf); }
      }
      ctx.fillStyle = st.bg; ctx.fillRect(0, 0, cv.width, cv.height);
      for (const o of previewVM.objects()) {
        if (!o.visible) continue;
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, o.alpha));
        if (o.rot) { ctx.translate(o.x + o.w / 2, o.y + o.h / 2); ctx.rotate(o.rot * Math.PI / 180); ctx.translate(-(o.x + o.w / 2), -(o.y + o.h / 2)); }
        ctx.fillStyle = ctx.strokeStyle = o.color || "#93cc5f";
        if (o.kind === "rect") ctx.fillRect(o.x, o.y, o.w, o.h);
        else if (o.kind === "circle") { ctx.beginPath(); ctx.arc(o.x + o.w / 2, o.y + o.h / 2, Math.abs(o.w / 2), 0, 6.2832); ctx.fill(); }
        else if (o.kind === "ellipse") { ctx.beginPath(); ctx.ellipse(o.x + o.w / 2, o.y + o.h / 2, Math.abs(o.w / 2), Math.abs(o.h / 2), 0, 0, 6.2832); ctx.fill(); }
        else if (o.kind === "triangle") { ctx.beginPath(); ctx.moveTo(o.x + o.w / 2, o.y); ctx.lineTo(o.x + o.w, o.y + o.h); ctx.lineTo(o.x, o.y + o.h); ctx.closePath(); ctx.fill(); }
        else if (o.kind === "line") { ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.w, o.h); ctx.stroke(); }
        else if (o.kind === "text") { ctx.font = "600 " + Math.max(6, o.h) + "px system-ui, sans-serif"; ctx.textBaseline = "top"; ctx.fillText(o.text, o.x, o.y); }
        else { ctx.strokeStyle = "#575d57"; ctx.strokeRect(o.x + 0.5, o.y + 0.5, o.w, o.h); }
        ctx.restore();
      }
    };
    st.raf = requestAnimationFrame(frame);
    running = st;
    cv.focus();
  }
  function stopRun() {
    if (!running) return;
    cancelAnimationFrame(running.raf);
    try { previewVM.stop(); } catch (e) { /* ignore */ }
    running.box.hidden = true;
    running.box.textContent = "";
    if (running.onEnd) running.onEnd();
    running = null;
  }

  for (const b of document.querySelectorAll(".tab")) b.addEventListener("click", () => setTab(b.dataset.tab));
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.altKey && !e.shiftKey && (e.code === "KeyM" || (e.key || "").toLowerCase() === "m")) {
      e.preventDefault();
      setTab(document.body.dataset.tab === "sc" ? "s" : "sc");
    }
  }, true);
  let start = "s";
  try { start = location.hash === "#sc" ? "sc" : location.hash === "#s" ? "s" : localStorage.getItem("sybau_tab") || "s"; } catch (e) { /* ignore */ }
  setTab(start, false);
})();
