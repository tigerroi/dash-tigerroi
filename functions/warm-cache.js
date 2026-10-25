import { onValue, ref } from "firebase/database";

/**
 * Langganan yang gunanya BUKAN membaca apa pun.
 *
 * Proses ini memanggil `get()` pada node yang sama berkali-kali tiap menit: `refreshCampaignStatuses`
 * dan `applyCampaignCommands` masing-masing membaca SELURUH `users` tiap dua menit, sweep plugin
 * membaca `pluginSites` tiap menit, cermin gating membaca `subDomains` tiap sepuluh menit. Tiap
 * `get()` itu satu unduhan penuh dari server, dan `users` sendiri 3,2 MB — dua kali per siklus,
 * 720 siklus sehari, 140 GB sebulan. Download RTDB ditagih $1/GB, jadi satu node yang tidak pernah
 * dilihat siapa pun inilah yang jadi hampir seluruh tagihan.
 *
 * Yang memperbaikinya bukan mengurangi bacaannya melainkan MEMBUAT BACAAN ITU GRATIS.
 * `repoGetValue` di @firebase/database menjawab dari cache lokal kalau ada langganan aktif yang
 * MENUTUPI path yang diminta ("Only active queries are cached. There is no persisted cache."), dan
 * pencariannya menyusuri leluhur — jadi satu langganan di `users` juga melayani `get("users/{id}")`.
 * Sesudah unduhan pertama, yang lewat kabel cuma DELTA-nya.
 *
 * Karena itu di server ia dipasang SEKALI saat start dan tidak pernah dilepas: langganan yang
 * dicabut membuang cache-nya, dan `get()` berikutnya kembali menjadi unduhan penuh.
 *
 * DI CLOUD FUNCTION ATURANNYA TERBALIK — dipasang saat run mulai, DICABUT saat run selesai
 * (`SYNC_WARM_PATHS`, dipakai `scheduledSync`). Bukan karena hemat memori: di luar sebuah request,
 * Cloud Functions gen2 MENCEKIK CPU instance-nya, jadi websocket yang menganggur bisa berhenti
 * menerima delta tanpa satu pun tanda. Langganan yang bertahan antar-run lalu menjawab `get()`
 * dari cache yang sudah basi — dan yang dihitung dari cache itu adalah earning dan belanja yang
 * ditulis ke `roiReports`. Di dalam satu run CPU-nya dialokasikan penuh, jadi di situ cache-nya
 * memang keadaan sekarang. Antar-run, unduhan penuh yang pertama itulah harga kebenarannya.
 *
 * Ini bukan jalur data — tidak ada satu pun pemanggil yang membaca nilai dari sini. Kalau modul ini
 * dihapus, semuanya tetap bekerja persis sama, cuma mahal lagi. Itu juga alasan `onError` hanya
 * mencatat: langganan yang ditolak berarti bacaannya kembali ke server, bukan berarti ada yang rusak.
 */

/**
 * Path yang dibaca berulang oleh cron di SERVER KONTROL. Yang TIDAK ada di sini disengaja: node yang
 * cuma dibaca saat ada orang menekan tombol (pluginKeys, googleApiConfigs) tidak pernah jadi
 * unduhan berulang, dan langganan untuknya cuma menahan salinannya di memori tanpa alasan.
 */
export const WARM_PATHS = [
  // 3,2 MB, dibaca DUA kali tiap dua menit. Sendirian ia ~90% dari tagihan download.
  "users",
  // Dibaca `refreshCampaignStatuses` tiap dua menit.
  "adAccounts",
  // Cermin gating (tiap sepuluh menit) dan sweep plugin, yang membacanya per situs.
  "subDomains",
  // Sweep plugin membacanya utuh, lalu sekali lagi PER SITUS di dalam loop-nya.
  "pluginSites",
];

function defaultSubscribe(db, path, onError) {
  return onValue(
    ref(db, path),
    () => {},
    (error) => onError?.(path, error),
  );
}

/**
 * Pasang langganan penghangat untuk tiap path. Mengembalikan fungsi pencabut — dipakai tes, bukan
 * jalur produksi: di sana ia memang hidup selama proses.
 *
 * Satu path yang gagal dilanggan tidak menjatuhkan sisanya, alasan yang sama dengan tiap siklus cron
 * di index.js: node yang tidak bisa dihangatkan cuma kembali mahal, dan itu bukan sebab untuk
 * membuat node lain ikut mahal.
 */
export function warmCache(db, { paths = WARM_PATHS, subscribe = defaultSubscribe, onError } = {}) {
  const unsubscribers = [];
  for (const path of paths) {
    try {
      unsubscribers.push(subscribe(db, path, onError));
    } catch (error) {
      onError?.(path, error);
    }
  }
  return () => {
    for (const unsubscribe of unsubscribers) {
      if (typeof unsubscribe === "function") unsubscribe();
    }
  };
}

/**
 * Path yang dibaca berulang di dalam SATU run `scheduledSync`, dan daftarnya cuma satu baris.
 *
 * `users` dibaca sampai ENAM kali per run oleh empat modul yang tidak saling kenal: `syncCampaigns`
 * (sekali di awal, sekali lagi sebagai `freshUsers` untuk menulis advertiserSpend + stats),
 * `applyCampaignCommands`, `syncSubdomains`, dan `topicRecipientList` — yang terakhir sekali per
 * TOPIK, dan hanya kalau topik itu punya sesuatu untuk dikirim. Enam kali 3,1 MB adalah ~19 MB
 * per run, 24 run sehari; hampir seluruh
 * biaya download sisi Cloud Function ada di satu node ini.
 *
 * YANG LAIN SENGAJA TIDAK IKUT, dan sebabnya ukuran — bukan jumlah bacaan. `adAccounts` (9 KB)
 * dibaca tiga kali, `subDomains` (45 KB) dua kali, `gamAccounts`/`adsenseAccounts`/
 * `googleApiConfigs` (masing-masing di bawah 10 KB) dua sampai empat kali: menghangatkannya
 * menghemat kilobyte sambil menambah satu langganan yang harus dicabut dengan benar. Kalau salah
 * satunya suatu hari ikut tumbuh sebesar `users`, di sinilah ia ditambahkan.
 */
export const SYNC_WARM_PATHS = ["users"];
