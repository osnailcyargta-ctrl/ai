// node tests/coder.js -> sybau code designs and writes STS programs from scratch.
// Every program must pass the REAL STS compiler with no fixes AND pass its own behaviour tests.
// Research uses a fake Wikipedia (tests/fake_wiki.js) so this runs offline.
const fs = require("fs"), path = require("path");
global.BrainLib = require("../assets/js/brain.js");
const brainJson = JSON.parse(fs.readFileSync(path.join(__dirname, "../model/brain.json"), "utf8"));
BrainLib.setTextConfig(brainJson.text);
global.StsLib = require("../assets/js/stsvm.js");
global.StsGenLib = require("../assets/js/stsgen.js");
const SearchLib = require("../assets/js/search.js");
const { fakeFetch } = require("./fake_wiki.js");
const { StsCoder } = require("../assets/js/stscoder.js");
const requests = process.argv.length > 2 ? process.argv.slice(2) : [
  "bikin game ninja lempar shuriken ke zombie", "game kucing makan ikan, hindarin anjing yang ngejar", "game tangkap semangka yang jatuh pake 3 nyawa",
  "game hiu", "bikin game hindarin meteor merah pake 3 nyawa", "dodge falling enemies with 5 lives", "game kumpulin 8 koin kuning dalam 20 detik",
  "bikin game maze pake panah", "labirin kumpulin 3 bintang terus sampe ke bendera", "game lompat lompatin batu", "flappy bird", "pong",
  "tembak alien pake laser, menang kalo skor 20", "bertahan 30 detik dari zombie", "game pukul tikus yang muncul", "game mobil hindarin truk",
  "kuis tentang majapahit 4 soal", "kuis matematika 5 soal perkalian", "quiz with 3 questions",
  "bikinin game clicker", "game clicker pake toko upgrade, harga 15", "tanya nama terus sapa", "lempar dadu", "tebak angka 1 sampe 50", "counter tambah kurang",
  "kalkulator sederhana", "kotak ganti warna kalo diklik", "bola mantul", "tombol popup \"halo dunia\"", "lampu lalu lintas", "password check, password nya rahasia",
  "gambar lingkaran merah dan kotak biru", "bikin rictactoe", "tic tac toe 2 pemain", "game snake", "game ular makan apel", "suit lawan komputer", "bikin game pacman", "clicker dengan stopwatch", "hover effect", "game glorbo",
];
(async () => {
  const vm = await StsLib.StsVM.load(fs.readFileSync(path.join(__dirname, "../assets/sts/sts.wasm")));
  let seed = 5; const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const coder = new StsCoder({ coderModel: JSON.parse(fs.readFileSync(path.join(__dirname, "../model/coder.json"), "utf8")), vm, rand,
    things: JSON.parse(fs.readFileSync(path.join(__dirname, "../data/sts/things.json"), "utf8")),
    docs: fs.readFileSync(path.join(__dirname, "../data/sts/docs.md"), "utf8"), search: SearchLib, fetch: fakeFetch });
  let bad = 0;
  const check = (ok, label) => { if (!ok) bad++; console.log((ok ? "ok   " : "FAIL ") + label); return ok; };
  for (const r of requests) {
    coder.last = null;
    const res = await coder.handle(r);
    if (res.kind === "cant") { console.log("CANT ", r, "->", res.text.slice(0, 120)); continue; }
    if (res.kind !== "code") { console.log("DOCS ", r, "->", res.head); continue; }
    const failed = res.tests.filter((t) => !t.ok);
    const ok = res.compiled === true && res.fixes.length === 0 && !failed.length;
    check(ok, r.padEnd(52) + " " + res.program.roots[0].code.split("\n").length + " lines, " + res.tests.length + " tests" +
      (res.fixes.length ? " fixes: " + res.fixes.join(" | ") : "") + (failed.length ? " failed: " + failed.map((t) => t.msg).join(" | ") : ""));
    if (!ok || process.env.SHOW) console.log(res.steps.join("\n") + "\n" + res.sts);
  }
  // research really drives the design
  coder.last = null; coder.cache.clear();
  let res = await coder.handle("bikin game ninja lempar shuriken ke zombie");
  const z = res.design.entities.find((e) => e.key === "zombie");
  check(res.design.player && res.design.player.label === "ninja" && z && z.motion === "chase" && res.design.shooter && res.design.shooter.proj.label === "shuriken",
    "ninja = player, zombie chases (from 'mayat hidup'), shuriken = projectile");
  check(/Zombi adalah mayat hidup/.test(res.steps.join("\n")), "zombie was looked up on wikipedia");
  coder.last = null;
  res = await coder.handle("game glorbo");
  check(res.design.entities.some((e) => e.key === "glorbo" && e.role === "enemy" && e.color === "#b55088"), "unknown 'glorbo' -> researched: purple dangerous monster -> enemy");
  coder.last = null;
  res = await coder.handle("kuis tentang majapahit 4 soal");
  check(/1293|Hayam Wuruk|Gajah Mada|Trowulan|1527|1350/.test(res.sts) && res.design.sequence.filter((s) => s.kind === "question").length === 4, "majapahit quiz questions come from the article");
  // two runs of the maze are different mazes
  coder.last = null; const m1 = (await coder.handle("bikin game maze")).sts; coder.last = null; const m2 = (await coder.handle("bikin game maze")).sts;
  check(m1 !== m2, "every maze is carved fresh");
  // follow-up edits keep the program
  coder.last = null;
  await coder.handle("game kucing makan ikan, hindarin anjing yang ngejar");
  const e = await coder.handle("tambahin timer 20 detik terus ganti warna kucing jadi merah");
  check(e.design.timers.some((t) => t.sec === 20) && e.design.player.color === "#e43b44" && e.design.entities.some((x) => x.key === "anjing") && e.compiled === true, "edit: +timer, recolour the cat, keeps the dog");
  const d = await coder.handle("gimana cara bikin collision di sts?");
  check(d.kind === "docs", "docs question -> " + (d.head || d.kind));
  coder.last = null;
  const off = await coder.handle("bikin game ninja lawan zombie", { search: false });
  check(off.compiled === true && /database offline/.test(off.steps.join("\n")), "works with search off (offline knowledge)");
  coder.last = null;
  res = await coder.handle("bikin tictactoe");
  check(res.design.special === "tictactoe" && !res.design.entities.length && !/ngumpulin|barang:/.test(res.steps.join(" ")), "tictactoe is tic-tac-toe, not collecting Tic Tacs");
  coder.last = null;
  res = await coder.handle("bikin game catur");
  check(res.kind === "cant" && /catur/i.test(res.text), "chess (read on wikipedia, not buildable yet) -> says so honestly");
  coder.last = null;
  res = await coder.handle("bikin game pacman");
  check(res.design.maze && res.design.entities.some((e) => e.key === "hantu" && e.count === 4) && res.design.entities.some((e) => e.role === "item"), "pacman from its article: maze + 4 ghosts chasing + dots to eat");
  coder.last = null;
  res = await coder.handle("asdfgh qwerty");
  check(res.kind === "cant" || (res.kind === "ask" && res.options.length >= 2 && res.options.length <= 4), "gibberish -> asks what to build (2-4 choices) instead of drawing random shapes");
  // reading the intent: new vs edit vs question
  coder.last = null;
  await coder.handle("game kucing makan ikan, hindarin anjing yang ngejar");
  res = await coder.handle("hapus dan bikin game baru: tangkap apel yang jatuh");
  check(res.kind === "code" && !res.design.entities.some((e) => e.key === "anjing") && res.design.entities.some((e) => e.key === "apel"), "'hapus dan bikin game baru' starts over (no dog left)");
  res = await coder.handle("gimana cara mainnya?");
  check(res.kind === "memory" && /kontrol|controls/.test(res.text), "'gimana cara mainnya?' explains the current game");
  res = await coder.handle("tambahin 2 meteor");
  check(res.kind === "code" && res.design.entities.some((e) => e.key === "apel") && res.design.entities.some((e) => e.key === "meteor"), "'tambahin 2 meteor' edits the apple game");
  coder.last = null;
  res = await coder.handle("bikin tictactoe", { deepthink: true });
  check(res.kind === "ask" && res.options.length === 2, "deepthink asks 'tic tac toe vs who?' with 2 choices");
  console.log(bad ? bad + " failed" : "all passed");
  process.exit(bad ? 1 : 0);
})();
