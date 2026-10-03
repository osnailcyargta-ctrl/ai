// node tests/codetok.js -> every program sybau code can write survives tokenize -> detokenize and still compiles the same
const fs = require("fs"), path = require("path");
const Tok = require("../assets/js/ststok.js");
global.StsLib = require("../assets/js/stsvm.js");
(async () => {
  const vm = await StsLib.StsVM.load(fs.readFileSync(path.join(__dirname, "../assets/sts/sts.wasm")));
  const file = process.argv[2] || path.join(__dirname, "../data/sts/corpus.jsonl");
  const rows = fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  let bad = 0, toks = 0;
  for (const r of rows) {
    const t = Tok.tokenize(r.code, r.slots);
    toks += t.length;
    const back = Tok.detokenize(t, r.slots);
    const a = vm.compile([{ index: 0, code: r.code }]), b = vm.compile([{ index: 0, code: back }]);
    if (!a.ok || !b.ok || JSON.stringify(Tok.tokenize(back, r.slots)) !== JSON.stringify(t)) { bad++; if (bad < 4) console.log("FAIL", r.request, b.error, "line", b.line, "\n" + back.split("\n").slice(Math.max(0, (b.line || 1) - 3), (b.line || 1) + 1).join("\n")); }
  }
  console.log(rows.length + " programs, avg " + Math.round(toks / rows.length) + " tokens, " + (bad ? bad + " failed" : "all round-trip and compile"));
  process.exit(bad ? 1 : 0);
})();
