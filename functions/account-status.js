/**
 * Status akun di sisi Google, untuk kolom Status di /gam-accounts dan /adsense-accounts.
 *
 * Kolom itu dulu diketik orang (Active/Inactive/Limit/Lepas Limit), dan itulah masalahnya: yang
 * dijawabnya adalah keadaan yang DIPUTUSKAN GOOGLE dan bisa berubah semalam — akun yang ditutup,
 * iklan yang dibatasi — sementara yang tersimpan adalah kalimat yang diketik seseorang entah kapan.
 * Tidak ada apa pun di layar yang membedakan "Active" yang dicek pagi ini dari "Active" yang
 * diketik tiga bulan lalu untuk akun yang sekarang sudah dibatasi.
 *
 * Sumbernya API AdSense untuk KEDUA halaman, dan itu bukan kelalaian pada halaman GAM: network Ad
 * Manager membawa `propertyCode` berbentuk `ca-pub-…`, yaitu akun AdSense yang sama — dan Ad
 * Manager API sendiri tidak punya notifikasi maupun status akun sama sekali. Satu-satunya yang
 * tahu sebuah akun dibatasi atau ditutup adalah sisi AdSense-nya.
 */

// Empat keadaan, urut dari yang paling menghentikan pendapatan. Urutannya BUKAN selera — ia
// dipakai sebagai cascade di `accountStatusFrom`: akun yang ditutup Google juga tidak punya
// impresi, dan akun yang dibatasi masih punya sebagian. Yang menjawab "kenapa" harus alasan
// PERTAMA yang cocok, karena itu yang menentukan ke mana orang pergi memperbaikinya.
export const ACCOUNT_CLOSED = "Akun Close";
export const AD_LIMITED = "Limit Iklan";
export const ADS_NOT_SERVING = "Iklan Belum Tayang";
export const ADS_READY = "Ready";

export const ACCOUNT_STATUSES = [ACCOUNT_CLOSED, AD_LIMITED, ADS_NOT_SERVING, ADS_READY];

// `Account.state` di AdSense v2: READY / NEEDS_ATTENTION / CLOSED.
//
// Hanya CLOSED yang dipetakan. NEEDS_ATTENTION sengaja TIDAK jadi keadaan kelima maupun disamakan
// dengan salah satu dari empat di atas: ia berarti "ada yang perlu diurus" — informasi pajak,
// alamat penagihan, verifikasi — dan hampir semuanya tidak menghentikan tayangan iklan sedetik
// pun. Akun yang iklannya tetap tayang lalu ditulis "Iklan Belum Tayang" mengirim orang mencari
// masalah yang tidak ada.
const CLOSED_STATE = "CLOSED";

/**
 * Notif "Iklan Dibatasi" — yang merah di dashboard AdSense.
 *
 * Diperiksa ke API produksi (3 Sep 2026, `GET /v2/accounts/{pub}/alerts`): tipenya
 * `adsense-traffic-throttled`, severity `SEVERE`, pesannya "Jumlah iklan yang dapat Anda tampilkan
 * telah dibatasi untuk satu atau beberapa produk AdSense Anda." Dua akun armada ini membawanya
 * hari itu, dan keduanya memang sudah diketik "Limit" oleh orang — jadi aturan ini bukan tebakan
 * baru, melainkan pekerjaan yang selama ini dilakukan tangan.
 */
const THROTTLE_TYPE = /throttl|serving-limit|ad-limit/i;

// Lapis kedua, dan keduanya gagal dengan cara yang BERLAWANAN — itu sebabnya ada dua. Pencocokan
// tipe yang ketat akan diam pada hari Google mengganti nama tipenya, dan yang diam di sini berbunyi
// "Ready" untuk akun yang iklannya justru sedang dibatasi. Sebaliknya, "semua alert SEVERE =
// Limit Iklan" akan melabeli akun yang notif merahnya soal pajak atau pembayaran tertunda.
const THROTTLE_MESSAGE = /dibatasi|batasi|limited|restrict/i;

/**
 * Alert pembatasan iklan pada daftar alert sebuah akun, atau `null`.
 *
 * Dipisah dan diekspor supaya bisa diuji sendiri: ini satu-satunya bagian modul ini yang membaca
 * teks buatan Google, dan teks buatan Google berubah tanpa mengabari siapa pun.
 */
export function adLimitAlert(alerts) {
  const rows = Array.isArray(alerts) ? alerts : [];
  for (const alert of rows) {
    if (THROTTLE_TYPE.test(String(alert?.type || ""))) return alert;
  }
  for (const alert of rows) {
    if (String(alert?.severity || "").toUpperCase() !== "SEVERE") continue;
    if (THROTTLE_MESSAGE.test(String(alert?.message || ""))) return alert;
  }
  return null;
}

/**
 * Empat keadaan itu dari apa yang dijawab Google, atau `null` kalau BELUM BISA DIPASTIKAN.
 *
 * `null` bukan kesopanan — ia yang menjaga seluruh kolom ini tetap bisa dipercaya. Sekali sebuah
 * kegagalan API dibaca sebagai "Ready", kolom Status berhenti berarti apa-apa: yang dilihat orang
 * bukan lagi keadaan akun melainkan keadaan sync, dan keduanya tidak bisa dibedakan di layar.
 * Pemanggilnya membiarkan nilai lama berdiri apa adanya dan menuliskan sebabnya di sebelahnya —
 * pola yang sama dengan `earningKnown`: yang tidak diketahui tidak pernah dinilai.
 *
 * @param {{state?: string, alerts?: object[], impressions?: number, earning?: number}} report
 * @returns {{status: string, detail: string}|null}
 */
export function accountStatusFrom({ state, alerts, impressions, earning } = {}) {
  const declared = String(state || "")
    .trim()
    .toUpperCase();

  // Akun yang ditutup didahulukan, dan alert-nya tidak ikut ditunggu: akun tertutup tidak punya
  // apa pun lagi untuk dibatasi, dan laporan hariannya nol karena alasan yang sudah terjawab.
  if (declared === CLOSED_STATE) return { status: ACCOUNT_CLOSED, detail: "" };
  if (!declared || declared.endsWith("_UNSPECIFIED")) return null;

  // Daftar alert yang GAGAL diambil bukan daftar alert yang kosong. Dibaca sebagai kosong, akun
  // yang sedang dibatasi berbunyi Ready selama API-nya bermasalah — persis di hari orang paling
  // butuh membacanya.
  if (!Array.isArray(alerts)) return null;

  const limited = adLimitAlert(alerts);
  if (limited) {
    // Pesan Google sendiri yang dipakai, bukan kalimat kita: yang dibaca orang di kolom ini harus
    // kata yang sama dengan yang ia cari di Pusat Kebijakan.
    return { status: AD_LIMITED, detail: String(limited.message || "").trim() };
  }

  // "Iklan Belum Tayang" adalah SATU-SATUNYA dari empat keadaan ini yang tidak dilaporkan Google
  // sebagai apa pun — tidak ada flag, tidak ada notif. Yang tersisa adalah laporan hari terakhir:
  // nol impresi DAN nol pendapatan berarti tidak ada satu iklan pun yang tayang, yaitu persis
  // definisi yang dipakai orang saat ia membuka domainnya sendiri untuk mengeceknya.
  //
  // Keduanya diperiksa, bukan impresinya saja: kedua API melaporkan impresi per JENIS permintaan,
  // dan sebuah network yang seluruh inventarisnya dilayani sumber lain bisa mengembalikan nol
  // impresi untuk hari yang tetap menghasilkan uang. Uang yang masuk adalah bukti iklan tayang.
  //
  // SATU HARI, dan itu syarat yang mengikat pemanggilnya (`period.settledDayRange` di
  // earningUpdate). Diberi rentang beberapa hari, pertanyaannya diam-diam berubah jadi "apakah
  // akun ini pernah menayangkan iklan minggu ini" — dan masseffectstore.com, yang Ad Exchange-nya
  // berhenti 31 Agu 2026, tetap berbunyi "Ready" pada 3 Sep karena satu impresi dari hari pertama
  // rentang itu.
  const shown = Number(impressions);
  const earned = Number(earning);
  if (!Number.isFinite(shown) || !Number.isFinite(earned)) return null;
  if (shown > 0 || earned > 0) return { status: ADS_READY, detail: "" };
  return { status: ADS_NOT_SERVING, detail: "" };
}

/**
 * Kalimat untuk kolom keterangan saat status TIDAK bisa dicek.
 *
 * Kolom itu satu-satunya tempat "kenapa status ini tidak berubah-ubah" bisa terbaca. Tanpa
 * kalimat ini, akun yang project Google Cloud-nya belum mengaktifkan AdSense Management API akan
 * berdiri selamanya dengan status yang diketik berbulan-bulan lalu — dan tidak ada satu tanda pun
 * di layar yang membedakannya dari akun yang barusan dicek dan memang begitu keadaannya.
 *
 * Dipotong satu kalimat: pesan Google membawa URL konsol dan nomor project yang panjangnya
 * melebihi seluruh baris tabel, dan yang menentukan tindakan ada di kalimat pertamanya.
 */
export function statusCheckNote(error) {
  const raw = String(error?.message || error || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return "Tidak bisa dicek: sebabnya tidak disebutkan.";
  const [first] = raw.split(/(?<=\.)\s/);
  const short = (first || raw).slice(0, 200);
  return `Tidak bisa dicek: ${short}`;
}

/**
 * Apakah kolom Status baris ini SEDANG DIPEGANG ORANG, sehingga sync tidak boleh menimpanya?
 *
 * Yang dibandingkan bukan siapa penulisnya (RTDB tidak menyimpannya) melainkan DUA NILAI: `status`
 * — yang berdiri di kolom — dan `statusAuto`, yaitu keadaan yang dibaca sync terakhir kali. Sync
 * selalu menulis keduanya sekaligus, jadi selama tidak ada yang menyentuhnya keduanya sama persis;
 * begitu keduanya berbeda, yang mengubahnya cuma bisa orang lewat form.
 *
 * DITURUNKAN, bukan ditandai saat menyimpan — dan itu yang memberi jalan kembali ke "ikut sync"
 * tanpa saklar keempat di form: pilihan yang KEBETULAN sama dengan yang dibaca Google berhenti
 * jadi kuncian dengan sendirinya, persis aturan `nextTheme` di sisi layar. Sebuah penanda
 * `statusManual: true` yang ditulis saat menyimpan tidak punya itu: sekali ditekan, kolomnya beku
 * selamanya dan yang membukanya kembali cuma orang yang tahu ada field tersembunyi bernama begitu.
 *
 * `statusAuto` yang KOSONG menjawab tidak, dan itu bukan kelalaian melainkan batas yang diketahui:
 * baris yang ditulis sebelum kolom ini ada tidak punya pembanding sama sekali, jadi suntingan yang
 * dibuat SEBELUM fitur ini di-deploy tetap ditimpa sekali oleh run berikutnya — sesudah itu
 * baris tersebut punya pembandingnya dan aman. Yang lahir dari impor Google sudah membawa
 * `statusAuto` sejak baris pertamanya, jadi akun yang baru diimpor pun bisa langsung dipegang.
 */
export function accountStatusPinned(account) {
  const typed = String(account?.status || "").trim();
  const auto = String(account?.statusAuto || "").trim();
  if (!typed || !auto) return false;
  return typed !== auto;
}

/**
 * Yang ditulis ke baris akun saat statusnya BERHASIL dibaca.
 *
 * Untuk baris yang statusnya dipegang orang, yang ditulis cuma `statusAuto` — kolom "Status dari
 * Google" di sebelahnya. Ia tetap ditulis justru karena statusnya tidak: tanpa itu, kolom yang
 * dikunci berdiri tanpa satu pun tanda tentang apa yang sebenarnya dijawab Google hari ini, dan
 * yang membacanya tidak punya cara tahu kapan kuncian itu sudah tidak perlu lagi. Ia juga yang
 * membuka kuncinya sendiri begitu Google akhirnya menyebut hal yang sama.
 *
 * `statusDetail` ikut TIDAK disentuh di sana: kolom itu satu-satunya tempat orang menuliskan
 * sebab ia memegang statusnya ("sedang banding, tiket #123"), dan sync yang mengosongkannya
 * menghapus keterangan yang justru menerangkan baris paling tidak biasa di tabel.
 */
export function accountStatusFields(account, decided) {
  if (accountStatusPinned(account)) return { statusAuto: decided.status };
  // `null` MENGHAPUS keterangan, bukan menulis kosong: baris yang tadinya "Tidak bisa dicek" lalu
  // berhasil dicek harus berhenti menyebutkannya, kalau tidak kolomnya membaca keadaan yang sudah
  // lewat sebagai keadaan sekarang.
  return {
    status: decided.status,
    statusAuto: decided.status,
    statusDetail: decided.detail || null,
  };
}

/**
 * Yang ditulis saat statusnya TIDAK bisa dicek — sebabnya di `statusDetail`, dan tidak apa-apa
 * untuk baris yang statusnya dipegang orang.
 *
 * Alasannya sama dengan di atas: keterangan yang ditulis orang tidak boleh diganti kalimat sync,
 * dan pada baris yang dikunci "Tidak bisa dicek" juga tidak menerangkan apa pun — status di
 * sebelahnya memang tidak akan berubah walau pengecekannya berhasil.
 */
export function accountStatusNote(account, reason) {
  return accountStatusPinned(account) ? {} : { statusDetail: statusCheckNote(reason) };
}
