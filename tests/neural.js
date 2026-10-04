// node tests/neural.js ["request" ...] -> the code transformer writes STS programs by itself; how many compile and pass?
const fs = require("fs"), path = require("path");
global.BrainLib = require("../assets/js/brain.js");
BrainLib.setTextConfig(JSON.parse(fs.readFileSync(path.join(__dirname, "../model/brain.json"), "utf8")).text);
global.StsLib = require("../assets/js/stsvm.js");
global.StsGenLib = require("../assets/js/stsgen.js");
global.StsTokLib = require("../assets/js/ststok.js");
global.StsNeuralLib = require("../assets/js/stsneural.js");
const SearchLib = require("../assets/js/search.js");
const { fakeFetch } = require("./fake_wiki.js");
const { StsCoder } = require("../assets/js/stscoder.js");
const requests = process.argv.length > 2 ? process.argv.slice(2) : [
  "bikin game ninja lempar shuriken ke zombie", "game kucing makan ikan, hindarin anjing yang ngejar", "tangkap semangka yang jatuh pake 3 nyawa",
  "game hiu", "hindarin meteor merah", "tembak alien pake laser", "labirin kumpulin 3 bintang", "game lompat lompatin batu", "flappy bird", "pong",
  "bikinin game clicker", "kalkulator sederhana", "tebak angka 1 sampe 50", "tictactoe", "game snake", "suit lawan komputer", "lempar dadu", "lampu lalu lintas",
  "game glorbo", "bertahan 30 detik dari hantu",
];
(async () => {
  const vm = await StsLib.StsVM.load(fs.readFileSync(path.join(__dirname, "../assets/sts/sts.wasm")));
  let seed = 7; const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const coder = new StsCoder({ coderModel: JSON.parse(fs.readFileSync(path.join(__dirname, "../model/coder.json"), "utf8")), vm, rand,
    things: JSON.parse(fs.readFileSync(path.join(__dirname, "../data/sts/things.json"), "utf8")), search: SearchLib, fetch: fakeFetch,
    neuralModels: process.env.CODEMODEL ? [JSON.parse(fs.readFileSync(process.env.CODEMODEL, "utf8"))]
      : ["../model/stscode.json", "../model/stscode_big.json"].filter((f) => fs.existsSync(path.join(__dirname, f))).map((f) => JSON.parse(fs.readFileSync(path.join(__dirname, f), "utf8"))) });
  let compiled = 0, clean = 0, allPass = 0;
  const t0 = Date.now();
  for (const r of requests) {
    coder.last = null;
    const res = await coder.handle(r, { neural: true });
    if (res.kind !== "code") { console.log("--   " + r + " -> " + res.kind); continue; }
    const ok = res.compiled === true;
    if (res.compiled) compiled++;
    if (res.compiled && !res.fixes.length) clean++;
    if (ok) allPass++;
    console.log((ok ? "ok   " : res.compiled ? "part " : "FAIL ") + r.padEnd(50) + ` ${res.program.roots[0].code.split("\n").length} lines, fixes ${res.fixes.length}, tests ${res.tests.filter((x) => x.ok).length}/${res.tests.length}`);
    if (process.env.SHOW) console.log(res.steps.join("\n") + "\n" + res.sts);
  }
  console.log(`compiled ${compiled}/${requests.length}, without fixes ${clean}, all tests ${allPass}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
})();
