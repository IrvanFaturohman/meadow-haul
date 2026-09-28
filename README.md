# Meadow Haul

Prototype web 3D (portrait-first) tentang memotong hamparan rumput pakan dengan kepala alat yang terhubung ke mesin lewat selang fleksibel, menyedot potongannya menjadi bale, mengangkut bale ke truk, mengambil uang, lalu membeli upgrade.

Stack: **Vite 8 + TypeScript 5.9 + Three.js r186**, HUD HTML/CSS, audio prosedural Web Audio API, save `localStorage`. Tidak ada aset eksternal, CDN, atau backend — semua model, ikon, dan suara dibuat secara prosedural.

**Main online:** https://irvanfaturohman.github.io/meadow-haul/ (GitHub Pages)

## Menjalankan

Dibutuhkan **Node.js ≥ 20.19** (dikembangkan dan diuji dengan Node 25.9.0 / npm 11.12; lihat `.nvmrc`).

```bash
npm install
npm run dev -- --host 0.0.0.0      # server development (http://localhost:5173)
npm run build                      # typecheck + build produksi ke dist/
npm run preview -- --host 0.0.0.0  # menyajikan dist/ (http://localhost:4173)
npm run typecheck
npm run test                       # vitest: aturan ekonomi/resource + bot pacing
```

Jalankan selalu lewat server (dev atau preview), bukan membuka `index.html` via `file://`.

### Deploy ke GitHub Pages

```bash
npm run deploy   # build + push dist/ ke branch gh-pages (paket gh-pages)
```

Pages disajikan dari branch `gh-pages` (root). `vite.config.ts` memakai `base: './'`, jadi aset bekerja di sub-path `/meadow-haul/`. Perubahan kode di `main` baru tampil online setelah `npm run deploy` dijalankan lagi.

### Main dari ponsel di jaringan yang sama

1. Pastikan komputer dan ponsel terhubung ke Wi-Fi/LAN yang sama.
2. Jalankan `npm run dev -- --host 0.0.0.0` (atau `npm run preview -- --host 0.0.0.0` setelah build).
3. Vite mencetak baris `Network: http://<IP-LAN-komputer>:5173/`. Buka alamat itu di browser ponsel.
   Jika baris itu tidak muncul, cari IP LAN komputer (macOS: `ipconfig getifaddr en0`; Windows: `ipconfig`; Linux: `hostname -I`).
4. Jika tidak bisa terhubung, izinkan port 5173/4173 di firewall komputer.
5. Pegang ponsel dalam posisi portrait. Ketuk **Play** — ketukan pertama juga mengaktifkan audio.

## Kontrol

| Aksi | Ponsel | Desktop |
|---|---|---|
| Bergerak (alat / karakter) | Sentuh area kosong lalu geser — joystick muncul di titik sentuh | WASD / panah, atau drag mouse |
| Pilih blade / vacuum | Tombol **CUT** / **VACUUM** | `1` / `2`, `Space` menukar |
| Masuk harvest | Berdiri di pad **HARVEST** | `E` saat dekat pad |
| Kembali ke farm | Tombol **FARM** | `E` |
| Tutup panel / pause | Tombol ✕ / ⚙ | `Esc` |

Petunjuk keyboard hanya tampil setelah input desktop (keyboard/mouse) terdeteksi.

## Ringkasan loop

1. **Harvest mode** — traktor diam di pangkal ladang; kepala alat bergerak di bidang XZ dengan jangkauan maksimum (upgrade *Hose Length*). Batasnya berbentuk lebar (baris dekat terjangkau selebar ladang) dan elastis: bisa ditarik sedikit lalu memantul balik, dengan selang yang menegang lurus. **Blade** memotong tanaman (damage berbasis waktu, swept), meninggalkan tanah + stubble + potongan lepas; menembus tanaman berdiri terasa berat (alat melambat), makin ringan dengan Blade Power. **Vacuum** menyedot potongan lepas (potongan di sekitar nozzle ikut tertarik dan berputar masuk) → depot; tiap 10 unit tier yang sama menjadi 1 bale. Depot tidak punya batas kapasitas.
2. **Farm mode** — karakter mengambil bale dari tumpukan **BALES** (tumpukan di punggung), menjualnya di **DELIVER** (langsung terjual per bale, tanpa menunggu truk; truk mengangkut tumpukan dermaga di latar belakang), lalu mengambil uang di **COLLECT CASH**.
3. **Upgrade** di pad **UPGRADE** (workshop): Blade Power, Vacuum Power, Hose Length (reach), Carry Capacity, serta Hauler.
4. **Hauler** (setelah penjualan pertama, pad **HIRE**, 220) mengangkut bale depot → truk secara otomatis; hasil penjualannya masuk ke pad uang yang sama.
5. **REPLANT** (gratis) menumbuhkan ulang sel yang potongannya sudah terkumpul semua. Sel dengan potongan yang belum disedot dan tanaman hidup tidak berubah.
6. Tiga tier: **Meadow Grass** (baris 4–35, 8/bale), **Clover Patch** (36–65, 12/bale), **Golden Grass** (66–95, 20/bale). Tier dibedakan bentuk tanaman + aksen bale (tali, bunga krem, ujung biji), bukan warna saja.

## File penting

| File | Isi |
|---|---|
| `src/config/balance.ts` | **Semua angka balance**: HP/harga tier, kecepatan, DPS, intake, reach (+ bentuk & elastisitas), kapasitas carry, biaya upgrade (`round(base × growth^(level−1))`), hauler, truk, XP, goals, juice |
| `src/config/worldLayout.ts` | Koordinat ladang, anchor selang, pad, depot, truk, workshop, kamera |
| `src/config/palette.ts` | Palet warna |
| `src/core/Simulation.ts` | Simulasi gameplay fixed-timestep 60 Hz (tanpa rendering) |
| `src/core/Game.ts` | State machine mode, loop, routing event → dunia/audio/HUD, save, kualitas |
| `src/gameplay/*` | Logika murni: harvester, cutting, vacuum, inventory, economy, truck, hauler, tutorial, goals, hose (visual) |
| `src/world/*` | FieldModel (state sel), FieldRenderer (instancing per chunk), BaleRenderer, CameraRig, FarmWorld |
| `src/art/*` | Builder model prosedural (traktor, alat, karakter, truk, bale, lingkungan, material rumput) |
| `src/audio/*` | AudioManager (bus master/sfx/ambience/music, limiter, polyphony 24, rate-limit) + resep suara prosedural |
| `src/ui/*` | HUD, panel upgrade, settings, ikon SVG orisinal, CSS |
| `tests/*` | Tes vitest untuk aturan resource/ekonomi/save + bot pacing |

## Debug mode

Tambahkan `?debug=1` ke URL (mis. `http://localhost:5173/?debug=1`). Panel debug menampilkan FPS, frame time, draw calls, segitiga, partikel, audit konservasi unit (standing/loose/raw/depot/carry/hauler/sold vs planted), uang, level upgrade, status truk/hauler/audio; serta aksi: tambah uang, potong seluruh ladang, replant, spawn bale per tier, save, reset save, audisi SFX, mute bus terpisah, slider sway/motion/shake/vacuum×/harga×, dan overlay lingkaran reach + batas chunk. Semua aksi yang mengubah progres menandai save sebagai `debugUsed`.

Parameter QA tambahan: `?frame=390x844` memaksa ukuran frame tertentu di desktop (mis. `360x640`, `430x932`).

Konsol: objek `window.meadow` (instance `Game`) tersedia untuk inspeksi manual.

## Reset save

- Dalam game: ⚙ (atau `Esc`) → **Reset save** → konfirmasi **Erase & restart**. Pengaturan audio/grafis dipertahankan.
- Di layar judul (jika ada save): **New farm** → ketuk lagi untuk konfirmasi.
- Manual: hapus key `localStorage` `meadow-haul.save.v1` (pengaturan di `meadow-haul.settings.v1`).

Save yang rusak tidak membuat game crash: layar judul memberi tahu dan menawarkan mulai baru (save lama baru ditimpa setelah pemain memilih).

## Kebutuhan browser

Browser modern dengan WebGL (WebGL2 disarankan), Pointer Events, Web Audio, dan ES2022: Chrome/Edge 100+, Safari 16+, Firefox 110+. Audio baru aktif setelah interaksi pertama; bila browser menolak, game tetap berjalan dan tombol **Enable audio** muncul. `prefers-reduced-motion` dihormati (juga bisa diatur di Settings).

## Perubahan signifikan dari brief

Detail dan alasan ada di `QA_NOTES.md` (bagian *Balance & keputusan*). Ringkasnya: koordinat farm dirapatkan agar muat di frame portrait; anchor selang di `z = −1.4` (reel traktor); batas jangkauan berbentuk elips lebar yang elastis, bukan lingkaran, dan tidak digambar sebagai garis (baris baru berpendar setelah upgrade); kepala alat diberi tiang agar terbaca di atas rumput tinggi; `Pack leftovers` tersedia saat ada sisa unit dan tidak ada bale utuh yang menunggu; hauler bisa di-hire di pad HIRE maupun tab Farm di workshop (keduanya setelah penjualan pertama). Atas feedback playtest: intake/radius vacuum dinaikkan (60/s, 1.5), sistem Storage dihapus, hambatan potong ditambahkan dengan HP tanaman 1.15/2.1/3.1, dan carry dasar menjadi 8. Harga dan biaya upgrade lain tetap seperti brief.
