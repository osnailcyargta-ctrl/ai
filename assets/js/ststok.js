/* ststok.js — turns STS source into tokens for the code transformer, and back.
 *
 *   on 0 0 draw square 24 color "#6d9b4a". zombie1
 *   -> on 0 0 draw square 24 color " #6d9b4a " . <t1> ##1 ⏎
 *
 * - indentation becomes ⇥ (one level deeper) and ⇤ (one level back), lines end with ⏎
 * - identifiers are cut at camelCase / digit boundaries ("urusZombie" -> urus ##Zombie),
 *   continuation pieces start with ##
 * - the names of the things in the request are swapped for slots: zombie -> <t1>,
 *   Zombie -> <T1>. That is how the model can write code for ANY word: it learns what
 *   to do with "slot 1 (a monster)", and the real word is put back afterwards.
 * - inside strings every space is ␣
 * detokenize() rebuilds code that compiles the same; tests/codetok.js checks that.
 */
(function (root) {
  "use strict";
  const NL = "⏎", IN = "⇥", OUT = "⇤", SP = "␣";
  const OPS = ["==", "!=", "<=", ">=", "+=", "-=", "=", "<", ">", "+", "-", "*", "/", "%"];
  const WORD_OPS = new Set(["and", "or", "not"]);

  function splitIdent(id) {
    return id.match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+|_+/g) || [id];
  }

  /** slots: [{key: "zombie"}, ...] (index 0 -> t1) */
  function tokenize(code, slots = []) {
    const keys = slots.map((s) => String(s.key || "").toLowerCase());
    const slotOf = (piece) => {
      const i = keys.indexOf(piece.toLowerCase());
      if (i < 0 || !piece) return null;
      return /^[A-Z]/.test(piece) ? "<T" + (i + 1) + ">" : "<t" + (i + 1) + ">";
    };
    const out = [];
    let level = 0;
    for (const raw of String(code).replace(/\r/g, "").split("\n")) {
      // drop comments (outside strings)
      let line = "", inStr = false;
      for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (ch === '"') inStr = !inStr;
        if (!inStr && ch === "/" && raw[i + 1] === "/") break;
        line += ch;
      }
      if (!line.trim()) continue;
      const ind = Math.floor(line.match(/^ */)[0].length / 4);
      while (level < ind) { out.push(IN); level++; }
      while (level > ind) { out.push(OUT); level--; }
      const s = line.trim();
      let i = 0, prev = "";
      while (i < s.length) {
        const rest = s.slice(i);
        let m;
        if (rest[0] === " ") { i++; continue; }
        if (rest[0] === '"') {
          const end = s.indexOf('"', i + 1);
          const body = s.slice(i + 1, end < 0 ? s.length : end);
          out.push('"');
          for (const part of body.split(/( )/)) {
            if (part === " ") out.push(SP);
            else if (part) { const sl = slotOf(part); out.push(sl || part); }
          }
          out.push('"');
          i = end < 0 ? s.length : end + 1;
          prev = '"';
          continue;
        }
        if ((m = rest.match(/^\/(var|id|time)(?=")/))) { out.push("/" + m[1]); i += m[0].length; prev = "/"; continue; }
        const negOk = i === 0 || /[\s(,{]/.test(s[i - 1]);   // "-100" written tight is a number, "a - 1" is a minus
        if ((m = rest.match(/^-?\d+(\.\d+)?/)) && (rest[0] !== "-" || negOk)) { out.push(m[0]); i += m[0].length; prev = m[0]; continue; }
        if ((m = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/))) {
          const word = m[0];
          if (WORD_OPS.has(word)) out.push(word);
          else splitIdent(word).forEach((p, k) => { const sl = slotOf(p); out.push((k ? "##" : "") + (sl || p)); });
          i += word.length; prev = word; continue;
        }
        const op = OPS.find((o) => rest.startsWith(o));
        if (op) { out.push(op); i += op.length; prev = op; continue; }
        out.push(rest[0]); prev = rest[0]; i++;
      }
      out.push(NL);
    }
    while (level > 0) { out.push(OUT); level--; }
    return out;
  }

  /** tokens -> STS source (slot tokens get the real names back) */
  function detokenize(tokens, slots = []) {
    const name = (t) => {
      const m = /^<([tT])(\d+)>$/.exec(t);
      if (!m) return t;
      const k = String((slots[+m[2] - 1] || {}).key || "benda" + m[2]);
      return m[1] === "T" ? k.charAt(0).toUpperCase() + k.slice(1) : k;
    };
    const lines = [];
    let level = 0, cur = [];
    const flush = () => {
      if (!cur.length) return;
      let s = "", inStr = false, prevKind = "";
      for (const t of cur) {
        if (t === '"') {
          if (!inStr) { if (s && !/[(\s{]$/.test(s) && prevKind !== "ref") s += " "; s += '"'; inStr = true; }
          else { s += '"'; inStr = false; prevKind = "str"; }
          continue;
        }
        if (inStr) { s += t === SP ? " " : name(t); continue; }
        if (t.startsWith("##")) { s += name(t.slice(2)); prevKind = "word"; continue; }
        const kind = /^[A-Za-z_<]/.test(t) || /^-?\d/.test(t) || /^\/(var|id|time)$/.test(t) ? "word" : t;
        if (t === "(" ) { if (prevKind !== "word" && s && !/[\s(]$/.test(s)) s += " "; s += "("; prevKind = "("; continue; }
        if (t === ".") { prevKind = prevKind === "word" ? ".w" : "."; s += "."; continue; }   // show.popup  vs  color "#fff". id
        if (t === ")" || t === "," || t === ":" || t === ";") { s += t; prevKind = t; continue; }
        if (t === "{" || t === "[") { if (s && !/\s$/.test(s)) s += " "; s += t; prevKind = t; continue; }
        if (t === "}" || t === "]") { s += t; prevKind = t; continue; }
        if (OPS.includes(t) || WORD_OPS.has(t)) { s += (s && !/[\s(]$/.test(s) ? " " : "") + t + " "; prevKind = "op"; continue; }
        if (/^\/(var|id|time)$/.test(t)) { if (s && !/[\s(]$/.test(s)) s += " "; s += t; prevKind = "ref"; continue; }
        if (s && !/[\s({]$/.test(s) && prevKind !== "ref" && prevKind !== ".w") s += " ";
        s += name(t);
        prevKind = "word";
      }
      lines.push("    ".repeat(level) + s.replace(/ +/g, (m2, at) => (inStringAt(s, at) ? m2 : " ")).trimEnd());
      cur = [];
    };
    for (const t of tokens) {
      if (t === NL) { flush(); continue; }
      if (t === IN) { flush(); level++; continue; }
      if (t === OUT) { flush(); level = Math.max(0, level - 1); continue; }
      cur.push(t);
    }
    flush();
    return lines.join("\n") + "\n";
  }
  function inStringAt(s, at) { let n = 0; for (let i = 0; i < at; i++) if (s[i] === '"') n++; return n % 2 === 1; }

  const api = { tokenize, detokenize, NL, IN, OUT, SP };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.StsTokLib = api;
})(typeof self !== "undefined" ? self : this);
