// node tools/make_html_corpus.js -> data/html/corpus.jsonl
// Training data for the HTML/JS/CSS code transformer. Source: the hand-written games in
// data/html/games. Every game becomes many variations, so the model learns what is free to
// change and what each request word means:
//   - the things are swapped for others of the same kind (zombie -> hantu 👻, ninja -> kucing 🐱),
//     in the request AND in the code, so "X vs Y" works for any X and Y
//   - Indonesian or English request, with different openers ("bikinin", "make", "gw mau"...)
//   - modifiers that really change the code: "pake 5 nyawa" -> let lives = 5,
//     "yang cepet" -> faster, "background merah" -> red background
//   - colours rotated, numbers in the settings nudged
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const Tok = require(ROOT + "/assets/js/htmltok.js");
const Req = require(ROOT + "/assets/js/htmlreq.js");
const DIR = path.join(ROOT, "data/html/games");
const POOL = JSON.parse(fs.readFileSync(ROOT + "/data/html/things.json", "utf8"));
const VARIANTS = +(process.env.HTML_VARIANTS || 40);

let seed = 777;
const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const pick = (a) => a[Math.floor(rand() * a.length)];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const OPEN = {
  id: ["", "", "bikin ", "bikinin ", "buat ", "buatin ", "tolong bikin ", "gw mau ", "aku mau ", "pengen ", "coba bikin ", "bikinin gw ", "pls bikin ", "bisa bikin "],
  en: ["", "", "make ", "build ", "create ", "i want ", "can you make ", "please make ", "code ", "write "],
};
const COLORS = {
  id: [["merah", "#7a1c1c"], ["biru", "#1d3557"], ["hijau", "#1b4332"], ["kuning", "#7a6a12"], ["ungu", "#3c1361"], ["hitam", "#0b0b0b"], ["pink", "#7a2650"], ["oranye", "#7a3b0c"], ["abu", "#3a3a3a"], ["putih", "#f1f1f1"]],
  en: [["red", "#7a1c1c"], ["blue", "#1d3557"], ["green", "#1b4332"], ["yellow", "#7a6a12"], ["purple", "#3c1361"], ["black", "#0b0b0b"], ["pink", "#7a2650"], ["orange", "#7a3b0c"], ["grey", "#3a3a3a"], ["white", "#f1f1f1"]],
};

function parse(src, file) {
  const r = src.match(/^<!-- request: (.+?) \|\| (.+?) -->\n/);
  const t = src.match(/^<!-- things:(.*?)-->\n/m);
  if (!r) throw new Error(file + ": no request header");
  const things = [];
  for (const part of (t ? t[1] : "").trim().split(/\s+/).filter(Boolean)) {
    const m = part.match(/^(\w+)=([^:]+):(.+)$/);
    if (!m) throw new Error(file + ": bad thing " + part);
    const [, role, name, emoji] = m;
    const entry = (POOL[role] || []).find((e) => e[0] === name) || [name, name, emoji];
    things.push({ role, id: name, en: entry[1], emoji });
  }
  const code = src.replace(/^<!-- request:.*\n/, "").replace(/^<!-- things:.*\n/, "");
  return { id: r[1].split(" | "), en: r[2].split(" | "), things, code };
}

function caseLike(word, like) { return /^[A-Z]/.test(like) ? word.charAt(0).toUpperCase() + word.slice(1) : word; }

// rotate every #rrggbb colour by the same hue amount (keeps the palette working together)
function rotateColors(code, deg) {
  return code.replace(/#([0-9a-fA-F]{6})\b/g, (m, h) => {
    let [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    if (d < 0.08) return m;   // greys stay grey
    const s = d / (1 - Math.abs(2 * l - 1));
    let hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hh = (hh * 60 + deg + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((hh / 60) % 2) - 1)), m0 = l - c / 2;
    const [r1, g1, b1] = hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
    return "#" + [r1, g1, b1].map((v) => Math.round((v + m0) * 255).toString(16).padStart(2, "0")).join("");
  });
}

function setVar(code, names, fn) {
  for (const n of names) {
    const re = new RegExp("^(\\s*let " + n + " = )(-?[\\d.]+)(;)", "m");
    if (re.test(code)) return { code: code.replace(re, (m, a, v, c) => a + fn(+v) + c), ok: true };
  }
  return { code, ok: false };
}
const fmtNum = (v, like) => (Number.isInteger(like) ? String(Math.max(1, Math.round(v))) : String(Math.round(v * 100) / 100));

// a modifier both in the request and in the code
function modifier(code, lang) {
  const kinds = [
    () => { const n = 1 + Math.floor(rand() * 9); const r = setVar(code, ["lives", "maxLives", "houseHp"], () => n); return r.ok && { code: r.code, text: lang === "id" ? pick([" pake " + n + " nyawa", " nyawanya " + n, " " + n + " nyawa"]) : pick([" with " + n + " lives", " " + n + " lives"]) }; },
    () => { const r = setVar(code, ["speed", "runSpeed", "foeSpeed", "fallSpeed", "moveSpeed", "roadSpeed", "paddleSpeed", "noteSpeed", "carSpeed"], (v) => fmtNum(v * 1.6, v)); return r.ok && { code: r.code, text: lang === "id" ? pick([" yang cepet", " cepet banget", " lebih cepet", " ngebut"]) : pick([" fast", " really fast", " faster"]) }; },
    () => { const r = setVar(code, ["speed", "runSpeed", "foeSpeed", "fallSpeed", "moveSpeed", "roadSpeed", "paddleSpeed", "noteSpeed", "carSpeed"], (v) => fmtNum(v * 0.6, v)); return r.ok && { code: r.code, text: lang === "id" ? pick([" yang pelan", " lambat", " santai aja"]) : pick([" slow", " slower", " relaxed"]) }; },
    () => { const n = 5 * (1 + Math.floor(rand() * 10)); const r = setVar(code, ["goal", "winScore", "total", "targets"], () => n); return r.ok && { code: r.code, text: lang === "id" ? pick([" menang kalo skor " + n, " target " + n, " sampe " + n]) : pick([" win at " + n, " first to " + n, " target " + n]) }; },
    () => { const n = 10 * (1 + Math.floor(rand() * 9)); const r = setVar(code, ["gameTime", "seconds"], () => n); return r.ok && { code: r.code, text: lang === "id" ? pick([" " + n + " detik", " dalam " + n + " detik", " waktunya " + n + " detik"]) : pick([" " + n + " seconds", " in " + n + " seconds"]) }; },
    () => {
      const [word, hex] = pick(COLORS[lang]);
      const re = /(canvas \{[^}]*?background: )(#[0-9a-fA-F]{3,6}|linear-gradient\([^)]*\)|radial-gradient\([^)]*\))/;
      const re2 = /(body \{[^}]*?background: )(#[0-9a-fA-F]{3,6}|linear-gradient\([^)]*\))/;
      const target = re.test(code) ? re : re2.test(code) ? re2 : null;
      return target && { code: code.replace(target, (m, a) => a + hex), text: lang === "id" ? pick([" background " + word, " latarnya " + word, " warna " + word]) : pick([" with a " + word + " background", " " + word + " background"]) };
    },
  ];
  for (let k = 0; k < 4; k++) { const r = pick(kinds)(); if (r) return r; }
  return null;
}

// nudge the numbers in the "let x = 5; // comment" settings lines
function jitter(code) {
  return code.replace(/^(\s*let \w+ = )(-?\d+(?:\.\d+)?)(; \/\/)/gm, (m, a, v, c) => {
    if (rand() < 0.6) return m;
    const n = +v, f = 0.75 + rand() * 0.5;
    return a + (Number.isInteger(n) ? String(Math.max(1, Math.round(n * f))) : String(Math.round(n * f * 100) / 100)) + c;
  });
}

const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".html")).sort();
const out = [];
for (const f of files) {
  const g = parse(fs.readFileSync(path.join(DIR, f), "utf8"), f);
  for (let v = 0; v < VARIANTS; v++) {
    const lang = v % 3 === 2 ? "en" : "id";
    let req = pick(g[lang]), code = g.code;
    const things = g.things.map((t) => {
      const keep = v === 0 || rand() < 0.25 || !POOL[t.role];
      const e = keep ? [t.id, t.en, t.emoji] : pick(POOL[t.role]);
      return { from: t, name: lang === "id" ? e[0] : e[1], emoji: e[2] };
    });
    // two phases (placeholders first) so swapping ninja->kucing and kucing->hantu can't collide
    const hold = (text, from, i, plural) => (from ? text.replace(new RegExp("\\b" + esc(from) + (plural ? "(e?s)?" : "()") + "\\b", "gi"), (m, suf) => "\u0002" + (/^[A-Z]/.test(m) ? "C" : "c") + i + "\u0003" + (suf || "")) : text);
    things.forEach((t, i) => {
      req = hold(hold(req, t.from.id, i), t.from.en, i, true);
      code = hold(code, t.from.id, i).split(t.from.emoji).join("\u0004" + i + "\u0005");
    });
    const fill = (text) => text.replace(/\u0002([Cc])(\d+)\u0003/g, (m, c, i) => (c === "C" ? caseLike(things[i].name, "A") : things[i].name))
      .replace(/\u0004(\d+)\u0005/g, (m, i) => things[i].emoji);
    req = fill(req);
    code = fill(code);
    if (v && rand() < 0.45) { const m = modifier(code, lang); if (m) { code = m.code; req += m.text; } }
    if (v && rand() < 0.5) code = rotateColors(code, 30 + Math.floor(rand() * 300));
    if (v && rand() < 0.5) code = jitter(code);
    req = (pick(OPEN[lang]) + req).trim();
    if (rand() < 0.15) req = req.toUpperCase().slice(0, 1) + req.slice(1);
    const slots = Req.slotsFor(req, things.map((t) => t.name));
    const prefix = Req.prefix(req, slots);
    const toks = Tok.tokenize(code, slots);
    if (Tok.detokenize(toks, slots) !== Tok.normalize(code)) throw new Error(f + ": tokenizer round trip failed for variant " + v);
    out.push({ file: f, request: req, slots, prefix, code: toks });
  }
}
fs.writeFileSync(path.join(ROOT, "data/html/corpus.jsonl"), out.map((r) => JSON.stringify(r)).join("\n") + "\n");
const n = out.reduce((s, r) => s + r.code.length, 0);
console.log(`${files.length} games x ${VARIANTS} = ${out.length} programs, ${n.toLocaleString()} code tokens`);
for (const r of out.slice(0, 3).concat(out.slice(-2))) console.log(" ", r.request, "->", r.prefix.join(" "));
