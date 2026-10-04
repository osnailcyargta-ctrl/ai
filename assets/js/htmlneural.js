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
      const maxTok = opts.maxTokens || 3200;
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
      // history for backtracking: when the page gets stuck (or the model badly wants a token the
      // page can't take, meaning it went wrong a bit earlier), step back a few tokens and resample,
      // like deleting a typo. Only inside the current window (the KV cache is just truncated).
      const hist = [];
      const bans = new Map();
      let winStart = 0, backtracks = 0, afterEnd = 0, lineStartHist = -1, lineBans = 0, lineIndent = 0, scriptAt = -1, goodAt = -1, parseFails = 0;
      const declared = new Set();
      const truncate = (p) => { for (const c of cache) { c.k.length = p; c.v.length = p; } pos = p; };
      const back = (k, noBan) => {
        k = Math.min(k, out.length - winStart, hist.length);
        if (k <= 0 || backtracks >= 160) return false;
        backtracks++;
        let e = null;
        for (let i = 0; i < k; i++) { e = hist.pop(); out.pop(); }
        truncate(pos - k);
        shape = e.shape; logits = e.logits; sawHtmlEnd = e.saw;
        const at = out.length;
        if (!noBan) { if (!bans.has(at)) bans.set(at, new Set()); bans.get(at).add(e.w); }
        // the line being written is everything since the last newline
        line = [];
        for (let i = out.length - 1; i >= 0 && !/^⏎/.test(g.vocab[out[i]]); i--) line.unshift(g.vocab[out[i]]);
        return true;
      };
      for (let n = 0; n < maxTok; n++) {
        if (pos >= g.ctx) {
          cache = g.newCache(); pos = 0;
          const keep = out.slice(-Math.floor((g.ctx - pre.length) * 0.6));
          feed(pre); feed(keep);
          winStart = out.length; hist.length = 0;
        }
        const z = Float32Array.from(logits);
        const ban = bans.get(out.length);
        let m = -Infinity;
        for (let i = 0; i < V; i++) { if (banned[i] || (ban && ban.has(i))) z[i] = -1e9; z[i] /= temp; if (z[i] > m) m = z[i]; }
        let s = 0;
        for (let i = 0; i < V; i++) { z[i] = Math.exp(z[i] - m); s += z[i]; }
        const cand = [];
        for (let i = 0; i < V; i++) { z[i] /= s; if (z[i] > 1e-6) cand.push(i); }
        cand.sort((a, b) => z[b] - z[a]);
        const top = cand[0];
        // after </html> there is nothing left to write
        if (sawHtmlEnd && (top === END || ++afterEnd > 6)) break;
        // the model is sure about a token the page can't take: it went wrong a bit earlier
        if (top !== END && z[top] > 0.6 && !shape.clone().feed(g.vocab[top]) && back(6)) continue;
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
        if (w < 0) {
          if (back(4)) continue;
          const f = cand.find((c) => c !== END && shape.clone().feed(g.vocab[c]));
          if (f == null) break;
          w = f; next = shape.clone(); next.feed(g.vocab[w]);
        }
        logp += Math.log(z[w] + 1e-12);
        if (w === END) break;
        hist.push({ w, shape, logits, saw: sawHtmlEnd });
        if (hist.length > 420) hist.shift();
        shape = next;
        const t = g.vocab[w];
        if (/^⏎/.test(t)) {
          // "let speed = 4;" twice is a SyntaxError: throw the repeated line away and write another
          const text = Tok.detokenize(line, slots).trim();
          const decl = /^(?:let|const|function)\s+(\w+)/.exec(text);
          if (decl && lineIndent === 2 && declared.has(decl[1]) && lineStartHist >= 0) {
            const k = out.length - lineStartHist;
            if (k > 0 && k <= hist.length && back(k)) { lineBans++; if (lineBans > 12) break; continue; }
          }
          if (decl && lineIndent === 2) for (const nm of text.replace(/^(?:let|const)\s+/, "").split(/,\s*/).map((x) => (/^(\w+)\s*=/.exec(x) || [])[1]).filter(Boolean).concat(/^function/.test(text) ? [decl[1]] : [])) declared.add(nm);
          // a finished top-level JavaScript statement must parse; if not, write that statement again
          if (scriptAt >= 0 && !shape.stack.length && !shape.quote && typeof Function === "function") {
            const js = Tok.detokenize(out.slice(scriptAt).map((i) => g.vocab[i]).concat(line), slots);
            let okJs = true;
            try { new Function(js); } catch (err) { okJs = !(err instanceof SyntaxError); }
            if (!okJs && goodAt >= scriptAt && parseFails < 30) {
              const k = out.length - goodAt;
              if (k > 0 && k <= hist.length && back(k, true)) { parseFails++; continue; }
            }
            if (okJs) goodAt = out.length + 1;
          }
          lineStartHist = out.length + 1;
          lineIndent = +t.slice(1);
          // a model stuck in a loop writes the same lines again and again: stop it
          const key = line.join(" ");
          lines.push(key); line = [];
          if (lines.length > 8 && key.length > 6 && lines.slice(-6).filter((l) => l === key).length >= 4) break;
        } else line.push(t);
        if (shape.text.endsWith("</html>")) sawHtmlEnd = true;
        if (shape.text.endsWith("<script>") && scriptAt < 0) { scriptAt = out.length + 1; goodAt = scriptAt; }
        if (shape.text.endsWith("</script>")) scriptAt = -1;
        out.push(w);
        feed([w]);
        if (opts.onToken && n % 16 === 0) { opts.onToken(out.map((i) => g.vocab[i])); await new Promise((r) => setTimeout(r, 0)); }
        if (opts.signal && opts.signal.stop) break;
      }
      const tokens = out.map((i) => g.vocab[i]);
      if (opts.onToken) opts.onToken(tokens);
      let html = Tok.detokenize(tokens, slots);
      const endAt = html.indexOf("</html>");
      if (endAt >= 0) html = html.slice(0, endAt + 7) + "\n";
      return { tokens, html, logp: logp / (out.length + 1), closed: sawHtmlEnd, balanced: !shape.stack.length && !shape.quote };
    }
  }

  /** which html line (1-based) has the first JavaScript syntax error, or 0 */
  function syntaxErrorLine(html) {
    if (typeof Function !== "function") return 0;
    const lines = html.split("\n");
    let inScript = false, start = 0, buf = [];
    for (let i = 0; i < lines.length; i++) {
      let l = lines[i];
      if (!inScript) {
        const k = l.indexOf("<script>");
        if (k < 0) continue;
        inScript = true; start = i; buf = []; l = l.slice(k + 8);
      }
      const end = l.indexOf("</script>");
      buf.push(end >= 0 ? l.slice(0, end) : l);
      // the code so far either parses, or is only unfinished ("Unexpected end of input"); anything else is this line's fault
      try { new Function(buf.join("\n")); } catch (e) {
        if (e instanceof SyntaxError && !/end of input|Unterminated template|missing \} after/i.test(e.message)) return i + 1;
      }
      if (end >= 0) {
        inScript = false;
        try { new Function(buf.join("\n")); } catch (e) { if (e instanceof SyntaxError) return i + 1; }
      }
    }
    return 0;
  }

  /** rewrite one line (1-based) of an already written page; the rest stays as it is.
   *  -> [candidate token arrays] (n of them, each the whole page) */
  HtmlWriter.prototype.rewriteLine = async function (prefix, slots, tokens, lineNo, opts = {}) {
    const g = this.gpt, V = g.vocab.length;
    const starts = [];
    tokens.forEach((t, i) => { if (/^⏎\d+$/.test(t)) starts.push(i); });
    if (lineNo < 1 || lineNo > starts.length) return [];
    const a = starts[lineNo - 1], b = lineNo < starts.length ? starts[lineNo] : tokens.length;
    const before = tokens.slice(0, a + 1), after = tokens.slice(b);
    // the model only sees what is to the left; keep inside the window
    let ctxToks = before;
    const pre = this.encode(prefix);
    if (pre.length + ctxToks.length >= g.ctx - 80) ctxToks = before.slice(-(g.ctx - 80 - pre.length));
    const cache = g.newCache();
    let pos = 0, logits = null;
    for (const id of pre.concat(this.encode(ctxToks))) logits = g.step(id, pos++, cache);
    const shape0 = new Shape();
    for (const t of before) shape0.feed(t);
    const rand = opts.rand || Math.random, n = opts.n || 4;
    const out = [];
    for (let k = 0; k < n; k++) {
      const c = cache.map((l) => ({ k: l.k.slice(), v: l.v.slice() }));
      let p = pos, z0 = logits, shape = shape0.clone();
      const line = [];
      const temp = 0.5 + 0.15 * k;
      for (let step = 0; step < 90; step++) {
        const z = Float32Array.from(z0);
        let m = -Infinity;
        for (let i = 0; i < V; i++) { z[i] /= temp; if (z[i] > m) m = z[i]; }
        let s = 0;
        for (let i = 0; i < V; i++) { z[i] = Math.exp(z[i] - m); s += z[i]; }
        const cand = [];
        for (let i = 0; i < V; i++) if (z[i] / s > 1e-5) cand.push(i);
        cand.sort((x, y) => z[y] - z[x]);
        let w = -1;
        for (let tries = 0; tries < 30 && w < 0; tries++) {
          let u = rand() * s * 0.95, pick = cand[0];
          for (const ci of cand) { u -= z[ci]; if (u <= 0) { pick = ci; break; } }
          const tok = g.vocab[pick];
          if (/^(<pad>|<unk>|<req>|<\/req>|<code>|<end>)$/.test(tok)) continue;
          const sm = /^(?:##|▁)?<[tT](\d+)>$/.exec(tok);
          if (sm && +sm[1] > slots.length) continue;
          if (shape.clone().feed(tok)) w = pick;
        }
        if (w < 0) break;
        const tok = g.vocab[w];
        if (/^⏎\d+$/.test(tok)) break;   // the line is done
        shape.feed(tok);
        line.push(tok);
        z0 = g.step(w, p++, c);
        if (p >= g.ctx) break;
      }
      out.push(before.concat(line, after));
      await new Promise((r) => setTimeout(r, 0));
    }
    return out;
  };

  const api = { TinyGPT, HtmlWriter, Shape, syntaxErrorLine };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HtmlNeuralLib = api;
})(typeof self !== "undefined" ? self : this);
