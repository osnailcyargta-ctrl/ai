/* brain.js — runs the trained neural nets in the browser. No API, no server.
 *
 * Mirrors training/textproc.py exactly (normalize, hashing, features,
 * generator tokens). Change one, change the other.
 */
(function (root) {
  "use strict";

  const EMOJI_WORDS = [
    ["😭", " emojicry "], ["💀", " emojiskull "], ["🥀", " emojirose "],
    ["😂", " emojilaugh "], ["🤣", " emojilaugh "], ["❤", " emojiheart "],
    ["🙏", " emojipray "], ["🤡", " emojiclown "],
  ];

  let SLANG = {}, MARKERS = new Set();
  function setTextConfig(cfg) {
    SLANG = (cfg && cfg.slang) || {};
    MARKERS = new Set((cfg && cfg.markers) || []);
  }

  const WK_RE = /^(?:[wk]{4,}|(?:a?wk)+[a-z]?|(?:wk)+)$/;
  const HAHA_RE = /^(?:ha|he|hi|ah|hah)+h?$/;
  function canon(tok) {
    if (tok.length >= 4 && tok.includes("w") && tok.includes("k") && WK_RE.test(tok)) return "wkwk";
    if (tok.length >= 4 && HAHA_RE.test(tok)) return "haha";
    return Object.prototype.hasOwnProperty.call(SLANG, tok) ? SLANG[tok] : tok;
  }

  function normalize(text) {
    let t = String(text).toLowerCase();
    for (const [emo, word] of EMOJI_WORDS) t = t.split(emo).join(word);
    t = t.replace(/([a-z]+)2(?![0-9])/g, "$1 $1"); // kata2 -> kata kata
    t = t.replace(/([0-9])\s*-\s*(?=[0-9])/g, "$1 minus ");
    t = t.replace(/([0-9])\s*x\s*(?=[0-9])/g, "$1 times ");
    t = t.replace(/[0-9]+(\.[0-9]+)?/g, " num ");
    t = t.split("+").join(" plus ").split("*").join(" times ").split("/").join(" div ");
    t = t.split("^").join(" pow ").split("=").join(" eq ");
    t = t.split("?").join(" qmark ").split("!").join(" bang ");
    t = t.replace(/['’]/g, "");
    t = t.replace(/[^a-z\s]/g, " ");
    t = t.replace(/(.)\1{2,}/g, "$1$1");
    return t.split(/\s+/).filter(Boolean).map(canon);
  }

  /** "id" if the normalized tokens look Indonesian, else "en" */
  const NON_WORDS = new Set(["qmark", "bang", "num", "plus", "minus", "times", "div", "pow", "eq"]);
  function detectLang(tokens) {
    const words = tokens.filter((t) => !NON_WORDS.has(t) && !t.startsWith("emoji"));
    if (!words.length) return "en";
    let score = 0;
    for (const t of words) if (MARKERS.has(t)) score++;
    return score >= Math.max(1, 0.25 * words.length) ? "id" : "en";
  }

  function fnv1a(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i); // features are pure ASCII after normalize()
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  function featureStrings(tokens) {
    const feats = [];
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      feats.push("w|" + tok);
      const padded = "<" + tok + ">";
      for (let j = 0; j + 3 <= padded.length; j++) feats.push("c|" + padded.slice(j, j + 3));
      if (i + 1 < tokens.length) feats.push("b|" + tok + "|" + tokens[i + 1]);
    }
    if (tokens.length) {
      feats.push("s|" + tokens[0]);
      feats.push("n|" + Math.min(tokens.length, 8));
    }
    return feats;
  }

  function featurize(text, dim) {
    const counts = new Map();
    for (const f of featureStrings(normalize(text))) {
      const k = fnv1a(f) % dim;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    let norm = 0;
    for (const v of counts.values()) norm += v * v;
    norm = Math.sqrt(norm);
    if (norm > 0) for (const [k, v] of counts) counts.set(k, v / norm);
    return counts;
  }

  function detokenize(tokens) {
    let out = "", openQuote = false, glue = false;
    for (const tok of tokens) {
      if (tok === "'" || tok === '"') {
        if (!openQuote) { out += (out ? " " : "") + tok; glue = true; }
        else out += tok;
        openQuote = !openQuote;
        continue;
      }
      if (out && !glue && !",.!?:;".includes(tok)) out += " ";
      glue = tok === "/"; // "/settings", "/search on"
      out += tok;
    }
    return out;
  }

  function b64ToInt8(b64) {
    if (typeof atob === "function") {
      const bin = atob(b64);
      const arr = new Int8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = (bin.charCodeAt(i) << 24) >> 24;
      return arr;
    }
    const buf = Buffer.from(b64, "base64"); // node (tests)
    return new Int8Array(buf.buffer, buf.byteOffset, buf.length);
  }

  /** int8 per-row quantised tensor -> {rows, cols, data: Float32Array} */
  function dequant(d) {
    if (d.f) return { rows: 1, cols: d.f.length, data: Float32Array.from(d.f) };
    const [rows, cols] = d.shape;
    const q = b64ToInt8(d.q);
    const data = new Float32Array(rows * cols);
    for (let r = 0; r < rows; r++) {
      const s = d.scale[r];
      for (let c = 0; c < cols; c++) data[r * cols + c] = q[r * cols + c] * s;
    }
    return { rows, cols, data };
  }

  // out[c] += sum_r x[r] * M[r][c]
  function vecMat(x, M, out) {
    const { rows, cols, data } = M;
    for (let r = 0; r < rows; r++) {
      const xv = x[r];
      if (xv === 0) continue;
      const off = r * cols;
      for (let c = 0; c < cols; c++) out[c] += xv * data[off + c];
    }
    return out;
  }

  function softmaxInPlace(z) {
    let m = -Infinity;
    for (const v of z) if (v > m) m = v;
    let s = 0;
    for (let i = 0; i < z.length; i++) { z[i] = Math.exp(z[i] - m); s += z[i]; }
    for (let i = 0; i < z.length; i++) z[i] /= s;
    return z;
  }

  const sig = (x) => 1 / (1 + Math.exp(-x));

  class Brain {
    constructor(json) {
      setTextConfig(json.text);
      const c = json.classifier;
      this.featDim = c.feat_dim;
      this.clsTags = c.tags;
      this.W1T = dequant(c.W1); // (hidden, feat)
      this.b1 = dequant(c.b1).data;
      this.W2 = dequant(c.W2);
      this.b2 = dequant(c.b2).data;

      const g = json.generator;
      this.H = g.hidden;
      this.maxLen = g.max_len;
      this.genTags = g.tags;
      this.langs = g.langs || ["en", "id"];
      this.vocab = g.vocab;
      for (const k of ["E", "C", "L", "Wx", "Uh", "Wy"]) this[k] = dequant(g[k]);
      this.bx = dequant(g.bx).data;
      this.bh = dequant(g.bh).data;
      this.by = dequant(g.by).data;

      this.responses = json.responses;
      this.trainedAt = json.trained_at;
      this.trainingLines = new Set();
      for (const tag in json.responses)
        for (const r of json.responses[tag]) this.trainingLines.add(detokenize(genTokenize(r)));

      let n = 0;
      for (const t of [this.W1T, this.W2, this.E, this.C, this.L, this.Wx, this.Uh, this.Wy]) n += t.data.length;
      this.paramCount = n + this.b1.length + this.b2.length + this.bx.length + this.bh.length + this.by.length;
    }

    /** -> [{tag, p}] sorted, most likely first */
    classify(text) {
      const x = featurize(text, this.featDim);
      const H = this.W1T.rows, D = this.W1T.cols, W = this.W1T.data;
      const h = new Float32Array(H);
      for (let j = 0; j < H; j++) {
        let s = this.b1[j];
        for (const [k, v] of x) s += v * W[j * D + k];
        h[j] = s > 0 ? s : 0;
      }
      const z = Float32Array.from(this.b2);
      vecMat(h, this.W2, z);
      softmaxInPlace(z);
      return this.clsTags.map((tag, i) => ({ tag, p: z[i] })).sort((a, b) => b.p - a.p);
    }

    _gruStep(wordId, cond, h) {
      const H = this.H, E = this.E.cols;
      const x = new Float32Array(E + cond.length);
      x.set(this.E.data.subarray(wordId * E, wordId * E + E), 0);
      x.set(cond, E);
      const gx = vecMat(x, this.Wx, Float32Array.from(this.bx));
      const gh = vecMat(h, this.Uh, Float32Array.from(this.bh));
      const hn = new Float32Array(H);
      for (let i = 0; i < H; i++) {
        const z = sig(gx[i] + gh[i]);
        const r = sig(gx[H + i] + gh[H + i]);
        const n = Math.tanh(gx[2 * H + i] + r * gh[2 * H + i]);
        hn[i] = (1 - z) * n + z * h[i];
      }
      return hn;
    }

    /** Sample one reply from the GRU, word by word (temperature + nucleus/top-p).
     *  Returns {text, tokens, logp} where logp is the mean log-prob per token. */
    generate(tag, lang = "en", temperature = 0.8, rand = Math.random, topP = 0.92) {
      const cid = this.genTags.indexOf(tag);
      if (cid < 0) return null;
      const lid = Math.max(0, this.langs.indexOf(lang));
      const C = this.C.cols, L = this.L.cols;
      const cond = new Float32Array(C + L);
      cond.set(this.C.data.subarray(cid * C, cid * C + C), 0);
      cond.set(this.L.data.subarray(lid * L, lid * L + L), C);
      let h = new Float32Array(this.H);
      let w = 1; // <s>
      const tokens = [];
      let logp = 0;
      const V = this.vocab.length;
      const order = new Int32Array(V);
      for (let step = 0; step < this.maxLen; step++) {
        h = this._gruStep(w, cond, h);
        const logits = vecMat(h, this.Wy, Float32Array.from(this.by));
        for (let i = 0; i < V; i++) logits[i] /= temperature;
        logits[0] = -1e9; // never <pad>
        logits[1] = -1e9; // never <s>
        softmaxInPlace(logits);
        // nucleus sampling: only sample from the smallest set covering topP of the mass
        let n = 0;
        for (let i = 0; i < V; i++) if (logits[i] > 1e-5) order[n++] = i;
        const idx = Array.from(order.subarray(0, n)).sort((a, b) => logits[b] - logits[a]);
        let mass = 0, cut = 0;
        while (cut < n && mass < topP) mass += logits[idx[cut++]];
        let u = rand() * mass, acc = 0;
        w = idx[0];
        for (let k = 0; k < cut; k++) { acc += logits[idx[k]]; if (u < acc) { w = idx[k]; break; } }
        logp += Math.log(logits[w] + 1e-12);
        if (w === 2) break; // </s>
        tokens.push(this.vocab[w]);
      }
      return { text: detokenize(tokens), tokens, logp: logp / (tokens.length + 1) };
    }
  }

  const GEN_TOKEN_RE = /\{\w+\}|[a-z0-9']+|[^\sa-z0-9']/gu;
  function genTokenize(text) {
    return String(text).toLowerCase().match(GEN_TOKEN_RE) || [];
  }

  async function loadBrain(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("brain.json " + res.status);
    return new Brain(await res.json());
  }

  const api = { Brain, loadBrain, normalize, detectLang, featurize, fnv1a, detokenize, genTokenize, setTextConfig };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BrainLib = api;
})(typeof self !== "undefined" ? self : this);
