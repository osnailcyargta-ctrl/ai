/* code.js — sybau code: a coding chat that writes HTML/JS/CSS games and apps (see htmlcoder.js). */
(function () {
  "use strict";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  let ui = null, coder = null, loading = null, busy = false, running = null, stopper = null;

  const settings = () => { if (window.SybauSettings) return window.SybauSettings.get(); try { return JSON.parse(localStorage.getItem("sybau_settings") || "{}"); } catch (e) { return {}; } };
  const lang = () => (settings().lang === "en" ? "en" : "id");
  const T = {
    id: { ph: "mau bikin apa? contoh: game ninja lempar shuriken ke zombie", foot: "enter kirim · shift+enter baris baru · esc stop · tab s di atas buat balik ngobrol",
      hello: "yo. gw sybau code. bilang mau game/app apa, gw tulis HTML + CSS + JavaScript-nya pake transformer gw sendiri, token per token, terus gw tes jalanin. abis itu lu bisa suruh ubah: \"ubah speed jadi 10\", \"ganti zombie jadi alien\", \"background merah\", \"balikin\", \"variabelnya apa aja?\" 🥀",
      think: "mikir", dl: "download .html", copy: "salin", copied: "kesalin", run: "jalanin", stop: "stop", ok: "jalan tanpa error", loading: "loading otak coding (transformer + pembaca maksud)…" },
    en: { ph: "what should i build? e.g. a ninja throwing shurikens at zombies", foot: "enter send · shift+enter new line · esc stop · tab s up top to go back to chat",
      hello: "yo. i'm sybau code. tell me what game/app u want, my own transformer writes the HTML + CSS + JavaScript token by token, then i test-run it. after that u can say: \"change speed to 10\", \"replace zombie with alien\", \"red background\", \"undo\", \"what variables are there?\" 🥀",
      think: "thinking", dl: "download .html", copy: "copy", copied: "copied", run: "run", stop: "stop", ok: "runs with no errors", loading: "loading coding brain (transformer + request reader)…" },
  };
  const t = () => T[lang()];
  const LINES = {
    id: { neural: ["nih. {n} baris, ditulis transformer gw sendiri token per token, udah gw jalanin dan ga error. jangan bangga, yang mikir gw 🥀", "udah jadi. {n} baris HTML/CSS/JS, dites jalan. kalo lu yang ngetik pasti udah 40 error 💀", "beres. transformer gw nulis {n} baris dari nol, lolos tes. lu tinggal main 🥀"] },
    en: { neural: ["here. {n} lines, written by my own transformer token by token, test-run with no errors. don't be proud, i did the thinking 🥀", "done. {n} lines of HTML/CSS/JS, tested. if u typed it there'd be 40 errors 💀"] },
  };
  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  // ---------------------------------------------------------------- HTML/CSS/JS highlighting
  const JS_KW = "const|let|var|function|return|if|else|for|while|do|of|in|new|true|false|null|this|break|continue|switch|case|async|await|try|catch|typeof";
  function highlight(code) {
    const escH = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return code.split("\n").map((line) => {
      const ci = line.search(/\/\/(?![^"]*"[^"]*$)/);
      const body = ci >= 0 ? line.slice(0, ci) : line, comment = ci >= 0 ? line.slice(ci) : "";
      return body.split(/("[^"]*"|'[^']*')/).map((p, i) => {
        if (i % 2) return '<span class="sx-str">' + escH(p) + "</span>";
        return escH(p).replace(/(&lt;\/?)([a-z][a-z0-9]*)/g, '$1<span class="sx-kw">$2</span>')
          .replace(new RegExp("\\b(" + JS_KW + ")\\b", "g"), '<span class="sx-shape">$1</span>')
          .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="sx-num">$1</span>');
      }).join("") + (comment ? '<span class="sx-com">' + escH(comment) + "</span>" : "");
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
    const footText = el("span");
    const deep = el("button", "cx-deep");
    deep.type = "button";
    deep.addEventListener("click", () => {
      const on = !settings().deepthink;
      if (window.SybauSettings) window.SybauSettings.set("deepthink", on);
      relabel(); input.focus();
    });
    foot.append(deep, footText);
    view.append(log, form, foot);
    form.addEventListener("submit", (e) => { e.preventDefault(); send(); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
      if (e.key === "Escape" && stopper) { stopper.stop = true; }
    });
    input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 140) + "px"; });
    log.addEventListener("click", () => { if (!window.getSelection().toString() && !running) input.focus(); });
    ui = { view, log, input, foot, footText, deep };
    relabel();
  }
  function relabel() {
    ui.input.placeholder = t().ph;
    ui.footText.textContent = t().foot;
    const on = !!settings().deepthink;
    ui.deep.textContent = (on ? "◆ " : "◇ ") + "deepthink " + (on ? "on" : "off");
    ui.deep.classList.toggle("on", on);
    ui.deep.title = lang() === "id" ? "mikir lebih lama: 6 percobaan, dipilih yang paling bagus" : "think longer: 6 attempts, the best one wins";
  }
  const put = (n) => { ui.log.appendChild(n); ui.log.scrollTop = ui.log.scrollHeight; return n; };
  function say(text) {
    const r = el("div", "block row");
    r.append(el("span", "dot", "●"), el("div", "txt", text));
    return put(r);
  }

  // ---------------------------------------------------------------- test-run a page in a hidden sandbox
  function sandboxCheck(html) {
    return new Promise((resolve) => {
      const token = Math.random().toString(36).slice(2);
      const probe = "<script>(function(){var T='" + token + "',sent=0;function s(m){if(sent)return;sent=1;parent.postMessage({sybauCheck:T,r:m},'*')}" +
        "window.addEventListener('error',function(e){s({ok:false,error:String(e.message||e),line:e.lineno||0})});" +
        "window.alert=window.confirm=function(){return true};window.prompt=function(){return '5'};" +
        "window.addEventListener('load',function(){var k=['ArrowLeft','ArrowRight','ArrowUp',' ','Enter','a','d','w'],i=0;var iv=setInterval(function(){var key=k[i++%k.length];" +
        "try{document.dispatchEvent(new KeyboardEvent('keydown',{key:key,bubbles:true}));window.dispatchEvent(new KeyboardEvent('keydown',{key:key}));if(window.onkeydown)window.onkeydown({key:key,preventDefault:function(){}});if(window.onkeyup)window.onkeyup({key:key,preventDefault:function(){}});" +
        "var c=document.querySelector('canvas,button,.cell,.card,td');if(c){var r=c.getBoundingClientRect();var ev={clientX:r.left+r.width/2,clientY:r.top+r.height/2,offsetX:r.width/2,offsetY:r.height/2,bubbles:true};c.dispatchEvent(new MouseEvent('mousemove',ev));c.dispatchEvent(new MouseEvent('mousedown',ev));c.dispatchEvent(new MouseEvent('mouseup',ev));c.dispatchEvent(new MouseEvent('click',ev));}}catch(e){s({ok:false,error:String(e.message||e)})}},60);" +
        "setTimeout(function(){clearInterval(iv);var c=document.querySelector('canvas'),colors=0;if(c&&c.getContext){try{var d=c.getContext('2d').getImageData(0,0,c.width,c.height).data,set={};for(var j=0;j<d.length;j+=388)set[d[j]+','+d[j+1]+','+d[j+2]+','+d[j+3]]=1;colors=Object.keys(set).length}catch(e){}}" +
        "var txt=document.body?document.body.innerText.trim().length:0;s(c&&colors<2&&!txt?{ok:false,error:'layarnya kosong'}:{ok:true,colors:colors})},900)})})()<\/script>";
      const page = /<head>/i.test(html) ? html.replace(/<head>/i, "<head>" + probe) : probe + html;
      const f = document.createElement("iframe");
      f.setAttribute("sandbox", "allow-scripts");
      f.style.cssText = "position:fixed;left:-10000px;top:0;width:640px;height:480px;border:0";
      let done = false;
      const finish = (r) => { if (done) return; done = true; window.removeEventListener("message", onMsg); f.remove(); resolve(r); };
      const onMsg = (e) => { if (e.data && e.data.sybauCheck === token) finish(e.data.r); };
      window.addEventListener("message", onMsg);
      setTimeout(() => finish({ ok: false, error: "ga selesai loading (mungkin loop tanpa akhir)" }), 4000);
      f.srcdoc = page;
      document.body.appendChild(f);
    });
  }

  async function ensure() {
    if (coder) return coder;
    if (!loading) loading = (async () => {
      const get = (u) => fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const [nluJson, modelJson, pool] = await Promise.all([get("model/codenlu.json"), get("model/htmlcode.json"), get("data/html/things.json")]);
      if (!modelJson) throw new Error(lang() === "id" ? "transformer penulis kodenya (model/htmlcode.json) belum ada, lagi dilatih. coba lagi nanti" : "the code transformer (model/htmlcode.json) isn't there yet, it's still training. try again later");
      coder = new HtmlCoderLib.HtmlCoder({
        nlu: nluJson ? new CodeNLULib.CodeNLU(nluJson) : null,
        writers: [new HtmlNeuralLib.HtmlWriter(modelJson)],
        pool: pool || {},
        check: sandboxCheck,
        chat: (text) => (window.SybauChat ? window.SybauChat(text) : (lang() === "id" ? "oke. mau bikin apa?" : "ok. what should i build?")),
      });
      try { coder.loadState(JSON.parse(localStorage.getItem(MEM_KEY) || "null")); } catch (e) { /* ignore */ }
      return coder;
    })();
    return loading;
  }

  // ---------------------------------------------------------------- memory (survives a reload)
  const MEM_KEY = "sybau_html_memory", LOG_KEY = "sybau_html_log";
  try { localStorage.removeItem("sybau_code_memory"); localStorage.removeItem("sybau_code_log"); } catch (e) { /* old STS memory */ }
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(LOG_KEY) || "[]"); } catch (e) { saved = []; }
  function remember(entry) {
    saved.push(entry);
    if (saved.length > 30) saved = saved.slice(-30);
    const keepCode = (list) => { let seen = 0; for (let i = list.length - 1; i >= 0; i--) if (list[i].role === "code" && ++seen > 3) list[i] = { role: "b", text: "(" + list[i].res.file + ")" }; return list; };
    try {
      localStorage.setItem(LOG_KEY, JSON.stringify(keepCode(saved)));
      if (coder) localStorage.setItem(MEM_KEY, JSON.stringify(coder.saveState()));
    } catch (e) { saved = saved.slice(-6); }
  }
  function replay() {
    for (const e of saved) {
      if (e.role === "u") { const u = el("div", "u"); u.append(el("span", "gt", ">"), document.createTextNode(e.text)); put(u); }
      else if (e.role === "b") say(e.text);
      else if (e.role === "code" && e.res && e.res.html) put(codeBlock(e.res));
    }
  }

  async function open() {
    if (!ui) build();
    relabel();
    ui.input.focus();
    if (!ui.log.childElementCount) {
      const note = put(el("div", "line dim", t().loading));
      try {
        await ensure(); note.remove();
        if (saved.length) { replay(); say(lang() === "id" ? "gw masih inget yang tadi. lanjut aja, atau bilang \"hapus semua\" buat mulai baru 🥀" : "i still remember what we were doing. keep going, or say \"delete everything\" to start fresh 🥀"); }
        else say(t().hello);
      } catch (e) { note.textContent = "error: " + e.message; note.className = "line red"; }
    }
  }

  // ---------------------------------------------------------------- tabs: s (chat) | sc (code)
  const TITLES = { s: ["sybau.ai", "— ~/ur-life (cooked)"], sc: ["sybau code", "— ~/projects (also cooked)"] };
  function setTab(tab, keep = true) {
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
    if (keep) { try { localStorage.setItem("sybau_tab", tab); } catch (e) { /* ignore */ } if (location.hash !== "#" + tab) history.replaceState(null, "", tab === "sc" ? "#sc" : location.pathname + location.search); }
    if (tab === "sc") open();
    else { stopRun(); const i = document.getElementById("input"); if (i && !i.disabled) i.focus(); }
  }
  window.SybauCode = { setTab, focus: () => ui && ui.input.focus(), get tab() { return document.body.dataset.tab || "s"; } };

  async function send() {
    const typed = ui.input.value.trim();
    if (!typed || busy) return;
    ui.input.value = "";
    ui.input.style.height = "auto";
    return run(typed);
  }

  async function run(text) {
    if (busy) return;
    busy = true;
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
    let res, live = null;
    remember({ role: "u", text });
    stopper = { stop: false };
    try {
      await ensure();
      res = await coder.handle(text, {
        lang: settings().lang === "en" ? "en" : settings().lang === "id" ? "id" : undefined,
        deepthink: !!settings().deepthink, signal: stopper,
        onStep: (s) => { lines.appendChild(el("div", "line dim", s)); ui.log.scrollTop = ui.log.scrollHeight; },
        onCode: (attempt, toks, slots) => {
          if (!live) { live = el("div", "cx-code cx-live"); live.append(el("div", "cx-code-head dim"), el("pre", "cx-pre")); put(live); }
          live.firstChild.textContent = (lang() === "id" ? "✎ transformer lagi ngetik · percobaan " : "✎ transformer typing · attempt ") + attempt + " · " + toks.length + " token";
          live.lastChild.innerHTML = highlight(HtmlTokLib.detokenize(toks, slots));
          live.lastChild.scrollTop = live.lastChild.scrollHeight;
          ui.log.scrollTop = ui.log.scrollHeight;
        },
      });
    } catch (e) {
      lines.appendChild(el("div", "line red", "error: " + e.message));
      busy = false; stopper = null;
      return;
    }
    stopper = null;
    if (live) live.remove();
    await sleep(Math.max(0, 300 - (performance.now() - t0)));
    sum.textContent = "✻ " + t().think + " · " + res.steps.length + (lang() === "id" ? " langkah · " : " steps · ") + ((performance.now() - t0) / 1000).toFixed(1) + "s";
    if (res.steps.length > 5) think.open = false;
    if (res.kind === "code") {
      const L = LINES[res.lang === "en" ? "en" : "id"];
      const line = res.text || pick(L.neural).replace("{n}", res.lines);
      say(line);
      put(codeBlock(res));
      remember({ role: "b", text: line });
      remember({ role: "code", res: { html: res.html, file: res.file, lines: res.lines } });
    } else {
      say(res.text);
      remember({ role: "b", text: res.text });
      if (res.kind === "failed" && res.html) {
        const d = el("details", "cx-think");
        d.append(el("summary", null, lang() === "id" ? "liat hasil rusaknya" : "see the broken attempt"), el("pre", "cx-pre", res.html));
        put(d);
      }
    }
    busy = false;
    ui.input.focus();
  }

  function codeBlock(res) {
    const box = el("div", "cx-code");
    const head = el("div", "cx-code-head");
    head.append(el("span", "bold", res.file), el("span", "dim", " · " + res.lines + (lang() === "id" ? " baris · " : " lines · ")), el("span", "green", "✓ HTML + CSS + JavaScript · " + t().ok));
    const btns = el("span", "cx-btns");
    const dl = el("button", "btn", t().dl);
    dl.type = "button";
    dl.addEventListener("click", () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([res.html], { type: "text/html" }));
      a.download = res.file;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
    const cp = el("button", "btn", t().copy);
    cp.type = "button";
    cp.addEventListener("click", async () => { try { await navigator.clipboard.writeText(res.html); } catch (e) { /* ignore */ } cp.textContent = t().copied; setTimeout(() => (cp.textContent = t().copy), 1400); });
    const runB = el("button", "btn", t().run);
    runB.type = "button";
    btns.append(dl, cp, runB);
    head.appendChild(btns);
    const pre = el("pre", "cx-pre");
    pre.innerHTML = highlight(res.html);
    const stage = el("div", "cx-stage");
    stage.hidden = true;
    runB.addEventListener("click", () => {
      if (running && running.box === stage) { stopRun(); runB.textContent = t().run; return; }
      stopRun();
      runHtml(res.html, stage, () => (runB.textContent = t().run));
      runB.textContent = t().stop;
    });
    box.append(head, pre, stage);
    return box;
  }

  /** the page runs in a sandboxed frame */
  function runHtml(html, box, onEnd) {
    box.hidden = false;
    box.textContent = "";
    const f = el("iframe", "cx-frame");
    f.setAttribute("sandbox", "allow-scripts allow-modals");
    f.srcdoc = html;
    box.appendChild(f);
    running = { box, onEnd };
    setTimeout(() => { try { f.focus(); } catch (e) { /* ignore */ } }, 100);
  }
  function stopRun() {
    if (!running) return;
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
