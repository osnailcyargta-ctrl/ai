// node tests/grammar.js -> checks the grammar roaster flags real mistakes and leaves normal chat alone
const fs = require("fs"), path = require("path");
const { Grammar } = require("../assets/js/grammar.js");
const g = new Grammar(JSON.parse(fs.readFileSync(path.join(__dirname, "../model/lexicon.json"), "utf8")));
const clean = [
  "halo bang apa kabar", "gw lagi di rumah nih", "lu tuh bego banget sumpah", "mending iphone atau samsung", "nama gw rafa",
  "roast me please", "what is a black hole", "i love minecraft so much", "my name is kevin", "wkwkwk anjir lucu bgt",
  "gw suka main mobile legends", "besok ujian matematika", "tolong cariin info tentang soekarno", "kamu ai beneran?",
  "you are so annoying bro", "i dont care tbh", "ngl ur kinda funny", "gw gabut parah sumpah", "dimakan kucing tetangga",
  "dia lagi di sekolah", "aku mau pergi ke mall", "she doesn't like me", "you're welcome", "i should have studied",
  "the weather is nice today", "gw udah makan tadi", "lu udah tidur belum", "kenapa lu jahat banget", "skibidi toilet ohio rizz",
  "aku sayang kamu", "yaudah gapapa", "bentar lagi gw berangkat", "gimana caranya biar pinter", "sybau ts pmo",
  "seriously who asked", "terima kasih banyak", "makasih ya bang", "my mom is so strict", "gw bokek parah tanggal tua",
];
const dirty = [
  ["gw lagi dirumah", "dirumah"], ["i definately agree", "definately"], ["your welcome", "your welcome"], ["silahkan aja", "silahkan"],
  ["dia di makan buaya", "di makan"], ["i should of known", "should of"], ["kemana aja lu", "kemana"], ["this is wierd", "wierd"],
  ["he dont care", "he dont"], ["better then you", "better then"], ["gw lagi praktek", "praktek"], ["i recieve it", "recieve"],
  ["tomorow i go", "tomorow"], ["i realy like it", "realy"], ["aku mau beljar", "beljar"], ["what is yuor name", "yuor"],
  ["i love minecrat", "minecrat"], ["gw sukaa bangeet", null], ["your so dumb", "your so"],
];
let fp = 0, miss = 0;
for (const s of clean) { const r = g.check(s, { lang: "id" }); if (r) { fp++; console.log("FALSE POSITIVE:", s, "->", r); } }
for (const [s, want] of dirty) {
  const r = g.check(s, { lang: "en" });
  const got = r ? r.wrong : null;
  if (got !== want) { miss++; console.log("MISS:", s, "want", want, "got", r); }
  else if (r) console.log("ok:", s, "->", r.right, `(${r.kind})`);
}
console.log(`false positives ${fp}/${clean.length}, misses ${miss}/${dirty.length}`);
process.exit(fp + miss ? 1 : 0);
