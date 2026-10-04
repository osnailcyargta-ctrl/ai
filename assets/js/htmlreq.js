/* htmlreq.js — how a request is shown to the code transformer.
 *
 *   "bikin ninja lempar shuriken ke zombie"
 *   -> <req> bikin <t1> ninja lempar <t2> shuriken ke <t3> zombie </req> <code>
 *
 * The things in the request (from the code NLU tagger, or the training data) become slots
 * <t1> <t2>..., so the model can copy any word into the game, even one it never saw. The
 * word itself stays next to its slot, so for words it does know (zombie) it also knows what
 * goes with it (🧟, chasing, ...).
 */
(function (root) {
  "use strict";
  const MAX_SLOTS = 4, MAX_WORDS = 24;

  function words(text) {
    return (String(text).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").match(/[a-z]+|\d+/g) || []).slice(0, MAX_WORDS);
  }

  // "zombies" is the slot of "zombie"
  const same = (w, n) => w === n || w === n + "s" || w === n + "es";

  /** the thing names that are really in the request, in the order they appear -> [{key}] */
  function slotsFor(text, names) {
    const ws = words(text), out = [];
    for (const w of ws) {
      if (out.length >= MAX_SLOTS) break;
      const n = names.map((x) => String(x).toLowerCase()).find((x) => same(w, x));
      if (n && !out.some((s) => s.key === n)) out.push({ key: n });
    }
    return out;
  }

  function prefix(text, slots) {
    const keys = slots.map((s) => s.key);
    const out = ["<req>"];
    for (const w of words(text)) {
      const i = keys.findIndex((k) => same(w, k));
      if (i >= 0) out.push("<t" + (i + 1) + ">");
      out.push(w);
    }
    out.push("</req>", "<code>");
    return out;
  }

  const api = { words, slotsFor, prefix, MAX_SLOTS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HtmlReqLib = api;
})(typeof self !== "undefined" ? self : this);
