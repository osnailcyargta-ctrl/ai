// node tests/search.js -> question answering against the fake Wikipedia/Wikidata
const S = require("../assets/js/search.js");
const { fakeFetch } = require("./fake_wiki.js");
const cases = [
  ["ibukota kazakstan", "id", "Astana"],
  ["what is the capital of kazakhstan?", "en", "Astana"],
  ["mata uang kazakhstan apa", "id", "Tenge Kazakhstan"],
  ["kapan elon musk lahir", "id", "28 Juni 1971"],
  ["elon musk lahir dimana", "id", "Pretoria"],
  ["berapa umur elon musk", "id", "55 tahun"],
  ["siapa presiden amerika serikat", "id", "Presiden Sekarang"],
  ["jumlah penduduk indonesia", "id", "281.000.000"],
  ["apa itu lubang hitam", "id", "Lubang hitam"],
  ["cari elon musk", "id", "Elon Musk"],
];
(async () => {
  let bad = 0;
  for (const [q, lang, want] of cases) {
    const r = await S.answer(q, lang, fakeFetch, { now: new Date("2026-10-03T00:00:00Z") });
    const got = r ? (r.kind === "fact" ? r.answer : r.title) : null;
    const ok = got && got.includes(want);
    if (!ok) bad++;
    console.log((ok ? "ok  " : "FAIL") + " " + q.padEnd(36) + " -> " + (r ? r.kind + ": " + got : "null"));
  }
  console.log(bad ? bad + " failed" : "all passed");
  process.exit(bad ? 1 : 0);
})();
