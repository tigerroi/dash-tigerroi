// Keterangan baris ad set — turunan tampilan saja, tidak ada satu keputusan pun yang diulang.
//
// Yang memutuskan STATUS sebuah ad set adalah server (`mergeAdSetRows` di functions/adsets-core.js,
// lewat `campaignStatusLabel` yang sama dengan baris campaign). Yang di sini cuma menyusun kalimat
// dari field yang sudah dibawa barisnya; sebuah label yang dihitung ulang di browser akan
// berselisih dengan pil di baris tepat di atasnya pada hari salah satunya bergeser.

import { formatDateTime } from "./formatDate.js";

/**
 * Kenapa baris ini berdiri seperti itu — satu kalimat di bawah pilnya, atau kosong.
 *
 * `pausedByCampaign` yang paling berharga di sini, dan ia satu-satunya keadaan di panel ini yang
 * tidak bisa dibaca dari kolom mana pun: ad set yang saklarnya sendiri On sementara campaign di
 * atasnya mati. Tanpa kalimat itu, yang terlihat cuma "Aktif" berdampingan dengan Rp 0 — dan yang
 * dicari orang berikutnya adalah kerusakan yang tidak ada.
 */
export function adSetStatusNote(row) {
  if (row?.pausedByCampaign) {
    return "Saklarnya On, campaign di atasnya mati.";
  }
  // Pil merah yang tidak menyebut SEBABNYA cuma memindahkan pertanyaannya ke Ads Manager — dan
  // ketiga sebabnya diperbaiki di tempat yang berbeda: iklan yang ditolak lewat banding, iklan yang
  // dimatikan lewat saklarnya sendiri, ad set tanpa iklan dengan membuat iklannya.
  if (row?.notDelivering) {
    return deliveryReason(row);
  }
  if (row?.status === "Terjadwal" && row?.startTime) {
    return `Mulai tayang ${formatDateTime(row.startTime)}.`;
  }
  return "";
}

// Keadaan efektif yang ditolak/ditahan Meta DI TINGKAT AD SET, bukan di iklannya.
const EFFECTIVE_REASON = {
  DISAPPROVED: "Ad set-nya ditolak Meta.",
  PENDING_REVIEW: "Ad set-nya masih direview Meta.",
  IN_PROCESS: "Ad set-nya masih diproses Meta.",
  WITH_ISSUES: "Ad set-nya bermasalah menurut Meta.",
  PENDING_BILLING_INFO: "Info tagihan akun iklannya belum lengkap.",
};

// Apa yang menahan iklannya. Kata kerjanya beda-beda karena tindakannya beda-beda.
const AD_REASON = {
  DISAPPROVED: "ditolak Meta",
  PENDING_REVIEW: "masih direview Meta",
  IN_PROCESS: "masih diproses Meta",
  WITH_ISSUES: "bermasalah menurut Meta",
  PAUSED: "dimatikan",
  ADSET_PAUSED: "dimatikan",
  CAMPAIGN_PAUSED: "dimatikan",
  ARCHIVED: "diarsipkan",
  DELETED: "dihapus",
};

function deliveryReason(row) {
  const effective = String(row?.effectiveStatus || "").toUpperCase();
  if (effective && effective !== "ACTIVE") {
    return EFFECTIVE_REASON[effective] || `Meta menyebut ad set ini ${effective}.`;
  }

  const ads = row?.ads;
  if (!ads?.total) return "Tidak ada iklan di dalamnya.";

  // Yang disebut adalah penahan TERBANYAK, berikut jumlahnya. Menyebut semuanya menghasilkan
  // kalimat sepanjang barisnya sendiri untuk sesuatu yang dibaca sekilas; menyebut yang pertama
  // saja tanpa jumlah menyembunyikan bahwa ad set itu memuat lima iklan yang ditolak semua.
  const [status, count] = Object.entries(ads.blockers || {}).sort((a, b) => b[1] - a[1])[0] || [];
  const phrase = AD_REASON[status] || `berstatus ${status || "tidak diketahui"}`;
  const subject = count === ads.total ? scopeAll(ads.total) : `${count} dari ${ads.total} iklannya`;
  return `${subject} ${phrase}.`;
}

function scopeAll(total) {
  return total === 1 ? "Iklannya" : `Semua iklannya (${total})`;
}

/**
 * Anggaran ad set ini dipegang siapa.
 *
 * Kosong di kolom Anggaran punya DUA arti yang berlawanan, dan hanya kalimat ini yang
 * membedakannya: anggarannya dipegang campaign (CBO — Meta memang tidak mengirim angka apa pun
 * untuk ad set-nya), atau ad set ini memakai anggaran seumur hidup yang angkanya berdiri di kolom
 * lain. Sepola `describeBudget` di baris campaign.
 */
export function adSetBudgetNote(row) {
  if (row?.budgetLevel === "campaign") return "Diatur di level campaign";
  return row?.dailyBudget === "" || row?.dailyBudget === null || row?.dailyBudget === undefined
    ? "Total seumur hidup"
    : "Total/hari";
}

/**
 * Siapa yang disasar, sependek mungkin: "MX, CL · 18–65".
 *
 * Cuma negara dan umur. Targeting Meta memuat jauh lebih banyak (minat, perilaku, penempatan), dan
 * menuliskan semuanya di bawah nama ad set berarti panel ini berhenti bisa dibaca sekilas — yang
 * lengkap tetap di Ads Manager, dan panel ini tidak berusaha menggantikannya.
 */
export function adSetTargetingNote(row) {
  const parts = [];
  const countries = Array.isArray(row?.countries) ? row.countries : [];
  if (countries.length) parts.push(countries.join(", "));
  const age = ageRange(row);
  if (age) parts.push(age);
  return parts.join(" · ");
}

function ageRange(row) {
  const min = Number(row?.ageMin) || 0;
  const max = Number(row?.ageMax) || 0;
  if (!min && !max) return "";
  if (min && max) return `${min}–${max}`;
  return min ? `${min}+` : `≤${max}`;
}

/**
 * Ringkasan di kepala panel: berapa ad set, berapa yang saklarnya On, dan totalnya membelanjakan
 * berapa hari ini.
 *
 * Belanjanya MELEWATI yang tidak diketahui alih-alih menambahkannya — `"" + 100` bukan 101
 * melainkan teks "0100" — dan kalau tidak ada satu pun angka yang bisa dibaca (panggilan insights
 * gagal), totalnya "" dan bukan Rp 0.
 */
export function adSetSummary(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let spend = "";
  for (const row of list) {
    const value = Number(row?.spend);
    if (!Number.isFinite(value) || row?.spend === "") continue;
    spend = (spend === "" ? 0 : spend) + value;
  }
  return {
    total: list.length,
    // Dihitung terpisah dari `active`, dan itu memang pertanyaannya: "yang aktif 5, tiga tayang dan
    // dua tidak". Tanpa angka ini, satu-satunya cara mengetahuinya adalah membaca kesepuluh pil
    // satu per satu.
    notDelivering: list.filter((row) => row?.notDelivering).length,
    // Yang dihitung POSISI SAKLARNYA (`configuredStatus`), bukan labelnya: "Aktif" dan "Terjadwal"
    // sama-sama saklar On, dan memisahkan keduanya di sini akan menyebut angka yang lebih kecil
    // daripada jumlah baris yang pilnya bukan "Tidak aktif".
    active: list.filter((row) => String(row?.configuredStatus || "").toUpperCase() === "ACTIVE")
      .length,
    spend,
  };
}

// Posisi saklar yang sah untuk ditulis ke Meta. Kembaran `CAMPAIGN_STATUSES` di
// functions/sync-core.js, dan sengaja dieja ulang di sini alih-alih diimpor: `src/` dan
// `functions/` dua paket yang tidak bisa saling impor — pola yang sama dengan
// `campaignCommandEntry`.
const TOGGLEABLE = ["ACTIVE", "PAUSED"];

/**
 * Keadaan saklar satu ad set — kembaran `campaignToggleState`, dan sengaja berbeda di dua hal.
 *
 * Tidak ada keadaan "menunggu antrean" seperti di sana: perintah ad set tidak pernah diantrekan di
 * RTDB (server kontrol satu-satunya jalur, lihat controlApi.js), jadi `pending` di sini berarti
 * permintaannya sedang di jalan — bukan tersimpan menunggu cron. Dan tidak ada `metaMissing`: baris
 * ini lahir dari pembacaan Meta beberapa detik lalu, jadi ia ada menurut definisinya sendiri.
 */
export function adSetToggleState(row, { canToggle = false, pending = false } = {}) {
  const configured = String(row?.configuredStatus || "").toUpperCase();
  const on = configured === "ACTIVE";

  if (!row?.id) {
    return { on: false, disabled: true, pending: false, reason: "Ad set ini tidak punya ID Meta." };
  }

  // Diarsipkan/dihapus: Meta menolak menulisnya, dan tombol yang pasti gagal lebih buruk daripada
  // tombol mati yang menyebutkan sebabnya — alasan yang sama dengan baris campaign tanpa ID.
  if (!TOGGLEABLE.includes(configured)) {
    return {
      on,
      disabled: true,
      pending: false,
      reason: configured
        ? `Ad set ini berstatus ${configured} di Meta dan tidak bisa dinyalakan dari sini.`
        : "Status ad set ini tidak terbaca, jadi saklarnya dimatikan.",
    };
  }

  if (!canToggle) {
    return {
      on,
      disabled: true,
      pending: false,
      // Kalimatnya sama persis dengan saklar campaign: yang menjaga keduanya memang satu aturan
      // (`mayToggleCampaign` di server), dan dua kalimat berbeda untuk satu penolakan membuat
      // orang mengira ada dua izin yang berbeda.
      reason: "Hanya admin atau pemilik campaign yang boleh mengubah status.",
    };
  }

  if (pending) {
    return { on, disabled: true, pending: true, reason: "Sedang dikirim ke Meta…" };
  }

  return { on, disabled: false, pending: false, reason: "" };
}
