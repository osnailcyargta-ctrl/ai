/* htmltok.js — turns an HTML/JS/CSS file into tokens for the code transformer, and back.
 *
 *   ctx.fillText("🧟", z.x, z.y);
 *   -> ⏎2 ctx . fill ##Text ( " 🧟 " , ▁z . x , ▁z . y ) ;
 *
 * - every line starts with ⏎N (N = spaces of indentation)
 * - a token with ▁ in front had one space before it; extra spaces are ␣
 * - identifiers are cut at camelCase / digit boundaries, continuation pieces start with ##
 * - emoji are one token each
 * - the names of the things in the request are swapped for slots: zombie -> <t1>,
 *   Zombie -> <T1>, so the model can write a game for any word and copy it back
 * Lossless: detokenize(tokenize(src)) === normalize(src). tests/htmltok.js checks that.
 */
(function (root) {
  "use strict";
  const SP = "▁", EXTRA = "␣";
  const OPS = ["===", "!==", "<!--", "-->", "...", "==", "!=", "<=", ">=", "=>", "&&", "||", "??", "++", "--", "+=", "-=", "*=", "/=", "%=", "**", "</", "/>", "${"];
  const EMOJI = /^\p{Extended_Pictographic}(?:️|⃣|[\u{1F3FB}-\u{1F3FF}]|‍\p{Extended_Pictographic}️?)*/u;
  const FLAG = /^[\u{1F1E6}-\u{1F1FF}]{2}/u;

  function normalize(src) {
    return String(src).replace(/\r/g, "").replace(/\t/g, "  ").split("\n").map((l) => l.replace(/\s+$/, "")).join("\n").replace(/\n+$/, "") + "\n";
  }

  function splitIdent(id) {
    return id.match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+|[_$]+/g) || [id];
  }

  /** slots: [{key: "zombie"}, ...] (index 0 -> t1) */
  function tokenize(src, slots = []) {
    const keys = slots.map((s) => String(s.key || "").toLowerCase());
    const slotOf = (w) => {
      const i = keys.indexOf(w.toLowerCase());
      if (i < 0 || !w) return null;
      return /^[A-Z]/.test(w) ? "<T" + (i + 1) + ">" : "<t" + (i + 1) + ">";
    };
    const out = [];
    for (const line of normalize(src).replace(/\n$/, "").split("\n")) {
      const ind = line.match(/^ */)[0].length;
      out.push("⏎" + ind);
      const s = line.slice(ind);
      let i = 0, space = false;
      const push = (t) => { out.push((space ? SP : "") + t); space = false; };
      while (i < s.length) {
        const rest = s.slice(i);
        let m;
        if (rest[0] === " ") {
          let n = 0;
          while (s[i + n] === " ") n++;
          for (let k = 1; k < n; k++) out.push(EXTRA);
          space = true; i += n; continue;
        }
        if ((m = rest.match(/^[A-Za-z_$][A-Za-z0-9_$]*/))) {
          const word = m[0], whole = slotOf(word);
          if (whole) push(whole);
          else splitIdent(word).forEach((p, k) => { const sl = slotOf(p); if (k) out.push("##" + (sl || p)); else push(sl || p); });
          i += word.length; continue;
        }
        if ((m = rest.match(/^\d+/))) { push(m[0]); i += m[0].length; continue; }
        if ((m = rest.match(FLAG) || rest.match(EMOJI))) { push(m[0]); i += m[0].length; continue; }
        const op = OPS.find((o) => rest.startsWith(o));
        if (op) { push(op); i += op.length; continue; }
        const ch = String.fromCodePoint(rest.codePointAt(0));
        push(ch); i += ch.length;
      }
    }
    return out;
  }

  /** tokens -> source (slot tokens get the real names back) */
  function detokenize(tokens, slots = []) {
    const name = (t) => {
      const m = /^<([tT])(\d+)>$/.exec(t);
      if (!m) return t;
      const k = String((slots[+m[2] - 1] || {}).key || "thing" + m[2]);
      return m[1] === "T" ? k.charAt(0).toUpperCase() + k.slice(1) : k.toLowerCase();
    };
    let s = "";
    for (const t of tokens) {
      if (/^⏎\d+$/.test(t)) { s += (s ? "\n" : "") + " ".repeat(+t.slice(1)); continue; }
      if (t === EXTRA) { s += " "; continue; }
      if (t.startsWith("##")) { s += name(t.slice(2)); continue; }
      if (t.startsWith(SP)) { s += " " + name(t.slice(1)); continue; }
      s += name(t);
    }
    return s + "\n";
  }

  const api = { tokenize, detokenize, normalize, SP, EXTRA };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HtmlTokLib = api;
})(typeof self !== "undefined" ? self : this);
