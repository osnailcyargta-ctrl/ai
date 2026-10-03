/* github.js — lets sybau look at and change your GitHub, straight from the browser.
 *
 * Uses the official GitHub REST API (api.github.com allows browser requests).
 * You give it YOUR personal access token (/github login TOKEN). The token is kept
 * only in this browser's localStorage and is only ever sent to api.github.com.
 * Every write (create repo / file / folder) asks for permission first in the UI.
 */
(function (root) {
  "use strict";
  const API = "https://api.github.com";
  const TOKEN_KEY = "sybau_github_token";

  function b64utf8(s) {
    if (typeof TextEncoder !== "undefined" && typeof btoa === "function") {
      const bytes = new TextEncoder().encode(s);
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    }
    return Buffer.from(s, "utf8").toString("base64");
  }
  function unb64utf8(b) {
    const clean = String(b).replace(/\s/g, "");
    if (typeof atob === "function" && typeof TextDecoder !== "undefined") {
      const bin = atob(clean), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder().decode(bytes);
    }
    return Buffer.from(clean, "base64").toString("utf8");
  }

  class GitHub {
    constructor(opts = {}) {
      this.storage = opts.storage || null;
      this.fetch = opts.fetch || (typeof fetch !== "undefined" ? fetch.bind(root) : null);
      this.token = opts.token || this._loadToken();
      this.user = null;
    }
    _loadToken() { try { return (this.storage && this.storage.getItem(TOKEN_KEY)) || null; } catch (e) { return null; } }
    setToken(t) {
      this.token = t || null;
      this.user = null;
      try { if (this.storage) { if (t) this.storage.setItem(TOKEN_KEY, t); else this.storage.removeItem(TOKEN_KEY); } } catch (e) { /* ignore */ }
    }
    get connected() { return !!this.token; }

    async _req(method, path, body) {
      if (!this.token) throw new Error("no token. run /github login TOKEN");
      const res = await this.fetch(API + path, {
        method,
        headers: { Authorization: "Bearer " + this.token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
          ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      let data = null;
      try { data = await res.json(); } catch (e) { data = null; }
      if (!res.ok) {
        const msg = (data && data.message) || ("HTTP " + res.status);
        const err = new Error(res.status === 401 ? "token invalid or expired (401)" : res.status === 404 ? "not found (404) - wrong name, or the token can't see it" :
          res.status === 403 ? "forbidden (403): " + msg : res.status === 422 ? "rejected (422): " + msg : msg);
        err.status = res.status;
        throw err;
      }
      return data;
    }

    async whoami() {
      if (!this.user) this.user = await this._req("GET", "/user");
      return this.user;
    }
    async fullName(repo) {
      if (repo.includes("/")) return repo;
      const me = await this.whoami();
      return me.login + "/" + repo;
    }
    async repos() {
      const list = await this._req("GET", "/user/repos?per_page=30&sort=updated");
      return list.map((r) => ({ name: r.full_name, private: r.private, description: r.description, url: r.html_url, updated: r.updated_at }));
    }
    async ls(repo, path = "") {
      const full = await this.fullName(repo);
      const data = await this._req("GET", "/repos/" + full + "/contents/" + encodeURI(path.replace(/^\/+/, "")));
      if (Array.isArray(data)) return { repo: full, path, entries: data.map((e) => ({ name: e.name, type: e.type, size: e.size, path: e.path })).sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1)) };
      return { repo: full, path, file: { name: data.name, size: data.size, text: data.encoding === "base64" ? unb64utf8(data.content) : "", url: data.html_url } };
    }
    async createRepo(name, opts = {}) {
      const r = await this._req("POST", "/user/repos", { name, private: !!opts.private, auto_init: true, description: opts.description || "made by sybau.ai (it hates this repo already)" });
      return { name: r.full_name, url: r.html_url, private: r.private };
    }
    async createFile(repo, path, content, message) {
      const full = await this.fullName(repo);
      const clean = path.replace(/^\/+/, "");
      let sha;
      try { const cur = await this._req("GET", "/repos/" + full + "/contents/" + encodeURI(clean)); if (cur && cur.sha && !Array.isArray(cur)) sha = cur.sha; } catch (e) { if (e.status !== 404) throw e; }
      const r = await this._req("PUT", "/repos/" + full + "/contents/" + encodeURI(clean), {
        message: message || (sha ? "update " : "create ") + clean + " (via sybau.ai)", content: b64utf8(content == null ? "" : content), ...(sha ? { sha } : {}) });
      return { repo: full, path: clean, url: r.content && r.content.html_url, updated: !!sha };
    }
    async createFolder(repo, path) {
      // git has no empty folders: a folder exists once it has a file in it
      const clean = path.replace(/^\/+|\/+$/g, "");
      const r = await this.createFile(repo, clean + "/.gitkeep", "", "create folder " + clean + " (via sybau.ai)");
      return Object.assign(r, { folder: clean });
    }
  }

  const REPO = "([\\w.-]+\\/[\\w.-]+|[\\w.-]+)";
  /** natural language or /github args -> {action, repo, path, content, private} | null */
  function parseGithub(text) {
    const t = String(text).trim();
    let m;
    if ((m = t.match(new RegExp("^(?:tolong |coba )?(?:bikin|bikinin|buat|buatin|create|make|add|tambah(?:in)?)\\s+(?:file|berkas)\\s+(\\S+)\\s+(?:di|in|to|ke|on)\\s+(?:repo(?:sitory)?\\s+)?" + REPO + "(?:\\s+(?:isi(?:nya)?|with|content|dengan isi|berisi)\\s+([\\s\\S]+))?$", "i"))))
      return { action: "mkfile", path: m[1], repo: m[2], content: m[3] || "" };
    if ((m = t.match(new RegExp("^(?:tolong |coba )?(?:bikin|bikinin|buat|buatin|create|make|add|tambah(?:in)?)\\s+(?:folder|direktori|directory|dir)\\s+(\\S+)\\s+(?:di|in|to|ke|on)\\s+(?:repo(?:sitory)?\\s+)?" + REPO + "\\s*$", "i"))))
      return { action: "mkdir", path: m[1], repo: m[2] };
    if ((m = t.match(/^(?:tolong |coba )?(?:bikin|bikinin|buat|buatin|create|make)\s+(?:a\s+)?(?:new\s+)?(?:repo|repository)(?:\s+baru)?(?:\s+(?:namanya|bernama|called|named))?\s+([\w.-]+)(\s+(?:private|privat|pribadi))?\s*$/i)))
      return { action: "mkrepo", repo: m[1], private: !!m[2] };
    if (/\b(repo gw apa aja|repo aku apa aja|list repo|daftar repo|show my repos|my repos|my repositories|repo(?:sitory)? gw|repo saya)\b/i.test(t))
      return { action: "repos" };
    if ((m = t.match(new RegExp("^(?:liat|lihat|cek|buka|isi|show|list|open|what'?s in|whats in)\\s+(?:isi\\s+)?(?:repo(?:sitory)?|files in)\\s+" + REPO + "(?:\\/(\\S+))?(?:\\s+apa aja)?\\s*$", "i"))))
      return { action: "ls", repo: m[1], path: m[2] || "" };
    return null;
  }

  /** "/github ..." -> {action, ...} */
  function parseGithubCommand(args) {
    const [sub, ...rest] = String(args || "").trim().split(/\s+/);
    const s = (sub || "").toLowerCase();
    if (!s || s === "status" || s === "whoami") return { action: "whoami" };
    if (s === "login" || s === "token") return { action: "login", token: rest[0] || "" };
    if (s === "logout") return { action: "logout" };
    if (s === "repos") return { action: "repos" };
    if (s === "ls" || s === "cat") {
      const target = rest[0] || "";
      const parts = target.split("/");
      return { action: "ls", repo: parts.slice(0, 2).join("/"), path: parts.slice(2).join("/") };
    }
    if (s === "mkrepo") return { action: "mkrepo", repo: rest[0], private: /^(private|privat)$/i.test(rest[1] || "") };
    if (s === "mkfile") return { action: "mkfile", repo: rest[0], path: rest[1], content: rest.slice(2).join(" ") };
    if (s === "mkdir") return { action: "mkdir", repo: rest[0], path: rest[1] };
    return { action: "help" };
  }

  const api = { GitHub, parseGithub, parseGithubCommand, b64utf8, unb64utf8 };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GitHubLib = api;
})(typeof self !== "undefined" ? self : this);
