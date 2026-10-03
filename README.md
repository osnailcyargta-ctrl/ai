# sybau.ai 🥀

Chatbot brainrot yang **benci kamu**. Beda dari AI lain yang baik dan selalu setuju sama apapun pilihan lu, yang ini nge-roast semua pilihan lu dan ngomong pake slang TikTok 2026 (stfu, idc, sybau, ts pmo, who asked, cooked, mid, aura, lil bro, clanker…), plus 🥀 kalo lagi nge-roast. Emoji cuma ada di balesan sybau, tampilannya sendiri tanpa emoji. Semua ini buat **lucu-lucuan doang**.

- **AI beneran, bukan n-gram**: 2 neural network yang dilatih dari nol pake Python + numpy (backprop ditulis manual, ada gradient check, gak pake PyTorch/TensorFlow).
- **Ngerti bahasa Indonesia**: termasuk bahasa gaul & singkatan (`gk`, `bgt`, `yg`, `gw/gue/aku`, `lu/lo/km`, `wkwk`...). Bales pake bahasa yang lu pake: ngetik Indo dibales Indo, ngetik English dibales English.
- **Tampilan terminal ala Claude CLI**: slash command dengan autocomplete (`/help`, `/settings`, `/lang`, `/search`, `/grammar`, `/memory`, `/brain`, `/theme`, `/clear`, `/forget`…), spinner, tampilan tool call (`⏺ Wikidata(...)` → `⎿ hasil`), diff merah/ijo buat koreksi grammar, riwayat pesan pake ↑↓, `esc` buat stop jawaban.
- **Tombol ⚙ settings** di atas (atau `/settings`): bahasa balesan (auto / indo / english), auto search on/off, polisi grammar on/off, tampilin otak (debug), tema (auto / gelap / terang). Disimpen di browser.
- **Auto search, gak perlu bilang "cari"**: nanya aja. "ibukota kazakstan" → **Astana**, "berapa umur elon musk" → umurnya dihitung dari tanggal lahir, "siapa presiden amerika serikat" → yang *sekarang*, "jumlah penduduk indonesia" → data terbaru. Pertanyaan fakta dijawab dari **Wikidata** (database fakta di balik Wikipedia), pertanyaan "apa itu X" dijawab pake ringkasan **Wikipedia**. Toleran typo ("kazakstan" tetep ketemu). Abis itu tetep nge-roast lu karena gak bisa googling sendiri.
- **Polisi grammar**: typo, salah ejaan, atau grammar jelek langsung di-roast ("your welcome", "definately", "silahkan", "dirumah" → "di rumah", "di makan" → "dimakan", typo kayak "beljar"). Dia juga ngitung udah berapa kali lu salah.
- **Generator gambar (beta)**: "gambar kucing", "draw a skull", "gambar kucing api" (dicampur), "/draw naga 32". Nama gambarnya dicocokin ke database dulu; kalo salah ketik, dia nyari nama yang paling mirip dan bilang **did you mean ...?** ("draw catt" → *did you mean cat?* terus digambar). Neural net decoder yang dilatih dari 31 sprite di `data/sprites.txt`, gambar 16×16 (32×32 = di-upscale pake Scale2x). Datanya masih dikit jadi hasilnya masih bego, sesuai label beta.
- **Upload file**: tombol **+ file**, drag & drop, atau paste. PNG/JPG/GIF/WebP dibuka: ukuran, warna dominan, kecerahan, dan versi 16×16 yang "diliat" bot. TXT/MD/CSV/JSON dibaca dan ditampilin cuplikannya.
- **Belajar dari file**: abis upload, ketik `/learn` (atau "pelajarin file ini"). Baris `pertanyaan => jawaban` jadi jawaban, JSON format intents di-import, catatan biasa jadi "basis pengetahuan" yang bisa ditanya ("siapa raja zorg?" → dijawab dari file lu). Gambar: `/learn NAMA`, bot nyari kode laten baru buat gambar itu (gradient descent di browser), terus bisa "gambar NAMA". `/unlearn` buat hapus semuanya.
- **Connect key** (`/connect`): pake sybau di HTML/app lain. Lihat bagian *Connect key* di bawah.
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
          ─► (kalo pertanyaan) parser pertanyaan ─► Wikidata (fakta) / Wikipedia (ringkasan) ─► hasil + roast penutup
```

1. **Intent classifier**: input = hashed bag-of-words + bigram + char trigram + kata pertama (4096 dim) → 192 ReLU → softmax 50 intent. Data training di-augmentasi otomatis (typo, singkatan, kata tambahan, huruf kapital, slot diisi random) jadi ~14 ribu contoh.
2. **Response generator**: GRU word-level (embedding 64 + intent 16 + bahasa 8 → hidden 256 → ~1900 kata). Tiap balesan di-*sample* kata per kata (temperature + nucleus/top-p). Bot bikin 10 kandidat, buang yang placeholdernya gak bisa diisi jujur, yang barusan dipake, atau yang bahasanya gak cocok, terus pilih yang skornya paling tinggi. Nyalain 🧠 **OTAK** buat liat intent, confidence, bahasa, dan ✦ kalau kalimatnya baru (gak ada di data training).
3. **Grammar checker** (`assets/js/grammar.js`): aturan frasa/kata salah dari `data/grammar_rules.json`, aturan di-/ke- bahasa Indonesia, dan pengecek typo pake 80 ribu kata paling umum (Indo + English): kata yang gak dikenal tapi beda 1 huruf dari kata umum = typo. Slang, singkatan chat, dan ketawa (wkwk) gak dihitung typo.
4. **Search** (`assets/js/search.js`): parser pertanyaan Indo/English ngenalin ~35 jenis relasi (ibu kota, presiden, CEO, pendiri, penduduk, mata uang, bahasa, luas, tinggi, umur, lahir, tempat lahir, meninggal, pasangan, penemu, penulis, sutradara, benua, didirikan, agama, klub, kantor pusat…). Subjeknya dicari di Wikipedia (redirect + "did you mean" buat typo) → ID Wikidata-nya → properti yang ditanya (yang masih berlaku, bukan yang udah lewat; populasi diambil yang paling baru). Kalo bukan pertanyaan fakta, ambil ringkasan Wikipedia. Search otomatis jalan kalo pesannya pertanyaan dan bukan soal lu/gw (pertanyaan kayak "kenapa lu jahat" tetep dibales roast, bukan di-search).

Total ~1,7 juta parameter chatbot + ~670 ribu parameter generator gambar. `model/brain.json` ~2,4 MB, `model/pixels.json` ~950 KB, `model/lexicon.json` ~650 KB (int8 quantized).

### Kenapa Wikipedia/Wikidata, bukan Google langsung?

Jujur aja: hasil Google gak bisa diambil dari situs statis tanpa API key. Google Custom Search API butuh API key (dan bayar kalo banyak), dan google.com nge-block halaman dari situs lain yang mau baca hasil search-nya (CORS). Wikipedia & Wikidata gratis, gak butuh key, dan ngizinin dibaca dari browser. Wikidata malah lebih cocok buat pertanyaan fakta karena isinya data terstruktur (bukan teks yang harus ditebak). Tiap hasil tetep ada link **buka di Google**.

Batasannya: pertanyaan yang gak ada di Wikipedia/Wikidata (berita hari ini, harga, cuaca, pertanyaan "kenapa" yang rumit) gak bakal kejawab bagus.

> Jujur juga soal "pinter": ini model kecil yang dilatih dari ~800 contoh balesan dan ~2000 pola chat, jadi jelas gak sepinter ChatGPT. Dia jago di hal yang dilatihin (roasting, ngobrol santai Indo/English, milih pilihan lu terus ngehate, matematika, inget-inget lu, nyari di Wikipedia, ngoreksi typo), tapi dia gak bisa nalar panjang atau jawab pertanyaan rumit.

**Soal "kys"**: bot ini gak pernah bilang kys. Kalau lu ngetik itu ke dia, dia cuma bales roast biasa. Dan kalau ada yang beneran ngomong soal pengen bunuh diri / nyakitin diri sendiri, bot berhenti bercanda dan ngasih info bantuan (Indonesia: 119 ext 8).

## Connect key: pake sybau di app lain

Ketik `/connect` (atau Settings → Connect key). Key-nya selalu sama, di mana aja, kapan aja:

```
sybau-ck-7f3a9c2e1b8d4f60a5e3
```

**HTML mana pun:**

```html
<script src="https://osnailcyargta-ctrl.github.io/ai/sybau.js"></script>
<script>
  const sybau = new Sybau({ connectKey: "sybau-ck-7f3a9c2e1b8d4f60a5e3" });
  sybau.chat("halo").then((r) => console.log(r.full));
  // r = { text, intent, lang, search, followup, grammar, image, full }
</script>
```

**Widget chat siap pakai:**

```html
<iframe src="https://osnailcyargta-ctrl.github.io/ai/embed.html?key=sybau-ck-7f3a9c2e1b8d4f60a5e3" width="420" height="600" style="border:0"></iframe>
```

Halaman induk juga bisa ngirim pesan ke widget: `iframe.contentWindow.postMessage({ type: "sybau:chat", text: "halo" }, "*")`, terus balesannya dateng sebagai `{ type: "sybau:reply", reply }`.

**Node.js 18+:** download `sybau.js`, terus

```js
const { Sybau } = require("./sybau.js");
const sybau = new Sybau({ connectKey: "sybau-ck-7f3a9c2e1b8d4f60a5e3" });
const r = await sybau.chat("roast me");
```

Opsi: `lang` (`"auto"|"id"|"en"`), `search`, `grammar`, `memory` (`false` = gak nyimpen apa-apa), `baseUrl`. Fungsi lain: `sybau.draw("kucing")` (ada `didYouMean` kalo namanya dikoreksi), `sybau.learnText(nama, isi)`, `sybau.reset()`.

**Jujur soal cara kerjanya:** ini beda sama API key Claude. GitHub Pages cuma bisa nyimpen file, gak bisa jalanin server, jadi gak ada server sybau yang bisa dipanggil. `sybau.js` download otak sybau (`model/*.json`, GitHub Pages ngizinin diambil dari situs mana aja) terus ngejalanin neural net-nya **di dalem app lu sendiri**. Untungnya: gratis, gak ada limit, gak bisa down selama github.io idup. Batasannya:
- cuma jalan di lingkungan JavaScript (web page apa aja, Node.js, Electron, dll). App Python/Java/dll belum bisa langsung pake.
- connect key-nya bukan rahasia (keliatan di kode), cuma buat ngecek lu pake sybau yang bener.

## Struktur folder

```
data/                 data training (edit ini buat ngubah kepribadian)
  intents.json          patterns (contoh chat user) + responses (contoh jawaban bot), 55 intent
  fillers.json          kata pengisi buat augmentasi ({N} nama, {T} hal, {A}/{B} pilihan, {M} matematika, {Y} umur, {Q} topik search)
  roasts.txt            roast tambahan, satu per baris
  sprites.txt           31 gambar pixel 16x16 (teks) buat ngelatih generator gambar
  slang_id.json         kamus slang/singkatan Indonesia + kata penanda bahasa Indonesia
  grammar_rules.json    aturan grammar & ejaan yang di-roast
  lexicon/              80rb kata paling umum (en + id), buat cek typo
training/
  train.py              training kedua network (numpy) -> model/brain.json + model/lexicon.json
  train_pixels.py       training generator gambar (numpy) -> model/pixels.json
  textproc.py           normalisasi teks + hashing (dicerminkan persis di brain.js)
model/                  hasil training (dipake website)
assets/js/
  brain.js              inference neural net di browser
  bot.js                memori, tools, pipeline balesan
  grammar.js            polisi grammar
  search.js             parser pertanyaan + Wikidata/Wikipedia
  pixels.js             generator gambar + baca gambar upload-an
  learn.js              belajar dari file yang di-upload
  app.js                UI terminal (commands, autocomplete, settings)
sdk/core.js             SDK publik (connect key)
sybau.js                bundle SDK (dibikin tools/build_sdk.py, jangan diedit langsung)
embed.html              widget chat buat iframe
index.html, assets/css/style.css
tests/                  cek JS == Python, akurasi, grammar, simulasi chat
```

## Training ulang

```bash
pip install -r requirements.txt
python training/train.py          # chatbot: gradient check, validasi, training, export
OMP_NUM_THREADS=1 python training/train_pixels.py   # generator gambar (~1 menit; 1 thread malah lebih cepet)
python tools/build_sdk.py         # bikin ulang sybau.js kalo ada file assets/js yang diubah
python tests/parity.py            # pastiin JS ngitung sama persis kayak Python (butuh node)
node tests/grammar.js             # cek polisi grammar (gak boleh salah roast kalimat bener)
node tests/search.js              # tes jawaban pertanyaan (pake Wikipedia/Wikidata palsu, tests/fake_wiki.js)
node tests/chat.js                # simulasi obrolan di terminal (search pake Wikipedia palsu)
python -m http.server 8765 & node tests/sdk.js   # SDK sybau.js dari "app lain"
node tests/chat.js "roast gw" "mending kucing atau anjing?" "cari jakarta"
```

Mau nambah slang atau roast? Tambahin aja ke `data/intents.json` / `data/roasts.txt` / `data/slang_id.json`, jalanin `train.py`, commit folder `model/`. Mau nambah gambar? Gambar 16×16 pake huruf palette di `data/sprites.txt`, jalanin `train_pixels.py`.

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

Daftar kata di `data/lexicon/` dari [hermitdave/FrequencyWords](https://github.com/hermitdave/FrequencyWords) (OpenSubtitles 2018), lisensi CC BY-SA 4.0. Font: JetBrains Mono (Google Fonts). Fakta dari Wikidata (CC0), ringkasan dari Wikipedia (CC BY-SA).
