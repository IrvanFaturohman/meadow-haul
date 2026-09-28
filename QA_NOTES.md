# QA Notes — Meadow Haul prototype

Tanggal: 2026-09-28. Build: `npm run build` sukses (JS 743 KB / 203 KB gzip, CSS 16 KB). `npm run typecheck` bersih. `npm run test`: **40 tes lolos** (4 file).

## Lingkungan pengujian (apa adanya)

- macOS (Darwin 25.6), Node 25.9.0, Chrome 153 desktop dikendalikan lewat browser automation.
- **Tidak ada pengujian di perangkat ponsel fisik.** Ukuran ponsel hanya diemulasikan dengan memaksa ukuran frame (`?frame=390x844`, `360x640`, `430x932`) di Chrome desktop.
- Selama sesi, tab automation dilaporkan `document.hidden = true` (jendela tidak terlihat di layar), sehingga `requestAnimationFrame` tidak berjalan. Untuk pemeriksaan visual, frame game dijalankan manual dari konsol (`meadow.frameStep(t)` dengan dt 16.7 ms) dan input diberikan lewat event keyboard/pointer sintetis. Konsekuensinya: **FPS real-time tidak terukur**, dan transisi CSS (slide panel) tidak teranimasi di screenshot.
- Audio: `AudioContext` terverifikasi `running` setelah klik nyata; jumlah voice, rate-limit, dan pelepasan voice diperiksa lewat `getDebugInfo()`. **Suara belum didengar oleh manusia**; level puncak tiap resep diukur dengan render offline (lihat bagian Audio).

## Tes otomatis (vitest)

`tests/field.test.ts`, `tests/economy.test.ts`, `tests/simulation.test.ts`, `tests/pacing.test.ts`:

- Memotong satu sel berulang tidak memberi unit baru sebelum replant; HP butuh kontak nyata (Meadow 1 HP @ 4 DPS ≈ 0.25 s).
- Yield tidak bergantung frame rate (dt 1/30, 1/60, 1/144 dibandingkan); sapuan sangat cepat tidak melewatkan sel (swept substep).
- Vacuum tidak mengambil tanaman hidup; tiap unit lepas pindah ke depot tepat sekali; intake 16 unit/s via akumulator; berhenti di kapasitas dan sisa tetap di tanah.
- Batas reach elastis (memberi sedikit, memantul balik) dan tetap bisa bergerak tangensial; baris dekat terjangkau selebar ladang; akselerasi ≤ ~100 ms, berhenti ≤ ~100 ms; reach maksimum mencakup sudut terjauh.
- Replant hanya sel `COLLECTED`; cuttings, depot, uang tidak berubah; tidak menggandakan barang; aksi panen diblokir selama replant.
- Biaya upgrade sesuai rumus, MAX, wallet tidak negatif, double-click tidak membeli dua kali; hauler 220/180/300.
- Bale 10 unit, storage = raw + qty bale (tanpa hitung ganda); mini-bale menyimpan kuantitas dan harga proporsional (mis. 7 Meadow = 5.60).
- Truk dibayar per bale tepat sekali, tidak melebihi 8, keberangkatan tidak membayar ulang; pending cash tidak bisa diambil dua kali; XP 5 per 10 unit dengan akumulator.
- Player dan hauler tidak memiliki bale yang sama; hauler benar-benar mengangkut ke truk (juga saat pemain di mode harvest).
- Alur penuh dari save baru tanpa debug: cut → vacuum → pickup → deliver → cash (48) → beli Blade (sisa 13).
- Save/load: round-trip tanpa penjualan ulang, save rusak ditolak tanpa crash, nilai di luar batas di-clamp; continue di atas pad UPGRADE tidak membuka panel otomatis; input diabaikan saat transisi.
- Konservasi unit (`standing + loose + raw + depot + carry + hauler + sold = planted`) dicek di beberapa tes.

## Pemeriksaan manual di browser (desktop Chrome, frame diemulasikan)

| Pemeriksaan | Hasil |
|---|---|
| Layar judul → Play → farm; tutorial "Walk to the harvester" + panah di pad | OK |
| Pad HARVEST → transisi kamera ~460 ms → harvest; input nol selama transisi | OK |
| Blade: jalur tanah + stubble + potongan lepas, debris & debu, selang melengkung | OK (`qa/screenshots/02-*`) |
| Tutorial maju ke "Switch tools…" setelah ~60 unit Meadow, lalu "Vacuum… x/6 bales packed", lalu "Back to farm" | OK |
| Vacuum: nozzle terlihat, ring radius, pulsa selang, 9 bale muncul di pallet | OK (`03-*`) |
| Batas reach: selang lurus & tegang, tanpa lingkaran batas, hint "Upgrade reach to harvest farther" setelah ~0.6 s dorongan (revisi) | OK |
| Farm: pickup 6 bale (tumpukan di punggung, `6/6`, toast hands full), deliver ke truk (`6/8`), +48 di pad uang, Level 2, goal "Sell six bales" | OK (`04-*`, `05-*`) |
| Workshop: current → next, "Need X more", MAX; beli Blade (48 → 13), klik ganda tidak membeli dua kali; lampu workshop menyala | OK (`06-*`) |
| Storage penuh (24/24) … | Dihapus pada revisi: depot tanpa batas |
| Pack leftovers: tombol muncul di dekat depot bila ada sisa & tidak ada bale utuh; menghasilkan mini-bale 7 dan 3 unit | OK (kondisi disiapkan via konsol) |
| Replant: 125 sel `COLLECTED` tumbuh (gelombang), 121 sel dengan cuttings tetap, uang/bawaan tetap; lalu tombol "Collect cuttings first" | OK |
| Hauler: hire lewat pad (menunggu 0.7 s), mengambil 4 bale, memuat truk sampai penuh, menunggu di antrean saat truk pergi, penjualan ke pad uang | OK (uang tambahan via debug) |
| Joystick sentuh: muncul di titik sentuh, radius 52 px @390, arah sesuai layar; jari kedua pada tombol tidak mengambil alih; `pointercancel` melepas | OK (pointer event sintetis) |
| Settings: slider bus, mute, kualitas Low/Med/High/Auto, motion, shake, tersimpan di localStorage; `Esc` menutup/membuka | OK |
| Reload/continue: wallet, upgrade, truk (`LOADING 6/8`), sold ledger, tutorial pulih | OK |
| 360×640 dan 430×932: HUD tidak terpotong; coach dipindah ke baris ketiga saat harvest (diperbaiki); label dunia di-clamp ke frame (diperbaiki) | OK setelah perbaikan |
| Build produksi (`npm run preview`) memuat tanpa pesan error/warning di konsol | OK |

Bug yang ditemukan dan diperbaiki selama QA: path tanah berdiri tegak (urutan Euler), stubble tampak seperti bintang gelap (offset horizontal tidak diskalakan), potongan lepas gelap (normal sisi belakang), kepala alat tenggelam di rumput (hub dipasang di tiang), panel workshop terbuka otomatis saat *Continue* di atas pad, panel bisa muncul lagi setelah ditutup sangat cepat (race `requestAnimationFrame`), bubble coach bertumpuk dengan meter storage di 360 px, kamera farm memotong pad STORAGE di tepi.

## Angka performa yang benar-benar teramati

Diukur di Chrome 153 desktop (Mac, 10 core), frame 390×844, tab tersembunyi dengan frame dijalankan manual. **Waktu = CPU per `frameStep`** (simulasi + update scene + submit render), bukan FPS; waktu GPU tidak termasuk.

| Kualitas | Mode | Draw calls | Segitiga | CPU ms/frame | Pixel ratio | Shadows |
|---|---|---:|---:|---:|---:|---|
| Low | Farm / Harvest | 74 / 68 | 146k / 184k | 0.24 / 0.44 | 1.0 | off |
| Medium | Farm / Harvest | 103 / 92 | 304k / 407k | 0.28 / 0.29 | 1.5 | 1024 |
| High | Farm / Harvest | 103 / 92 | 329k / 447k | 0.44 / 0.48 | 1.6 (dpr) | 2048 |

Uji kebocoran: ~6.600 frame dengan pergantian mode/alat berulang → geometri 84, tekstur 10, program shader 20, node DOM 445 — stabil antar putaran. Partikel aktif kembali ≈ 0 saat idle; voice audio kembali ke 0 setelah burst.

Belum terukur: FPS nyata di desktop maupun ponsel. Mode `Auto` memilih High di desktop, Medium/Low di perangkat sentuh (berdasarkan jumlah core), dan menurunkan satu tingkat bila rata-rata < 40 FPS selama 4 detik.

## Audio (hasil ukur level, bukan dengar)

Semua suara prosedural lewat bus `master/sfx/ambience/music` → headroom 0.8 → kompresor ringan. Puncak terukur (bus volume 1): cut 0.19–0.38, vacuum grain ~0.16, pack/pickup/drop 0.28/0.23/0.25, cash 0.17–0.20, upgrade/level-up 0.19/0.27, UI 0.12–0.14, footstep 0.08–0.11, loop blade 0.07–0.20, loop vacuum 0.10–0.19, angin ~0.09, burung ~0.04, musik ≤ 0.05 per voice. Rate-limit potong 15 burst/s (sisanya masuk ke layer load), polyphony 24, cooldown per suara. Mute & slider tersimpan.

## Pacing (bot, bukan playtest manusia)

`tests/pacing.test.ts` menjalankan simulasi asli dengan bot yang cukup efisien (menyapu baris, menyedot, mengangkut, membeli upgrade). Dua rencana belanja, detik simulasi:

| Milestone | upgrades-first | hauler-early |
|---|---:|---:|
| Potongan pertama | 1 | 1 |
| Bale pertama | 22 | 22 |
| Penjualan pertama | 34 | 34 |
| Uang pertama diambil | 36 | 36 |
| Upgrade pertama (Blade) | 49 | 49 |
| Reach Lv 2 | 49 | 49 |
| Hauler | 274 (≈4.6 menit) | 157 (≈2.6 menit) |
| Clover pertama dipotong | 181 | 351 |
| Reach Lv 6 | 767 | 701 |

(Angka setelah revisi bentuk jangkauan; sebelum revisi hasilnya hampir sama.)

Bot versi lama yang selalu membeli item termurah mencapai Golden Grass di ≈556 s dan reach maksimum di ≈748 s. Kesimpulan sementara: target brief (potong < 5 s, penjualan pertama 30–60 s, upgrade setelah muatan 6 bale, hauler menit 3–6, konten ≈10–20 menit) **konsisten dengan bot**, tetapi bot lebih cepat dari pemain baru (tidak membaca tutorial, rute optimal). Perlu playtest manusia sebelum mengklaim target tercapai.

## Revisi setelah feedback (jangkauan selang)

Feedback: di batas maksimum selang tampak longgar, lingkaran pembatas terasa aneh, bentuk batas terlalu bulat sehingga sisi kiri–kanan baris dekat tidak terjangkau, dan saat mentok terasa seperti menabrak tembok.

- **Bentuk batas**: bukan lingkaran lagi, tetapi elips yang lebih lebar daripada dalam di sekitar anchor (`REACH_SHAPE` di `balance.ts`: `sideStretch 1.4`, `power 2`). Reach Lv 1 menjangkau seluruh lebar ladang pada baris dekat (tes: x = ±5.7 pada z 1.3–3.4), kedalaman lurus ke depan tetap `6.5 + 2.8 × (level − 1)`, dan reach maksimum tetap mencakup sudut terjauh. (Iterasi pertama memakai superellipse `power 3, sideStretch 1.6`; tepinya terlalu datar di tengah sehingga panjang selang di batas tengah 6.6 vs 8.6 di diagonal dan tengah terasa "longgar". Dengan elips: 6.6 vs ±7.6 di dalam ladang, dan ujung atas membulat.)
- **Batas elastis**: saat didorong melewati batas, kepala alat "memberi" sedikit dengan tahanan yang makin besar (maks 0.5 unit, ±0.2 unit saat ditahan), lalu memantul kembali ke batas dalam ~0.2 s saat dorongan dilepas; gerak menyusur batas tetap lancar.
- **Selang tegang**: mendekati batas, reel menggulung dan rantai Verlet ditarik ke garis lurus anchor→kepala (gravitasi & kecepatan diredam saat tegang); diukur di simulasi: deviasi maksimum dari garis lurus di batas 0.000 unit di tengah, diagonal, dan samping (sebelumnya 0.42–0.70 unit — itu sebab selang tampak longgar walau secara logika sudah di batas); saat elastis tertarik, selang menipis dan warnanya terang, kepala alat condong ke arah mesin, dan ada efek "twang" kecil saat pertama menyentuh batas.
- **Tanpa lingkaran pembatas**: cincin batas dihapus. Setelah upgrade Hose Length, tanaman yang baru terjangkau berpendar keemasan sebentar (diputar ulang saat masuk harvest berikutnya). Hint teks "Upgrade reach to harvest farther" tetap ada.
- Diverifikasi: tes vitest (38 lolos) + cek visual di Chrome (selang lurus di batas, sisi ±5.8 terjangkau, pendar baris baru).

## Revisi setelah feedback (vacuum & storage)

Feedback: menyedot kurang memuaskan (area yang tersedot kecil, potongan rumput tampak aneh); lalu "jangan ada storagenya".

- **Vacuum**: intake 16 → **60 unit/s** (+25%/level) dan radius 1.2 → **1.5** (+0.15/level). Dengan 16/s, satu sapuan (±60–90 potongan/detik yang dilewati) meninggalkan sebagian besar potongan; sekarang sapuan bersih.
- **Visual potongan**: bukan serpihan pipih lagi, tetapi gundukan rumput potong bervolume (13 helai melingkar + bilah tegak) yang saling tumpang-tindih menjadi karpet, warna segar per tier dengan variasi.
- **Juice sedot**: potongan dalam 1.8× radius tertarik, berputar, dan terangkat ke arah nozzle (shader); yang tersedot terbang spiral makin cepat dan mengecil masuk mulut nozzle (+ serpihan kecil); partikel "angin" mengalir ke nozzle; nozzle "menelan" (squash spring) dan berdengung sesuai intake; pulsa selang diberi jarak agar terbaca.
- **Stubble**: tunggul pendek-tegak berwarna jerami (sebelumnya tampak seperti bintang hijau gelap).
- **Storage dihapus** (permintaan pengguna): depot tidak punya kapasitas, vacuum tidak pernah terhenti, meter `x/24`, prompt "Storage full", dan upgrade Storage dihapus. Depot tetap ada sebagai tumpukan bale di 4 palet (visual maks 48, label jumlah) dan pad diganti nama **BALES**. Save lama tetap bisa dimuat (field `storage` diabaikan).
- Bot pacing setelah revisi: potong 1 s, penjualan pertama ≈17 s (trip bot lebih pendek karena tidak menunggu storage penuh), upgrade pertama ≈31 s, hauler ≈2.2–4.9 menit, Golden Grass ≈9–11 menit.

## Revisi setelah feedback (berat memotong & rasio hasil/angkut)

Feedback: memotong terlalu ringan sehingga Blade Power terasa tidak berguna, hasil panen terasa terlalu banyak dibanding carry capacity; tapi jangan terlalu berat karena ini rumput.

- **Hambatan potong (drag)**: kepala alat melambat saat cakram menembus tanaman berdiri. Dihitung dari kepadatan HP tanaman di **setengah depan** cakram (setengah belakang ada di jalur yang baru dipotong): `drag = density / (density + DPS × 1.8)`, kecepatan `× (1 − 0.5 × drag)` → tidak pernah di bawah 50%; tanah kosong tanpa hambatan. Blade Power (DPS) mengurangi hambatan; tier keras menambahnya. Feedback: cakram melambat saat terbebani, kepala alat bergetar sesuai hambatan, suara motor makin "berat".
- **HP tanaman**: Meadow 1.0 → 1.15, Clover 1.6 → 2.1, Golden 2.4 → 3.1.
- **Carry dasar**: 6 → 8 (+2/level, maks 16) — satu perjalanan = satu truk penuh.
- Hasil ukur simulasi (stick penuh selama 1.5 s menyapu tanaman segar; kecepatan / sel terpotong):

| Tier | Blade L1 | Blade L3 | Blade L6 |
|---|---|---|---|
| Meadow | 74% / 28 | 86% / 60 | 94% / 108 |
| Clover | 65% / 0 (60% stick: 20) | 74% / 44 | 84% / 88 |
| Golden | 60% / 0 (60% stick: 6) | 67% / 16 | 76% / 74 |

- Bot pacing setelah revisi: penjualan pertama ≈24 s, upgrade pertama ≈35 s, hauler ≈2.4–4.1 menit, Clover ≈3–6 menit, Golden ≈10–11 menit.

## Balance & keputusan (nilai final dan alasannya)

- Angka ekonomi sama dengan brief **kecuali** (lihat bagian Revisi): intake/radius Vacuum dinaikkan, Storage dihapus, HP tanaman dinaikkan (1.15/2.1/3.1), hambatan potong ditambahkan, carry dasar 8. Harga tier 8/12/20, biaya & pengali upgrade Blade/Vacuum/Reach/Carry, hauler 220/180/300 (4/6/8 bale, 3.0/3.2/3.4 m/s), dan truk 8 bale tetap.
- `stopTau` alat 0.02 (bukan 0.025) agar kecepatan < 0.05 u/s dalam 100 ms setelah input dilepas.
- Kurva XP: `20 + 14 × (level − 1)` untuk naik level (5 XP per 10 unit terjual) — memberi Level 2 tepat setelah penjualan 6 bale pertama.
- Truk berangkat 0.45 s setelah penuh, tiba 2.2 s, truk berikutnya 2.5 s.
- Anchor selang `(0, 0.4, −1.4)` (di reel traktor, bukan −1.5). Batas reach berbentuk superellipse (lihat Revisi); metrik ke pusat sel terjauh < reach maks 31.7.
- Koordinat farm dirapatkan untuk portrait (lebar tampilan farm 9.8 unit). Rute: HARVEST→STORAGE ≈1 s, STORAGE→DELIVER ≈1.25 s, DELIVER→CASH ≈0.75 s, CASH→HARVEST ≈1.4 s (sedikit di bawah 1.5–4 s pada brief; dipilih agar semua pad terlihat bersamaan).
- `Pack leftovers` muncul bila ada unit sisa dan tidak ada bale utuh di depot (dengan 3 tier, depot tidak pernah bisa penuh hanya oleh pecahan, jadi syarat "depot penuh" digeneralisasi).
- Goals tidak memberi hadiah uang.
- Bunga clover hanya ditampilkan di ~10% rumpun (shader) agar tidak tampak seperti noise.

## Masalah yang belum selesai / keterbatasan

- Belum diuji di ponsel fisik dan belum ada angka FPS real-time; perlu dicek di perangkat kelas menengah (target 60 FPS) dan rendah (Low, ≥30 FPS).
- Pada Medium/High, lapangan penuh ≈ 300–450 ribu segitiga; bila perangkat lemah kesulitan, turunkan kualitas atau kurangi jumlah blade per rumpun di `grassMaterial.ts`.
- Suara belum didengar manusia; mix hanya berdasarkan pengukuran level.
- Rute antar-pad sedikit lebih pendek dari rentang 1.5–4 s di brief.
- Hauler berjalan garis lurus antar waypoint dan tidak bertabrakan dengan pemain (sengaja, agar tidak menghalangi).
- Bunga clover dari jauh masih tampak sebagai bintik; bisa dihaluskan dengan tekstur/ukuran yang lebih kecil.
- Bundle JS utama 743 KB (mayoritas three.js); belum dipecah.

## Screenshot

`qa/screenshots/`: `01-title`, `02-harvest-blade`, `03-harvest-vacuum`, `04-farm-carry-stack`, `05-farm-first-sale`, `06-upgrade-panel` (390×844) dan `07-hauler-360x640`.
