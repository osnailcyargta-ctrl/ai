// node tests/coder.js -> sybau code writes STS programs; every one must pass the REAL STS compiler and run
const fs = require("fs"), path = require("path");
global.BrainLib = require("../assets/js/brain.js");
const brainJson = JSON.parse(fs.readFileSync(path.join(__dirname, "../model/brain.json"), "utf8"));
BrainLib.setTextConfig(brainJson.text);
global.StsLib = require("../assets/js/stsvm.js");
const { StsCoder } = require("../assets/js/stscoder.js");
const requests = process.argv.length > 2 ? process.argv.slice(2) : [
  "bikinin game clicker", "game clicker pake toko upgrade, harga 15", "bikin game maze pake panah", "game kumpulin 8 koin kuning",
  "game hindarin meteor merah pake 3 nyawa", "dodge falling enemies with 5 lives and a score", "kuis matematika 5 soal", "quiz with 3 questions",
  "tanya nama terus sapa", "lempar dadu", "tebak angka 1 sampe 50", "counter tambah kurang", "kalkulator sederhana", "kotak ganti warna kalo diklik",
  "bola mantul", "bouncing ball with a blue background", "tombol popup \"halo dunia\"", "lampu lalu lintas", "password check, password nya rahasia",
  "game lompat pake spasi", "dino runner, lompatin rintangan", "pong", "gambar lingkaran merah dan kotak biru", "gambar rumah",
  "game kumpulin koin pake timer 20 detik", "clicker dengan stopwatch", "maze game with a 30 second countdown",
  "bikin game ngumpulin semangka hijau dan hindarin zombie", "hover effect", "asdfgh qwerty",
];
(async () => {
  const vm = await StsLib.StsVM.load(fs.readFileSync(path.join(__dirname, "../assets/sts/sts.wasm")));
  let seed = 5; const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const coder = new StsCoder({ coderModel: JSON.parse(fs.readFileSync(path.join(__dirname, "../model/coder.json"), "utf8")), vm, rand,
    docs: fs.readFileSync(path.join(__dirname, "../data/sts/docs.md"), "utf8") });
  let bad = 0;
  for (const r of requests) {
    coder.last = null;
    const res = await coder.handle(r);
    if (res.kind !== "code") { console.log("DOCS ", r, "->", res.head); continue; }
    const ok = res.compiled === true && res.fixes.length === 0;
    if (!ok) bad++;
    console.log((ok ? "ok   " : "FAIL ") + r.padEnd(58) + " [" + res.features.join(",") + "] " + res.program.roots.reduce((s, x) => s + x.code.split("\n").length, 0) + " lines" + (res.fixes.length ? " fixes: " + res.fixes.join(" | ") : "") + (res.compiled === "runtime" ? " RUNTIME" : ""));
    if (!ok || process.env.SHOW) console.log(res.steps.join("\n") + "\n" + res.sts);
  }
  // follow-up edits keep the program
  coder.last = null;
  await coder.handle("bikinin game clicker");
  const e = await coder.handle("tambahin toko upgrade sama timer 15 detik");
  const editOk = e.features.includes("shop") && e.features.includes("countdown") && e.features.includes("clicker") && e.compiled === true;
  console.log((editOk ? "ok   " : "FAIL ") + "edit: clicker -> +shop +countdown [" + e.features.join(",") + "]");
  const d = await coder.handle("gimana cara bikin collision di sts?");
  console.log((d.kind === "docs" ? "ok   " : "FAIL ") + "docs question -> " + (d.head || d.kind));
  if (!editOk || d.kind !== "docs") bad++;
  console.log(bad ? bad + " failed" : "all passed");
  process.exit(bad ? 1 : 0);
})();
