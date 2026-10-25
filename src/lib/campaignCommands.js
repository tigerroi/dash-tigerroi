// Saklar on/off campaign di /users/{uid} — sisi UI-nya.
//
// Tombolnya tidak memanggil Meta. Ia menulis NIAT ke `users/{uid}/campaignCommands/{campaignId}`,
// dan yang memanggil Meta adalah penerap di sisi server (functions/campaign-commands.mjs). Bentuk
// perintahnya harus sama persis dengan `campaignCommandEntry` di functions/sync-core.js; kalau
// berbeda, perintahnya lolos aturan database tapi tidak pernah dieksekusi siapa pun.
//
// Kenapa antrean dan bukan panggilan langsung: DRS memblokir `allUsers` di project ini, jadi
// browser tidak bisa memanggil Cloud Function sama sekali (lihat src/config/features.js). Saat DRS
// dilonggarkan, callable `setCampaignStatus` menulis perintah yang sama lalu langsung
// mengeksekusinya — jadi yang berubah cuma kecepatannya, bukan hasilnya.

export const CAMPAIGN_STATUSES = ["ACTIVE", "PAUSED"];

export function campaignCommandEntry(campaign, desiredStatus, actor, now = new Date()) {
  if (!CAMPAIGN_STATUSES.includes(desiredStatus)) {
    throw new Error(`Status campaign tidak dikenal: ${desiredStatus}`);
  }

  const campaignId = String(campaign?.campaignId || "").trim();
  if (!campaignId) {
    throw new Error("Campaign ini belum punya ID Meta.");
  }

  return {
    campaignId,
    campaign: campaign?.campaign || "",
    adAccount: campaign?.adAccount || "",
    desiredStatus,
    state: "pending",
    requestedAt: now.toISOString(),
    requestedBy: actor || "dashboard",
    error: null,
  };
}

// RTDB mengembalikan node kosong sebagai null, dan perintah yang tidak dikenal bentuknya tidak
// boleh menjatuhkan seluruh tabel.
export function toCommandMap(value) {
  if (!value || typeof value !== "object") {
    return {};
  }

  return value;
}

/**
 * Keadaan tombol untuk satu baris campaign: posisinya, boleh ditekan atau tidak, dan kalimat yang
 * menjelaskan kenapa.
 *
 * Yang dibaca sebagai posisi tombol adalah `configuredStatus` (field `status` milik Meta), BUKAN
 * label status di kolom sebelahnya. Label punya TIGA nilai untuk dua posisi saklar — "Aktif" dan
 * "Terjadwal" sama-sama berarti On — jadi tombol yang membaca label akan tampak mati untuk campaign
 * yang jadwalnya belum sampai, dan orang akan menekannya untuk "menyalakan" sesuatu yang sudah
 * menyala. Alasan yang sama berlaku untuk label lama yang diturunkan dari `effective_status`.
 *
 * Posisi yang TIDAK DIKETAHUI bukan "mati". Baris yang disync sebelum `configuredStatus` ada, dan
 * baris tanpa ID Meta, tidak punya posisi yang bisa ditampilkan — tombolnya dimatikan dengan
 * alasannya, bukan digambar mati seolah campaign-nya berhenti.
 *
 * `metaMissing` adalah alasan ketiga dan berbeda dari keduanya: campaign-nya BUKAN belum terbaca,
 * melainkan sudah tidak ada di Meta (diarsipkan atau dihapus). Tombolnya tetap mati, tapi kalimat
 * "tunggu sync berikutnya" akan menyuruh orang menunggu sesuatu yang tidak akan pernah datang.
 */
export function campaignToggleState(row, command, { canToggle = false } = {}) {
  const campaignId = String(row?.campaignId || "").trim();
  const pending = command?.state === "pending";
  const failed = command?.state === "failed";
  const configured = String(row?.configuredStatus || "").toUpperCase();
  const known = CAMPAIGN_STATUSES.includes(configured);

  // Selama perintah menunggu, tombolnya menunjukkan arah yang diminta — bukan keadaan lama. Kalau
  // tidak, tombol yang baru saja ditekan melompat balik ke posisi semula dan terlihat gagal.
  const on = pending ? command.desiredStatus === "ACTIVE" : configured === "ACTIVE";

  if (!campaignId) {
    return {
      on: false,
      known: false,
      disabled: true,
      pending: false,
      failed: false,
      reason: "Campaign ini belum punya ID Meta — tunggu sync campaign berikutnya.",
    };
  }

  if (row?.metaMissing) {
    return {
      on: false,
      known: false,
      disabled: true,
      pending: false,
      failed: false,
      reason: "Campaign ini sudah tidak ada di Meta — diarsipkan atau dihapus di Ads Manager.",
    };
  }

  if (!canToggle) {
    return {
      on,
      known,
      disabled: true,
      pending,
      failed,
      reason: "Hanya admin atau pemilik campaign yang boleh mengubah status.",
    };
  }

  if (pending) {
    return {
      on,
      known: true,
      disabled: true,
      pending: true,
      failed: false,
      reason:
        command.desiredStatus === "ACTIVE"
          ? "Menunggu dinyalakan di Meta."
          : "Menunggu dimatikan di Meta.",
    };
  }

  if (!known) {
    return {
      on: false,
      known: false,
      disabled: true,
      pending: false,
      failed,
      reason: "Status campaign belum terbaca dari Meta — tunggu sync campaign berikutnya.",
    };
  }

  return {
    on,
    known: true,
    disabled: false,
    pending: false,
    failed,
    // Perintah yang gagal tetap membiarkan tombolnya bisa ditekan: mencoba lagi adalah tindakan
    // yang benar, dan pesannya sudah tertulis di bawah tombol.
    reason: failed ? command.error || "Perintah terakhir gagal." : "",
  };
}
