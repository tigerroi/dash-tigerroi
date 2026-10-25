# Katalog komponen `ui/`

**Baca ini sebelum menulis komponen UI baru.** Cari berdasarkan KEBUTUHAN di tabel pertama; kalau
yang dibutuhkan sudah ada, pakai itu — rupa yang sedikit berbeda diselesaikan lewat prop atau
`className`, bukan komponen kedua. Kolom "Jangan" adalah kembaran yang pernah benar-benar ditulis
di repo ini.

Aturannya dijaga [`catalog.test.mjs`](catalog.test.mjs): berkas baru di `ui/` yang tidak tercantum
di sini, dan pola yang sudah punya pemiliknya (portal, clipboard, `<table>`, …) yang ditulis di luar
pemiliknya, sama-sama menggagalkan `npm test`.

## Butuh apa → pakai apa

| Butuh... | Pakai | Jangan |
|---|---|---|
| Dialog modal (konfirmasi, form, hasil) | `Dialog` | `createPortal` + `.modal-backdrop` sendiri, pendengar Escape sendiri |
| Tabel data | `DataTable` (+ `tableColumns` untuk kolom uang/ROI/persen) | `<table>` sendiri |
| Tombol chevron buka/tutup rincian baris | `ExpandToggle` | `<button aria-expanded>` + `ChevronDown`/`ChevronRight` sendiri |
| Paging di bawah tabel | `TablePagination` + `useTablePagination` | tombol Berikutnya sendiri |
| Dropdown (satu atau banyak nilai) | `SelectField` (+ `toSelectOptions`) | `<select>` mentah, `react-select` langsung |
| Input form dari satu `type` (teks, uang, password, select) | `Field` | input + label ditulis ulang |
| Label + ikon keterangan di atas kontrol MILIKMU | `LabeledControl` | `<span><label/><ColumnHint/></span>` sendiri, `Field` lokal |
| Saklar on/off yang menyatakan KEADAAN | `Switch` | `type="checkbox"` |
| Kotak pilih-baris untuk tindakan massal | `RowCheckbox` | `<input type="checkbox">` sendiri |
| Keterangan definisi kolom/field (hover) | `ColumnHint` (`icon="info"` untuk field) | `title=""`, paragraf di bawah kotak |
| Rincian yang dibuka dari badge di sel tabel | `CellPopover` | popover `position: absolute` di dalam sel |
| Tab yang GANTI HALAMAN (route) | `PageTabs` (lewat `navigation.js`) | tab state lokal untuk halaman berbeda |
| Tab di dalam satu halaman/panel | `TabStrip` | `role="tablist"` sendiri |
| Rentang tanggal | `DateRangePicker` + `useUrlRange` | dua `<input type="date">` |
| Periode bulanan (halaman Accounting) | `MonthRangePicker` | `DateRangePicker` di Laba Rugi/Cash Flow |
| Filter panel yang terlalu banyak untuk header | `FilterDialog` | dialog filter sendiri |
| Kepala halaman (judul + aksi) | `PageHeader` | `<h1>` sendiri di halaman |
| Tombol salin ke papan klip | `CopyButton` | `navigator.clipboard` sendiri |
| Tombol "Segarkan" untuk bacaan langsung | `RefreshButton` | `RefreshCw` + label "Menyegarkan..." sendiri |
| Ikon tombol yang jadi spinner saat berjalan | `BusyIcon` | `Loader2` bersyarat sendiri |
| Kotak "belum ada isinya" / "memuat" | `EmptyMessage` (untuk tabel: `emptyText` di `DataTable`) | `className="empty-panel-message"` sendiri |
| Grafik garis earning/spend | `LineChart` | Recharts langsung dengan warna hex |
| Grafik kurva ROI | `RoiCurveChart` | — |

Warna grafik selalu dari `useChartPalette` (`src/lib/chartTheme.js`), karena atribut SVG tidak
memahami `var()`.

## Komponen milik satu fitur (tinggal di `ui/` karena dipakai lebih dari satu halaman)

Bukan komponen generik — jangan dipakai sebagai dasar komponen lain, tapi PAKAI ULANG kalau yang
dibutuhkan persis ini.

| Komponen | Isinya |
|---|---|
| `RealtimeRoiTable` | Tabel "Laporan ROI Realtime" (Overview + profil user) |
| `ReportCalendar` | Kalender laporan + `CalendarDayPanel` |
| `SubDomainRoiCharts` | Grafik & tabel ROI per subdomain |
| `OwnerFilterFields` | Tiga dropdown Advertiser/Domain/Subdomain di dalam `FilterDialog` (tab Overview), isinya dari `ownerChoices` |
| `CountryBreakdownBadge` | Badge rincian ROI per negara di sel |
| `MergedCampaignsBadge` | Badge "campaign digabung" di sel |
| `MetaSpendNote` | Catatan kenapa spend Meta kosong (`unmapped`/`unavailable`) |
| `SyncStatus` | Status sync di topbar |
| `SyncIssuesAlert` | Ikon + dialog isu sync di topbar |
| `SyncLogPanel` | Log run sync (Settings) |
| `ReminderAlert` | Ikon + dialog pengingat jatuh tempo di topbar |
| `ThemeToggle` | Tombol tema terang/gelap di topbar |

Di luar `ui/`, yang sering dicari: `campaigns/CountryPicker` (pemilih negara iklan),
`campaigns/CampaignStatusCell` (sel status campaign).

## Kapan komponen baru boleh lahir di `ui/`

1. Tidak ada baris di tabel pertama yang menjawab kebutuhannya, **dan** tidak bisa dijawab dengan
   menambah satu prop ke komponen yang sudah ada.
2. Dipakai (atau jelas akan dipakai) oleh **dua fitur atau lebih**. Yang dipakai satu fitur tinggal
   di folder fiturnya (`campaigns/`, `plugin/`); begitu fitur kedua butuh, ia PINDAH ke sini.
3. Didaftarkan di katalog ini pada commit yang sama, dan kalau ia pemilik sebuah pola (seperti
   `Dialog` memiliki `createPortal`), polanya didaftarkan di `catalog.test.mjs`.
4. Warna hanya lewat token di `src/styles.css`; rupa varian lewat `className`, bukan salinan kedua.
