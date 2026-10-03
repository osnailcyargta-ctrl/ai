/* bot.js — the personality loop: memory + tools + neural nets.
 *
 * Flow per message:
 *   1. safety check (real self-harm talk -> drop the bit, give help)
 *   2. classifier net picks the intent
 *   3. tools fill facts: math, time, date, memory recall, choice parsing
 *   4. GRU generator writes several candidate replies, we keep the best one
 *      whose placeholders we can actually fill (= honest, no made-up facts)
 *   5. memory gets updated (name, likes, hates, age, insult count, history)
 */
(function (root) {
  "use strict";

  const MEMORY_KEY = "sybau_memory_v1";
  const CONF_THRESHOLD = 0.45; // below this the bot admits it didn't understand
  const LONG_ROAST_WORDS = 14; // insults this long get "stfu i ain't reading allat"

  const SELF_HARM_RE = /\b(kill myself|kms|end my life|want to die|wanna die|dont want to live|don't want to live|suicid\w*|bunuh diri|pengen mati|ingin mati|mau mati|pgn mati|nyakitin diri|self ?harm|hurt myself|ga mau hidup|gak mau hidup|nggak mau hidup)\b/i;

  const NAME_STOP = new Set(("sad bored hungry tired sleepy fine ok okay good bad here back not so very just " +
    "sedih gabut laper lapar ngantuk capek lagi mau suka bukan juga udah sudah lagi baik bosan bosen " +
    "kaya pinter ganteng cantik keren sigma rich smart cool handsome pretty the a an is gonna going " +
    "sorry maaf jomblo single bisa ga gak nggak tidak pergi off cabut lelah kesel marah").split(" "));

  const FILLER_TAIL = /\s+(bro|lol|dong|sih|deh|banget|bgt|fr|ya|yah|pls|please|wkwk\w*|bang|so much|a lot|too|juga|aja|kok|loh|lho|anjir|ngl)$/i;

  const PLACEHOLDER_FALLBACK_NAME = ["lil bro", "bro", "twin", "gng", "unc"];

  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function pick(arr, rand) { return arr[Math.floor(rand() * arr.length)]; }

  function cleanThing(s) {
    if (!s) return null;
    let t = s.toLowerCase().replace(/[?!.,"“”🥀💀😭]+/g, " ").replace(/\s+/g, " ").trim();
    for (let i = 0; i < 3; i++) t = t.replace(FILLER_TAIL, "").trim();
    t = t.split(" ").slice(0, 4).join(" ");
    if (!t || t.length > 32) return null;
    return t;
  }

  // ---------------------------------------------------------------- memory
  class Memory {
    constructor(storage) {
      this.storage = storage || null;
      this.data = this._load();
    }
    _blank() {
      return { name: null, age: null, likes: [], hates: [], insults: 0, compliments: 0,
        messages: 0, firstSeen: Date.now(), lastSeen: null, history: [], botRecent: [] };
    }
    _load() {
      try {
        const raw = this.storage && this.storage.getItem(MEMORY_KEY);
        if (raw) return Object.assign(this._blank(), JSON.parse(raw));
      } catch (e) { /* private mode etc. -> start fresh */ }
      return this._blank();
    }
    save() {
      try { if (this.storage) this.storage.setItem(MEMORY_KEY, JSON.stringify(this.data)); } catch (e) { /* ignore */ }
    }
    wipe() { this.data = this._blank(); this.save(); }
    addUnique(list, item) {
      if (!item) return;
      const l = this.data[list];
      const i = l.indexOf(item);
      if (i >= 0) l.splice(i, 1);
      l.unshift(item);
      if (l.length > 8) l.length = 8;
    }
    summary() {
      const d = this.data, parts = [];
      parts.push(d.name ? "ur name is " + cap(d.name) : "u never told me ur name (forgettable)");
      if (d.age) parts.push("ur " + d.age);
      if (d.likes.length) parts.push("u like " + d.likes.slice(0, 3).join(", "));
      if (d.hates.length) parts.push("u hate " + d.hates.slice(0, 3).join(", "));
      parts.push("u insulted me " + d.insults + "x");
      parts.push("we talked " + d.messages + " messages");
      return parts.join(", ");
    }
  }

  // ---------------------------------------------------------------- tools
  function findMath(text) {
    let t = " " + text.toLowerCase() + " ";
    t = t.replace(/×/g, "*").replace(/÷/g, "/")
      .replace(/\b(kali|times|dikali)\b/g, "*")
      .replace(/\b(tambah|ditambah|plus)\b/g, "+")
      .replace(/\b(kurang|dikurang|dikurangi|minus)\b/g, "-")
      .replace(/\b(bagi|dibagi|divided by)\b/g, "/")
      .replace(/([0-9])\s*x\s*(?=[0-9])/g, "$1*")
      .replace(/\b(pangkat|to the power of)\b/g, "^");
    const m = t.match(/[-+*/^().0-9\s]*[0-9][-+*/^().0-9\s]*/g);
    if (!m) return null;
    for (const cand of m.sort((a, b) => b.length - a.length)) {
      const expr = cand.trim();
      if (!/[0-9)]\s*[-+*/^]\s*[-(0-9]/.test(expr)) continue;
      const val = evalMath(expr);
      if (val !== null) return { expr, value: val };
    }
    return null;
  }

  // tiny recursive-descent parser (no eval(), so no injection)
  function evalMath(src) {
    const toks = src.match(/[0-9]*\.?[0-9]+|[-+*/^()]/g);
    if (!toks) return null;
    let i = 0;
    const peek = () => toks[i], next = () => toks[i++];
    function expr() {
      let v = term();
      while (peek() === "+" || peek() === "-") v = next() === "+" ? v + term() : v - term();
      return v;
    }
    function term() {
      let v = power();
      while (peek() === "*" || peek() === "/") v = next() === "*" ? v * power() : v / power();
      return v;
    }
    function power() {
      const b = unary();
      if (peek() === "^") { next(); return Math.pow(b, power()); }
      return b;
    }
    function unary() {
      if (peek() === "-") { next(); return -unary(); }
      if (peek() === "+") { next(); return unary(); }
      if (peek() === "(") {
        next();
        const v = expr();
        if (next() !== ")") throw new Error("paren");
        return v;
      }
      const t = next();
      if (t === undefined || !/[0-9]/.test(t)) throw new Error("num");
      return parseFloat(t);
    }
    try {
      const v = expr();
      if (i !== toks.length) return null;
      return v;
    } catch (e) { return null; }
  }

  function formatNumber(v) {
    if (!isFinite(v)) return "undefined (just like ur future)";
    return String(Math.round(v * 1e6) / 1e6);
  }

  const CHOICE_LEAD = /^(should i (pick|choose|get|buy|go with)|which is better|which one|mending|pilih|bagusan|lebih bagus|lebih baik|mana yang lebih (baik|bagus)|gw harus pilih|aku harus pilih|aku pilih|gw pilih|enakan|better|bro|tolong pilihin|pilihin)\s+/i;

  function parseChoice(text) {
    let t = text.toLowerCase().replace(/[?!.]+/g, " ").replace(/\s+/g, " ").trim();
    for (let i = 0; i < 3; i++) t = t.replace(CHOICE_LEAD, "");
    const m = t.match(/^(.+?)\s+(?:or|atau|vs\.?|apa|ato)\s+(.+)$/);
    if (!m) return null;
    const a = cleanThing(m[1]), b = cleanThing(m[2]);
    return a && b ? [a, b] : null;
  }

  function extractFacts(text, intent, mem) {
    const t = text.toLowerCase().trim();
    const out = {};
    let m = t.match(/(?:my name is|my names|my name's|call me|the name is|nama (?:gw|gue|aku|saya|ku)(?: adalah)?|namaku|panggil (?:aku|gw|gue|saya)|kenalin (?:gw|aku)|perkenalkan nama saya)\s+([a-z][a-z'-]{1,19})/);
    if (!m && intent === "tell_name")
      m = t.match(/^(?:i am|im|i'm|this is|gw|gue|aku|saya)\s+([a-z][a-z'-]{1,19})\s*$/);
    if (m && !NAME_STOP.has(m[1])) { out.name = m[1]; mem.data.name = m[1]; }

    const age = t.match(/(?:i am|im|i'm|umur(?:ku)?|usia)\s*(?:gw|gue|aku|saya)?\s*([0-9]{1,2})\b/) ||
      (intent === "tell_age" && t.match(/\b([0-9]{1,2})\b/));
    if (age) { out.age = age[1]; mem.data.age = age[1]; }

    if (intent === "like_something") {
      m = t.match(/(?:i really like|i like|i love|i'm into|im into|i enjoy|obsessed with|suka banget|suka main|suka dengerin|lagi suka|suka|demen|favorite is|favorit gw|kesukaan aku|love playing)\s+(.+)/) ||
        t.match(/^(.+?)\s+(?:is my favorite|is the best|is goated|the goat)/) ||
        t.match(/i think (.+?) is the best/);
      const thing = m && cleanThing(m[1]);
      if (thing) { out.thing = thing; mem.addUnique("likes", thing); }
    }
    if (intent === "hate_something") {
      m = t.match(/(?:i hate|i dont like|i don't like|i can't stand|i cant stand|benci|ga suka|gak suka|nggak suka|muak sama)\s+(.+)/) ||
        t.match(/^(.+?)\s+(?:is trash|sucks|jelek|itu sampah)/);
      const thing = m && cleanThing(m[1]);
      if (thing) { out.thing = thing; mem.addUnique("hates", thing); }
    }
    if (intent === "game") {
      m = t.match(/(?:i play|gw main|aku main|main)\s+(.+)/);
      const thing = m && cleanThing(m[1]);
      if (thing) { out.thing = thing; mem.addUnique("likes", thing); }
    }
    return out;
  }

  // ---------------------------------------------------------------- bot
  class RoastBot {
    constructor(brain, opts = {}) {
      this.brain = brain;
      this.mem = new Memory(opts.storage);
      this.rand = opts.rand || Math.random;
      this.now = opts.now || (() => new Date());
    }

    reply(text) {
      const brain = this.brain, mem = this.mem, rand = this.rand;
      const raw = String(text || "").trim();
      const d = mem.data;
      d.messages += 1;
      d.lastSeen = Date.now();

      const meta = { source: "gru", novel: false, confidence: 1, intent: null, top: [] };
      let intent;

      const ranked = brain.classify(raw);
      meta.top = ranked.slice(0, 3);
      const math = findMath(raw);

      const joking = /\b(mati ketawa|mati gaya|ngakak|mati kutu)\b/i.test(raw);
      if ((SELF_HARM_RE.test(raw) || ranked[0].tag === "selfharm" && ranked[0].p > 0.6) && !joking) {
        intent = "selfharm";
      } else if (math) {
        intent = "math";
      } else {
        intent = ranked[0].tag;
        meta.confidence = ranked[0].p;
        if (ranked[0].p < CONF_THRESHOLD || !raw) intent = "fallback";
      }

      const words = raw.split(/\s+/).filter(Boolean).length;
      if (intent === "insult") {
        d.insults += 1;
        if (words >= LONG_ROAST_WORDS) intent = "insult_long";
      }
      if (intent === "compliment") d.compliments += 1;

      const facts = extractFacts(raw, intent, mem);
      const slots = { name: d.name ? cap(d.name) : null, like: d.likes[0] || null, hate: d.hates[0] || null,
        thing: facts.thing || null, choice: null, other: null, answer: null };

      switch (intent) {
        case "math":
          if (math) slots.answer = formatNumber(math.value);
          else intent = "fallback";
          break;
        case "time":
          slots.answer = this.now().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
          break;
        case "date":
          slots.answer = this.now().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
          break;
        case "ask_name":
          slots.answer = d.name ? "ur name is " + cap(d.name) : "u never told me ur name. that's how forgettable u are";
          break;
        case "ask_memory":
          slots.answer = mem.summary();
          break;
        case "tell_age":
          if (facts.age) slots.answer = facts.age;
          else intent = "fallback";
          break;
        case "tell_name":
          if (!facts.name) intent = "fallback";
          break;
        case "choice": {
          const ab = parseChoice(raw);
          if (ab) {
            // the bot actually commits to an answer (then hates it anyway)
            const k = rand() < 0.5 ? 0 : 1;
            slots.choice = ab[k];
            slots.other = ab[1 - k];
          }
          break;
        }
      }
      meta.intent = intent;

      let out;
      if (intent === "selfharm") {
        out = pick(brain.responses.selfharm, rand);
        meta.source = "safety";
      } else {
        out = this._compose(intent, slots, meta);
        // sometimes flex the memory with a callback line
        if (!["fallback", "like_something", "hate_something", "ask_memory", "sad", "goodbye", "callback"].includes(intent) && (d.likes.length || d.hates.length) && d.messages > 3 && rand() < 0.18) {
          const extra = this._compose("callback", slots, {}, true);
          if (extra) out += " " + extra;
        }
      }

      d.botRecent.unshift(out);
      if (d.botRecent.length > 15) d.botRecent.length = 15;
      d.history.push({ role: "user", text: raw }, { role: "bot", text: out, meta: { intent, source: meta.source, novel: meta.novel } });
      if (d.history.length > 80) d.history.splice(0, d.history.length - 80);
      mem.save();
      return { text: out, meta };
    }

    _fill(tokensText, slots, strict) {
      let ok = true;
      const text = tokensText.replace(/\{(\w+)\}/g, (_, key) => {
        if (key === "name" && !strict) return slots.name || pick(PLACEHOLDER_FALLBACK_NAME, this.rand);
        const v = slots[key];
        if (v === null || v === undefined || v === "") { ok = false; return ""; }
        return v;
      });
      return ok ? text : null;
    }

    _compose(intent, slots, meta, strict = false) {
      const brain = this.brain, recent = new Set(this.mem.data.botRecent);
      const cands = [];
      for (let i = 0; i < 8; i++) {
        const g = brain.generate(intent, 0.9, this.rand);
        if (!g || !g.tokens.length) continue;
        const filled = this._fill(g.text, slots, strict);
        if (!filled || recent.has(filled)) continue;
        cands.push({ text: filled, raw: g.text, logp: g.logp });
      }
      if (cands.length) {
        cands.sort((a, b) => b.logp - a.logp);
        const best = cands[Math.floor(this.rand() * Math.min(3, cands.length))];
        meta.source = "gru";
        meta.novel = !brain.trainingLines.has(best.raw);
        return best.text;
      }
      // generator couldn't produce something fillable -> retrieve from training data
      const pool = (brain.responses[intent] || []).map((r) => this._fill(r, slots, strict)).filter((r) => r && !recent.has(r));
      if (pool.length) { meta.source = "retrieval"; return pick(pool, this.rand); }
      if (intent === "callback") return null;
      meta.source = "retrieval";
      return pick(brain.responses.fallback, this.rand);
    }
  }

  const api = { RoastBot, Memory, findMath, evalMath, parseChoice, extractFacts, CONF_THRESHOLD };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BotLib = api;
})(typeof self !== "undefined" ? self : this);
