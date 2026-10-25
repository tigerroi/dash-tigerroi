import { balanceCheckNote, balanceMonth, balanceSplit, unpaidBalance } from "./account-balance.js";
import { accountStatusFields, accountStatusFrom, accountStatusNote } from "./account-status.js";
import {
  accountResourceName,
  getAccount,
  listAlerts,
  listPayments,
  runAccountReport,
  runAccountReportByDimension,
  runAccountReportByDimensions,
} from "./adsense.js";
import { idrPerUnit } from "./fx.mjs";
import {
  listNetworks,
  runNetworkReport,
  runNetworkReportByDimension,
  runNetworkReportByDimensions,
} from "./gam.js";
import { fetchAccount } from "./meta.js";
import { accessTokenFrom } from "./oauth.mjs";

// Shared per-account sync logic. Returns the RTDB update object; callers write it with
// whichever SDK they have (Cloud Function = admin, CLI = client). No DB access here.

// --- Tanggal, dalam zona waktu operasi --------------------------------------------------------
//
// Setiap tanggal yang dibaca orang di dashboard ini adalah tanggal Jakarta: kolom Date, kunci
// baris riwayat, dan batas "kemarin" yang menentukan hari mana yang dilaporkan. Sebelumnya
// semuanya diambil dari `toISOString()`, yang UTC — jadi sync yang jalan antara 00:00 dan 07:00
// WIB menulis barisnya ke tanggal kemarin, dan kolom Date di Overview berganti hari jam tujuh
// pagi alih-alih tengah malam.
export function syncTimeZone() {
  return process.env.SYNC_TIMEZONE || "Asia/Jakarta";
}

const zoneFormatters = new Map();
function zonedParts(date, timeZone) {
  let formatter = zoneFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    zoneFormatters.set(timeZone, formatter);
  }
  const parts = {};
  for (const part of formatter.formatToParts(date)) parts[part.type] = part.value;
  return parts;
}

// "2026-08-08" menurut zona waktu operasi.
export function zonedDateKey(date = new Date(), timeZone = syncTimeZone()) {
  const parts = zonedParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// Jadikan sebuah nama aman sebagai KUNCI RTDB. Firebase menolak kunci berisi . # $ / [ ] —
// dan penanda harian dikunci dengan nama subdomain/network (hostname penuh berisi titik), jadi
// tiap peringatan yang benar-benar berbunyi menjatuhkan update-nya sendiri. Simetris di baca &
// tulis, tak pernah di-decode balik, jadi tabrakan a.b vs a_b tak mungkin untuk hostname sungguhan.
export function rtdbKey(name) {
  return String(name).replace(/[.#$/[\]]/g, "_");
}

// "14:32" menurut zona waktu operasi. Beberapa runtime menulis tengah malam sebagai "24".
export function zonedClock(date = new Date(), timeZone = syncTimeZone()) {
  const parts = zonedParts(date, timeZone);
  return `${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}`;
}

// Geser kunci tanggal beberapa hari. Dihitung di tengah hari UTC supaya pergeseran zona waktu
// atau DST tidak pernah membuatnya meleset satu hari.
export function shiftDateKey(key, days) {
  const base = new Date(`${key}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

// Kunci tanggal apa pun bentuknya — string "YYYY-MM-DD" dipakai apa adanya, Date diterjemahkan
// ke tanggal zona operasi. Dipakai semua fungsi di bawah supaya pemanggil lama tetap jalan.
export function dayKeyOf(value = new Date()) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return zonedDateKey(value instanceof Date ? value : new Date());
}

function gamDay(key) {
  const [year, month, day] = key.split("-").map(Number);
  return { year, month, day };
}

// Hari terakhir yang SUDAH SELESAI menurut zona operasi: kemarin. Ini hari yang angkanya final —
// GAM sudah menutup bukunya — dan karena itu tetap jadi hari acuan dashboard (`period.key`),
// default tabel, dan satu-satunya hari yang boleh dibaca sebagai laporan.
export function reportDayKey(now = new Date()) {
  return shiftDateKey(zonedDateKey(now), -1);
}

// Hari BERJALAN menurut zona operasi: hari ini, yang angkanya belum selesai di kedua API.
export function runningDayKey(now = new Date()) {
  return zonedDateKey(now);
}

/**
 * Apakah run juga melaporkan hari berjalan.
 *
 * Hari ini bisa diminta ke kedua API — Meta hampir real-time, dan laporan HISTORICAL GAM menerima
 * tanggal hari ini — tapi angkanya belum dikonsolidasi: revenue Ad Exchange masih berubah setelah
 * harinya tutup. Barisnya karena itu ditandai `partial: true` dan tidak pernah menjadi default
 * tabel mana pun. Matikan dengan SYNC_INCLUDE_TODAY=0 kalau angka setengah hari lebih banyak
 * menimbulkan pertanyaan daripada menjawabnya.
 */
export function includeRunningDay() {
  return String(process.env.SYNC_INCLUDE_TODAY ?? "1").trim() !== "0";
}

// Semua kunci tanggal dari `since` sampai `until`, inklusif.
export function dateKeysBetween(since, until) {
  const keys = [];
  for (let key = since; key <= until; key = shiftDateKey(key, 1)) {
    keys.push(key);
    if (keys.length > 400) break; // jaring pengaman kalau `until` < `since` karena salah hitung
  }
  return keys;
}

/**
 * Periode satu run: hari-hari yang dilaporkan, plus bentuk-bentuk yang diminta tiap API.
 *
 * Rentangnya diminta ke GAM dan ke Meta SEKALI dengan DATE sebagai dimensi pertama, lalu dipecah
 * per hari di sisi kita — bukan satu laporan per hari. Laporan GAM adalah job asinkron yang
 * di-poll sampai satu menit per network, dan run yang menembakkannya dua kali tidak selesai dalam
 * batas 9 menit Cloud Functions.
 *
 * - `key`/`settled`: hari yang sudah selesai (kemarin) — hari acuan dashboard.
 * - `running`: hari berjalan (hari ini), atau "" kalau dimatikan. Barisnya ditandai partial.
 * - `keys`: semua hari yang ditulis run ini, urut.
 *
 * Kedua sisi ROI selalu meminta rentang yang sama, jadi tiap baris tetap membandingkan earning dan
 * spend dari hari yang sama — termasuk baris hari berjalan, yang membandingkan dua separuh hari
 * yang sama-sama berjalan. Widen ke belakang via GAM_RANGE_DAYS untuk mengisi ulang riwayat.
 */
export function reportPeriod(now = new Date()) {
  const days = Math.max(1, Number(process.env.GAM_RANGE_DAYS) || 1);
  const settled = reportDayKey(now);
  const running = includeRunningDay() ? runningDayKey(now) : "";
  const until = running || settled;
  const since = shiftDateKey(settled, -(days - 1));
  return {
    key: settled,
    settled,
    running,
    keys: dateKeysBetween(since, until),
    since,
    until,
    days,
    gamRange: { startDate: gamDay(since), endDate: gamDay(until) },
    // Rentang yang berhenti di hari selesai. Dipakai laporan yang hasilnya satu angka tanpa kolom
    // tanggal — kolom Earning di /adsense-accounts — karena angka yang menjumlahkan hari selesai
    // dengan hari berjalan lalu diberi label tanggal hari selesai adalah angka yang berbohong.
    settledRange: { startDate: gamDay(since), endDate: gamDay(settled) },
    // HARI SELESAI ITU SENDIRI, satu hari, dan itu bukan salinan `settledRange` yang lebih pendek:
    // `settledRange` ikut melebar bersama GAM_RANGE_DAYS, dan kolom Earning yang menjumlahkan tiga
    // hari lalu diberi label `lastSyncReportDate` (kemarin) melanggar persis aturan yang ditulis
    // di atasnya. Yang paling gawat bukan kolom uangnya melainkan kolom Status: "Iklan Belum
    // Tayang" diputuskan dari impresi laporan ini, dan lewat jendela tiga hari sebuah akun yang
    // berhenti tayang dua hari lalu masih berbunyi "Ready" karena satu impresi dari hari Senin.
    settledDayRange: { startDate: gamDay(settled), endDate: gamDay(settled) },
  };
}

// Rentang tanggal untuk laporan GAM, berhenti di hari yang sudah selesai. Hanya startDate/endDate —
// objek ini dikirim apa adanya ke API, jadi field tambahan apa pun akan ditolak.
//
// Hari berjalan sengaja TIDAK termasuk: ini default untuk pemanggil yang tidak menyebut rentangnya
// sendiri, dan pemanggil seperti itu tidak punya cara memisahkan hari selesai dari hari berjalan di
// dalam hasilnya. Yang memang melaporkan keduanya mengoper `reportPeriod().gamRange` dan memecahnya
// lewat `gamRowsByDay`.
export function reportRange(now = new Date()) {
  return reportPeriod(now).settledRange;
}

export function resolveCredential(account, configs) {
  if (account.googleCredential) {
    const cfg = Object.values(configs || {}).find((c) => c?.name === account.googleCredential);
    if (!cfg) throw new Error(`googleCredential "${account.googleCredential}" tidak ditemukan.`);
    if (!cfg.refreshToken)
      throw new Error(`"${account.googleCredential}" belum di-connect (klik Login).`);
    return cfg;
  }
  const envDefault = {
    clientId: process.env.GAM_CLIENT_ID,
    clientSecret: process.env.GAM_CLIENT_SECRET,
    refreshToken: process.env.GAM_REFRESH_TOKEN,
  };
  if (!envDefault.refreshToken)
    throw new Error("Akun tanpa googleCredential dan GAM_* env kosong.");
  return envDefault;
}

/**
 * Provider laporan sebuah akun: "gam" (Ad Manager) atau "adsense" (AdSense berdiri sendiri).
 *
 * Field `provider` yang tertulis di record selalu menang. Kalau tidak ada — record lama, ditulis
 * sebelum AdSense jadi sumber kedua — bentuknya yang menjawab: hanya akun Ad Manager yang punya
 * networkCode. Menebak dari koleksi tempat record itu tinggal tidak cukup, karena satu run
 * membaca kedua koleksi ke dalam daftar yang sama.
 */
export function accountProvider(account) {
  const declared = String(account?.provider || "")
    .trim()
    .toLowerCase();
  if (declared === "gam" || declared === "adsense") return declared;
  return account?.networkCode ? "gam" : "adsense";
}

// Alamat akun di API AdSense: "accounts/pub-…". Record GAM menyimpan propertyCode berawalan
// "ca-", yang tidak dikenal API AdSense — accountResourceName yang merapikannya.
export function adsenseAccountName(account) {
  return accountResourceName(account?.accountName || account?.publisherId || "");
}

// Nama akun untuk pesan kesalahan: yang dibaca orang, bukan id pushnya.
export function accountLabel(account) {
  // Nama diketik orang ("sheetz.us "); spasi ekor ikut ke isu sync dan status Rasio Penayangan.
  const name = String(account?.name || "").trim();
  return name || account?.networkCode || account?.publisherId || "(tanpa nama)";
}

/**
 * Kedua koleksi akun sebagai satu daftar: [{ id, path, account, provider, label }].
 *
 * Sejak earning bisa datang dari dua API, tiap modul sync harus membaca `gamAccounts` DAN
 * `adsenseAccounts`. Dikumpulkan di sini supaya aturan "mana yang dilewati" hanya ditulis sekali —
 * sebelumnya tiap modul menuliskan `if (!account.networkCode) continue` sendiri-sendiri, dan
 * salinan seperti itu adalah cara akun AdSense diam-diam tidak pernah tersync di satu modul saja.
 *
 * `path` ikut dibawa karena hasil syncnya ditulis balik ke record asalnya, dan dua koleksi berarti
 * id saja tidak lagi menunjuk satu tempat.
 */
export function earningAccounts(gamAccounts, adsenseAccounts) {
  const out = [];
  const collect = (records, path) => {
    for (const [id, account] of Object.entries(records || {})) {
      // `syncDisabled`: akun yang ditutup Google — dimatikan orang di form GAM/AdSense, sepola
      // ad account yang disuspend Meta. Tanpa itu tiap run menanyainya dan mencatat gagal lagi.
      if (!account || account.deletedAt || account.syncDisabled) continue;
      const provider = accountProvider(account);
      // Akun tanpa alamat di API-nya tidak bisa dilaporkan sama sekali: record GAM tanpa
      // networkCode, record AdSense tanpa Publisher ID. Dilewati di sini, bukan dijadikan
      // kegagalan sync — belum pernah dihubungkan bukan kegagalan.
      if (provider === "gam" ? !account.networkCode : !adsenseAccountName(account)) continue;
      out.push({ id, path, account, provider, label: accountLabel(account) });
    }
  };
  collect(gamAccounts, "gamAccounts");
  collect(adsenseAccounts, "adsenseAccounts");
  return out;
}

function requireAddress(account) {
  const provider = accountProvider(account);
  if (provider === "gam") {
    if (!account?.networkCode) throw new Error("Akun GAM tanpa networkCode.");
    return String(account.networkCode);
  }
  const name = adsenseAccountName(account);
  if (!name) throw new Error("Akun AdSense tanpa Publisher ID.");
  return name;
}

// Total hari yang dilaporkan untuk satu akun, dari API mana pun yang jadi sumbernya.
export async function earningUpdate(account, configs, { rates } = {}) {
  const token = await accessTokenFrom(resolveCredential(account, configs));
  const period = reportPeriod();
  const address = requireAddress(account);
  // `settledDayRange`, bukan `gamRange` maupun `settledRange`: kolom-kolom di bawah adalah satu
  // angka untuk SATU tanggal (`lastSyncReportDate`), dan rentang yang menjumlahkan beberapa hari
  // lalu diberi label salah satunya adalah angka yang berbohong — baik ke depan (hari berjalan)
  // maupun ke belakang (GAM_RANGE_DAYS). Hari-hari lain punya tempatnya sendiri di baris ROI, yang
  // memang berkunci per hari.
  const t =
    accountProvider(account) === "adsense"
      ? await runAccountReport(address, period.settledDayRange, token)
      : await runNetworkReport(address, period.settledDayRange, token);
  return {
    syncStatus: true,
    lastSyncActionAt: new Date().toISOString(),
    // Tanggal data-nya, bukan tanggal sync-nya. Keduanya berbeda hari, dan kolom yang tidak
    // menyebut yang mana akan dibaca sebagai angka hari ini.
    lastSyncReportDate: period.key,
    lastSyncPublisherId: account.publisherId || "",
    // Mata uang laporannya, dari header kolom uang — akun AdSense v2 tidak menyebutnya di mana
    // pun, jadi kolom "Mata Uang" di halaman akun selamanya kosong tanpa ini, dan `syncEarning`
    // di sebelahnya adalah angka tanpa satuan. Yang tidak disebut Google tidak ditulis: kolom
    // kosong lebih jujur daripada "IDR" yang ditebak.
    ...(t.reportCurrency ? { currencyCode: t.reportCurrency } : {}),
    syncEarning: t.earning,
    syncImpressions: t.impressions,
    syncClicks: t.clicks,
    syncPageRpm: t.pageRpm,
    syncCpc: t.cpc,
    ...(await accountStatusUpdate(account, token, t)),
    ...(await accountBalanceUpdate(account, token, rates)),
  };
}

/**
 * Kolom saldo: `{ saldo, saldoCurrency, saldoFxRate, saldoAdsense, saldoAdExchange, saldoDetail }`.
 *
 * MENUMPANG TOKEN `earningUpdate`, sepola `accountStatusUpdate` tepat di atasnya, dan TIDAK PERNAH
 * MELEMPAR dengan alasan yang sama: saldo adalah kolom tambahan, dan sync earning yang jatuh karena
 * daftar pembayaran gagal diambil berarti fitur baru menghapus fitur yang dipakai tiap hari.
 *
 * ALAMATNYA SELALU AKUN ADSENSE, termasuk untuk record GAM — Ad Manager API tidak punya satu pun
 * endpoint pembayaran. Aturan pecahannya (dan bukti bahwa tidak ada pecahan di API mana pun) ada di
 * `account-balance.js`; yang di sini cuma I/O-nya.
 */
async function accountBalanceUpdate(account, token, rates) {
  const address = adsenseAccountName(account);
  if (!address) {
    return { saldoDetail: balanceCheckNote("Publisher ID akun ini belum diisi.") };
  }
  try {
    const balance = unpaidBalance(await listPayments(address, token));
    let adsenseEarning = null;
    let adsenseNote = "";
    if (balance) {
      try {
        // Diminta dalam MATA UANG PEMBAYARAN, bukan IDR: angka ini dikurangkan dari saldo, dan
        // `payments` tidak menerima parameter mata uang sama sekali. Konversinya belakangan, sekali,
        // atas kedua angka yang sudah sepadan.
        const report = await runAccountReport(address, balanceMonth(zonedDateKey()), token, {
          currencyCode: balance.currency,
        });
        const reported = String(report?.reportCurrency || "").toUpperCase();
        // Google boleh menolak mata uang yang diminta dan menjawab dalam mata uang akun — dan
        // jawaban itu tidak berbunyi sebagai kesalahan apa pun. Yang tidak sepadan tidak dikurangkan.
        if (reported && reported !== balance.currency) {
          adsenseNote = `laporan AdSense menjawab dalam ${reported}, saldonya ${balance.currency}.`;
        } else {
          adsenseEarning = report?.earning;
        }
      } catch (error) {
        adsenseNote = balanceCheckNote(error).replace(/^Saldo tidak bisa dibaca: /, "");
      }
    }
    return balanceSplit({
      balance,
      adsenseEarning,
      adsenseNote,
      rate: balance ? idrPerUnit(rates, balance.currency) : null,
    });
  } catch (error) {
    return { saldoDetail: balanceCheckNote(error) };
  }
}

/**
 * Kolom Status akun: `{ status, statusAuto, statusDetail }`, atau hanya `statusDetail` kalau tidak
 * bisa dicek — dan hanya `statusAuto` untuk baris yang statusnya sedang dipegang orang.
 *
 * MENUMPANG TOKEN DAN LAPORAN yang sudah ada di `earningUpdate`, bukan run tersendiri: keduanya
 * menjawab satu pertanyaan yang sama ("bagaimana keadaan akun ini pagi ini"), dan status yang
 * dicek di jadwal yang berbeda dari earning-nya akan menyebut hari yang berbeda dari kolom di
 * sebelahnya — persis selisih yang tidak bisa dijelaskan siapa pun sambil menatap satu baris.
 *
 * ALAMATNYA SELALU AKUN ADSENSE, termasuk untuk record GAM. Network Ad Manager membawa
 * `propertyCode` berbentuk `ca-pub-…` — akun AdSense yang sama — dan `adsenseAccountName` sudah
 * merapikan awalan "ca-" itu sejak lama. Ad Manager API sendiri tidak punya notifikasi maupun
 * status akun sama sekali, jadi bercabang di sini berarti halaman GAM tidak akan pernah tahu
 * akunnya dibatasi.
 *
 * TIDAK PERNAH MELEMPAR. Status adalah kolom tambahan; sync earning yang jatuh karena daftar alert
 * gagal diambil berarti satu fitur baru menghapus fitur yang sudah dipakai tiap hari. Yang gagal
 * meninggalkan `status` lama apa adanya dan menuliskan sebabnya di `statusDetail` — satu-satunya
 * tempat "kenapa status ini tidak berubah-ubah" bisa terbaca dari layar.
 *
 * YANG DIPEGANG ORANG TIDAK DITIMPA. Aturannya (`accountStatusPinned` + kedua penyusun di
 * `account-status.js`) memang tinggal di sana dan bukan di sini: yang di sini I/O-nya, dan yang di
 * sana keputusannya — satu-satunya bagian yang bisa diuji tanpa menghubungi Google.
 */
async function accountStatusUpdate(account, token, totals) {
  const address = adsenseAccountName(account);
  // Record GAM yang belum pernah menyimpan Publisher ID-nya. Bukan kegagalan API, dan diperbaiki
  // di tempat yang berbeda pula — kolom Publisher ID di halaman akun itu sendiri.
  if (!address) {
    return accountStatusNote(account, "Publisher ID akun ini belum diisi.");
  }
  try {
    const [info, alerts] = await Promise.all([
      getAccount(address, token),
      listAlerts(address, token),
    ]);
    const decided = accountStatusFrom({
      state: info?.state,
      alerts,
      impressions: totals?.impressions,
      earning: totals?.earning,
    });
    if (!decided) {
      return accountStatusNote(account, "Google tidak menyebut status akun ini.");
    }
    // Baris yang statusnya dipegang orang cuma menerima `statusAuto` — lihat `accountStatusFields`.
    return accountStatusFields(account, decided);
  } catch (error) {
    return accountStatusNote(account, error);
  }
}

// Rincian satu dimensi (ad unit / site) untuk satu akun. `range` sengaja bisa dioper dari luar:
// satu run harus meminta hari yang sama ke semua akun, dan menghitungnya ulang di tiap pemanggilan
// membuat run yang melewati tengah malam terbelah dua.
export async function earningRowsByDimension(account, configs, dimension, range = reportRange()) {
  const token = await accessTokenFrom(resolveCredential(account, configs));
  const address = requireAddress(account);
  return accountProvider(account) === "adsense"
    ? runAccountReportByDimension(address, range, token, dimension)
    : runNetworkReportByDimension(address, range, token, dimension);
}

// Rincian beberapa dimensi sekaligus, mis. site × negara. Tiap baris
// { keys: [...], impressions, clicks, earning } dengan `keys` urut sesuai yang diminta —
// bentuknya sama untuk kedua provider, dan itulah yang membuat hilirnya tidak bercabang.
export async function earningRowsByDimensions(account, configs, dimensions, range = reportRange()) {
  const token = await accessTokenFrom(resolveCredential(account, configs));
  const address = requireAddress(account);
  return accountProvider(account) === "adsense"
    ? runAccountReportByDimensions(address, range, token, dimensions)
    : runNetworkReportByDimensions(address, range, token, dimensions);
}

// One OAuth access token for one account, so a caller that hits several GAM endpoints for the
// same network doesn't re-exchange the refresh token for each of them.
export async function accountToken(account, configs) {
  return accessTokenFrom(resolveCredential(account, configs));
}

/**
 * Kode mata uang per akun earning: Map(accountId -> "USD"/"IDR"/...).
 *
 * Mata uang NETWORK GAM dibaca lewat `listNetworks` (satu panggilan per kredensial, di-cache per
 * networkCode). Sejak laporan GAM diminta dalam IDR (`GAM_CURRENCY`, gam.js) ia cuma CADANGAN: baris
 * yang membawa `reportCurrency` menang di convertRowsToIdr, dan yang memakai ini tinggal
 * `GAM_CURRENCY=""`. AdSense menagih dalam mata uang
 * akunnya; dibaca dari record (`currencyCode`), default IDR. Yang gagal atau tak diketahui jatuh ke
 * IDR: network IDR yang selama ini benar tidak boleh berubah gara-gara resolusi mata uang gagal.
 */
export async function resolveCurrencies(accounts, configs) {
  const byNetwork = new Map();
  const currencyById = new Map();
  for (const { id, account, provider } of accounts) {
    if (provider === "adsense") {
      currencyById.set(id, String(account?.currencyCode || "IDR").toUpperCase());
      continue;
    }
    const code = String(account?.networkCode || "");
    if (code && !byNetwork.has(code)) {
      try {
        const token = await accountToken(account, configs);
        for (const net of await listNetworks(token)) {
          byNetwork.set(String(net.networkCode), String(net.currencyCode || "IDR").toUpperCase());
        }
      } catch {
        // Biarkan tak terisi -> default IDR di bawah.
      }
    }
    currencyById.set(id, byNetwork.get(code) || "IDR");
  }
  return currencyById;
}

/**
 * Konversi baris laporan earning ke IDR di satu titik, sebelum apa pun menjumlah atau membaginya.
 *
 * Semua metrik uang (`earning` dan rincian `adx`/`adsense`/`adServer`) dikalikan kurs; `keys`,
 * `impressions`, `clicks` dibiarkan. `currency` + `fxRate` ikut ditempel supaya sisi UI bisa
 * menampilkan nilai aslinya lagi (bagi balik) sambil semua hitungan tetap satu mata uang.
 *
 * Mata uang IDR (kurs 1) atau yang tak dikenal (kurs null) dikembalikan apa adanya — hanya
 * ditandai currency-nya, tidak dikali.
 */
export function convertRowsToIdr(rows, currency, rates) {
  const fallback = String(currency || "IDR").toUpperCase();
  return (rows || []).map((row) => {
    // Yang menang adalah mata uang yang DISEBUT laporan itu sendiri (`reportCurrency`, dari header
    // kolom uang AdSense), bukan mata uang yang tersimpan di record. Akun AdSense v2 tidak punya
    // field mata uang sama sekali, jadi record-nya selalu kosong dan jatuh ke IDR — dan earning
    // USD yang dikira rupiah bukan angka yang meleset sedikit, melainkan ROI −99,96% untuk
    // subdomain yang sebenarnya untung. Baris GAM tidak membawa field ini dan tetap memakai mata
    // uang network-nya, persis seperti sebelumnya.
    const cur = String(row?.reportCurrency || fallback).toUpperCase();
    const rate = idrPerUnit(rates, cur);
    const scale = rate == null ? 1 : rate;
    // `fxRate` hanya diisi saat konversi asing benar-benar terjadi (bukan IDR, kurs diketahui):
    // itu yang dibaca UI untuk membagi balik ke nilai asli. Baris IDR dibiarkan bersih.
    const fxRate = cur === "IDR" || rate == null ? null : rate;
    const { reportCurrency: _reported, ...rest } = row || {};
    const out = { ...rest, currency: cur, fxRate };
    for (const field of ["earning", "adx", "adsense", "adServer"]) {
      if (typeof row[field] === "number") out[field] = row[field] * scale;
    }
    return out;
  });
}

export function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : Object.values(value);
}

// Map normalized campaign name -> normalized subdomain name, from every user's campaigns[].
export function buildCampaignMap(users) {
  const map = new Map();
  for (const user of toArray(users)) {
    for (const c of toArray(user?.campaigns)) {
      if (c?.campaign && c?.subDomain)
        map.set(normalizeName(c.campaign), normalizeName(c.subDomain));
    }
  }
  return map;
}

// --- Campaign code -> subdomain ------------------------------------------------------------
//
// Keitaro gives every tracking link a short id ("pBRw") and the advertisers put it at the front
// of the Meta campaign name: "nPJL-06 Pros Turki Carrou LKM 85 10 Adset". That code is the only
// thing in the name that says which subdomain the traffic lands on, so it is what joins the two
// sides. A subdomain owns as many codes as it has links, which is how one subdomain ends up
// carrying several campaigns — their spend accumulates on it rather than replacing it.

// "pBRw, TvH1" / "pBRw TvH1" / one per line -> ["pbrw", "tvh1"]. Also splits a campaign name
// into its tokens, which is how a code is matched: as a whole token, never as a substring.
// The codes are four characters, short enough that a substring test would match by accident.
export function parseCampaignCodes(value) {
  if (Array.isArray(value)) return value.flatMap((entry) => parseCampaignCodes(entry));
  return normalizeName(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Normalized code -> the subdomain that owns it, from `subDomains/{id}.campaignCodes`.
 *
 * Two subdomains claiming the same code cannot both be right, and picking a winner per run would
 * make ROI move for reasons nobody can see. The first owner keeps it and the clash is returned
 * so the caller can say so.
 */
export function buildCodeIndex(subDomains) {
  const byCode = new Map();
  const conflicts = [];
  for (const sub of toArray(subDomains)) {
    if (!sub || sub.deletedAt || !sub.name) continue;
    for (const code of parseCampaignCodes(sub.campaignCodes)) {
      const owner = byCode.get(code);
      if (owner && normalizeName(owner) !== normalizeName(sub.name)) {
        conflicts.push({ code, kept: owner, ignored: sub.name });
        continue;
      }
      byCode.set(code, sub.name);
    }
  }
  return { byCode, conflicts };
}

/**
 * Kode terdaftar PERTAMA di nama campaign, dan subdomain pemiliknya.
 *
 * Token dibaca urut nama, jadi campaign yang membuka namanya dengan kode ("nPJL-06 Pros Turki …")
 * cocok pada token pertama. Kalau tidak ada yang cocok, token pertama tetap dikembalikan: menurut
 * konvensi itulah kodenya, dan menyebutkannya mengubah "belum dipetakan" jadi "kode nPJL belum
 * terdaftar" — kalimat yang menyebut apa yang harus diperbaiki.
 *
 * Dipakai sync DAN vonis nama di halaman Campaign; dua aturan berbeda berarti dialog menyetujui
 * nama yang oleh sync dipetakan ke subdomain lain.
 */
export function matchCode(campaignName, byCode) {
  const tokens = parseCampaignCodes(campaignName);
  for (const token of tokens) {
    const subDomain = byCode.get(token);
    if (subDomain) return { subDomain, code: token };
  }
  return { subDomain: "", code: tokens[0] || "" };
}

/**
 * Resolve a Meta campaign name to a subdomain name.
 *
 * A mapping someone entered by hand always wins — it is the escape hatch for a campaign whose
 * name does not carry its code. Otherwise the code in the name decides, which is what lets one
 * new code fill in every campaign carrying it instead of mapping them one at a time.
 *
 * Returns `{ subDomain, source, code }`; `subDomain` is "" when neither knows.
 */
export function buildCampaignResolver(users, subDomains) {
  const manual = buildCampaignMap(users);
  const { byCode, conflicts } = buildCodeIndex(subDomains);
  const resolve = (campaignName) => {
    const explicit = manual.get(normalizeName(campaignName));
    if (explicit) return { subDomain: explicit, source: "manual", code: "" };
    const { subDomain, code } = matchCode(campaignName, byCode);
    return subDomain
      ? { subDomain, source: "code", code }
      : { subDomain: "", source: "", code: "" };
  };
  return { resolve, conflicts, codeCount: byCode.size };
}

// Build the subDomains update from accumulated metrics.
//
// `metrics` null berarti laporan GAM untuk network subdomain ini gagal — bukan berarti ia tidak
// menghasilkan apa-apa. Kolom uangnya karena itu tidak disentuh sama sekali: angka sync terakhir
// yang berhasil lebih jujur daripada nol yang dikarang kegagalan API.
export function subdomainUpdate(metrics) {
  const stamp = { syncStatus: true, lastSyncActionAt: new Date().toISOString() };
  if (!metrics) return stamp;
  const { earning, impressions, clicks } = metrics;
  return {
    revenueToday: earning,
    ecpm: impressions ? (earning / impressions) * 1000 : 0,
    cpc: clicks ? earning / clicks : 0,
    // `revenueToday` sudah IDR (dikonversi di sisi sync). Mata uang asli + kurs disimpan supaya
    // kolom Revenue bisa tetap menampilkan USD dengan IDR hasil konversi saat di-hover.
    currency: metrics.currency || "IDR",
    fxRate: typeof metrics.fxRate === "number" ? metrics.fxRate : null,
    ...stamp,
  };
}

function round(value, places) {
  const factor = 10 ** places;
  return Math.round((Number(value) || 0) * factor) / factor;
}

// Angka yang benar-benar angka, kalau tidak `fallback`. "" dan null bukan 0 di dashboard ini.
function numericOr(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

// One point on the Overview "Pendapatan vs Pengeluaran" chart. Keyed by day by the caller so a
// re-run overwrites the day instead of appending a duplicate — the sync is expected to run
// several times a day, and the chart must not grow a spike per run.
export function financialPoint(date, grossRevenue, totalSpend, rate = adTaxRate(), options = {}) {
  const [year, month, day] = date.split("-");
  const spend = round(totalSpend, 2);
  const adTax = round(spend * rate, 2);
  return {
    date,
    period: `${day}/${month}/${year.slice(2)}`,
    // Titik hari berjalan: keduanya masih naik sampai tengah malam, dan revenue GAM-nya belum
    // dikonsolidasi. Grafik memberinya garis putus-putus supaya ujung yang belum selesai tidak
    // terbaca sebagai margin yang jatuh.
    partial: options.partial === true,
    grossRevenue: round(grossRevenue, 2),
    // Meta spend telanjang, tetap disimpan — ia yang bisa dijodohkan dengan angka di /ad-accounts.
    totalSpend: spend,
    // Ad tax hari itu dengan tarif yang berlaku saat titik ini ditulis, sama seperti baris ROI
    // membawa pajaknya sendiri. Grafik membaca `totalSpending`, jadi garis "Pengeluaran" berarti
    // hal yang sama dengan kolom Total Spend di tabel — dan "Netto" jadi ROI yang sama persis.
    adTax,
    totalSpending: round(spend + adTax, 2),
    updatedAt: new Date().toISOString(),
  };
}

// Yang ditulis ke `weeklyFinancials/{tanggal}` dari satu titik. Sisi yang TIDAK LENGKAP run ini —
// satu akun earning atau satu ad account gagal dibaca — tidak ikut ditulis, jadi angka yang sudah
// tersimpan tetap berdiri (`update`, bukan `set`). Jumlah tanpa satu akun bukan angka yang benar
// melainkan angka yang KURANG, dan karena jendelanya 30 hari, satu kegagalan sesaat menimpa sebulan:
// 24 Sep 2026 laporan GAM stylefemale.com menjawab HTML, dan Pendapatan Agustus jatuh Rp 30 juta.
export function financialWrite(point, { revenueComplete = true, spendComplete = true } = {}) {
  const out = { ...point };
  if (!revenueComplete) delete out.grossRevenue;
  if (!spendComplete) {
    delete out.totalSpend;
    delete out.adTax;
    delete out.totalSpending;
  }
  return out;
}

/**
 * The window the Overview chart covers — **the same span as `reportPeriod`**, so the chart's last
 * point and the ROI table's newest row are always the same day.
 *
 * Kedua sisi selalu berakhir pada hari yang sama: yang dulu dilarang bukan "hari ini", melainkan
 * memasangkan revenue kemarin dengan spend hari ini dalam satu titik. Titik hari berjalan ditandai
 * `partial` dan digambar putus-putus. Widen ke belakang dengan FINANCIALS_RANGE_DAYS (default 30).
 */
export function financialWindow(
  days = Number(process.env.FINANCIALS_RANGE_DAYS) || 30,
  now = new Date(),
) {
  const settled = reportDayKey(now);
  const running = includeRunningDay() ? runningDayKey(now) : "";
  const until = running || settled;
  const since = shiftDateKey(settled, -(Math.max(1, days) - 1));
  return {
    since,
    until,
    settled,
    running,
    gamRange: { startDate: gamDay(since), endDate: gamDay(until) },
  };
}

// GAM hands back the DATE dimension as an int, "20260730". Meta already uses "2026-07-30".
export function dateKeyFrom(value) {
  const text = String(value || "").trim();
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

// --- Memecah satu laporan rentang menjadi hari-harinya ----------------------------------------
//
// Sekarang satu run melaporkan lebih dari satu hari (hari selesai + hari berjalan), tapi tetap
// dengan jumlah panggilan API yang sama: rentangnya diminta sekali dengan DATE sebagai dimensi
// pertama, lalu dipecah di sini. Satu laporan GAM per hari akan berarti create/run/poll/delete dua
// kali per network, dan run penuh sudah memakai menit dari batas 9 menit Cloud Functions.

/**
 * Baris GAM yang dimensi PERTAMAnya DATE, dikelompokkan per hari.
 *
 * Kunci tanggalnya dilepas dari `keys`, jadi pengumpul di hilir (`collectCountryEarning`,
 * pencocokan nama site) melihat bentuk yang sama persis seperti waktu rentangnya masih satu hari.
 * `key` ikut diisi supaya baris satu dimensi tetap bisa dibaca seperti hasil
 * `runNetworkReportByDimension`.
 */
export function gamRowsByDay(rows) {
  const byDay = new Map();
  for (const row of toArray(rows)) {
    const [dateValue, ...rest] = row?.keys || [];
    const day = dateKeyFrom(dateValue);
    if (!day) continue;
    const list = byDay.get(day) || [];
    list.push({ ...row, keys: rest, key: rest[0] || "" });
    byDay.set(day, list);
  }
  return byDay;
}

// Baris Meta insights dengan `time_increment=1`, dikelompokkan per hari lewat `date`.
export function metaRowsByDay(rows) {
  const byDay = new Map();
  for (const row of toArray(rows)) {
    const day = dateKeyFrom(row?.date);
    if (!day) continue;
    const list = byDay.get(day) || [];
    list.push(row);
    byDay.set(day, list);
  }
  return byDay;
}

// --- Belanja ad account yang TIDAK BISA DIBACA LAGI ---------------------------------------------
//
// Akun yang sync-nya dimatikan (izin Meta dicabut pemiliknya, disuspend) atau terarsip dilewati
// setiap sync — dan itu benar, menghubunginya cuma menghasilkan (#200) yang sama tiap jam. Yang
// SALAH adalah akibatnya pada rentang yang DITULIS ULANG: sync ROI menimpa beberapa hari terakhir,
// `sync-financials` tiga puluh hari, `migrate:roi-spend` sebulan lebih, dan tiap hari yang ditulis
// sesudah akunnya dimatikan kehilangan belanja akun itu. Baris ROI-nya lalu berbunyi
// `metaMissing: "unmapped"` — "tidak ada campaign yang menunjuk ke sini" — untuk campaign yang ada
// dan uang yang sudah keluar. LINCAH 1240 (16–25 Agu 2026) dan TBZ 1235/1268/0881 (5–12 Sep)
// kehilangan Rp 7,28 juta begitu, tanpa satu pun isu sync.
//
// Yang tersisa dari akun itu adalah `userReports/{id}.campaignHistory`, ditulis saat akunnya masih
// terbaca, dari `fetchCampaignSpend` per hari — panggilan yang SAMA dengan spend baris ROI. Itu yang
// dibaca ulang di sini, bukan dikarang: hari sesudah akunnya berhenti terbaca tidak punya riwayat,
// dan memang tidak ada angka yang bisa diklaim untuknya.
//
// `metaComplete` TIDAK ikut dijatuhkan karenanya. Akun yang dimatikan bukan kegagalan run ini, dan
// menandai seluruh armada "unavailable" selama satu akun mati berarti tiap baris kehilangan artinya.

// actId yang tidak dibaca sync mana pun. actId yang juga dipegang baris lain yang MASIH terbaca
// (akun didaftarkan ulang) dikeluarkan: belanjanya sudah masuk dari pembacaan langsung.
export function unreadableActIds(adAccounts) {
  const unreadable = new Set();
  const readable = new Set();
  for (const account of Object.values(adAccounts || {})) {
    if (!account?.actId) continue;
    if (account.deletedAt || account.syncDisabled) unreadable.add(account.actId);
    else readable.add(account.actId);
  }
  for (const actId of readable) unreadable.delete(actId);
  return unreadable;
}

// Baris berbentuk `fetchCampaignSpend` ({ date, name, spend, results }) dari riwayat campaign akun
// yang tidak terbaca, dalam rentang [since, until]. `histories` adalah daftar cabang
// `campaignHistory` milik tiap user: akun yang berpindah pemilik meninggalkan kunci yang sama di dua
// user, jadi kunci yang kembar dilebur (angka terbesar — yang lebih kecil adalah bacaan hari itu
// yang belum selesai).
export function unreadableSpendRows(histories, actIds, since, until) {
  const byKey = new Map();
  if (!actIds?.size) return [];
  for (const history of toArray(histories)) {
    for (const [key, row] of Object.entries(history || {})) {
      if (!row || !actIds.has(row.adAccount)) continue;
      const date = dateKeyFrom(row.date);
      if (!date || date < since || date > until) continue;
      const spend = Number(row.spend) || 0;
      if (spend <= 0) continue;
      const prev = byKey.get(key);
      if (prev && prev.spend >= spend) continue;
      byKey.set(key, {
        date,
        name: row.campaign || "",
        spend,
        results: Number(row.results) || 0,
        adAccount: row.adAccount,
        account: row.account || "",
      });
    }
  }
  return [...byKey.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name),
  );
}

// --- Earning akun GAM/AdSense yang dimatikan ---------------------------------------------------
//
// Masalah yang sama dengan belanja di atas, di sisi earning: `earningAccounts` melewati akun
// ber-`syncDisabled`, dan `syncFinancials` menulis ulang 30 hari tiap run. Sehari sesudah petcins.com
// dimatikan (23 Sep 2026), 25–31 Agu `weeklyFinancials` kehilangan Rp 16,2 juta — earning hari-hari
// saat akunnya masih menayangkan iklan — tanpa satu pun isu sync, dan Pendapatan Laba Rugi Agustus
// jatuh ke Rp 401 juta sementara baris ROI bulan yang sama berjumlah Rp 417 juta.
//
// Yang tersisa dari akun itu adalah baris ROI subdomainnya, ditulis saat akunnya masih terbaca.
// Baris ROI tidak mencatat akun asalnya, jadi yang dipulihkan per DOMAIN: domain yang SELURUH akun
// earning-nya tidak terbaca — akun GAM bernama domain itu, plus akun AdSense ber-publisher sama.
// Satu saja yang masih hidup, laporannya sudah memuat domain itu, dan menambahkan baris ROI-nya
// berarti earning yang sama terhitung dua kali.
//
// ponytail: akun AdSense berdiri sendiri (tanpa kembaran GAM) tidak ikut — domainnya cuma diketahui
// lewat daftar situs di API-nya, yang justru tidak ditanya lagi. Tambahkan kalau ada yang dimatikan.
export function unreadableEarningDomains(gamAccounts, adsenseAccounts) {
  const live = (account) => account && !account.deletedAt && !account.syncDisabled;
  const pubOf = (account) =>
    accountResourceName(
      account?.accountName || account?.publisherId || account?.propertyCode || "",
    );
  const gams = Object.values(gamAccounts || {});

  const livePubs = new Set();
  for (const account of [...gams, ...Object.values(adsenseAccounts || {})]) {
    const pub = live(account) && pubOf(account);
    if (pub) livePubs.add(pub);
  }
  const liveDomains = new Set(gams.filter(live).map((account) => normalizeName(account.name)));

  const dead = new Set();
  for (const account of gams) {
    const domain = normalizeName(account?.name);
    if (!account || live(account) || !domain || liveDomains.has(domain)) continue;
    const pub = pubOf(account);
    if (pub && livePubs.has(pub)) continue;
    dead.add(domain);
  }
  return dead;
}

// Earning per hari (Map tanggal -> rupiah) dari baris ROI subdomain milik `domains`, dalam rentang
// [since, until]. Subdomainnya dicocokkan lewat `parentDomain` dulu, akhiran nama sesudahnya —
// urutan yang sama dengan `domainIndex` di sisi UI. Earning yang tidak diketahui ("") dilewati.
export function unreadableEarningByDate(roiReports, subDomains, domains, since, until) {
  const out = new Map();
  if (!domains?.size) return out;
  const parentOf = new Map();
  for (const sub of Object.values(subDomains || {})) {
    if (sub?.name) parentOf.set(normalizeName(sub.name), normalizeName(sub.parentDomain));
  }
  const domainOf = (host) => {
    const parent = parentOf.get(host);
    if (parent) return domains.has(parent) ? parent : "";
    return [...domains].find((domain) => host === domain || host.endsWith(`.${domain}`)) || "";
  };

  for (const row of Object.values(roiReports || {})) {
    const date = dateKeyFrom(row?.date);
    if (!date || date < since || date > until) continue;
    if (row.earning === "" || row.earning == null) continue;
    const earning = Number(row.earning);
    if (!Number.isFinite(earning) || earning <= 0) continue;
    if (!domainOf(normalizeName(row.subDomain))) continue;
    out.set(date, (out.get(date) || 0) + earning);
  }
  return out;
}

// One chart point per day present on either side. A day with revenue but no spend is real
// (nothing was advertised) and must still plot, so the sides are unioned, not intersected.
//
// `runningDay` adalah hari yang belum selesai; titiknya ditandai partial. Kosong = semua titik final.
export function mergeFinancialSeries(
  revenueByDate,
  spendByDate,
  rate = adTaxRate(),
  runningDay = "",
) {
  const dates = new Set([...revenueByDate.keys(), ...spendByDate.keys()]);
  return [...dates]
    .filter(Boolean)
    .sort()
    .map((date) =>
      financialPoint(date, revenueByDate.get(date) || 0, spendByDate.get(date) || 0, rate, {
        partial: Boolean(runningDay) && date === runningDay,
      }),
    );
}

// Rows for the Overview "Saldo & Pengeluaran Advertiser" panel: balance and today's spend per
// user, summed across the ad accounts they own. Returns [id, row] pairs — the id is the user's,
// so the panel's Detail button links somewhere real and a re-run updates in place.
export function advertiserSpendRows(users, adAccounts) {
  const byName = new Map();
  for (const [id, user] of Object.entries(users || {})) {
    if (!user || user.deletedAt || !user.name) continue;
    byName.set(normalizeName(user.name), {
      id,
      row: { userId: id, pic: user.name, balance: 0, spendToday: 0, accounts: 0 },
    });
  }
  for (const account of Object.values(adAccounts || {})) {
    if (!account || account.deletedAt) continue;
    const entry = account.userOwner && byName.get(normalizeName(account.userOwner));
    if (!entry) continue;
    entry.row.balance += Number(account.balance || 0);
    entry.row.spendToday += Number(account.spendToday || 0);
    entry.row.accounts++;
  }
  // A user who owns no ad account has nothing to report; a zero row would read as "spent
  // nothing today" rather than "not an advertiser".
  return [...byName.values()]
    .filter((entry) => entry.row.accounts > 0)
    .map(({ id, row }) => [
      id,
      {
        ...row,
        balance: round(row.balance, 2),
        spendToday: round(row.spendToday, 2),
        updatedAt: new Date().toISOString(),
      },
    ]);
}

export function dashboardStatsFrom(users, adAccounts) {
  let totalSpend = 0;
  for (const account of Object.values(adAccounts || {})) {
    if (account?.deletedAt) continue;
    totalSpend += Number(account?.spendToday || 0);
  }
  let managedCampaigns = 0;
  for (const user of Object.values(users || {})) {
    if (user?.deletedAt) continue;
    managedCampaigns += toArray(user?.campaigns).length;
  }
  return {
    totalSpend: round(totalSpend, 2),
    managedCampaigns,
    updatedAt: new Date().toISOString(),
  };
}

// --- Riwayat baris ROI ------------------------------------------------------------------------
//
// `dashboard/roiReports` dulu berkunci id subdomain saja, jadi tiap sync menimpa baris yang sama
// dan tabelnya tidak pernah memuat lebih dari keadaan terakhir — kolom "Fluk." punya pembanding,
// tapi tidak ada satu pun hari kemarin yang bisa dibuka lagi.
//
// Kuncinya sekarang tanggal + subdomain: sync yang jalan berkali-kali sehari tetap memperbarui
// baris hari itu (bukan menumpuk per run), dan hari-hari sebelumnya tinggal sebagai riwayat yang
// bisa disaring di tabel.

export function roiReportKey(subDomainId, day = new Date()) {
  return `${dayKeyOf(day)}__${subDomainId}`;
}

/**
 * Baris terakhir milik satu subdomain SEBELUM hari yang sedang ditulis — pembanding kolom "Fluk.".
 *
 * Harus hari yang lebih awal, bukan sekadar "hari lain": sejak satu run menulis hari selesai dan
 * hari berjalan sekaligus, "hari lain" yang paling akhir untuk baris kemarin adalah baris HARI INI,
 * dan Fluk. kemarin akan mengukur perubahan ke arah masa depan — angkanya berlawanan tanda dengan
 * yang dimaksud kolomnya. Hari ini juga tidak dibandingkan dengan dirinya sendiri: fluktuasi akan
 * selalu 0 setelah sync kedua di hari yang sama, yang terbaca sebagai angka yang tidak bergerak
 * padahal ia bergerak sejak kemarin.
 *
 * Baris berkunci id telanjang (bentuk lama) dipakai sebagai jalan terakhir supaya sync pertama
 * setelah perubahan ini tidak kehilangan pembandingnya.
 */
export function previousRoiReport(existing, subDomainId, day = new Date()) {
  const dayKey = dayKeyOf(day);
  const suffix = `__${subDomainId}`;
  const keys = Object.keys(existing || {})
    .filter(
      (key) =>
        key.endsWith(suffix) && /^\d{4}-\d{2}-\d{2}__/.test(key) && key.slice(0, 10) < dayKey,
    )
    .sort();
  if (keys.length) return existing[keys[keys.length - 1]];
  return existing?.[subDomainId] || null;
}

/**
 * Masa simpan baris ROI harian — dan bawaannya SELAMANYA (`0`).
 *
 * Baris harian adalah satu-satunya riwayat ROI yang dimiliki dashboard ini: snapshot per sync cuma
 * bertahan tiga hari, dan tidak ada satu pun sumber lain yang bisa menuliskan ulang hari yang sudah
 * lewat — laporan GAM maupun Meta hanya bisa diminta untuk rentang yang masih dilayani API-nya, dan
 * ad account yang sudah berpindah tangan tidak bisa dibaca lagi sama sekali. Baris yang dihapus
 * masa simpan karena itu hilang untuk selamanya, dan yang kehilangannya paling terlihat adalah
 * Kalender: bulan yang lewat batas berdiri sebagai petak-petak kosong yang tidak bisa dibedakan
 * dari bulan yang memang tidak pernah disync.
 *
 * Satu hari menulis satu baris per subdomain — bukan per sync — jadi pertumbuhannya linear dan
 * kecil; yang dulu jadi alasan pemangkasan (seluruh pohon diunduh browser tiap dashboard dibuka)
 * berlaku untuk `roiSnapshots`, yang masa simpannya justru pendek karena alasan itu.
 *
 * `ROI_HISTORY_DAYS` tetap dibaca sebagai batas OPSIONAL untuk yang benar-benar ingin memangkas;
 * kosong, `0`, atau nilai yang bukan angka berarti tidak ada yang dibuang.
 */
export function roiHistoryDays() {
  const days = Number(process.env.ROI_HISTORY_DAYS);
  return Number.isFinite(days) && days > 0 ? days : 0;
}

// Baris yang sudah lewat masa simpan. Hanya kunci bertanggal yang disentuh — baris hasil input
// tangan berbentuk lain dan tidak boleh ikut terhapus. `days` nol/negatif berarti tanpa batas:
// tidak ada satu kunci pun yang dikembalikan, dan bukan cutoff hari ini yang menghapus segalanya.
export function expiredRoiReportKeys(existing, now = new Date(), days = roiHistoryDays()) {
  if (!(days > 0)) return [];
  const cutoff = shiftDateKey(dayKeyOf(now), -days);
  return Object.keys(existing || {}).filter(
    (key) => /^\d{4}-\d{2}-\d{2}__/.test(key) && key.slice(0, 10) < cutoff,
  );
}

/**
 * Baris yang bertanggal SETELAH hari terakhir yang dilaporkan run ini.
 *
 * Dipanggil dengan `period.until` — hari berjalan kalau hari ini ikut dilaporkan, kemarin kalau
 * tidak. Yang dibuang karena itu tinggal baris bertanggal masa depan: sisa run yang zonanya keliru
 * (kunci UTC pada versi lama menulis baris satu hari di depan selama tujuh jam pertama WIB), dan
 * baris hari berjalan yang tertinggal setelah SYNC_INCLUDE_TODAY dimatikan. Tidak ada hari yang
 * benar untuk baris seperti itu, jadi ia hanya bisa dibuang.
 */
/**
 * Id subdomain yang barisnya di hari `day` masih bertanda `partial` — sisa hari berjalan.
 *
 * Dipanggil untuk hari yang SUDAH SELESAI. Run hari berjalan menulis baris tiap subdomain yang
 * muncul di laporan jam itu; run berikutnya, yang menulis hari itu sebagai hari selesai, hanya
 * menyentuh subdomain yang muncul di laporan FINAL-nya. Subdomain yang sempat menghasilkan Rp 5
 * pukul 06:00 lalu tidak ada di laporan final ditinggalkan dengan angka setengah hari dan tanda
 * `partial: true` selamanya — dan di Kalender satu baris begitu menandai seluruh harinya
 * "berjalan" berminggu-minggu kemudian (per 16 Sep 2026: 30 baris sejak 20 Agu).
 *
 * Pemanggilnya menulis ulang baris-baris ini bersama baris lain hari itu, dari laporan final
 * yang sama: tidak muncul di laporan yang lengkap berarti nol, dan laporan yang gagal membiarkan
 * angkanya berdiri sebagai `gamStale` — aturan `roiReportUpdate` yang sudah ada.
 */
export function leftoverRunningIds(existing, day) {
  const prefix = `${dayKeyOf(day)}__`;
  return Object.entries(existing || {})
    .filter(([key, row]) => key.startsWith(prefix) && row?.partial === true)
    .map(([key]) => key.slice(prefix.length))
    .filter(Boolean);
}

export function futureRoiReportKeys(existing, until) {
  return Object.keys(existing || {}).filter(
    (key) => /^\d{4}-\d{2}-\d{2}__/.test(key) && key.slice(0, 10) > until,
  );
}

// --- Snapshot per sync (tabel "Laporan ROI Realtime") ------------------------------------------
//
// `dashboard/roiReports` menyimpan SATU baris per hari per subdomain: tiap sync menimpa baris hari
// itu, jadi yang tersisa selalu keadaan terakhir. Bentuk itu benar untuk riwayat — Targets dan
// grafik menjumlahkan uang lintas baris, dan baris per hari adalah satu-satunya bentuk yang boleh
// dijumlahkan — tapi ia menghapus jejak hari berjalan: pukul 09:00 ROI 40%, pukul 15:00 ROI 180%,
// dan tidak ada satu pun tempat yang menyimpan yang pertama.
//
// `dashboard/roiSnapshots` menyimpan tiap run apa adanya, berkunci tanggal + JAM + subdomain, jadi
// tabel Overview memuat satu baris per sync.
//
// DUA POHON, BUKAN SATU. Baris snapshot bersifat KUMULATIF sejak tengah malam — laporan GAM dan
// Meta selalu untuk hari penuh, bukan untuk satu jam — jadi menjumlahkan 24 snapshot satu hari
// melaporkan pendapatan 24 kali lipat. Selama snapshot tinggal di pohonnya sendiri, tidak ada satu
// pun penjumlah lama yang bisa keliru memakannya. Yang per jam adalah kolom "Fluk.": selisih
// terhadap snapshot sebelumnya di hari yang sama.

export const ROI_SNAPSHOTS_PATH = "dashboard/roiSnapshots";

const SNAPSHOT_KEY_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}__/;

// Kunci snapshot: hari yang DILAPORKAN + jam sync-nya, dalam zona operasi. Jam memakai "-" bukan
// ":" supaya kuncinya aman dipakai apa adanya di URL REST RTDB.
//
// Dua run dalam menit yang sama menimpa kunci yang sama, dan itu memang yang diinginkan: satu menit
// tidak bisa punya dua keadaan, dan run ulang setelah gagal tidak boleh menggandakan barisnya.
export function roiSnapshotKey(subDomainId, day = new Date(), now = new Date()) {
  return `${dayKeyOf(day)}T${zonedClock(now).replace(":", "-")}__${subDomainId}`;
}

/**
 * Snapshot terakhir milik satu subdomain di HARI YANG SAMA — pembanding kolom "Fluk." baris ini.
 *
 * Hari yang sama, bukan snapshot mana pun yang terakhir: snapshot pertama sebuah hari adalah
 * setengah jam pertama, dan mengadunya dengan snapshot terakhir kemarin (satu hari penuh) akan
 * melaporkan penurunan raksasa tiap lewat tengah malam. Tanpa pembanding, kolomnya "-" — jujur,
 * berbeda dengan 0 yang berarti "tidak bergerak".
 */
export function previousRoiSnapshot(existing, subDomainId, day = new Date()) {
  const prefix = `${dayKeyOf(day)}T`;
  const suffix = `__${subDomainId}`;
  const keys = Object.keys(existing || {})
    .filter((key) => SNAPSHOT_KEY_RE.test(key) && key.startsWith(prefix) && key.endsWith(suffix))
    .sort();
  return keys.length ? existing[keys[keys.length - 1]] : null;
}

// Masa simpan snapshot, jauh lebih pendek dari ROI_HISTORY_DAYS: satu hari menulis satu baris per
// sync per subdomain (24 baris/hari pada jadwal 60 menit), dan seluruh pohonnya ikut diunduh
// browser tiap kali dashboard dibuka. Riwayat panjangnya tetap ada di `dashboard/roiReports`.
export function roiSnapshotDays() {
  return Math.max(1, Number(process.env.ROI_SNAPSHOT_DAYS) || 3);
}

// Snapshot yang sudah lewat masa simpan. Hanya kunci berbentuk snapshot yang disentuh.
export function expiredRoiSnapshotKeys(existing, now = new Date(), days = roiSnapshotDays()) {
  const cutoff = shiftDateKey(dayKeyOf(now), -days);
  return Object.keys(existing || {}).filter(
    (key) => SNAPSHOT_KEY_RE.test(key) && key.slice(0, 10) < cutoff,
  );
}

// Baris bentuk lama (berkunci id subdomain) yang sudah digantikan baris bertanggal hari ini.
// Dibiarkan, ia akan tampil selamanya sebagai baris kedua untuk subdomain yang sama — bertanggal
// hari terakhir ia ditulis, dan tidak pernah diperbarui lagi.
export function supersededRoiReportKeys(existing, subDomainIds) {
  return [...subDomainIds].filter((id) => existing && id in existing);
}

/**
 * JENDELA BACA — berapa jauh ke belakang sync perlu MELIHAT, bukan berapa lama baris disimpan.
 *
 * Keduanya sering tertukar dan akibatnya berlawanan. `roiHistoryDays` menjawab apa yang DIBUANG;
 * yang di bawah ini menjawab apa yang DIMINTA, dan `dashboard/roiReports` justru tidak boleh
 * dibuang — Laba Rugi, Cash Flow, dan Pencairan membaca bulan-bulan lampau, dan node ini satu-
 * satunya tempat angkanya ada. Jadi ia tumbuh selamanya (130 hari, 2.572 baris, 1,8 MB per 7 Sep
 * 2026), dan sampai jendela ini ada, tiap run mengunduh seluruhnya untuk memakai beberapa hari
 * terakhir saja — unduhan yang membesar tiap hari, dua puluh empat kali sehari, untuk baris yang
 * tidak pernah dilihat.
 *
 * Bisa dijendelakan sama sekali karena kuncinya `YYYY-MM-DD__id`: urutan kunci ADALAH urutan
 * tanggal, jadi `orderByKey().startAt(...)` menghasilkan potongan tanggal yang tepat tanpa indeks
 * apa pun.
 */

/**
 * Seberapa jauh sebelum hari paling awal yang dilaporkan run ini pembanding "Fluk." masih dicari.
 *
 * Yang hilang kalau jendelanya terlampaui BUKAN angka, melainkan DELTA-nya: subdomain yang baru
 * melapor lagi setelah diam lebih lama dari ini mendapat `flukEarn: "-"` alih-alih selisih terhadap
 * baris berminggu-minggu lalu — jawaban yang sudah disebut `roiReportUpdate` sendiri sebagai yang
 * jujur ("tanpa baris sebelumnya tidak ada perubahan untuk ditampilkan"). Nilai uangnya tidak lewat
 * sini sama sekali; `existing` (baris hari yang SAMA, selalu di dalam jendela) yang memegangnya.
 *
 * 14 HARI, dan angkanya dipilih dari pengukuran — bukan ditebak. Diadu ke data produksi
 * (7 Sep 2026, 81 subdomain berpembanding): lookback 1 hari mempertahankan 47, 3 hari 58, 7 hari
 * 67, 14 hari 73, 30 hari 78, dan 60 hari 80 — sementara biayanya naik dari 82 KB ke 1.398 KB per
 * run, yaitu kembali ke harga membaca seluruh node (1.835 KB). Jadi TIDAK ADA nilai yang
 * mempertahankan perilaku lama tanpa mempertahankan biayanya: bagi delapan subdomain terakhir itu,
 * "hari sebelumnya" memang dua bulan lalu, dan selisih terhadapnya bukan fluktuasi harian apa pun.
 * 14 adalah lutut kurvanya — ia menutupi jeda realistis (subdomain yang dijeda sepekan-dua pekan,
 * sync yang mati semalam) dengan 78% lebih sedikit unduhan.
 */
export function roiPreviousLookbackDays() {
  const days = Number(process.env.ROI_PREVIOUS_LOOKBACK_DAYS);
  return Number.isFinite(days) && days > 0 ? days : 14;
}

export function roiReportWindowStart(period, days = roiPreviousLookbackDays()) {
  return shiftDateKey(period.since, -days);
}

/**
 * Batas atas permintaan pemangkasan: semua yang lebih tua dari ini, dan tidak satu pun yang lebih
 * muda. Normalnya ia menjawab KOSONG — itu memang yang diharapkan, dan itu sebabnya pemangkasan
 * tetap bisa jalan tiap run tanpa mengunduh apa pun.
 *
 * Tanpa batas simpan (`ROI_HISTORY_DAYS` kosong, yaitu keadaan yang ter-deploy sekarang) yang masih
 * perlu terlihat cuma baris BENTUK LAMA — berkunci id subdomain telanjang, tanpa tanggal. Kunci
 * push RTDB selalu diawali "-" dan kunci bertanggal selalu diawali "2", jadi "0" memisahkan
 * keduanya persis. Kalau suatu hari batas simpan diisi, cutoff-nya sendiri yang jadi batas — dan ia
 * di atas "0", jadi baris bentuk lama tetap ikut terbawa.
 */
export const LEGACY_ROI_KEY_BOUND = "0";

export function roiReportPruneBefore(now = new Date(), days = roiHistoryDays()) {
  return days > 0 ? shiftDateKey(dayKeyOf(now), -days) : LEGACY_ROI_KEY_BOUND;
}

/**
 * Snapshot yang perlu dilihat run ini cuma HARI BERJALAN, dan di sini jendelanya tidak mengubah
 * apa pun: `previousRoiSnapshot` memang hanya dipanggil untuk hari berjalan dan hanya mencocokkan
 * kunci berawalan hari itu. Yang di luar jendela tidak pernah terpakai bahkan sebelum ada jendela.
 */
export function roiSnapshotWindowStart(period) {
  return period.running || period.settled;
}

export function roiSnapshotPruneBefore(now = new Date(), days = roiSnapshotDays()) {
  return shiftDateKey(dayKeyOf(now), -days);
}

/**
 * Overview row derived from a subdomain's GAM totals.
 *
 * `date` adalah HARI YANG DILAPORKAN (`extra.day`), bukan hari sync-nya. Dulu baris ini bertanggal
 * hari ini padahal earning-nya milik kemarin, dan spend Meta-nya diambil `date_preset=today` —
 * satu baris berisi dua hari yang berbeda, dan ROI-nya membandingkan pendapatan sehari penuh
 * dengan spend yang baru berjalan beberapa jam. Sekarang kedua sisi meminta hari yang sama.
 *
 * `metrics` null berarti laporan GAM gagal, bukan nol. Bedanya besar: nol yang dikarang membuat
 * baris tampil "ROI -100%" — persis seperti subdomain yang beriklan tanpa hasil — dan pada 8 Agu
 * 2026 itu menyembunyikan satu domain penuh senilai 2,1 juta di balik angka yang tampak wajar.
 * Kalau sync sebelumnya di hari yang sama sudah membawa earning (`extra.existing`), angka itu
 * dipakai kembali supaya ROI-nya tetap dihitung, dan barisnya ditandai sebagai data bawaan.
 */
export function roiReportUpdate(sub, metrics, spend, extra = {}) {
  const now = extra.now instanceof Date ? extra.now : new Date();
  const iso = now.toISOString();
  const day = dayKeyOf(extra.day || now);
  // Fluctuation columns are the change since the last sync, so they need the row being
  // replaced. Without a previous row there is no change to show — "-" is honest, 0 is not.
  const previous = extra.previous || null;
  const delta = (value, before) =>
    previous && typeof before === "number" ? round(value - before, 2) : "-";
  const row = {
    date: day,
    time: zonedClock(now),
    campaign: sub?.name || "",
    subDomain: sub?.name || "",
    pic: sub?.pic || "",
    source: "GAM",
    // Hari berjalan: kedua sisi baris ini masih bergerak sampai tengah malam, dan revenue GAM-nya
    // belum dikonsolidasi. Ditulis ke barisnya sendiri, bukan disimpulkan dari tanggal di sisi UI:
    // "hari ini" di browser orang yang zonanya bukan WIB adalah hari yang berbeda, dan baris yang
    // sudah final tidak boleh berubah status karena tab-nya dibiarkan terbuka melewati tengah malam.
    partial: extra.partial === true,
    updatedAt: iso,
  };

  // Earning: dari laporan run ini, dari baris hari yang sama yang ditulis run sebelumnya, atau
  // tidak sama sekali. Ketiganya dibedakan supaya tidak ada satu pun angka yang berpura-pura.
  const carried = metrics ? null : numericOr(extra.existing?.earning, null);
  const earning = metrics ? metrics.earning : carried;
  const known = earning !== null && earning !== undefined;

  if (metrics) {
    const { impressions, clicks } = metrics;
    const rpm = impressions ? (metrics.earning / impressions) * 1000 : 0;
    row.earning = metrics.earning;
    row.adsense = metrics.earning;
    // `earning` (+ rincian di bawah) sudah IDR. Mata uang asli + kurs ikut supaya kolom GAM
    // Revenue bisa menampilkan USD dengan IDR saat di-hover, sementara ROI/total tetap satu
    // mata uang. IDR/kurs null berarti tidak ada konversi — kolomnya tampil Rp seperti biasa.
    row.currency = metrics.currency || "IDR";
    row.fxRate = typeof metrics.fxRate === "number" ? metrics.fxRate : null;
    // Earning per sumber permintaan, seperti yang dilaporkan GAM sendiri. `earning` di atas
    // adalah jumlah ketiganya, dan ROI tetap dihitung dari jumlah itu — kolom-kolom ini
    // menjawab "uangnya datang dari mana", bukan menggantikannya.
    //
    // AdX dan Ad Server keduanya permintaan Ad Manager (programmatic dan direct-sold); yang
    // bukan hanya AdSense-in-GAM. Itu sebabnya tabelnya memecah dua, bukan tiga.
    row.adxRevenue = numericOr(metrics.adx, null);
    row.adsenseRevenue = numericOr(metrics.adsense, null);
    row.adServerRevenue = numericOr(metrics.adServer, null);
    row.impressions = impressions;
    row.clicks = clicks;
    row.cpc = clicks ? metrics.earning / clicks : 0;
    row.ecpm = rpm;
    row.pageRpm = rpm;
    row.flukEarn = delta(metrics.earning, previous?.earning);
    row.gamMissing = null;
    row.gamStale = null;
  } else {
    // Kolom earning tidak disentuh: yang sudah ada dibiarkan, yang belum ada tetap kosong ("-").
    row.gamMissing = known ? null : true;
    row.gamStale = known ? true : null;
  }
  // The advertiser's remaining Meta balance — from data the dashboard already holds, not
  // derivable from the GAM report. Rounded: summing float balances leaves 142228.46000000002,
  // which the money formatter would happily render in full.
  //
  // `wl` tidak lagi ditulis: halaman Whitelists sudah dihapus, jadi tidak ada apa pun yang bisa
  // merawat daftarnya — dan kolomnya sendiri sudah tidak ada di kedua tabel ROI.
  if (typeof extra.metaBalance === "number") row.metaBalance = round(extra.metaBalance, 2);
  // Satu baris Overview adalah satu subdomain, dan beberapa campaign Meta rutin menumpuk di
  // subdomain yang sama — itu yang dimaksud badge "Campaign digabung". Rinciannya disimpan supaya
  // badge itu bisa menyebutkan campaign mana saja, bukan cuma mengaku menggabung sesuatu.
  // null (bukan array kosong) waktu tidak ada campaign: update() menggabung, jadi tanpa penghapusan
  // eksplisit daftar sync kemarin akan menempel di baris yang spend-nya sudah tidak teratribusi.
  const campaigns = (extra.campaigns || [])
    .filter((c) => c?.name)
    .map((c) => ({ name: c.name, spend: round(Number(c.spend || 0), 2) }));
  row.campaigns = campaigns.length ? campaigns : null;
  // Meta spend attributed via campaign -> subdomain. Only set when spend is known,
  // so unattributed subdomains keep "-" instead of a fake ROI.
  //
  // KENAPA spend-nya tidak ada ikut ditulis, bukan disimpulkan sisi UI dari sel yang kosong:
  //
  //   "unmapped"    tidak ada campaign Meta yang mengarah ke subdomain ini hari itu — subdomain
  //                 yang earning-nya dari GAM tanpa iklan Meta (dogtraining.petcins.com), atau
  //                 kode campaign-nya belum didaftarkan. Bukan kegagalan.
  //   "unavailable" sisi Meta run ini tidak lengkap (token kosong / laporan akun gagal), jadi
  //                 "tidak ada spend" di sini tidak berarti apa-apa.
  //
  // Bedanya menentukan tindakan orang yang membacanya: yang pertama diperbaiki di /sub-domains,
  // yang kedua di sync-nya.
  if (typeof spend === "number") {
    row.metaMissing = null;
    // Ad tax dihitung di sini dengan tarif yang sama dengan ROI per negara — kalau tidak, satu
    // baris subdomain dan baris-baris negaranya akan melaporkan ROI yang berbeda untuk uang yang
    // sama, dan tidak ada di layar yang bisa menjelaskan selisihnya.
    const rate = typeof extra.adTaxRate === "number" ? extra.adTaxRate : adTaxRate();
    const adTax = round(spend * rate, 2);
    const totalSpending = round(spend + adTax, 2);
    row.spending = spend;
    row.metaAds = spend;
    row.adTax = adTax;
    row.totalSpending = totalSpending;
    row.flukSpend = delta(spend, previous?.spending);
    // Tanpa earning tidak ada ROI. Membaginya dengan 0 yang dikarang akan menulis "-100%" ke
    // kolom yang paling sering dibaca orang di dashboard ini.
    if (known) {
      row.profit = round(earning - totalSpending, 2);
      row.roi = totalSpending ? round(((earning - totalSpending) / totalSpending) * 100, 2) : 0;
      row.flukRoi = delta(row.roi, previous?.roi);
    }
    // Cost per result: biaya Meta per satu hasil. Tanpa hasil yang dikenali pembaginya nol, dan
    // sebuah CPR yang dipaksa jadi 0 akan terbaca sebagai "gratis" — "-" yang jujur.
    const results = Number(extra.results || 0);
    row.results = results;
    row.cpr = results > 0 ? round(spend / results, 2) : "-";
  } else if (extra.metaComplete === false) {
    // Sisi Meta-nya tidak lengkap: angka spend yang sudah ada di baris ini (sync sebelumnya di
    // hari yang sama) dibiarkan — sama seperti earning yang laporannya gagal, yang lama lebih
    // jujur daripada kosong yang dikarang kegagalan API.
    row.metaMissing = "unavailable";
  } else {
    // Sisi Meta lengkap dan tetap tidak ada campaign yang mengarah ke sini. Kolom uangnya
    // dikosongkan, tidak cuma dibiarkan: `update()` menggabung, jadi spend dari sync sebelumnya
    // di hari yang sama akan menempel pada baris yang campaign-nya sudah tidak teratribusi lagi
    // (nama campaign diganti, kode dipindah) — angka yang tidak punya campaign mana pun di
    // baliknya, bersanding dengan daftar campaign yang sudah dikosongkan tepat di atas.
    row.metaMissing = "unmapped";
    row.spending = null;
    row.metaAds = null;
    row.adTax = null;
    row.totalSpending = null;
    row.flukSpend = null;
    row.results = null;
    row.cpr = null;
    // Profit dan ROI perlu kedua sisinya; tanpa spend keduanya bukan angka, bukan nol.
    row.profit = null;
    row.roi = null;
    row.flukRoi = null;
  }
  return row;
}

// --- ROI per negara --------------------------------------------------------------------------
//
// Satu baris = satu negara pada satu subdomain, dari dua laporan yang tidak saling kenal:
//
//   Spending       = Meta spend negara itu (insights `breakdowns=country`)
//   Ad Tax         = Spending × AD_TAX_RATE (5%)
//   Total Spending = Spending + Ad Tax
//   ROI%           = (Earning − Total Spending) / Total Spending × 100
//
// Ad tax-nya bukan tambahan hiasan: yang keluar dari kantong advertiser adalah spend berikut
// pajaknya, jadi ROI yang dihitung dari spend telanjang selalu terbaca lebih untung daripada
// keadaan sebenarnya — dan makin besar spend-nya, makin jauh selisihnya.
//
// Sisi Meta menyebut negara dengan kode ISO ("ID"), sisi GAM dengan nama ("Indonesia"). Itu
// sebabnya laporan GAM diminta membawa kodenya juga: kode yang menjodohkan keduanya, nama yang
// ditampilkan.

// ponytail: 5% adalah tarif yang berlaku saat ini dan hanya dipakai kalau Settings belum diisi.
const DEFAULT_AD_TAX_RATE = 0.05;

/**
 * Tarif ad tax sebagai pecahan (0.05 = 5%).
 *
 * Sumber pertamanya halaman Settings (`settings/roi.adTaxPercent`, disimpan dalam persen karena
 * itu yang diketik orang), bukan env: tarif pajak berubah karena keputusan, bukan karena deploy,
 * dan admin harus bisa mengubahnya tanpa menunggu siapa pun. `AD_TAX_RATE` tetap dibaca sebagai
 * jaring pengaman untuk runtime yang dijalankan sebelum node settings-nya pernah diisi.
 */
export function adTaxRate(settings) {
  // Field yang dikosongkan bukan tarif 0 — `Number("")` adalah 0, dan menerimanya berarti satu
  // form yang tidak sengaja dikosongkan menghapus pajaknya dari seluruh dashboard tanpa suara.
  const stored = settings?.adTaxPercent;
  const percent =
    stored === "" || stored === null || stored === undefined ? Number.NaN : Number(stored);
  if (Number.isFinite(percent) && percent >= 0) return percent / 100;
  const raw = String(process.env.AD_TAX_RATE ?? "").trim();
  if (!raw) return DEFAULT_AD_TAX_RATE;
  const rate = Number(raw);
  return Number.isFinite(rate) && rate >= 0 ? rate : DEFAULT_AD_TAX_RATE;
}

// Dimensi tanggal GAM. Dipasang sebagai dimensi PERTAMA pada tiap laporan yang rentangnya lebih
// dari satu hari, dan itulah yang membuat satu laporan bisa dipecah per hari di sisi kita.
// ponytail: sama seperti enum lain, namanya bisa berbeda antar tipe network.
export function dateDimension() {
  return process.env.GAM_DATE_DIMENSION || "DATE";
}

// Dimensi laporan negara GAM: kode dulu (kunci penjodohan), lalu nama (yang dibaca orang).
// ponytail: nama enum dimensi berbeda antar tipe network — verifikasi di API Explorer kalau
// laporannya ditolak, dan ganti lewat env tanpa menyentuh kode.
export function countryDimensions() {
  return (process.env.GAM_COUNTRY_DIMENSIONS || "COUNTRY_CODE,COUNTRY_NAME")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
}

// AdSense menolak site × negara yang diminta GAM (500 "Report generation error"): entah karena
// COUNTRY_CODE+COUNTRY_NAME bentrok, entah karena DOMAIN_NAME memang tidak bisa dipecah per negara
// (batasan yang sama dengan UI AdSense). Jadi laporan negara AdSense minta SATU dimensi saja —
// COUNTRY_CODE, supaya kuncinya tetap ISO dan berjodoh dengan spend Meta; nama negara turun jadi
// kode di kolomnya, itu harga yang diterima. Set `ADSENSE_COUNTRY_DIMENSIONS=` (kosong) untuk
// mematikan laporannya sama sekali kalau ternyata batasan DOMAIN_NAME yang berlaku — barisnya
// hilang tanpa jadi isu sync, bukan error yang tidak bisa diperbaiki siapa pun.
export function adsenseCountryDimensions() {
  const raw = process.env.ADSENSE_COUNTRY_DIMENSIONS ?? "COUNTRY_CODE";
  return raw
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
}

// Kunci satu negara di dalam satu subdomain. Kode ISO kalau GAM/Meta memberi kode yang sah;
// kalau tidak (laporan hanya membawa nama, atau nilainya placeholder GAM), namanya yang dipakai —
// barisnya tetap tampil, hanya tidak bisa berjodoh dengan sisi Meta.
export function countryKey(code, name) {
  const iso = String(code || "").trim();
  if (/^[a-z]{2}$/i.test(iso)) return iso.toUpperCase();
  return historyKey(name || code);
}

function isoCodeOf(key) {
  return /^[A-Z]{2}$/.test(key) ? key : "";
}

// Metrik yang IKUT datang bersama earning di baris laporan negara, dan dulu dibuang di sini.
//
// `METRICS` di gam.js dikirim untuk SEMUA laporan, laporan negara termasuk, jadi impresi, klik,
// dan rincian sumber revenue sudah ada di tangan tiap sync — yang menampungnya cuma menjumlahkan
// `earning` dan membiarkan sisanya menguap. Tanpa impresi dan klik, tabel per negara tidak bisa
// menyebut CPC/CTR/eCPM-nya sama sekali, padahal justru CPC yang membedakan satu negara dari
// negara lain (CTR armada ini duduk di 14–27% di mana-mana).
const COUNTRY_METRICS = ["impressions", "clicks", "adx", "adsense", "adServer"];

/**
 * Serap baris laporan GAM `[site, kode negara, nama negara]` ke dalam `target`:
 * `subDomainId -> kunci negara -> { country, earning, impressions, clicks, adx, adsense, adServer }`.
 *
 * Beberapa baris bisa jatuh ke negara yang sama (satu network melaporkan per ad unit), jadi
 * angkanya ditambahkan, bukan ditimpa.
 *
 * Mengembalikan nama site GAM yang tidak cocok dengan subdomain mana pun — sama seperti sync
 * subdomain, itu yang memberi tahu pemetaan mana yang perlu diperbaiki.
 */
export function collectCountryEarning(rows, idByName, target) {
  const unmatched = [];
  for (const row of toArray(rows)) {
    const [site, code, name] = row?.keys || [];
    const id = idByName.get(normalizeName(site));
    if (!id) {
      if (site) unmatched.push(site);
      continue;
    }
    const key = countryKey(code, name);
    if (!key) continue;
    const byCountry = target.get(id) || new Map();
    const current = byCountry.get(key) || { country: name || code || key, earning: 0 };
    current.earning += Number(row.earning || 0);
    addCountryMetrics(current, row);
    byCountry.set(key, current);
    target.set(id, byCountry);
  }
  return unmatched;
}

// Metrik yang TIDAK dibawa baris tetap tidak ada di hasilnya — bukan 0. `GAM_METRICS` bisa
// diganti lewat env dan laporan lama bisa datang tanpa salah satunya; nol untuk impresi yang
// tidak pernah dilaporkan adalah klaim bahwa negara itu tidak ditayangi iklan sama sekali,
// dan eCPM yang lahir dari pembagi karangan itu ikut berbohong. Sepola dengan `adxRevenue` di
// baris ROI subdomain, yang menampilkan "-" alih-alih Rp 0.
function addCountryMetrics(current, row) {
  for (const field of COUNTRY_METRICS) {
    const value = row?.[field];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    current[field] = (current[field] || 0) + value;
  }
}

/**
 * Serap baris Meta `[{ name, country, spend }]` ke dalam `target`:
 * `subDomainId -> kunci negara -> spend`.
 *
 * `resolve` adalah pemeta campaign -> subdomain yang sama dengan yang dipakai ROI subdomain, jadi
 * spend per negara tidak pernah menempel di subdomain yang berbeda dari spend totalnya.
 *
 * Mengembalikan nama campaign yang tidak terpetakan ke subdomain mana pun.
 */
export function collectCountrySpend(rows, resolve, idByName, target) {
  const unmatched = [];
  for (const row of toArray(rows)) {
    const name = row?.name || "";
    const { subDomain } = resolve(name);
    const id = subDomain && idByName.get(normalizeName(subDomain));
    if (!id) {
      if (name) unmatched.push(name);
      continue;
    }
    const key = countryKey(row.country, row.country);
    if (!key) continue;
    const byCountry = target.get(id) || new Map();
    byCountry.set(key, (byCountry.get(key) || 0) + Number(row.spend || 0));
    target.set(id, byCountry);
  }
  return unmatched;
}

// Negara yang beriklan tanpa menghasilkan apa pun adalah yang paling perlu dilihat, jadi statusnya
// dibedakan dari negara yang memang tidak sedang diiklankan. Ketiganya dibaca dari angka run ini —
// tidak ada status yang diarang-arang supaya kolomnya terisi.
export function countryRoiStatus(spending, earning) {
  if (spending > 0) return earning > 0 ? "Active" : "Review";
  return "Inactive";
}

/**
 * Baris ROI per negara untuk satu subdomain, sebagai pasangan `[kunci, baris]`.
 *
 * Kedua sisi digabung, bukan diiris: negara yang menghasilkan tanpa iklan itu nyata (trafik
 * organik), dan negara yang diiklankan tanpa hasil justru yang dicari orang saat membuka tabel
 * ini. Mengiris keduanya akan menyembunyikan tepat dua kasus yang paling berarti.
 *
 * Kuncinya hari + subdomain + negara, seperti baris ROI subdomain: sync yang jalan berkali-kali
 * sehari memperbarui baris hari itu, dan hari selesai + hari berjalan bisa duduk bersama tanpa yang
 * satu menimpa yang lain. Selama kuncinya tanpa tanggal, satu run hari berjalan akan menghapus
 * angka final kemarin dari panelnya.
 */
export function countryRoiRows(sub, earningByCountry, spendByCountry, options = {}) {
  const now = options.now || new Date();
  const iso = now.toISOString();
  const day = dayKeyOf(options.day || now);
  const rate = typeof options.rate === "number" ? options.rate : adTaxRate();
  const earnings = earningByCountry || new Map();
  const spends = spendByCountry || new Map();
  const keys = new Set([...earnings.keys(), ...spends.keys()]);
  // Laporan negara GAM gagal untuk subdomain ini: earning-nya tidak diketahui, bukan nol. Alasan
  // yang sama dengan roiReportUpdate — "Review" untuk negara yang sebenarnya menghasilkan adalah
  // kegagalan API yang menyamar jadi temuan.
  const unknown = options.earningKnown === false;

  return [...keys].map((key) => {
    const gam = earnings.get(key) || {};
    const earning = unknown ? null : round(Number(gam.earning || 0), 2);
    const traffic = countryTraffic(gam, earning, unknown);
    const spending = round(Number(spends.get(key) || 0), 2);
    const adTax = round(spending * rate, 2);
    const totalSpending = round(spending + adTax, 2);
    // Pembaginya total spending, bukan spend telanjang — itu yang membedakan angka ini dari ROI
    // subdomain di Overview. Tanpa spend sama sekali tidak ada yang bisa dibagi: 0, bukan Infinity
    // yang akan tampil sebagai keuntungan tak terhingga untuk negara yang tidak diiklankan.
    let roi = null;
    if (!unknown) {
      roi = totalSpending ? round(((earning - totalSpending) / totalSpending) * 100, 2) : 0;
    }

    return [
      `${day}__${historyKey(sub?.name)}__${key}`,
      {
        date: day,
        partial: options.partial === true,
        subDomain: sub?.name || "",
        pic: sub?.pic || "",
        country: gam.country || key,
        isoCode: isoCodeOf(key),
        spending,
        adTax,
        totalSpending,
        earning,
        ...traffic,
        profit: unknown ? null : round(earning - totalSpending, 2),
        roi,
        status: unknown ? "Unknown" : countryRoiStatus(spending, earning),
        source: "GAM + Meta Ads",
        updatedAt: iso,
      },
    ];
  });
}

// Sisi trafik satu baris negara: yang datang dari laporan apa adanya (impresi, klik, rincian
// sumber revenue) dan yang dihitung darinya (CTR, CPC, eCPM).
//
// Tiga aturan yang dipakai di sini sama persis dengan baris ROI subdomain, dan ketiganya soal
// membedakan "nol" dari "tidak tahu":
//
//   - Laporan negara yang GAGAL (`unknown`) mengosongkan SEMUANYA. CTR memang tidak butuh
//     earning, tapi run yang laporannya gagal juga tidak membawa impresi maupun klik — yang ada
//     cuma sisi Meta-nya.
//   - Metrik yang tidak dibawa baris tetap `null`, bukan 0 (lihat addCountryMetrics).
//   - Pembagi yang benar-benar NOL menghasilkan 0, bukan null: negara dengan klik nol memang
//     CPC-nya nol, dan itu berbeda dari negara yang jumlah kliknya tidak pernah dilaporkan.
function countryTraffic(gam, earning, unknown) {
  const impressions = unknown ? null : numericOr(gam.impressions, null);
  const clicks = unknown ? null : numericOr(gam.clicks, null);
  const money = unknown ? 0 : Number(earning || 0);

  return {
    impressions,
    clicks,
    // CTR dalam persen, seperti kolom ROI di sebelahnya — tabelnya menampilkan "%", dan pecahan
    // 0,2 di antara kolom yang semuanya persen terbaca sebagai 0,2%.
    ctr: impressions
      ? round((Number(clicks || 0) / impressions) * 100, 2)
      : nullOrZero(impressions),
    cpc: clicks ? round(money / clicks, 2) : nullOrZero(clicks),
    ecpm: impressions ? round((money / impressions) * 1000, 2) : nullOrZero(impressions),
    // Rincian sumber revenue per negara: yang membuat potongan Company (Ad Exchange saja, bukan
    // AdSense) bisa dibaca per negara alih-alih hanya per subdomain.
    adxRevenue: unknown ? null : numericOr(gam.adx, null),
    adsenseRevenue: unknown ? null : numericOr(gam.adsense, null),
    adServerRevenue: unknown ? null : numericOr(gam.adServer, null),
  };
}

// Pembagi 0 -> 0 (angkanya memang nol), pembagi yang tidak dilaporkan -> null.
function nullOrZero(divisor) {
  return divisor === 0 ? 0 : null;
}

/**
 * Baris ROI per negara dikelompokkan per user, karena di situlah panelnya membacanya:
 * `users/{id}.countryRoi`. Kepemilikannya lewat PIC subdomain — tabel di Profile User memang
 * hanya berisi subdomain yang dipegang user itu.
 *
 * Mengembalikan `{ entries, unowned }`: `entries` pasangan `[userId, { kunci: baris }]` siap
 * ditulis, `unowned` nama subdomain yang PIC-nya kosong atau tidak cocok dengan user mana pun —
 * angkanya ada, tapi tidak ada halaman yang bisa menampilkannya sampai PIC-nya diisi.
 */
export function countryRoiByUser(subs, users, earningByCountry, spendByCountry, options = {}) {
  const userIdByName = new Map();
  for (const [id, user] of Object.entries(users || {})) {
    if (user && !user.deletedAt && user.name) userIdByName.set(normalizeName(user.name), id);
  }

  const byUser = new Map();
  const unowned = [];
  for (const id of new Set([...earningByCountry.keys(), ...spendByCountry.keys()])) {
    const sub = subs?.[id];
    if (!sub || sub.deletedAt) continue;
    const userId = userIdByName.get(normalizeName(sub.pic));
    if (!userId) {
      unowned.push(sub.name || id);
      continue;
    }
    const rows = byUser.get(userId) || {};
    for (const [key, row] of countryRoiRows(sub, earningByCountry.get(id), spendByCountry.get(id), {
      ...options,
      earningKnown: !options.unknownEarning?.has(id),
    })) {
      rows[key] = row;
    }
    byUser.set(userId, rows);
  }
  return { entries: [...byUser], unowned };
}

// --- Kegagalan yang tidak menjatuhkan run -------------------------------------------------------
//
// Sebuah laporan GAM yang gagal untuk satu network tidak boleh menghentikan sync — network lain
// angkanya masih bisa diambil. Sampai sekarang harganya adalah kegagalan itu hanya masuk
// `console.error` di dalam Cloud Function: tidak ada satu pun tempat di dashboard yang
// menyebutnya, dan barisnya tetap tampil seolah datanya lengkap.
//
// Tiap modul sync karena itu menulis daftar isunya sendiri ke `dashboard/syncIssues/{cabang}`,
// ditimpa utuh tiap run: yang ditampilkan ikon alert adalah keadaan run terakhir, bukan tumpukan
// keluhan lama yang sudah lewat.

export const SYNC_ISSUES_PATH = "dashboard/syncIssues";

/**
 * Satu isu: apa yang gagal, pada apa, kenapa, dan apa akibatnya di layar.
 *
 * `impact` adalah bagian yang paling sering hilang dari sebuah pesan error. "GAM 500" tidak
 * memberi tahu siapa pun bahwa earning enam subdomain hari itu kosong — dan itulah yang perlu
 * diketahui orang yang sedang menatap tabel ROI.
 */
export function syncIssue({ source, target, message, impact = "", credential = "" }) {
  return {
    source: String(source || "Sync"),
    target: String(target || "-"),
    message: String(message || "Tidak ada pesan error."),
    impact: String(impact || ""),
    // Kredensial Google yang dipakai akun ini, kalau ada. Bukan hiasan: satu kredensial yang
    // aksesnya dicabut menjatuhkan SEMUA akunnya sekaligus, dan panel isu sync memakai nama ini
    // untuk menggabungkan sembilan baris yang menuntut satu tindakan yang sama menjadi satu.
    // Kosong untuk yang tidak menyangkut kredensial Google (Meta, plugin, tahap yang gagal).
    credential: String(credential || ""),
  };
}

// Isi satu cabang `dashboard/syncIssues`. Ditulis walau kosong: cabang yang tidak pernah
// dikosongkan akan membuat ikon alert menyala selamanya setelah satu kegagalan yang sudah pulih.
export function syncIssuesUpdate(label, issues, now = new Date()) {
  const items = (issues || []).filter(Boolean).map((issue) => syncIssue(issue));
  return {
    label,
    count: items.length,
    checkedAt: now.toISOString(),
    // RTDB membuang array kosong (nodenya hilang sama sekali), jadi daftar isu disimpan sebagai
    // objek berkunci urutan — cabang yang bersih tetap punya `count: 0` yang bisa dibaca UI.
    items: Object.fromEntries(items.map((item, index) => [`i${index}`, item])),
  };
}

// --- Retry akun yang gagal ---------------------------------------------------------------------
//
// Satu laporan API yang gagal tidak menjatuhkan run, tapi juga tidak perlu menunggu sejam untuk
// dicoba lagi. `scheduledSync` menanam benih tiap akun yang gagal di `dashboard/syncRetries/{cabang}`,
// dan `scheduledSyncRetry` (tiap menit) mencoba ulang HANYA akun itu — bukan seluruh armada.
//
// Kenapa loopnya di fungsi terpisah dan bukan `await sleep()` di dalam scheduledSync: jeda 1 menit
// yang bertambah (1,2,3,4,5) × maks 5 = 15 menit, jauh melewati batas 9 menit Cloud Functions.
// Tiap tick membaca state, mencoba yang jatuh tempo, lalu selesai dalam hitungan detik.
export const SYNC_RETRY_PATH = "dashboard/syncRetries";
export const MAX_SYNC_RETRIES = 5;
export const RETRY_BASE_MS = 60_000;

// Jeda sebelum percobaan BERIKUTNYA tumbuh: 1,2,3,4,5 menit. `attempts` = jumlah retry yang sudah
// dilakukan (0 = baru ditanam benihnya, full sync barusan sudah jadi percobaan awalnya).
export function nextRetryAt(attempts, now = new Date()) {
  return new Date(now.getTime() + (attempts + 1) * RETRY_BASE_MS).toISOString();
}

// Benih dari daftar `errors` sebuah stage ({id,name,message}). Ditulis mengganti seluruh cabang
// (seperti syncIssuesUpdate): akun yang sudah pulih di run penuh tidak boleh tertinggal sebagai
// retry hantu, dan akun yang gagal lagi memang layak dihitung ulang dari nol.
export function retrySeed(errors, now = new Date()) {
  const out = {};
  for (const error of errors || []) {
    if (!error?.id) continue;
    out[error.id] = {
      name: error.name || error.id,
      message: error.message || "",
      attempts: 0,
      nextAt: nextRetryAt(0, now),
    };
  }
  return out;
}

// Akun yang jatuh tempo di-retry: nextAt sudah lewat DAN belum kehabisan jatah.
export function dueRetries(branch, now = new Date()) {
  const due = [];
  for (const [id, entry] of Object.entries(branch || {})) {
    if (!entry || (entry.attempts || 0) >= MAX_SYNC_RETRIES) continue;
    if (new Date(entry.nextAt).getTime() <= now.getTime()) due.push({ id, entry });
  }
  return due;
}

/**
 * Tandai satu antrean sebagai SEDANG dicoba lagi.
 *
 * Inilah yang dibaca indikator di topbar. Ditulis sebelum akun/situsnya dihubungi, bukan sesudah:
 * percobaan yang memakan semenit harus terlihat sedang berjalan sejak awal — alasan yang sama
 * dengan flag `running` di `dashboard/syncStatus`.
 *
 * Retry akun (Cloud Function) selesai dalam hitungan detik dan tidak menulis penanda ini; yang
 * membacanya menganggap antrean yang jatuh temponya sudah lewat sebagai "menunggu giliran", bukan
 * "berhenti dicoba".
 */
export function retryRunning(entry, now = new Date()) {
  return { ...entry, running: true, startedAt: now.toISOString() };
}

// Nilai baru node setelah satu retry. null = hapus dari antrean: pulih, atau jatah habis (5×).
export function retryOutcome(entry, stillFailed, message, now = new Date()) {
  if (!stillFailed) return null;
  const attempts = (entry.attempts || 0) + 1;
  if (attempts >= MAX_SYNC_RETRIES) return null;
  // `running`/`startedAt` sengaja TIDAK ikut disalin: percobaan ini sudah selesai, dan penanda yang
  // ikut terbawa akan membuat indikatornya berputar selamanya untuk sesuatu yang sedang menunggu.
  const { running, startedAt, ...rest } = entry;
  return {
    ...rest,
    message: message ?? entry.message,
    attempts,
    nextAt: nextRetryAt(attempts, now),
  };
}

// --- Status & log sync otomatis ----------------------------------------------------------------
//
// Sync yang jalan sendiri tiap jam tidak punya siapa pun yang menonton hasilnya: tidak ada toast,
// tidak ada tombol yang berhenti berputar. Tiap run karena itu menulis dua hal — status terakhir
// (dibaca hitung mundur di topbar) dan satu baris log per run (dibaca halaman Settings).

export function syncLogKeep() {
  return Math.max(1, Number(process.env.SYNC_LOG_KEEP) || 100);
}

// "20260807143210" — sortable sebagai teks, dan urutan kunci = urutan waktu.
export function syncRunKey(now = new Date()) {
  return now.toISOString().replace(/\D/g, "").slice(0, 14);
}

export function excessSyncRunKeys(existing, keep = syncLogKeep()) {
  const keys = Object.keys(existing || {})
    .filter((key) => /^\d{14}$/.test(key))
    .sort();
  return keys.length > keep ? keys.slice(0, keys.length - keep) : [];
}

/**
 * Jarak antar-run untuk jadwal bentuk interval ("every N minutes/hours"), dipakai `nextRunAfter`.
 *
 * Bentuk cron ditangani `nextRunAfter` sendiri — ia tidak punya "jarak antar-run" yang tunggal.
 */
export function scheduleIntervalMs(schedule) {
  const match = String(schedule || "")
    .trim()
    .match(/^every\s+(\d+)\s*(minutes?|hours?)$/i);
  if (!match) return null;
  const count = Number(match[1]);
  if (!Number.isFinite(count) || count <= 0) return null;
  return match[2].toLowerCase().startsWith("hour") ? count * 3_600_000 : count * 60_000;
}

/**
 * Satu field cron sebagai daftar nilai: "*" (semua), "5", "0,30", "*\/2". Bentuk lain — rentang
 * "1-5", step berawalan angka — mengembalikan undefined, dan jadwalnya dinyatakan tak terbaca.
 * Menebak salah lebih buruk daripada mengaku tidak tahu: hitung mundur di topbar yang meleset
 * membuat jadwal yang sehat terbaca "terlewat".
 */
function cronValues(field, max) {
  if (field === "*") return { all: true };

  const step = String(field).match(/^\*\/(\d+)$/);
  if (step) {
    const size = Number(step[1]);
    if (!size || size > max) return undefined;
    const values = [];
    for (let value = 0; value <= max; value += size) values.push(value);
    return { values };
  }

  const values = [];
  for (const part of String(field).split(",")) {
    if (!/^\d+$/.test(part) || Number(part) > max) return undefined;
    values.push(Number(part));
  }
  return values.length ? { values } : undefined;
}

/**
 * Tembakan berikutnya setelah `from`, dari ekspresi jadwal Cloud Scheduler. null kalau bentuknya
 * tidak bisa dihitung.
 *
 * Dua bentuk, dan bedanya bukan gaya penulisan melainkan perilakunya:
 *
 * - **Interval** ("every 60 minutes") dihitung dari run SEBELUMNYA SELESAI — itu arti bentuk cron
 *   App Engine, dan terbaca dari data produksi (jarak antar-selesai selalu 59-60 menit sementara
 *   jarak antar-mulai 62-77 menit, persis sepanjang durasi run yang berubah-ubah). Karena itu ia
 *   melar tiap jam, dan **tiap deploy me-reset hitungannya**: Scheduler menerima job yang diperbarui
 *   dan mulai menghitung 60 menit dari saat itu, jadi satu deploy = satu siklus hilang.
 * - **Cron** ("5 * * * *") adalah jam dinding di zona operasi: tidak melar, dan deploy tidak
 *   menggesernya. Inilah bentuk yang dipakai `scheduledSync`.
 *
 * Dipindai menit demi menit lewat zona operasi alih-alih dihitung dengan aritmetika jam — satu-
 * satunya cara yang tetap benar kalau SYNC_TIMEZONE suatu saat diisi zona ber-DST. Batasnya 24 jam
 * karena field hari/bulan/hari-minggu wajib "*"; yang lebih jarang dari harian tidak dihitung.
 */
export function nextRunAfter(schedule, from, timeZone = syncTimeZone()) {
  const interval = scheduleIntervalMs(schedule);
  if (interval) return new Date(from.getTime() + interval);

  const fields = String(schedule || "")
    .trim()
    .split(/\s+/);
  if (fields.length !== 5) return null;
  const [minuteField, hourField, dayOfMonth, month, dayOfWeek] = fields;
  if (dayOfMonth !== "*" || month !== "*" || dayOfWeek !== "*") return null;

  const minutes = cronValues(minuteField, 59);
  const hours = cronValues(hourField, 23);
  if (!minutes || !hours) return null;

  // Mulai dari menit berikutnya: menit yang sedang berjalan sudah lewat tembakannya.
  const start = Math.floor(from.getTime() / 60_000) * 60_000 + 60_000;
  for (let i = 0; i < 24 * 60; i += 1) {
    const at = new Date(start + i * 60_000);
    const parts = zonedParts(at, timeZone);
    const hour = Number(parts.hour === "24" ? "0" : parts.hour);
    const minute = Number(parts.minute);
    const hourOk = hours.all || hours.values.includes(hour);
    const minuteOk = minutes.all || minutes.values.includes(minute);
    if (hourOk && minuteOk) return at;
  }
  return null;
}

/**
 * Satu baris log: hasil tiap tahap dalam satu run.
 *
 * `stages` adalah [{ name, ok, detail }]. Yang gagal tetap dicatat lengkap dengan alasannya —
 * "sync gagal" tanpa menyebut tahap mana dan kenapa tidak memberi tahu siapa pun apa yang harus
 * diperbaiki, dan run ini tidak punya console yang sedang dibaca orang.
 */
export function syncRunEntry(stages, startedAt, finishedAt = new Date()) {
  const rows = (stages || []).map((stage) => ({
    name: stage?.name || "",
    ok: stage?.ok !== false,
    detail: stage?.detail || "",
  }));
  const failed = rows.filter((row) => !row.ok);
  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationSec: Math.max(0, Math.round((finishedAt - startedAt) / 1000)),
    ok: failed.length === 0,
    failed: failed.length,
    stages: rows,
    summary: failed.length
      ? `${failed.length} dari ${rows.length} tahap gagal: ${failed.map((row) => row.name).join(", ")}.`
      : rows.map((row) => `${row.name} ${row.detail}`.trim()).join(" | ") || "Tidak ada tahap.",
  };
}

// Status terakhir, satu node yang ditimpa tiap run. Dibaca hitung mundur di topbar.
export function syncStatusUpdate(entry, schedule, now = new Date()) {
  const nextRun = nextRunAfter(schedule, new Date(entry.finishedAt));
  return {
    running: false,
    schedule: schedule || "",
    lastRunAt: entry.finishedAt,
    lastOk: entry.ok,
    lastSummary: entry.summary,
    lastDurationSec: entry.durationSec,
    // Dihitung dari waktu run ini SELESAI, bukan mulai — untuk jadwal bentuk interval itu memang
    // titik hitungnya (lihat `nextRunAfter`), dan untuk cron keduanya menghasilkan tembakan yang
    // sama selama run tidak lebih panjang dari satu siklus.
    nextRunAt: nextRun ? nextRun.toISOString() : "",
    updatedAt: now.toISOString(),
  };
}

/**
 * Riwayat yang cuma dibaca DUA layar, dan karena itu tinggal di pohonnya sendiri:
 * `userReports/{userId}/{campaignHistory,countryRoi,dailySpend,balanceSnapshots}`.
 *
 * DIPISAH DARI `users` KARENA IZIN BACA RTDB MENURUN, dan `users` dilanggan browser SETIAP akun
 * pada SETIAP muat halaman — ia yang memberi nama, PIC, dan baris campaign ke hampir tiap layar.
 * Keempat riwayat ini 2,81 MB dari 3,12 MB node itu (8 Sep 2026), dan yang membacanya cuma
 * panel-panel di `/users/{id}` plus rincian negara di tab "Laporan ROI Realtime": tiap orang yang
 * membuka Domains mengunduh riwayat spend campaign 90 hari milik lima advertiser untuk menggambar
 * tabel domain.
 *
 * Yang kedua, dan yang tidak terlihat di angka muat halaman: `countryRoi` DITULIS ULANG UTUH tiap
 * run, jadi tiap tab yang dibiarkan terbuka menerima ~745 KB delta per jam untuk panel yang tidak
 * sedang digambar. Pemisahan ini yang menghentikannya, bukan pemangkasan apa pun.
 *
 * Yang TIDAK ikut pindah adalah `campaigns` dan `campaignCommands`: baris campaign dibaca tabel
 * Overview dan saklarnya ditulis dari halaman mana saja, jadi keduanya memang milik `users`.
 *
 * Aturannya sama persis dengan `users` (`.read: auth != null`, `.write` admin) — memisahkan
 * datanya bukan menutupnya, dan panel yang membacanya terbuka untuk tiap akun yang login.
 */
export const USER_REPORTS_PATH = "userReports";

export function userReportsPath(userId) {
  return `${USER_REPORTS_PATH}/${userId}`;
}

// --- Riwayat saldo ---------------------------------------------------------------------------
//
// `adAccounts/{id}` cuma menyimpan angka terakhir: tiap sync menimpanya, jadi tidak ada satu pun
// tempat yang mencatat tadi saldonya berapa dan turun berapa. Dua panel di Profile User membaca
// riwayat itu (`userReports/{id}.dailySpend` dan `.balanceSnapshots`) dan tidak pernah ada yang
// menulisnya, jadi keduanya selalu "Tidak ada data" berapa kali pun sync dijalankan.

// Riwayat ini tetap dipangkas walau sudah pindah dari `users`: yang membacanya panel bertabel
// halaman, dan riwayat berbulan-bulan yang tidak pernah digulir siapa pun cuma memperlambat
// panel yang membukanya — jadi yang lama dibuang di sync yang sama.
export function historyDays() {
  return Math.max(1, Number(process.env.BALANCE_HISTORY_DAYS) || 30);
}

export function snapshotKeep() {
  return Math.max(1, Number(process.env.BALANCE_SNAPSHOT_KEEP) || 60);
}

// Kunci RTDB tidak boleh memuat . $ # [ ] / — dan nama campaign Meta memuat hampir semuanya.
export function historyKey(value) {
  const slug = normalizeName(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return slug || "x";
}

/**
 * "2026-08-07 14:32" menurut ZONA OPERASI — terbaca orang, dan tetap terurut sebagai tanggal oleh
 * sortTableItems yang mengenali awalan YYYY-MM-DD. ISO penuh dengan "T…Z" hanya bikin kolomnya
 * sulit dibaca.
 *
 * WIB, bukan UTC, dan itu bukan kerapian. Bentuk ini TIDAK MEMBAWA zona waktunya: `formatDateTime`
 * di sisi layar hanya menerjemahkan stempel yang menyebut zonanya sendiri ("…Z" atau "+07:00"),
 * dan yang tidak menyebutnya digambar apa adanya. Jadi jam UTC yang ditulis di sini muncul di
 * kolom "Waktu Sync" sebagai jam WIB — tujuh jam lebih awal, tanpa satu pun tanda di layar: sync
 * pukul 16:05 WIB berbunyi "09:05", dan snapshot pagi ini berdiri di tanggal kemarin.
 *
 * Menambahkan "Z" di ujungnya juga akan membetulkannya, tapi lewat jalan yang berbeda: kolomnya
 * lalu mengikuti jam PERANGKAT pembacanya, dan dua orang di dua zona akan menyebut jam yang
 * berbeda untuk satu run sync yang sama. Yang dicatat baris ini adalah jam OPERASI — hari yang
 * sama yang dipakai `zonedDateKey` untuk seluruh baris harian di dashboard ini.
 *
 * Baris LAMA tetap membawa jam UTC-nya dan tidak bisa dibedakan dari yang baru; keduanya berbaur
 * sampai riwayatnya habis sendiri (`snapshotKeep`, 60 snapshot terakhir per akun).
 */
export function displayStamp(date = new Date()) {
  return `${zonedDateKey(date)} ${zonedClock(date)}`;
}

/**
 * Baris "Rekap Riwayat Saldo Berkurang (Daily Spend)" untuk satu ad account: satu per campaign
 * yang membelanjakan sesuatu hari ini. Dikembalikan sebagai pasangan [kunci, baris].
 *
 * Kuncinya tanggal + akun + campaign, jadi sync yang jalan berkali-kali sehari memperbarui baris
 * hari itu, bukan menumpuk satu baris tiap kali dijalankan.
 */
export function dailySpendEntries(accountId, account, campaigns, now = new Date()) {
  // Zona OPERASI, bukan UTC — aturan yang sama dengan `zonedDateKey` di seluruh repo ini, dan di
  // sini ia juga menjaga barisnya tetap masuk akal terhadap dirinya sendiri: sejak `displayStamp`
  // menulis jam WIB, sebuah run pukul 02:00 WIB akan menghasilkan baris bertanggal KEMARIN dengan
  // catatan "Sync Meta 02:00" di sebelahnya. Kolom Tanggal di panel "Rekap Riwayat Saldo
  // Berkurang" adalah hari operasi, hari yang sama dengan seluruh baris harian dashboard ini.
  const date = zonedDateKey(now);
  const note = `Sync Meta ${displayStamp(now).slice(11)}`;
  const name = account?.name || account?.actId || accountId;
  const spending = toArray(campaigns).filter((c) => c?.name && Number(c.spend) > 0);

  // Meta memberi angka akun tapi tidak merinci campaign-nya (semua campaign nol, atau
  // insights-nya kosong). Spend-nya tetap nyata, jadi tetap dicatat — kolom Campaign yang
  // mengaku tidak tahu, bukan barisnya yang hilang.
  if (spending.length === 0) {
    const amount = round(Number(account?.spendToday || 0), 2);
    if (!amount) return [];
    return [
      [
        `${date}__${historyKey(accountId)}`,
        { date, account: name, campaign: "Tanpa rincian campaign", amount, note },
      ],
    ];
  }

  return spending.map((c) => [
    `${date}__${historyKey(accountId)}__${historyKey(c.name)}`,
    { date, account: name, campaign: c.name, amount: round(Number(c.spend), 2), note },
  ]);
}

// Masa simpan riwayat spend campaign per-hari (default 90 hari). Beda dari `BALANCE_HISTORY_DAYS`:
// dailySpend adalah rekaman saldo berkurang, ini rekaman kinerja campaign per hari untuk analisis.
export function campaignHistoryDays() {
  return Math.max(1, Number(process.env.CAMPAIGN_HISTORY_DAYS) || 90);
}

// Berapa hari terakhir yang dibaca ULANG tiap sync. Hari ini masih menumpuk dan kemarin baru final
// menjelang siang, jadi jendela kecil membuat baris terbaru selalu segar tanpa menarik 90 hari tiap
// dua menit. Backfill sekali-jalan yang mengisi sisanya.
export function campaignHistoryWindow() {
  return Math.max(1, Number(process.env.CAMPAIGN_HISTORY_WINDOW) || 3);
}

/**
 * Baris "Riwayat Spend Campaign" — satu per campaign PER HARI, dari `fetchCampaignSpend` yang diminta
 * dengan rentang (`time_increment=1`), jadi tiap baris membawa `date` (date_start) sendiri.
 *
 * Terpisah dari `dailySpendEntries`: yang itu rekaman "saldo berkurang hari ini" (satu hari, kunci
 * tanggal run), yang ini riwayat berhari-hari yang disaring rentang tanggal + Kode Keitaro di UI.
 * Tanggalnya diambil dari Meta (`date_start`), bukan jam run, supaya baris jatuh di hari operasinya.
 *
 * `resolve(name)` mengembalikan `{ subDomain, code }` (sama dengan pemetaan tabel Kampanye), jadi
 * riwayatnya bisa disaring per kode dan menampilkan subdomain tujuannya.
 */
export function campaignHistoryEntries(accountId, account, dayRows, resolve, _now = new Date()) {
  const name = account?.name || account?.actId || accountId;
  const out = [];
  for (const row of toArray(dayRows)) {
    if (!row?.name || !row.date) continue;
    const { subDomain, code } = resolve(row.name);
    out.push([
      `${row.date}__${historyKey(accountId)}__${historyKey(row.id || row.name)}`,
      {
        date: row.date,
        campaign: row.name,
        campaignId: String(row.id || ""),
        account: name,
        adAccount: account?.actId || "",
        subDomain,
        campaignCode: code,
        spend: round(Number(row.spend || 0), 2),
        results: Number(row.results || 0),
        resultType: row.resultType || "",
        // Biaya per hasil versi Meta; "" (bukan 0) kalau tidak dikirim — 0 mengaku gratis.
        costPerResult: row.costPerResult ?? "",
      },
    ]);
  }
  return out;
}

// Kunci riwayat spend campaign yang sudah lewat masa simpan. Bentuk kuncinya sama dengan dailySpend
// (`YYYY-MM-DD__…`), jadi hanya baris yang memang ditulis sync ini yang tersentuh.
export function expiredCampaignHistoryKeys(
  existing,
  now = new Date(),
  days = campaignHistoryDays(),
) {
  const cutoff = campaignHistoryPruneBefore(now, days);
  return Object.keys(existing || {}).filter(
    (key) => /^\d{4}-\d{2}-\d{2}__/.test(key) && key.slice(0, 10) < cutoff,
  );
}

// Batas atas permintaan pemangkasan riwayat campaign, alasan yang sama dengan
// `dailySpendPruneBefore` di bawah: satu cutoff, dua pemakai.
export function campaignHistoryPruneBefore(now = new Date(), days = campaignHistoryDays()) {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Satu baris "Riwayat Snapshot Saldo (Log Per-Sync)" untuk satu akun pada satu sync.
 *
 * `previous` adalah snapshot terakhir akun ini. Tanpa itu tidak ada perubahan yang bisa disebut,
 * dan "turun 0" akan terbaca sebagai saldo yang tidak bergerak padahal ini rekaman pertamanya.
 *
 * Catatannya sengaja tidak memuat angka ber-"Rp": renderCell memperlakukan teks apa pun yang
 * memuat "Rp <angka>" sebagai nilai uang dan akan mengubah seluruh kalimat jadi satu angka.
 */
export function balanceSnapshotEntry(accountId, account, previous, now = new Date()) {
  const balance = round(Number(account?.balance || 0), 2);
  const before = Number.isFinite(Number(previous?.balance)) ? Number(previous.balance) : null;
  const key = `${now.toISOString().slice(0, 16).replace(/[-:T]/g, "")}__${historyKey(accountId)}`;

  let note = "Snapshot pertama untuk akun ini.";
  if (before !== null) {
    const direction =
      balance < before ? "Saldo turun" : balance > before ? "Saldo naik (top-up)" : "Saldo tetap";
    note = `${direction} sejak ${previous.syncedAt || "sync sebelumnya"}.`;
  }

  return [
    key,
    {
      syncedAt: displayStamp(now),
      account: account?.name || account?.actId || accountId,
      balance,
      dailyReduction: round(Number(account?.spendToday || 0), 2),
      source: "Meta Ads API",
      note,
    },
  ];
}

// Snapshot terakhir milik satu akun, dipakai sebagai pembanding baris berikutnya. Kuncinya
// diawali stempel waktu, jadi urutan kunci = urutan waktu.
export function latestSnapshotFor(snapshots, accountId) {
  const suffix = `__${historyKey(accountId)}`;
  const keys = Object.keys(snapshots || {})
    .filter((key) => key.endsWith(suffix))
    .sort();
  return keys.length ? snapshots[keys[keys.length - 1]] : null;
}

// Kunci dailySpend yang sudah lewat masa simpan. Hanya kunci yang memang ditulis sync ini yang
// disentuh — baris hasil impor atau input tangan berbentuk lain dan tidak boleh ikut terhapus.
export function expiredDailySpendKeys(existing, now = new Date(), days = historyDays()) {
  const cutoff = dailySpendPruneBefore(now, days);
  return Object.keys(existing || {}).filter(
    (key) => /^\d{4}-\d{2}-\d{2}__/.test(key) && key.slice(0, 10) < cutoff,
  );
}

/**
 * Batas atas permintaan pemangkasan dailySpend — sepola `roiReportPruneBefore`.
 *
 * Cutoff-nya DIHITUNG DI SATU TEMPAT dan dipakai keduanya, bukan ditulis ulang: sebuah permintaan
 * berbatas yang tidak sama persis dengan penyaringnya akan mengembalikan kunci yang lolos filter
 * (memangkas yang belum waktunya) atau menyembunyikan kunci yang seharusnya dibuang — dan yang
 * kedua tidak berbunyi sebagai kesalahan di mana pun, ia cuma berhenti memangkas.
 */
export function dailySpendPruneBefore(now = new Date(), days = historyDays()) {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

// Snapshot paling lama di luar jatah simpan.
export function excessSnapshotKeys(existing, keep = snapshotKeep()) {
  const keys = Object.keys(existing || {})
    .filter((key) => /^\d{12}__/.test(key))
    .sort();
  return keys.length > keep ? keys.slice(0, keys.length - keep) : [];
}

// --- Kolom tabel Kampanye --------------------------------------------------------------------

// Nilai `status` Meta yang berarti campaign-nya BERHENTI. Yang tidak ada di sini dan bukan ACTIVE
// tidak dinamai sama sekali (label ""), sepola dengan `earningKnown`: status yang tidak dikenali
// bukan berarti campaign-nya mati, dan pil "Tidak aktif" untuk campaign yang masih membelanjakan
// uang adalah kabar yang menyuruh orang tidak melakukan apa-apa.
const CAMPAIGN_INACTIVE_STATUS = new Set(["PAUSED", "DELETED", "ARCHIVED"]);

// Meta menulis offset zonanya tanpa titik dua ("2026-09-10T00:00:00+0700"), bentuk yang ADA DI LUAR
// ISO 8601 — mesin JS mengurainya lewat pengurai warisannya masing-masing, dan yang gagal tidak
// melempar apa pun melainkan menjawab NaN. Titik duanya disisipkan dulu, jadi yang mengurai adalah
// jalur ISO yang sama di mana pun kodenya jalan.
export function metaTimeMs(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const ms = Date.parse(text.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Label kolom Status di tabel Kampanye, dari `status` milik Meta — POSISI SAKLARNYA, bukan
 * `effective_status`.
 *
 * Tiga nilai, dan ketiganya sepakat dengan saklar di sebelahnya: saklar On berbunyi "Aktif" atau
 * "Terjadwal", saklar Off berbunyi "Tidak aktif". Sebelumnya label dihitung dari
 * `effective_status`, yang menyebar campaign bersaklar On ke "Review" dan "Limit" — dua kata yang
 * tidak menerangkan saklarnya dan tidak menuntut tindakan siapa pun di halaman ini.
 * **Konsekuensinya diketahui dan diterima**: campaign yang ditahan Meta (review, izin tagihan) dan
 * campaign yang seluruh ad set-nya jeda sekarang berbunyi "Aktif" — sama dengan yang benar-benar
 * tayang — dan yang membedakannya tinggal Ads Manager.
 *
 * "Terjadwal" TIDAK ada di Meta sebagai status. Campaign yang mulai tayang pekan depan berstatus
 * ACTIVE dan efektif ACTIVE juga; yang membedakannya cuma `start_time`, dan itulah yang dibaca
 * kolom Delivery di Ads Manager. `startTime` yang kosong atau tidak terurai jatuh ke "Aktif" —
 * campaign tanpa jadwal memang tayang sekarang, dan menebak "Terjadwal" dari ketiadaan berarti
 * seluruh armada berbunyi terjadwal pada hari Meta berhenti mengirimkan field itu.
 */
export function campaignStatusLabel(status, startTime, now = new Date()) {
  const configured = String(status || "").toUpperCase();
  if (configured === "ACTIVE") {
    const start = metaTimeMs(startTime);
    return start !== null && start > now.getTime() ? "Terjadwal" : "Aktif";
  }
  return CAMPAIGN_INACTIVE_STATUS.has(configured) ? "Tidak aktif" : "";
}

// Kegagalan Meta yang PERMANEN untuk satu akun: pemiliknya mencabut/tidak pernah memberi izin
// ads_read/ads_management ke token kita. Beda dari token kedaluwarsa atau rate limit, ini tidak
// pulih dengan mencoba lagi — butuh orang yang membuka Business Manager akun itu. Sync yang terus
// menembaknya cuma menumpuk kegagalan; `syncAdAccounts` memakai ini untuk mematikan sync akun itu
// sendiri (`syncDisabled`), TAPI hanya kalau akun lain di run yang sama berhasil — kalau semua
// gagal, yang bermasalah tokennya, bukan akunnya.
export function permanentAccountError(message) {
  const text = String(message || "").toLowerCase();
  return /ads_read|ads_management/.test(text) && /grant|permission/.test(text);
}

// --- Baris campaign yang sudah tidak punya sisi Meta -------------------------------------------
//
// `users/{id}.campaigns` sengaja menahan baris yang tidak dikembalikan Meta pada run terakhir:
// laporan yang gagal sesaat tidak boleh menghapus pemetaan yang membuat ROI bekerja. Yang TIDAK
// boleh ikut bertahan ada dua, dan di tabel keduanya terlihat persis seperti campaign yang sehat:
//
//   - baris milik ad account yang sudah bukan milik user ini. TBZ 1247 berpindah pemilik dari
//     Nurjaman ke Lightman, dan 107 barisnya tinggal di profil Nurjaman — campaign akun orang
//     lain, lengkap dengan spend dan status hari terakhir akun itu masih miliknya.
//   - baris yang campaign-nya memang sudah tidak ada di Meta (diarsipkan atau dihapus). Statusnya
//     membeku pada bacaan terakhir, jadi campaign yang dimatikan lewat Ads Manager lalu
//     diarsipkan berdiri "Aktif" di dashboard selamanya.
//
// Keduanya dinilai dari baris itu sendiri, bukan dari umur data: baris yang akunnya gagal dibaca
// run ini tidak boleh ikut dihukum, karena "tidak dikembalikan" dan "tidak diminta" berbeda.

// Ad account mana yang diwakili satu baris. `adAccount` (actId) adalah alamat yang pasti; namanya
// ikut jadi kunci karena baris yang ditulis sebelum kolom itu ada hanya membawa `account`.
function accountKeysOf(actId, name) {
  const keys = [];
  const id = String(actId || "")
    .trim()
    .toLowerCase();
  if (id) keys.push(`id:${id}`);
  if (name) keys.push(`name:${normalizeName(name)}`);
  return keys;
}

/**
 * Kunci ad account milik tiap user: userId -> Set kunci. Dibaca dari SELURUH `adAccounts`, bukan
 * dari akun yang kebetulan disync run ini — kepemilikan tidak berubah karena sebuah run dibatasi
 * ke satu akun, dan run sebagian yang menilai dari daftarnya sendiri akan membuang campaign
 * seluruh akun yang tidak ikut disebut.
 */
export function accountKeysByOwner(accounts, userIdByName) {
  const byUser = new Map();
  for (const account of Object.values(accounts || {})) {
    if (!account || account.deletedAt || !account.actId) continue;
    const ownerId = account.userOwner && userIdByName.get(normalizeName(account.userOwner));
    if (!ownerId) continue;
    const keys = byUser.get(ownerId) || new Set();
    for (const key of accountKeysOf(account.actId, account.name)) keys.add(key);
    byUser.set(ownerId, keys);
  }
  return byUser;
}

// Kunci untuk satu ad account yang barusan dibaca — bentuknya sama dengan isi Set di atas supaya
// keduanya bisa diadu dengan `campaignRowBelongsTo` yang sama.
export function accountKeys(account) {
  return accountKeysOf(account?.actId, account?.name);
}

/**
 * Apakah baris campaign ini milik salah satu ad account di `keys`.
 *
 * Baris yang tidak membawa identitas akun sama sekali dibiarkan lolos: baris paling lama ditulis
 * tanpa `adAccount` maupun `account`, dan tidak bisa dibuktikan asing. Menghapus yang tidak bisa
 * dibuktikan adalah cara pemetaan manual hilang tanpa ada yang tahu.
 */
export function campaignRowBelongsTo(row, keys) {
  const actId = String(row?.adAccount || "")
    .trim()
    .toLowerCase();
  if (actId) return keys.has(`id:${actId}`);
  const name = normalizeName(row?.account || row?.actName || "");
  return name ? keys.has(`name:${name}`) : true;
}

// Label kolom Status untuk campaign yang tidak lagi dikembalikan Meta. Bukan "Nonaktif": yang
// nonaktif masih ada dan masih bisa dinyalakan lagi, yang ini tidak — dan selisih itulah yang
// menentukan tombolnya bisa ditekan atau tidak.
export const CAMPAIGN_GONE_STATUS = "Tidak ada di Meta";

// Berapa lama baris seperti itu masih ditampilkan sebelum dibuang. Tanpa batas, tabel Kampanye
// tumbuh selamanya menjadi arsip campaign bertahun-tahun yang tidak lagi diurus siapa pun.
const MISSING_CAMPAIGN_DAYS = Number(process.env.CAMPAIGN_MISSING_DAYS || 7);

/**
 * Baris campaign yang akunnya terbaca run ini tapi campaign-nya tidak ikut kembali.
 *
 * Statusnya diganti, bukan dibiarkan membeku, dan `configuredStatus` dikosongkan: posisi saklar
 * yang tidak punya lawan bicara bukan "mati", dan UI mematikan tombolnya berikut alasannya.
 * `missingSince` tidak digeser kalau sudah ada — itu stempel kapan campaign-nya hilang, bukan
 * kapan terakhir kali kita memeriksanya, dan yang membaca masa simpan membaca yang pertama.
 */
export function missingCampaignRow(row, now = new Date()) {
  if (row?.metaMissing) return row;
  return {
    ...row,
    status: CAMPAIGN_GONE_STATUS,
    configuredStatus: "",
    metaMissing: true,
    missingSince: now.toISOString(),
  };
}

export function missingCampaignExpired(row, now = new Date()) {
  if (!row?.metaMissing) return false;
  const at = Date.parse(row.missingSince || "");
  return Number.isFinite(at) && now.getTime() - at > MISSING_CAMPAIGN_DAYS * 86_400_000;
}

/**
 * Perubahan status/anggaran untuk `users/{userId}`, dari satu bacaan `fetchCampaignSettings`.
 *
 * Ini sisi murni dari penyegaran dua menitan (`refreshCampaignStatuses`): sync campaign penuh
 * jalan tiap jam, dan campaign yang dimatikan orang lewat Ads Manager tidak boleh berdiri "Aktif"
 * di dashboard selama sisa jam itu.
 *
 * Jalurnya bertitik-miring per baris, bukan array `campaigns` utuh — penyegaran ini berjalan di
 * jadwal yang berbeda dari sync penuh, dan menulis ulang seluruh array berarti membuang hasil
 * sync yang kebetulan mendarat di antara baca dan tulis.
 *
 * `scanned` adalah kunci ad account yang benar-benar terbaca run ini. Baris di luar itu tidak
 * disentuh sama sekali: akun yang gagal dibaca tidak menerbitkan kabar apa pun tentang
 * campaign-nya, dan menandainya hilang adalah menyimpulkan dari ketiadaan.
 */
export function campaignStatusRefresh(user, live, scanned, now = new Date()) {
  const payload = {};
  for (const [key, row] of campaignEntries(user?.campaigns)) {
    if (!campaignRowBelongsTo(row, scanned)) continue;
    const campaignId = String(row?.campaignId || "");
    // Baris tanpa ID Meta tidak bisa dicari di daftar campaign, dan yang tidak bisa dikenali
    // bukan yang tidak ada. Sync penuh masih mencocokkannya lewat nama; di sini ia dilewati.
    if (!campaignId) continue;
    const fresh = live.get(campaignId);
    const base = `campaigns/${key}`;

    if (!fresh) {
      if (row?.metaMissing) continue;
      const marked = missingCampaignRow(row, now);
      payload[`${base}/status`] = marked.status;
      payload[`${base}/configuredStatus`] = marked.configuredStatus;
      payload[`${base}/metaMissing`] = true;
      payload[`${base}/missingSince`] = marked.missingSince;
      continue;
    }

    const status = campaignStatusLabel(fresh.status, fresh.startTime, now);
    if (String(row?.status || "") !== status) payload[`${base}/status`] = status;
    if (String(row?.configuredStatus || "") !== String(fresh.status || "")) {
      payload[`${base}/configuredStatus`] = String(fresh.status || "");
    }
    // Jadwal mulainya ikut disimpan, bukan cuma dipakai menghitung label di atas: pil "Terjadwal"
    // yang tidak menyebut KAPAN menyuruh orang membuka Ads Manager untuk pertanyaan yang barusan
    // dijawab setengahnya. Label-nya sendiri tetap dihitung di sini, bukan di browser — "besok"
    // versi tab yang dibiarkan terbuka semalaman adalah hari yang berbeda.
    if (String(row?.startTime || "") !== String(fresh.startTime || "")) {
      payload[`${base}/startTime`] = String(fresh.startTime || "");
    }
    if (fresh.dailyBudget !== undefined && fresh.dailyBudget !== null) {
      if (row?.dailyBudget !== fresh.dailyBudget)
        payload[`${base}/dailyBudget`] = fresh.dailyBudget;
    }
    if (row?.metaMissing || row?.missingSince) {
      payload[`${base}/metaMissing`] = null;
      payload[`${base}/missingSince`] = null;
    }
    // Keterangan "diubah dari sini, status akhir menyusul saat sync" sudah selesai tugasnya
    // begitu Meta sendiri yang mengabarkan statusnya. Dibiarkan, ia menempel berhari-hari pada
    // baris yang sudah lama dikonfirmasi.
    if (row?.statusAppliedAt) payload[`${base}/statusAppliedAt`] = null;
  }
  return payload;
}

// --- Saklar on/off campaign -------------------------------------------------------------------
//
// Tombol di /users/{uid} tidak memanggil Meta langsung. Ia menulis NIAT-nya ke
// `users/{uid}/campaignCommands/{campaignId}`, dan yang memanggil Meta adalah penerap di sisi
// server (callable, sync terjadwal, atau CLI — ketiganya memakai fungsi di file ini).
//
// Kenapa lewat antrean, bukan langsung: DRS memblokir `allUsers`, jadi browser di project ini tidak
// bisa memanggil Cloud Function sama sekali (lihat src/config/features.js). Antrean di RTDB adalah
// satu-satunya jalur yang bekerja hari ini — dan sekaligus jejak siapa mematikan apa, kapan, yang
// tidak akan ada kalau tombolnya menembak Meta lalu melupakannya.
export const CAMPAIGN_STATUSES = ["ACTIVE", "PAUSED"];

// Perintah yang belum kedaluwarsa boleh diterapkan; yang lebih tua dari ini ditandai gagal tanpa
// menyentuh Meta. Menyalakan campaign karena perintah kemarin yang tersangkut adalah membelanjakan
// uang atas keputusan yang sudah tidak berlaku.
const COMMAND_TTL_MS = Number(process.env.CAMPAIGN_COMMAND_TTL_MS || 6 * 3_600_000);

// Perintah yang sudah selesai disimpan sebentar supaya UI bisa memberi tahu hasilnya, lalu dibuang.
const COMMAND_KEEP_MS = Number(process.env.CAMPAIGN_COMMAND_KEEP_MS || 24 * 3_600_000);

// campaigns[] datang sebagai array dari sync, tapi RTDB mengembalikan array berlubang sebagai
// objek. Kuncinya dipakai sebagai potongan path — jadi yang dikembalikan pasangan [kunci, baris],
// bukan barisnya saja: menulis ulang seluruh array untuk mengubah satu field akan menghapus hasil
// sync yang kebetulan mendarat di antara baca dan tulis.
export function campaignEntries(value) {
  if (!value) return [];
  return Array.isArray(value)
    ? value.map((row, index) => [String(index), row]).filter(([, row]) => row)
    : Object.entries(value).filter(([, row]) => row);
}

// Isi satu perintah baru. Bentuknya sama dari mana pun ia ditulis (browser, callable, CLI) supaya
// penerapnya tidak perlu tahu asalnya.
export function campaignCommandEntry(campaign, desiredStatus, actor, now = new Date()) {
  if (!CAMPAIGN_STATUSES.includes(desiredStatus)) {
    throw new Error(`Status campaign tidak dikenal: ${desiredStatus}`);
  }
  const campaignId = String(campaign?.campaignId || "").trim();
  if (!campaignId) {
    throw new Error("Campaign ini belum punya ID Meta — jalankan sync campaign dulu.");
  }
  return {
    campaignId,
    // Namanya ikut disimpan supaya log dan pesan gagal bisa menyebut campaign yang mana; ID Meta
    // sendiri tidak berarti apa-apa untuk orang yang membacanya.
    campaign: campaign?.campaign || "",
    adAccount: campaign?.adAccount || "",
    desiredStatus,
    state: "pending",
    requestedAt: now.toISOString(),
    requestedBy: actor || "dashboard",
    error: null,
  };
}

// Perintah yang menunggu, dari seluruh user. Yang bentuknya tidak utuh dilewati diam-diam: sebuah
// baris rusak tidak boleh menghentikan perintah user lain di run yang sama.
export function pendingCampaignCommands(users, now = new Date()) {
  const commands = [];
  for (const [userId, user] of Object.entries(users || {})) {
    if (!user || user.deletedAt) continue;
    for (const [campaignId, command] of Object.entries(user.campaignCommands || {})) {
      if (command?.state !== "pending") continue;
      if (!CAMPAIGN_STATUSES.includes(command.desiredStatus)) continue;
      commands.push({
        userId,
        campaignId,
        campaign: command.campaign || "",
        desiredStatus: command.desiredStatus,
        requestedAt: command.requestedAt || "",
        requestedBy: command.requestedBy || "",
        // Perintah basi tetap dikembalikan, ditandai — penerapnya yang menuliskan kenapa ia
        // tidak jadi dieksekusi. Dilewati diam-diam, ia akan menggantung "Menunggu" selamanya.
        expired: isExpiredCommand(command.requestedAt, now),
      });
    }
  }
  return commands;
}

function isExpiredCommand(requestedAt, now) {
  const at = Date.parse(requestedAt || "");
  return Number.isFinite(at) ? now.getTime() - at > COMMAND_TTL_MS : false;
}

/**
 * Satu payload update (relatif terhadap `users/{userId}`) untuk perintah yang sudah dieksekusi.
 *
 * Saat berhasil, baris campaign-nya ikut diperbarui di tempat: `configuredStatus` adalah posisi
 * tombol yang baru, dan `status` — label yang dibaca tabel — mengikutinya supaya layar tidak
 * bertahan menampilkan keadaan lama sampai sync berikutnya sejam kemudian. `statusAppliedAt`
 * menandai bahwa label itu berasal dari perintah ini, bukan dari laporan Meta; UI memakainya untuk
 * mengatakan status akhir masih menunggu sync.
 */
export function campaignCommandUpdate(user, command, result, now = new Date()) {
  const stamp = now.toISOString();
  const base = `campaignCommands/${command.campaignId}`;
  const payload = {};

  if (!result?.ok) {
    payload[`${base}/state`] = "failed";
    payload[`${base}/failedAt`] = stamp;
    payload[`${base}/error`] = trimCommandError(result?.error);
    return payload;
  }

  payload[`${base}/state`] = "applied";
  payload[`${base}/appliedAt`] = stamp;
  payload[`${base}/error`] = null;
  for (const [key, row] of campaignEntries(user?.campaigns)) {
    if (String(row?.campaignId || "") !== String(command.campaignId)) continue;
    payload[`campaigns/${key}/configuredStatus`] = command.desiredStatus;
    // Tanpa `startTime`, jadi campaign berjadwal yang baru dinyalakan berbunyi "Aktif" sampai
    // penyegaran dua menitan membacanya ulang dari Meta. Itu bukan tebakan yang menyamar: baris
    // ini membawa `statusAppliedAt`, dan kolom Status memang menyebut "status akhir menyusul saat
    // sync" di bawah pilnya.
    payload[`campaigns/${key}/status`] = campaignStatusLabel(command.desiredStatus);
    payload[`campaigns/${key}/statusAppliedAt`] = stamp;
  }
  return payload;
}

// Aturan database membatasi `error` pada 500 karakter, dan pesan Meta bisa lebih panjang dari itu.
// Yang dipotong di sini bukan kerapian melainkan kebenaran: tulisan yang melanggar .validate DITOLAK
// seluruhnya, jadi perintahnya tidak pernah berpindah dari "pending" — dan penerap akan mencobanya
// lagi tiap dua menit, selamanya, atas kegagalan yang tidak pernah bisa ia catat.
const COMMAND_ERROR_MAX = 480;

function trimCommandError(message) {
  const text = String(message || "Perintah gagal dijalankan.");
  return text.length > COMMAND_ERROR_MAX ? `${text.slice(0, COMMAND_ERROR_MAX - 1)}…` : text;
}

// Perintah selesai yang sudah lewat masa simpan. Tanpa ini node-nya tumbuh selamanya, dan tabel
// akan terus menempelkan "diterapkan" pada campaign yang sudah lama disync ulang.
export function expiredCampaignCommandKeys(commands, now = new Date()) {
  return Object.entries(commands || {})
    .filter(([, command]) => {
      if (command?.state === "pending") return false;
      const at = Date.parse(command?.appliedAt || command?.failedAt || command?.requestedAt || "");
      return Number.isFinite(at) && now.getTime() - at > COMMAND_KEEP_MS;
    })
    .map(([key]) => key);
}

// Biaya per hasil. Tanpa hasil pembaginya nol, dan CPR yang dipaksa jadi 0 terbaca sebagai
// "gratis" — alasan yang sama dengan `cpr` di roiReportUpdate. "" supaya kolomnya jadi "-".
export function costPerResult(spend, results) {
  const count = Number(results || 0);
  return count > 0 ? round(Number(spend || 0) / count, 2) : "";
}

// Meta Ads: pull balance + today's spend for one ad account.
//
// `balance` di sini adalah sisa batas pengeluaran (`remaining`), yang artinya sama dengan
// "Jumlah yang tersisa" di kartu batas Meta — bukan field `balance` milik Meta, yang justru
// tagihan berjalan dan sekarang disimpan terpisah sebagai `amountDue`. Namanya tetap `balance`
// karena semua pembacanya (kolom "Sisa Saldo", advertiserSpendRows, balanceSnapshotEntry,
// metaBalance di sync-subdomains) sudah membaca kunci itu.
export async function metaUpdate(account, token) {
  const r = await fetchAccount(account.actId, token);
  return {
    balance: r.remaining,
    spendCap: r.spendCap,
    amountSpent: r.amountSpent,
    amountDue: r.amountDue,
    spendToday: r.spendToday,
    currency: r.currency,
    syncStatus: true,
    lastSyncActionAt: new Date().toISOString(),
  };
}
