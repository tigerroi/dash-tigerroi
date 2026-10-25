// Cermin sesaat panel ad set, di dalam tab yang sedang terbuka saja.
//
// Panel ad set membaca langsung ke Meta (lihat src/components/CampaignAdSets.jsx), dan tanpa ini
// tiap kali sebuah baris dibuka ulang ia menembakkan dua panggilan lagi — padahal orang yang
// membandingkan tiga campaign membuka-tutup barisnya berkali-kali dalam semenit. Yang dibayar bukan
// cuma tunggu ~2 detik: pemakaian API dihitung Meta per app, dan yang membuat sebuah app dicap
// anomali adalah bentuknya — puluhan request meletus dalam sedetik karena tombolnya diklik ulang.
//
// UMURNYA PENDEK, DAN ITU SYARATNYA. Panel ini ada justru untuk menjawab keadaan sekarang; sebuah
// cermin yang bertahan lama mengembalikan persis masalah yang membuat ad set tidak dicerminkan ke
// RTDB sejak awal. Dua menit dipilih karena itu jarak yang sama dengan penyegaran status campaign
// di tabel induknya — angka ad set tidak boleh mengaku lebih segar daripada baris di atasnya.
//
// Ia juga tidak pernah menyentuh localStorage: yang tersimpan di sana bertahan melewati penutupan
// tab, dan panel yang dibuka besok pagi akan menggambar angka kemarin sore sebelum sempat
// menyebutkan umurnya.
const AD_SET_CACHE_MS = 120_000;

// Satu campaign bisa berdiri di profil yang berbeda (baris user itu yang menentukan izinnya), jadi
// kuncinya memuat keduanya — bukan campaignId saja.
export function adSetCacheKey(userId, campaignId) {
  return `${userId || ""}:${campaignId || ""}`;
}

/**
 * `clock` dan `ttlMs` bisa dioper supaya bisa diuji tanpa menunggu dua menit sungguhan.
 */
export function createAdSetCache({ ttlMs = AD_SET_CACHE_MS, clock = () => Date.now() } = {}) {
  const entries = new Map();
  // Panggilan yang sedang berjalan, dipisah dari hasilnya. Tanpa ini, membuka baris yang sama dua
  // kali sebelum jawabannya datang (klik ganda, atau tutup lalu buka lagi) menembakkan panggilan
  // KEDUA untuk campaign yang sama — persis bentuk yang dihindari di atas.
  const inflight = new Map();

  function peek(key) {
    const entry = entries.get(key);
    if (!entry) return null;
    const ageMs = clock() - entry.at;
    if (ageMs > ttlMs) {
      entries.delete(key);
      return null;
    }
    return { data: entry.data, at: entry.at, ageMs };
  }

  function store(key, data) {
    const at = clock();
    // Yang sudah basi dibuang sekalian: peta ini cuma boleh memuat yang masih berlaku, dan tanpa
    // pembersihan ini ia tumbuh sepanjang orang membuka baris baru.
    for (const [otherKey, entry] of entries) {
      if (clock() - entry.at > ttlMs) entries.delete(otherKey);
    }
    entries.set(key, { at, data });
    return { data, at, ageMs: 0 };
  }

  return {
    peek,

    /**
     * Isi panel untuk `key` — dari cermin kalau masih berlaku, kalau tidak dari `load()`.
     *
     * `force` melewati cermin (tombol Segarkan). Yang GAGAL tidak pernah tersimpan: sebuah
     * kegagalan yang ikut dicermin akan menjawab error yang sama selama dua menit walau Meta sudah
     * pulih sedetik kemudian.
     */
    async read(key, load, { force = false } = {}) {
      if (!force) {
        const hit = peek(key);
        if (hit) return { ...hit, fromCache: true };
        const running = inflight.get(key);
        if (running) return running;
      }

      const promise = load()
        .then((data) => ({ ...store(key, data), fromCache: false }))
        .finally(() => {
          if (inflight.get(key) === promise) inflight.delete(key);
        });
      inflight.set(key, promise);
      return promise;
    },

    // Dipakai saat saklar campaign-nya baru saja disentuh: statusnya di Meta berubah, dan cermin
    // yang masih menyebut keadaan sebelumnya akan menerangkan Rp 0 dengan sebab yang sudah tidak
    // berlaku ("campaign di atasnya mati").
    invalidate(key) {
      entries.delete(key);
      inflight.delete(key);
    },

    clear() {
      entries.clear();
      inflight.clear();
    },
  };
}

/**
 * "baru saja" / "3 menit lalu" — umur angka yang sedang digambar.
 *
 * Umur RELATIF, bukan jam dinding, sepola `untilLabel` di src/lib/syncRetry.js: yang ditanyakan
 * orang di sini "ini masih segar?", dan "16:05" memaksanya mengurangkan sendiri dari jam yang harus
 * dicari dulu di layar.
 *
 * Ia ada karena cerminnya ada: angka yang digambar dari cermin tanpa satu pun tanda umur tidak bisa
 * dibedakan dari angka yang baru saja dibaca — dan panel ini menjanjikan keadaan sekarang.
 */
export function adSetAgeNote(ageMs) {
  const ms = Number(ageMs);
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 30_000) return "baru saja";
  const minutes = Math.round(ms / 60_000);
  return minutes < 1 ? "kurang dari semenit lalu" : `${minutes} menit lalu`;
}

// Satu cermin untuk seluruh halaman: ia harus bertahan saat komponen panelnya dibuang — membuka
// baris lain MEMBUANG panel yang lama, dan cermin yang tinggal di dalamnya ikut hilang bersamanya.
// Itu persis keadaan yang fitur ini ada untuk memperbaikinya.
export const adSetCache = createAdSetCache();
