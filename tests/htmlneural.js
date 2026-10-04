// node tests/htmlneural.js — the real code transformer writes pages for requests it never saw
// verbatim, every page is run in a real browser (keys + clicks), JS errors / blank pages fail.
// HTMLMODEL=path/to/model.json to test a checkpoint.
const fs = require("fs"), path = require("path");
global.HtmlTokLib = require("../assets/js/htmltok.js");
global.HtmlReqLib = require("../assets/js/htmlreq.js");
const { HtmlWriter } = require("../assets/js/htmlneural.js");
const { CodeNLU } = require("../assets/js/codenlu.js");
const { HtmlCoder } = require("../assets/js/htmlcoder.js");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node-tools/node_modules/playwright"); }
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const MODEL = process.env.HTMLMODEL || path.join(__dirname, "../model/htmlcode.json");
const REQUESTS = process.argv.length > 2 ? process.argv.slice(2) : [
  "bikin game ninja lempar shuriken ke zombie", "game kucing dikejar anjing sambil ngumpulin ikan", "tangkap pisang yang jatuh", "game ular", "kalkulator",
  "pong lawan komputer", "flappy pinguin", "game skibidi vs toilet", "tebak angka 1 sampai 50", "todo list", "game astronot hindarin meteor pake 5 nyawa",
  "make a space shooter with aliens", "breakout background ungu", "ikan kabur dari hiu", "game memori", "stopwatch",
];
(async () => {
  const browser = await pw.chromium.launch({ executablePath: fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined });
  const check = async (html) => {
    const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
    const errs = [];
    let line = 0;
    page.on("pageerror", (e) => { errs.push(e.message); const m = /:(\d+):\d+\)?\s*$/m.exec((e.stack || "").split("\n").slice(1).join("\n")); if (m && !line) line = +m[1]; });
    page.on("dialog", (d) => d.accept("5").catch(() => {}));
    try {
      await page.setContent(html, { timeout: 3000 });
      for (const k of ["ArrowLeft", "ArrowRight", "ArrowUp", " ", "Enter", "a", "d"]) { await page.keyboard.press(k); await page.waitForTimeout(40); }
      const el = await page.$("canvas, button, .cell, .card, td");
      if (el) await el.click({ force: true, timeout: 300 }).catch(() => {});
      await page.waitForTimeout(300);
      const seen = await page.evaluate(() => {
        const cv = document.querySelector("canvas"); let colors = 0;
        if (cv) { const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data, s = new Set(); for (let i = 0; i < d.length; i += 388) s.add(d[i] + "," + d[i + 1] + "," + d[i + 2]); colors = s.size; }
        return { canvas: !!cv, colors, text: document.body ? document.body.innerText.trim().length : 0 };
      }).catch((e) => ({ err: e.message }));
      if (seen.err) errs.push(seen.err);
      else if (seen.canvas && seen.colors < 2 && !seen.text) errs.push("blank page");
    } catch (e) { errs.push(e.message.split("\n")[0]); }
    await page.close();
    return errs.length ? { ok: false, error: errs[0], line } : { ok: true };
  };
  const json = JSON.parse(fs.readFileSync(MODEL, "utf8"));
  const coder = new HtmlCoder({ nlu: new CodeNLU(JSON.parse(R("model/codenlu.json"))), writers: [new HtmlWriter(json)], pool: JSON.parse(R("data/html/things.json")), check });
  console.log(`model ${path.basename(MODEL)}: ${json.params.toLocaleString()} params, ${json.epochs} epochs`);
  let ok = 0, seed = 5;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const outDir = process.env.HTMLOUT;
  for (const req of REQUESTS) {
    coder.state = { request: "", html: "", file: "", things: [], history: [] };
    const t0 = Date.now();
    const res = await coder.handle(req, { lang: /\b(make|with|the)\b/.test(req) ? "en" : "id", rand });
    const good = res.kind === "code";
    if (good) ok++;
    const title = good ? res.title : "";
    console.log((good ? "✓ " : "✗ ") + req.padEnd(52) + (good ? title + " · " + res.lines + " lines" : res.text.slice(0, 90)) + `  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    if (outDir && (res.html || "")) { fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, req.replace(/[^a-z0-9]+/gi, "-") + ".html"), res.html); }
  }
  await browser.close();
  console.log(`${ok}/${REQUESTS.length} requests -> working pages`);
})();
