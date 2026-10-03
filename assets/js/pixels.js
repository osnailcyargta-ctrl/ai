/* pixels.js — sybau's pixel-art generator (beta) + image reader, in the browser.
 *
 * model/pixels.json is a decoder MLP trained by training/train_pixels.py:
 *   z (12 numbers) -> 128 -> 128 -> 16x16 pixels x 20 colours.
 * Every known drawing ("cat", "fire", ...) is a set of z codes. Drawing = decode
 * codes + noise. Mixing = decode the average of two codes. Learning an uploaded
 * picture = gradient descent on a new z until the decoder reproduces it.
 */
(function (root) {
  "use strict";

  function b64ToInt8(b64) {
    if (typeof atob === "function") {
      const bin = atob(b64), arr = new Int8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = (bin.charCodeAt(i) << 24) >> 24;
      return arr;
    }
    const buf = Buffer.from(b64, "base64");
    return new Int8Array(buf.buffer, buf.byteOffset, buf.length);
  }
  function dequant(d) {
    if (d.f) return { rows: 1, cols: d.f.length, data: Float32Array.from(d.f) };
    const [rows, cols] = d.shape, q = b64ToInt8(d.q), data = new Float32Array(rows * cols);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) data[r * cols + c] = q[r * cols + c] * d.scale[r];
    return { rows, cols, data };
  }
  function vecMat(x, M, bias) {
    const out = Float32Array.from(bias);
    for (let r = 0; r < M.rows; r++) {
      const xv = x[r];
      if (!xv) continue;
      const off = r * M.cols;
      for (let c = 0; c < M.cols; c++) out[c] += xv * M.data[off + c];
    }
    return out;
  }
  function gauss(rand) {
    let u = 0, v = 0;
    while (!u) u = rand();
    while (!v) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function hexToRgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }

  class PixelBrain {
    constructor(json) {
      this.size = json.size;
      this.zdim = json.zdim;
      this.palette = json.palette.map((p) => ({ ch: p.ch, hex: p.hex, rgb: p.hex ? hexToRgb(p.hex) : null }));
      this.C = this.palette.length;
      this.labels = json.labels.map((l) => ({ name: l.name, words: l.words, z: l.z, builtin: true }));
      this.W1 = dequant(json.W1); this.b1 = dequant(json.b1).data;
      this.W2 = dequant(json.W2); this.b2 = dequant(json.b2).data;
      this.W3 = dequant(json.W3); this.b3 = dequant(json.b3).data;
      this.trainedAt = json.trained_at;
    }

    addLearned(list) {
      for (const l of list || []) {
        this.labels = this.labels.filter((x) => x.name !== l.name);
        this.labels.push({ name: l.name, words: [l.name], z: [l.z], builtin: false });
      }
    }

    _forward(z) {
      const a1 = vecMat(z, this.W1, this.b1), h1 = a1.map((v) => (v > 0 ? v : 0));
      const a2 = vecMat(h1, this.W2, this.b2), h2 = a2.map((v) => (v > 0 ? v : 0));
      const logits = vecMat(h2, this.W3, this.b3);
      return { a1, h1, a2, h2, logits };
    }

    /** z -> Uint8Array(size*size) of palette indices */
    decode(z) {
      const { logits } = this._forward(z);
      const P = this.size * this.size, C = this.C, out = new Uint8Array(P);
      for (let p = 0; p < P; p++) {
        let best = 0, bv = -Infinity;
        for (let c = 0; c < C; c++) { const v = logits[p * C + c]; if (v > bv) { bv = v; best = c; } }
        out[p] = best;
      }
      return out;
    }

    /** words in a prompt -> matching labels */
    match(prompt) {
      const t = " " + String(prompt).toLowerCase().replace(/[^a-z0-9 ]+/g, " ") + " ";
      const hits = [];
      for (const l of this.labels) {
        for (const w of l.words) {
          const i = t.indexOf(" " + w.toLowerCase() + " ");
          if (i >= 0) { hits.push({ label: l, at: i }); break; }
        }
      }
      return hits.sort((a, b) => a.at - b.at).map((h) => h.label);
    }

    /** prompt -> {grid, size, labels, known} ; size 16 native, 32 = scale2x upscale */
    draw(prompt, opts = {}) {
      const rand = opts.rand || Math.random;
      let labels = this.match(prompt);
      const known = labels.length > 0;
      let noise = opts.noise !== undefined ? opts.noise : 0.22;
      if (!known) {
        // never seen it -> mix 2 random drawings with extra chaos (beta energy)
        const pool = this.labels.slice();
        labels = [0, 1].map(() => pool.splice(Math.floor(rand() * pool.length), 1)[0]);
        noise = 0.9;
      }
      labels = labels.slice(0, 3);
      const z = new Float32Array(this.zdim);
      for (const l of labels) {
        const code = l.z[Math.floor(rand() * l.z.length)];
        for (let i = 0; i < this.zdim; i++) z[i] += code[i] / labels.length;
      }
      for (let i = 0; i < this.zdim; i++) z[i] += gauss(rand) * noise;
      let grid = this.decode(z), size = this.size;
      if (opts.size === 32) { grid = scale2x(grid, size); size = 32; }
      return { grid, size, labels: labels.map((l) => l.name), known, z: Array.from(z) };
    }

    /** RGBA pixels (any size, already resized to size x size) -> palette indices */
    quantize(rgba, alphaCut = 100) {
      const P = this.size * this.size, out = new Uint8Array(P);
      for (let p = 0; p < P; p++) {
        const r = rgba[p * 4], g = rgba[p * 4 + 1], b = rgba[p * 4 + 2], a = rgba[p * 4 + 3];
        if (a < alphaCut) { out[p] = 0; continue; }
        let best = 1, bd = Infinity;
        for (let c = 0; c < this.C; c++) {
          const col = this.palette[c].rgb;
          if (!col) continue;
          const d = (r - col[0]) ** 2 * 0.3 + (g - col[1]) ** 2 * 0.59 + (b - col[2]) ** 2 * 0.11;
          if (d < bd) { bd = d; best = c; }
        }
        out[p] = best;
      }
      return out;
    }

    /** learn a picture: optimise a latent z so decode(z) ~= target. returns {z, acc} */
    learn(target, steps = 160, lr = 0.08) {
      const D = this.zdim, C = this.C, P = this.size * this.size;
      const z = new Float32Array(D);
      for (const l of this.labels) for (const code of l.z) for (let i = 0; i < D; i++) z[i] += code[i];
      const n = this.labels.reduce((s, l) => s + l.z.length, 0);
      for (let i = 0; i < D; i++) z[i] /= n;
      const m = new Float32Array(D), v = new Float32Array(D);
      const W1 = this.W1, W2 = this.W2, W3 = this.W3;
      for (let t = 1; t <= steps; t++) {
        const f = this._forward(z);
        // d loss / d logits = softmax - onehot (per pixel)
        const dl = new Float32Array(P * C);
        for (let p = 0; p < P; p++) {
          let mx = -Infinity;
          for (let c = 0; c < C; c++) mx = Math.max(mx, f.logits[p * C + c]);
          let s = 0;
          for (let c = 0; c < C; c++) { const e = Math.exp(f.logits[p * C + c] - mx); dl[p * C + c] = e; s += e; }
          for (let c = 0; c < C; c++) dl[p * C + c] /= s * P;
          dl[p * C + target[p]] -= 1 / P;
        }
        const dh2 = new Float32Array(W3.rows);
        for (let r = 0; r < W3.rows; r++) {
          if (f.a2[r] <= 0) continue;
          let s = 0; const off = r * W3.cols;
          for (let c = 0; c < W3.cols; c++) s += W3.data[off + c] * dl[c];
          dh2[r] = s;
        }
        const dh1 = new Float32Array(W2.rows);
        for (let r = 0; r < W2.rows; r++) {
          if (f.a1[r] <= 0) continue;
          let s = 0; const off = r * W2.cols;
          for (let c = 0; c < W2.cols; c++) s += W2.data[off + c] * dh2[c];
          dh1[r] = s;
        }
        for (let i = 0; i < D; i++) {
          let g = 0; const off = i * W1.cols;
          for (let c = 0; c < W1.cols; c++) g += W1.data[off + c] * dh1[c];
          g += 1e-3 * z[i];
          m[i] = 0.9 * m[i] + 0.1 * g;
          v[i] = 0.999 * v[i] + 0.001 * g * g;
          z[i] -= lr * (m[i] / (1 - 0.9 ** t)) / (Math.sqrt(v[i] / (1 - 0.999 ** t)) + 1e-8);
        }
      }
      const rec = this.decode(z);
      let ok = 0;
      for (let p = 0; p < P; p++) if (rec[p] === target[p]) ok++;
      return { z: Array.from(z, (x) => Math.round(x * 1e4) / 1e4), acc: ok / P, preview: rec };
    }

    /** palette grid -> data URL (browser only) */
    toDataURL(grid, size, scale = 1) {
      if (typeof document === "undefined") return null;
      const cv = document.createElement("canvas");
      cv.width = cv.height = size * scale;
      const ctx = cv.getContext("2d");
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const c = this.palette[grid[y * size + x]];
        if (!c.hex) continue;
        ctx.fillStyle = c.hex;
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
      return cv.toDataURL("image/png");
    }

    /** palette grid -> text art, for terminals / node */
    toText(grid, size) {
      const rows = [];
      for (let y = 0; y < size; y++) {
        let r = "";
        for (let x = 0; x < size; x++) r += this.palette[grid[y * size + x]].ch;
        rows.push(r);
      }
      return rows.join("\n");
    }
  }

  /** Scale2x / EPX: 16x16 -> 32x32 with smoothed diagonals instead of plain blocks */
  function scale2x(g, n) {
    const out = new Uint8Array(n * n * 4), at = (x, y) => g[Math.max(0, Math.min(n - 1, y)) * n + Math.max(0, Math.min(n - 1, x))];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const P = at(x, y), A = at(x, y - 1), B = at(x + 1, y), C = at(x - 1, y), D = at(x, y + 1);
      let p1 = P, p2 = P, p3 = P, p4 = P;
      if (C === A && C !== D && A !== B) p1 = A;
      if (A === B && A !== C && B !== D) p2 = B;
      if (D === C && D !== B && C !== A) p3 = C;
      if (B === D && B !== A && D !== C) p4 = D;
      const o = (y * 2) * n * 2 + x * 2;
      out[o] = p1; out[o + 1] = p2; out[o + n * 2] = p3; out[o + n * 2 + 1] = p4;
    }
    return out;
  }

  /** describe an uploaded image from its RGBA pixels (any size) */
  function describeImage(rgba, w, h) {
    let r = 0, g = 0, b = 0, n = 0, transparent = 0;
    const buckets = {};
    const names = { "#e43b44": ["merah", "red"], "#f77622": ["oranye", "orange"], "#feae34": ["kuning", "yellow"], "#63c74d": ["hijau", "green"],
      "#0099db": ["biru", "blue"], "#b55088": ["ungu", "purple"], "#f6757a": ["pink", "pink"], "#b86f50": ["coklat", "brown"],
      "#f4f1ea": ["putih", "white"], "#18161c": ["hitam", "black"], "#8e8a93": ["abu-abu", "gray"] };
    const keys = Object.keys(names).map((k) => [k, hexToRgb(k)]);
    const step = Math.max(1, Math.floor((w * h) / 20000));
    for (let i = 0; i < w * h; i += step) {
      const a = rgba[i * 4 + 3];
      if (a < 100) { transparent++; continue; }
      const R = rgba[i * 4], G = rgba[i * 4 + 1], B = rgba[i * 4 + 2];
      r += R; g += G; b += B; n++;
      let best = null, bd = Infinity;
      for (const [k, c] of keys) { const d = (R - c[0]) ** 2 + (G - c[1]) ** 2 + (B - c[2]) ** 2; if (d < bd) { bd = d; best = k; } }
      buckets[best] = (buckets[best] || 0) + 1;
    }
    const total = n + transparent;
    const top = Object.entries(buckets).sort((a, b2) => b2[1] - a[1]).slice(0, 3).map(([k, c]) => ({ id: names[k][0], en: names[k][1], pct: Math.round((c / Math.max(1, n)) * 100) }));
    const bright = n ? Math.round(((r / n) * 0.3 + (g / n) * 0.59 + (b / n) * 0.11) / 2.55) : 0;
    return { width: w, height: h, colors: top, brightness: bright, transparentPct: Math.round((transparent / Math.max(1, total)) * 100) };
  }

  async function loadPixels(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("pixels.json " + res.status);
    return new PixelBrain(await res.json());
  }

  const api = { PixelBrain, loadPixels, scale2x, describeImage };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PixelLib = api;
})(typeof self !== "undefined" ? self : this);
