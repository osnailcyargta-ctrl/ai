// node tools/check_html.js [filter] — opens every hand-written game in data/html/games in a real
// browser, mashes keys and clicks for a few seconds, and fails on any JS error or a blank page.
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const DIR = path.join(ROOT, "data/html/games");
const Tok = require(ROOT + "/assets/js/htmltok.js");
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node-tools/node_modules/playwright"); }

(async () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".html") && (!process.argv[2] || f.includes(process.argv[2]))).sort();
  const browser = await pw.chromium.launch({ executablePath: fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined });
  let bad = 0, total = 0;
  for (const f of files) {
    const src = fs.readFileSync(path.join(DIR, f), "utf8");
    const toks = Tok.tokenize(src).length;
    total += toks;
    if (Tok.detokenize(Tok.tokenize(src)) !== Tok.normalize(src)) { console.log("✗", f, "tokenizer round trip"); bad++; continue; }
    const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    page.on("dialog", (d) => d.accept("5").catch(() => {}));
    await page.goto("file://" + path.join(DIR, f));
    await page.waitForTimeout(150);
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " ", "w", "a", "s", "d", "Enter", "1", "x"];
    for (let i = 0; i < 40; i++) {
      const k = keys[Math.floor(Math.random() * keys.length)];
      await page.keyboard.down(k); await page.waitForTimeout(25); await page.keyboard.up(k);
      if (i % 3 === 0) {
        const els = await page.$$("button, canvas, td, .cell, .card, input");
        if (els.length) { const e = els[Math.floor(Math.random() * els.length)]; await e.click({ force: true, timeout: 300 }).catch(() => {}); }
        else await page.mouse.click(100 + Math.random() * 440, 80 + Math.random() * 320);
      }
    }
    await page.waitForTimeout(200);
    const seen = await page.evaluate(() => {
      const cv = document.querySelector("canvas");
      let colors = 0;
      if (cv) {
        const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data, set = new Set();
        for (let i = 0; i < d.length; i += 4 * 97) set.add(d[i] + "," + d[i + 1] + "," + d[i + 2] + "," + d[i + 3]);
        colors = set.size;
      }
      return { canvas: !!cv, colors, text: document.body.innerText.trim().length };
    });
    const ok = !errs.length && (seen.canvas ? seen.colors > 1 || seen.text > 0 : seen.text > 0);
    if (!ok) bad++;
    console.log((ok ? "✓" : "✗"), f.padEnd(34), String(toks).padStart(5), "tok", errs.length ? errs.slice(0, 2).join(" | ") : "", seen.canvas && seen.colors <= 1 ? "blank canvas" : "");
    await page.close();
  }
  await browser.close();
  console.log(`${files.length - bad}/${files.length} games ok, ${total} tokens total, avg ${Math.round(total / Math.max(1, files.length))}`);
  process.exit(bad ? 1 : 0);
})();
