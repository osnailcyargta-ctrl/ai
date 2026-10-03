// Fake api.github.com (same JSON shapes as the real REST API) for offline tests.
function makeFakeGithub() {
  const repos = { "rafa/web": { files: { "README.md": "# web\nhalo", "src/app.js": "console.log(1)" }, private: false } };
  const calls = [];
  async function fetchImpl(url, opts = {}) {
    const method = opts.method || "GET";
    calls.push(method + " " + url);
    const auth = opts.headers && opts.headers.Authorization;
    const respond = (status, body) => ({ ok: status < 300, status, json: async () => body });
    if (auth !== "Bearer good-token") return respond(401, { message: "Bad credentials" });
    const path = url.replace("https://api.github.com", "");
    if (path === "/user") return respond(200, { login: "rafa", name: "Rafa", public_repos: Object.keys(repos).length, html_url: "https://github.com/rafa" });
    if (path.startsWith("/user/repos") && method === "GET")
      return respond(200, Object.entries(repos).map(([n, r]) => ({ full_name: n, private: r.private, description: null, html_url: "https://github.com/" + n })));
    if (path === "/user/repos" && method === "POST") {
      const b = JSON.parse(opts.body);
      const n = "rafa/" + b.name;
      if (repos[n]) return respond(422, { message: "name already exists on this account" });
      repos[n] = { files: { "README.md": "# " + b.name }, private: b.private };
      return respond(201, { full_name: n, html_url: "https://github.com/" + n, private: b.private });
    }
    const m = path.match(/^\/repos\/([^/]+\/[^/]+)\/contents\/?(.*)$/);
    if (m) {
      const repo = repos[m[1]], p = decodeURI(m[2]);
      if (!repo) return respond(404, { message: "Not Found" });
      if (method === "PUT") {
        const b = JSON.parse(opts.body);
        const existed = p in repo.files;
        if (existed && !b.sha) return respond(422, { message: "sha wasn't supplied" });
        repo.files[p] = Buffer.from(b.content, "base64").toString("utf8");
        return respond(existed ? 200 : 201, { content: { path: p, html_url: "https://github.com/" + m[1] + "/blob/main/" + p } });
      }
      if (p in repo.files) return respond(200, { name: p.split("/").pop(), path: p, size: repo.files[p].length, sha: "abc", encoding: "base64",
        content: Buffer.from(repo.files[p]).toString("base64"), html_url: "https://github.com/" + m[1] + "/blob/main/" + p });
      const prefix = p ? p.replace(/\/$/, "") + "/" : "";
      const entries = new Map();
      for (const f of Object.keys(repo.files)) {
        if (!f.startsWith(prefix)) continue;
        const rest = f.slice(prefix.length), [head, ...tail] = rest.split("/");
        entries.set(head, { name: head, path: prefix + head, type: tail.length ? "dir" : "file", size: tail.length ? 0 : repo.files[f].length });
      }
      if (!entries.size) return respond(404, { message: "Not Found" });
      return respond(200, [...entries.values()]);
    }
    return respond(404, { message: "Not Found" });
  }
  return { fetchImpl, repos, calls };
}
module.exports = { makeFakeGithub };
