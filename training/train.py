"""Train the brainrot roast bot from scratch. Pure numpy, no ML framework, no API.

Two neural networks get trained on the files in ../data:

1. Intent classifier  - MLP (hashed bag-of-features -> 128 ReLU -> softmax).
   Figures out WHAT the user is saying (greeting, insult, choice, math, ...).
2. Response generator - word-level GRU language model conditioned on the intent.
   Writes the reply word by word, sampled from its learned distribution.

Both are trained with hand-written backprop + Adam and exported (int8
quantised) to ../model/brain.json, which the website runs in the browser.

Usage:  python training/train.py  [--seed 7] [--gen-epochs 120]
"""
import argparse
import base64
import json
import os
import random
import re
import time

import numpy as np

from textproc import featurize, gen_tokenize, gen_detokenize

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(ROOT, "model", "brain.json")

FEAT_DIM = 2048
CLS_HIDDEN = 128
GEN_EMB = 48
GEN_INTENT_EMB = 16
GEN_HIDDEN = 160
MAX_GEN_LEN = 40


# ------------------------------------------------------------------ data

def load_data():
    with open(os.path.join(DATA, "intents.json"), encoding="utf-8") as f:
        intents = json.load(f)["intents"]
    with open(os.path.join(DATA, "fillers.json"), encoding="utf-8") as f:
        fillers = {k: v for k, v in json.load(f).items() if not k.startswith("_")}
    extra = []
    path = os.path.join(DATA, "roasts.txt")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            extra = [l.strip() for l in f if l.strip() and not l.startswith("#")]
    return intents, fillers, extra


SLOT_RE = re.compile(r"\{([A-Z])\}")
NOISE_PRE = ["bro", "yo", "eh", "woy", "lol", "ngl", "anjir", "hmm", "jujur", "fr"]
NOISE_POST = ["bro", "lol", "pls", "dong", "sih", "deh", "fr", "bang", "ya", "?", "!!", "wkwk", "😭", "💀"]


def fill_slots(pattern, fillers, rng):
    def rep(m):
        key = m.group(1)
        return rng.choice(fillers[key]) if key in fillers else m.group(0)
    return SLOT_RE.sub(rep, pattern)


def noisy(text, rng):
    words = text.split()
    r = rng.random()
    if r < 0.15 and len(words) > 2:
        del words[rng.randrange(len(words))]
    elif r < 0.30:
        # keyboard-ish typo: duplicate or swap a char inside one word
        i = rng.randrange(len(words))
        w = words[i]
        if len(w) > 3:
            j = rng.randrange(1, len(w) - 1)
            if rng.random() < 0.5:
                w = w[:j] + w[j] + w[j:]
            else:
                w = w[:j - 1] + w[j] + w[j - 1] + w[j + 1:]
            words[i] = w
    if rng.random() < 0.25:
        words.insert(0, rng.choice(NOISE_PRE))
    if rng.random() < 0.3:
        words.append(rng.choice(NOISE_POST))
    return " ".join(words)


def build_classifier_set(intents, fillers, rng, per_pattern=8, holdout=0.0):
    tags = [it["tag"] for it in intents if it["patterns"]]
    train, val = [], []
    for it in intents:
        if not it["patterns"]:
            continue
        y = tags.index(it["tag"])
        pats = list(it["patterns"])
        rng.shuffle(pats)
        n_val = int(len(pats) * holdout)
        for k, p in enumerate(pats):
            target = val if k < n_val else train
            has_slot = bool(SLOT_RE.search(p))
            reps = per_pattern * (2 if has_slot else 1)
            seen = set()
            for r in range(reps):
                t = fill_slots(p, fillers, rng)
                if r > 0:
                    t = noisy(t, rng)
                if t in seen:
                    continue
                seen.add(t)
                target.append((t, y))
    if "fallback" in tags:
        # keyboard-mash gibberish so the bot can honestly say "idk what u said"
        y = tags.index("fallback")
        letters = "qwertyuiopasdfghjklzxcvbnm"
        for _ in range(per_pattern * 25):
            words = ["".join(rng.choice(letters) for _ in range(rng.randint(2, 8)))
                     for _ in range(rng.randint(1, 4))]
            train.append((" ".join(words), y))
    return tags, train, val


def to_matrix(samples):
    X = np.zeros((len(samples), FEAT_DIM), dtype=np.float32)
    y = np.zeros(len(samples), dtype=np.int64)
    for i, (t, lab) in enumerate(samples):
        for k, v in featurize(t, FEAT_DIM).items():
            X[i, k] = v
        y[i] = lab
    return X, y


# ------------------------------------------------------------------ adam

class Adam:
    def __init__(self, params, lr=1e-3, b1=0.9, b2=0.999, eps=1e-8):
        self.p = params
        self.lr, self.b1, self.b2, self.eps = lr, b1, b2, eps
        self.m = {k: np.zeros_like(v) for k, v in params.items()}
        self.v = {k: np.zeros_like(v) for k, v in params.items()}
        self.t = 0

    def step(self, grads, clip=None):
        if clip is not None:
            total = np.sqrt(sum(float((g * g).sum()) for g in grads.values()))
            if total > clip:
                grads = {k: g * (clip / (total + 1e-12)) for k, g in grads.items()}
        self.t += 1
        for k, g in grads.items():
            self.m[k] = self.b1 * self.m[k] + (1 - self.b1) * g
            self.v[k] = self.b2 * self.v[k] + (1 - self.b2) * g * g
            mh = self.m[k] / (1 - self.b1 ** self.t)
            vh = self.v[k] / (1 - self.b2 ** self.t)
            self.p[k] -= self.lr * mh / (np.sqrt(vh) + self.eps)


def softmax(z):
    z = z - z.max(axis=-1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=-1, keepdims=True)


def sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))


# ------------------------------------------------------------------ classifier

def init_classifier(n_classes, rng_np):
    return {
        "W1": (rng_np.standard_normal((FEAT_DIM, CLS_HIDDEN)) * np.sqrt(2.0 / 40)).astype(np.float32),
        "b1": np.zeros(CLS_HIDDEN, dtype=np.float32),
        "W2": (rng_np.standard_normal((CLS_HIDDEN, n_classes)) * np.sqrt(1.0 / CLS_HIDDEN)).astype(np.float32),
        "b2": np.zeros(n_classes, dtype=np.float32),
    }


def classifier_forward(P, X):
    h = np.maximum(0, X @ P["W1"] + P["b1"])
    return softmax(h @ P["W2"] + P["b2"])


def train_classifier(X, y, n_classes, epochs, rng_np, Xv=None, yv=None, log=True):
    P = init_classifier(n_classes, rng_np)
    opt = Adam(P, lr=2e-3)
    smooth, drop, wd, bs = 0.05, 0.3, 1e-5, 64
    n = len(X)
    for ep in range(epochs):
        idx = rng_np.permutation(n)
        tot = 0.0
        for s in range(0, n, bs):
            b = idx[s:s + bs]
            xb, yb = X[b], y[b]
            a1 = xb @ P["W1"] + P["b1"]
            h = np.maximum(0, a1)
            mask = (rng_np.random(h.shape) > drop).astype(np.float32) / (1 - drop)
            hd = h * mask
            p = softmax(hd @ P["W2"] + P["b2"])
            tgt = np.full_like(p, smooth / n_classes)
            tgt[np.arange(len(b)), yb] += 1 - smooth
            tot += float(-(tgt * np.log(p + 1e-9)).sum())
            dz = (p - tgt) / len(b)
            g = {"W2": hd.T @ dz + wd * P["W2"], "b2": dz.sum(0)}
            dh = (dz @ P["W2"].T) * mask * (a1 > 0)
            g["W1"] = xb.T @ dh + wd * P["W1"]
            g["b1"] = dh.sum(0)
            opt.step(g)
        if log and (ep % 10 == 0 or ep == epochs - 1):
            acc = (classifier_forward(P, X).argmax(1) == y).mean()
            msg = f"  [cls] epoch {ep:3d}  loss {tot / n:.4f}  train acc {acc:.3f}"
            if Xv is not None and len(Xv):
                msg += f"  val acc {(classifier_forward(P, Xv).argmax(1) == yv).mean():.3f}"
            print(msg)
    return P


# ------------------------------------------------------------------ GRU generator

def init_generator(V, n_intents, rng_np):
    H, E, C = GEN_HIDDEN, GEN_EMB, GEN_INTENT_EMB
    D = E + C
    s = lambda *shape: rng_np.standard_normal(shape).astype(np.float32)
    return {
        "E": s(V, E) * 0.1,
        "C": s(n_intents, C) * 0.1,
        "Wx": s(D, 3 * H) * np.sqrt(1.0 / D),
        "bx": np.zeros(3 * H, dtype=np.float32),
        "Uh": s(H, 3 * H) * np.sqrt(1.0 / H),
        "bh": np.zeros(3 * H, dtype=np.float32),
        "Wy": s(H, V) * np.sqrt(1.0 / H),
        "by": np.zeros(V, dtype=np.float32),
    }


def gru_step(P, x, h):
    H = h.shape[1]
    gx = x @ P["Wx"] + P["bx"]
    gh = h @ P["Uh"] + P["bh"]
    z = sigmoid(gx[:, :H] + gh[:, :H])
    r = sigmoid(gx[:, H:2 * H] + gh[:, H:2 * H])
    n = np.tanh(gx[:, 2 * H:] + r * gh[:, 2 * H:])
    h_new = (1 - z) * n + z * h
    return h_new, (x, h, z, r, n, gh)


def generator_loss_and_grads(P, inp, tgt, mask, cid):
    """inp/tgt/mask: (B, T) ; cid: (B,). Returns loss, grads (full BPTT)."""
    B, T = inp.shape
    H = GEN_HIDDEN
    E = P["E"].shape[1]
    h = np.zeros((B, H), dtype=np.float32)
    cache, probs, hs = [], [], []
    cemb = P["C"][cid]
    for t in range(T):
        x = np.concatenate([P["E"][inp[:, t]], cemb], axis=1)
        h, c = gru_step(P, x, h)
        cache.append(c)
        hs.append(h)
        probs.append(softmax(h @ P["Wy"] + P["by"]))
    ntok = mask.sum()
    loss = 0.0
    g = {k: np.zeros_like(v) for k, v in P.items()}
    dh_next = np.zeros((B, H), dtype=np.float32)
    for t in reversed(range(T)):
        p = probs[t]
        m = mask[:, t]
        loss -= float((np.log(p[np.arange(B), tgt[:, t]] + 1e-9) * m).sum())
        dlog = p.copy()
        dlog[np.arange(B), tgt[:, t]] -= 1
        dlog *= (m / ntok)[:, None]
        g["Wy"] += hs[t].T @ dlog
        g["by"] += dlog.sum(0)
        dh = dlog @ P["Wy"].T + dh_next
        x, hp, z, r, n, gh = cache[t]
        dn = dh * (1 - z)
        dz = dh * (hp - n)
        dh_prev = dh * z
        dan = dn * (1 - n * n)
        dr = dan * gh[:, 2 * H:]
        daz = dz * z * (1 - z)
        dar = dr * r * (1 - r)
        dgx = np.concatenate([daz, dar, dan], axis=1)
        dgh = np.concatenate([daz, dar, dan * r], axis=1)
        g["Wx"] += x.T @ dgx
        g["bx"] += dgx.sum(0)
        g["Uh"] += hp.T @ dgh
        g["bh"] += dgh.sum(0)
        dx = dgx @ P["Wx"].T
        dh_prev += dgh @ P["Uh"].T
        np.add.at(g["E"], inp[:, t], dx[:, :E])
        np.add.at(g["C"], cid, dx[:, E:])
        dh_next = dh_prev
    return loss / ntok, g


def gradient_check():
    """Numerical vs analytic gradients on a tiny GRU, so we KNOW backprop is right."""
    global GEN_HIDDEN, GEN_EMB, GEN_INTENT_EMB
    saved = (GEN_HIDDEN, GEN_EMB, GEN_INTENT_EMB)
    GEN_HIDDEN, GEN_EMB, GEN_INTENT_EMB = 5, 4, 3
    rng_np = np.random.default_rng(0)
    P = {k: v.astype(np.float64) for k, v in init_generator(7, 2, rng_np).items()}
    for k in P:
        P[k] += rng_np.standard_normal(P[k].shape) * 0.1
    inp = rng_np.integers(0, 7, (3, 4))
    tgt = rng_np.integers(0, 7, (3, 4))
    mask = np.array([[1, 1, 1, 1], [1, 1, 0, 0], [1, 1, 1, 0]], dtype=np.float64)
    cid = np.array([0, 1, 1])
    _, g = generator_loss_and_grads(P, inp, tgt, mask, cid)
    worst = 0.0
    for k in P:
        flat = P[k].reshape(-1)
        for i in rng_np.choice(flat.size, min(6, flat.size), replace=False):
            old = flat[i]
            flat[i] = old + 1e-5
            lp, _ = generator_loss_and_grads(P, inp, tgt, mask, cid)
            flat[i] = old - 1e-5
            lm, _ = generator_loss_and_grads(P, inp, tgt, mask, cid)
            flat[i] = old
            num = (lp - lm) / 2e-5
            ana = g[k].reshape(-1)[i]
            worst = max(worst, abs(num - ana) / max(1e-8, abs(num) + abs(ana)))
    GEN_HIDDEN, GEN_EMB, GEN_INTENT_EMB = saved
    print(f"  [gradcheck] worst relative error {worst:.2e}")
    assert worst < 1e-4, "GRU backprop is wrong!"


def build_generator_set(intents, extra):
    tags = [it["tag"] for it in intents]
    seqs = []
    for it in intents:
        for r in it["responses"]:
            seqs.append((tags.index(it["tag"]), gen_tokenize(r)))
    roast = tags.index("roast_me")
    for r in extra:
        seqs.append((roast, gen_tokenize(r)))
    counts = {}
    for _, toks in seqs:
        for tok in toks:
            counts[tok] = counts.get(tok, 0) + 1
    vocab = ["<pad>", "<s>", "</s>"] + sorted(counts)
    return tags, vocab, seqs


def train_generator(tags, vocab, seqs, epochs, rng_np):
    w2i = {w: i for i, w in enumerate(vocab)}
    P = init_generator(len(vocab), len(tags), rng_np)
    opt = Adam(P, lr=3e-3)
    bs = 32
    for ep in range(epochs):
        if ep == int(epochs * 0.7):
            opt.lr = 1e-3
        order = rng_np.permutation(len(seqs))
        tot, nb = 0.0, 0
        for s in range(0, len(order), bs):
            batch = [seqs[i] for i in order[s:s + bs]]
            T = max(len(t) for _, t in batch) + 1
            inp = np.zeros((len(batch), T), dtype=np.int64)
            tgt = np.zeros((len(batch), T), dtype=np.int64)
            mask = np.zeros((len(batch), T), dtype=np.float32)
            for b, (_, toks) in enumerate(batch):
                ids = [w2i[w] for w in toks]
                seq_in = [1] + ids
                seq_out = ids + [2]
                inp[b, :len(seq_in)] = seq_in
                tgt[b, :len(seq_out)] = seq_out
                mask[b, :len(seq_out)] = 1
            cid = np.array([c for c, _ in batch])
            loss, g = generator_loss_and_grads(P, inp, tgt, mask, cid)
            opt.step(g, clip=5.0)
            tot += loss
            nb += 1
        if ep % 10 == 0 or ep == epochs - 1:
            print(f"  [gen] epoch {ep:3d}  loss/token {tot / nb:.4f}")
    return P


def sample(P, vocab, cid, rng_np, temp=0.7):
    h = np.zeros((1, GEN_HIDDEN), dtype=np.float32)
    w, out = 1, []
    for _ in range(MAX_GEN_LEN):
        x = np.concatenate([P["E"][[w]], P["C"][[cid]]], axis=1)
        h, _ = gru_step(P, x, h)
        logits = (h @ P["Wy"] + P["by"])[0] / temp
        p = softmax(logits)
        w = int(rng_np.choice(len(p), p=p))
        if w == 2:
            break
        out.append(vocab[w])
    return gen_detokenize(out)


# ------------------------------------------------------------------ export

def quant(M):
    """int8 quantisation with one scale per row -> ~4x smaller file."""
    M = np.asarray(M, dtype=np.float32)
    if M.ndim == 1:
        return {"shape": list(M.shape), "f": [round(float(v), 5) for v in M]}
    scale = np.abs(M).max(axis=1) / 127.0
    scale[scale == 0] = 1.0
    q = np.clip(np.round(M / scale[:, None]), -127, 127).astype(np.int8)
    return {
        "shape": list(M.shape),
        "scale": [float(f"{s:.6g}") for s in scale],
        "q": base64.b64encode(q.tobytes()).decode("ascii"),
    }


def dequant(d):
    if "f" in d:
        return np.array(d["f"], dtype=np.float32)
    q = np.frombuffer(base64.b64decode(d["q"]), dtype=np.int8).reshape(d["shape"])
    return q.astype(np.float32) * np.array(d["scale"], dtype=np.float32)[:, None]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--cls-epochs", type=int, default=40)
    ap.add_argument("--gen-epochs", type=int, default=150)
    ap.add_argument("--skip-val", action="store_true")
    args = ap.parse_args()

    rng = random.Random(args.seed)
    rng_np = np.random.default_rng(args.seed)
    intents, fillers, extra = load_data()
    t0 = time.time()

    print("== gradient check")
    gradient_check()

    if not args.skip_val:
        print("== classifier: validation run (15% of patterns held out)")
        tags, tr, va = build_classifier_set(intents, fillers, random.Random(args.seed), holdout=0.15)
        X, y = to_matrix(tr)
        Xv, yv = to_matrix(va)
        train_classifier(X, y, len(tags), args.cls_epochs, np.random.default_rng(args.seed), Xv, yv)

    print("== classifier: final run on all patterns")
    cls_tags, tr, _ = build_classifier_set(intents, fillers, rng)
    X, y = to_matrix(tr)
    print(f"  {len(tr)} training examples, {len(cls_tags)} intents")
    CP = train_classifier(X, y, len(cls_tags), args.cls_epochs, rng_np)

    print("== generator (GRU)")
    gen_tags, vocab, seqs = build_generator_set(intents, extra)
    print(f"  {len(seqs)} responses, vocab {len(vocab)}")
    GP = train_generator(gen_tags, vocab, seqs, args.gen_epochs, rng_np)

    model = {
        "format": "brainrot-bot-v1",
        "trained_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "classifier": {
            "feat_dim": FEAT_DIM,
            "tags": cls_tags,
            "W1": quant(CP["W1"].T),  # stored as (hidden, feat) rows for sparse dot
            "b1": quant(CP["b1"]),
            "W2": quant(CP["W2"]),
            "b2": quant(CP["b2"]),
        },
        "generator": {
            "hidden": GEN_HIDDEN,
            "max_len": MAX_GEN_LEN,
            "tags": gen_tags,
            "vocab": vocab,
            **{k: quant(v) for k, v in GP.items()},
        },
        "responses": {it["tag"]: it["responses"] + (extra if it["tag"] == "roast_me" else [])
                      for it in intents},
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(model, f, ensure_ascii=False, separators=(",", ":"))
    print(f"== saved {OUT} ({os.path.getsize(OUT) / 1024:.0f} KB) in {time.time() - t0:.0f}s")

    # sanity: samples from the *quantised* weights (what the browser will run)
    QP = {k: dequant(model["generator"][k]) for k in GP}
    for tag in ["greeting", "insult", "choice", "roast_me", "insult_long", "fallback"]:
        print(f"  {tag:12s} -> {sample(QP, vocab, gen_tags.index(tag), rng_np)}")


if __name__ == "__main__":
    main()
