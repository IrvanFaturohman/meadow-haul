# Implementation Plan & Checkpoint — Meadow Haul

Dokumen kerja lintas sesi. Status per 2026-09-28: semua tahap inti selesai; sisa pekerjaan ada di bagian *Langkah berikutnya*.

## Arsitektur singkat

- **Simulasi murni** (`src/core/Simulation.ts` + `src/gameplay/*` + `src/world/FieldModel.ts`): fixed timestep 60 Hz, maksimal 5 langkah/frame, semua perubahan inventory atomik dan tercatat sebagai event. Tidak mengimpor three.js/DOM → dapat dites di Node.
- **Presentasi** (`src/world/FarmWorld.ts`, `FieldRenderer`, `BaleRenderer`, `src/art/*`, `src/effects/*`): membaca state tiap frame (interpolasi posisi), mengubah event menjadi efek; tidak pernah mengubah jumlah resource.
- **Orkestrasi** (`src/core/Game.ts`): mode `BOOT → TITLE → FARM ⇄ TRANSITION_TO_HARVEST/HARVEST/TRANSITION_TO_FARM`, `UPGRADE_PANEL`, `PAUSED`; input → vektor tanah dari basis kamera; routing event ke dunia/audio/HUD; autosave 5 s + setelah transaksi penting; manajemen kualitas.
- **Save** (`src/core/SaveSystem.ts`): JSON + array sel base64; validasi & clamp; normalisasi truk/hauler; save rusak → pilihan mulai baru.

Alur resource: `standing (GROWING) → loose (CUT) → raw buffer / bale depot → carry (player/hauler) → truck cargo = sold ledger`.

## Tahapan

| Tahap | Isi | Status |
|---|---|---|
| 1. Fondasi & sapuan | Vite/TS/three, kamera ortho 58°, input joystick/keyboard, ladang instanced, traktor, selang Verlet, blade | ✅ |
| 2. Potong & sedot | State sel, loose resource, tool switch 160 ms, vacuum akumulator, buffer & storage, pulsa selang | ✅ |
| 3. Loop uang pertama | Farm, karakter, pickup/stack, deliver, truk, pending cash, panel upgrade | ✅ |
| 4. Progres berulang | 3 tier, reach, replant, carry/storage, hauler (3 level), goals, save/load | ✅ |
| 5. Polish | Model prosedural, lighting, framing portrait, HUD, SFX/ambience/musik prosedural, juice, transisi, onboarding | ✅ (lihat keterbatasan) |
| 6. QA & dokumentasi | build/typecheck/test, playthrough emulasi, layar kecil, kebocoran, README/QA_NOTES | ✅ (tanpa perangkat fisik) |

## File utama untuk dilanjutkan

- Balance: `src/config/balance.ts` (semua angka), layout: `src/config/worldLayout.ts`.
- Rasa kontrol: `src/gameplay/Harvester.ts`, `src/gameplay/Player.ts`, `src/input/VirtualJoystick.ts`.
- Visual rumput: `src/art/grassMaterial.ts` (geometri rumpun, shader sway/bend/cut/regrow), `src/world/FieldRenderer.ts`.
- Kamera: `src/world/CameraRig.ts` + konstanta `CAMERA` di `worldLayout.ts`.
- HUD/tutorial: `src/ui/HUD.ts`, `src/gameplay/Tutorial.ts`, `src/gameplay/Goals.ts`.
- Audio: `src/audio/AudioManager.ts`, `src/audio/ProceduralSounds.ts`.
- Bot pacing: `tests/pacing.test.ts` (jalankan dengan `npx vitest run tests/pacing.test.ts --silent=false` untuk melihat timeline).

## Bug terbuka / risiko

- Belum ada angka FPS nyata (tab automation tersembunyi) dan belum diuji di ponsel fisik.
- Segitiga Medium/High ≈ 0.3–0.45 juta; mungkin perlu menurunkan detail rumput untuk ponsel lama.
- Suara belum dinilai dengan telinga manusia.

## Langkah berikutnya (konkret)

1. Playtest di 2–3 ponsel nyata (iOS Safari + Android Chrome) lewat IP LAN; catat FPS dengan `?debug=1`, kenyamanan joystick (dead zone 12%, radius 46–60 px), dan keterbacaan HUD.
2. Dengarkan mix audio di speaker ponsel & headphone; sesuaikan `trim` di tabel `SFX_DEFS` pada `AudioManager.ts`.
3. Playtest manusia untuk ritme: catat waktu penjualan pertama, upgrade pertama, hauler; bandingkan dengan tabel bot di `QA_NOTES.md`, lalu tuning `balance.ts`.
4. Opsional: variasi rumpun per instance (dua geometri per tier), LOD rumput di baris jauh, code-splitting bundle.
