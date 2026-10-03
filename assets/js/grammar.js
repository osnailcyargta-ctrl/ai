/* grammar.js — finds ONE grammar/spelling crime in the user's message so the bot
 * can roast it. Runs on model/lexicon.json (word frequency lists + rules from
 * data/grammar_rules.json). Order of checks, most confident first:
 *   1. known wrong phrases   ("your welcome", "should of", "better then")
 *   2. known wrong words      ("definately", "praktek", "silahkan", "disini")
 *   3. Indonesian di-/ke-     ("dirumah" -> "di rumah", "di makan" -> "dimakan")
 *   4. typos                  word not in 80k-word lists, 1 edit away from a common word
 */
(function (root) {
  "use strict";

  const ALPHA = "abcdefghijklmnopqrstuvwxyz";

  function edits1(w) {
    const out = new Set();
    for (let i = 0; i <= w.length; i++) {
      const a = w.slice(0, i), b = w.slice(i);
      if (b) out.add(a + b.slice(1)); // delete
      if (b.length > 1) out.add(a + b[1] + b[0] + b.slice(2)); // transpose
      for (const c of ALPHA) {
        if (b) out.add(a + c + b.slice(1)); // replace
        out.add(a + c + b); // insert
      }
    }
    out.delete(w);
    return out;
  }

  class Grammar {
    constructor(lex) {
      this.rank = { en: new Map(), id: new Map() };
      for (const lang of ["en", "id"]) lex[lang].split(" ").forEach((w, i) => this.rank[lang].set(w, i));
      this.known = new Set(lex.known.split(" "));
      const r = lex.rules;
      this.phrases = [];
      this.words = new Map();
      for (const [k, v] of Object.entries(r.phrases)) this.phrases.push([k, v]);
      for (const [k, v] of Object.entries(r.words)) {
        if (k.includes(" ")) { if (v) this.phrases.push([k, v]); }
        else this.words.set(k, v); // v === null -> explicitly fine
      }
      this.phrases.sort((a, b) => b[0].length - a[0].length);
      this.diPlace = new Set(r.di_place);
      this.kePlace = new Set(r.ke_place);
      this.diVerbs = new Set(r.di_verbs);
      this.typoMaxRank = 15000;
    }

    isWord(w) {
      return this.known.has(w) || this.rank.en.has(w) || this.rank.id.has(w);
    }

    /** -> {wrong, right, kind} or null */
    check(text, opts = {}) {
      const lang = opts.lang || "en";
      const extra = opts.extraKnown || new Set();
      const clean = String(text).replace(/https?:\/\/\S+/g, " ").replace(/[’`]/g, "'");
      const original = clean.match(/[A-Za-z']+/g) || [];
      const words = original.map((w) => w.toLowerCase().replace(/^'+|'+$/g, "")).filter(Boolean);
      if (!words.length) return null;
      const joined = " " + words.join(" ") + " ";

      for (const [wrong, right] of this.phrases) {
        if (joined.includes(" " + wrong + " ")) return { wrong, right, kind: "phrase" };
      }

      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (extra.has(w)) continue;
        if (this.words.has(w)) {
          const right = this.words.get(w);
          if (right) return { wrong: w, right, kind: "word" };
          continue;
        }
        if (w.length > 3 && w.startsWith("di") && this.diPlace.has(w.slice(2)))
          return { wrong: w, right: "di " + w.slice(2), kind: "di" };
        if (w.length > 3 && w.startsWith("ke") && this.kePlace.has(w.slice(2)))
          return { wrong: w, right: "ke " + w.slice(2), kind: "ke" };
        if (w === "di" && i + 1 < words.length && this.diVerbs.has(words[i + 1]))
          return { wrong: "di " + words[i + 1], right: "di" + words[i + 1], kind: "di" };
      }

      const prefer = lang === "id" ? ["id", "en"] : ["en", "id"];
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (w.length < 4 || w.includes("'") || extra.has(w) || this.isWord(w)) continue;
        if (/(.)\1\1/.test(w)) continue; // "cooool", "anjirrr" = style, not a typo
        if (this.isWord(w.replace(/(.)\1+/g, "$1"))) continue; // "sukaa", "bangeet" = style too
        if (/^(?:a?w?k?(?:wk|kw)+[wk]?|(?:ha|he|hi|hu|ah|xi)+h?)$/.test(w)) continue; // laughing
        if ((w.match(/[aeiou]/g) || []).length <= 1 && w.length <= 6) continue; // chat abbreviations: mksd, nnti, bgsd
        if (i > 0 && /^[A-Z][a-z]/.test(original[i] || "")) continue; // Proper Noun
        let best = null, bestScore = Infinity;
        for (const c of edits1(w)) {
          for (let k = 0; k < 2; k++) {
            const rk = this.rank[prefer[k]].get(c);
            if (rk === undefined || rk > this.typoMaxRank) continue;
            const score = rk + k * 3000;
            if (score < bestScore) { bestScore = score; best = c; }
          }
          // words from the bot's own training data (minecraft, valorant, rizz...) count as common
          if (this.known.has(c) && c.length > 3 && 6000 < bestScore) { bestScore = 6000; best = c; }
        }
        if (best) return { wrong: w, right: best, kind: "typo" };
      }
      return null;
    }
  }

  async function loadGrammar(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("lexicon.json " + res.status);
    return new Grammar(await res.json());
  }

  const api = { Grammar, loadGrammar, edits1 };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GrammarLib = api;
})(typeof self !== "undefined" ? self : this);
