/* bot.js — the personality loop: memory + tools + neural nets.
 *
 * Flow per message:
 *   1. safety check (real self-harm talk -> drop the bit, give help)
 *   2. language detection (id / en) so it replies in your language
 *   3. classifier net picks the intent
 *   4. tools fill facts: math, time, date, memory recall, choice parsing, search query
 *   5. GRU generator writes several candidate replies, we keep the best one
 *      whose placeholders we can actually fill (= honest, no made-up facts)
 *   6. grammar checker looks for a spelling crime to roast
 *   7. memory gets updated (name, likes, hates, age, insults, grammar crimes, history)
 */
(function (root) {
  "use strict";

  const Lib = root.BrainLib || (typeof require === "function" ? require("./brain.js") : null);
  const SLib = root.SearchLib || (typeof require === "function" ? require("./search.js") : null);

  const MEMORY_KEY = "sybau_memory_v1";
  const CONF_THRESHOLD = 0.42; // below this the bot admits it didn't understand
  const LONG_ROAST_WORDS = 14; // insults this long get "stfu i ain't reading allat"
  const N_CANDIDATES = 10;

  const SELF_HARM_RE = /\b(kill myself|kms|end my life|want to die|wanna die|dont want to live|don't want to live|suicid\w*|bunuh diri|pengen mati|ingin mati|mau mati|pgn mati|nyakitin diri|self ?harm|hurt myself|ga mau hidup|gak mau hidup|nggak mau hidup|nyayat tangan)\b/i;
  const JOKING_RE = /\b(mati ketawa|mati gaya|ngakak|mati kutu|mati lampu|hp mati|batre mati|baterai mati)\b/i;

  const NAME_STOP = new Set(("sad bored hungry tired sleepy fine ok okay good bad here back not so very just " +
    "sedih gabut laper lapar ngantuk capek lagi mau suka bukan juga udah sudah lagi baik bosan bosen " +
    "kaya pinter ganteng cantik keren sigma rich smart cool handsome pretty the a an is gonna going " +
    "sorry maaf jomblo single bisa ga gak nggak tidak pergi off cabut lelah kesel marah broke miskin " +
    "bokek gendut kurus pendek tinggi sakit stress stres insecure down").split(" "));

  const FILLER_TAIL = /\s+(bro|lol|dong|sih|deh|banget|bgt|fr|ya|yah|pls|please|plis|wkwk\w*|bang|so much|a lot|too|juga|aja|kok|loh|lho|anjir|ngl|cuy|nih|tuh|ges|gais|kan|lah)$/i;

  const FALLBACK_NAME = { en: ["lil bro", "bro", "twin", "gng", "unc"], id: ["bang", "bocil", "bro", "ngab", "bestie"] };

  const SEARCH_LEAD = /^(?:tolong |coba |bro |bang |eh |pls |please |can you |could you |bisa |lu )*(?:cariin|cari(?: info)?(?: tentang| soal)?|search(?: for)?|google|googling|googlein|look ?up|wiki(?:pedia)?|apa (?:itu|sih|yang dimaksud dengan)|siapa (?:itu|sih)|who (?:is|was)|what (?:is|are|was)|what's|whats|tell me about|jelas(?:in|kan|ain)(?: apa itu| tentang| soal)?|kasih tau(?: gw| aku)?(?: tentang| soal)?|info(?: tentang| soal)?|pengertian|arti(?:nya)?|definisi|define|sejarah|history of|explain|do you know|lu tau|kenal|tau|where is|dimana|kapan)\s+/i;
  const SEARCH_TAIL = /\s+(?:itu apa(?: sih)?|itu siapa(?: sih)?|apaan|itu|dong|deh|sih|ya|pls|please|plis|ga|gak|nggak|bang|bro|cuy|dimana|apa)$/i;

  const EN_WORDS = new Set(("i me my mine you your yours is are am was were the a an what how why who do does did so it its " +
    "this that and to of in for with on at be can will just not no yes roast hi hello hey bye thanks please " +
    "good bad dumb stupid funny love hate like want need know think tell search find").split(" "));

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

  /** -> {query, cued} ; cued = the message had an explicit "cari / apa itu / who is" part */
  function parseSearchQuery(raw) {
    const start = String(raw).toLowerCase().replace(/[?!"“”]+/g, " ").replace(/\s+/g, " ").trim();
    let t = start;
    for (let i = 0; i < 3; i++) t = t.replace(SEARCH_LEAD, "").trim();
    const cued = t !== start || / (?:itu apa|itu siapa|apaan)$/.test(start);
    for (let i = 0; i < 3; i++) t = t.replace(SEARCH_TAIL, "").trim();
    t = t.replace(/^(?:tentang|soal|about|the|a|an)\s+/, "").trim();
    if (!t || t.length > 80) return null;
    return { query: t, cued };
  }

  // ---------------------------------------------------------------- memory
  class Memory {
    constructor(storage) {
      this.storage = storage || null;
      this.data = this._load();
    }
    _blank() {
      return { name: null, age: null, likes: [], hates: [], insults: 0, compliments: 0, grammarCrimes: 0,
        grammarLog: [], searches: [], lang: null, messages: 0, firstSeen: Date.now(), lastSeen: null,
        history: [], botRecent: [] };
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
    addUnique(list, item, max = 8) {
      if (!item) return;
      const l = this.data[list];
      const i = l.indexOf(item);
      if (i >= 0) l.splice(i, 1);
      l.unshift(item);
      if (l.length > max) l.length = max;
    }
    summary(lang) {
      const d = this.data, p = [];
      if (lang === "id") {
        p.push(d.name ? "nama lu " + cap(d.name) : "lu ga pernah kasih tau nama (se-ga penting itu)");
        if (d.age) p.push("umur lu " + d.age);
        if (d.likes.length) p.push("lu suka " + d.likes.slice(0, 3).join(", "));
        if (d.hates.length) p.push("lu benci " + d.hates.slice(0, 3).join(", "));
        p.push("lu ngehina gw " + d.insults + "x");
        if (d.grammarCrimes) p.push("salah ketik " + d.grammarCrimes + "x");
        if (d.searches.length) p.push("terakhir lu nyari " + d.searches[0]);
        p.push("kita udah chat " + d.messages + " pesan");
      } else {
        p.push(d.name ? "ur name is " + cap(d.name) : "u never told me ur name (forgettable)");
        if (d.age) p.push("ur " + d.age);
        if (d.likes.length) p.push("u like " + d.likes.slice(0, 3).join(", "));
        if (d.hates.length) p.push("u hate " + d.hates.slice(0, 3).join(", "));
        p.push("u insulted me " + d.insults + "x");
        if (d.grammarCrimes) p.push(d.grammarCrimes + " grammar crimes");
        if (d.searches.length) p.push("u last searched " + d.searches[0]);
        p.push("we talked " + d.messages + " messages");
      }
      return p.join(", ");
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

  function formatNumber(v, lang) {
    if (!isFinite(v)) return lang === "id" ? "ga terdefinisi (kayak masa depan lu)" : "undefined (just like ur future)";
    return String(Math.round(v * 1e6) / 1e6);
  }

  const CHOICE_LEAD = /^(should i (pick|choose|get|buy|go with)|should i|would you rather|wyr|which is better|which one|team|mending|pilih mana|pilih|bagusan|bagus mana|lebih bagus|lebih baik|lebih enak|mana yang lebih (baik|bagus)|gw harus pilih|aku harus pilih|aku pilih|gw pilih|enakan|better|bro|bang|tolong pilihin|pilihin|menurut lu|gw beli|beli|kuliah di)\s+/i;

  function parseChoice(text) {
    let t = text.toLowerCase().replace(/[?!.]+/g, " ").replace(/\s+/g, " ").trim();
    for (let i = 0; i < 4; i++) t = t.replace(CHOICE_LEAD, "");
    let m = t.match(/^(.+?)\s+(?:or|atau|ato|vs\.?|apa|sama|or team)\s+(.+)$/);
    if (!m) return null;
    const a = cleanThing(m[1]), b = cleanThing(m[2].replace(/\s+(bagus mana|mana|which one|ya)$/, ""));
    return a && b && a !== b ? [a, b] : null;
  }

  function extractFacts(text, intent, mem) {
    const t = text.toLowerCase().trim();
    const out = {};
    let m = t.match(/(?:my name is|my names|my name's|call me|the name is|name's|i go by|nama (?:gw|gue|gua|w|aku|saya|ku)(?: adalah| tuh)?|nm gw|namaku(?: adalah)?|panggil (?:aku|gw|gue|saya|aja)|kenalin(?: nama)? (?:gw|aku)|perkenalkan nama saya)\s+([a-z][a-z'-]{1,19})/);
    if (!m && intent === "tell_name")
      m = t.match(/^(?:i am|im|i'm|this is|it's|its|gw|gue|aku|saya|ini|gw si|aku si)\s+([a-z][a-z'-]{1,19})(?:\s+here)?\s*$/);
    if (m && !NAME_STOP.has(m[1]) && m[1] !== "aja") { out.name = m[1]; mem.data.name = m[1]; }

    const age = t.match(/(?:i am|im|i'm|umur(?:ku)?|usia)\s*(?:gw|gue|aku|saya)?\s*([0-9]{1,2})\b/) ||
      (intent === "tell_age" && t.match(/\b([0-9]{1,2})\b/));
    if (age) { out.age = age[1]; mem.data.age = age[1]; }

    if (intent === "like_something") {
      m = t.match(/(?:i really like|i like|i love playing|i love|i'm into|im into|i enjoy|i stan|i'm a fan of|obsessed with|seneng banget sama|seneng|suka banget sama|suka banget|suka main|suka dengerin|lagi suka|suka sama|suka|demen|doyan|cinta|ngefans(?: sama)?|fans|hobi(?: gw| aku)?|hobiku|my hobby is|favorite is|favorit gw|kesukaan aku)\s+(.+)/) ||
        t.match(/^(.+?)\s+(?:is my favorite|is the best|is goated|the goat|is fire|hits different|enak bgt|enak banget|keren bgt|keren banget|terbaik|paling bagus)/) ||
        t.match(/i think (.+?) is the best/);
      const thing = m && cleanThing(m[1]);
      if (thing) { out.thing = thing; mem.addUnique("likes", thing); }
    }
    if (intent === "hate_something") {
      m = t.match(/(?:i hate|i dont like|i don't like|i can't stand|i cant stand|i despise|benci|ga suka sama|gak suka sama|ga suka|gak suka|nggak suka|ga demen|males sama|males|muak sama)\s+(.+)/) ||
        t.match(/^(.+?)\s+(?:is trash|sucks|jelek|itu sampah|ampas|overrated|is overrated|is mid|mid|is cringe|cringe)/);
      const thing = m && cleanThing(m[1]);
      if (thing) { out.thing = thing; mem.addUnique("hates", thing); }
    }
    if (intent === "game" || intent === "sport") {
      m = t.match(/(?:i play|gw main|aku main|main)\s+(.+)/);
      const thing = m && cleanThing(m[1]);
      if (thing) { out.thing = thing; mem.addUnique("likes", thing); }
    }
    if (intent === "ask_opinion") {
      m = t.match(/(?:menurut lu|pendapat lu (?:soal|tentang)|what do you think (?:about|of)|is)\s+(.+?)(?:\s+(?:bagus ga|bagus gak|good))?$/) ||
        t.match(/^(.+?)\s+bagus (?:ga|gak|nggak)/);
      const thing = m && cleanThing(m[1]);
      if (thing && !/^(gw|aku|me|gue)\b/.test(thing)) out.thing = thing;
    }
    return out;
  }

  // ---------------------------------------------------------------- bot
  class RoastBot {
    constructor(brain, opts = {}) {
      this.brain = brain;
      this.grammar = opts.grammar || null;
      // user settings: lang "auto" | "id" | "en", search on/off, grammar police on/off
      this.settings = Object.assign({ lang: "auto", search: true, grammar: true }, opts.settings || {});
      this.mem = new Memory(opts.storage);
      this.rand = opts.rand || Math.random;
      this.now = opts.now || (() => new Date());
      this.recentRaw = []; // templates used lately (before placeholders) -> less repetition
      this.respLang = {};
      for (const tag in brain.responses)
        this.respLang[tag] = brain.responses[tag].map((r) => Lib.detectLang(Lib.normalize(r.replace(/\{\w+\}/g, " "))));
    }

    detectLang(raw) {
      const toks = Lib.normalize(raw);
      let lang = Lib.detectLang(toks);
      // "ok", "lol", "?" carry no language signal -> keep the conversation's language
      if (lang === "en" && toks.length <= 2 && this.mem.data.lang && !toks.some((t) => EN_WORDS.has(t)))
        lang = this.mem.data.lang;
      return lang;
    }

    reply(text) {
      const brain = this.brain, mem = this.mem, rand = this.rand;
      const raw = String(text || "").trim();
      const d = mem.data;
      d.messages += 1;
      d.lastSeen = Date.now();
      const lang = this.settings.lang === "id" || this.settings.lang === "en" ? this.settings.lang : this.detectLang(raw);
      d.lang = lang;

      const meta = { source: "gru", novel: false, confidence: 1, intent: null, top: [], lang };
      let intent;

      const ranked = brain.classify(raw);
      meta.top = ranked.slice(0, 3);
      const math = findMath(raw);

      if ((SELF_HARM_RE.test(raw) || ranked[0].tag === "selfharm" && ranked[0].p > 0.6) && !JOKING_RE.test(raw)) {
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
        thing: facts.thing || null, choice: null, other: null, answer: null, query: null, title: null,
        wrong: null, right: null, count: null };

      switch (intent) {
        case "math":
          if (math) slots.answer = formatNumber(math.value, lang);
          else intent = "fallback";
          break;
        case "time":
          slots.answer = this.now().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
          break;
        case "date":
          slots.answer = this.now().toLocaleDateString(lang === "id" ? "id-ID" : "en-GB",
            { weekday: "long", day: "numeric", month: "long", year: "numeric" });
          break;
        case "ask_name":
          slots.answer = d.name ? (lang === "id" ? "nama lu " : "ur name is ") + cap(d.name)
            : (lang === "id" ? "lu ga pernah bilang nama lu. se-ga penting itu lu" : "u never told me ur name. that's how forgettable u are");
          break;
        case "ask_memory":
          slots.answer = mem.summary(lang);
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

      // ---- auto search: a factual question gets looked up, no "cari ..." needed
      let search = null;
      if (intent !== "selfharm" && intent !== "math") {
        const pq = SLib.parseQuestion(raw);
        const sq = parseSearchQuery(raw);
        const verb = /^\s*(?:tolong |coba |bro |bang )?(?:cari|cariin|search|google|googling|look ?up|wiki)\b/i.test(raw);
        const factual = !!(pq.rel && pq.subject && !pq.personal);
        const cued = !!(sq && sq.cued && (verb || !pq.personal) && pq.subject);
        const generic = pq.isQuestion && pq.subject && !pq.personal && pq.subject.split(" ").length <= 6 &&
          (["question", "fallback", "search"].includes(intent) || meta.confidence < 0.6);
        const sure = intent === "search" && meta.confidence > 0.85 && pq.subject && !pq.personal;
        if (factual || cued || generic || sure) {
          const shown = pq.rel ? (lang === "id" ? pq.rel.id + " " : pq.rel.en + " of ") + pq.subject : pq.subject || (sq && sq.query) || raw;
          slots.query = shown;
          if (!this.settings.search) {
            if (factual || cued || intent === "search") intent = "search_off";
          } else {
            intent = "search";
            search = { query: shown, question: pq, lang };
            mem.addUnique("searches", shown, 10);
          }
        } else if (intent === "search") intent = "fallback";
      }
      meta.intent = intent;

      let out;
      if (intent === "selfharm") {
        out = pick(brain.responses.selfharm, rand);
        meta.source = "safety";
      } else {
        out = this._compose(intent, slots, meta, lang);
        // sometimes flex the memory with a callback line
        const noCallback = ["fallback", "like_something", "hate_something", "ask_memory", "sad", "goodbye", "search", "search_off"];
        if (!noCallback.includes(intent) && (d.likes.length || d.hates.length) && d.messages > 3 &&
            d.messages - (d.lastCallback || 0) >= 5 && rand() < 0.2) {
          const extra = this._compose("callback", slots, {}, lang, true);
          if (extra) { out += " " + extra; d.lastCallback = d.messages; this._remember(extra); }
        }
      }

      // grammar police
      let grammar = null;
      if (this.grammar && this.settings.grammar && intent !== "selfharm" && intent !== "sad") {
        const extraKnown = new Set([d.name, slots.query, slots.thing, slots.choice, slots.other]
          .filter(Boolean).flatMap((s) => s.split(" ")));
        const err = this.grammar.check(raw, { lang, extraKnown });
        if (err) {
          d.grammarCrimes += 1;
          d.grammarLog.unshift(err.wrong + " → " + err.right);
          if (d.grammarLog.length > 10) d.grammarLog.length = 10;
          const gs = Object.assign({}, slots, { wrong: err.wrong, right: err.right,
            count: d.grammarCrimes >= 2 ? String(d.grammarCrimes) : null });
          const line = this._compose("grammar", gs, {}, lang);
          grammar = Object.assign({ text: line }, err);
        }
      }

      // didn't understand the message but caught a typo? the typo roast IS the reply
      if (grammar && grammar.text && intent === "fallback") out = null;

      d.history.push({ role: "user", text: raw });
      if (out) {
        this._remember(out);
        d.history.push({ role: "bot", text: out, meta: { intent, source: meta.source, novel: meta.novel } });
      }
      if (grammar) d.history.push({ role: "bot", kind: "grammar", text: grammar.text, wrong: grammar.wrong, right: grammar.right });
      this._trim();
      mem.save();
      return { text: out, meta, grammar, search };
    }

    /** after the browser finished the Wikipedia lookup */
    searchFollowup(result, query, lang) {
      const title = !result ? null : result.kind === "fact" ? result.answer + " (" + result.relation + " " + result.subject + ")" : result.title;
      const slots = { name: this.mem.data.name ? cap(this.mem.data.name) : null, query, title };
      const text = this._compose(result ? "search_done" : "search_fail", slots, {}, lang || this.mem.data.lang || "en");
      if (result) this.mem.data.history.push({ role: "bot", kind: "search", result });
      this.mem.data.history.push({ role: "bot", text, meta: { intent: result ? "search_done" : "search_fail", source: "gru" } });
      this._remember(text);
      this._trim();
      this.mem.save();
      return text;
    }

    _remember(text) {
      const d = this.mem.data;
      d.botRecent.unshift(text);
      if (d.botRecent.length > 20) d.botRecent.length = 20;
    }

    _trim() {
      const h = this.mem.data.history;
      if (h.length > 100) h.splice(0, h.length - 100);
    }

    _fill(tokensText, slots, lang, strict) {
      let ok = true;
      const text = tokensText.replace(/\{(\w+)\}/g, (_, key) => {
        if (key === "name" && !strict) return slots.name || pick(FALLBACK_NAME[lang] || FALLBACK_NAME.en, this.rand);
        const v = slots[key];
        if (v === null || v === undefined || v === "") { ok = false; return ""; }
        return v;
      });
      return ok ? text : null;
    }

    _compose(intent, slots, meta, lang = "en", strict = false) {
      const brain = this.brain, recent = new Set(this.mem.data.botRecent);
      const cands = [];
      for (let i = 0; i < N_CANDIDATES; i++) {
        const g = brain.generate(intent, lang, 0.85, this.rand);
        if (!g || !g.tokens.length) continue;
        const filled = this._fill(g.text, slots, lang, strict);
        if (!filled || recent.has(filled)) continue;
        let score = g.logp;
        if (this.recentRaw.includes(g.text)) score -= 1.5;
        // the generator is conditioned on language, but double-check and prefer a match
        if (Lib.detectLang(Lib.normalize(g.text.replace(/\{\w+\}/g, " "))) !== lang) score -= 0.6;
        cands.push({ text: filled, raw: g.text, score });
      }
      if (cands.length) {
        cands.sort((a, b) => b.score - a.score);
        const best = cands[Math.floor(this.rand() * Math.min(3, cands.length))];
        this.recentRaw.unshift(best.raw);
        if (this.recentRaw.length > 12) this.recentRaw.length = 12;
        meta.source = "gru";
        meta.novel = !brain.trainingLines.has(best.raw);
        return best.text;
      }
      // generator couldn't produce something fillable -> retrieve from training data, same language first
      const all = brain.responses[intent] || [];
      const langs = this.respLang[intent] || [];
      const fill = (idxs) => idxs.map((i) => this._fill(all[i], slots, lang, strict)).filter((r) => r && !recent.has(r));
      let pool = fill(all.map((_, i) => i).filter((i) => langs[i] === lang));
      if (!pool.length) pool = fill(all.map((_, i) => i));
      if (pool.length) { meta.source = "retrieval"; return pick(pool, this.rand); }
      if (intent === "callback" || intent === "grammar") return null;
      meta.source = "retrieval";
      return pick(brain.responses.fallback, this.rand);
    }
  }

  const api = { RoastBot, Memory, findMath, evalMath, parseChoice, parseSearchQuery, extractFacts, CONF_THRESHOLD };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BotLib = api;
})(typeof self !== "undefined" ? self : this);
