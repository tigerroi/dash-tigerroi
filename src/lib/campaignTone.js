// Nada warna pil/titik status campaign — dan sejak panel ad set ada, ad set juga.
//
// Dipindahkan ke sini dari UserDetail.jsx bukan demi kerapian: kosakata statusnya SATU
// ("Aktif" / "Terjadwal" / "Tidak aktif", diputuskan `campaignStatusLabel` di sisi sync), dan dua
// peta warna untuk satu kosakata berarti pil "Terjadwal" di baris campaign biru sementara pil yang
// sama di ad set di bawahnya hijau — dua tanda untuk satu keadaan, di layar yang sama.
export function getCampaignTone(status = "") {
  const normalized = String(status).toLowerCase();

  // Status yang tidak terbaca bukan berarti campaign-nya jalan. Hijau di sini akan menyatakan
  // sesuatu yang tidak kita ketahui, jadi warnanya sama dengan yang berhenti.
  if (!normalized || normalized === "-") {
    return "inactive";
  }

  // "nonaktif" adalah label LAMA, dan ia tinggal di baris RTDB sampai penyegaran dua menitan
  // berikutnya menuliskan label barunya. Dibuang dari sini, campaign yang berhenti berdiri hijau
  // selama jeda itu — dan yang paling menyesatkan justru pil berwarna salah.
  if (normalized.includes("tidak aktif") || normalized.includes("nonaktif")) {
    return "inactive";
  }

  // Terjadwal bukan peringatan: tidak ada yang perlu diperbaiki, campaign-nya cuma belum sampai
  // tanggal mulainya. Nada kuning di sini akan berdiri di kolom yang sama dengan campaign yang
  // benar-benar tertahan, dan yang membacanya akan mengejar sesuatu yang tidak ada.
  if (normalized.includes("terjadwal")) {
    return "scheduled";
  }

  // "Tidak ditayangkan" — hanya ad set yang punya keadaan ini (lihat
  // AD_SET_NOT_DELIVERING di functions/adsets-core.js). MERAH, dan itu satu-satunya nada merah di
  // kolom ini: ia satu-satunya keadaan yang menuntut tindakan hari itu juga — saklarnya sudah On,
  // campaign-nya jalan, dan uangnya tetap tidak keluar. Diperiksa SEBELUM "aktif" di bawah, yang
  // akan menelannya karena labelnya memang diawali kata itu.
  if (normalized.includes("tidak ditayangkan")) {
    return "danger";
  }

  // Campaign yang sudah tidak ada di Meta (CAMPAIGN_GONE_STATUS di functions/sync-core.js).
  // Disebut sendiri karena labelnya tidak memuat kata "tidak aktif": yang tidak aktif masih ada
  // dan masih bisa dinyalakan lagi, dan hijau di sini akan menyatakan campaign yang masih jalan.
  if (normalized.includes("tidak ada di meta")) {
    return "inactive";
  }

  return "active";
}
