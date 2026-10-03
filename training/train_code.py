"""Train sybau code's code-writing transformer. Pure numpy, from scratch.

The same GPT-style transformer as the chat model (training/transformer.py), but it
writes STS programs token by token. One training sequence looks like:

    <req> game <t1> lempar <t2> ke <t3> </req> <t1> cat:person <t2> cat:weapon <t3> cat:monster <code>
    var skor = 0 ⏎ var nyawa = 3 ⏎ ... def urus ##<T3> ( id ) : ⏎ ⇥ ... <end>

The things in the request are slots (<t1>, <t2>...), and research says what each slot
is (cat:monster). That way the model can write code for words it never saw. It only
learns the code part (the request is the condition). Programs longer than the context
are cut into windows that always keep the request in front.

Data: data/sts/corpus.jsonl (node tools/make_sts_corpus.js). Output: model/stscode.json
Usage: python training/train_code.py [--epochs 6]
"""
import argparse
import json
import os
import subprocess
import time

import numpy as np

import transformer as tfm
from train import Adam, quant, dequant

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORPUS = os.path.join(ROOT, "data", "sts", "corpus.jsonl")
OUT = os.path.join(ROOT, "model", "stscode.json")
D, LAYERS, HEADS, CTX, ACT = 160, 4, 4, 384, "relu"
TOKENS_PER_BATCH = 6144


def load():
    if not os.path.exists(CORPUS):
        subprocess.check_call(["node", os.path.join(ROOT, "tools", "make_sts_corpus.js")])
    # tokenize with the same JS tokenizer the browser uses
    js = ("const fs=require('fs'),T=require(process.argv[1]);const out=[];"
          "for(const l of fs.readFileSync(process.argv[2],'utf8').trim().split('\\n')){const r=JSON.parse(l);out.push([r.prefix,T.tokenize(r.code,r.slots)])}"
          "process.stdout.write(JSON.stringify(out))")
    raw = subprocess.check_output(["node", "-e", js, os.path.join(ROOT, "assets", "js", "ststok.js"), CORPUS])
    return json.loads(raw)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=6)
    ap.add_argument("--seed", type=int, default=3)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--resume", action="store_true", help="keep training model/stscode.json (new tokens get fresh rows)")
    ap.add_argument("--lr", type=float, default=1e-3)
    args = ap.parse_args()
    args.prev_epochs = 0
    if args.resume and os.path.exists(OUT):
        args.prev_epochs = json.load(open(OUT, encoding="utf-8")).get("epochs", 0)
    rng = np.random.default_rng(args.seed)
    tfm.gradient_check(act=ACT)
    data = load()
    if args.limit:
        data = data[:args.limit]
    counts = {}
    for pre, code in data:
        for t in pre + code:
            counts[t] = counts.get(t, 0) + 1
    vocab = ["<pad>", "<unk>", "<end>"] + sorted(t for t, c in counts.items() if c >= 2)
    w2i = {w: i for i, w in enumerate(vocab)}
    enc = lambda toks: [w2i.get(t, 1) for t in toks]
    seqs = [(enc(pre), enc(code) + [2]) for pre, code in data]
    print(f"{len(seqs)} programs, vocab {len(vocab)}, {sum(len(c) for _, c in seqs):,} code tokens")

    P = tfm.init(len(vocab), CTX, D, LAYERS, rng)
    if args.resume and os.path.exists(OUT):
        old = json.load(open(OUT, encoding="utf-8"))
        ov = {w: i for i, w in enumerate(old["vocab"])}
        for k in P:
            W = dequant(old[k]).astype(np.float32)
            if k == "E":
                for w, i in w2i.items():
                    if w in ov: P[k][i] = W[ov[w]]
            elif k == "Wy":
                for w, i in w2i.items():
                    if w in ov: P[k][:, i] = W[:, ov[w]]
            elif k == "by":
                for w, i in w2i.items():
                    if w in ov: P[k][i] = W[ov[w]]
            else:
                P[k] = W.reshape(P[k].shape)
        print(f"resumed from {OUT} ({old.get('epochs')} epochs, {sum(1 for w in vocab if w in ov)}/{len(vocab)} tokens known)")
    nparams = sum(v.size for v in P.values())
    print(f"model: {LAYERS} layers, {HEADS} heads, d={D}, ctx {CTX}, {nparams:,} params")
    opt = Adam(P, lr=1e-3, b2=0.98)

    def windows():
        """(prefix + chunk of code) pieces that fit the context; long programs give several"""
        out = []
        for pre, code in seqs:
            room = CTX - len(pre) - 1
            if len(code) <= room:
                out.append((pre, code, 0))
            else:
                starts = list(range(0, len(code) - room, room - 48)) + [len(code) - room]
                for s in starts:
                    out.append((pre, code[s:s + room], s))
        return out

    est = len(windows()) * args.epochs
    step, t0 = 0, time.time()
    total_steps = None
    for ep in range(args.epochs):
        ws = windows()
        order = sorted(range(len(ws)), key=lambda i: len(ws[i][0]) + len(ws[i][1]) + rng.random() * 40)
        batches, cur, cur_len = [], [], 0
        for i in order:
            L = len(ws[i][0]) + len(ws[i][1])
            if cur and (len(cur) + 1) * max(cur_len, L) > TOKENS_PER_BATCH:
                batches.append(cur); cur, cur_len = [], 0
            cur.append(i); cur_len = max(cur_len, L)
        if cur:
            batches.append(cur)
        if total_steps is None:
            total_steps = len(batches) * args.epochs
        tot, nb = 0.0, 0
        for bi in rng.permutation(len(batches)):
            batch = [ws[i] for i in batches[bi]]
            T = max(len(p) + len(c) for p, c, _ in batch)
            inp = np.zeros((len(batch), T), dtype=np.int64)
            tgt = np.zeros((len(batch), T), dtype=np.int64)
            mask = np.zeros((len(batch), T), dtype=np.float32)
            for b, (pre, code, start) in enumerate(batch):
                ids = pre + code
                inp[b, :len(ids) - 1] = ids[:-1]
                tgt[b, :len(ids) - 1] = ids[1:]
                mask[b, len(pre) - 1:len(ids) - 1] = 1     # only the code is learned
                if start:   # a window from the middle: its first token has no real context
                    mask[b, len(pre) - 1] = 0
            warm = max(1, total_steps // 25)
            opt.lr = args.lr * min(1.0, (step + 1) / warm) * (0.08 + 0.92 * 0.5 * (1 + np.cos(np.pi * min(1.0, step / total_steps))))
            loss, g = tfm.loss_and_grads(P, inp, tgt, mask, HEADS, 0.1, rng, act=ACT)
            opt.step(g, clip=1.0)
            step += 1
            tot += loss
            nb += 1
            if step % 50 == 0:
                print(f"  step {step}/{total_steps}  loss {tot / nb:.4f}  lr {opt.lr:.2e}  ({time.time() - t0:.0f}s)", flush=True)
        print(f"== epoch {ep}  loss/token {tot / nb:.4f}  ({time.time() - t0:.0f}s)", flush=True)
        save(P, vocab, nparams, ep + (args.prev_epochs if args.resume else 0))
    print("done")


def save(P, vocab, nparams, ep):
    model = {"format": "sybau-stscode-v1", "type": "transformer", "d": D, "layers": LAYERS, "heads": HEADS, "ctx": CTX, "act": ACT,
             "vocab": vocab, "params": int(nparams), "epochs": ep + 1, "trained_at": time.strftime("%Y-%m-%d %H:%M:%S"),
             **{k: quant(v) for k, v in P.items()}}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(model, f, ensure_ascii=False, separators=(",", ":"))
    print(f"   saved {OUT} ({os.path.getsize(OUT) / 1024:.0f} KB)", flush=True)


if __name__ == "__main__":
    main()
