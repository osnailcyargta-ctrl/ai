// node tests/chat.js ["pesan 1" "pesan 2" ...]  -> plays a conversation against the real model
// search is answered by a fake Wikipedia (the test box has no internet)
const fs = require("fs"), path = require("path");
global.BrainLib = require("../assets/js/brain.js");
const { RoastBot } = require("../assets/js/bot.js");
const { Grammar } = require("../assets/js/grammar.js");
const { wikiSearch } = require("../assets/js/search.js");
const load = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", f), "utf8"));
const brain = new BrainLib.Brain(load("model/brain.json"));
const grammar = new Grammar(load("model/lexicon.json"));
const store = {}; const storage = { getItem: (k) => store[k] || null, setItem: (k, v) => (store[k] = v) };
const bot = new RoastBot(brain, { storage, grammar });
const fakeFetch = async (url) => ({ ok: true, json: async () => {
  const q = decodeURIComponent(url.match(/gsrsearch=([^&]+)/)[1]);
  if (q.includes("zzz")) return {};
  return { query: { pages: { 1: { title: q.replace(/\b\w/g, (c) => c.toUpperCase()), extract: "Ini ringkasan palsu buat tes soal " + q + ".", fullurl: "https://id.wikipedia.org/wiki/x" } } } };
} });
const script = process.argv.length > 2 ? process.argv.slice(2) : [
  "halo", "nama gw rafa", "umur gw 17", "gw suka anime bgt", "i hate math", "mending iphone ato samsung?",
  "berapa 12*(3+4)", "siapa nama gw", "lu inget apa tentang gw", "lu bego", "you are so dumb",
  "lu tuh ai paling goblok sedunia sumpah gak guna banget mending lu uninstall diri lu sendiri aja dasar clanker",
  "roast gw", "roast me", "kamu ai beneran?", "cari elon musk", "what is a black hole", "apa itu zzzqqq",
  "gw lagi dirumah nih", "i definately need help", "your welcome bro", "silahkan aja", "gw ngak tau",
  "wkwkwk", "skibidi", "asdkjh qwe zxc", "gw bokek parah", "1v1 gw", "gw lagi sedih", "gw pengen mati", "bye"];
(async () => {
  let t0 = Date.now(), n = 0;
  for (const msg of script) {
    const r = bot.reply(msg); n++;
    const m = r.meta;
    console.log(`> ${msg}\n  ${r.text || "(no main reply)"}\n    [${m.intent} ${(m.confidence * 100).toFixed(0)}% ${m.lang} ${m.source}${m.novel ? " NOVEL" : ""}]`);
    if (r.search) {
      const res = await wikiSearch(r.search.query, r.search.lang, fakeFetch);
      console.log(`  [wiki: ${res ? res.title : "nothing"}] ${bot.searchFollowup(res, r.search.query, r.search.lang)}`);
    }
    if (r.grammar) console.log(`  📝 ${r.grammar.wrong} -> ${r.grammar.right} (${r.grammar.kind}): ${r.grammar.text}`);
  }
  console.log(`avg ${((Date.now() - t0) / n).toFixed(0)} ms/reply, params ${brain.paramCount}`);
})();
