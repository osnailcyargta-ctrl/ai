/* search.js — looks stuff up on Wikipedia, straight from the browser.
 *
 * Why not Google? Google's search API needs an API key, and google.com blocks
 * pages on other sites from reading its results (CORS). Wikipedia's API is
 * free, keyless and allows it (origin=*). The UI still gives a one-tap
 * "open in Google" link for the full results.
 */
(function (root) {
  "use strict";

  function googleUrl(q) { return "https://www.google.com/search?q=" + encodeURIComponent(q); }

  function trimExtract(text, max = 420) {
    const t = String(text || "").replace(/\s+/g, " ").trim();
    if (t.length <= max) return t;
    const cut = t.slice(0, max);
    const dot = cut.lastIndexOf(". ");
    return (dot > 120 ? cut.slice(0, dot + 1) : cut.replace(/\s+\S*$/, "") + "…");
  }

  async function fetchJson(url, fetchImpl, ms) {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), ms) : null;
    try {
      const res = await fetchImpl(url, ctrl ? { signal: ctrl.signal } : undefined);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** -> {title, extract, url, thumb, lang, google} or null */
  async function wikiSearch(query, lang = "en", fetchImpl, timeoutMs = 8000) {
    const f = fetchImpl || (typeof fetch !== "undefined" ? fetch.bind(root) : null);
    if (!f || !query) return null;
    const order = lang === "id" ? ["id", "en"] : ["en", "id"];
    for (const l of order) {
      const url = "https://" + l + ".wikipedia.org/w/api.php?action=query&format=json&origin=*" +
        "&generator=search&gsrlimit=1&gsrsearch=" + encodeURIComponent(query) +
        "&prop=extracts|pageimages|info&inprop=url&exintro=1&explaintext=1&exsentences=4" +
        "&piprop=thumbnail&pithumbsize=240&redirects=1";
      const data = await fetchJson(url, f, timeoutMs);
      const pages = data && data.query && data.query.pages;
      if (!pages) continue;
      const page = Object.values(pages)[0];
      if (!page || !page.extract || !page.extract.trim()) continue;
      return {
        title: page.title,
        extract: trimExtract(page.extract),
        url: page.fullurl || "https://" + l + ".wikipedia.org/wiki/" + encodeURIComponent(page.title.replace(/ /g, "_")),
        thumb: page.thumbnail ? page.thumbnail.source : null,
        lang: l,
        google: googleUrl(query),
      };
    }
    return null;
  }

  const api = { wikiSearch, googleUrl, trimExtract };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SearchLib = api;
})(typeof self !== "undefined" ? self : this);
