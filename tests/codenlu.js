// node tests/codenlu.js — the code NLU on hand-written sentences that are NOT from its templates
const fs = require("fs"), path = require("path");
const { CodeNLU } = require("../assets/js/codenlu.js");
const nlu = new CodeNLU(JSON.parse(fs.readFileSync(path.join(__dirname, "../model/codenlu.json"), "utf8")));
const CASES = [
  ["bikin game ninja vs zombie", "new"], ["gw pengen game balapan mobil", "new"], ["hapus dan bikin game baru", "new"], ["hapus dan bikin game baru ular", "new"],
  ["bikinin kalkulator dong", "new"], ["game snake", "new"], ["make a space shooter", "new"], ["sekarang bikin game tebak angka", "new"],
  ["oke ganti game aja, bikin flappy bird", "new"], ["bikin game kucing makan ikan hindarin anjing", "new"], ["tictactoe", "new"],
  ["tambahin musuh", "add"], ["kasih power up dong", "add"], ["tambahin bos naga", "add"], ["add a timer", "add"], ["tambahin suara pas nembak", "add"],
  ["ubah speed jadi 10", "setvar"], ["ubah variable speed jadi 10", "setvar"], ["nyawanya 5 aja", "setvar"], ["gravitasinya jadi 0.2", "setvar"],
  ["bikin lebih cepet", "setvar"], ["background merah", "setvar"], ["ganti warna latar jadi biru", "setvar"], ["set lives to 9", "setvar"], ["kecepatan musuh 3", "setvar"],
  ["ganti zombie jadi alien", "replace"], ["zombienya ganti hantu", "replace"], ["replace the cat with a dog", "replace"], ["musuhnya jadi naga", "replace"],
  ["hapus zombienya", "remove"], ["ilangin meteornya", "remove"], ["delete su", "remove"], ["remove the bombs", "remove"], ["gak usah ada musuh", "remove"],
  ["hapus semua", "reset"], ["hapus semuanya", "reset"], ["mulai dari awal", "reset"], ["clear", "reset"], ["delete everything", "reset"],
  ["balikin", "undo"], ["balikin yang tadi", "undo"], ["undo", "undo"], ["yang tadi lebih bagus", "undo"],
  ["variabelnya apa aja", "ask"], ["ini variabelnya apa aja?", "ask"], ["cara mainnya gimana", "ask"], ["kok musuhnya diem", "ask"], ["kenapa error", "ask"], ["what are the controls", "ask"], ["ini game apa", "ask"],
  ["lu goblok", "chat"], ["makasih bro", "chat"], ["keren anjir", "chat"], ["halo", "chat"], ["ai lu cacat", "chat"], ["thanks", "chat"],
];
let ok = 0;
for (const [s, want] of CASES) {
  const r = nlu.read(s);
  const good = r.intent === want;
  if (good) ok++;
  console.log((good ? "✓" : "✗"), s.padEnd(44), r.intent.padEnd(8), (r.confidence * 100).toFixed(0) + "%", good ? "" : "(want " + want + ")",
    r.things.length ? "T:" + r.things.join(",") : "", r.newThings.length ? "T2:" + r.newThings.join(",") : "", r.vars.length ? "V:" + r.vars.join(",") : "", r.values.length ? "N:" + r.values.join(",") : "");
}
console.log(`${ok}/${CASES.length} intents right`);
process.exit(ok >= CASES.length * 0.9 ? 0 : 1);
