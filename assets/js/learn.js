/* learn.js — sybau learns from you (when the "learn" setting is on) and from files.
 *
 *  - taught replies:  "kalo gw bilang X bales Y" / "if i say X say Y" -> stored pair.
 *                     Later messages that are close enough to X (cosine similarity
 *                     on the same hashed features the classifier uses) get Y.
 *  - your words:      counts the words you use a lot; the bot mocks them back and the
 *                     grammar police stops flagging slang you use all the time.
 *  - files:           .txt/.md/.csv/.json -> "X => Y" lines become taught pairs,
 *                     intents-style JSON gets imported, everything else becomes a
 *                     little knowledge base the bot answers questions from.
 *  - images:          learned pixel codes (see pixels.js) are stored here too.
 * Everything lives in localStorage on your device.
 */
(function (root) {
  "use strict";
  const Lib = root.BrainLib || (typeof require === "function" ? require("./brain.js") : null);

  const KEY = "sybau_learned_v1";
  const DIM = 4096;
  const MAX_DOC_CHARS = 300000;
  const STOP = new Set(("aku kamu gak tidak yang udah lagi sama dengan karena kenapa gimana itu ini ada mau jadi bisa juga aja sih dong deh nih tuh kok ya iya " +
    "the a an is are was were to of in on for and or but you your i me my it this that be do does did have has not no yes so just like what how why who " +
    "qmark bang num wkwk haha oke bro").split(" "));

  const TEACH_RES = [
    /^(?:kalo|kalau|klo|jika|if|when)\s+(?:gw|gue|aku|saya|i|ada yang|someone|orang|user)?\s*(?:bilang|ngomong|ketik|nanya|tanya|say|says|type|types|ask|asks)\s+["'“]?(.+?)["'”]?\s*,?\s+(?:lu|lo|kamu|you|u)?\s*(?:bales|balas|jawab|bilang|reply|say|answer|respond)(?:\s+(?:with|pake|dengan|aja))?\s+["'“]?(.+?)["'”]?\s*$/i,
    /^(?:jawab|bales|balas|reply|say|answer)\s+["'“]?(.+?)["'”]?\s+(?:kalo|kalau|klo|if|when)\s+(?:gw|gue|aku|saya|i|ada yang|someone)?\s*(?:bilang|ngomong|ketik|say|says|type)\s+["'“]?(.+?)["'”]?\s*$/i,
  ];

  function dot(a, b) {
    let s = 0;
    const [small, big] = a.size < b.size ? [a, b] : [b, a];
    for (const [k, v] of small) { const w = big.get(k); if (w) s += v * w; }
    return s;
  }

  function parseTeach(text) {
    const t = String(text).trim();
    let m = t.match(TEACH_RES[0]);
    if (m) return { q: m[1].trim(), a: m[2].trim() };
    m = t.match(TEACH_RES[1]);
    if (m) return { q: m[2].trim(), a: m[1].trim() };
    return null;
  }

  function chunkText(text) {
    const parts = String(text).replace(/\r/g, "").split(/\n{2,}|(?<=[.!?])\s+(?=[A-Z0-9"“(])|\n(?=[-*#\d])/);
    const chunks = [];
    let buf = "";
    for (let p of parts) {
      p = p.replace(/\s+/g, " ").trim();
      if (!p) continue;
      if ((buf + " " + p).length > 320 && buf) { chunks.push(buf); buf = p; } else buf = buf ? buf + " " + p : p;
    }
    if (buf) chunks.push(buf);
    return chunks.filter((c) => c.length > 12).slice(0, 2000);
  }

  class Learner {
    constructor(storage) {
      this.storage = storage || null;
      this.data = this._load();
      this._index();
    }
    _blank() { return { pairs: [], words: {}, docs: [], images: [], seen: 0 }; }
    _load() {
      try {
        const raw = this.storage && this.storage.getItem(KEY);
        if (raw) return Object.assign(this._blank(), JSON.parse(raw));
      } catch (e) { /* ignore */ }
      return this._blank();
    }
    save() {
      try { if (this.storage) this.storage.setItem(KEY, JSON.stringify(this.data)); return true; } catch (e) { return false; }
    }
    wipe() { this.data = this._blank(); this._index(); this.save(); }
    _index() {
      this.pairVecs = this.data.pairs.map((p) => Lib.featurize(p.q, DIM));
      this.chunkIdx = [];
      for (const d of this.data.docs) for (const c of d.chunks) this.chunkIdx.push({ doc: d.name, text: c, vec: Lib.featurize(c, DIM) });
    }

    // ---------------- taught pairs
    teach(q, a) {
      const nq = Lib.normalize(q).join(" ");
      this.data.pairs = this.data.pairs.filter((p) => Lib.normalize(p.q).join(" ") !== nq);
      this.data.pairs.push({ q, a, at: Date.now() });
      if (this.data.pairs.length > 500) this.data.pairs.shift();
      this._index();
      this.save();
    }
    /** -> {q, a, score} or null */
    matchPair(text, threshold = 0.78) {
      if (!this.data.pairs.length) return null;
      const v = Lib.featurize(text, DIM), nt = Lib.normalize(text).join(" ");
      let best = null, bs = 0;
      this.data.pairs.forEach((p, i) => {
        const s = Lib.normalize(p.q).join(" ") === nt ? 1 : dot(v, this.pairVecs[i]);
        if (s > bs) { bs = s; best = p; }
      });
      return bs >= threshold ? Object.assign({ score: bs }, best) : null;
    }

    // ---------------- your words
    observe(text) {
      this.data.seen++;
      for (const w of Lib.normalize(text)) {
        if (w.length < 3 || STOP.has(w) || w.startsWith("emoji")) continue;
        this.data.words[w] = (this.data.words[w] || 0) + 1;
      }
      const entries = Object.entries(this.data.words);
      if (entries.length > 3000) this.data.words = Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, 2000));
      if (this.data.seen % 5 === 0) this.save();
    }
    favoriteWord(minCount = 3, exclude = []) {
      const e = Object.entries(this.data.words).filter(([w, c]) => c >= minCount && !exclude.includes(w)).sort((a, b) => b[1] - a[1]);
      return e.length ? { word: e[0][0], count: e[0][1] } : null;
    }
    knownWords(minCount = 3) { return Object.entries(this.data.words).filter(([, c]) => c >= minCount).map(([w]) => w); }

    // ---------------- files
    /** learn a text file. returns a summary {pairs, chunks, kind} */
    learnText(name, text) {
      const out = { name, pairs: 0, chunks: 0, kind: "notes" };
      let json = null;
      if (/\.json$/i.test(name) || /^\s*[[{]/.test(text)) { try { json = JSON.parse(text); } catch (e) { json = null; } }
      if (json) {
        const intents = Array.isArray(json) ? json : json.intents;
        if (Array.isArray(intents) && intents.some((i) => i && (i.patterns || i.q))) {
          for (const it of intents) {
            if (it.q && it.a) { this.teach(String(it.q), String(it.a)); out.pairs++; continue; }
            const rs = (it.responses || []).filter(Boolean);
            for (const p of it.patterns || []) if (rs.length) { this.teach(String(p), String(rs[Math.floor(Math.random() * rs.length)])); out.pairs++; }
          }
          out.kind = "intents";
          return out;
        }
        text = JSON.stringify(json, null, 1).replace(/[{}[\]",]/g, " ");
      }
      // "question => answer", "q: ... a: ...", or tab/semicolon separated pairs
      const lines = text.replace(/\r/g, "").split("\n");
      const pairRe = /^\s*(.+?)\s*(?:=>|->|\t|;|\s=\s)\s*(.+?)\s*$/;
      const pairLines = lines.filter((l) => pairRe.test(l) && l.length < 400);
      if (pairLines.length >= Math.max(2, lines.filter((l) => l.trim()).length * 0.6)) {
        for (const l of pairLines) { const m = l.match(pairRe); this.teach(m[1], m[2]); out.pairs++; }
        out.kind = "pairs";
        return out;
      }
      const chunks = chunkText(text);
      let used = this.data.docs.reduce((s, d) => s + d.chunks.join(" ").length, 0);
      const keep = [];
      for (const c of chunks) { if (used + c.length > MAX_DOC_CHARS) break; keep.push(c); used += c.length; }
      this.data.docs = this.data.docs.filter((d) => d.name !== name);
      this.data.docs.push({ name, chunks: keep, at: Date.now() });
      this._index();
      out.chunks = keep.length;
      out.truncated = keep.length < chunks.length;
      if (!this.save()) out.saveFailed = true;
      return out;
    }
    /** best matching passage from learned files -> {text, doc, score} or null */
    searchDocs(query, threshold = 0.3) {
      if (!this.chunkIdx.length) return null;
      const v = Lib.featurize(query, DIM);
      let best = null, bs = 0;
      for (const c of this.chunkIdx) { const s = dot(v, c.vec); if (s > bs) { bs = s; best = c; } }
      if (!best || bs < threshold) return null;
      // answer with the single best sentence of that passage, not the whole thing
      const sentences = best.text.split(/(?<=[.!?])\s+/).filter((x) => x.length > 3);
      let text = best.text, ss = -1;
      if (sentences.length > 1) for (const sen of sentences) { const sc = dot(v, Lib.featurize(sen, DIM)); if (sc > ss) { ss = sc; text = sen; } }
      return { text: text.replace(/[.!?\s]+$/, ""), passage: best.text, doc: best.doc, score: bs };
    }

    // ---------------- images
    addImage(name, z, grid) {
      this.data.images = this.data.images.filter((i) => i.name !== name);
      this.data.images.push({ name, z, grid: Array.from(grid).join(","), at: Date.now() });
      if (this.data.images.length > 60) this.data.images.shift();
      this.save();
    }

    stats() {
      return { pairs: this.data.pairs.length, words: Object.keys(this.data.words).length, docs: this.data.docs.length,
        chunks: this.chunkIdx.length, images: this.data.images.length };
    }
  }

  const api = { Learner, parseTeach, chunkText };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LearnLib = api;
})(typeof self !== "undefined" ? self : this);
