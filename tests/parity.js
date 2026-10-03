const fs = require("fs"), path = require("path");
const { Brain, normalize, detectLang } = require("../assets/js/brain.js");
const brain = new Brain(JSON.parse(fs.readFileSync(path.join(__dirname, "../model/brain.json"), "utf8")));
const texts = JSON.parse(process.argv[2]);
const out = texts.map((t) => {
  const ranked = brain.classify(t);
  const probs = brain.clsTags.map((tag) => ranked.find((r) => r.tag === tag).p);
  return { tokens: normalize(t), lang: detectLang(normalize(t)), probs };
});
const seqs = JSON.parse(process.argv[3] || "[]");
const gen = seqs.map((ids) => Array.from(brain.logitsFor(ids)));
console.log(JSON.stringify({ cls: out, gen }));
