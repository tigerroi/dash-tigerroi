// Saldo akun Google: uang yang sudah dihasilkan tapi belum dibayarkan (`unpaid earnings`).
//
// SUMBERNYA API ADSENSE UNTUK KEDUA HALAMAN, termasuk halaman GAM — alasan yang sama persis
// dengan kolom Status (lihat account-status.js): Ad Manager API v1 tidak punya satu pun resource
// pembayaran, saldo, atau tagihan. Yang ada cuma `mcmEarnings` (bagi hasil parent/child MCM per
// bulan, ditanyakan pada network PARENT yang bukan milik kita), dan untuk ketujuh network kita ia
// menjawab 400. Yang tahu saldo sebuah publisher hanya sisi AdSense-nya, lewat
// `accounts.payments.list`.
//
// TIDAK ADA PECAHAN SALDO DI API MANA PUN, dan itu yang membentuk seluruh modul ini. Sudah
// diperiksa (4 Sep 2026, ke API produksi): schema `Payment` cuma membawa `name`/`date`/`amount`;
// `accounts.adclients` tidak pernah menyebut Ad Exchange (hanya AFC, dua klien YouTube, satu AFS);
// tidak ada resource `transactions` di AdSense v2 — halaman Transaksi di UI, yang memang memecah
// saldo per produk, tidak punya padanan API — dan `adsenseplatform.googleapis.com` cuma melayani
// platform host. Jadi pecahannya DIREKONSTRUKSI, dan cara merekonstruksinya adalah keputusan.
//
// YANG DIPAKAI: RESIDU.
//
//   Saldo            = payments/unpaid                 (angka Google, bukan hitungan kita)
//   Saldo Adsense    = earning AFC bulan final terakhir (diukur, AdSense Reports API)
//   Saldo Ad-Exchange = Saldo - Saldo Adsense           (sisanya)
//
// Alternatifnya — membagi saldo menurut PORSI laporan tiap sumber — ditolak oleh satu akun:
// designingaround.com Agustus 2026 melaporkan AdX Rp 1.384 dan AFC Rp 2.061.896, jadi prorata
// menaruh 99,93% dari saldo Rp 23.016.432 di kolom AdSense. Uang itu Ad Exchange lewat MCM
// (inventarisnya didelegasikan ke parent — lihat /adx-costs), yang tidak muncul di laporan network
// sendiri sama sekali: Juli-nya melaporkan Rp 2.696 lalu dibayar Rp 38.690.091. Residu benar
// justru karena ia tidak menuntut laporan melihat seluruh uangnya — apa pun yang tidak terlihat
// AdSense memang Ad Exchange.
//
// SELISIHNYA DIKETAHUI DAN DITERIMA: `Saldo Adsense` adalah earning ESTIMASI yang belum kena
// potongan final Google (saldo ÷ laporan bulan yang sama: 0,856 petcins / 0,813 masseffectstore /
// 0,913 stylefemale), jadi kolom AdSense kelebihan ~9-19% DARI ANGKANYA SENDIRI dan residunya
// kekurangan sebesar itu — Rp 8 sampai Rp ~250.000, alias 0,00003%-1,1% dari saldonya. Yang eksak
// cuma halaman Transaksi AdSense, dan itu memang harus diketik orang.

// Simbol mata uang yang mungkin muncul di `amount`. Dokumen Google menulis contohnya sebagai
// "¥1,235 JPY", "$1,234.57", "£87.65" — jadi kodenya tidak selalu ikut, dan yang tidak menyebut
// kodenya harus bisa dikenali dari simbolnya. Yang tidak dikenali TIDAK ditebak (lihat parseMoney).
const CURRENCY_SYMBOLS = { $: "USD", "£": "GBP", "€": "EUR", "¥": "JPY", "₹": "INR" };

// Angka gaya en-US, dijangkarkan ujung ke ujung: "55,781,000" dan "1,227.48", bukan "1.227,48".
// Dijangkarkan karena yang dibaca dari sini adalah UANG — pola yang cuma mencari angka di tengah
// teks akan menyisir "IDR 55,781,000" jadi 55781000 juga, tapi ia akan sama diamnya pada bentuk
// yang tidak kita kenali, dan yang tersimpan lalu meleset seribu kali tanpa satu pun tanda.
const AMOUNT = /^-?\d{1,3}(?:,\d{3})*(?:\.\d+)?$|^-?\d+(?:\.\d+)?$/;

/**
 * "IDR 55,781,000" -> { amount: 55781000, currency: "IDR" }. Yang tidak terurai -> null.
 *
 * `null`, bukan 0: nol adalah pernyataan bahwa akunnya tidak punya saldo, dan itu pernyataan yang
 * salah untuk akun yang cuma menjawab dalam bentuk yang belum pernah kita lihat.
 */
export function parseMoney(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  // Kode tiga huruf sebagai token tersendiri, di depan ("IDR 55,781,000") maupun di belakang
  // ("¥1,235 JPY"). Ia menang atas simbol: yang menyebut keduanya menyebut kodenya dengan pasti,
  // dan "¥" sendiri dipakai dua mata uang.
  const code = raw.match(/(?:^|\s)([A-Z]{3})(?=\s|$)/)?.[1] || "";
  const symbol = Object.keys(CURRENCY_SYMBOLS).find((s) => raw.includes(s));
  const currency = code || (symbol ? CURRENCY_SYMBOLS[symbol] : "");
  if (!currency) return null;

  const number = raw
    .replace(/(?:^|\s)[A-Z]{3}(?=\s|$)/g, " ")
    .replace(/[$£€¥₹]/g, " ")
    .trim();
  if (!AMOUNT.test(number)) return null;

  const amount = Number(number.replace(/,/g, ""));
  return Number.isFinite(amount) ? { amount, currency } : null;
}

/**
 * Saldo berjalan dari jawaban `accounts.payments.list`.
 *
 * `youtube-unpaid` sengaja DILEWATI: ia saldo produk lain di kantong yang sama, dan menjumlahkannya
 * ke sini berarti kolom Saldo di halaman GAM memuat uang yang tidak berasal dari satu pun domain
 * yang ada di dashboard ini.
 */
export function unpaidBalance(payments) {
  const row = (payments || []).find(
    (p) =>
      String(p?.name || "").endsWith("/payments/unpaid") && !String(p?.name).includes("youtube"),
  );
  return row ? parseMoney(row.amount) : null;
}

/**
 * Bulan yang dianggap sudah final, sebagai rentang laporan {startDate,endDate} gaya API Google.
 *
 * BULAN KALENDER PENUH TERAKHIR, dan itu tebakan yang dibuat dengan bukti — bukan pilihan yang
 * nyaman. `payments` cuma mengembalikan SATU baris terbayar (yang terakhir), jadi tidak ada apa pun
 * di API yang menyebutkan periode mana yang sedang menganggur. Yang mengarahkannya: pada 4 Sep
 * 2026, saldo stylefemale.com ÷ laporan AGUSTUS = 0,913, hampir sama dengan pembayaran 21 Agu ÷
 * laporan JULI = 0,899 (dua-duanya rasio finalisasi); dengan September ikut dihitung rasionya
 * jatuh ke 0,778, jauh dari keduanya. Akun lain sepola (0,856 dan 0,813 untuk bulan saja).
 *
 * Konsekuensinya diketahui: kalau saldo suatu akun ternyata sudah memuat bulan berjalan, kolom
 * AdSense-nya kekurangan sebesar AFC bulan berjalan — untuk masseffectstore.com 1-3 Sep 2026 itu
 * Rp 2.041.659, 6,8% saldonya. Yang salah cuma pecahannya; totalnya tetap angka Google.
 */
export function balanceMonth(todayKey) {
  const [year, month] = String(todayKey || "")
    .split("-")
    .map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  const y = month === 1 ? year - 1 : year;
  const m = month === 1 ? 12 : month - 1;
  // Tanggal 0 bulan berikutnya = hari terakhir bulan ini, jadi Februari tidak perlu dihitung
  // sendiri. UTC, karena yang diminta cuma panjang bulannya — bukan hari yang sedang berjalan.
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { startDate: { year: y, month: m, day: 1 }, endDate: { year: y, month: m, day: last } };
}

/**
 * Kolom saldo satu akun: `{ saldo, saldoCurrency, saldoFxRate, saldoAdsense, saldoAdExchange,
 * saldoDetail }` — atau hanya `saldoDetail` kalau saldonya tidak bisa dibaca sama sekali.
 *
 * NILAI LAMA DIBIARKAN BERDIRI saat gagal, persis seperti kolom Status: sekali kegagalan API
 * ditulis sebagai Rp 0, yang dibaca orang di kolom Saldo bukan lagi keadaan akun melainkan keadaan
 * sync — dan keduanya tidak bisa dibedakan di layar.
 *
 * DINORMALKAN KE IDR, sepola `convertRowsToIdr`: tiga dari tujuh publisher menjawab dalam USD, dan
 * kolom Saldo berdiri di antara kolom-kolom yang seluruhnya "Rp 1.235" — angka dolar di sana akan
 * terbaca sebagai rupiah oleh setiap orang yang melihatnya. Mata uang aslinya + kursnya ikut
 * disimpan supaya angka aslinya tidak hilang. Kurs HARI INI memang kurs yang benar di sini: yang
 * dikonversi adalah uang yang belum cair, bukan pendapatan hari lampau.
 */
export function balanceSplit({ balance, adsenseEarning, adsenseNote, rate } = {}) {
  if (!balance) {
    return { saldoDetail: balanceCheckNote("Google tidak menyebutkan saldo akun ini.") };
  }
  if (rate == null) {
    return {
      saldoDetail: balanceCheckNote(`Kurs ${balance.currency} ke IDR tidak diketahui.`),
    };
  }

  const saldo = Math.round(balance.amount * rate);
  const base = {
    saldo,
    saldoCurrency: balance.currency,
    // Hanya diisi saat konversi asing benar-benar terjadi — baris IDR dibiarkan bersih, aturan
    // yang sama dengan `fxRate` di baris ROI.
    saldoFxRate: balance.currency === "IDR" ? null : rate,
  };

  // Laporan AdSense-nya gagal: totalnya tetap ditulis (ia tidak bergantung pada laporan itu),
  // pecahannya DIKOSONGKAN. Pecahan lama di sebelah total yang baru adalah dua angka dari dua hari
  // berbeda yang tampak seperti satu baris.
  if (!Number.isFinite(adsenseEarning)) {
    return {
      ...base,
      saldoAdsense: null,
      saldoAdExchange: null,
      saldoDetail: `Pecahan tidak dihitung: ${adsenseNote || "laporan AdSense untuk bulan itu tidak bisa diambil."}`,
    };
  }

  const saldoAdsense = Math.round(adsenseEarning * rate);
  // Residu minus BUKAN angka yang boleh digambar: ia keadaan yang sah (potongan final memakan
  // sisanya, atau saldonya sudah dibayarkan sementara laporannya belum bergerak), dan
  // "Ad-Exchange -Rp 300.000" adalah klaim yang tidak pernah benar. Yang ditulis sebabnya.
  if (saldoAdsense > saldo) {
    return {
      ...base,
      saldoAdsense: null,
      saldoAdExchange: null,
      saldoDetail: `Pecahan tidak dihitung: earning AdSense (${rupiah(saldoAdsense)}) melebihi saldo (${rupiah(saldo)}).`,
    };
  }

  return {
    ...base,
    saldoAdsense,
    saldoAdExchange: saldo - saldoAdsense,
    // `null` MENGHAPUS keterangan, bukan menulis kosong — baris yang tadinya gagal harus berhenti
    // menyebutkannya begitu ia berhasil dibaca lagi.
    saldoDetail: null,
  };
}

// Angka di dalam kalimat keterangan. Diformat di sini karena kalimatnya disusun sisi sync, yang
// tidak punya pemformat uang dashboard ini — dan "melebihi saldo (55781000)" adalah satu-satunya
// angka di layar yang tidak berbunyi seperti tetangganya.
function rupiah(value) {
  return `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}

// Sepola `statusCheckNote`: satu kalimat, sebabnya di depan, panjangnya dijepit supaya satu pesan
// API yang bertele-tele tidak mendorong seluruh kolom lain keluar layar.
export function balanceCheckNote(error) {
  const raw = String(error?.message || error || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return "Saldo tidak bisa dibaca: sebabnya tidak disebutkan.";
  const [first] = raw.split(/(?<=\.)\s/);
  return `Saldo tidak bisa dibaca: ${(first || raw).slice(0, 200)}`;
}
