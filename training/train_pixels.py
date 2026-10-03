"""Train sybau's tiny pixel-art generator (beta). Pure numpy, from scratch.

Model: a decoder MLP  z(12) -> 128 ReLU -> 128 ReLU -> 16x16 pixels x 20 colours.
Training: "GLO" (generative latent optimisation) - every training sprite gets its
own learnable latent code z, optimised together with the decoder. No encoder
needed. Afterwards:
  - draw "cat"         -> decode the cat's codes + a little noise (new variations)
  - draw "cat fire"    -> decode a mix of the cat and fire codes
  - learn an upload    -> the browser optimises a new z for the uploaded image

Data: data/sprites.txt (16x16 sprites as text). Output: model/pixels.json

Usage: python training/train_pixels.py [--epochs 1500]
"""
import argparse
import base64
import json
import os
import re
import time

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data", "sprites.txt")
OUT = os.path.join(ROOT, "model", "pixels.json")
SIZE = 16
ZDIM = 12
H1 = H2 = 128


def load_sprites():
    txt = open(SRC, encoding="utf-8").read()
    palette = []
    for m in re.finditer(r"([.a-zA-Z]) (#[0-9a-f]{6}|transparan)", txt):
        palette.append((m.group(1), None if m.group(2) == "transparan" else m.group(2)))
    chars = [c for c, _ in palette]
    sprites = []
    for block in re.split(r"^=== ", txt, flags=re.M)[1:]:
        lines = block.strip("\n").split("\n")
        name, _, words = lines[0].partition("|")
        rows = [l for l in lines[1:] if l.strip()][:SIZE]
        grid = np.array([[chars.index(ch) for ch in row] for row in rows], dtype=np.int64)
        assert grid.shape == (SIZE, SIZE), name
        sprites.append({"name": name.strip(), "words": words.split(), "grid": grid})
    return palette, sprites


def augment(grid):
    """original, mirrored, and 1px shifts (only when the shifted-out edge is empty)."""
    out = [grid, grid[:, ::-1]]
    for g in list(out):
        for dy, dx in [(0, 1), (0, -1), (1, 0), (-1, 0)]:
            s = np.roll(g, (dy, dx), axis=(0, 1))
            # reject if something wrapped around
            wrapped = (dy == 1 and g[-1].any()) or (dy == -1 and g[0].any()) or \
                      (dx == 1 and g[:, -1].any()) or (dx == -1 and g[:, 0].any())
            if not wrapped:
                out.append(s)
    return out


def relu(x):
    return np.maximum(0, x)


def softmax(z):
    z = z - z.max(axis=-1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=-1, keepdims=True)


def quant(M):
    M = np.asarray(M, dtype=np.float32)
    if M.ndim == 1:
        return {"shape": list(M.shape), "f": [round(float(v), 5) for v in M]}
    scale = np.abs(M).max(axis=1) / 127.0
    scale[scale == 0] = 1.0
    q = np.clip(np.round(M / scale[:, None]), -127, 127).astype(np.int8)
    return {"shape": list(M.shape), "scale": [float(f"{s:.6g}") for s in scale],
            "q": base64.b64encode(q.tobytes()).decode("ascii")}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=1500)
    ap.add_argument("--seed", type=int, default=3)
    args = ap.parse_args()
    rng = np.random.default_rng(args.seed)
    palette, sprites = load_sprites()
    C = len(palette)
    imgs, owner = [], []
    for si, s in enumerate(sprites):
        for g in augment(s["grid"]):
            imgs.append(g.reshape(-1))
            owner.append(si)
    Y = np.array(imgs)                      # (N, 256) colour index per pixel
    N, P = Y.shape
    print(f"{len(sprites)} sprites -> {N} training images, {C} colours")

    s = lambda *sh: rng.standard_normal(sh).astype(np.float32)
    params = {
        "Z": s(N, ZDIM) * 0.3,
        "W1": s(ZDIM, H1) * np.sqrt(2 / ZDIM), "b1": np.zeros(H1, np.float32),
        "W2": s(H1, H2) * np.sqrt(2 / H1), "b2": np.zeros(H2, np.float32),
        "W3": s(H2, P * C) * np.sqrt(1 / H2), "b3": np.zeros(P * C, np.float32),
    }
    # prior on colours (mostly transparent) so the output starts sane
    freq = np.bincount(Y.reshape(-1), minlength=C) + 1.0
    params["b3"] = np.tile(np.log(freq / freq.sum()), P).astype(np.float32)
    m = {k: np.zeros_like(v) for k, v in params.items()}
    v = {k: np.zeros_like(v) for k, v in params.items()}
    lr, bs, t = 2e-3, 32, 0
    t0 = time.time()
    for ep in range(args.epochs):
        order = rng.permutation(N)
        tot = 0.0
        for st in range(0, N, bs):
            idx = order[st:st + bs]
            B = len(idx)
            z = params["Z"][idx] + rng.standard_normal((B, ZDIM)).astype(np.float32) * 0.15  # smooth latent space
            a1 = z @ params["W1"] + params["b1"]; h1 = relu(a1)
            a2 = h1 @ params["W2"] + params["b2"]; h2 = relu(a2)
            logits = (h2 @ params["W3"] + params["b3"]).reshape(B, P, C)
            p = softmax(logits)
            y = Y[idx]
            tot += float(-np.log(p[np.arange(B)[:, None], np.arange(P)[None, :], y] + 1e-9).sum())
            d = p
            d[np.arange(B)[:, None], np.arange(P)[None, :], y] -= 1
            d = d.reshape(B, P * C) / (B * P)
            g = {"W3": h2.T @ d, "b3": d.sum(0)}
            dh2 = (d @ params["W3"].T) * (a2 > 0)
            g["W2"] = h1.T @ dh2; g["b2"] = dh2.sum(0)
            dh1 = (dh2 @ params["W2"].T) * (a1 > 0)
            g["W1"] = z.T @ dh1; g["b1"] = dh1.sum(0)
            gz = dh1 @ params["W1"].T + 1e-3 * params["Z"][idx]   # small L2 prior on codes
            gZ = np.zeros_like(params["Z"]); gZ[idx] = gz * B     # per-code gradient (not batch-averaged)
            g["Z"] = gZ
            t += 1
            for k in params:
                m[k] = 0.9 * m[k] + 0.1 * g[k]
                v[k] = 0.999 * v[k] + 0.001 * g[k] * g[k]
                params[k] -= (lr * 3 if k == "Z" else lr) * (m[k] / (1 - 0.9 ** t)) / (np.sqrt(v[k] / (1 - 0.999 ** t)) + 1e-8)
        if ep % 100 == 0 or ep == args.epochs - 1:
            # pixel accuracy without noise
            h = relu(relu(params["Z"] @ params["W1"] + params["b1"]) @ params["W2"] + params["b2"])
            pred = (h @ params["W3"] + params["b3"]).reshape(N, P, C).argmax(-1)
            print(f"  epoch {ep:4d}  loss/pixel {tot / (N * P):.4f}  pixel acc {(pred == Y).mean():.3f}  ({time.time() - t0:.0f}s)", flush=True)

    Z = params["Z"]
    labels = []
    for si, sp in enumerate(sprites):
        codes = Z[[i for i in range(N) if owner[i] == si]]
        labels.append({"name": sp["name"], "words": [sp["name"]] + sp["words"],
                       "z": [[round(float(x), 4) for x in row] for row in codes]})
    model = {
        "format": "sybau-pixels-v1", "size": SIZE, "zdim": ZDIM,
        "palette": [{"ch": c, "hex": h} for c, h in palette],
        "labels": labels,
        **{k: quant(params[k]) for k in ["W1", "b1", "W2", "b2", "W3", "b3"]},
        "trained_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(model, f, separators=(",", ":"))
    print(f"== saved {OUT} ({os.path.getsize(OUT) / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
