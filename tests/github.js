// node tests/github.js -> github.js against a fake GitHub API
const { GitHub } = require("../assets/js/github.js");
const { makeFakeGithub } = require("./fake_github.js");
(async () => {
  const fake = makeFakeGithub();
  const bad = new GitHub({ fetch: fake.fetchImpl, token: "nope" });
  let msg = "";
  try { await bad.whoami(); } catch (e) { msg = e.message; }
  const gh = new GitHub({ fetch: fake.fetchImpl, token: "good-token" });
  const checks = [];
  checks.push(["bad token rejected", /401/.test(msg)]);
  checks.push(["whoami", (await gh.whoami()).login === "rafa"]);
  checks.push(["repos", (await gh.repos()).some((r) => r.name === "rafa/web")]);
  const ls = await gh.ls("web");
  checks.push(["ls (owner filled in)", ls.repo === "rafa/web" && ls.entries.map((e) => e.name).join(",") === "src,README.md"]);
  checks.push(["cat", (await gh.ls("rafa/web", "README.md")).file.text.includes("halo")]);
  checks.push(["create repo", (await gh.createRepo("sybau-test")).name === "rafa/sybau-test"]);
  await gh.createFile("sybau-test", "notes/a.md", "isi file ä");
  checks.push(["create file (utf8)", fake.repos["rafa/sybau-test"].files["notes/a.md"] === "isi file ä"]);
  checks.push(["update file (sha)", (await gh.createFile("sybau-test", "notes/a.md", "v2")).updated === true && fake.repos["rafa/sybau-test"].files["notes/a.md"] === "v2"]);
  await gh.createFolder("sybau-test", "docs");
  checks.push(["create folder", "docs/.gitkeep" in fake.repos["rafa/sybau-test"].files]);
  let dup = "";
  try { await gh.createRepo("web"); } catch (e) { dup = e.message; }
  checks.push(["duplicate repo error", /422/.test(dup)]);
  checks.push(["token only sent to api.github.com", fake.calls.every((c) => c.includes("https://api.github.com/"))]);
  let bad2 = 0;
  for (const [name, ok] of checks) { console.log((ok ? "ok   " : "FAIL ") + name); if (!ok) bad2++; }
  console.log(bad2 ? bad2 + " failed" : "all passed");
  process.exit(bad2 ? 1 : 0);
})();
