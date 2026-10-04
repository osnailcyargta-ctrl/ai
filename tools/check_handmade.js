// node tools/check_handmade.js -> every hand-written program in data/sts/handmade must compile and run 6s without errors
const fs = require("fs"), path = require("path");
const S = require("../assets/js/stsvm.js");
const dir = path.join(__dirname, "../data/sts/handmade");
(async () => {
  const vm = await S.StsVM.load(fs.readFileSync(path.join(__dirname, "../assets/sts/sts.wasm")));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sts")).sort();
  let bad = 0;
  for (const f of files) {
    const code = fs.readFileSync(path.join(dir, f), "utf8");
    if (!/^\/\/ request: .+\|\|.+/m.test(code)) { console.log("NOREQ", f); bad++; continue; }
    const c = vm.compile([{ index: 0, code }]);
    if (!c.ok) { console.log("COMPILE", f, "line", c.line, c.error); bad++; continue; }
    vm.start(3);
    let err = null, objs = 0;
    for (let i = 0; i < 360 && !err; i++) {
      if (i % 11 === 0) vm.key(["left", "right", "up", "down", "space", "w", "s", "a", "d"][i % 9], (i / 11) % 2 === 0);
      if (i % 23 === 0) { vm.mouseMove(40 + (i * 7) % 440, 60 + (i * 13) % 280); vm.click(40 + (i * 7) % 440, 60 + (i * 13) % 280); }
      const st = vm.tick(16);
      if (st === S.STATE.ERROR) err = vm.runtimeError() || "runtime error";
      if (st === S.STATE.POPUP) vm.ackPopup();
      if (st === S.STATE.ASK) vm.answer(String(1 + (i % 5)));
      if (st === S.STATE.DONE) break;
    }
    objs = vm.objects().length;
    vm.stop();
    if (err) { console.log("RUNTIME", f, err); bad++; continue; }
    if (!objs) { console.log("EMPTY", f); bad++; continue; }
  }
  console.log(files.length + " programs, " + (bad ? bad + " broken" : "all compile and run"));
  process.exit(bad ? 1 : 0);
})();
