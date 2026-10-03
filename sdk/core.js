/* sdk/core.js — the public sybau.ai SDK. Bundled into /sybau.js by tools/build_sdk.py.
 *
 *   <script src="https://osnailcyargta-ctrl.github.io/ai/sybau.js"></script>
 *   <script>
 *     const sybau = new Sybau({ connectKey: "sybau-ck-7f3a9c2e1b8d4f60a5e3" });
 *     const r = await sybau.chat("halo");   // { text, intent, lang, search, grammar, image, ... }
 *   </script>
 *
 * There is no server: the SDK downloads the trained model files (GitHub Pages
 * allows that from any website) and runs the neural nets inside YOUR app.
 * Works in any web page and in Node.js 18+.
 */
(function (root) {
  "use strict";
  const CONNECT_KEY = "sybau-ck-7f3a9c2e1b8d4f60a5e3";
  const DEFAULT_BASE = "https://osnailcyargta-ctrl.github.io/ai/";
  const VERSION = "1.0.0";
  const scriptBase = (function () {
    try {
      const s = typeof document !== "undefined" && document.currentScript && document.currentScript.src;
      if (s) return s.replace(/[^/]*$/, "");
    } catch (e) { /* ignore */ }
    return null;
  })();

  function memoryStorage() {
    const m = {};
    return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } };
  }
  function prefixed(storage, prefix) {
    return { getItem: (k) => storage.getItem(prefix + k), setItem: (k, v) => storage.setItem(prefix + k, v), removeItem: (k) => storage.removeItem(prefix + k) };
  }

  class Sybau {
    /**
     * @param {object} opts
     * @param {string} opts.connectKey   required, copy it from /connect
     * @param {string} [opts.baseUrl]    where model/ lives (default: the official github.io site)
     * @param {"auto"|"id"|"en"} [opts.lang]
     * @param {boolean} [opts.search=true]   auto Wikipedia/Wikidata lookups
     * @param {boolean} [opts.grammar=true]  grammar police
     * @param {boolean} [opts.learn=false]   learn from the user's words
     * @param {boolean|string} [opts.memory=true] true = localStorage (browser), false = forget on reload, string = storage namespace
     */
    constructor(opts = {}) {
      if (opts.connectKey !== CONNECT_KEY) throw new Error("sybau: invalid connectKey. copy it from /connect on the sybau.ai site");
      this.opts = Object.assign({ lang: "auto", search: true, grammar: true, learn: false, memory: true }, opts);
      this.baseUrl = (opts.baseUrl || scriptBase || DEFAULT_BASE).replace(/\/?$/, "/");
      let st = null;
      if (this.opts.memory !== false && typeof localStorage !== "undefined") {
        try { localStorage.getItem("x"); st = prefixed(localStorage, (typeof this.opts.memory === "string" ? this.opts.memory : "sdk") + ":"); } catch (e) { st = null; }
      }
      this.storage = st || memoryStorage();
      this._ready = null;
    }

    ready() {
      if (!this._ready) this._ready = this._load();
      return this._ready;
    }

    async _load() {
      const get = async (f) => {
        const res = await fetch(this.baseUrl + f);
        if (!res.ok) throw new Error("sybau: could not load " + this.baseUrl + f + " (" + res.status + ")");
        return res.json();
      };
      const [brainJson, lexJson, pixJson] = await Promise.all([get("model/brain.json"), get("model/lexicon.json").catch(() => null), get("model/pixels.json").catch(() => null)]);
      const brain = new root.BrainLib.Brain(brainJson);
      const grammar = lexJson ? new root.GrammarLib.Grammar(lexJson) : null;
      this.pixels = pixJson ? new root.PixelLib.PixelBrain(pixJson) : null;
      this.learner = new root.LearnLib.Learner(this.storage);
      if (this.pixels) this.pixels.addLearned(this.learner.data.images);
      this.bot = new root.BotLib.RoastBot(brain, { storage: this.storage, grammar, learner: this.learner,
        settings: { lang: this.opts.lang, search: this.opts.search, grammar: this.opts.grammar, learn: this.opts.learn } });
      return this;
    }

    /** send a message, get sybau's reply (search + drawing are resolved for you) */
    async chat(text) {
      await this.ready();
      const res = this.bot.reply(String(text || ""));
      const out = { text: res.text, intent: res.meta.intent, lang: res.meta.lang, confidence: res.meta.confidence, source: res.meta.source,
        grammar: res.grammar ? { wrong: res.grammar.wrong, right: res.grammar.right, text: res.grammar.text } : null,
        search: null, followup: null, image: null };
      if (res.search) {
        out.search = await root.SearchLib.answer(res.search.question, res.search.lang);
        out.followup = this.bot.searchFollowup(out.search, res.search.query, res.search.lang);
      }
      if (res.draw && this.pixels) {
        const d = this.pixels.draw(res.draw.prompt, { size: res.draw.size });
        out.image = { size: d.size, labels: d.labels, known: d.known, text: this.pixels.toText(d.grid, d.size),
          dataUrl: this.pixels.toDataURL(d.grid, d.size, d.size === 16 ? 8 : 4), grid: Array.from(d.grid),
          palette: this.pixels.palette.map((p) => p.hex) };
        out.followup = this.bot.drawFollowup(d, res.draw);
      }
      if (res.github) out.github = { note: "github actions need the full sybau.ai site (they ask for permission there)", action: res.github };
      // one string with everything, handy for simple apps
      out.full = [out.text, out.search ? (out.search.kind === "fact" ? out.search.relation + " " + out.search.subject + ": " + out.search.answer : out.search.title + " - " + out.search.extract) : null,
        out.followup, out.grammar ? out.grammar.text : null].filter(Boolean).join("\n");
      return out;
    }

    /** draw pixel art directly */
    async draw(prompt, size = 16) {
      await this.ready();
      const d = this.pixels.draw(prompt, { size });
      return { size: d.size, labels: d.labels, known: d.known, text: this.pixels.toText(d.grid, d.size), dataUrl: this.pixels.toDataURL(d.grid, d.size, d.size === 16 ? 8 : 4) };
    }

    /** teach a reply: when the user says q, answer a */
    async teach(q, a) { await this.ready(); this.learner.teach(q, a); }
    /** learn a text document (notes, "q => a" lines, intents json) */
    async learnText(name, text) { await this.ready(); return this.learner.learnText(name, text); }
    /** forget everything about this user */
    async reset() { await this.ready(); this.bot.mem.wipe(); this.learner.wipe(); }
    get memory() { return this.bot ? this.bot.mem.data : null; }
    setOptions(o) { Object.assign(this.opts, o); if (this.bot) Object.assign(this.bot.settings, o); }
  }
  Sybau.version = VERSION;

  root.Sybau = Sybau;
  if (typeof module !== "undefined" && module.exports) module.exports = { Sybau };
})(typeof self !== "undefined" ? self : globalThis);
