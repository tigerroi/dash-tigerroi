import { RefreshCw, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { useActivityLogs } from "../hooks/useActivityLogs";
import { useUrlRange, useUrlState } from "../hooks/useUrlState";
import { ACTIVITY_CATEGORIES } from "../lib/activityLog";
import { flushActivity, pendingActivityCount } from "../lib/activityRecorder";
import { CONTROL_API_ENABLED } from "../lib/controlApi";
import { filterByDateField, todayRange } from "../lib/dateRange";
import { notifyError, notifySuccess } from "../lib/notify";
import { FirebaseCostPanel } from "./FirebaseCostPanel";
import { DataTable } from "./ui/DataTable";
import { DateRangePicker } from "./ui/DateRangePicker";
import { PageHeader } from "./ui/PageHeader";
import { SelectField, toSelectOptions } from "./ui/SelectField";

/**
 * Jejak aktivitas seluruh tim — /activity-logs.
 *
 * SUPERADMIN SAJA, di dua lapis yang berbeda dan keduanya perlu: `SUPERADMIN_PAGES` menyembunyikan
 * menu dan halamannya, dan `.read` pada `activityLogs` di database.rules.json yang benar-benar
 * menolak sisanya. Yang tersimpan di sini adalah alamat IP, kota, dan perangkat setiap orang di tim
 * berikut apa yang mereka buka jam berapa — isi yang alasannya sama dengan `otpSecrets`: izin baca
 * RTDB menurun, jadi node itu sendiri yang harus dijaga.
 *
 * SATU ASIMETRI yang gampang dianggap salah ketik saat membaca aturannya nanti: `.read` superadmin
 * tapi `.write` ADMIN. Yang menulis node ini bukan browser siapa pun — melainkan server kontrol
 * sebagai SYNC_USER, yang rolenya admin. Aturan superadmin di sisi tulis akan menolak penulisnya
 * sendiri, dan halaman ini akan selamanya kosong tanpa satu pun pesan kesalahan (persis alasan
 * `pluginSites` juga admin).
 */

const CATEGORY_ENTRIES = Object.entries(ACTIVITY_CATEGORIES);

const COLUMNS = [
  ["at", "Waktu"],
  ["actorEmail", "Pengguna"],
  ["role", "Role"],
  ["kategori", "Kategori"],
  ["action", "Aksi"],
  ["page", "Halaman"],
  ["keterangan", "Keterangan"],
  ["ip", "IP"],
  ["lokasi", "Lokasi"],
  ["perangkat", "Perangkat"],
  ["status", "Status"],
];

export function ActivityLogs({ store }) {
  const [range, setRange] = useUrlRange("tanggal", todayRange);
  const [q, setQ] = useUrlState("q", "");
  // Penyaring yang diminta paling awal: melihat jejak SATU orang. Namanya `user` dan bukan `q`
  // supaya keduanya bisa dipakai bersama — "apa yang dilakukan Nurjaman di /vi-control".
  const [user, setUser] = useUrlState("user", "");
  const [category, setCategory] = useUrlState("kategori", "");
  const { rows, loading, error, truncated } = useActivityLogs(range);
  const [flushing, setFlushing] = useState(false);
  // Dibaca sebagai state, bukan dipanggil di tengah render: `pendingActivityCount` membaca
  // localStorage, dan nilai yang dibaca saat render tidak akan pernah berubah sesudah tombol
  // "Kirim jejak" berhasil — angkanya akan tetap menyebut jumlah yang sudah tidak menunggu lagi.
  const [pending, setPending] = useState(pendingActivityCount);

  // Daftar orang dibangun dari jejaknya sendiri, bukan dari koleksi `users`. Yang perlu disaring di
  // sini adalah siapa pun yang PERNAH meninggalkan jejak — termasuk akun yang sudah diarsipkan dari
  // Team, yang justru paling menarik saat ada yang ditelusuri.
  const people = useMemo(() => {
    const seen = new Set();
    for (const row of rows) if (row.actorEmail) seen.add(row.actorEmail);
    return [...seen].sort();
  }, [rows]);

  const items = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (
      filterByDateField(rows, "at", range)
        .filter((row) => !user || row.actorEmail === user)
        .filter((row) => !category || row.category === category)
        .filter((row) => {
          if (!term) return true;
          return [row.action, row.label, row.page, row.detail, row.ip, row.city, row.target]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(term));
        })
        // Terbaru di atas, dan diurutkan DI SINI bukan diserahkan ke DataTable: yang dibaca orang
        // pertama kali saat membuka halaman jejak adalah yang barusan terjadi.
        .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")))
        .map(toRow)
    );
  }, [rows, range, user, category, q]);

  const runFlush = async () => {
    setFlushing(true);
    try {
      const { sent } = await flushActivity();
      setPending(pendingActivityCount());
      notifySuccess(
        sent ? `${sent} jejak terkirim.` : "Tidak ada jejak yang menunggu di perangkat ini.",
      );
    } catch (flushError) {
      setPending(pendingActivityCount());
      notifyError(
        flushError,
        "Jejak gagal dikirim sekarang. Ia tetap tersimpan dan dicoba lagi otomatis.",
      );
    } finally {
      setFlushing(false);
    }
  };

  return (
    <div className="page-stack">
      <PageHeader
        title="Activity Logs"
        description="Jejak setiap orang: login, halaman yang dibuka, tombol yang ditekan, dan operasi data — berikut IP, kota, dan perangkatnya."
        action={
          <button className="ghost-button" disabled={flushing} onClick={runFlush} type="button">
            <RefreshCw size={14} />
            {flushing ? "Mengirim..." : "Kirim jejak perangkat ini"}
          </button>
        }
      />

      {/* Tanpa server kontrol, jejak tetap DICATAT tapi tidak pernah berangkat — dan halaman yang
          diam soal itu akan terbaca sebagai "tidak ada yang beraktivitas". Lihat catatan di
          `sendActivityLogs`: IP dan kota hanya bisa diamati di sisi server, jadi tidak ada jalur
          cadangan yang bisa ditawarkan di sini. */}
      {!CONTROL_API_ENABLED && (
        <p className="notice-alert">
          <TriangleAlert size={15} />
          <span>
            Server kontrol belum dikonfigurasi (<code>VITE_CONTROL_API_URL</code>). Jejak tetap
            dicatat di perangkat masing-masing dan berangkat sendiri begitu alamatnya di-set — tidak
            ada yang hilang, tapi tabel di bawah tidak akan bertambah sampai itu terjadi.
          </span>
        </p>
      )}

      <div className="panel">
        <div className="panel-header">
          {/* Tanpa <h2>: judulnya sudah di PageHeader. Yang tersisa di sini bukan judul kedua
              melainkan hitungan barisnya — keterangan yang berubah, bukan yang mengulang. */}
          <div>
            <p>
              {loading
                ? "Memuat..."
                : `${items.length} kejadian${pending ? ` · ${pending} menunggu kirim dari perangkat ini` : ""}`}
            </p>
          </div>
          {/* `toolbar-filters`, bukan `toolbar`: yang kedua membungkus (`flex-wrap: wrap`) dan
              melebar penuh, jadi empat penyaring di sini turun jadi dua baris dan mendorong tabel
              ke bawah. Yang ini satu baris yang tidak membungkus — di bawah 980px seluruh
              panel-header memang ditumpuk sendiri oleh media query yang sudah ada.

              Selectnya `compact-control`: `.control` sendirian berarti `width: 100%`, dan dua
              select yang masing-masing meminta seluruh baris adalah persis kenapa barisnya pecah. */}
          <div className="toolbar-filters activity-filters">
            <input
              aria-label="Cari jejak"
              className="control search"
              onChange={(event) => setQ(event.target.value)}
              placeholder="Cari aksi, halaman, IP, kota..."
              type="search"
              value={q}
            />
            <SelectField
              ariaLabel="Saring menurut pengguna"
              className="compact-control"
              onChange={setUser}
              options={[{ value: "", label: "Semua pengguna" }, ...toSelectOptions(people)]}
              value={user}
            />
            <SelectField
              ariaLabel="Saring menurut kategori"
              className="compact-control"
              onChange={setCategory}
              options={[
                { value: "", label: "Semua kategori" },
                ...CATEGORY_ENTRIES.map(([key, label]) => ({ value: key, label })),
              ]}
              value={category}
            />
            <DateRangePicker align="right" onChange={setRange} value={range} />
          </div>
        </div>

        {error && (
          <p className="notice-alert">
            <TriangleAlert size={15} />
            <span>
              Jejak gagal dibaca: {error.message}. Jejak kini tersimpan di server kontrol — pastikan
              ia terjangkau dan Anda login sebagai superadmin.
            </span>
          </p>
        )}

        {/* Dipotong dari yang TERBARU oleh LIMIT server (ORDER BY at DESC). Dibiarkan diam, tabel
            yang kehilangan baris tertua akan terbaca sebagai "tidak ada aktivitas pagi itu". */}
        {truncated && (
          <p className="notice-alert">
            <TriangleAlert size={15} />
            <span>
              Rentang ini melebihi batas satu bacaan — yang tampil adalah kejadian terbaru saja.
              Persempit rentang tanggalnya untuk melihat yang lebih lama.
            </span>
          </p>
        )}

        <DataTable columns={COLUMNS} dense items={items} paginate pageSize={25} />
      </div>

      {/* Jejak yang dioper adalah `rows` — SELURUH bacaan rentang ini, bukan `items` yang sudah
          disaring. Batas sesi di panel itu ditaksir dari jeda antar-baris, jadi penyaring kategori
          yang membuang kunjungan halaman akan memotong satu sesi jadi tiga dan melipatgandakan
          estimasinya. */}
      <FirebaseCostPanel range={range} rows={rows} store={store} truncated={truncated} />
    </div>
  );
}

/**
 * Satu baris RTDB → satu baris tabel.
 *
 * Kolom gabungan (lokasi, perangkat, keterangan) dirakit di sini dan bukan di dalam sel, supaya
 * pengurutan dan pencarian bekerja pada teks yang SAMA dengan yang dibaca orang di layar. `at`
 * sengaja tetap ISO mentah: `renderCell` yang memformatnya jadi "19 Agu 2026, 14:32", dan tanggal
 * yang sudah diformat akan diurutkan sebagai teks — "01 Sep" jatuh sebelum "09 Agu".
 */
function toRow(row) {
  return {
    id: row.id,
    at: row.at,
    actorEmail: row.actorEmail || "(belum login)",
    role: row.actorRole || "",
    kategori: ACTIVITY_CATEGORIES[row.category] || row.category,
    action: row.action,
    page: row.page || "-",
    keterangan: [row.label, row.target, row.detail].filter(Boolean).join(" · ") || "-",
    ip: row.ip || "-",
    // Kota kosong TIDAK diganti tebakan — VPN, rentang CDN, dan alamat kantor tertentu memang tidak
    // punya kota, dan "-" mengatakan itu apa adanya. Negara ikut ditampilkan supaya baris yang cuma
    // punya negara tetap berarti sesuatu.
    lokasi: [row.city, row.country].filter(Boolean).join(", ") || "-",
    perangkat: [row.browser, row.os].filter(Boolean).join(" · ") || "-",
    status: row.status === "failed" ? "Failed" : "OK",
  };
}
