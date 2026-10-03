# sybau.ai 🥀

Chatbot brainrot yang **benci kamu**. Beda dari AI lain yang baik dan selalu setuju sama apapun pilihan lu, yang ini nge-roast semua pilihan lu, ngomong pake slang TikTok 2026 (stfu, idc, sybau, ts pmo, fr, cooked, mid, aura, lil bro, clanker…) dan selalu pake 🥀 kalo lagi nge-roast. Semua ini buat **lucu-lucuan doang**.

- **AI beneran, bukan n-gram**: ada 2 neural network yang dilatih dari nol pake Python + numpy (backprop ditulis manual, gak pake PyTorch/TensorFlow).
- **Tanpa API key**: modelnya jalan 100% di browser lu. Gak ada server, gak ada ChatGPT.
- **Punya memori**: inget nama, umur, hal yang lu suka/benci, berapa kali lu ngehina dia, dan history chat (disimpen di `localStorage` browser lu).
- **Jujur**: kalo dia gak ngerti, dia bilang gak ngerti ("idk what u said and idc 🥀"). Dia gak ngarang fakta: jawaban matematika, jam, tanggal, dan memori diambil dari tools beneran, bukan ditebak.
- **Bisa dimainin di GitHub Pages** (situs statis).

## Cara kerjanya

```
pesan user ──► Classifier MLP ──► intent (insult / choice / math / greeting / ...)
                                  │
                tools: matematika, jam, tanggal, parsing "A atau B", memori
                                  │
               GRU generator (dikondisikan intent) ──► nulis balesan kata per kata
                                  │
                isi placeholder {name} {thing} {choice} ... dari memori/tools
```

1. **Intent classifier**: input = hashed bag-of-words + bigram + char trigram (2048 dim) → 128 ReLU → softmax 41 intent. Data training di-augmentasi otomatis (typo, kata tambahan, slot diisi random) biar tahan typo dan bahasa campur Indo/English.
2. **Response generator**: GRU word-level (embedding 48 + intent embedding 16 → hidden 160 → vocab ~1000). Tiap balesan di-*sample* kata per kata. Bot generate 8 kandidat, buang yang placeholdernya gak bisa diisi jujur atau yang barusan dipake, terus ambil salah satu yang skornya paling tinggi. Kadang dia bikin kalimat baru yang gak ada di data (nyalain 🧠 di pojok kanan atas buat liat intent, confidence, dan ✨ kalau kalimatnya baru).
3. **Aturan kepribadian**: kalo lu ngehina panjang-panjang (≥ 14 kata), dia jawab versi "stfu, i ain't reading allat 🥀".

Total ~580 ribu parameter, file model ~820 KB (int8 quantized).

> Jujur aja ya: ini model kecil yang dilatih dari ratusan kalimat, jadi jelas gak sepinter ChatGPT. Dia jago di hal yang dilatihin (roasting, ngobrol santai, milih pilihan lu terus ngehate, matematika, inget-inget lu), tapi jangan suruh dia jelasin fisika kuantum.

**Soal "kys"**: bot ini gak pernah bilang kys. Kalau lu ngetik itu ke dia, dia cuma bales roast biasa. Dan kalau ada yang beneran ngomong soal pengen bunuh diri / nyakitin diri sendiri, bot berhenti bercanda dan ngasih info bantuan (Indonesia: 119 ext 8).

## Struktur folder

```
data/            data training (edit ini buat ngubah kepribadian)
  intents.json     patterns (contoh chat user) + responses (contoh jawaban bot)
  fillers.json     kata pengisi buat augmentasi ({N} nama, {T} hal, {A}/{B} pilihan, {M} matematika, {Y} umur)
  roasts.txt       roast tambahan, satu per baris
training/
  train.py         training kedua network (numpy) -> model/brain.json
  textproc.py      normalisasi teks + hashing (dicerminkan persis di brain.js)
model/brain.json   hasil training (dipake website)
assets/js/
  brain.js         inference neural net di browser
  bot.js           memori, tools, pipeline balesan
  app.js           UI
index.html, assets/css/style.css
tests/             cek JS == Python, dan simulasi chat
```

## Training ulang

```bash
pip install -r requirements.txt
python training/train.py          # ~2 menit di CPU, ada gradient check + validation
python tests/parity.py            # pastiin JS ngitung sama persis kayak Python (butuh node)
node tests/chat.js                # simulasi obrolan di terminal
node tests/chat.js "roast me" "mending kucing atau anjing?"
```

Mau nambah slang atau roast? Tambahin aja ke `data/intents.json` / `data/roasts.txt`, jalanin `train.py`, commit `model/brain.json`.

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
