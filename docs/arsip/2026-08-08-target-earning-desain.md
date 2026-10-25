# Target Earning per Subdomain — Desain

Tanggal: 2026-08-08
Status: disetujui (siap rencana implementasi)

## Tujuan

Admin dan Keuangan bisa menetapkan target earning bulanan per subdomain, melihat
apakah tercapai, riwayat antar bulan, dan analitik agregat. Halaman baru `/targets`.

## Prinsip inti

Yang perlu **disimpan** hanyalah angka target. Realisasi, persen pencapaian,
status tercapai/tidak, riwayat, dan analitik **semuanya diturunkan** dari
`roiReports` yang sudah ada. Tidak ada snapshot bulanan atau flag `achieved` yang
bisa basi dan bertentangan dengan sumbernya.

## Data & sumber angka

**Disimpan (RTDB):**

```
subDomainTargets/{subdomainId}/{YYYY-MM} = <angka>
```

Satu angka per subdomain per bulan, dalam mata uang yang sama dengan `earning` di
`roiReports`. Key pakai subdomain **id** (identitas stabil).

**Realisasi** bulan `YYYY-MM` untuk sebuah subdomain = jumlah `earning` (gross
Adsense; field `earning` / `adsense` pada baris `roiReports`) dari semua baris yang:

- `firstValue(subDomain)` cocok dengan **nama** subdomain saat ini, dan
- `date` berada di dalam bulan `YYYY-MM` (`date` bformat `yyyy-mm-dd`).

Ad tax tidak ikut — target adalah **Earning** (gross Adsense), bukan Profit.

**Turunan:**

- `% pencapaian = realisasi / target × 100` (target 0 / kosong → tampil `-`, bukan bagi nol).
- `tercapai = realisasi >= target` (hanya bila target > 0).

**Pemetaan id → nama:** target di-key oleh id, `roiReports` membawa nama subdomain.
Aggregasi memakai nama subdomain saat ini (dari koleksi `subDomains`).

`ponytail:` match berbasis nama — kalau subdomain di-rename di tengah bulan, baris
`roiReports` lama yang menyimpan nama lama tidak ikut terhitung. Perbaiki (mis. key
`roiReports` ke subdomain id di sisi sync) hanya kalau rename jadi kebiasaan.

## Akses

- Resource baru `subDomainTargets`.
- **Write:** admin + keuangan. **Read:** semua akun login.
- `database.rules.json`: node `subDomainTargets` dengan `.read` untuk `auth != null`
  dan `.write` untuk role yang mengandung `admin` atau `keuangan` — pola sama dengan
  `expanses`.
- `src/config/access.js`: helper `canWriteTargets(role)` = `isAdmin(role) || hasRole(role, "keuangan")`.
- Nav item `/targets` tampil untuk admin & keuangan (gating pakai `canWriteTargets`
  atau helper baca setara — targets bukan bagian dari `resources`, jadi filter nav
  perlu menerima key non-resource ini).

## Halaman `/targets` — Fase 1 (inti)

Dibangun lebih dulu; langsung berguna tanpa menunggu analitik.

**Kontrol bulan:** `<input type="month">`, default bulan berjalan. Bisa mundur/maju
untuk set target lebih awal atau koreksi bulan lampau.

**Tabel per subdomain (bulan terpilih):**

| Kolom | Sumber |
|-------|--------|
| Subdomain | `subDomains.name` |
| PIC | `subDomains.pic` |
| Target | `subDomainTargets/{id}/{YYYY-MM}` — input inline, editable bila `canWriteTargets` |
| Realisasi | agregat `roiReports` (lihat di atas) |
| % | turunan |
| Status | badge Tercapai / Belum |

Non-editor (bukan admin/keuangan) melihat tabel read-only.

**Riwayat per subdomain:** memilih satu subdomain menampilkan baris per bulan
(Target, Realisasi, %, Tercapai) untuk semua bulan yang memiliki target **atau**
realisasi.

## Wiring

- `src/routes/resolveRoute.js`: `if (path === "/targets") return { kind: "targets" }`.
- `src/main.jsx`: render `<TargetsPage>` untuk `route.kind === "targets"`, dengan
  gating akses (tampil untuk semua, editor-only untuk input).
- `src/config/navigation.js`: item `{ path: "/targets", label: "Target", key: "targets" }`.
- `src/hooks/useFirebaseStore.js`: subscribe `subDomainTargets` (bentuk object) ke
  store; fungsi `saveTarget(subdomainId, month, amount)` yang menulis
  `subDomainTargets/{subdomainId}/{month}` dan memberi toast sukses/gagal.
- Komponen baru `src/components/Targets.jsx`.

## Fase 2 (analitik penuh)

Halaman yang sama, dibangun setelah Fase 1 jalan. Murni agregasi di atas data yang
sama — nol tambahan skema:

- Total target vs total realisasi seluruh subdomain (bulan terpilih).
- Ranking subdomain berdasarkan % pencapaian.
- Kontribusi per PIC / advertiser.
- Tren pencapaian antar bulan (grafik).

## Testing

- Unit test murni untuk fungsi agregasi realisasi & pencapaian (mis.
  `src/lib/targets.js` + `targets.test.mjs`): target vs realisasi, target 0/kosong
  (tidak bagi nol), pencocokan nama subdomain, filter rentang bulan. Pola sama dengan
  `countryRoi.test.mjs`.

## Di luar scope

- Audit trail siapa mengubah target (hanya simpan angkanya). Tambah bila ada sengketa.
- Notifikasi/alert saat target meleset.
- Target selain Earning (mis. Profit atau ROI).
