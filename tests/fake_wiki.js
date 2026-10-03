// A tiny fake of the Wikipedia + Wikidata APIs (same JSON shapes), so search can be tested offline.
const PAGES = {
  "Kazakhstan": { qid: "Q232", extract: "Kazakhstan adalah negara di Asia Tengah.", redirects: ["Kazakstan"] },
  "Astana": { qid: "Q1520", extract: "Astana adalah ibu kota Kazakhstan." },
  "Elon Musk": { qid: "Q317521", extract: "Elon Reeve Musk adalah pengusaha." },
  "Lubang hitam": { qid: "Q589", extract: "Lubang hitam adalah wilayah ruang-waktu dengan gravitasi sangat kuat." },
  "Amerika": { qid: "Q828", extract: "Amerika adalah benua.", },
  "Amerika Serikat": { qid: "Q30", extract: "Amerika Serikat adalah negara federal." },
  "Indonesia": { qid: "Q252", extract: "Indonesia adalah negara kepulauan." },
};
const ENTITIES = {
  Q232: { labels: { id: "Kazakhstan", en: "Kazakhstan" }, claims: { P36: [item("Q1520")], P38: [item("Q173117")] } },
  Q1520: { labels: { id: "Astana", en: "Astana" }, claims: {} },
  Q173117: { labels: { id: "Tenge Kazakhstan", en: "Kazakhstani tenge" }, claims: {} },
  Q317521: { labels: { id: "Elon Musk", en: "Elon Musk" }, claims: { P569: [time("+1971-06-28T00:00:00Z", 11)], P19: [item("Q3926")] } },
  Q3926: { labels: { id: "Pretoria", en: "Pretoria" }, claims: {} },
  Q589: { labels: { id: "lubang hitam" }, claims: {} },
  Q828: { labels: { id: "Amerika" }, claims: {} },
  Q30: { labels: { id: "Amerika Serikat" }, claims: { P35: [item("Q1", "normal", { P582: [{}] }), item("Q2", "preferred")], P36: [item("Q61")] } },
  Q1: { labels: { id: "Presiden Lama" } }, Q2: { labels: { id: "Presiden Sekarang" } }, Q61: { labels: { id: "Washington, D.C." } },
  Q252: { labels: { id: "Indonesia" }, claims: { P1082: [qty("+270000000", "2020"), qty("+281000000", "2024"), qty("+237000000", "2010")] } },
};
function item(id, rank = "normal", qualifiers) {
  return { rank, qualifiers, mainsnak: { snaktype: "value", datavalue: { type: "wikibase-entityid", value: { id } } } };
}
function time(t, precision) { return { rank: "normal", mainsnak: { snaktype: "value", datavalue: { type: "time", value: { time: t, precision } } } }; }
function qty(amount, year) {
  return { rank: "normal", qualifiers: { P585: [{ datavalue: { value: { time: "+" + year + "-01-01T00:00:00Z" } } }] },
    mainsnak: { snaktype: "value", datavalue: { type: "quantity", value: { amount, unit: "1" } } } };
}
function resolveTitle(t) {
  const lc = t.toLowerCase();
  for (const [title, p] of Object.entries(PAGES))
    if (title.toLowerCase() === lc || (p.redirects || []).some((r) => r.toLowerCase() === lc)) return title;
  return null;
}
function page(title) {
  const p = PAGES[title];
  return { title, extract: p.extract, fullurl: "https://id.wikipedia.org/wiki/" + title.replace(/ /g, "_"), pageprops: { wikibase_item: p.qid } };
}
const calls = [];
async function fakeFetch(url) {
  calls.push(url);
  const u = new URL(url), q = Object.fromEntries(u.searchParams);
  let body = {};
  if (u.hostname === "www.wikidata.org") {
    if (q.action === "wbsearchentities") {
      const t = resolveTitle(q.search);
      body = { search: t ? [{ id: PAGES[t].qid }] : [] };
    } else if (q.action === "wbgetentities") {
      body = { entities: Object.fromEntries(q.ids.split("|").map((id) => {
        const e = ENTITIES[id] || { labels: {}, claims: {} };
        const labels = Object.fromEntries(Object.entries(e.labels || {}).map(([l, v]) => [l, { language: l, value: v }]));
        return [id, { id, labels, claims: e.claims || {}, sitelinks: {} }];
      })) };
    }
  } else if (q.list === "search") {
    const words = q.srsearch.toLowerCase();
    const hits = Object.keys(PAGES).filter((t) => words.includes(t.toLowerCase()) || t.toLowerCase().includes(words) ||
      (PAGES[t].redirects || []).some((r) => r.toLowerCase() === words));
    body = { query: { search: hits.slice(0, Number(q.srlimit || 1)).map((title) => ({ title })), searchinfo: {} } };
  } else if (q.titles) {
    const pages = {};
    q.titles.split("|").forEach((t, i) => {
      const r = resolveTitle(t);
      pages[r ? i + 1 : -(i + 1)] = r ? page(r) : { title: t, missing: "" };
    });
    body = { query: { pages } };
  }
  return { ok: true, json: async () => body };
}
module.exports = { fakeFetch, calls };
