# sybau.ai 🥀

Chatbot brainrot yang **benci kamu**. Beda dari AI lain yang baik dan selalu setuju sama apapun pilihan lu, yang ini nge-roast semua pilihan lu dan ngomong pake slang TikTok 2026 (stfu, idc, sybau, ts pmo, who asked, cooked, mid, aura, lil bro, clanker…), plus 🥀 kalo lagi nge-roast. Emoji cuma ada di balesan sybau, tampilannya sendiri tanpa emoji. Semua ini buat **lucu-lucuan doang**.

- **AI beneran, bukan n-gram**: 2 neural network yang dilatih dari nol pake Python + numpy (backprop ditulis manual, ada gradient check, gak pake PyTorch/TensorFlow).
- **Ngerti bahasa Indonesia**: termasuk bahasa gaul & singkatan (`gk`, `bgt`, `yg`, `gw/gue/aku`, `lu/lo/km`, `wkwk`...). Bales pake bahasa yang lu pake: ngetik Indo dibales Indo, ngetik English dibales English.
- **2 tab kayak Claude / Claude Code**: tab **s** buat ngobrol sama sybau, tab **sc** (sybau code) buat bikin game/app HTML + CSS + JavaScript. Tab terakhir diinget, `#sc` di URL langsung buka sybau code.
- **Tampilan terminal ala Claude CLI**: slash command dengan autocomplete (`/help`, `/settings`, `/lang`, `/search`, `/grammar`, `/memory`, `/brain`, `/theme`, `/clear`, `/forget`…), spinner, tampilan tool call (`⏺ Wikidata(...)` → `⎿ hasil`), diff merah/ijo buat koreksi grammar, riwayat pesan pake ↑↓, `esc` buat stop jawaban.
- **Tombol ⚙ settings** di atas (atau `/settings`): bahasa balesan (auto / indo / english), auto search on/off, polisi grammar on/off, tampilin otak (debug), tema (auto / classic / light / terminal / cyberpunk / dracula / amber / ocean / paper). Disimpen di browser.
- **Auto search, gak perlu bilang "cari"**: nanya aja. "ibukota kazakstan" → **Astana**, "berapa umur elon musk" → umurnya dihitung dari tanggal lahir, "siapa presiden amerika serikat" → yang *sekarang*, "jumlah penduduk indonesia" → data terbaru. Pertanyaan fakta dijawab dari **Wikidata** (database fakta di balik Wikipedia), pertanyaan "apa itu X" dijawab pake ringkasan **Wikipedia**. Toleran typo ("kazakstan" tetep ketemu). Abis itu tetep nge-roast lu karena gak bisa googling sendiri.
- **Polisi grammar**: typo, salah ejaan, atau grammar jelek langsung di-roast ("your welcome", "definately", "silahkan", "dirumah" → "di rumah", "di makan" → "dimakan", typo kayak "beljar"). Dia juga ngitung udah berapa kali lu salah.
- **Generator gambar (beta)**: "gambar kucing", "draw a skull", "gambar kucing api" (dicampur), "/draw naga 32". Nama gambarnya dicocokin ke database dulu; kalo salah ketik, dia nyari nama yang paling mirip dan bilang **did you mean ...?** ("draw catt" → *did you mean cat?* terus digambar). Neural net decoder yang dilatih dari 31 sprite di `data/sprites.txt`, gambar 16×16 (32×32 = di-upscale pake Scale2x). Datanya masih dikit jadi hasilnya masih bego, sesuai label beta.
- **Connect key** (`/connect`): pake sybau di HTML/app lain. Lihat bagian *Connect key* di bawah.
- **Mode eksperimental** (⚙ settings, default mati): kalo sybau gak punya data buat kata/kalimat lu, dia nyoba mahamin dulu baru jawab: benerin typo & huruf molor ("gabutt bgtt" → "gabut banget"), nyari contoh training yang artinya paling deket, dan kalo masih gak ngerti, nyari arti katanya di Wikipedia. Proses mikirnya keliatan di blok *thinking*.
- **Roast generatif** (⚙ settings, default nyala): transformer-nya wajib ngarang kalimat baru. Kalimat yang sama persis kayak data training dibuang, yang mirip banget dikurangin nilainya. Biar dia beneran bisa ngarang (bukan ngafalin 800 kalimat), dia dilatih juga pake ribuan roast yang dirakit dari potongan (`data/roast_parts.json`: subjek, perbandingan, punchline), jadi yang dia pelajarin pola bikin roast-nya.
- **Tanpa API key**: semua jalan di browser lu. Gak ada server, gak ada ChatGPT.
- **Punya memori**: inget nama, umur, hal yang lu suka/benci, yang pernah lu cari, berapa kali lu ngehina dia, dosa grammar lu, dan history chat (disimpen di `localStorage` browser lu).
- **Jujur**: kalo gak ngerti, dia bilang gak ngerti. Jawaban matematika, jam, tanggal, memori, dan hasil search diambil dari tools/data beneran, bukan dikarang.
- **Bisa dimainin di GitHub Pages** (situs statis).

## Cara kerjanya

```
pesan user ─► normalisasi slang (gk→gak, lu→kamu, wkwkwk→wkwk) + deteksi bahasa
          ─► Classifier MLP ─► intent (insult / choice / search / math / greeting / ... 50 intent)
          ─► tools: matematika, jam, tanggal, parsing "A atau B", query search, memori
          ─► Transformer generator (prefix <intent> <bahasa>) ─► nulis balesan kata per kata
          ─► isi placeholder {name} {thing} {query} ... dari memori/tools
          ─► grammar checker ─► kalo ada typo, transformer nulis roast grammar {wrong}→{right}
          ─► (kalo pertanyaan) parser pertanyaan ─► Wikidata (fakta) / Wikipedia (ringkasan) ─► hasil + roast penutup
```

1. **Intent classifier**: input = hashed bag-of-words + bigram + char trigram + kata pertama (4096 dim) → 320 ReLU → softmax 52 intent. Data training di-augmentasi otomatis (typo, singkatan, kata tambahan, huruf kapital, slot diisi random) jadi ~14 ribu contoh.
2. **Response generator**: **Transformer** kecil ala GPT yang ditulis dari nol di numpy (`training/transformer.py`): 5 layer, 4 attention head, d=208, causal self-attention, feed-forward GELU, pre-LayerNorm, backprop manual + gradient check. Dikondisikan pake token awalan `<i:insult> <l:id> <s>` biar tau mau ngomong apa dan pake bahasa apa. Di browser jalan pake KV cache (`assets/js/brain.js`), dan `tests/parity.py` ngecek hasilnya sama persis kayak Python. Tiap balesan di-*sample* kata per kata (temperature + nucleus/top-p). Bot bikin 10 kandidat, buang yang placeholdernya gak bisa diisi jujur, yang barusan dipake, atau yang bahasanya gak cocok, terus pilih yang skornya paling tinggi. Nyalain 🧠 **OTAK** buat liat intent, confidence, bahasa, dan ✦ kalau kalimatnya baru (gak ada di data training).
3. **Grammar checker** (`assets/js/grammar.js`): aturan frasa/kata salah dari `data/grammar_rules.json`, aturan di-/ke- bahasa Indonesia, dan pengecek typo pake 80 ribu kata paling umum (Indo + English): kata yang gak dikenal tapi beda 1 huruf dari kata umum = typo. Slang, singkatan chat, dan ketawa (wkwk) gak dihitung typo.
4. **Search** (`assets/js/search.js`): parser pertanyaan Indo/English ngenalin ~35 jenis relasi (ibu kota, presiden, CEO, pendiri, penduduk, mata uang, bahasa, luas, tinggi, umur, lahir, tempat lahir, meninggal, pasangan, penemu, penulis, sutradara, benua, didirikan, agama, klub, kantor pusat…). Subjeknya dicari di Wikipedia (redirect + "did you mean" buat typo) → ID Wikidata-nya → properti yang ditanya (yang masih berlaku, bukan yang udah lewat; populasi diambil yang paling baru). Kalo bukan pertanyaan fakta, ambil ringkasan Wikipedia. Search otomatis jalan kalo pesannya pertanyaan dan bukan soal lu/gw (pertanyaan kayak "kenapa lu jahat" tetep dibales roast, bukan di-search).

Total **4,9 juta parameter** chatbot (4.883.655: classifier 1,3 juta + transformer 3,5 juta, 5 layer, d=208) + ~670 ribu generator gambar + **9,1 juta** sybau code (transformer penulis HTML 6,7 juta + pembaca maksud 2,4 juta). `model/brain.json` ~4,5 MB, `model/htmlcode.json` ~9 MB, `model/codenlu.json` ~3 MB, `model/pixels.json` ~950 KB, `model/lexicon.json` ~650 KB (int8 quantized).

### Kenapa Wikipedia/Wikidata, bukan Google langsung?

Jujur aja: hasil Google gak bisa diambil dari situs statis tanpa API key. Google Custom Search API butuh API key (dan bayar kalo banyak), dan google.com nge-block halaman dari situs lain yang mau baca hasil search-nya (CORS). Wikipedia & Wikidata gratis, gak butuh key, dan ngizinin dibaca dari browser. Wikidata malah lebih cocok buat pertanyaan fakta karena isinya data terstruktur (bukan teks yang harus ditebak). Tiap hasil tetep ada link **buka di Google**.

Batasannya: pertanyaan yang gak ada di Wikipedia/Wikidata (berita hari ini, harga, cuaca, pertanyaan "kenapa" yang rumit) gak bakal kejawab bagus.

### Gimana sybau code nulis game (HTML + CSS + JavaScript)

Gak ada template, gak ada perencana. Dua neural network yang dilatih dari nol:

**1. Pembaca maksud (code NLU, `training/train_codenlu.py`, 2,4 juta parameter).** Sebelum nulis apa-apa, dia baca tiap kata buat tau lu mau apa: **bikin baru** ("bikin game ninja vs zombie", "hapus dan bikin game baru"), **nambahin** ("tambahin bos naga"), **ubah setting** ("ubah speed jadi 10", "nyawanya 5 aja", "background merah", "lebih cepet"), **ganti benda** ("ganti zombie jadi alien", "musuhnya jadi hantu"), **hapus benda** ("hapus zombienya", "delete su"), **hapus semua**, **balikin** (undo), **nanya** ("variabelnya apa aja?", "cara mainnya gimana", "kenapa error") atau **cuma ngobrol** ("lu goblok", dibales sama AI chat). Dia juga nandain kata mana yang benda, setting, dan nilai. Dilatih dari ~70 ribu kalimat (Indo, English, slang, typo), jadi maksudnya ditangkep dari kata-katanya, bukan dari `/`, `?`, atau `!`. Tesnya pake kalimat tulisan tangan yang gak ada di data training: `node tests/codenlu.js`.

**2. Transformer penulis kode (`training/train_html.py`, 6,7 juta parameter, 5 layer, d=256, konteks 1024 token).** Nulis **seluruh halaman HTML token per token**: tiap tag, aturan CSS, keyword JavaScript, angka, dan emoji keluar dari network-nya sendiri. Selama nulis, kurung `( [ {`, string, dan komentar dijaga biar halamannya tetep utuh. Tiap hasil **dijalanin dulu di sandbox** (dipencet tombolnya, diklik); kalo ada error JavaScript atau layarnya kosong, dibuang dan ditulis ulang (3 percobaan, 6 kalo deepthink). Kalo tetep gagal, dia bilang jujur, gak ada cadangan template.

Bahan latihannya **111 game & app HTML yang aku tulis tangan** (`data/html/games/`: snake, pong, breakout, flappy, platformer, tetris, pacman, tower defense, RPG, tic tac toe, kuis, kalkulator, todo, piano, dll; `node tools/check_html.js` buka semuanya di browser beneran dan ngecek gak ada error). Tiap game dijadiin 40 variasi (`tools/make_html_corpus.js`): bendanya dituker sama benda lain sejenis dari `data/html/things.json` (~270 benda, nama Indo + English + emoji), request Indo/English dengan pembuka beda-beda, dan modifier yang beneran ngubah kodenya ("pake 5 nyawa" → `let lives = 5`, "yang cepet", "background merah"). Benda di request jadi slot (`<t1> zombie`), jadi dia bisa nyalin kata apa aja ke game, termasuk kata yang belum pernah dia liat.

**Ngedit beneran ngubah kodenya.** Tiap game punya blok setting di atas script (`let speed = 4; // kecepatan pemain`). "ubah kecepatan zombie jadi 2" dicocokin ke nama variabel *dan* komentarnya, terus nilainya diganti. Ganti benda nuker nama + emojinya. Tiap perubahan dites jalan dulu; kalo bikin error, gak dipake. Semua versi disimpen, jadi bisa "balikin". Chat, kode, dan project terakhir disimpen di browser.

Jujurnya: 6,7 juta parameter itu kecil banget (ChatGPT ratusan miliar), dan datanya 111 game. Jadi dia jago bikin game yang mirip-mirip yang dia pelajari (dengan benda dan setting apa aja), tapi belum bisa nulis program yang bener-bener baru dan rumit.

> Jujur juga soal "pinter": ChatGPT itu ratusan miliar parameter yang dilatih dari sebagian besar internet; sybau 4,9 juta. Jadi "selalu tau apapun" gak mungkin buat model sekecil ini, makanya dia pake tools (Wikidata/Wikipedia, kalkulator, memori) dan mode eksperimental buat nutupin yang dia gak tau. Ini model kecil yang dilatih dari ~800 contoh balesan dan ~2000 pola chat, jadi jelas gak sepinter ChatGPT. Dia jago di hal yang dilatihin (roasting, ngobrol santai Indo/English, milih pilihan lu terus ngehate, matematika, inget-inget lu, nyari di Wikipedia, ngoreksi typo), tapi dia gak bisa nalar panjang atau jawab pertanyaan rumit.

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
  html/games/           111 game & app HTML/CSS/JS tulisan tangan (bahan latihan transformer kode)
  html/things.json      ~270 benda: nama Indo + English + emoji, dikelompokin (pemain, musuh, item, peluru, kendaraan...)
  sprites.txt           31 gambar pixel 16x16 (teks) buat ngelatih generator gambar
  slang_id.json         kamus slang/singkatan Indonesia + kata penanda bahasa Indonesia
  grammar_rules.json    aturan grammar & ejaan yang di-roast
  lexicon/              80rb kata paling umum (en + id), buat cek typo
training/
  train.py              training kedua network (numpy) -> model/brain.json + model/lexicon.json
  transformer.py        transformer GPT kecil dari nol (forward + backprop manual + gradient check)
  train_codenlu.py      pembaca maksud sybau code (intent + penanda kata) -> model/codenlu.json
  train_html.py         transformer penulis HTML/CSS/JS -> model/htmlcode.json
  train_pixels.py       training generator gambar (numpy) -> model/pixels.json
  textproc.py           normalisasi teks + hashing (dicerminkan persis di brain.js)
model/                  hasil training (dipake website)
assets/js/
  brain.js              inference neural net di browser
  bot.js                memori, tools, pipeline balesan
  grammar.js            polisi grammar
  search.js             parser pertanyaan + Wikidata/Wikipedia
  pixels.js             generator gambar + baca gambar upload-an
  learn.js              belajar dari teks (cuma buat SDK, di web udah dihapus)
  codenlu.js            pembaca maksud sybau code di browser
  htmltok.js            tokenizer HTML/CSS/JS (bolak-balik tanpa rusak)
  htmlreq.js            request -> prompt transformer (slot benda)
  htmlneural.js         transformer penulis kode di browser (KV cache, decoding yang jaga kurung/string)
  htmlcoder.js          sybau code: maksud -> nulis / edit / jawab, tes jalan di sandbox
  code.js               UI tab sc
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
python training/train_codenlu.py  # pembaca maksud sybau code (~5 menit)
node tools/make_html_corpus.js && python training/train_html.py   # transformer penulis HTML (lama, ~5 jam di 4 core)
OMP_NUM_THREADS=1 python training/train_pixels.py   # generator gambar (~1 menit; 1 thread malah lebih cepet)
python tools/build_sdk.py         # bikin ulang sybau.js kalo ada file assets/js yang diubah
python tests/parity.py            # pastiin JS ngitung sama persis kayak Python (butuh node)
node tests/grammar.js             # cek polisi grammar (gak boleh salah roast kalimat bener)
node tests/search.js              # tes jawaban pertanyaan (pake Wikipedia/Wikidata palsu, tests/fake_wiki.js)
node tools/check_html.js          # 111 game tulisan tangan dibuka di browser beneran, gak boleh error
node tests/codenlu.js             # pembaca maksud vs kalimat tulisan tangan
node tests/htmlcoder.js           # edit: setting, background, ganti benda, undo, hapus
node tests/htmlneural.js          # transformer nulis game buat 16 request, semua dijalanin di browser
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

Daftar kata di `data/lexicon/` dari [hermitdave/FrequencyWords](https://github.com/hermitdave/FrequencyWords) (OpenSubtitles 2018), lisensi CC BY-SA 4.0. Font: JetBrains Mono (Google Fonts). Bahasa STS, compiler & VM-nya (`assets/sts/sts.wasm`, `data/sts/`) dari [osnailcyargta-ctrl/STS-programing](https://github.com/osnailcyargta-ctrl/STS-programing). Fakta dari Wikidata (CC0), ringkasan dari Wikipedia (CC BY-SA).
