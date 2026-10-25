import { CopyButton } from "../components/ui/CopyButton";
import { countryName, flagUrl } from "./countries.js";
import { firstValue } from "./firstValue";
import { formatDate, formatDateTime, formatMonth, isDateLike, isMonthLike } from "./formatDate";

const secretKeys = ["passwordAkun", "passwordDomain", "passwordWp", "clientSecret"];
// `adApproval` = status persetujuan situs di sisi Google (lihat functions/site-approval.js).
// Ikut jadi chip, bukan teks biasa: kolomnya berdiri di sebelah kolom "Status" di /domains, dan
// dua kolom status yang satu berlencana dan satu tidak terbaca seolah yang kedua cuma catatan.
// `approvalStatus`, `setupAdx`, dan `setupSub` (Cost Ad Exchange) masuk BERTIGA atau tidak sama
// sekali: ketiganya berdiri bersebelahan di tabel yang sama, dan satu kolom status berlencana di
// antara dua yang tidak akan terbaca seolah dua sisanya cuma catatan — alasan yang sama yang
// menjadikan `adApproval` lencana di /domains.
const badgeKeys = [
  "status",
  // Status yang dibaca sync terakhir kali, berdiri PERSIS di sebelah kolom Status. Ikut berlencana
  // dengan alasan yang sama seperti `adApproval` di atas — dan di sini alasannya lebih tajam lagi:
  // kedua kolom memakai kosakata yang SAMA, dan yang tidak berlencana akan terbaca sebagai catatan
  // tentang statusnya alih-alih sebagai keadaan kedua yang sedang berselisih dengannya.
  "statusAuto",
  "pluginOn",
  "role",
  "adApproval",
  "syncDisabled",
  "approvalStatus",
  "setupAdx",
  "setupSub",
  // Dari mana Earning & Ad Spend sebuah baris Invalid Traffic datang. Lencana, bukan teks biasa:
  // ia berdiri PERSIS di antara kolom-kolom uang yang keterangannya ia berikan, dan teks abu-abu
  // di sana terbaca sebagai catatan alih-alih sebagai penanda angka di kirinya.
  "dataSource",
];
const moneyKeys = [
  "adTax",
  // Item Cash Out Flow di halaman Cash Flow. Kunci sendiri dan bukan "nominal"/"spending" yang
  // sudah ada, karena yang dibawanya bukan cuma "ini uang" melainkan ARAHNYA — lihat outflowKeys.
  "cashOut",
  "adsense",
  "amount",
  "balance",
  "costPerResult",
  // CPC = earning AdSense ÷ klik, jadi ia uang seperti eCPM di sebelahnya — dan uang di dashboard
  // ini dibulatkan ke rupiah utuh. Sebelum masuk daftar ini nilainya lolos apa adanya dari DB:
  // `earning / clicks` tidak pernah dibulatkan saat ditulis, jadi selnya menampilkan
  // "1234.5678901234567" di antara kolom-kolom yang semuanya "Rp 1.235".
  "cpc",
  "cpr",
  // Kolom turunan Invalid Traffic. Keempatnya uang, dan tiga di antaranya ("check1".."check3")
  // adalah nominal yang diketik orang — tanpa didaftarkan di sini mereka tampil sebagai angka
  // telanjang di antara kolom yang semuanya "Rp 1.235".
  "check1",
  "check2",
  "check3",
  // Rantai Laporan Pencairan Rekening, dari earning Google sampai yang mendarat di rekening.
  // Tanpa didaftarkan di sini kesembilannya tampil sebagai angka telanjang di antara kolom yang
  // semuanya "Rp 1.235" — dan `sunatGoogle`, satu-satunya yang boleh minus, kehilangan warna
  // merah yang menandainya sebagai potongan.
  "company",
  "earningFinal",
  "feeNominal",
  "invalidTraffic",
  "potonganKonversi",
  "realMasuk",
  "saldoAkhir",
  "saldoClose",
  "saldoSebelumnya",
  "sunatGoogle",
  "dailyBudget",
  "dailyReduction",
  "ecpm",
  "earning",
  "feeTopup",
  "metaAds",
  "metaBalance",
  "netProfit",
  "nominal",
  "profit",
  "total",
  "revenueToday",
  "saldo",
  // Pecahan saldo akun Google (functions/account-balance.js). Keduanya rupiah — `saldo` di
  // sebelahnya sudah lama di sini — dan tanpa didaftarkan mereka berdiri sebagai angka telanjang
  // di antara dua kolom yang berbunyi "Rp 55.781.000".
  "saldoAdExchange",
  "saldoAdsense",
  "spend",
  "spendCap",
  "spendToday",
  "spending",
  "syncCpc",
  "syncEarning",
  "syncPageRpm",
  "totalPayout",
  "totalSpending",
];

// Ad Tax dan Total Spend sengaja tidak di sini meski keduanya uang keluar: kolom "Spend (Meta)"
// di sebelahnya juga uang keluar dan tidak pernah merah, dan tiga kolom bersebelahan dengan dua
// warna berbeda akan terbaca seolah salah satunya kabar buruk.
//
// `cashOut` justru KEBALIKANNYA, dan itu yang membuatnya boleh ikut: di kartu arus kas, uang masuk
// dan uang keluar berdiri di dua kelompok yang berbeda dan memang harus dibedakan — warnanya
// menandai KELOMPOKNYA, bukan menilai satu angka lebih buruk daripada tetangganya. Tanpa itu,
// sembilan angka hijau berderet dan yang membedakan pemasukan dari pengeluaran cuma judul di
// atasnya. Nilainya tetap digambar positif; yang berubah cuma warnanya.
const outflowKeys = ["amount", "cashOut", "dailyReduction"];

// Kolom yang jamnya tidak berarti apa-apa meski nilainya membawa jam. `adApprovalAt` datang dari
// GAM sebagai stempel UTC berjam ("2025-09-24T18:59:25Z"); jam persetujuan tidak menjawab apa pun,
// dan dikonversi ke WIB ia malah menggeser tanggalnya ke hari berikutnya.
const dateKeys = ["date", "expDomain", "spendDate", "periodDate", "tanggal", "adApprovalAt"];

const badgeToneByValue = {
  active: "success",
  connected: "success",
  on: "success",
  synced: "success",
  selesai: "success",
  // Empat keadaan akun Google (`src/lib/accountStatus.js`), dan warnanya MENIRU dashboard AdSense
  // sendiri: dua yang berdiri merah di sana berdiri merah di sini juga. Yang dicari orang saat ia
  // membuka halaman GAM/AdSense adalah baris yang notifnya merah — kalau di sini salah satunya
  // kuning, ia harus membaca seluruh kolom untuk menemukan yang mana.
  "akun close": "danger",
  "limit iklan": "danger",
  // Kuning, bukan merah: Google tidak menghukum apa pun di sini — tidak ada notif sama sekali, dan
  // yang dilaporkan cuma laporan hari terakhir yang nol. Ia menuntut pengecekan (buka domainnya),
  // bukan tindakan di Pusat Kebijakan.
  "iklan belum tayang": "warning",
  // Hijau, bukan biru. Ia berarti "iklan tayang, tidak ada yang perlu dikerjakan" — arti yang sama
  // dengan seluruh hijau di dashboard ini. Kata yang sama juga dipakai kolom Status Terkini di
  // /targets, dan artinya di sana pun kabar baik.
  ready: "success",
  // Persetujuan situs, dua kosakata untuk satu kolom: "Disetujui/Ditolak" kata Ad Manager,
  // "Siap/Perlu Tindakan" kata AdSense. Tidak disatukan dengan sengaja — kata yang dipakai di
  // konsolnya adalah yang dicari orang saat ia pergi memperbaikinya.
  disetujui: "success",
  siap: "success",
  // Kosakata ketiga untuk hal yang sama, dan sengaja tidak disatukan dengan dua di atas: yang
  // dipakai di spreadsheet Cost Ad Exchange adalah kata yang dicari orang saat ia membandingkan
  // keduanya baris per baris. "Belum" (setup yang belum dikerjakan) sengaja TIDAK diberi nada —
  // ia nilai yang sama dengan status Reminder, dan mewarnainya di sini akan mewarnai halaman itu
  // juga, untuk keputusan yang tidak pernah diambil siapa pun di sana.
  approve: "success",
  done: "success",
  ditolak: "danger",
  "perlu review": "warning",
  "perlu tindakan": "danger",
  disiapkan: "info",
  draft: "muted",
  "belum dicek": "muted",
  // Status turunan sebuah tarif Potongan Company. "Berakhir" sengaja TIDAK merah: ia tarif yang
  // sudah digantikan, dan ia masih dipakai untuk bulan-bulan lampau — seluruh alasan koleksi itu
  // ada. Yang menuntut tindakan cuma "Ditimpa": tarif yang tidak pernah berlaku sehari pun, hampir
  // selalu salah ketik tanggal.
  // Baris Invalid Traffic yang angkanya diketik orang. Kuning, bukan merah: angka ketikan bukan
  // kesalahan — ia satu-satunya angka yang ada untuk bulan yang laporannya tidak pernah datang.
  // Yang dituntutnya cuma perhatian, yaitu persis arti kuning di dashboard ini.
  manual: "warning",
  "manual (earning)": "warning",
  "manual (spend)": "warning",
  api: "neutral",
  terjadwal: "info",
  berakhir: "muted",
  ditimpa: "danger",
  admin: "purple",
  user: "info",
  advertiser: "warning",
  review: "warning",
  limit: "warning",
  "lepas limit": "success",
  pending: "warning",
  // Tiga keadaan sebuah pencairan. "Account Close" merah dan bukan abu-abu: saldonya hangus —
  // bukan baris lampau yang sudah selesai, melainkan uang yang tidak akan pernah datang.
  "sudah cair": "success",
  "pending payment": "warning",
  "account close": "danger",
  nonaktif: "warning",
  aktif: "success",
  inactive: "muted",
  disconnected: "danger",
  // Kredensial Google yang aksesnya terbukti hilang saat sync (`REVOKED_STATUS` di
  // functions/google-oauth-core.js), dan yang tokennya tersimpan tapi izinnya kurang
  // (`PARTIAL_STATUS`). Keduanya sebelumnya jatuh ke lencana netral — abu-abu di kolom yang
  // tetangganya hijau "Connected" terbaca sebagai keadaan yang tidak menuntut apa-apa, padahal
  // keduanya persis kebalikannya.
  "perlu dihubungkan": "danger",
  "scope kurang": "warning",
  off: "danger",
  failed: "danger",
};

export function renderCell(value, key) {
  if (isSecretKey(key)) {
    return <span className="secret">********</span>;
  }

  if (key === "syncStatus") {
    // Boolean dari sync: true = Synced, false = Pending. TAPI string (mis. "Nonaktif" untuk akun yang
    // saklar Sync Meta-nya dimatikan) ditampilkan apa adanya sebagai badge — "Synced" untuk akun
    // yang justru berhenti disync adalah label yang berbohong.
    const label = typeof value === "string" && value ? value : value ? "Synced" : "Pending";
    return <StatusChip value={label} />;
  }

  if (typeof value === "boolean") {
    return <StatusChip value={value ? "Synced" : "Pending"} />;
  }

  if (badgeKeys.includes(key)) {
    return <StatusChip value={value} />;
  }

  if (key === "country") {
    return <CountryCell code={value} />;
  }

  if (moneyKeys.includes(key) || isRupiahText(value)) {
    // `amount` hanya dipakai kolom "Saldo Berkurang", dan `dailyReduction` kolom "Pengurangan
    // Hari Ini". Keduanya uang yang keluar; disimpan sebagai angka positif, tapi hijau di sana
    // membacanya terbalik.
    return <MoneyValue value={value} forceNegative={outflowKeys.includes(key)} />;
  }

  // Kunci bulan telanjang ("2026-08") -> "Agu 2026". Diperiksa SEBELUM isDateLike karena ia
  // bentuk yang berbeda, bukan tanggal yang kurang lengkap: dilewatkan ke formatDate, "2026-08"
  // kembali apa adanya.
  if (isMonthLike(value)) {
    return formatMonth(value);
  }

  // Tanggal dikenali dari bentuk nilainya, bukan dari nama kolomnya: tabel yang dibuat nanti ikut
  // format "09 Agu 2026" tanpa perlu didaftarkan di sini dulu. Yang bukan tanggal tidak disentuh.
  if (isDateLike(value)) {
    return dateKeys.includes(key) || !/[T ]\d{2}:\d{2}/.test(value)
      ? formatDate(value)
      : formatDateTime(value);
  }

  // Satu sel bisa memuat beberapa link (satu subdomain menaungi beberapa campaign), jadi yang
  // digambar adalah daftar — bukan satu <a> berisi teks yang di dalamnya ada koma.
  const links = urlList(value);
  if (links) {
    return (
      <span className="cell-links">
        {links.map((url) =>
          // Tombol salin hanya untuk Campaign URL, dan itu bukan kelalaian di kolom lain: link di
          // dashboard ini dibuka, sedangkan yang ini DIPASANG di iklan — ia harus berpindah ke
          // tempat lain utuh, dan link yang disalin dengan menyorot teksnya yang terpotong
          // ellipsis kehilangan ujungnya tanpa satu pun tanda di layar.
          key === "campaignUrl" ? (
            <CopyableLink key={url} url={url} />
          ) : (
            <a href={url} key={url} rel="noreferrer noopener" target="_blank">
              {url}
            </a>
          ),
        )}
      </span>
    );
  }

  // `value || "-"` menelan angka 0: ROI 0% dan 0 klik jadi tak terbedakan dari data yang memang
  // tidak ada. Hanya nilai yang benar-benar kosong yang pantas jadi "-".
  return firstValue(value);
}

/**
 * Daftar URL http(s) di dalam sebuah sel, atau `null` kalau selnya bukan itu.
 *
 * Dijangkarkan ujung ke ujung, disiplin yang sama dengan `isRupiahText` dan karena alasan yang
 * sama: sebuah sel adalah tautan kalau SELURUH isinya tautan. Kalimat yang KEBETULAN menyebut
 * sebuah alamat ("sudah dipindah ke https://... per Agustus") adalah catatan orang, dan
 * menjadikannya satu tautan raksasa berarti seluruh kalimatnya jadi href.
 *
 * Kolom yang menyimpan hostname telanjang (`domainUrl` di /domains) sengaja TIDAK ikut: tanpa
 * skema, "designingaround.com" sebagai href dibaca browser sebagai path relatif — tautan yang
 * mengirim orang ke halaman dashboard yang tidak ada, bukan ke situsnya.
 */
function urlList(value) {
  if (typeof value !== "string") return null;
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return null;
  return parts.every((part) => /^https?:\/\/\S+$/.test(part)) ? parts : null;
}

export function isSecretKey(key) {
  return secretKeys.includes(key);
}

/**
 * Negara sebuah domain: bendera plus namanya.
 *
 * Benderanya GAMBAR dari flagcdn.com, bukan emoji. Emoji bendera adalah dua huruf penanda wilayah
 * yang digabung font — dan Segoe UI Emoji tidak memuat satu pun bendera, jadi di Windows yang
 * muncul justru "PK" telanjang. Yang membuka dashboard ini Windows.
 *
 * `onError` menyembunyikan gambarnya, bukan menampilkan ikon rusak: yang menerangkan sel ini
 * adalah NAMA negaranya di sebelah kanan, dan bendera cuma mempercepat pencarian mata. Jaringan
 * yang tidak bisa menjangkau flagcdn karena itu kehilangan hiasan, bukan kehilangan informasi.
 */
function CountryCell({ code }) {
  const name = countryName(code);
  if (!name) return "-";
  const src = flagUrl(code);

  return (
    <span className="country-cell">
      {src ? (
        <img
          alt=""
          height={12}
          loading="lazy"
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
          src={src}
          srcSet={`${src} 1x, ${flagUrl(code, 40)} 2x`}
          width={18}
        />
      ) : null}
      {name}
    </span>
  );
}

/**
 * Satu campaign URL berikut tombol salinnya.
 *
 * "Tersalin" bertahan sebentar lalu kembali, sepola dengan tombol Salin di /otp — dan itu satu-
 * satunya kabar yang diberikan: toast untuk tindakan sekecil ini akan menumpuk di layar orang yang
 * menyalin link beberapa baris berturut-turut. Yang GAGAL tetap bersuara, karena diam di sana
 * berarti orangnya menempelkan isi papan klip yang lama ke iklannya.
 */
function CopyableLink({ url }) {
  return (
    <span className="cell-link-copy">
      <a href={url} rel="noreferrer noopener" target="_blank">
        {url}
      </a>
      <CopyButton className="cell-copy-button" label={`Salin ${url}`} text={url} />
    </span>
  );
}

function StatusChip({ value }) {
  const normalized = String(value || "-")
    .trim()
    .toLowerCase();
  const tone = badgeToneByValue[normalized] || "neutral";

  return <span className={`badge ${tone}`}>{value || "-"}</span>;
}

// GAM revenue untuk network yang menagih dalam mata uang asing disimpan sudah dikonversi ke IDR
// (supaya ROI dan totalnya benar). Ditampilkan sebagai IDR seperti kolom uang lain — jadi bisa
// dijumlah/dibandingkan sekilas — tapi warnanya sedikit lebih hijau (.money-converted) sebagai
// penanda "ini konversi dari USD, bukan IDR asli", dan nilai USD aslinya muncul saat di-hover.
// Baris IDR (currency "IDR" atau tanpa kurs) jatuh ke tampilan Rp biasa.
export function MoneyByCurrency({ value, currency, fxRate, forceNegative = false }) {
  const cur = String(currency || "IDR").toUpperCase();
  const rate = Number(fxRate);
  if (cur !== "IDR" && Number.isFinite(rate) && rate > 0 && typeof value === "number") {
    const native = value / rate;
    return (
      <span className="money-converted" title={`Asli ${formatCurrencyNative(native, cur)}`}>
        {formatRupiahValue(value)}
      </span>
    );
  }
  return <MoneyValue value={value} forceNegative={forceNegative} />;
}

function formatCurrencyNative(value, currency) {
  if (!Number.isFinite(value)) return "-";
  const symbol = currency === "USD" ? "$" : `${currency} `;
  const formatted = Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${value < 0 ? "-" : ""}${symbol}${formatted}`;
}

function MoneyValue({ value, forceNegative = false }) {
  const text = String(value || "-").trim();
  const numeric = parseRupiah(text);
  const tone =
    forceNegative || numeric < 0 || text.startsWith("-") ? "money-negative" : "money-positive";

  return <span className={tone}>{formatRupiahValue(value)}</span>;
}

/**
 * Baris LAMA yang menyimpan uangnya sebagai teks berformat ("Rp 1.000") — bukan sekadar teks yang
 * MENYEBUT sebuah nominal.
 *
 * Diperiksa dari ujung ke ujung, dan itu seluruh isinya. Sebelumnya cukup ada "Rp" diikuti angka di
 * mana pun dalam teks, dan akibatnya baru terlihat di kolom Kode PIP halaman Pencairan — yang
 * isinya kutipan notifikasi Google: "Pembayaran otomatis: Rekening bank • • • • 017 sebesar
 * Rp 38.690.091. GG104I25R0" lolos pemeriksaan itu, lalu `parseRupiah` menyisir SELURUH kalimatnya
 * jadi digit dan mengelem nomor rekening, nominalnya, dan kode PIP-nya jadi satu angka:
 * "Rp 1.738.690.091.104.250".
 *
 * Kolom keterangan mana pun bisa memuat kalimat begitu — "sudah dibayar Rp 500.000" di catatan
 * Expenses atau Reminder jatuh ke lubang yang sama. Sebuah sel adalah uang kalau SELURUH nilainya
 * uang; yang cuma menyebutnya adalah kalimat, dan kalimat digambar apa adanya.
 */
function isRupiahText(value) {
  return typeof value === "string" && /^-?\s*rp\s*[\d.,]+$/i.test(value.trim());
}

function parseRupiah(value) {
  // A real number (e.g. GAM earning/cpc from the DB) is used as-is — do NOT strip its
  // decimal point. Only formatted strings ("Rp 1.000") get the non-digit scrub, where
  // "." is a thousand separator.
  if (typeof value === "number") return value;
  const cleaned = String(value).replace(/[^\d-]/g, "");
  return Number(cleaned || 0);
}

/**
 * "Rp 1.200.000" sebagai TEKS biasa, tanpa warna dan tanpa elemen.
 *
 * Diekspor untuk kalimat — keterangan panel, notice-line — yang menyebut sebuah nominal di
 * tengahnya. `renderCell` menggambar `<span>` bernada hijau/merah, dan nada itu berarti "arah
 * uang" di sebuah kolom; di tengah kalimat ia cuma satu kata berwarna tanpa sebab.
 */
export function formatRupiah(value) {
  return formatRupiahValue(value);
}

function formatRupiahValue(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  // Numeric values from the DB may be fractional (earning, cpc, rpm). Format directly so
  // the decimal isn't mistaken for a thousand separator (which blew 4352.07 up to 4.3e15).
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "-";
    const formatted = Math.abs(value).toLocaleString("id-ID", { maximumFractionDigits: 0 });
    return `${value < 0 ? "-Rp " : "Rp "}${formatted}`;
  }

  const text = String(value).trim();
  const numeric = parseRupiah(text);
  const hasDigits = /\d/.test(text);

  if (!numeric && !hasDigits) {
    return text;
  }

  const prefix = numeric < 0 || text.startsWith("-") ? "-Rp " : "Rp ";
  return `${prefix}${Math.abs(numeric).toLocaleString("id-ID")}`;
}
