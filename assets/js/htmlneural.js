/* htmlneural.js — sybau code's HTML/JS/CSS-writing transformer, running in the browser.
 *
 * The model (model/htmlcode.json, trained by training/train_html.py) reads the request
 * ("<req> bikin <t1> ninja vs <t2> zombie </req> <code>") and then writes the whole web page
 * itself, one token at a time: every tag, CSS rule, JavaScript keyword, number and emoji comes
 * out of the network. Nothing is pasted from a template.
 *
 * Decoding is constrained so the page stays well-formed: brackets ( [ { must close in order,
 * strings and comments are tracked, and the page can only end once everything is closed.
 * Pages longer than the model's window are written with a sliding window that always keeps
 * the request in front, exactly like training.
 */
(function (root) {
  "use strict";
  const Tok = root.HtmlTokLib || (typeof require === "function" ? require("./htmltok.js") : null);

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

  const OPEN = { "(": ")", "[": "]", "{": "}" }, CLOSE = { ")": "(", "]": "[", "}": "{" };

  /** keeps track of brackets / strings / comments while the page is written */
  class Shape {
    constructor() { this.stack = []; this.quote = null; this.esc = false; this.comment = false; this.prev = ""; this.text = ""; }
    clone() { const s = new Shape(); s.stack = this.stack.slice(); s.quote = this.quote; s.esc = this.esc; s.comment = this.comment; s.prev = this.prev; s.text = this.text; return s; }
    /** apply a token; false = it would break the page */
    feed(tok) {
      if (/^⏎\d+$/.test(tok)) {
        if (this.quote === '"' || this.quote === "'") return false;
        this.comment = false; this.prev = "\n"; this.text += "\n"; return true;
      }
      const s = tok.replace(/^(##|▁)/, "").replace(/^<[tT]\d+>$/, "x").replace(/^␣$/, " ");
      for (const ch of s) {
        if (this.comment) { this.prev = ch; continue; }
        if (this.quote) {
          if (this.esc) this.esc = false;
          else if (ch === "\\") this.esc = true;
          else if (ch === this.quote) this.quote = null;
          this.prev = ch; continue;
        }
        if (ch === "/" && this.prev === "/" ) { this.comment = true; this.prev = ch; continue; }
        if (ch === '"' || ch === "'" || ch === "`") this.quote = ch;
        else if (OPEN[ch]) this.stack.push(ch);
        else if (CLOSE[ch]) { if (this.stack[this.stack.length - 1] !== CLOSE[ch]) return false; this.stack.pop(); }
        this.prev = ch;
      }
      this.text = (this.text + s).slice(-64);
      return true;
    }
  }

  class HtmlWriter {
    constructor(json) {
      this.gpt = new TinyGPT(json);
      this.params = json.params || this.gpt.params;
      this.epochs = json.epochs;
      this.name = json.name || "htmlcode";
    }
    encode(toks) { return toks.map((t) => (this.gpt.index.has(t) ? this.gpt.index.get(t) : 1)); }
    unknown(prefix) { return prefix.filter((t) => !this.gpt.index.has(t)); }

    /** write one page. -> {tokens, html, logp, closed} */
    async write(prefix, slots, opts = {}) {
      const g = this.gpt, V = g.vocab.length;
      const rand = opts.rand || Math.random, temp = opts.temperature || 0.7, topP = opts.topP || 0.92;
      const maxTok = opts.maxTokens || 2600;
      const pre = this.encode(prefix);
      const out = [];
      let cache = g.newCache(), pos = 0, logits = null, logp = 0, shape = new Shape(), sawHtmlEnd = false;
      const feed = (ids) => { for (const id of ids) logits = g.step(id, pos++, cache); };
      feed(pre);
      const nSlots = slots.length;
      const banned = g.vocab.map((w) => {
        if (w === "<pad>" || w === "<unk>" || w === "<req>" || w === "</req>" || w === "<code>") return true;
        const m = /^(?:##|▁)?<[tT](\d+)>$/.exec(w);
        return !!(m && +m[1] > nSlots);
      });
      const END = g.index.get("<end>");
      const lines = [];
      let line = [];
      for (let n = 0; n < maxTok; n++) {
        if (pos >= g.ctx) {
          cache = g.newCache(); pos = 0;
          const keep = out.slice(-Math.floor((g.ctx - pre.length) * 0.6));
          feed(pre); feed(keep);
        }
        const z = Float32Array.from(logits);
        let m = -Infinity;
        for (let i = 0; i < V; i++) { if (banned[i]) z[i] = -1e9; z[i] /= temp; if (z[i] > m) m = z[i]; }
        let s = 0;
        for (let i = 0; i < V; i++) { z[i] = Math.exp(z[i] - m); s += z[i]; }
        const cand = [];
        for (let i = 0; i < V; i++) { z[i] /= s; if (z[i] > 1e-6) cand.push(i); }
        cand.sort((a, b) => z[b] - z[a]);
        // sample from the nucleus; a token that would break the page is thrown away and we sample again
        let w = -1, next = null;
        const tried = new Set();
        for (let attempt = 0; attempt < 24 && w < 0; attempt++) {
          let mass = 0, cut = 0;
          while (cut < cand.length && mass < topP) { if (!tried.has(cand[cut])) mass += z[cand[cut]]; cut++; }
          let u = rand() * mass, pickI = -1;
          for (let j = 0; j < cut; j++) { const c = cand[j]; if (tried.has(c)) continue; u -= z[c]; if (u <= 0) { pickI = c; break; } }
          if (pickI < 0) pickI = cand.find((c) => !tried.has(c));
          if (pickI == null || pickI < 0) break;
          tried.add(pickI);
          if (pickI === END) { if (!shape.stack.length && !shape.quote && sawHtmlEnd) { w = END; } continue; }
          const sh = shape.clone();
          if (sh.feed(g.vocab[pickI])) { w = pickI; next = sh; }
        }
        if (w < 0) { const f = cand.find((c) => c !== END && shape.clone().feed(g.vocab[c])); if (f == null) break; w = f; next = shape.clone(); next.feed(g.vocab[w]); }
        logp += Math.log(z[w] + 1e-12);
        if (w === END) break;
        shape = next;
        const t = g.vocab[w];
        if (/^⏎/.test(t)) {
          // a model stuck in a loop writes the same lines again and again: stop it
          const key = line.join(" ");
          lines.push(key); line = [];
          if (lines.length > 8 && key.length > 6 && lines.slice(-6).filter((l) => l === key).length >= 4) break;
        } else line.push(t);
        if (shape.text.endsWith("</html>")) sawHtmlEnd = true;
        out.push(w);
        feed([w]);
        if (opts.onToken && n % 16 === 0) { opts.onToken(out.map((i) => g.vocab[i])); await new Promise((r) => setTimeout(r, 0)); }
        if (opts.signal && opts.signal.stop) break;
      }
      const tokens = out.map((i) => g.vocab[i]);
      if (opts.onToken) opts.onToken(tokens);
      return { tokens, html: Tok.detokenize(tokens, slots), logp: logp / (out.length + 1), closed: !shape.stack.length && !shape.quote && sawHtmlEnd };
    }
  }

  const api = { TinyGPT, HtmlWriter, Shape };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HtmlNeuralLib = api;
})(typeof self !== "undefined" ? self : this);
