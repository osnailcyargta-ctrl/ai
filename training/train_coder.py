"""Train sybau code's request reader. Pure numpy, from scratch.

A multi-label MLP: hashed features (same as the chat classifier, 4096) -> 256 ReLU
-> one sigmoid per STS program feature (clicker, maze, quiz, dodge, ...). It reads
a request like "bikinin game hindarin meteor pake 3 nyawa" and says which building
blocks the program needs. assets/js/stscoder.js then writes the STS code from those
blocks and checks it with the real STS compiler.

Data: data/sts/requests.json. Output: model/coder.json
Usage: python training/train_coder.py [--epochs 40]
"""
import argparse
import json
import os
import random
import time

import numpy as np

from textproc import featurize
from train import quant, noisy, FEAT_DIM

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data", "sts", "requests.json")
OUT = os.path.join(ROOT, "model", "coder.json")
HIDDEN = 256


def build(data, rng, n=24000):
    feats = list(data["features"])
    X, Y = [], []
    for _ in range(n):
        k = rng.choice([1, 1, 2, 2, 3])
        chosen = rng.sample(feats, k)
        parts = [rng.choice(data["features"][f]) for f in chosen]
        text = parts[0]
        for p in parts[1:]:
            text += rng.choice(data["joiners"]) + p
        if rng.random() < 0.7:
            text = rng.choice(data["openers"]) + " " + text
        if rng.random() < 0.4:
            text = noisy(text, rng)
        X.append(text)
        Y.append([1.0 if f in chosen else 0.0 for f in feats])
    # plain chatter -> no features (so random words don't light everything up)
    for t in ["halo", "apa kabar", "lu siapa", "makasih", "ok", "hmm", "test", "lu bego", "wkwk", "gimana caranya", "jelasin dong", "bye"]:
        for _ in range(30):
            X.append(noisy(t, rng))
            Y.append([0.0] * len(feats))
    return feats, X, np.array(Y, dtype=np.float32)


def to_matrix(texts):
    M = np.zeros((len(texts), FEAT_DIM), dtype=np.float32)
    for i, t in enumerate(texts):
        for k, v in featurize(t, FEAT_DIM).items():
            M[i, k] = v
    return M


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--seed", type=int, default=11)
    args = ap.parse_args()
    rng = random.Random(args.seed)
    nrng = np.random.default_rng(args.seed)
    data = json.load(open(SRC, encoding="utf-8"))
    feats, texts, Y = build(data, rng)
    X = to_matrix(texts)
    print(f"{len(texts)} examples, {len(feats)} features")
    F = len(feats)
    P = {"W1": (nrng.standard_normal((FEAT_DIM, HIDDEN)) * np.sqrt(2 / 40)).astype(np.float32), "b1": np.zeros(HIDDEN, np.float32),
         "W2": (nrng.standard_normal((HIDDEN, F)) * np.sqrt(1 / HIDDEN)).astype(np.float32), "b2": np.full(F, -2.0, np.float32)}
    m = {k: np.zeros_like(v) for k, v in P.items()}
    v = {k: np.zeros_like(v) for k, v in P.items()}
    lr, bs, t, drop = 2e-3, 64, 0, 0.3
    n = len(X)
    t0 = time.time()
    for ep in range(args.epochs):
        idx = nrng.permutation(n)
        tot = 0.0
        for s in range(0, n, bs):
            b = idx[s:s + bs]
            xb, yb = X[b], Y[b]
            a1 = xb @ P["W1"] + P["b1"]; h = np.maximum(0, a1)
            mask = (nrng.random(h.shape) > drop).astype(np.float32) / (1 - drop)
            hd = h * mask
            z = hd @ P["W2"] + P["b2"]
            p = 1 / (1 + np.exp(-z))
            tot += float(-(yb * np.log(p + 1e-9) + (1 - yb) * np.log(1 - p + 1e-9)).sum())
            dz = (p - yb) / len(b)
            g = {"W2": hd.T @ dz, "b2": dz.sum(0)}
            dh = (dz @ P["W2"].T) * mask * (a1 > 0)
            g["W1"] = xb.T @ dh; g["b1"] = dh.sum(0)
            t += 1
            for k in P:
                m[k] = 0.9 * m[k] + 0.1 * g[k]
                v[k] = 0.999 * v[k] + 0.001 * g[k] * g[k]
                P[k] -= lr * (m[k] / (1 - 0.9 ** t)) / (np.sqrt(v[k] / (1 - 0.999 ** t)) + 1e-8)
        if ep % 5 == 0 or ep == args.epochs - 1:
            pr = 1 / (1 + np.exp(-(np.maximum(0, X[:3000] @ P["W1"] + P["b1"]) @ P["W2"] + P["b2"])))
            exact = ((pr > 0.5) == (Y[:3000] > 0.5)).all(1).mean()
            print(f"  epoch {ep:3d}  bce {tot / n:.4f}  exact-match {exact:.3f}  ({time.time() - t0:.0f}s)", flush=True)
    model = {"format": "sybau-coder-v1", "feat_dim": FEAT_DIM, "features": feats,
             "W1": quant(P["W1"].T), "b1": quant(P["b1"]), "W2": quant(P["W2"]), "b2": quant(P["b2"]),
             "trained_at": time.strftime("%Y-%m-%d %H:%M:%S")}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(model, f, separators=(",", ":"))
    print(f"== saved {OUT} ({os.path.getsize(OUT) / 1024:.0f} KB), params {FEAT_DIM * HIDDEN + HIDDEN + HIDDEN * F + F:,}")


if __name__ == "__main__":
    main()
