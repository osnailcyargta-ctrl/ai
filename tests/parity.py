"""Check the browser (JS) runs the exact same network as Python.

python tests/parity.py   (needs node) -> exits non-zero on mismatch
"""
import json, os, subprocess, sys
import numpy as np
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "training"))
from textproc import featurize, normalize
from train import dequant, softmax

TEXTS = ["halo bro apa kabar", "lu tuh BEGO banget 😭😭", "mending iphone atau samsung??", "berapa 12+30",
         "nama gw rafa", "hiiiiii", "I'm sooo bored rn", "6-7", "what's 5x5", "🥀🥀", "", "skibidi toilet ohio rizz"]

m = json.load(open(os.path.join(ROOT, "model", "brain.json"), encoding="utf-8"))
c = m["classifier"]
W1 = dequant(c["W1"]).T
W2, b1, b2 = dequant(c["W2"]), dequant(c["b1"]), dequant(c["b2"])
py = []
for t in TEXTS:
    x = np.zeros(c["feat_dim"], np.float32)
    for k, v in featurize(t, c["feat_dim"]).items():
        x[k] = v
    p = softmax(np.maximum(0, x @ W1 + b1) @ W2 + b2)
    py.append({"tokens": normalize(t), "probs": [float(v) for v in p]})

js = json.loads(subprocess.check_output(["node", os.path.join(ROOT, "tests", "parity.js"), json.dumps(TEXTS)]))
worst = 0.0
for t, a, b in zip(TEXTS, py, js):
    assert a["tokens"] == b["tokens"], (t, a["tokens"], b["tokens"])
    worst = max(worst, float(np.abs(np.array(a["probs"]) - np.array(b["probs"])).max()))
print(f"tokens match, max prob diff python vs js = {worst:.2e}")
sys.exit(0 if worst < 1e-4 else 1)
