// node tests/sdk.js [baseUrl] -> uses the bundled sybau.js exactly like another app would
const { Sybau } = require("../sybau.js");
const base = process.argv[2] || "http://127.0.0.1:8765/";
(async () => {
  let threw = false, meant = false;
  try { new Sybau({ connectKey: "wrong-key" }); } catch (e) { threw = true; }
  console.log("wrong key rejected:", threw);
  const s = new Sybau({ connectKey: "sybau-ck-7f3a9c2e1b8d4f60a5e3", baseUrl: base, memory: false, search: false });
  await s.ready();
  for (const m of ["halo", "nama gw rafa", "lu bego", "gambar kucing", "draw a catt", "i definately agree", "connect key"]) {
    const r = await s.chat(m);
    console.log("> " + m + "\n  [" + r.intent + "] " + (r.full || "(image)") + (r.image ? (r.image.didYouMean.length ? "  [did you mean " + r.image.didYouMean.join(", ") + "?]" : "") + "\n" + r.image.text.replace(/\./g, " ") : ""));
    if (m === "draw a catt") meant = r.image && r.image.didYouMean.includes("cat");
  }
  await s.learnText("catatan.txt", "Sybau dibuat pakai Python dan numpy. Ibukota planet Zorg adalah Blorp. Kucing tetangga namanya Mochi.");
  const r = await s.chat("apa ibukota planet zorg?");
  console.log("> apa ibukota planet zorg?\n  [" + r.intent + "] " + r.full);
  const ok = !!threw && meant && r.intent === "kb_answer";
  console.log(ok ? "sdk ok" : "sdk FAILED");
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
