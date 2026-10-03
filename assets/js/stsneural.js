/* stsneural.js — sybau code's code-writing transformer, running in the browser.
 *
 * The model (model/stscode.json, trained by training/train_code.py) reads the request
 * as tokens ("<req> game <t1> lempar <t2> ke <t3> </req> <t1> cat:person ... <code>")
 * and then writes the STS program itself, one token at a time. Nothing is pasted in:
 * every keyword, number, bracket and indent comes out of the network. The program is
 * longer than the model's window (384 tokens), so it writes with a sliding window that
 * always keeps the request in front, exactly like it was trained.
 */
(function (root) {
  "use strict";
  const Tok = root.StsTokLib || (typeof require === "function" ? require("./ststok.js") : null);

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
  function vecMat(x, M, out) {
    const { rows, cols, data } = M;
    for (let r = 0; r < rows; r++) { const xv = x[r]; if (xv === 0) continue; const off = r * cols; for (let c = 0; c < cols; c++) out[c] += xv * data[off + c]; }
    return out;
  }

  /** a GPT-style decoder (same maths as training/transformer.py) */
  class TinyGPT {
    constructor(json) {
      this.d = json.d; this.layers = json.layers; this.heads = json.heads; this.ctx = json.ctx; this.act = json.act || "gelu";
      this.vocab = json.vocab;
      this.index = new Map(this.vocab.map((w, i) => [w, i]));
      this.G = {};
      for (const k of Object.keys(json)) if (json[k] && typeof json[k] === "object" && (json[k].q || json[k].f)) this.G[k] = dequant(json[k]);
      this.params = Object.values(this.G).reduce((n, t) => n + t.data.length, 0);
    }
    newCache() { return Array.from({ length: this.layers }, () => ({ k: [], v: [] })); }
    _ln(v, gk, bk) {
      const d = this.d, gg = this.G[gk].data, bb = this.G[bk].data;
      let mu = 0; for (let i = 0; i < d; i++) mu += v[i]; mu /= d;
      let va = 0; for (let i = 0; i < d; i++) va += (v[i] - mu) * (v[i] - mu); va /= d;
      const r = 1 / Math.sqrt(va + 1e-5), o = new Float32Array(d);
      for (let i = 0; i < d; i++) o[i] = (v[i] - mu) * r * gg[i] + bb[i];
      return o;
    }
    /** feed token `tok` at position `pos` -> logits for the next token */
    step(tok, pos, cache) {
      const G = this.G, d = this.d, nh = this.heads, hd = d / nh;
      const x = new Float32Array(d);
      for (let i = 0; i < d; i++) x[i] = G.E.data[tok * d + i] + G.Pos.data[pos * d + i];
      for (let l = 0; l < this.layers; l++) {
        const h = this._ln(x, "g1_" + l, "b1_" + l);
        const qkv = vecMat(h, G["Wqkv_" + l], Float32Array.from(G["bqkv_" + l].data));
        const c = cache[l];
        c.k.push(qkv.slice(d, 2 * d)); c.v.push(qkv.slice(2 * d, 3 * d));
        const T = c.k.length, y = new Float32Array(d), sc = new Float32Array(T), inv = 1 / Math.sqrt(hd);
        for (let a = 0; a < nh; a++) {
          const o = a * hd;
          let m = -Infinity;
          for (let t = 0; t < T; t++) { let s = 0; const kt = c.k[t]; for (let i = 0; i < hd; i++) s += qkv[o + i] * kt[o + i]; sc[t] = s * inv; if (sc[t] > m) m = sc[t]; }
          let z = 0; for (let t = 0; t < T; t++) { sc[t] = Math.exp(sc[t] - m); z += sc[t]; }
          for (let t = 0; t < T; t++) { const w = sc[t] / z, vt = c.v[t]; for (let i = 0; i < hd; i++) y[o + i] += w * vt[o + i]; }
        }
        const att = vecMat(y, G["Wo_" + l], Float32Array.from(G["bo_" + l].data));
        for (let i = 0; i < d; i++) x[i] += att[i];
        const h2 = this._ln(x, "g2_" + l, "b2_" + l);
        const u = vecMat(h2, G["W1_" + l], Float32Array.from(G["c1_" + l].data));
        if (this.act === "relu") { for (let i = 0; i < u.length; i++) if (u[i] < 0) u[i] = 0; }
        else for (let i = 0; i < u.length; i++) { const v = u[i]; u[i] = 0.5 * v * (1 + Math.tanh(0.7978845608028654 * (v + 0.044715 * v * v * v))); }
        const f = vecMat(u, G["W2_" + l], Float32Array.from(G["c2_" + l].data));
        for (let i = 0; i < d; i++) x[i] += f[i];
      }
      return vecMat(this._ln(x, "gf", "bf"), G.Wy, Float32Array.from(G.by.data));
    }
  }

  class NeuralCoder {
    constructor(json) {
      this.gpt = new TinyGPT(json);
      this.params = json.params || this.gpt.params;
      this.epochs = json.epochs;
    }
    encode(toks) { return toks.map((t) => (this.gpt.index.has(t) ? this.gpt.index.get(t) : 1)); }
    /** how many request words the model has never seen (they become <unk>) */
    unknown(prefix) { return prefix.filter((t) => !this.gpt.index.has(t)); }

    /** write one program. prefix: conditioning tokens. -> {tokens, code, logp} */
    async write(prefix, slots, opts = {}) {
      const g = this.gpt, V = g.vocab.length;
      const rand = opts.rand || Math.random, temp = opts.temperature || 0.6, topP = opts.topP || 0.9;
      const maxTok = opts.maxTokens || 2600;
      const pre = this.encode(prefix);
      const out = [];
      let cache = g.newCache(), pos = 0, logits = null, logp = 0;
      const feed = (ids) => { for (const id of ids) logits = g.step(id, pos++, cache); };
      feed(pre);
      // grammar-constrained decoding: at every step only tokens that keep the code well-formed are allowed
      const nSlots = slots.length;
      const kind = g.vocab.map((w) => {
        if (w === "<pad>" || w === "<unk>" || w.startsWith("<req") || w.startsWith("</req") || w === "<code>" || w.startsWith("cat:") || w.startsWith("col:") || w.startsWith("mech:")) return "ban";
        const m = /^(?:##)?<[tT](\d+)>$/.exec(w);
        if (m) return +m[1] > nSlots ? "ban" : (w.startsWith("##") ? "piece" : "word");
        if (w === Tok.NL) return "nl"; if (w === Tok.IN) return "in"; if (w === Tok.OUT) return "out"; if (w === Tok.SP) return "sp";
        if (w === '"') return "q"; if (w === "(") return "open"; if (w === ")") return "close"; if (w === "<end>") return "end";
        if (w.startsWith("##")) return "piece";
        return "tok";
      });
      const idx = new Int32Array(V);
      let depth = 0, inStr = false, paren = 0, lineStart = true, lastTok = Tok.NL, needBlock = false, lineToks = 0, pieces = 0, strToks = 0;
      const allowed = (i) => {
        const k = kind[i];
        if (k === "ban") return false;
        if (inStr) return strToks > 24 ? k === "q" : (k === "word" || k === "tok" || k === "sp" || k === "q" || k === "piece");
        if (lineToks >= 44 && paren === 0) return k === "nl";       // no endless lines
        if (k === "piece" && pieces >= 3) return false;              // no "KupuKupuKupuKupu..." loops
        if (k === "sp") return false;
        if (needBlock) return k === "in";                  // a line ending in ':' must open a block
        if (k === "in") return false;
        if (k === "out") return lineStart && depth > 0;
        if (k === "nl") return !lineStart && paren === 0;
        if (k === "close") return paren > 0;
        if (k === "end") return lineStart && !inStr;
        if (k === "piece") return lineToks > 0 && /^[A-Za-z0-9_#<>]+$/.test(lastTok) && !/^[=<>!+\-*/%]+$/.test(lastTok) && lastTok !== '"';
        return true;
      };
      for (let n = 0; n < maxTok; n++) {
        // sliding window: the request stays, the oldest code drops out
        if (pos >= g.ctx) {
          cache = g.newCache(); pos = 0;
          const keep = out.slice(-Math.floor((g.ctx - pre.length) * 0.55));   // drop a big chunk at once, so re-reading is rare
          feed(pre); feed(keep);
        }
        const z = Float32Array.from(logits);
        for (let i = 0; i < V; i++) if (!allowed(i)) z[i] = -1e9;
        let m = -Infinity;
        for (let i = 0; i < V; i++) { z[i] /= temp; if (z[i] > m) m = z[i]; }
        let s = 0;
        for (let i = 0; i < V; i++) { z[i] = Math.exp(z[i] - m); s += z[i]; }
        let k = 0;
        for (let i = 0; i < V; i++) { z[i] /= s; if (z[i] > 1e-5) idx[k++] = i; }
        const cand = Array.from(idx.subarray(0, k)).sort((a, b) => z[b] - z[a]);
        let mass = 0, cut = 0;
        while (cut < cand.length && mass < topP) mass += z[cand[cut++]];
        let u = rand() * mass, w = cand[0];
        for (let j = 0; j < cut; j++) { u -= z[cand[j]]; if (u <= 0) { w = cand[j]; break; } }
        logp += Math.log(z[w] + 1e-12);
        if (g.vocab[w] === "<end>") break;
        const t = g.vocab[w], kd = kind[w];
        if (kd === "in") { depth++; needBlock = false; }
        else if (kd === "out") depth--;
        else if (kd === "nl") { needBlock = lastTok === ":"; lineStart = true; lineToks = 0; }
        else {
          if (kd === "q") { inStr = !inStr; strToks = 0; } else if (inStr) strToks++;
          pieces = kd === "piece" ? pieces + 1 : 0;
          if (!inStr && kd === "open") paren++;
          if (!inStr && kd === "close") paren--;
          lineStart = false; lineToks++;
        }
        lastTok = t;
        out.push(w);
        feed([w]);
        if (opts.onToken && (n % 12 === 0)) { opts.onToken(out.map((i) => g.vocab[i])); await new Promise((r) => setTimeout(r, 0)); }
      }
      const tokens = out.map((i) => g.vocab[i]);
      if (opts.onToken) opts.onToken(tokens);
      return { tokens, code: Tok.detokenize(tokens, slots), logp: logp / (out.length + 1) };
    }
  }

  const api = { TinyGPT, NeuralCoder };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.StsNeuralLib = api;
})(typeof self !== "undefined" ? self : this);
