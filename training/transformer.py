"""A small GPT-style transformer, written from scratch in numpy (forward + hand-written backprop).

Decoder-only, pre-LayerNorm:
    x = tok_emb[token] + pos_emb[position]
    repeat N times:
        x = x + Attention(LN(x))      multi-head, causal (a word only sees the words before it)
        x = x + FFN(LN(x))            d -> 4d (GELU) -> d
    logits = LN(x) @ Wy + by

The reply is conditioned on WHAT to say and in WHICH language with prefix tokens:
    <i:roast_me> <l:id> <s> aura lu kayak nasi basi ... </s>
Only the reply tokens are trained on (the loss mask skips the prefix).
assets/js/brain.js runs the exact same maths in the browser (tests/parity.py checks it).
"""
import numpy as np

GELU_C = float(np.sqrt(2.0 / np.pi))   # a python float, so float32 arrays stay float32


def init(V, T, d, layers, rng, ff_mult=4):
    s = lambda *shape: rng.standard_normal(shape).astype(np.float32)
    P = {"E": s(V, d) * 0.02, "Pos": s(T, d) * 0.02, "gf": np.ones(d, np.float32), "bf": np.zeros(d, np.float32),
         "Wy": s(d, V) * 0.02, "by": np.zeros(V, np.float32)}
    for l in range(layers):
        P[f"g1_{l}"] = np.ones(d, np.float32); P[f"b1_{l}"] = np.zeros(d, np.float32)
        P[f"Wqkv_{l}"] = s(d, 3 * d) * 0.02; P[f"bqkv_{l}"] = np.zeros(3 * d, np.float32)
        P[f"Wo_{l}"] = s(d, d) * (0.02 / float(np.sqrt(2 * layers))); P[f"bo_{l}"] = np.zeros(d, np.float32)
        P[f"g2_{l}"] = np.ones(d, np.float32); P[f"b2_{l}"] = np.zeros(d, np.float32)
        P[f"W1_{l}"] = s(d, ff_mult * d) * 0.02; P[f"c1_{l}"] = np.zeros(ff_mult * d, np.float32)
        P[f"W2_{l}"] = s(ff_mult * d, d) * (0.02 / float(np.sqrt(2 * layers))); P[f"c2_{l}"] = np.zeros(d, np.float32)
    return P


def n_layers(P):
    return sum(1 for k in P if k.startswith("Wqkv_"))


def layernorm(x, g, b, eps=1e-5):
    mu = x.mean(-1, keepdims=True)
    var = ((x - mu) ** 2).mean(-1, keepdims=True)
    rstd = 1.0 / np.sqrt(var + eps)
    xhat = (x - mu) * rstd
    return xhat * g + b, (xhat, rstd)


def layernorm_back(dy, g, cache):
    xhat, rstd = cache
    dg = (dy * xhat).reshape(-1, xhat.shape[-1]).sum(0)
    db = dy.reshape(-1, dy.shape[-1]).sum(0)
    dxhat = dy * g
    dx = rstd * (dxhat - dxhat.mean(-1, keepdims=True) - xhat * (dxhat * xhat).mean(-1, keepdims=True))
    return dx, dg, db


def gelu(u):
    t = np.tanh(GELU_C * (u + 0.044715 * u ** 3))
    return 0.5 * u * (1 + t), t


def gelu_back(du, u, t):
    return du * (0.5 * (1 + t) + 0.5 * u * (1 - t * t) * GELU_C * (1 + 3 * 0.044715 * u * u))


def lin(x, W, b=None):
    """x (..., n) @ W (n, m) as one 2-D matmul (much faster than numpy's batched 3-D path)"""
    y = x.reshape(-1, x.shape[-1]) @ W
    if b is not None:
        y += b
    return y.reshape(*x.shape[:-1], W.shape[1])


def bmm(a, b):
    """batched matmul (B, H, n, k) @ (B, H, k, m) as a loop of 2-D BLAS calls (numpy's 4-D path is ~8x slower here)"""
    B, H = a.shape[:2]
    a3 = a.reshape(B * H, *a.shape[2:])
    b3 = np.ascontiguousarray(b).reshape(B * H, *b.shape[2:])
    out = np.empty((B * H, a.shape[2], b.shape[3]), dtype=a.dtype)
    for i in range(B * H):
        np.matmul(a3[i], b3[i], out=out[i])
    return out.reshape(B, H, a.shape[2], b.shape[3])


def softmax(z):
    z = z - z.max(-1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(-1, keepdims=True)


def loss_and_grads(P, inp, tgt, mask, heads, drop=0.0, rng=None, act="gelu"):
    """inp/tgt/mask: (B, T). Returns mean loss per masked token and grads for every parameter."""
    B, T = inp.shape
    d = P["E"].shape[1]
    hd = d // heads
    L = n_layers(P)
    causal = np.triu(np.full((T, T), -1e9, dtype=P["E"].dtype), 1)
    x = P["E"][inp] + P["Pos"][:T][None]
    caches = []
    for l in range(L):
        c = {}
        h, c["ln1"] = layernorm(x, P[f"g1_{l}"], P[f"b1_{l}"])
        qkv = lin(h, P[f"Wqkv_{l}"], P[f"bqkv_{l}"])
        q, k, v = [np.ascontiguousarray(qkv[..., i * d:(i + 1) * d].reshape(B, T, heads, hd).transpose(0, 2, 1, 3)) for i in range(3)]
        a = softmax(bmm(q, k.transpose(0, 1, 3, 2)) * (1.0 / float(np.sqrt(hd))) + causal)
        y = bmm(a, v).transpose(0, 2, 1, 3).reshape(B, T, d)
        o = lin(y, P[f"Wo_{l}"], P[f"bo_{l}"])
        m1 = (rng.random(o.shape) > drop).astype(o.dtype) / (1 - drop) if drop > 0 else None
        x = x + (o * m1 if m1 is not None else o)
        h2, c["ln2"] = layernorm(x, P[f"g2_{l}"], P[f"b2_{l}"])
        u = lin(h2, P[f"W1_{l}"], P[f"c1_{l}"])
        gu, t = gelu(u) if act == "gelu" else (np.maximum(u, 0), None)
        f = lin(gu, P[f"W2_{l}"], P[f"c2_{l}"])
        m2 = (rng.random(f.shape) > drop).astype(f.dtype) / (1 - drop) if drop > 0 else None
        x = x + (f * m2 if m2 is not None else f)
        c.update(h=h, q=q, k=k, v=v, a=a, y=y, m1=m1, h2=h2, u=u, t=t, gu=gu, m2=m2)
        caches.append(c)
    hf, lnf = layernorm(x, P["gf"], P["bf"])
    logits = lin(hf, P["Wy"], P["by"])
    p = softmax(logits)
    ntok = mask.sum()
    bi, ti = np.meshgrid(np.arange(B), np.arange(T), indexing="ij")
    loss = -float((np.log(p[bi, ti, tgt] + 1e-9) * mask).sum()) / ntok

    g = {}
    dlog = p
    dlog[bi, ti, tgt] -= 1
    dlog *= (mask / ntok)[..., None]
    g["Wy"] = hf.reshape(-1, d).T @ dlog.reshape(-1, dlog.shape[-1])
    g["by"] = dlog.reshape(-1, dlog.shape[-1]).sum(0)
    dx, g["gf"], g["bf"] = layernorm_back(lin(dlog, np.ascontiguousarray(P["Wy"].T)), P["gf"], lnf)
    for l in reversed(range(L)):
        c = caches[l]
        df = dx * c["m2"] if c["m2"] is not None else dx
        g[f"W2_{l}"] = c["gu"].reshape(-1, c["gu"].shape[-1]).T @ df.reshape(-1, d)
        g[f"c2_{l}"] = df.reshape(-1, d).sum(0)
        dgu = lin(df, np.ascontiguousarray(P[f"W2_{l}"].T))
        du = gelu_back(dgu, c["u"], c["t"]) if act == "gelu" else dgu * (c["u"] > 0)
        g[f"W1_{l}"] = c["h2"].reshape(-1, d).T @ du.reshape(-1, du.shape[-1])
        g[f"c1_{l}"] = du.reshape(-1, du.shape[-1]).sum(0)
        dh2, g[f"g2_{l}"], g[f"b2_{l}"] = layernorm_back(lin(du, np.ascontiguousarray(P[f"W1_{l}"].T)), P[f"g2_{l}"], c["ln2"])
        dx = dx + dh2
        do = dx * c["m1"] if c["m1"] is not None else dx
        g[f"Wo_{l}"] = c["y"].reshape(-1, d).T @ do.reshape(-1, d)
        g[f"bo_{l}"] = do.reshape(-1, d).sum(0)
        dy = np.ascontiguousarray(lin(do, np.ascontiguousarray(P[f"Wo_{l}"].T)).reshape(B, T, heads, hd).transpose(0, 2, 1, 3))
        a, q, k, v = c["a"], c["q"], c["k"], c["v"]
        dv = bmm(a.transpose(0, 1, 3, 2), dy)
        da = bmm(dy, v.transpose(0, 1, 3, 2))
        ds = (da - (da * a).sum(-1, keepdims=True)) * a * (1.0 / float(np.sqrt(hd)))
        dq = bmm(ds, k)
        dk = bmm(ds.transpose(0, 1, 3, 2), q)
        dqkv = np.concatenate([z.transpose(0, 2, 1, 3).reshape(B, T, d) for z in (dq, dk, dv)], axis=-1)
        g[f"Wqkv_{l}"] = c["h"].reshape(-1, d).T @ dqkv.reshape(-1, 3 * d)
        g[f"bqkv_{l}"] = dqkv.reshape(-1, 3 * d).sum(0)
        dh, g[f"g1_{l}"], g[f"b1_{l}"] = layernorm_back(lin(dqkv, np.ascontiguousarray(P[f"Wqkv_{l}"].T)), P[f"g1_{l}"], c["ln1"])
        dx = dx + dh
    g["E"] = np.zeros_like(P["E"])
    np.add.at(g["E"], inp.reshape(-1), dx.reshape(-1, d))
    g["Pos"] = np.zeros_like(P["Pos"])
    g["Pos"][:T] = dx.sum(0)
    return loss, g


def next_logits(P, ids, heads, act="gelu"):
    """logits for the token after `ids` (no cache; used for sampling during training + parity)."""
    T = len(ids)
    inp = np.array([ids])
    d = P["E"].shape[1]
    hd = d // heads
    causal = np.triu(np.full((T, T), -1e9, dtype=np.float32), 1)
    x = P["E"][inp] + P["Pos"][:T][None]
    for l in range(n_layers(P)):
        h, _ = layernorm(x, P[f"g1_{l}"], P[f"b1_{l}"])
        qkv = h @ P[f"Wqkv_{l}"] + P[f"bqkv_{l}"]
        q, k, v = [qkv[..., i * d:(i + 1) * d].reshape(1, T, heads, hd).transpose(0, 2, 1, 3) for i in range(3)]
        a = softmax(q @ k.transpose(0, 1, 3, 2) / float(np.sqrt(hd)) + causal)
        x = x + (a @ v).transpose(0, 2, 1, 3).reshape(1, T, d) @ P[f"Wo_{l}"] + P[f"bo_{l}"]
        h2, _ = layernorm(x, P[f"g2_{l}"], P[f"b2_{l}"])
        u = h2 @ P[f"W1_{l}"] + P[f"c1_{l}"]
        x = x + (gelu(u)[0] if act == "gelu" else np.maximum(u, 0)) @ P[f"W2_{l}"] + P[f"c2_{l}"]
    hf, _ = layernorm(x, P["gf"], P["bf"])
    return (hf @ P["Wy"] + P["by"])[0, -1]


def gradient_check(log=print, act="gelu"):
    rng = np.random.default_rng(0)
    P = {k: v.astype(np.float64) for k, v in init(9, 6, 8, 2, rng).items()}
    for k in P:
        P[k] += rng.standard_normal(P[k].shape) * 0.2
    inp = rng.integers(0, 9, (2, 5))
    tgt = rng.integers(0, 9, (2, 5))
    mask = np.array([[0, 1, 1, 1, 1], [0, 1, 1, 0, 0]], dtype=np.float64)
    _, g = loss_and_grads(P, inp, tgt, mask, heads=2, act=act)
    worst = 0.0
    for k in P:
        flat = P[k].reshape(-1)
        for i in rng.choice(flat.size, min(5, flat.size), replace=False):
            old = flat[i]
            flat[i] = old + 1e-5
            lp, _ = loss_and_grads(P, inp, tgt, mask, heads=2, act=act)
            flat[i] = old - 1e-5
            lm, _ = loss_and_grads(P, inp, tgt, mask, heads=2, act=act)
            flat[i] = old
            num, ana = (lp - lm) / 2e-5, g[k].reshape(-1)[i]
            if abs(num) + abs(ana) > 1e-9:
                worst = max(worst, abs(num - ana) / (abs(num) + abs(ana)))
    log(f"  [gradcheck transformer {act}] worst relative error {worst:.2e}")
    assert worst < 1e-4, "transformer backprop is wrong!"
    return worst


if __name__ == "__main__":
    gradient_check()
    gradient_check(act="relu")
