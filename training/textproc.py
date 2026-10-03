"""Text processing shared by training and the browser.

EVERYTHING here has an exact mirror in assets/js/brain.js. If you change
something here, change it there too, or the trained model gets garbage input.
"""
import re

EMOJI_WORDS = {
    "😭": " emojicry ",
    "💀": " emojiskull ",
    "🥀": " emojirose ",
    "😂": " emojilaugh ",
    "🤣": " emojilaugh ",
    "❤": " emojiheart ",
    "🙏": " emojipray ",
    "🤡": " emojiclown ",
}


def normalize(text):
    t = text.lower()
    for emo, word in EMOJI_WORDS.items():
        t = t.replace(emo, word)
    t = re.sub(r"([0-9])\s*-\s*(?=[0-9])", r"\1 minus ", t)
    t = re.sub(r"([0-9])\s*x\s*(?=[0-9])", r"\1 times ", t)
    t = re.sub(r"[0-9]+(\.[0-9]+)?", " num ", t)
    t = t.replace("+", " plus ").replace("*", " times ").replace("/", " div ")
    t = t.replace("^", " pow ").replace("=", " eq ")
    t = t.replace("?", " qmark ").replace("!", " bang ")
    t = t.replace("'", "").replace("’", "")
    t = re.sub(r"[^a-z\s]", " ", t)
    t = re.sub(r"(.)\1{2,}", r"\1\1", t)
    return t.split()


def fnv1a(s):
    h = 0x811C9DC5
    for b in s.encode("utf-8"):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def feature_strings(tokens):
    feats = []
    for i, tok in enumerate(tokens):
        feats.append("w|" + tok)
        padded = "<" + tok + ">"
        for j in range(len(padded) - 2):
            feats.append("c|" + padded[j:j + 3])
        if i + 1 < len(tokens):
            feats.append("b|" + tok + "|" + tokens[i + 1])
    return feats


def featurize(text, dim):
    """Hashed bag of words + bigrams + char trigrams, L2-normalised.

    Returns a dict {index: value} (sparse) so the browser can do the same cheaply.
    """
    counts = {}
    for f in feature_strings(normalize(text)):
        k = fnv1a(f) % dim
        counts[k] = counts.get(k, 0.0) + 1.0
    norm = sum(v * v for v in counts.values()) ** 0.5
    if norm > 0:
        for k in counts:
            counts[k] /= norm
    return counts


# ---- generator tokenizer (bot responses) ----
GEN_TOKEN_RE = re.compile(r"\{\w+\}|[a-z0-9']+|[^\sa-z0-9']")


def gen_tokenize(text):
    return GEN_TOKEN_RE.findall(text.lower())


def gen_detokenize(tokens):
    out = ""
    for tok in tokens:
        if out and tok not in ",.!?:;":
            out += " "
        out += tok
    return out
