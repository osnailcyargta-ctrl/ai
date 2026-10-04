/* codenlu.js — sybau code's request reader (model/codenlu.json, trained by
 * training/train_codenlu.py). Two small neural nets read every word:
 *   intent:  new | add | setvar | replace | remove | reset | undo | ask | chat
 *   tagger:  each word -> O | T (thing) | T2 (the new thing) | V (setting) | N (value)
 * The features (words, word pairs, character trigrams, neighbours) are hashed exactly like
 * the Python side, so the browser sees what the network saw in training.
 */
(function (root) {
  "use strict";

  function b64ToInt8(s) {
    const bin = typeof atob === "function" ? atob(s) : Buffer.from(s, "base64").toString("binary");
    const out = new Int8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = (bin.charCodeAt(i) << 24) >> 24;
    return out;
  }
  function dequant(d) {
    if (d.f) return { rows: 1, cols: d.f.length, data: Float32Array.from(d.f) };
    const [rows, cols] = d.shape, q = b64ToInt8(d.q), data = new Float32Array(rows * cols);
    for (let r = 0; r < rows; r++) { const s = d.scale[r]; for (let c = 0; c < cols; c++) data[r * cols + c] = q[r * cols + c] * s; }
    return { rows, cols, data };
  }

  function fnv(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h;
  }

  function tokens(text) {
    return String(text).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").match(/[a-z]+|\d+(?:[.,]\d+)?x?|=/g) || [];
  }

  function wordFeats(w) {
    const f = ["w:" + w];
    for (const suf of ["nya", "in", "kan", "s"]) {
      if (w.length > suf.length + 2 && w.endsWith(suf)) { f.push("w:" + w.slice(0, -suf.length)); f.push("suf:" + suf); }
    }
    const p = "^" + w + "$";
    for (let k = 0; k < p.length - 2; k++) f.push("c:" + p.slice(k, k + 3));
    if (/^\d+(?:[.,]\d+)?x?$/.test(w)) f.push("isnum");
    return f;
  }
  function sentFeats(words) {
    const f = [];
    words.forEach((w, k) => { f.push(...wordFeats(w)); if (k) f.push("b:" + words[k - 1] + "_" + w); });
    f.push("first:" + (words[0] || ""));
    f.push("len:" + Math.min(words.length, 8));
    return f;
  }
  function tokFeats(words, k) {
    const f = wordFeats(words[k]).map((x) => "self:" + x);
    for (const d of [-2, -1, 1, 2]) {
      const j = k + d;
      const w = j >= 0 && j < words.length ? words[j] : j < 0 ? "<s>" : "</s>";
      f.push("n" + d + ":" + w);
      if (j >= 0 && j < words.length && w.endsWith("nya") && w.length > 5) f.push("n" + d + ":" + w.slice(0, -3));
    }
    f.push("pos:" + Math.min(k, 6));
    f.push("first:" + words[0]);
    return f;
  }

  class Net {
    constructor(j, dim) { this.W1 = dequant(j.W1); this.b1 = dequant(j.b1); this.W2 = dequant(j.W2); this.b2 = dequant(j.b2); this.dim = dim; }
    probs(feats) {
      const H = this.W1.cols, rows = new Set(feats.map((x) => fnv(x) % this.dim));
      const h = Float32Array.from(this.b1.data);
      for (const r of rows) { const off = r * H; for (let c = 0; c < H; c++) h[c] += this.W1.data[off + c]; }
      const O = this.W2.cols, z = Float32Array.from(this.b2.data);
      for (let r = 0; r < H; r++) { const v = h[r]; if (v <= 0) continue; const off = r * O; for (let c = 0; c < O; c++) z[c] += v * this.W2.data[off + c]; }
      const m = Math.max(...z);
      let s = 0; const p = Array.from(z, (v) => { const e = Math.exp(v - m); s += e; return e; });
      return p.map((v) => v / s);
    }
  }

  class CodeNLU {
    constructor(json) {
      this.intents = json.intents; this.tags = json.tags;
      this.intentNet = new Net(json.intent, json.dim);
      this.tagNet = new Net(json.tagger, json.dim);
      this.params = json.params;
    }
    /** -> {intent, confidence, probs, words, tags, things, newThings, vars, values} */
    read(text) {
      const words = tokens(text);
      if (!words.length) return { intent: "chat", confidence: 0, words, tags: [], things: [], newThings: [], vars: [], values: [] };
      const p = this.intentNet.probs(sentFeats(words));
      let best = 0; p.forEach((v, i) => { if (v > p[best]) best = i; });
      const tags = words.map((_, k) => { const q = this.tagNet.probs(tokFeats(words, k)); let b = 0; q.forEach((v, i) => { if (v > q[b]) b = i; }); return this.tags[b]; });
      const pick = (t) => words.filter((_, k) => tags[k] === t);
      // runs of V words are one setting ("kecepatan musuh")
      const vars = [];
      words.forEach((w, k) => { if (tags[k] === "V") { if (k && tags[k - 1] === "V") vars[vars.length - 1] += " " + w; else vars.push(w); } });
      const strip = (w) => w.replace(/(nya|s)$/, (m) => (w.length > m.length + 2 ? "" : m));
      return {
        intent: this.intents[best], confidence: p[best], probs: Object.fromEntries(this.intents.map((n, i) => [n, p[i]])),
        words, tags, things: pick("T").map(strip), newThings: pick("T2").map(strip), vars, values: pick("N"),
      };
    }
  }

  async function loadCodeNLU(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error("HTTP " + r.status);
    return new CodeNLU(await r.json());
  }

  const api = { CodeNLU, loadCodeNLU, tokens, fnv };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CodeNLULib = api;
})(typeof self !== "undefined" ? self : this);
