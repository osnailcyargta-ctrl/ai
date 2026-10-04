// node tools/make_sts_corpus.js [n] -> data/sts/corpus.jsonl
// Training data for the code transformer: lots of different requests (Indonesian + English,
// random things, numbers, colours, mechanics) and a working STS program for each one.
// Every program is checked with the real STS compiler before it goes in.
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
global.BrainLib = require(ROOT + "/assets/js/brain.js");
BrainLib.setTextConfig(JSON.parse(fs.readFileSync(ROOT + "/model/brain.json", "utf8")).text);
global.StsLib = require(ROOT + "/assets/js/stsvm.js");
global.StsGenLib = require(ROOT + "/assets/js/stsgen.js");
const Coder = require(ROOT + "/assets/js/stscoder.js");
const Tok = require(ROOT + "/assets/js/ststok.js");

const N = +(process.argv[2] || 6000);
let seed = 12345;
const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const pick = (a) => a[Math.floor(rand() * a.length)];
const kbJson = JSON.parse(fs.readFileSync(ROOT + "/data/sts/things.json", "utf8"));
const kb = new Coder.Knowledge(kbJson);
const byCat = {};
for (const t of kbJson.things) (byCat[t.cat] = byCat[t.cat] || []).push(t.names[0]);
const from = (...cats) => pick(cats.flatMap((c) => byCat[c] || []));
const P = () => from("person", "animal", "vehicle");
const E = () => from("monster", "predator", "hazard", "insect");
const I = () => from("fruit", "food", "treasure", "fish");
const Wp = () => from("weapon");
const COL = ["merah", "biru", "hijau", "kuning", "ungu", "putih", "oranye", "pink", "hitam", "emas"];
const COL_EN = ["red", "blue", "green", "yellow", "purple", "white", "orange", "pink", "gold"];
const n = (a, b) => a + Math.floor(rand() * (b - a + 1));

const ID = [
  () => `bikin game ${P()} ngumpulin ${n(2, 10)} ${I()}`, () => `game ${P()} hindarin ${E()}`, () => `game ${P()} lempar ${Wp()} ke ${E()}`,
  () => `tembak ${E()} pake ${Wp()}`, () => `game ${P()} dikejar ${E()}`, () => `tangkap ${I()} yang jatuh`, () => `game lompat lompatin ${E()}`,
  () => `labirin kumpulin ${n(2, 6)} ${I()}`, () => `bikin game maze pake panah`, () => `flappy ${from("bird", "vehicle")}`, () => "pong", () => `game ${pick([P(), E(), I()])}`,
  () => `bertahan ${n(10, 60)} detik dari ${E()}`, () => `pukul ${from("animal", "insect")} yang muncul`, () => `game ${P()} makan ${I()}, hindarin ${E()} yang ngejar`,
  () => `game ${P()} ngumpulin ${I()} sambil kabur dari ${E()}`, () => `bikin game ${E()} jatuh dari langit`, () => `kumpulin ${I()} ${pick(COL)}`,
  () => `game ${P()} ${pick(COL)} vs ${E()}`, () => `game ${P()} sampe ke bendera`, () => "bikinin game clicker", () => `game clicker pake toko upgrade, harga ${n(5, 50)}`,
  () => "counter tambah kurang", () => `lempar dadu ${pick([6, 6, 12, 20])} sisi`, () => "kalkulator sederhana", () => `tebak angka 1 sampe ${pick([10, 50, 100])}`,
  () => `password check, password nya ${pick(["rahasia", "sybau", "1234", "admin"])}`, () => "tanya nama terus sapa", () => "lampu lalu lintas", () => `tombol popup "${pick(["halo dunia", "jangan diklik", "sybau"])}"`,
  () => "hover effect", () => `bola mantul`, () => `kotak ganti warna kalo diklik`, () => "clicker dengan stopwatch", () => "tictactoe", () => "bikin tictactoe", () => "tic tac toe lawan komputer", () => "tic tac toe 2 pemain", () => "game snake", () => "bikin snake", () => "game ular",
  () => `game ular makan ${I()}`, () => "suit lawan komputer", () => `kuis matematika ${n(3, 8)} soal ${pick(["perkalian", "penjumlahan", "pengurangan", ""])}`,
];
const EN = [
  () => `make a game where a ${P()} collects ${n(2, 10)} ${I()}`, () => `dodge falling ${E()}`, () => `a ${P()} shooting ${E()} with a ${Wp()}`, () => `${P()} chased by ${E()}`,
  () => `catch falling ${I()}`, () => `jump over ${E()}`, () => "maze game with arrow keys", () => "flappy bird", () => `survive ${n(10, 60)} seconds from ${E()}`,
  () => `whack the ${from("animal", "insect")} that pop up`, () => "cookie clicker", () => "dice roller", () => "simple calculator", () => `guess the number from 1 to ${pick([10, 50, 100])}`,
  () => "tic tac toe", () => "snake game", () => "rock paper scissors", () => `maths quiz with ${n(3, 8)} questions`, () => `bouncing ball with a ${pick(COL_EN)} background`,
];
const EXTRA_ID = [() => ` pake ${n(1, 5)} nyawa`, () => ` dalam ${n(10, 60)} detik`, () => ` menang kalo skor ${n(5, 40)}`, () => " susah", () => " gampang", () => ` background ${pick(COL)}`, () => ` ${n(2, 8)} musuh`, () => " yang cepet"];
const EXTRA_EN = [() => ` with ${n(1, 5)} lives`, () => ` in ${n(10, 60)} seconds`, () => ` win at score ${n(5, 40)}`, () => " hard", () => " easy", () => ` with a ${pick(COL_EN)} background`];

const prefixOf = (A, know) => Coder.buildPrefix(A, know);

(async () => {
  const vm = await StsLib.StsVM.load(fs.readFileSync(ROOT + "/assets/sts/sts.wasm"));
  const reader = new Coder.RequestReader(JSON.parse(fs.readFileSync(ROOT + "/model/coder.json", "utf8")));
  const out = [];
  let tries = 0, failed = 0;
  while (out.length < N && tries < N * 3) {
    tries++;
    const en = rand() < 0.3;
    let req = pick(en ? EN : ID)();
    const k = rand() < 0.55 ? n(1, 2) : 0;
    for (let i = 0; i < k; i++) req += pick(en ? EXTRA_EN : EXTRA_ID)();
    const A = Coder.analyze(req, reader, kb, {});
    if (!A.mech.size && !A.things.length) continue;
    const know = {};
    for (const th of A.things) { const f = kb.find(th.word); if (f) know[th.word] = { cat: f.entry.cat, color: f.entry.color, shape: f.entry.shape, size: f.entry.size, kbName: f.name }; }
    for (const w of ["koin", "coin", "apel", "apple", "meteor", "alien", "zombie", "tikus", "mouse", "finish", "pipa", "pipe", "batu", "rock", "peluru", "bullet", "raket", "ikan", "udang", "cacing", "bunga", "anjing", "kucing"]) if (!know[w]) { const f = kb.find(w); if (f) know[w] = { cat: f.entry.cat, color: f.entry.color, shape: f.entry.shape, size: f.entry.size }; }
    if (A.mech.has("quiz")) know.__quiz = { questions: Coder.mathQuiz(A, Math.min(10, A.questions || 5), rand), source: null };
    if (!A.mech.size && A.things.length) A.things[0].topic = true;
    let d;
    try { d = Coder.design(A, know, rand); } catch (e) { failed++; continue; }
    const prog = StsGenLib.write(d, { rand });
    const code = prog.roots[0].code;
    if (!vm.compile(prog.roots).ok) { failed++; continue; }
    const { slots, prefix } = prefixOf(A, know);
    const toks = Tok.tokenize(code, slots);
    if (toks.length > 6500) continue;
    out.push({ request: req, slots, prefix, code, n: toks.length, stage: prog.stage });
    if (out.length % 500 === 0) console.log(out.length, "programs");
  }
  // hand-written programs (data/sts/handmade): the most valuable data, many variations each
  const HAND = path.join(ROOT, "data/sts/handmade");
  const PALETTE = ["#e63946", "#2a9d8f", "#457b9d", "#f4a261", "#ffd166", "#06d6a0", "#ef476f", "#118ab2", "#8338ec", "#ff006e", "#3a86ff", "#fb5607", "#ffbe0b", "#8ac926"];
  const OPEN_ID = ["", "bikin ", "bikinin ", "tolong bikin ", "buat ", "gw mau ", "pls bikinin "], OPEN_EN = ["", "make ", "build ", "please make ", "i want ", "create "];
  let hand = 0;
  if (fs.existsSync(HAND)) for (const f of fs.readdirSync(HAND).filter((x) => x.endsWith(".sts")).sort()) {
    const code0 = fs.readFileSync(path.join(HAND, f), "utf8");
    const m = code0.match(/^\/\/ request: (.+?) \|\| (.+)$/m);
    if (!m) continue;
    for (let v = 0; v < +(process.env.HAND_VARIANTS || 30); v++) {
      const en = v % 3 === 2;
      let req = (en ? pick(OPEN_EN) : pick(OPEN_ID)) + (en ? m[2] : m[1]);
      // recolour some of the colours so it learns colours are free, not part of the program
      let code = code0;
      if (v) code = code.replace(/"#[0-9a-fA-F]{6}"/g, (c) => (rand() < 0.35 ? '"' + pick(PALETTE) + '"' : c));
      const A = Coder.analyze(req, reader, kb, {});
      const know = {};
      for (const th of A.things) { const k = kb.find(th.word); if (k) know[th.word] = { cat: k.entry.cat, color: k.entry.color }; }
      if (!vm.compile([{ index: 0, code }]).ok) continue;
      const { slots, prefix } = prefixOf(A, know);
      const toks = Tok.tokenize(code, slots);
      out.push({ request: req, slots, prefix, code, n: toks.length, stage: { w: 520, h: 360 }, hand: f });
      hand++;
    }
  }
  console.log("hand-written variations:", hand);
  fs.writeFileSync(ROOT + "/data/sts/corpus.jsonl", out.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const avg = out.reduce((s, r) => s + r.n, 0) / out.length;
  console.log(`wrote ${out.length} programs (avg ${Math.round(avg)} tokens, max ${Math.max(...out.map((r) => r.n))}), ${failed} designs failed to compile and were dropped`);
})();
