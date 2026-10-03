# sybau.ai 🥀

Chatbot brainrot yang **benci kamu**. Beda dari AI lain yang baik dan selalu setuju sama apapun pilihan lu, yang ini nge-roast semua pilihan lu, ngomong pake slang TikTok 2026 (stfu, idc, sybau, ts pmo, who asked, cooked, mid, aura, lil bro, clanker…) dan selalu pake 🥀 kalo lagi nge-roast. Semua ini buat **lucu-lucuan doang**.

- **AI beneran, bukan n-gram**: 2 neural network yang dilatih dari nol pake Python + numpy (backprop ditulis manual, ada gradient check, gak pake PyTorch/TensorFlow).
- **Ngerti bahasa Indonesia**: termasuk bahasa gaul & singkatan (`gk`, `bgt`, `yg`, `gw/gue/aku`, `lu/lo/km`, `wkwk`...). Bales pake bahasa yang lu pake: ngetik Indo dibales Indo, ngetik English dibales English.
- **Bisa nyari info**: "cari elon musk", "apa itu lubang hitam", "who is taylor swift" → dia nyari di Wikipedia (Indo dulu, terus English), nampilin ringkasannya + tombol buka di Google. Abis itu tetep nge-roast lu karena gak bisa googling sendiri.
- **Polisi grammar**: typo, salah ejaan, atau grammar jelek langsung di-roast ("your welcome", "definately", "silahkan", "dirumah" → "di rumah", "di makan" → "dimakan", typo kayak "beljar"). Dia juga ngitung udah berapa kali lu salah.
- **Tanpa API key**: semua jalan di browser lu. Gak ada server, gak ada ChatGPT.
- **Punya memori**: inget nama, umur, hal yang lu suka/benci, yang pernah lu cari, berapa kali lu ngehina dia, dosa grammar lu, dan history chat (disimpen di `localStorage` browser lu).
- **Jujur**: kalo gak ngerti, dia bilang gak ngerti. Jawaban matematika, jam, tanggal, memori, dan hasil search diambil dari tools/data beneran, bukan dikarang.
- **Bisa dimainin di GitHub Pages** (situs statis).

## Cara kerjanya

```
pesan user ─► normalisasi slang (gk→gak, lu→kamu, wkwkwk→wkwk) + deteksi bahasa
          ─► Classifier MLP ─► intent (insult / choice / search / math / greeting / ... 50 intent)
          ─► tools: matematika, jam, tanggal, parsing "A atau B", query search, memori
          ─► GRU generator (dikondisikan intent + bahasa) ─► nulis balesan kata per kata
          ─► isi placeholder {name} {thing} {query} ... dari memori/tools
          ─► grammar checker ─► kalo ada typo, GRU nulis roast grammar {wrong}→{right}
          ─► (kalo search) Wikipedia API ─► kartu hasil + roast penutup
```

1. **Intent classifier**: input = hashed bag-of-words + bigram + char trigram + kata pertama (4096 dim) → 192 ReLU → softmax 50 intent. Data training di-augmentasi otomatis (typo, singkatan, kata tambahan, huruf kapital, slot diisi random) jadi ~14 ribu contoh.
2. **Response generator**: GRU word-level (embedding 64 + intent 16 + bahasa 8 → hidden 256 → ~1900 kata). Tiap balesan di-*sample* kata per kata (temperature + nucleus/top-p). Bot bikin 10 kandidat, buang yang placeholdernya gak bisa diisi jujur, yang barusan dipake, atau yang bahasanya gak cocok, terus pilih yang skornya paling tinggi. Nyalain 🧠 **OTAK** buat liat intent, confidence, bahasa, dan ✦ kalau kalimatnya baru (gak ada di data training).
3. **Grammar checker** (`assets/js/grammar.js`): aturan frasa/kata salah dari `data/grammar_rules.json`, aturan di-/ke- bahasa Indonesia, dan pengecek typo pake 80 ribu kata paling umum (Indo + English): kata yang gak dikenal tapi beda 1 huruf dari kata umum = typo. Slang, singkatan chat, dan ketawa (wkwk) gak dihitung typo.
4. **Search** (`assets/js/search.js`): Wikipedia API langsung dari browser.

Total ~1,7 juta parameter, `model/brain.json` ~2,3 MB (int8 quantized) + `model/lexicon.json` ~650 KB.

### Kenapa search-nya Wikipedia, bukan Google langsung?

Jujur aja: hasil Google gak bisa diambil dari situs statis tanpa API key. Google Custom Search API butuh API key (dan bayar kalo banyak), dan google.com nge-block halaman dari situs lain yang mau baca hasil search-nya (CORS). Wikipedia API gratis, gak butuh key, dan ngizinin dibaca dari browser. Jadi bot ini nyari di Wikipedia, terus ngasih tombol **GOOGLE ↗** yang langsung buka hasil Google buat query yang sama.

> Jujur juga soal "pinter": ini model kecil yang dilatih dari ~800 contoh balesan dan ~2000 pola chat, jadi jelas gak sepinter ChatGPT. Dia jago di hal yang dilatihin (roasting, ngobrol santai Indo/English, milih pilihan lu terus ngehate, matematika, inget-inget lu, nyari di Wikipedia, ngoreksi typo), tapi dia gak bisa nalar panjang atau jawab pertanyaan rumit.

**Soal "kys"**: bot ini gak pernah bilang kys. Kalau lu ngetik itu ke dia, dia cuma bales roast biasa. Dan kalau ada yang beneran ngomong soal pengen bunuh diri / nyakitin diri sendiri, bot berhenti bercanda dan ngasih info bantuan (Indonesia: 119 ext 8).

## Struktur folder

```
data/                 data training (edit ini buat ngubah kepribadian)
  intents.json          patterns (contoh chat user) + responses (contoh jawaban bot), 55 intent
  fillers.json          kata pengisi buat augmentasi ({N} nama, {T} hal, {A}/{B} pilihan, {M} matematika, {Y} umur, {Q} topik search)
  roasts.txt            roast tambahan, satu per baris
  slang_id.json         kamus slang/singkatan Indonesia + kata penanda bahasa Indonesia
  grammar_rules.json    aturan grammar & ejaan yang di-roast
  lexicon/              80rb kata paling umum (en + id), buat cek typo
training/
  train.py              training kedua network (numpy) -> model/brain.json + model/lexicon.json
  textproc.py           normalisasi teks + hashing (dicerminkan persis di brain.js)
model/                  hasil training (dipake website)
assets/js/
  brain.js              inference neural net di browser
  bot.js                memori, tools, pipeline balesan
  grammar.js            polisi grammar
  search.js             Wikipedia search
  app.js                UI
index.html, assets/css/style.css
tests/                  cek JS == Python, akurasi, grammar, simulasi chat
```

## Training ulang

```bash
pip install -r requirements.txt
python training/train.py          # ~6-8 menit di CPU: gradient check, validasi, training, export
python tests/parity.py            # pastiin JS ngitung sama persis kayak Python (butuh node)
node tests/grammar.js             # cek polisi grammar (gak boleh salah roast kalimat bener)
node tests/chat.js                # simulasi obrolan di terminal (search pake Wikipedia palsu)
node tests/chat.js "roast gw" "mending kucing atau anjing?" "cari jakarta"
```

Mau nambah slang atau roast? Tambahin aja ke `data/intents.json` / `data/roasts.txt` / `data/slang_id.json`, jalanin `train.py`, commit folder `model/`.

## Jalanin lokal

Browser gak bisa `fetch` file lokal, jadi pake server kecil:

```bash
python -m http.server 8000
# buka http://localhost:8000
```

## Deploy ke GitHub Pages

1. Push repo ini ke GitHub (branch `main`).
2. Buka **Settings → Pages**.
3. Source: **Deploy from a branch**, pilih `main` dan folder `/ (root)`, Save.
4. Tunggu sebentar, buka `https://<username>.github.io/<nama-repo>/`.

File `.nojekyll` udah ada biar GitHub Pages gak ngacak-ngacak foldernya.

## Kredit

Daftar kata di `data/lexicon/` dari [hermitdave/FrequencyWords](https://github.com/hermitdave/FrequencyWords) (OpenSubtitles 2018), lisensi CC BY-SA 4.0. Font: Anton, Archivo, JetBrains Mono, Caveat (Google Fonts).
