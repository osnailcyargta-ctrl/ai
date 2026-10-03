// node tests/chat.js  -> plays a scripted conversation against the real model
const fs = require("fs"), path = require("path");
const { Brain } = require("../assets/js/brain.js");
const { RoastBot } = require("../assets/js/bot.js");
const brain = new Brain(JSON.parse(fs.readFileSync(path.join(__dirname, "../model/brain.json"), "utf8")));
const store = {}; const storage = { getItem: (k) => store[k] || null, setItem: (k, v) => (store[k] = v) };
const bot = new RoastBot(brain, { storage });
const script = process.argv.length > 2 ? process.argv.slice(2) : [
  "halo", "nama gw rafa", "umur gw 17", "gw suka anime", "i hate math", "mending iphone atau samsung?",
  "berapa 12*(3+4)", "siapa nama gw", "lu inget apa tentang gw", "lu bego", 
  "lu tuh ai paling goblok sedunia sumpah gak guna banget mending lu uninstall diri lu sendiri aja dasar clanker",
  "roast me", "kamu ai beneran?", "jam berapa", "wkwkwk", "skibidi", "asdkjh qwe zxc", "gw lagi sedih", "gw pengen mati", "bye"];
let t0 = Date.now();
for (const msg of script) {
  const r = bot.reply(msg);
  const m = r.meta;
  console.log(`> ${msg}\n  ${r.text}\n    [${m.intent} ${(m.confidence * 100).toFixed(0)}% ${m.source}${m.novel ? " NOVEL" : ""}]`);
}
console.log(`avg ${((Date.now() - t0) / script.length).toFixed(0)} ms/reply, params ${brain.paramCount}`);
