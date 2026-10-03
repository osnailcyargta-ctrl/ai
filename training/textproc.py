"""Text processing shared by training and the browser.

EVERYTHING here has an exact mirror in assets/js/brain.js. If you change
something here, change it there too, or the trained model gets garbage input.
tests/parity.py checks that both sides agree.
"""
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(ROOT, "data", "slang_id.json"), encoding="utf-8") as _f:
    _SLANG = json.load(_f)
SLANG_MAP = _SLANG["map"]
ID_MARKERS = set(_SLANG["markers"])

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

WK_RE = re.compile(r"[wk]{4,}|(?:a?wk)+[a-z]?|(?:wk)+")
HAHA_RE = re.compile(r"(?:ha|he|hi|ah|hah)+h?")


def canon(tok):
    """Indonesian slang / abbreviations / laughs -> one canonical word."""
    if len(tok) >= 4 and "w" in tok and "k" in tok and WK_RE.fullmatch(tok):
        return "wkwk"
    if len(tok) >= 4 and HAHA_RE.fullmatch(tok):
        return "haha"
    return SLANG_MAP.get(tok, tok)


def normalize(text):
    t = text.lower()
    for emo, word in EMOJI_WORDS.items():
        t = t.replace(emo, word)
    t = re.sub(r"([a-z]+)2(?![0-9])", r"\1 \1", t)  # kata2 -> kata kata
    t = re.sub(r"([0-9])\s*-\s*(?=[0-9])", r"\1 minus ", t)
    t = re.sub(r"([0-9])\s*x\s*(?=[0-9])", r"\1 times ", t)
    t = re.sub(r"[0-9]+(\.[0-9]+)?", " num ", t)
    t = t.replace("+", " plus ").replace("*", " times ").replace("/", " div ")
    t = t.replace("^", " pow ").replace("=", " eq ")
    t = t.replace("?", " qmark ").replace("!", " bang ")
    t = t.replace("'", "").replace("’", "")
    t = re.sub(r"[^a-z\s]", " ", t)
    t = re.sub(r"(.)\1{2,}", r"\1\1", t)
    return [canon(w) for w in t.split()]


NON_WORDS = {"qmark", "bang", "num", "plus", "minus", "times", "div", "pow", "eq"}


def detect_lang(tokens):
    """'id' if the (normalized) tokens look Indonesian, else 'en'."""
    words = [t for t in tokens if t not in NON_WORDS and not t.startswith("emoji")]
    if not words:
        return "en"
    score = sum(1 for t in words if t in ID_MARKERS)
    return "id" if score >= max(1, 0.25 * len(words)) else "en"


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
    if tokens:
        feats.append("s|" + tokens[0])        # first word matters a lot ("siapa ...", "mending ...")
        feats.append("n|" + str(min(len(tokens), 8)))  # rough length bucket
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
    out, open_quote, glue = "", False, False
    for tok in tokens:
        if tok in ("'", '"'):
            if not open_quote:
                out += (" " if out else "") + tok
                glue = True
            else:
                out += tok
            open_quote = not open_quote
            continue
        if out and not glue and tok not in ",.!?:;":
            out += " "
        glue = False
        out += tok
    return out


def response_lang(text):
    return detect_lang(normalize(re.sub(r"\{\w+\}", " ", text)))
