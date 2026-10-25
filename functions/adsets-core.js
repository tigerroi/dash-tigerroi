// Ad set satu campaign: penggabungan setelan + angka, tanpa satu pun panggilan jaringan.
//
// Dipisah dari `meta.js` dengan alasan yang sama seperti `account-status.js` dipisah dari
// `adsense.js`: keputusan yang tinggal di dalam pemanggil API tidak bisa diuji tanpa menghubungi
// Meta — dan yang diputuskan di sini justru bagian yang paling mudah salah tanpa suara (nol yang
// dikarang, dan label status yang tidak sepakat dengan saklarnya).

import { resultActionTypes } from "./meta.js";
import { campaignStatusLabel, costPerResult } from "./sync-core.js";

/**
 * Label keempat, yang tidak ada di baris campaign: saklarnya On, campaign di atasnya jalan, dan
 * tetap tidak ada iklan yang tayang.
 *
 * Kata-katanya diambil dari kolom Penayangan Ads Manager, supaya bisa diadu tanpa menerjemahkan
 * apa pun di kepala — dan karena itu ia TIDAK menyebut ulang saklarnya. Yang membedakannya dari
 * "Tidak aktif" adalah pil di sebelahnya memang bukan itu; yang menyebut sebabnya, kalimat di
 * bawahnya.
 *
 * Ia PENGECUALIAN yang disengaja dari aturan "label = posisi saklar" yang berlaku di tabel
 * campaign. Di sana keadaan yang ditahan Meta sengaja dilebur ke "Aktif", karena yang dijawab
 * kolomnya adalah posisi tombol dan tidak ada tindakan yang dituntutnya di halaman itu. Di sini
 * pertanyaannya justru kebalikannya — panel ini dibuka orang untuk mencari tahu KENAPA uangnya
 * tidak keluar — dan ad set yang seluruh iklannya ditolak Meta adalah jawabannya, satu-satunya
 * yang menuntut tindakan hari itu juga.
 */
export const AD_SET_NOT_DELIVERING = "Tidak ditayangkan";

// Satu-satunya keadaan efektif yang berarti "sedang tayang". Sisanya (DISAPPROVED, PENDING_REVIEW,
// WITH_ISSUES, PENDING_BILLING_INFO, …) tidak diperiksa satu per satu: daftar putih yang meleset
// menyebut "tidak tayang" untuk keadaan baru yang sebenarnya tayang, sementara daftar hitam yang
// meleset DIAM untuk ad set yang benar-benar berhenti — dan diam di sini adalah kegagalan yang
// dicari fitur ini untuk dihapus.
const DELIVERING = "ACTIVE";

/**
 * Peta adSetId -> action_type yang dihitung sebagai "Hasil" untuk ad set itu.
 *
 * Di tingkat ini pemetaannya EKSAK, dan itu satu-satunya tempat di dashboard ini yang begitu:
 * `fetchCampaignResultGoals` harus memungut suara karena satu campaign bisa memuat sepuluh ad set
 * beroptimasi berbeda dan kolomnya cuma satu. Di panel ini tiap ad set membawa tujuannya sendiri,
 * jadi tidak ada yang kalah suara — dan angka Hasil di sini adalah angka yang sama dengan yang
 * tertera di Ads Manager untuk baris yang sama.
 */
export function adSetGoals(adSets) {
  const goals = new Map();
  for (const set of adSets || []) {
    const types = resultActionTypes({
      optimization_goal: set?.optimizationGoal,
      promoted_object: {
        custom_event_type: set?.customEventType,
        custom_conversion_id: set?.customConversionId,
      },
    });
    if (set?.id && types.length) goals.set(String(set.id), types);
  }
  return goals;
}

/**
 * Rekap iklan per ad set: berapa yang ADA, berapa yang benar-benar bisa tayang, dan yang tidak bisa
 * itu tertahan oleh apa.
 *
 * `null` untuk pemanggil yang tidak mengoper daftar iklan sama sekali — dan itu bukan "tidak ada
 * iklan": panel tidak boleh menyimpulkan "tidak ditayangkan" dari daftar yang gagal dibaca, sama
 * seperti earning yang tidak diketahui tidak pernah dinilai sebagai nol.
 */
export function adDeliveryIndex(ads) {
  if (!ads) return null;
  const index = new Map();
  for (const ad of ads) {
    const key = String(ad?.adSetId || "");
    if (!key) continue;
    const entry = index.get(key) || { total: 0, deliverable: 0, blockers: {} };
    entry.total += 1;
    const effective = String(ad?.effectiveStatus || "").toUpperCase();
    if (effective === DELIVERING) entry.deliverable += 1;
    else
      entry.blockers[effective || "TIDAK DIKETAHUI"] =
        (entry.blockers[effective || "TIDAK DIKETAHUI"] || 0) + 1;
    index.set(key, entry);
  }
  return index;
}

// Angka yang HANYA berarti kalau ada tayangan/hasil di belakangnya. Untuk ad set yang tidak tayang,
// Meta memang tidak mengirim satu pun dari mereka — dan menuliskannya 0 berarti "CTR-nya nol",
// pernyataan tentang iklan yang pernah dilihat orang.
const RATE_KEYS = ["ctr", "cpc", "cpm", "frequency", "costPerResult"];
const COUNT_KEYS = ["spend", "impressions", "clicks", "reach", "results"];

const BLANK_METRICS = Object.fromEntries(
  [...COUNT_KEYS, ...RATE_KEYS, "resultType"].map((key) => [key, ""]),
);

// Ad set yang berhasil dibaca tapi tidak tayang sepanjang periode: nol yang NYATA, sepola dengan
// spend `0` di baris ROI (campaign-nya ada, hari itu tidak membelanjakan apa pun). Yang dibedakan
// dari nol itu cuma kolom yang butuh pembagi — lihat RATE_KEYS.
const IDLE_METRICS = {
  ...Object.fromEntries(COUNT_KEYS.map((key) => [key, 0])),
  ...Object.fromEntries(RATE_KEYS.map((key) => [key, ""])),
  resultType: "",
};

/**
 * Satu baris per ad set, siap digambar.
 *
 * `metricsKnown: false` berarti panggilan insights-nya sendiri yang gagal — dan itu keadaan yang
 * BERBEDA dari ad set yang tidak tayang. Yang pertama menjawab "" di setiap kolom angka (tidak
 * diketahui bukan nol, aturan yang sama dengan `earningKnown` di baris ROI); yang kedua menjawab 0,
 * karena laporannya berhasil dan ketiadaan barisnya adalah jawaban Meta, bukan kegagalan kita.
 * Dilebur, panel ini akan melaporkan "Rp 0" untuk campaign yang laporannya tidak pernah datang —
 * tak terbedakan dari campaign yang memang sedang berhenti membakar uang.
 *
 * Urutannya spend terbesar dulu: pertanyaan yang membawa orang membuka panel ini adalah ad set mana
 * yang menghabiskan anggarannya. Yang belum tayang berbaris di bawah menurut namanya, bukan menurut
 * urutan Meta — yang itu berpindah-pindah antar pembacaan.
 */
export function mergeAdSetRows(
  adSets,
  insights,
  { now = new Date(), metricsKnown = true, ads = null } = {},
) {
  const byId = new Map((insights || []).map((row) => [String(row?.adSetId || ""), row]));
  const delivery = adDeliveryIndex(ads);

  const rows = (adSets || []).map((set) => {
    const insight = byId.get(String(set?.id || ""));
    const metrics = metricsKnown ? (insight ? pickMetrics(insight) : IDLE_METRICS) : BLANK_METRICS;

    const pausedByCampaign = String(set?.effectiveStatus || "") === "CAMPAIGN_PAUSED";
    const label = campaignStatusLabel(set?.status, set?.startTime, now);
    const adCounts = delivery ? delivery.get(String(set?.id || "")) || EMPTY_ADS : null;
    const notDelivering = isNotDelivering({ label, pausedByCampaign, set, adCounts });

    return {
      id: String(set?.id || ""),
      name: set?.name || "",
      // Label dari POSISI SAKLAR ad set-nya sendiri, lewat fungsi yang sama yang menamai baris
      // campaign — satu kosakata untuk dua tingkat ("Aktif" / "Terjadwal" / "Tidak aktif"). Ditulis
      // ulang di sini, panel ini akan menyebut "Paused" untuk keadaan yang di baris tepat di
      // atasnya berbunyi "Tidak aktif".
      status: notDelivering ? AD_SET_NOT_DELIVERING : label,
      configuredStatus: set?.status || "",
      effectiveStatus: set?.effectiveStatus || "",
      // Saklarnya sendiri On, campaign di atasnya Off. Itu keadaan yang tidak bisa dibaca dari
      // kolom mana pun — dan ia yang menjawab "kenapa ad set ini aktif tapi Rp 0".
      pausedByCampaign,
      notDelivering,
      // Berapa iklan yang ada dan apa yang menahan sisanya — bahan kalimat di bawah pilnya. `null`
      // berarti daftarnya tidak dibaca sama sekali, BUKAN "tidak punya iklan".
      ads: adCounts,
      startTime: set?.startTime || "",
      endTime: set?.endTime || "",
      updatedTime: set?.updatedTime || "",
      // Anggaran: null dari Meta (campaign CBO) jadi "" di sini, bukan 0 — sepola kolom Anggaran di
      // baris campaign. Yang membedakan "tidak diatur di sini" dari "dianggarkan nol" adalah
      // `budgetLevel`, yang dibaca dari ada-tidaknya angkanya.
      dailyBudget: blankIfNull(set?.dailyBudget),
      lifetimeBudget: blankIfNull(set?.lifetimeBudget),
      budgetLevel: hasOwnBudget(set) ? "adset" : "campaign",
      bidStrategy: set?.bidStrategy || "",
      optimizationGoal: set?.optimizationGoal || "",
      billingEvent: set?.billingEvent || "",
      customEventType: set?.customEventType || "",
      countries: Array.isArray(set?.countries) ? set.countries : [],
      ageMin: set?.ageMin ?? null,
      ageMax: set?.ageMax ?? null,
      ...metrics,
    };
  });

  return rows.sort(
    (a, b) => (Number(b.spend) || 0) - (Number(a.spend) || 0) || a.name.localeCompare(b.name),
  );
}

// Anggaran dipegang ad set (ABO) atau campaign (CBO). Yang menjawabnya bukan setelan yang bisa
// ditanyakan ke Meta melainkan ADA-TIDAKNYA angkanya di baris ini: pada campaign CBO, Meta tidak
// mengirim `daily_budget` maupun `lifetime_budget` untuk ad set-nya sama sekali.
function hasOwnBudget(set) {
  return blankIfNull(set?.dailyBudget) !== "" || blankIfNull(set?.lifetimeBudget) !== "";
}

function pickMetrics(insight) {
  const metrics = {};
  for (const key of COUNT_KEYS) metrics[key] = Number(insight?.[key]) || 0;
  for (const key of RATE_KEYS) metrics[key] = blankIfNull(insight?.[key]);
  // Biaya per hasil versi Meta kalau dikirim; kalau tidak, spend ÷ hasil — cadangan yang sama
  // dengan baris campaign di sync-meta.mjs. Meta tidak selalu mengirim biaya untuk event hasilnya
  // di `cost_per_action_type`, dan kolom kosong di sana menyembunyikan angka yang bisa dihitung.
  if (metrics.costPerResult === "") {
    metrics.costPerResult = costPerResult(metrics.spend, metrics.results);
  }
  metrics.resultType = insight?.resultType || "";
  return metrics;
}

function blankIfNull(value) {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  return Number.isFinite(n) ? n : "";
}

const EMPTY_ADS = { total: 0, deliverable: 0, blockers: {} };

/**
 * Saklarnya On, dan tetap tidak ada yang tayang.
 *
 * DUA sumbernya, dan keduanya perlu: keadaan efektif ad set itu sendiri (ditolak, direview, tagihan
 * belum lengkap) DAN iklan di dalamnya (ad set yang efektif ACTIVE dengan seluruh iklannya ditolak
 * — keadaan yang tidak disebut satu pun field di ad set). Yang pertama gratis, yang kedua menuntut
 * satu panggilan lagi; tanpa yang kedua, dua dari lima ad set RNPX-01 berbunyi "Aktif" untuk
 * sesuatu yang berhenti tayang sejak pukul 02:00.
 *
 * Yang SENGAJA tidak ikut merah: `CAMPAIGN_PAUSED`. Ad set itu memang tidak tayang, tapi sebabnya
 * berdiri di baris tepat di atasnya yang sudah berbunyi "Tidak aktif" — dan mewarnai merah seluruh
 * ad set milik campaign yang memang sedang dimatikan orang menghapus arti merahnya: yang dicari di
 * kolom ini adalah ad set yang seharusnya jalan tapi tidak.
 *
 * Yang juga tidak ikut: "Terjadwal" (belum waktunya tayang, bukan kegagalan) dan ad set yang
 * saklarnya memang Off.
 */
function isNotDelivering({ label, pausedByCampaign, set, adCounts }) {
  if (label !== "Aktif" || pausedByCampaign) return false;
  const effective = String(set?.effectiveStatus || "").toUpperCase();
  if (effective && effective !== DELIVERING) return true;
  // Daftar iklan yang tidak dibaca tidak menyimpulkan apa pun — sepola earning yang tidak
  // diketahui, yang tidak pernah dinilai sebagai nol.
  return Boolean(adCounts) && adCounts.deliverable === 0;
}
