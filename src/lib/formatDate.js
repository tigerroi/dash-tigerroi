// Satu format tanggal untuk seluruh dashboard: "09 Agu 2026".
//
// Sebelumnya tiap halaman memformat tanggalnya sendiri — "09/08/2026" di tabel ROI, "9/8/2026"
// dari toLocaleDateString di Profile User, "08/08/26, 16.04" di panel sync, dan "2026-08-09"
// mentah di tabel Expenses. Empat bentuk untuk satu hal, dan dua di antaranya (08/09 vs 09/08)
// tidak bisa dibedakan dari bulan tanpa tahu halaman mana yang sedang dibaca.
//
// Nama bulan menghapus ambiguitas itu sekaligus: "09 Agu 2026" tidak punya cara dibaca lain.
//
// Dipakai lewat renderCell juga, jadi kolom bertanggal di tabel mana pun — termasuk tabel yang
// dibuat nanti — ikut format ini tanpa perlu diingat.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

// "2026-08-09", "2026-08-09 14:32", "2026-08-09T07:35:00.000Z"
const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/;
// "09/08/2026" — bentuk lama yang masih tersimpan di baris-baris lama.
const LOCAL = /^(\d{2})\/(\d{2})\/(\d{4})$/;
// Kapan sebuah nilai layak diperlakukan sebagai tanggal (dipakai renderCell).
const DATE_LIKE = /^(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})/;

export function isDateLike(value) {
  return typeof value === "string" && DATE_LIKE.test(value.trim());
}

/**
 * Kunci BULAN telanjang ("2026-08"), yang bukan tanggal dan tidak boleh diperlakukan sebagai
 * tanggal. Dipakai `renderCell`, supaya kolom "Bulan" di tabel mana pun berbunyi "Agu 2026" tanpa
 * perlu didaftarkan lebih dulu — aturan yang sama dengan `isDateLike` tepat di atasnya.
 *
 * Diperiksa dari BENTUKNYA dan bukan dari nama kolomnya, dan urutannya menentukan: bentuk ini
 * tidak cocok dengan DATE_LIKE (yang menuntut tanggalnya), jadi tanpa pemeriksaan tersendiri
 * "2026-08" jatuh ke sel apa adanya — satu-satunya nilai bertanggal di seluruh layar yang tidak
 * berbunyi seperti tetangganya.
 */
export function isMonthLike(value) {
  return typeof value === "string" && /^\d{4}-\d{2}$/.test(value.trim());
}

/**
 * Bagian-bagian tanggal, atau null kalau nilainya bukan tanggal yang dikenali.
 *
 * Tanggal tanpa jam diurai dari teksnya langsung, tidak lewat `new Date()`: "2026-08-09" diurai
 * sebagai tengah malam UTC, dan di zona waktu negatif itu mundur jadi tanggal 8. Yang lewat Date
 * hanya stempel waktu penuh, yang memang harus ditampilkan menurut jam pembacanya.
 */
function parts(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : fromDate(value);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return fromDate(new Date(value));
  }

  const text = String(value ?? "").trim();
  if (!text) return null;

  const iso = text.match(ISO);
  if (iso) {
    // Stempel waktu penuh (ada "T" dan zona waktu) ditampilkan menurut jam lokal pembacanya.
    if (/T/.test(text) && /(Z|[+-]\d{2}:?\d{2})$/.test(text)) {
      const parsed = new Date(text);
      if (!Number.isNaN(parsed.getTime())) return fromDate(parsed);
    }
    return {
      year: Number(iso[1]),
      month: Number(iso[2]),
      day: Number(iso[3]),
      time: iso[4] ? `${iso[4]}:${iso[5]}` : "",
    };
  }

  const local = text.match(LOCAL);
  if (local) {
    return { year: Number(local[3]), month: Number(local[2]), day: Number(local[1]), time: "" };
  }

  return null;
}

function fromDate(date) {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    time: `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`,
  };
}

function monthName(month) {
  return MONTHS[month - 1] || String(month).padStart(2, "0");
}

/**
 * "09 Agu 2026".
 *
 * Yang kosong jadi "-" (tanda yang sudah berarti "datanya tidak ada" di tabel-tabel ini), dan yang
 * bukan tanggal dikembalikan apa adanya — memformat paksa akan menghapus isi kolom yang kebetulan
 * bukan tanggal, dan itu lebih buruk daripada satu nilai yang tidak ikut format.
 */
export function formatDate(value) {
  if (value === null || value === undefined || value === "" || value === "-") return "-";
  const p = parts(value);
  return p ? `${String(p.day).padStart(2, "0")} ${monthName(p.month)} ${p.year}` : String(value);
}

// "09 Agu 2026, 14:32" — untuk stempel waktu yang jamnya memang berarti (log sync, snapshot).
export function formatDateTime(value) {
  if (value === null || value === undefined || value === "" || value === "-") return "-";
  const p = parts(value);
  if (!p) return String(value);
  const date = `${String(p.day).padStart(2, "0")} ${monthName(p.month)} ${p.year}`;
  return p.time ? `${date}, ${p.time}` : date;
}

// "Agu 2026" — untuk kunci bulan "2026-08" di halaman Targets dan kolom Bulan.
export function formatMonth(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{4})-(\d{2})$/);
  if (match) return `${monthName(Number(match[2]))} ${match[1]}`;
  const p = parts(value);
  return p ? `${monthName(p.month)} ${p.year}` : text || "-";
}

// "09 Agu" — sumbu grafik, di mana tahunnya sama untuk semua titik dan hanya memakan tempat.
export function formatDayMonth(value) {
  const p = parts(value);
  return p ? `${String(p.day).padStart(2, "0")} ${monthName(p.month)}` : String(value ?? "");
}

/**
 * Tanggal ISO yang berdiri DI DALAM kalimat, diganti bentuk "09 Agu 2026".
 *
 * Untuk prosa yang ditulis sisi sync dan dibaca apa adanya di layar — keterangan akibat sebuah
 * kegagalan sync ("Earning 2026-08-25 s/d 2026-08-28 ... tidak diperbarui"). Kalimatnya disusun di
 * `functions/`, yang tidak punya pemformat ini dan tidak boleh punya salinannya; yang menyimpan
 * tanggal mentah lalu memformatnya saat dirender adalah aturan yang sama dengan kolom tabel mana
 * pun di dashboard ini, cuma tempat tanggalnya yang berbeda.
 *
 * Hanya bentuk ISO telanjang yang disentuh, dan hanya yang berdiri sebagai kata utuh: potongan
 * seperti `2026-08-09T07:35` di dalam sebuah id atau URL tidak ikut berubah, dan pesan error asli
 * dari API tidak pernah dilewatkan ke sini sama sekali.
 */
export function formatDatesInText(value) {
  const text = String(value ?? "");
  return text.replace(/\b\d{4}-\d{2}-\d{2}\b(?![T\d-])/g, (iso) => formatDate(iso));
}
