/* search.js — answers questions from the browser, no API key.
 *
 * Two sources, both free and allowed from any website (CORS origin=*):
 *  - Wikidata: structured facts. "ibukota kazakstan" -> entity Kazakhstan (Q232)
 *    -> property P36 (capital) -> Astana. Used whenever the question asks for a
 *    known relation (capital, president, population, born, age, founder, ...).
 *  - Wikipedia: summaries for "apa itu X" / "who is X" / anything else, with
 *    typo tolerance ("did you mean") and redirects.
 *
 * Why not Google? Google's search API needs a key, and google.com blocks other
 * sites from reading its results. The UI still links to Google for every query.
 */
(function (root) {
  "use strict";

  // ------------------------------------------------------------ question parsing
  // relation keywords -> Wikidata properties (first property that has a value wins)
  const RELATIONS = [
    { kw: ["tempat lahir", "lahir di ?mana", "lahirnya di ?mana", "born where", "birthplace", "place of birth"], props: ["P19"], id: "tempat lahir", en: "birthplace" },
    { kw: ["ibu ?kota", "capital city", "capital"], props: ["P36"], id: "ibu kota", en: "capital" },
    { kw: ["perdana menteri", "prime minister"], props: ["P6"], id: "perdana menteri", en: "prime minister" },
    { kw: ["gubernur", "governor", "wali ?kota", "walikota", "mayor", "bupati"], props: ["P6"], id: "kepala daerah", en: "head of government" },
    { kw: ["presiden", "president", "kepala negara", "head of state", "raja", "king", "ratu", "queen", "pemimpin", "leader"], props: ["P35", "P6"], id: "kepala negara", en: "head of state" },
    { kw: ["ceo", "direktur utama", "chief executive"], props: ["P169"], id: "CEO", en: "CEO" },
    { kw: ["pendiri", "founder", "didirikan oleh", "founded by", "yang mendirikan", "who founded", "mendirikan"], props: ["P112"], id: "pendiri", en: "founder" },
    { kw: ["jumlah penduduk", "penduduk", "populasi", "population", "how many people"], props: ["P1082"], id: "jumlah penduduk", en: "population", latest: true },
    { kw: ["mata uang", "currency", "duit"], props: ["P38"], id: "mata uang", en: "currency" },
    { kw: ["bahasa resmi", "official language", "bahasa", "language"], props: ["P37", "P103", "P407"], id: "bahasa", en: "language" },
    { kw: ["lagu kebangsaan", "national anthem", "anthem"], props: ["P85"], id: "lagu kebangsaan", en: "anthem" },
    { kw: ["luas wilayah", "luas", "area", "how big"], props: ["P2046"], id: "luas", en: "area" },
    { kw: ["ketinggian", "tinggi", "height", "how tall", "elevation"], props: ["P2048", "P2044"], id: "tinggi", en: "height" },
    { kw: ["panjang", "length", "how long is"], props: ["P2043"], id: "panjang", en: "length" },
    { kw: ["umur", "usia", "how old", "age"], props: ["P569"], id: "umur", en: "age", age: true },
    { kw: ["tanggal lahir", "lahir", "born", "birthday", "ulang tahun"], props: ["P569"], id: "lahir", en: "born" },
    { kw: ["meninggal", "wafat", "died", "death", "mati", "tewas"], props: ["P570"], id: "meninggal", en: "died" },
    { kw: ["istri", "suami", "pasangan", "wife", "husband", "spouse", "married to", "nikah sama"], props: ["P26"], id: "pasangan", en: "spouse" },
    { kw: ["anak", "children", "kids"], props: ["P40"], id: "anak", en: "children" },
    { kw: ["ayah", "bapak", "father", "dad"], props: ["P22"], id: "ayah", en: "father" },
    { kw: ["penemu", "inventor", "invented", "menemukan", "discoverer", "discovered", "ditemukan oleh"], props: ["P61"], id: "penemu", en: "inventor" },
    { kw: ["penulis", "pengarang", "author", "wrote", "written by", "menulis", "ditulis oleh"], props: ["P50"], id: "penulis", en: "author" },
    { kw: ["sutradara", "director", "directed by"], props: ["P57"], id: "sutradara", en: "director" },
    { kw: ["pencipta", "creator", "created by", "who created", "nyiptain", "menciptakan", "pembuat", "who made", "developer", "pengembang"], props: ["P170", "P178", "P50", "P61", "P112"], id: "pencipta", en: "creator" },
    { kw: ["benua", "continent"], props: ["P30"], id: "benua", en: "continent" },
    { kw: ["zona waktu", "time ?zone"], props: ["P421"], id: "zona waktu", en: "time zone" },
    { kw: ["kode telepon", "calling code", "kode negara"], props: ["P474"], id: "kode telepon", en: "calling code" },
    { kw: ["didirikan", "berdiri", "dibentuk", "founded", "established", "sejak kapan"], props: ["P571"], id: "didirikan", en: "founded" },
    { kw: ["pekerjaan", "profesi", "occupation", "kerjanya", "job"], props: ["P106"], id: "pekerjaan", en: "occupation" },
    { kw: ["kewarganegaraan", "warga negara", "citizenship", "nationality"], props: ["P27"], id: "kewarganegaraan", en: "citizenship" },
    { kw: ["agama", "religion"], props: ["P140"], id: "agama", en: "religion" },
    { kw: ["klub", "club", "plays for", "main di tim", "timnya"], props: ["P54"], id: "klub", en: "team" },
    { kw: ["kantor pusat", "markas", "headquarters", "hq"], props: ["P159"], id: "kantor pusat", en: "headquarters" },
    { kw: ["pemilik", "owner", "owned by", "punya siapa"], props: ["P127"], id: "pemilik", en: "owner" },
    { kw: ["genre"], props: ["P136"], id: "genre", en: "genre" },
    { kw: ["negara mana", "negara apa", "which country", "negaranya", "asal negara"], props: ["P17", "P495", "P27"], id: "negara", en: "country" },
  ].map((r) => Object.assign(r, { re: new RegExp("\\b(?:" + r.kw.join("|") + ")(?:nya)?\\b", "i") }));

  const SEARCH_VERBS = /^(?:(?:tolong|coba|bro|bang|eh|pls|please|can you|could you|bisa|lu|gw mau|aku mau|mau)\s+)*(?:cariin|cari(?:kan)?|search(?: for)?|google|googling|googlein|look ?up|wiki(?:pedia)?|kasih tau(?: gw| aku)?|tell me|jelas(?:in|kan|ain)|explain|info)\b\s*/i;
  const QWORDS = /\b(apa|apakah|apaan|siapa|siapakah|berapa|berapakah|brp|kapan|kapankah|dimana|di mana|mana|gimana|bagaimana|kenapa|mengapa|knp|napa|what|whats|what's|who|whom|whose|which|where|when|why|how|is it true)\b/i;
  const STOP = new Set(("apa apakah apaan siapa siapakah berapa berapakah brp kapan kapankah dimana mana gimana bagaimana kenapa " +
    "mengapa knp napa yang yg itu ini adalah ialah merupakan dari nya sih ya dong deh kah bro bang cuy tolong kasih tau tahu " +
    "pengen mau sekarang saat skrg current currently now today what whats who whom whose which where when why how is are " +
    "was were the a an of in on does do did many much tell me about please pls kind sort type negara country kota city " +
    "jumlah total sebenarnya sebenernya emang emangnya sama dengan ke di for to by si sang").split(" "));
  const PERSONAL = /\b(lu|lo|elu|kamu|km|gw|gue|gua|aku|saya|you|your|ur|u|me|my|mine|i|im|i'm|kita|kalian)\b/i;

  /** -> {rel, subject, display, isQuestion, personal} */
  function parseQuestion(raw) {
    const display = String(raw || "").replace(/\s+/g, " ").trim().replace(/[?!.]+$/, "");
    let t = " " + display.toLowerCase().replace(/[?!.,"“”'’]+/g, " ").replace(/\s+/g, " ").trim() + " ";
    t = t.trim().replace(SEARCH_VERBS, "");
    const isQuestion = /\?\s*$/.test(String(raw)) || QWORDS.test(t);
    let rel = null;
    for (const r of RELATIONS) {
      const m = t.match(r.re);
      if (m) { rel = r; t = (t.slice(0, m.index) + " " + t.slice(m.index + m[0].length)); break; }
    }
    // "where was X born" / "X lahir di mana" -> birthplace, not birth date
    if (rel && rel.props[0] === "P569" && !rel.age && /\b(where|dimana|mana)\b/.test(t)) rel = RELATIONS[0];
    const words = t.replace(/\b(itu apa|itu siapa)\b/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w));
    const subject = words.join(" ").trim();
    const personal = PERSONAL.test(display.toLowerCase());
    return { rel, subject, display, isQuestion, personal };
  }

  // ------------------------------------------------------------ http
  function googleUrl(q) { return "https://www.google.com/search?q=" + encodeURIComponent(q); }

  function trimExtract(text, max = 420) {
    const t = String(text || "").replace(/\s+/g, " ").trim();
    if (t.length <= max) return t;
    const cut = t.slice(0, max);
    const dot = cut.lastIndexOf(". ");
    return dot > 120 ? cut.slice(0, dot + 1) : cut.replace(/\s+\S*$/, "") + "…";
  }

  function qs(params) {
    return Object.entries(Object.assign({ format: "json", origin: "*" }, params))
      .map(([k, v]) => k + "=" + encodeURIComponent(v)).join("&");
  }

  async function getJson(f, url, ms) {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), ms) : null;
    try {
      const res = await f(url, ctrl ? { signal: ctrl.signal } : undefined);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // ------------------------------------------------------------ wikipedia
  const wikiApi = (l) => "https://" + l + ".wikipedia.org/w/api.php?";

  function pageFrom(data, l) {
    const pages = data && data.query && data.query.pages;
    if (!pages) return null;
    const page = Object.values(pages).find((p) => !("missing" in p) && !("invalid" in p));
    if (!page) return null;
    return {
      title: page.title,
      extract: trimExtract(page.extract || ""),
      url: page.fullurl || "https://" + l + ".wikipedia.org/wiki/" + encodeURIComponent(page.title.replace(/ /g, "_")),
      thumb: page.thumbnail ? page.thumbnail.source : null,
      qid: page.pageprops && page.pageprops.wikibase_item || null,
      disambig: !!(page.pageprops && "disambiguation" in page.pageprops),
      lang: l,
    };
  }

  const PAGE_PROPS = { prop: "extracts|pageimages|info|pageprops", inprop: "url", exintro: 1, explaintext: 1, exsentences: 4,
    piprop: "thumbnail", pithumbsize: 240, ppprop: "wikibase_item|disambiguation", redirects: 1 };

  async function wikiPage(f, l, title, ms) {
    return pageFrom(await getJson(f, wikiApi(l) + qs(Object.assign({ action: "query", titles: title }, PAGE_PROPS)), ms), l);
  }

  /** full-text search with "did you mean" -> up to n titles */
  async function wikiTitles(f, l, query, n, ms) {
    for (let attempt = 0, q = query; attempt < 2 && q; attempt++) {
      const d = await getJson(f, wikiApi(l) + qs({ action: "query", list: "search", srsearch: q, srlimit: n, srinfo: "suggestion", srprop: "" }), ms);
      const hits = d && d.query && d.query.search || [];
      if (hits.length) return hits.map((h) => h.title);
      q = d && d.query && d.query.searchinfo && d.query.searchinfo.suggestion;
    }
    return [];
  }

  /** best Wikipedia page for a free-text query: exact title/redirect first, then search */
  async function wikiFind(f, query, order, ms) {
    for (const l of order) {
      let p = await wikiPage(f, l, query, ms);
      if (p && p.extract && !p.disambig) return p;
      const titles = await wikiTitles(f, l, query, 1, ms);
      if (titles.length) {
        p = await wikiPage(f, l, titles[0], ms);
        if (p && p.extract) return p;
      }
    }
    return null;
  }

  // ------------------------------------------------------------ wikidata
  const WD = "https://www.wikidata.org/w/api.php?";
  const UNITS = { Q712226: "km²", Q25343: "m²", Q11573: "m", Q828224: "km", Q174728: "cm", Q11570: "kg", Q41803: "g",
    Q11574: "detik", Q7727: "menit", Q25235: "jam", Q577: "tahun", Q4917: "USD", Q41588: "IDR", Q81292: "acre", Q3710: "ft" };

  async function wdEntities(f, ids, langs, ms, props = "claims|labels|sitelinks") {
    if (!ids.length) return {};
    const d = await getJson(f, WD + qs({ action: "wbgetentities", ids: ids.slice(0, 50).join("|"), props, languages: langs.join("|"),
      sitefilter: langs.map((l) => l + "wiki").join("|") }), ms);
    return d && d.entities || {};
  }

  async function wdSearch(f, query, lang, ms) {
    const d = await getJson(f, WD + qs({ action: "wbsearchentities", search: query, language: lang, uselang: lang, type: "item", limit: 3 }), ms);
    return (d && d.search || []).map((s) => s.id);
  }

  function label(ent, langs) {
    if (!ent || !ent.labels) return null;
    for (const l of langs) if (ent.labels[l]) return ent.labels[l].value;
    const any = Object.values(ent.labels)[0];
    return any ? any.value : null;
  }

  function pickClaims(claims, latest) {
    let cs = (claims || []).filter((c) => c.rank !== "deprecated" && c.mainsnak && c.mainsnak.snaktype === "value");
    if (!cs.length) return [];
    const preferred = cs.filter((c) => c.rank === "preferred");
    if (preferred.length) cs = preferred;
    const current = cs.filter((c) => !(c.qualifiers && c.qualifiers.P582)); // no end date = still true
    if (current.length) cs = current;
    if (latest) {
      const when = (c) => {
        const q = c.qualifiers && c.qualifiers.P585 && c.qualifiers.P585[0];
        return q && q.datavalue ? q.datavalue.value.time : "";
      };
      cs = cs.slice().sort((a, b) => (when(b) > when(a) ? 1 : -1)).slice(0, 1);
    }
    return cs.slice(0, 3);
  }

  function parseTime(v) {
    const m = /^([+-])(\d+)-(\d\d)-(\d\d)/.exec(v.time);
    if (!m) return null;
    return { year: (m[1] === "-" ? -1 : 1) * Number(m[2]), month: Number(m[3]), day: Number(m[4]), precision: v.precision };
  }

  function formatTime(t, lang) {
    const loc = lang === "id" ? "id-ID" : "en-GB";
    if (t.year < 1) return Math.abs(t.year) + (lang === "id" ? " SM" : " BC");
    if (t.precision >= 11 && t.month && t.day)
      return new Date(Date.UTC(t.year, t.month - 1, t.day)).toLocaleDateString(loc, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
    if (t.precision === 10 && t.month)
      return new Date(Date.UTC(t.year, t.month - 1, 1)).toLocaleDateString(loc, { month: "long", year: "numeric", timeZone: "UTC" });
    return String(t.year);
  }

  /** "ibukota kazakstan" -> {kind:"fact", answer:"Astana", ...} | null */
  async function wikidataAnswer(f, parsed, lang, order, ms, now) {
    const rel = parsed.rel, langs = order;
    // candidate entities: exact/redirect title, wikipedia search hits, wikidata label search
    const cands = [], pages = {};
    const add = (id) => { if (id && !cands.includes(id)) cands.push(id); };
    for (const l of order) {
      const exact = await wikiPage(f, l, parsed.subject, ms);
      if (exact && exact.qid && !exact.disambig) { add(exact.qid); pages[exact.qid] = pages[exact.qid] || exact; }
      const titles = await wikiTitles(f, l, parsed.subject, 3, ms);
      if (titles.length) {
        const d = await getJson(f, wikiApi(l) + qs({ action: "query", titles: titles.join("|"), prop: "pageprops", ppprop: "wikibase_item", redirects: 1 }), ms);
        const ps = d && d.query && d.query.pages ? Object.values(d.query.pages) : [];
        // keep search ranking order
        for (const t of titles) {
          const p = ps.find((x) => x.title === t) || ps.find((x) => x.title && x.title.toLowerCase() === t.toLowerCase());
          if (p && p.pageprops && p.pageprops.wikibase_item) add(p.pageprops.wikibase_item);
        }
      }
      if (cands.length >= 3) break;
    }
    for (const id of await wdSearch(f, parsed.subject, lang, ms)) add(id);
    if (!cands.length) return null;

    const ents = await wdEntities(f, cands.slice(0, 7), langs, ms);
    for (const qid of cands) {
      const ent = ents[qid];
      if (!ent || !ent.claims) continue;
      for (const prop of rel.props) {
        const claims = pickClaims(ent.claims[prop], rel.latest);
        if (!claims.length) continue;
        const vals = claims.map((c) => c.mainsnak.datavalue);
        // resolve item labels + unit labels in one go
        const need = [];
        for (const v of vals) {
          if (v.type === "wikibase-entityid") need.push(v.value.id);
          if (v.type === "quantity" && v.value.unit && v.value.unit !== "1") {
            const u = v.value.unit.split("/").pop();
            if (!UNITS[u]) need.push(u);
          }
        }
        const labels = need.length ? await wdEntities(f, need, langs, ms, "labels") : {};
        const out = [];
        for (const v of vals) {
          if (v.type === "wikibase-entityid") out.push(label(labels[v.value.id], langs) || v.value.id);
          else if (v.type === "time") {
            const t = parseTime(v.value);
            if (!t) continue;
            if (rel.age) {
              const death = pickClaims(ent.claims.P570)[0];
              const end = death ? parseTime(death.mainsnak.datavalue.value) : { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
              let age = end.year - t.year;
              if (end.month < t.month || (end.month === t.month && end.day < t.day)) age--;
              out.push(lang === "id" ? age + " tahun" + (death ? " (udah meninggal)" : "") : age + " years" + (death ? " (deceased)" : ""));
            } else out.push(formatTime(t, lang));
          } else if (v.type === "quantity") {
            const n = Number(v.value.amount);
            const u = v.value.unit && v.value.unit !== "1" ? v.value.unit.split("/").pop() : null;
            const unit = u ? (UNITS[u] || label(labels[u], langs) || "") : "";
            out.push(n.toLocaleString(lang === "id" ? "id-ID" : "en-US") + (unit ? " " + unit : ""));
          } else if (v.type === "string") out.push(v.value);
          else if (v.type === "monolingualtext") out.push(v.value.text);
        }
        if (!out.length) continue;
        const subjName = label(ent, langs) || parsed.subject;
        // a short summary of the subject for context
        let page = pages[qid] || null;
        if (!page) {
          for (const l of order) {
            const sl = ent.sitelinks && ent.sitelinks[l + "wiki"];
            if (sl) { page = await wikiPage(f, l, sl.title, ms); if (page) break; }
          }
        }
        return {
          kind: "fact",
          subject: subjName,
          relation: rel[lang] || rel.en,
          answer: out.join(", "),
          title: out.join(", "),
          extract: page ? page.extract : "",
          url: page ? page.url : "https://www.wikidata.org/wiki/" + qid,
          thumb: page ? page.thumb : null,
          lang: page ? page.lang : lang,
          source: "wikidata",
          qid,
        };
      }
    }
    return null;
  }

  /** main entry: question text -> answer object or null */
  async function answer(question, lang = "en", fetchImpl, opts = {}) {
    const f = fetchImpl || (typeof fetch !== "undefined" ? fetch.bind(root) : null);
    if (!f) return null;
    const ms = opts.timeoutMs || 8000;
    const now = opts.now || new Date();
    const parsed = typeof question === "string" ? parseQuestion(question) : question;
    const order = lang === "id" ? ["id", "en"] : ["en", "id"];
    const google = googleUrl(parsed.display);
    if (parsed.rel && parsed.subject) {
      const fact = await wikidataAnswer(f, parsed, lang, order, ms, now);
      if (fact) return Object.assign(fact, { google, query: parsed.display });
    }
    const q = parsed.subject || parsed.display;
    if (!q) return null;
    const page = await wikiFind(f, q, order, ms);
    if (!page) return null;
    return Object.assign(page, { kind: "summary", source: "wikipedia", google, query: parsed.display });
  }

  // kept for older callers
  async function wikiSearch(query, lang = "en", fetchImpl, timeoutMs = 8000) {
    return answer(query, lang, fetchImpl, { timeoutMs });
  }

  const api = { answer, wikiSearch, parseQuestion, googleUrl, trimExtract, RELATIONS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SearchLib = api;
})(typeof self !== "undefined" ? self : this);
