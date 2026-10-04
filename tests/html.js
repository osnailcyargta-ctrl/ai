// node tests/html.js -> the HTML/JS/CSS mode: every game is valid JavaScript and runs 5 seconds in a fake browser without errors
const fs = require("fs"), path = require("path"), vmod = require("vm");
global.BrainLib = require("../assets/js/brain.js");
BrainLib.setTextConfig(JSON.parse(fs.readFileSync(path.join(__dirname, "../model/brain.json"), "utf8")).text);
global.StsLib = require("../assets/js/stsvm.js");
global.StsGenLib = require("../assets/js/stsgen.js");
global.JsGenLib = require("../assets/js/jsgen.js");
const SearchLib = require("../assets/js/search.js");
const { fakeFetch } = require("./fake_wiki.js");
const { StsCoder } = require("../assets/js/stscoder.js");

/** run a page's script in a tiny fake browser for n frames */
function runPage(js, frames) {
  const listeners = {}, rafs = [];
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => ((t[k] = v), true) });
  const el = () => ({ getContext: () => ctx, addEventListener: (ev, fn) => (listeners[ev] = listeners[ev] || []).push(fn), getBoundingClientRect: () => ({ left: 0, top: 0, width: 520, height: 360 }), width: 520, height: 360, textContent: "", dataset: { i: "0" } });
  const nodes = {};
  const sandbox = {
    document: { getElementById: (id) => (nodes[id] = nodes[id] || el()), querySelectorAll: () => [el(), el(), el()] },
    addEventListener: (ev, fn) => (listeners[ev] = listeners[ev] || []).push(fn),
    requestAnimationFrame: (fn) => rafs.push(fn), performance: { now: () => Date.now() },
    setTimeout: (fn) => rafs.push(fn), setInterval: () => 0, alert: () => {}, prompt: () => "1", Math, console, Object, Array, String, Number, JSON,
  };
  vmod.createContext(sandbox);
  vmod.runInContext(js, sandbox, { timeout: 3000 });
  let t = 0;
  for (let f = 0; f < frames; f++) {
    const batch = rafs.splice(0);
    t += 16;
    for (const fn of batch) fn(t);
    const k = { key: ["ArrowRight", "ArrowLeft", " ", "ArrowUp"][f % 4], preventDefault() {} };
    for (const fn of listeners.keydown || []) fn(k);
    if (f % 20 === 0) for (const fn of listeners.mousedown || []) fn({ clientX: 100 + f, clientY: 150, preventDefault() {} });
  }
}

const requests = process.argv.length > 2 ? process.argv.slice(2) : [
  "bikin game ninja lempar shuriken ke zombie", "game kucing makan ikan, hindarin anjing yang ngejar", "tangkap semangka yang jatuh pake 3 nyawa", "flappy bird", "pong",
  "labirin kumpulin 3 bintang", "game lompat lompatin batu", "pukul tikus yang muncul", "bikinin game clicker pake toko upgrade", "kalkulator sederhana",
  "tebak angka 1 sampe 50", "tictactoe", "game snake", "suit lawan komputer", "lempar dadu", "lampu lalu lintas", "kuis matematika 3 soal", "game glorbo",
];
(async () => {
  const vm = await StsLib.StsVM.load(fs.readFileSync(path.join(__dirname, "../assets/sts/sts.wasm")));
  const coder = new StsCoder({ coderModel: JSON.parse(fs.readFileSync(path.join(__dirname, "../model/coder.json"), "utf8")), vm,
    things: JSON.parse(fs.readFileSync(path.join(__dirname, "../data/sts/things.json"), "utf8")), search: SearchLib, fetch: fakeFetch });
  let bad = 0;
  for (const r of requests) {
    coder.last = null;
    const res = await coder.handle(r, { html: true });
    let err = null;
    if (res.kind !== "code" || !res.html) err = "no html (" + res.kind + ")";
    else { try { runPage(res.html.js, 300); } catch (e) { err = e.message; } }
    if (err) bad++;
    console.log((err ? "FAIL " : "ok   ") + r.padEnd(52) + (res.html ? res.html.lines + " lines " + res.file : "") + (err ? "  — " + err : ""));
    if (err && process.env.SHOW) console.log(res.html ? res.html.js : res);
  }
  console.log(bad ? bad + " failed" : "all html games run");
  process.exit(bad ? 1 : 0);
})();
