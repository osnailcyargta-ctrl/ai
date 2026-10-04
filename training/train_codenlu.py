"""Train sybau code's request reader (code NLU). Pure numpy, from scratch.

Before anything is written, sybau code has to know WHAT the user wants:

    "bikin game ninja vs zombie"          -> new       (things: ninja, zombie)
    "hapus dan bikin game baru balapan"   -> new
    "tambahin bom dong"                   -> add       (things: bom)
    "ubah speed jadi 10"                  -> setvar    (var: speed, value: 10)
    "nyawanya 5 aja"                      -> setvar    (var: nyawanya, value: 5)
    "ganti zombie jadi alien"             -> replace   (thing: zombie, new: alien)
    "hapus zombienya" / "delete su"       -> remove    (thing: zombie / su)
    "hapus semuanya", "mulai dari awal"   -> reset
    "balikin yang tadi"                   -> undo
    "variabelnya apa aja?" "cara mainnya" -> ask
    "lu goblok", "makasih"                -> chat

Two small networks, both trained on ~70k generated sentences (Indonesian, English, slang,
typos), so the meaning comes from the words, not from "/" or "?" or "!":
  - intent:  hashed words + word pairs + character trigrams -> MLP -> 9 intents
  - tagger:  for every word, its own features + its neighbours' -> MLP -> O / T / T2 / V / N
             (T = a thing, T2 = the new thing in "ganti X jadi Y", V = a setting, N = a value)

Output: model/codenlu.json (int8). JS side: assets/js/codenlu.js (same hashing).
Usage: python training/train_codenlu.py
"""
import json
import os
import random
import re
import time
import unicodedata

import numpy as np

from train import quant

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "model", "codenlu.json")
DIM = 1 << 13
INTENTS = ["new", "add", "setvar", "replace", "remove", "reset", "undo", "ask", "chat"]
TAGS = ["O", "T", "T2", "V", "N"]

POOL = json.load(open(os.path.join(ROOT, "data", "html", "things.json"), encoding="utf-8"))
THINGS_ID = sorted({e[0] for v in POOL.values() for e in v})
THINGS_EN = sorted({e[1] for v in POOL.values() for e in v})
# made-up / unknown things, so it learns from the context that a word is a thing
NONSENSE = ["skibidi", "toilet", "sigma", "rizz", "gyatt", "mewing", "fanum", "ohio", "sybau", "su", "bombardiro", "crocodilo", "tralalero", "tungtung", "sahur", "brr", "patapim", "ballerina", "capuccino", "kucingoren", "bebekgoreng", "mamang", "bapak", "ibu", "adek", "kakak", "pacar", "doi", "bos", "guru", "dosen", "mantan", "tetangga", "dino", "boneka", "sendal", "kursi", "meja", "lemari", "nasi", "tahu", "tempe", "bakso", "cilok", "seblak", "martabak", "rendang", "sate", "kerupuk", "minecraft", "creeper", "steve", "mario", "luigi", "sonic", "pikachu", "goku", "naruto", "batman", "spiderman", "thanos", "kirby", "pacman", "among", "imposter", "crewmate", "kecap", "sambal", "pempek", "roblox", "noob", "pro", "hacker", "virus", "wifi", "hp", "laptop", "printer", "kalkulator", "es", "teh", "boba", "durian", "rambutan", "salak", "kelereng", "layangan", "gasing", "becak", "ojek", "angkot", "kereta", "monas", "candi", "garuda", "komodo", "orangutan", "cendrawasih", "badak", "harimau", "elang"]
VARS_ID = ["kecepatan", "speed", "nyawa", "nyawanya", "darah", "hp", "gravitasi", "lompatan", "lompat", "kekuatan lompat", "waktu", "durasi", "lama main", "detik", "skor menang", "target", "target skor", "jumlah musuh", "musuh", "ukuran", "ukuran papan", "kecepatan musuh", "kecepatan peluru", "kecepatan pemain", "kecepatan jatuh", "kecepatan bola", "jumlah soal", "soal", "angin", "volume", "harga", "jumlah ranjau", "ranjau", "level", "jumlah bintang", "kecepatan ular", "celah pipa", "celah", "dorongan", "jumlah bola", "jumlah target", "bensin", "peluru", "jumlah peluru", "lebar", "tinggi", "radius", "jangkauan", "power", "kekuatan", "gesekan", "lives", "goal", "gravity", "jumppower", "foespeed", "bulletspeed", "gametime", "winscore", "tickms", "jumlah", "max", "maxnum"]
VARS_EN = ["speed", "lives", "health", "hp", "gravity", "jump", "jump power", "time", "timer", "duration", "seconds", "win score", "target", "goal", "enemy count", "enemies", "size", "board size", "enemy speed", "bullet speed", "player speed", "fall speed", "ball speed", "questions", "wind", "volume", "price", "mines", "level", "gap", "thrust", "ammo", "width", "height", "radius", "range", "power", "friction", "score to win", "max"]
COLORS_ID = ["merah", "biru", "hijau", "kuning", "ungu", "hitam", "putih", "pink", "oranye", "abu", "coklat", "emas", "cyan", "ungu tua", "biru muda"]
COLORS_EN = ["red", "blue", "green", "yellow", "purple", "black", "white", "pink", "orange", "grey", "brown", "gold", "cyan", "dark blue", "light green"]
GAMES_ID = ["game {a} vs {b}", "game {a} ngumpulin {i}", "game {a} dikejar {b}", "game tembak {b}", "game {a} lompat", "game ular", "snake", "tictactoe", "tic tac toe", "pong", "breakout", "flappy {a}", "game balapan", "game labirin", "kuis", "kalkulator", "todo list", "game {a} lempar {s} ke {b}", "game hindarin {b}", "tangkap {i} jatuh", "game tetris", "game memori", "game {a} makan {i}", "game platformer", "game {a} kabur dari {b}", "game puzzle", "game clicker", "stopwatch", "jam", "piano", "game {b} jatuh dari langit", "game mancing", "game basket", "game sepak bola", "game tank", "rpg lawan {b}", "game bos {b}", "aplikasi catatan", "game tebak angka", "minesweeper", "2048", "game {a}", "game tentang {a}", "game {a} sama {b}", "simulasi {a}", "animasi {a}", "website {a}", "game horor {b}", "game lucu {a}", "game susah", "game gampang",
            "game tembak tembakan", "game luar angkasa", "game {a} lari", "game lari {a}", "game masak", "game tower defense", "game ngetik", "aplikasi gambar", "aplikasi timer", "game {a} clicker", "shooter {b}", "game perang", "game mobil", "game sepeda", "game {a} terbang"]
GAMES_EN = ["game {a} vs {b}", "game where a {a} collects {i}", "{a} chased by {b}", "shoot the {b}s", "a {a} jumping game", "snake game", "tic tac toe", "pong", "breakout", "flappy {a}", "racing game", "maze game", "quiz", "calculator", "todo list", "{a} throwing {s} at {b}", "dodge the {b}", "catch falling {i}", "tetris", "memory game", "{a} eating {i}", "platformer", "{a} escaping from {b}", "puzzle game", "clicker game", "stopwatch", "clock", "piano", "falling {b} game", "fishing game", "basketball game", "football game", "tank game", "rpg against {b}", "boss fight with a {b}", "notes app", "guess the number", "minesweeper", "2048", "a game about {a}", "{a} and {b} game", "{a} simulator", "{a} animation", "a {a} website", "horror game with {b}", "funny {a} game", "hard game", "easy game",
            "space shooter", "a space shooter", "{a} shooter", "a {a} shooter", "{a} runner", "an endless runner", "a {a} game", "{a} game", "a racing game with {a}", "a {a} platformer",
            "a shooting game", "a jumping game", "a zombie game", "a cooking game", "a puzzle", "an rpg", "a tower defense", "a typing game", "a drawing app", "a timer app", "a {a} clicker"]
SLANG_PRE = ["", "", "", "", "bro ", "bang ", "min ", "woi ", "eh ", "oke ", "ok ", "yaudah ", "nah ", "sekarang ", "terus ", "abis itu ", "plis ", "tolong ", "coba ", "skrg ", "cok ", "anjir ", "bjir ", "hmm ", "jadi ", "btw "]
SLANG_POST = ["", "", "", "", " dong", " deh", " ya", " pls", " plis", " cepet", " sekarang", " bro", " aja", " lah", " anjir", " cok", " njir", " yaa", " oke", " ok", " gpl", " wkwk", " :)", " !", " ?", " !!", "..."]
EN_PRE = ["", "", "", "", "hey ", "ok ", "now ", "then ", "please ", "pls ", "bro ", "yo ", "can you ", "could you ", "just "]
EN_POST = ["", "", "", "", " please", " pls", " now", " bro", " thanks", " asap", " lol", "!", "?", "..."]


def T(text, **tags):
    """a template result: text with {name} slots filled, plus the tag of every word"""
    return text, tags


def rnd_thing(rng, lang):
    r = rng.random()
    if r < 0.18:
        return rng.choice(NONSENSE)
    return rng.choice(THINGS_ID if lang == "id" else THINGS_EN)


def rnd_value(rng, lang):
    r = rng.random()
    if r < 0.6:
        return str(rng.choice([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30, 40, 50, 60, 99, 100, 0, 0.5, 1.5, 2.5, 200, 500, 1000]))
    if r < 0.8:
        return rng.choice(COLORS_ID if lang == "id" else COLORS_EN)
    return rng.choice(["2x", "dua kali", "setengah", "double", "10x", "3 kali"] if lang == "id" else ["2x", "double", "half", "twice", "10x", "triple"])


def sample(rng):
    """-> (words, tags, intent)"""
    intent = rng.choice(INTENTS)
    lang = "id" if rng.random() < 0.68 else "en"
    a, b, i, s = rnd_thing(rng, lang), rnd_thing(rng, lang), rnd_thing(rng, lang), rnd_thing(rng, lang)
    var = rng.choice(VARS_ID if lang == "id" else VARS_EN)
    val = rnd_value(rng, lang)
    game = rng.choice(GAMES_ID if lang == "id" else GAMES_EN)
    if intent == "new":
        tpl = rng.choice([
            "bikin {G}", "bikinin {G}", "buat {G}", "buatin {G}", "gw mau {G}", "aku mau {G}", "pengen {G}", "{G}", "{G}", "coba bikin {G}",
            "hapus dan bikin {G}", "hapus terus bikin {G} baru", "ganti jadi {G}", "bikin yang baru aja, {G}", "yang lain, {G}", "bikin game baru {G}",
            "skip, bikin {G}", "udah ganti game, {G}", "sekarang bikin {G}", "mulai baru {G}", "game baru dong {G}", "bosen, bikin {G}",
            "lupain yang tadi, bikin {G}", "gak jadi, bikin {G} aja", "bikin dari awal {G}", "bisa bikin {G} gak", "bisa ga bikinin {G}", "tolong buatkan {G}",
        ] if lang == "id" else [
            "make {G}", "build {G}", "create {G}", "i want {G}", "{G}", "{G}", "code {G}", "write {G}", "make me {G}", "new game {G}",
            "delete that and make {G}", "scrap it, make {G}", "start over with {G}", "something else, {G}", "now make {G}", "can you make {G}",
            "forget that, build {G}", "a new {G}", "let's do {G} instead", "how about {G}",
        ])
        text = tpl.replace("{G}", game)
        tags = {"a": "T", "b": "T", "i": "T", "s": "T"}
    elif intent == "add":
        tpl = rng.choice([
            "tambahin {a}", "tambah {a}", "kasih {a}", "tambahin {a} dong", "masukin {a}", "kasih ada {a}nya", "tambahin musuh {b}", "tambahin item {i}",
            "bikin ada {a}", "tambah fitur {a}", "tambahin power up {i}", "kasih bos {b}", "tambahin level", "tambahin musuh", "tambahin skor", "kasih suara",
            "tambahin nyawa", "kasih timer", "tambahin highscore", "bikin ada menu", "tambahin {a} yang ngejar", "kasih {b} yang nembak", "tambahin {i} buat dikumpulin",
            "sama tambahin {a}", "terus kasih {b}", "ditambah {a}", "pake {a} juga",
        ] if lang == "id" else [
            "add {a}", "add a {a}", "put a {b} in it", "add enemies", "add {b} enemies", "add a {i} powerup", "add a boss {b}", "add levels", "add a score",
            "add sound", "add lives", "add a timer", "add a highscore", "add a menu", "also add {a}", "include {i}", "give it {a}", "with {b} too", "add more {b}",
        ])
        text = tpl
        tags = {"a": "T", "b": "T", "i": "T"}
    elif intent == "setvar":
        tpl = rng.choice([
            "ubah {V} jadi {N}", "ganti {V} jadi {N}", "{V} jadi {N}", "{V} {N}", "{V}nya {N}", "{V}nya jadi {N}", "set {V} ke {N}", "atur {V} jadi {N}", "{V} = {N}",
            "bikin {V} {N}", "ubah variabel {V} jadi {N}", "variabel {V} ganti {N}", "{V} diganti {N}", "naikin {V} jadi {N}", "turunin {V} ke {N}", "ganti nilai {V} ke {N}",
            "{V}nya {N} aja", "pengen {V}nya {N}", "{V} jadiin {N}", "ganti warna background jadi {C}", "background {C}", "warnanya {C}", "latarnya jadi {C}",
            "bikin lebih cepet", "lebih cepet", "lebih lambat", "kecepatannya 2x", "musuhnya lebih cepet", "lompatnya lebih tinggi", "gravitasinya kecilin", "nyawanya tambahin",
            "ubah {V}", "{V}nya kegedean", "{V}nya kekecilan", "kecilin {V}", "gedein {V}",
        ] if lang == "id" else [
            "change {V} to {N}", "set {V} to {N}", "{V} = {N}", "make the {V} {N}", "{V} {N}", "make {V} {N}", "change the {V} variable to {N}", "increase {V} to {N}",
            "lower {V} to {N}", "update {V} to {N}", "i want {V} at {N}", "background {C}", "make the background {C}", "change the colour to {C}", "faster", "make it faster",
            "slower", "make it slower", "jump higher", "less gravity", "more lives", "change {V}", "{V} is too big", "{V} is too small", "double the {V}",
        ])
        col = rng.choice(COLORS_ID if lang == "id" else COLORS_EN)
        text = tpl.replace("{C}", "{c}")
        tags = {"V": "V", "N": "N", "c": "N"}
        a, b = var, val
        text = text.replace("{V}", "{a}").replace("{N}", "{b}")
        tags = {"a": "V", "b": "N", "c": "N"}
        s = col
        text = text.replace("{c}", "{s}")
        tags["s"] = "N"
    elif intent == "replace":
        tpl = rng.choice([
            "ganti {a} jadi {b}", "ubah {a} jadi {b}", "{a}nya ganti {b}", "{a} diganti {b}", "jangan {a}, {b} aja", "{a}nya jadiin {b}", "ganti {a} sama {b}", "tuker {a} jadi {b}",
            "yang {a} ganti {b}", "bukan {a} tapi {b}", "{a} jadi {b}", "musuhnya ganti {b}", "pemainnya ganti {b}", "karakternya jadi {b}", "ganti karakter jadi {b}", "gw mau {a}nya jadi {b}",
        ] if lang == "id" else [
            "replace the {a} with {b}", "change {a} to {b}", "swap {a} for {b}", "turn the {a} into {b}", "not {a}, {b}", "make the {a} a {b}", "use {b} instead of {a}",
            "the enemy should be a {b}", "make the player a {b}", "{a} to {b}",
        ])
        text = tpl
        tags = {"a": "T", "b": "T2"}
    elif intent == "remove":
        tpl = rng.choice([
            "hapus {a}", "hapus {a}nya", "ilangin {a}", "ilangin {a}nya", "buang {a}", "delete {a}", "apus {a}", "hapusin {a}", "gak usah ada {a}", "jangan ada {a}",
            "{a}nya hapus aja", "{a}nya diilangin", "remove {a}", "tanpa {a}", "hapus musuhnya", "ilangin skornya", "hapus timer", "gausah pake {a}", "{a}nya ga perlu",
            "hapus suaranya", "buang nyawa", "ilangin batas waktu",
        ] if lang == "id" else [
            "remove the {a}", "delete the {a}", "get rid of the {a}", "no {a}", "without the {a}", "take out the {a}", "remove {a}s", "drop the {a}",
            "remove the enemies", "remove the score", "no timer", "delete {a}",
        ])
        text = tpl
        tags = {"a": "T"}
    elif intent == "reset":
        tpl = rng.choice([
            "hapus semua", "hapus semuanya", "hapus gamenya", "delete semua", "mulai dari awal", "reset", "ulang dari nol", "bersihin", "clear", "kosongin",
            "hapus kodenya", "buang semua", "apus semua", "hapus aja semua", "udah hapus aja", "reset semuanya", "hapus game ini", "ga jadi, hapus",
        ] if lang == "id" else [
            "delete everything", "delete it all", "clear", "reset", "start over", "start from scratch", "wipe it", "remove everything", "delete the game", "clear it all",
        ])
        text = tpl
        tags = {}
    elif intent == "undo":
        tpl = rng.choice([
            "balikin", "balikin yang tadi", "undo", "batalin", "yang tadi aja", "balik ke sebelumnya", "gajadi, balikin", "versi sebelumnya", "kembaliin", "cancel perubahan",
            "balikin kayak tadi", "yang lama lebih bagus", "batal",
        ] if lang == "id" else [
            "undo", "go back", "revert", "the previous one", "undo that", "put it back", "the old one was better", "cancel that change",
        ])
        text = tpl
        tags = {}
    elif intent == "ask":
        tpl = rng.choice([
            "variabelnya apa aja", "ada variabel apa aja", "settingannya apa aja", "cara mainnya gimana", "gimana cara main", "kontrolnya apa", "tombolnya apa aja",
            "ini game apa", "ini kode apa", "kodenya ngapain", "jelasin kodenya", "kenapa error", "kok ga jalan", "kenapa ga bisa gerak", "{a}nya ngapain",
            "gimana cara ganti warna", "cara ubah kecepatan gimana", "bisa ganti {V} ga", "{V} itu apa", "fungsi {V} apa", "ini pake bahasa apa", "berapa baris kodenya",
            "ini bikinnya gimana", "kenapa {a} nya diem", "apa bedanya", "maksudnya apa", "ini html bukan", "kok gitu", "gimana caranya",
        ] if lang == "id" else [
            "what variables are there", "what are the settings", "how do i play", "what are the controls", "which keys", "what is this game", "what does this code do",
            "explain the code", "why is there an error", "why doesn't it work", "what does the {a} do", "how do i change the colour", "how to change the speed",
            "can i change {V}", "what is {V}", "what language is this", "how many lines", "how does it work",
        ])
        text = tpl.replace("{V}", "{b}")
        a, b = a, var
        tags = {"a": "T", "b": "V"}
    else:  # chat
        tpl = rng.choice([
            "makasih", "thanks", "mantap", "keren", "lu goblok", "goblok", "jelek banget", "bagus", "anjir keren", "wkwk", "halo", "hai", "lu siapa", "apa kabar", "oke",
            "sip", "gas", "lanjut", "ga jelas", "bodo amat", "capek", "males", "aku sedih", "lu bisa apa aja", "jago juga lu", "cacat", "ass", "sybau", "idk", "lol", "hmm",
            "gpp", "yaudah", "terserah", "ngantuk", "lagi apa", "kamu ai ya", "lu bego", "mantul", "gg", "nice", "wow", "parah", "bagus juga",
        ] if lang == "id" else [
            "thanks", "cool", "nice", "you suck", "this is bad", "great", "hello", "hi", "who are you", "how are you", "ok", "sure", "lol", "idk", "whatever", "good job",
            "wow", "bruh", "what can you do", "you're dumb", "gg", "awesome",
        ])
        text = tpl
        tags = {}
    if lang == "id":
        text = rng.choice(SLANG_PRE) + text + rng.choice(SLANG_POST)
    else:
        text = rng.choice(EN_PRE) + text + rng.choice(EN_POST)
    # fill the slots and tag their words
    words, labels = [], []
    glue = False
    for part in re.split(r"(\{\w\})", text):
        m = re.fullmatch(r"\{(\w)\}", part)
        if m:
            filler = {"a": a, "b": b, "i": i, "s": s, "c": s}[m.group(1)]
            tag = tags.get(m.group(1), "O")
            for w in tokens(filler):
                words.append(w); labels.append(tag)
            glue = True
        else:
            toks = tokens(part)
            # "{a}nya" -> one word "zombienya", still the thing
            if glue and toks and words and re.match(r"[a-z]", part):
                words[-1] += toks.pop(0)
            for w in toks:
                words.append(w); labels.append("O")
            glue = False
    # "{a}nya" glues the suffix to the thing: zombienya -> T
    return typo(words, labels, rng), labels, intent


def tokens(text):
    text = unicodedata.normalize("NFKD", text.lower())
    text = "".join(c for c in text if not unicodedata.combining(c))
    return re.findall(r"[a-z]+|\d+(?:[.,]\d+)?x?|[=]", text)


def typo(words, labels, rng):
    out = []
    for w in words:
        if len(w) > 3 and rng.random() < 0.06:
            k = rng.randrange(len(w) - 1)
            r = rng.random()
            w = w[:k] + w[k + 1:] if r < 0.4 else w[:k] + w[k + 1] + w[k] + w[k + 2:] if r < 0.8 else w[:k] + w[k] + w[k:]
        out.append(w)
    return out


def fnv(s):
    h = 2166136261
    for c in s:
        h ^= ord(c)
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def word_feats(w):
    """features of one word: itself, its stem without -nya/-s, character trigrams"""
    f = ["w:" + w]
    for suf in ("nya", "in", "kan", "s"):
        if len(w) > len(suf) + 2 and w.endswith(suf):
            f.append("w:" + w[: -len(suf)])
            f.append("suf:" + suf)
    p = "^" + w + "$"
    f += ["c:" + p[k:k + 3] for k in range(len(p) - 2)]
    if re.fullmatch(r"\d+(?:[.,]\d+)?x?", w):
        f.append("isnum")
    return f


def sent_feats(words):
    f = []
    for k, w in enumerate(words):
        f += word_feats(w)
        if k:
            f.append("b:" + words[k - 1] + "_" + w)
    f.append("first:" + (words[0] if words else ""))
    f.append("len:" + str(min(len(words), 8)))
    return f


def tok_feats(words, k):
    f = ["self:" + x for x in word_feats(words[k])]
    for d in (-2, -1, 1, 2):
        j = k + d
        w = words[j] if 0 <= j < len(words) else ("<s>" if j < 0 else "</s>")
        f.append(f"n{d}:" + w)
        if 0 <= j < len(words):
            for suf in ("nya",):
                if w.endswith(suf) and len(w) > 5:
                    f.append(f"n{d}:" + w[:-3])
    f.append("pos:" + str(min(k, 6)))
    f.append("first:" + words[0])
    return f


def vec(feats):
    idx = sorted({fnv(x) % DIM for x in feats})
    return idx


class MLP:
    def __init__(self, n_out, hidden, rng):
        self.W1 = (rng.standard_normal((DIM, hidden)) * 0.05).astype(np.float32)
        self.b1 = np.zeros(hidden, np.float32)
        self.W2 = (rng.standard_normal((hidden, n_out)) * (1 / np.sqrt(hidden))).astype(np.float32)
        self.b2 = np.zeros(n_out, np.float32)
        self.m = {k: np.zeros_like(v) for k, v in self.params().items()}
        self.v = {k: np.zeros_like(v) for k, v in self.params().items()}
        self.t = 0

    def params(self):
        return {"W1": self.W1, "b1": self.b1, "W2": self.W2, "b2": self.b2}

    def forward(self, rows):
        h = np.stack([self.W1[r].sum(0) for r in rows]) + self.b1
        a = np.maximum(h, 0)
        return h, a, a @ self.W2 + self.b2

    def train_batch(self, rows, y, lr, drop, rng):
        h, a, logits = self.forward(rows)
        mask = (rng.random(a.shape) > drop).astype(np.float32) / (1 - drop)
        a = a * mask
        logits = a @ self.W2 + self.b2
        logits -= logits.max(1, keepdims=True)
        p = np.exp(logits); p /= p.sum(1, keepdims=True)
        loss = -np.log(p[np.arange(len(y)), y] + 1e-9).mean()
        g = p; g[np.arange(len(y)), y] -= 1; g /= len(y)
        gW2 = a.T @ g; gb2 = g.sum(0)
        ga = g @ self.W2.T * mask * (h > 0)
        gW1 = np.zeros_like(self.W1)
        for r, gr in zip(rows, ga):
            gW1[r] += gr
        gb1 = ga.sum(0)
        self.t += 1
        for k, gk in (("W1", gW1), ("b1", gb1), ("W2", gW2), ("b2", gb2)):
            P = self.params()[k]
            self.m[k] = 0.9 * self.m[k] + 0.1 * gk
            self.v[k] = 0.999 * self.v[k] + 0.001 * gk * gk
            mh = self.m[k] / (1 - 0.9 ** self.t); vh = self.v[k] / (1 - 0.999 ** self.t)
            P -= lr * mh / (np.sqrt(vh) + 1e-8)
        return loss

    def predict(self, rows):
        return self.forward(rows)[2].argmax(1)


def fit(model, X, y, epochs, rng, lr=2e-3, bs=64, name=""):
    n = len(X)
    for ep in range(epochs):
        order = rng.permutation(n)
        tot, nb, t0 = 0.0, 0, time.time()
        cur_lr = lr * (0.3 if ep == epochs - 1 else 1.0)
        for k in range(0, n, bs):
            idx = order[k:k + bs]
            tot += model.train_batch([X[j] for j in idx], y[idx], cur_lr, 0.2, rng)
            nb += 1
        print(f"  [{name}] epoch {ep}  loss {tot / nb:.4f}  ({time.time() - t0:.0f}s)", flush=True)


def main():
    rng_py = random.Random(11)
    rng = np.random.default_rng(11)
    data = [sample(rng_py) for _ in range(60000)]
    data += [s for s in (sample(rng_py) for _ in range(6000))]
    val = [sample(random.Random(99)) for _ in range(1)]
    vrng = random.Random(1234)
    val = [sample(vrng) for _ in range(3000)]
    print(f"{len(data)} training sentences, e.g.:")
    for w, l, it in data[:12]:
        print(f"   {it:8s} " + " ".join(x + ("/" + t if t != "O" else "") for x, t in zip(w, l)))

    Xi = [vec(sent_feats(w)) for w, _, _ in data]
    yi = np.array([INTENTS.index(it) for _, _, it in data])
    intent = MLP(len(INTENTS), 160, rng)
    fit(intent, Xi, yi, 4, rng, name="intent")
    vp = intent.predict([vec(sent_feats(w)) for w, _, _ in val])
    acc = (vp == np.array([INTENTS.index(it) for _, _, it in val])).mean()
    print(f"intent accuracy on new sentences: {acc * 100:.1f}%")

    Xt, yt = [], []
    for w, l, _ in data[:40000]:
        for k in range(len(w)):
            Xt.append(vec(tok_feats(w, k))); yt.append(TAGS.index(l[k]))
    yt = np.array(yt)
    tagger = MLP(len(TAGS), 128, rng)
    fit(tagger, Xt, yt, 3, rng, name="tagger")
    Xv, yv = [], []
    for w, l, _ in val:
        for k in range(len(w)):
            Xv.append(vec(tok_feats(w, k))); yv.append(TAGS.index(l[k]))
    tp = tagger.predict(Xv)
    yv = np.array(yv)
    print(f"tagger accuracy: {(tp == yv).mean() * 100:.1f}%  (non-O words: {(tp[yv > 0] == yv[yv > 0]).mean() * 100:.1f}%)")

    out = {"format": "sybau-codenlu-v1", "dim": DIM, "intents": INTENTS, "tags": TAGS,
           "params": int(sum(v.size for m in (intent, tagger) for v in m.params().values())),
           "intent": {k: quant(v) for k, v in intent.params().items()},
           "tagger": {k: quant(v) for k, v in tagger.params().items()},
           "trained_at": time.strftime("%Y-%m-%d %H:%M:%S"), "accuracy": {"intent": round(float(acc), 4)}}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"saved {OUT} ({os.path.getsize(OUT) / 1024:.0f} KB, {out['params']:,} params)")


if __name__ == "__main__":
    main()
