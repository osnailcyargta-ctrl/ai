/* stsvm.js — talks to the real STS language core (assets/sts/sts.wasm, compiled
 * from github.com/osnailcyargta-ctrl/STS-programing). Used to compile and run the
 * code sybau writes, so every program is checked by the actual STS compiler.
 * Works in the browser and in Node.
 */
(function (root) {
  "use strict";
  const KIND = ["rect", "circle", "triangle", "ellipse", "line", "text", "image", "video"];
  const STATE = { IDLE: 0, RUNNING: 1, WAIT: 2, POPUP: 3, ASK: 4, DONE: 5, ERROR: 6, PAUSED: 7 };

  class StsVM {
    constructor(instance, hooks) {
      this.x = instance.exports;
      this.mem = this.x.memory;
      this.hooks = hooks;
      this.dec = new TextDecoder();
      this.enc = new TextEncoder();
    }

    static async load(source, hooks = {}) {
      let vm = null;
      const read = (p, l) => vm.read(p, l);
      const env = {
        js_log: (p, l) => hooks.onLog && hooks.onLog(read(p, l)),
        js_popup: (kind, p, l) => hooks.onPopup && hooks.onPopup(kind, read(p, l)),
        js_sound: () => {},
        js_bg: (p, l) => hooks.onBackground && hooks.onBackground(read(p, l)),
      };
      let bytes = source;
      if (typeof source === "string") bytes = await (await fetch(source)).arrayBuffer();
      const { instance } = await WebAssembly.instantiate(bytes, { env });
      vm = new StsVM(instance, hooks);
      return vm;
    }

    read(p, l) { return this.dec.decode(new Uint8Array(this.mem.buffer, p, l)); }
    write(text) {
      const b = this.enc.encode(text);
      const n = Math.min(b.length, this.x.sts_scratch_size() - 1);
      new Uint8Array(this.mem.buffer, this.x.sts_scratch(), n).set(b.subarray(0, n));
      return n;
    }

    /** roots: [{index, code}] -> {ok} | {ok:false, error, line, root} */
    compile(roots) {
      this.x.sts_reset();
      for (const r of roots) this.x.sts_add_root(r.index, this.write(r.code || ""));
      if (this.x.sts_finish()) return { ok: true };
      return { ok: false, error: this.read(this.x.sts_err_ptr(), this.x.sts_err_len()), line: this.x.sts_err_line(), root: this.x.sts_err_root() };
    }
    start(seed) { this.x.sts_start(); this.x.sts_seed_rng(seed !== undefined ? seed : (Math.random() * 0x7fffffff) | 0); }
    tick(ms) { return this.x.sts_tick(ms); }
    stop() { this.x.sts_stop(); }
    get state() { return this.x.sts_state(); }
    ackPopup() { this.x.sts_ack_popup(); }
    answer(text) { this.x.sts_answer(this.write(String(text))); }
    click(x, y) { this.x.sts_click(x, y); }
    mouseMove(x, y) { this.x.sts_mousemove(x, y); }
    mouseDown(d) { this.x.sts_mousedown(d ? 1 : 0); }
    key(name, down) { this.x.sts_key(this.write(name), down ? 1 : 0); }
    runtimeError() { const l = this.x.sts_err_len(); return l ? this.read(this.x.sts_err_ptr(), l) : ""; }
    objects() {
      const base = this.x.sts_pack(), count = this.x.sts_pack_count(), stride = this.x.sts_pack_stride();
      const a = new Float64Array(this.mem.buffer, base, count * stride);
      const out = [];
      for (let i = 0; i < count; i++) {
        const o = a.subarray(i * stride, i * stride + stride);
        out.push({ kind: KIND[o[0]] || "rect", x: o[1], y: o[2], w: o[3], h: o[4], rot: o[5], alpha: o[6] || 1, visible: !!o[7],
          text: o[9] ? this.read(o[8], o[9]) : "", color: o[11] ? this.read(o[10], o[11]) : "" });
      }
      return out;
    }
  }

  /** "@root N name" sections <-> [{index, name, code}] (same format the STS studio saves) */
  function parseSts(text) {
    const t = String(text).replace(/\r/g, "");
    if (!/^@root\s/m.test(t)) return { roots: [{ index: 0, name: "main", code: t }], stage: null };
    const roots = [];
    let cur = null;
    for (const line of t.slice(t.search(/^@root\s/m)).split("\n")) {
      const m = /^@root\s+(\d+)\s*(\S*)/.exec(line);
      if (m) { cur = { index: +m[1], name: m[2] || "root" + m[1], lines: [] }; roots.push(cur); continue; }
      if (/^@asset\s/.test(line)) continue;
      if (cur) cur.lines.push(line);
    }
    const st = /stage\s+(\d+)x(\d+)/.exec(t);
    return { roots: roots.map((r) => ({ index: r.index, name: r.name, code: r.lines.join("\n").replace(/\n+$/, "") + "\n" })),
      stage: st ? { w: +st[1], h: +st[2] } : null };
  }

  /** run a program head-less for a while, answering popups, to catch runtime errors */
  function smokeRun(vm, roots, opts = {}) {
    const c = vm.compile(roots);
    if (!c.ok) return Object.assign({ phase: "compile" }, c);
    vm.start(opts.seed || 7);
    const keys = opts.keys || ["right", "down"];
    for (let i = 0; i < (opts.frames || 240); i++) {
      if (i === 20) keys.forEach((k) => vm.key(k, true));
      if (i % 30 === 5) vm.click(opts.clickX || 200, opts.clickY || 160);
      const st = vm.tick(16);
      if (st === STATE.ERROR) { const e = vm.runtimeError(); vm.stop(); return { ok: false, phase: "runtime", error: e || "runtime error" }; }
      if (st === STATE.POPUP) vm.ackPopup();
      if (st === STATE.ASK) vm.answer(opts.answer || "4");
      if (st === STATE.DONE) break;
    }
    const n = vm.objects().length;
    vm.stop();
    return { ok: true, objects: n };
  }

  const api = { StsVM, parseSts, smokeRun, STATE, KIND };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.StsLib = api;
})(typeof self !== "undefined" ? self : this);
