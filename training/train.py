"""Train the brainrot roast bot from scratch. Pure numpy, no ML framework, no API.

Two neural networks get trained on the files in ../data:

1. Intent classifier  - MLP (hashed bag-of-features 4096 -> 320 ReLU -> softmax).
   Figures out WHAT the user is saying (greeting, insult, choice, search, ...).
   Indonesian slang gets normalised first (data/slang_id.json), so "gk", "ga",
   "nggak" all look the same to the network.
2. Response generator - a small GPT-style TRANSFORMER (training/transformer.py:
   5 layers, 4 attention heads, d=208, causal self-attention, GELU feed-forward).
   It is conditioned on the intent AND the language with prefix tokens
   (<i:insult> <l:id> <s> ...), so it replies in the language you typed in.
   Writes the reply word by word.

Both are trained with hand-written backprop + Adam and exported (int8
quantised) to ../model/brain.json. The grammar checker's word lists go to
../model/lexicon.json. The website runs everything in the browser.

Usage:  python training/train.py  [--seed 7] [--gen-epochs 90] [--skip-val]
"""
import argparse
import base64
import json
import os
import random
import re
import time

import numpy as np

import transformer as tfm
from textproc import (featurize, gen_tokenize, gen_detokenize, normalize, response_lang,
                      SLANG_MAP, ID_MARKERS, EMOJI_WORDS)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(ROOT, "model", "brain.json")
LEX_OUT = os.path.join(ROOT, "model", "lexicon.json")

FEAT_DIM = 4096
CLS_HIDDEN = 320
GEN_D = 208
GEN_LAYERS = 5
GEN_HEADS = 4
GEN_DROPOUT = 0.15
GEN_REPEAT = 6                 # hand-written replies per epoch (the roast corpus is seen once)
MAX_GEN_LEN = 48
GEN_CTX = MAX_GEN_LEN + 4      # <i:tag> <l:lang> <s> ... </s>
LANGS = ["en", "id"]


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
NOISE_PRE = ["bro", "yo", "eh", "woy", "lol", "ngl", "anjir", "hmm", "jujur", "fr", "bang", "eh bang", "cuy", "jir", "btw", "oi"]
NOISE_POST = ["bro", "lol", "pls", "dong", "sih", "deh", "fr", "bang", "ya", "?", "!!", "wkwk", "😭", "💀", "cuy", "nih",
              "tuh", "anjir", "bjir", "gak sih", "kan", "lah", "loh", "ngab", "ges", "gais", "plis", "😂", "🥀"]
# swap a word for a common chat spelling, so the net sees real-world variants
CHAT_SPELLING = {"gak": ["ga", "gk", "nggak", "engga", "kagak"], "banget": ["bgt", "bngt", "bet"], "yang": ["yg"],
                 "udah": ["udh", "dah", "sudah"], "kamu": ["lu", "lo", "km", "elu"], "aku": ["gw", "gue", "gua", "w", "aq"],
                 "lagi": ["lg"], "kenapa": ["knp", "napa"], "gimana": ["gmn", "gimna"], "tahu": ["tau"], "kalau": ["kalo", "klo"],
                 "lu": ["lo", "elu", "km", "kamu"], "gw": ["gue", "aku", "gua", "w"], "sama": ["sm", "ama"], "dong": ["donk"],
                 "you": ["u"], "your": ["ur"], "are": ["r"], "please": ["pls", "plz"], "the": ["da"], "what": ["wat", "wut"]}


def fill_slots(pattern, fillers, rng):
    def rep(m):
        key = m.group(1)
        return rng.choice(fillers[key]) if key in fillers else m.group(0)
    return SLOT_RE.sub(rep, pattern)


def noisy(text, rng):
    words = text.split()
    for i, w in enumerate(words):
        if w in CHAT_SPELLING and rng.random() < 0.5:
            words[i] = rng.choice(CHAT_SPELLING[w])
    r = rng.random()
    if r < 0.15 and len(words) > 2:
        del words[rng.randrange(len(words))]
    elif r < 0.35:
        # keyboard-ish typo: duplicate, swap or drop a char inside one word
        i = rng.randrange(len(words))
        w = words[i]
        if len(w) > 3:
            j = rng.randrange(1, len(w) - 1)
            k = rng.random()
            if k < 0.33:
                w = w[:j] + w[j] + w[j:]
            elif k < 0.66:
                w = w[:j - 1] + w[j] + w[j - 1] + w[j + 1:]
            else:
                w = w[:j] + w[j + 1:]
            words[i] = w
    if rng.random() < 0.1:
        words = [w.upper() for w in words]
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
        for _ in range(per_pattern * 30):
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


def load_eval_set(tags):
    path = os.path.join(ROOT, "tests", "eval_set.json")
    if not os.path.exists(path):
        return None, None
    rows = [(t, tags.index(l)) for t, l in json.load(open(path, encoding="utf-8")) if l in tags]
    return to_matrix(rows)


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


def train_classifier(X, y, n_classes, epochs, rng_np, evals=(), log=True):
    P = init_classifier(n_classes, rng_np)
    opt = Adam(P, lr=2e-3)
    smooth, drop, wd, bs = 0.05, 0.35, 1e-5, 64
    n = len(X)
    for ep in range(epochs):
        if ep == int(epochs * 0.75):
            opt.lr = 5e-4
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
            for name, Xe, ye in evals:
                if Xe is not None and len(Xe):
                    msg += f"  {name} acc {(classifier_forward(P, Xe).argmax(1) == ye).mean():.3f}"
            print(msg)
    return P


# ------------------------------------------------------------------ transformer generator (training/transformer.py)

def roast_corpus(rng, per_lang=3000):
    """thousands of different roasts built from parts (data/roast_parts.json), so the transformer
    learns how a roast is put together and can write NEW ones instead of repeating 800 lines"""
    path = os.path.join(DATA, "roast_parts.json")
    if not os.path.exists(path):
        return []
    parts = json.load(open(path, encoding="utf-8"))
    out = []
    for lang in LANGS:
        P = parts[lang]
        for kind, n in (("patterns", per_lang), ("comeback", per_lang // 2)):
            tag = "roast_me" if kind == "patterns" else "insult"
            seen = set()
            for _ in range(n * 3):
                if len(seen) >= n:
                    break
                line = rng.choice(P[kind])
                line = line.replace("{S}", rng.choice(P["subject"]), 1).replace("{L}", rng.choice(P["like"]), 1)
                line = line.replace("{T}", rng.choice(P["then"]), 1).replace("{A}", rng.choice(P["adj"]), 1)
                line = line.replace("{S}", rng.choice(P["subject"])).replace("{L}", rng.choice(P["like"])).replace("{A}", rng.choice(P["adj"]))
                if lang == "en":
                    line = re.sub(r"\bu is\b", "u are", line)
                if line not in seen:
                    seen.add(line)
                    out.append((tag, lang, line))
            # comebacks are roasts too
            if kind == "patterns":
                for line in list(seen)[: per_lang // 4]:
                    out.append(("insult", lang, line))
    return out


def build_generator_set(intents, extra, rng=None):
    tags = [it["tag"] for it in intents]
    seqs = []
    for it in intents:
        lines = it["responses"] + (extra if it["tag"] == "roast_me" else [])
        for r in lines:
            seqs.append((tags.index(it["tag"]), LANGS.index(response_lang(r)), gen_tokenize(r)[:MAX_GEN_LEN]))
    seqs = seqs * GEN_REPEAT     # the hand-written lines are seen several times per epoch
    if rng is not None:
        for tag, lang, line in roast_corpus(rng):
            seqs.append((tags.index(tag), LANGS.index(lang), gen_tokenize(line)[:MAX_GEN_LEN]))
    counts = {}
    for _, _, toks in seqs:
        for tok in toks:
            counts[tok] = counts.get(tok, 0) + 1
    # 0..2 stay <pad> <s> </s>; then one token per intent and per language (the conditioning prefix)
    vocab = ["<pad>", "<s>", "</s>"] + ["<i:" + t + ">" for t in tags] + ["<l:" + l + ">" for l in LANGS] + sorted(counts)
    return tags, vocab, seqs


def prefix_ids(vocab, tag, lang):
    return [vocab.index("<i:" + tag + ">"), vocab.index("<l:" + lang + ">"), 1]


def train_generator(tags, vocab, seqs, epochs, rng_np):
    w2i = {w: i for i, w in enumerate(vocab)}
    P = tfm.init(len(vocab), GEN_CTX, GEN_D, GEN_LAYERS, rng_np)
    opt = Adam(P, lr=1e-3, b2=0.98)
    bs = 32
    steps = epochs * ((len(seqs) + bs - 1) // bs)
    warm = max(1, steps // 30)
    step = 0
    t0 = time.time()
    for ep in range(epochs):
        # batches of similar length (less padding), in random order
        order = sorted(rng_np.permutation(len(seqs)), key=lambda i: len(seqs[i][2]) + rng_np.random() * 3)
        chunks = [order[i:i + bs] for i in range(0, len(order), bs)]
        tot, nb = 0.0, 0
        for ci in rng_np.permutation(len(chunks)):
            batch = [seqs[i] for i in chunks[ci]]
            T = max(len(t) for _, _, t in batch) + 3
            inp = np.zeros((len(batch), T), dtype=np.int64)
            tgt = np.zeros((len(batch), T), dtype=np.int64)
            mask = np.zeros((len(batch), T), dtype=np.float32)
            for b, (c, l, toks) in enumerate(batch):
                ids = prefix_ids(vocab, tags[c], LANGS[l]) + [w2i[w] for w in toks] + [2]
                inp[b, :len(ids) - 1] = ids[:-1]
                tgt[b, :len(ids) - 1] = ids[1:]
                mask[b, 2:len(ids) - 1] = 1          # learn the reply, not the prefix
            # warmup, then cosine decay
            opt.lr = 1e-3 * min(1.0, (step + 1) / warm) * (0.1 + 0.9 * 0.5 * (1 + np.cos(np.pi * min(1.0, step / steps))))
            loss, g = tfm.loss_and_grads(P, inp, tgt, mask, GEN_HEADS, GEN_DROPOUT, rng_np)
            opt.step(g, clip=1.0)
            step += 1
            tot += loss
            nb += 1
        if ep % 10 == 0 or ep == epochs - 1:
            print(f"  [gen] epoch {ep:3d}  loss/token {tot / nb:.4f}  lr {opt.lr:.2e}  ({time.time() - t0:.0f}s)", flush=True)
    return P


def sample(P, vocab, tag, lang, rng_np, temp=0.7):
    ids = prefix_ids(vocab, tag, lang)
    n_special = sum(1 for w in vocab if w.startswith("<i:") or w.startswith("<l:"))
    out = []
    for _ in range(MAX_GEN_LEN):
        z = tfm.next_logits(P, ids, GEN_HEADS) / temp
        z[0] = z[1] = -1e9
        z[3:3 + n_special] = -1e9          # never write a prefix token
        p = tfm.softmax(z)
        w = int(rng_np.choice(len(p), p=p))
        if w == 2:
            break
        ids.append(w)
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


def build_lexicon(intents, fillers, extra):
    """Word lists + rules for the grammar roaster (assets/js/grammar.js)."""
    lex = {}
    for lang in LANGS:
        with open(os.path.join(DATA, "lexicon", lang + ".txt"), encoding="utf-8") as f:
            lex[lang] = " ".join(w.strip() for w in f if w.strip())
    with open(os.path.join(DATA, "grammar_rules.json"), encoding="utf-8") as f:
        rules = {k: v for k, v in json.load(f).items() if not k.startswith("_")}
    known = set(rules.pop("ignore"))
    known.update(SLANG_MAP.keys())
    texts = [p for it in intents for p in it["patterns"] + it["responses"]] + extra
    texts += [v for vals in fillers.values() for v in vals]
    for t in texts:
        known.update(re.findall(r"[a-z]+", re.sub(r"\{\w+\}", " ", t.lower())))
    # never let a rule's *wrong* spelling sneak into the whitelist via the training data
    known -= {w for w, r in rules["words"].items() if r}
    lex["known"] = " ".join(sorted(known))
    lex["rules"] = rules
    with open(LEX_OUT, "w", encoding="utf-8") as f:
        json.dump(lex, f, ensure_ascii=False, separators=(",", ":"))
    print(f"== saved {LEX_OUT} ({os.path.getsize(LEX_OUT) / 1024:.0f} KB)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--cls-epochs", type=int, default=30)
    ap.add_argument("--gen-epochs", type=int, default=12)
    ap.add_argument("--skip-val", action="store_true")
    ap.add_argument("--cls-only", action="store_true")
    args = ap.parse_args()

    rng = random.Random(args.seed)
    rng_np = np.random.default_rng(args.seed)
    intents, fillers, extra = load_data()
    t0 = time.time()

    print("== gradient check")
    tfm.gradient_check()

    if not args.skip_val:
        print("== classifier: validation run (15% of patterns held out + tests/eval_set.json)")
        tags, tr, va = build_classifier_set(intents, fillers, random.Random(args.seed), holdout=0.15)
        X, y = to_matrix(tr)
        Xv, yv = to_matrix(va)
        Xe, ye = load_eval_set(tags)
        train_classifier(X, y, len(tags), args.cls_epochs, np.random.default_rng(args.seed),
                         [("heldout", Xv, yv), ("eval", Xe, ye)])

    print("== classifier: final run on all patterns")
    cls_tags, tr, _ = build_classifier_set(intents, fillers, rng)
    X, y = to_matrix(tr)
    Xe, ye = load_eval_set(cls_tags)
    print(f"  {len(tr)} training examples, {len(cls_tags)} intents")
    CP = train_classifier(X, y, len(cls_tags), args.cls_epochs, rng_np, [("eval", Xe, ye)])
    if args.cls_only:
        return

    print("== generator (transformer)")
    gen_tags, vocab, seqs = build_generator_set(intents, extra, random.Random(args.seed + 1))
    n_id = sum(1 for _, l, _ in seqs if LANGS[l] == "id")
    print(f"  {len(seqs)} responses ({n_id} indonesian), vocab {len(vocab)}")
    GP = train_generator(gen_tags, vocab, seqs, args.gen_epochs, rng_np)

    model = {
        "format": "brainrot-bot-v2",
        "trained_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "text": {"slang": SLANG_MAP, "markers": sorted(ID_MARKERS)},
        "classifier": {
            "feat_dim": FEAT_DIM,
            "tags": cls_tags,
            "W1": quant(CP["W1"].T),  # stored as (hidden, feat) rows for sparse dot
            "b1": quant(CP["b1"]),
            "W2": quant(CP["W2"]),
            "b2": quant(CP["b2"]),
        },
        "generator": {
            "type": "transformer",
            "d": GEN_D,
            "layers": GEN_LAYERS,
            "heads": GEN_HEADS,
            "ctx": GEN_CTX,
            "max_len": MAX_GEN_LEN,
            "tags": gen_tags,
            "langs": LANGS,
            "vocab": vocab,
            **{k: quant(v) for k, v in GP.items()},
        },
        "responses": {it["tag"]: it["responses"] + (extra if it["tag"] == "roast_me" else [])
                      for it in intents},
        # one filled-in example per pattern, for nearest-neighbour lookups in experimental mode
        "examples": {it["tag"]: sorted({fill_slots(p, fillers, random.Random(i)) for i, p in enumerate(it["patterns"])})
                     for it in intents if it["patterns"]},
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(model, f, ensure_ascii=False, separators=(",", ":"))
    print(f"== saved {OUT} ({os.path.getsize(OUT) / 1024:.0f} KB) in {time.time() - t0:.0f}s")
    build_lexicon(intents, fillers, extra)

    # sanity: samples from the *quantised* weights (what the browser will run)
    QP = {k: dequant(model["generator"][k]) for k in GP}
    for tag in ["greeting", "insult", "choice", "roast_me", "search", "grammar"]:
        for lang in LANGS:
            print(f"  {tag:10s} {lang} -> {sample(QP, vocab, tag, lang, rng_np)}")


if __name__ == "__main__":
    main()
