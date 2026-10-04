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

      // generator: a small GPT-style transformer (training/transformer.py)
      const g = json.generator;
      this.d = g.d; this.layers = g.layers; this.heads = g.heads; this.ctx = g.ctx;
      this.maxLen = g.max_len;
      this.genTags = g.tags;
      this.langs = g.langs || ["en", "id"];
      this.vocab = g.vocab;
      this.vocabIndex = new Map(this.vocab.map((w, i) => [w, i]));
      this.nSpecial = this.vocab.filter((w) => w.startsWith("<i:") || w.startsWith("<l:")).length;
      // newer models read the user's message (like a chat model) and can copy words from it
      this.readsUser = !!g.reads_user;
      this.maxUser = g.max_user || 20;
      this.copySlots = g.copy_slots || 0;
      this.templateWords = new Set(g.template_words || []);
      this.noWrite = new Set(this.vocab.map((w, i) => (w.startsWith("<i:") || w.startsWith("<l:") || w === "<u>" || w === "</u>" || w === "<unk>" || w === "<pad>" || w === "<s>" ? i : -1)).filter((i) => i >= 0));
      this.G = {};
      for (const k of Object.keys(g)) if (g[k] && typeof g[k] === "object" && (g[k].q || g[k].f)) this.G[k] = dequant(g[k]);

      this.responses = json.responses;
      this.examples = json.examples || {}; // one sentence per training pattern (experimental mode)
      this.trainedAt = json.trained_at;
      this.trainingLines = new Set();
      for (const tag in json.responses)
        for (const r of json.responses[tag]) this.trainingLines.add(detokenize(genTokenize(r)));

      this.genParams = Object.values(this.G).reduce((n, t) => n + t.data.length, 0);
      this.paramCount = this.W1T.data.length + this.W2.data.length + this.b1.length + this.b2.length + this.genParams;
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

    /** feed one token at position `pos`; keys/values are cached so each step is cheap.
     *  -> logits for the next token */
    _step(tok, pos, cache) {
      const G = this.G, d = this.d, nh = this.heads, hd = d / nh;
      const x = new Float32Array(d);
      for (let i = 0; i < d; i++) x[i] = G.E.data[tok * d + i] + G.Pos.data[pos * d + i];
      const ln = (v, gk, bk) => {
        let mu = 0; for (let i = 0; i < d; i++) mu += v[i]; mu /= d;
        let va = 0; for (let i = 0; i < d; i++) va += (v[i] - mu) * (v[i] - mu); va /= d;
        const r = 1 / Math.sqrt(va + 1e-5), o = new Float32Array(d), gg = G[gk].data, bb = G[bk].data;
        for (let i = 0; i < d; i++) o[i] = (v[i] - mu) * r * gg[i] + bb[i];
        return o;
      };
      for (let l = 0; l < this.layers; l++) {
        const h = ln(x, "g1_" + l, "b1_" + l);
        const qkv = vecMat(h, G["Wqkv_" + l], Float32Array.from(G["bqkv_" + l].data));
        const c = cache[l];
        c.k.push(qkv.slice(d, 2 * d)); c.v.push(qkv.slice(2 * d, 3 * d));
        const T = c.k.length, y = new Float32Array(d), sc = new Float32Array(T), inv = 1 / Math.sqrt(hd);
        for (let a = 0; a < nh; a++) {
          const o = a * hd;
          let m = -Infinity;
          for (let t = 0; t < T; t++) { let s2 = 0; const kt = c.k[t]; for (let i = 0; i < hd; i++) s2 += qkv[o + i] * kt[o + i]; sc[t] = s2 * inv; if (sc[t] > m) m = sc[t]; }
          let z = 0; for (let t = 0; t < T; t++) { sc[t] = Math.exp(sc[t] - m); z += sc[t]; }
          for (let t = 0; t < T; t++) { const w = sc[t] / z, vt = c.v[t]; for (let i = 0; i < hd; i++) y[o + i] += w * vt[o + i]; }
        }
        const att = vecMat(y, G["Wo_" + l], Float32Array.from(G["bo_" + l].data));
        for (let i = 0; i < d; i++) x[i] += att[i];
        const h2 = ln(x, "g2_" + l, "b2_" + l);
        const u = vecMat(h2, G["W1_" + l], Float32Array.from(G["c1_" + l].data));
        for (let i = 0; i < u.length; i++) { const v = u[i]; u[i] = 0.5 * v * (1 + Math.tanh(0.7978845608028654 * (v + 0.044715 * v * v * v))); }
        const f = vecMat(u, G["W2_" + l], Float32Array.from(G["c2_" + l].data));
        for (let i = 0; i < d; i++) x[i] += f[i];
      }
      return vecMat(ln(x, "gf", "bf"), G.Wy, Float32Array.from(G.by.data));
    }

    /** logits after reading a list of token ids (used by tests/parity.js) */
    logitsFor(ids) {
      const cache = Array.from({ length: this.layers }, () => ({ k: [], v: [] }));
      let z = null;
      ids.forEach((t, i) => { z = this._step(t, i, cache); });
      return z;
    }
    prefix(tag, lang, userTokens) {
      if (!this.readsUser) return [this.vocabIndex.get("<i:" + tag + ">"), this.vocabIndex.get("<l:" + lang + ">"), 1];
      const u = (userTokens || []).slice(0, this.maxUser).map((w) => (this.vocabIndex.has(w) ? this.vocabIndex.get(w) : this.vocabIndex.get("<unk>")));
      return [this.vocabIndex.get("<i:" + tag + ">"), this.vocabIndex.get("<l:" + lang + ">"), this.vocabIndex.get("<u>"), ...u, this.vocabIndex.get("</u>"), 1];
    }
    /** user text -> tokens the generator reads, with copy slots for the words it may repeat */
    readUser(text) {
      const toks = normalize(String(text || "")).filter(Boolean);
      const slots = {};
      const out = toks.map((w) => {
        if (!this.copySlots || this.templateWords.has(w) || w.length <= 2) return w;
        if (!slots[w] && Object.keys(slots).length < this.copySlots) slots[w] = "<w" + (Object.keys(slots).length + 1) + ">";
        return slots[w] || w;
      });
      const back = {};
      for (const [w, sl] of Object.entries(slots)) back[sl] = w;
      return { tokens: out, back };
    }

    /** Sample one reply from the transformer, word by word (temperature + nucleus/top-p).
     *  Returns {text, tokens, logp} where logp is the mean log-prob per token. */
    generate(tag, lang = "en", temperature = 0.8, rand = Math.random, topP = 0.92, userText = "") {
      if (this.genTags.indexOf(tag) < 0) return null;
      if (!this.langs.includes(lang)) lang = this.langs[0];
      const cache = Array.from({ length: this.layers }, () => ({ k: [], v: [] }));
      const user = this.readsUser ? this.readUser(userText) : { tokens: [], back: {} };
      const pre = this.prefix(tag, lang, user.tokens);
      let logits0 = null;
      pre.forEach((t, i) => { logits0 = this._step(t, i, cache); });
      let w = 1;
      const tokens = [];
      let logp = 0;
      const V = this.vocab.length;
      const order = new Int32Array(V);
      for (let step = 0; step < this.maxLen && pre.length + step < this.ctx; step++) {
        const logits = step === 0 ? logits0 : this._step(w, pre.length + step - 1, cache);
        for (let i = 0; i < V; i++) logits[i] /= temperature;
        logits[0] = -1e9; // never <pad>
        logits[1] = -1e9; // never <s>
        if (this.readsUser) { for (const i of this.noWrite) logits[i] = -1e9; for (let i = 1; i <= this.copySlots; i++) if (!user.back["<w" + i + ">"]) logits[this.vocabIndex.get("<w" + i + ">")] = -1e9; }
        else for (let i = 3; i < 3 + this.nSpecial; i++) logits[i] = -1e9; // never a prefix token
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
        tokens.push(this.readsUser && user.back[this.vocab[w]] ? user.back[this.vocab[w]] : this.vocab[w]);
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
