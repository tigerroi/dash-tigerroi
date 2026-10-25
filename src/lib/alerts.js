/**
 * Ambang bawaan peringatan ROI — CERMINAN `DEFAULT_ALERTS` di
 * [`functions/alerts-core.js`](../../functions/alerts-core.js).
 *
 * Ditulis dua kali karena frontend dan `functions/` adalah dua paket yang tidak bisa saling impor,
 * persis alasan yang sama dengan `campaignCommandEntry` dan `reminders`. Yang satu berubah, yang
 * lain ikut — kalau tidak, form Settings menawarkan ambang yang berbeda dari yang benar-benar
 * dipakai saat menilai, dan tidak ada apa pun di layar yang menunjukkan selisihnya.
 *
 * Yang TIDAK ikut disalin ke sini adalah aturan penilaiannya (`evaluateAlerts`), dan itu
 * disengaja: tidak ada satu pun tempat di dashboard yang menampilkan "baris ini sedang melewati
 * ambang". Menyalinnya berarti satu salinan aturan yang tidak dipakai siapa pun — dan salinan yang
 * tidak dipakai adalah salinan yang tidak akan pernah ikut diperbarui.
 *
 * `enabled` MASIH ADA di sini tapi tidak lagi diisi form mana pun: on/off Peringatan ROI pindah ke
 * saklar topiknya di halaman Notification Center (`settings/notifications/roiAlerts.enabled`), dan
 * `runAlerts` yang menimpakannya ke setelan ini sebelum menilai. Dua saklar untuk satu pesan adalah
 * bentuk yang paling sering dibaca sebagai "fiturnya rusak" — yang satu dinyalakan, yang lain tetap
 * diam, dan tidak ada apa pun di layar yang menyebutkan bahwa masih ada yang kedua.
 *
 * Yang menahannya tetap ada, dan sekarang sama dengan dua topik lain: DAFTAR PENERIMA. Tidak ada
 * satu pun orang atau grup yang berlangganan "Peringatan ROI" sampai seseorang menyalakannya
 * sendiri, jadi fitur ini tidak bisa berbunyi ke siapa pun yang tidak memintanya.
 */
export const DEFAULT_ALERTS = {
  enabled: false,
  minSpend: 100_000,
  roiThreshold: -50,
  balanceThreshold: 100_000,
  spendNoEarning: true,
  lowRoi: true,
  lowBalance: true,
};

/**
 * Advertiser yang saldo Meta-nya menipis — untuk peringatan di layar Ringkasan Overview.
 *
 * Ambang dan saklarnya dibaca dari `settings/alerts` yang SAMA dengan aturan `lowBalance` di
 * `evaluateAlerts` (functions/alerts-core.js), dan saldonya dari `advertiserSpend` — jumlah
 * `adAccounts.balance` per PIC, angka yang sama dengan `metaBalance` di baris ROI yang dinilai
 * Telegram. Dua definisi "menipis" akan menyebut advertiser berbeda di layar dan di chat.
 *
 * Kosong diperiksa sebelum `Number()`, alasan yang sama dengan `alertSettings()`: `Number("")`
 * adalah 0, dan kotak ambang yang dikosongkan tidak boleh diam-diam jadi ambang nol.
 */
export function lowBalanceAdvertisers(rows, settings) {
  const config = settings || {};
  if (config.lowBalance === false) return [];
  const raw = config.balanceThreshold;
  const parsed = raw === "" || raw === null || raw === undefined ? Number.NaN : Number(raw);
  const threshold = Number.isFinite(parsed) ? Math.max(0, parsed) : DEFAULT_ALERTS.balanceThreshold;
  return (rows || [])
    .filter((row) => typeof row?.balance === "number" && row.balance <= threshold)
    .sort((a, b) => a.balance - b.balance);
}
