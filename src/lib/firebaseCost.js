import { resources } from "../config/resources.js";
import { resolveRoute } from "../routes/resolveRoute.js";
import { needsRoiSnapshots, needsUserReports } from "./heavyData.js";
import { sessionNodes } from "./storeSubscriptions.js";

/**
 * Estimasi biaya unduhan RTDB, dihitung dari jejak aktivitas yang sudah tercatat.
 *
 * RTDB menagih $1/GB DOWNLOAD, dan yang paling mahal di database ini tidak pernah dilihat siapa
 * pun (lihat aturan "Langganan berat" di CLAUDE.md). Sampai berkas ini ada, satu-satunya cara
 * mengetahui berapa yang benar-benar dibayar armada ini adalah menunggu tagihan Google — yang
 * datang sebulan kemudian, sebagai satu angka, tanpa menyebut siapa atau halaman mana.
 *
 * TIGA HAL YANG MENENTUKAN SELURUH RANCANGAN INI, dan ketiganya membuat angkanya berbeda dari
 * "jumlah kunjungan halaman × ukuran database":
 *
 * 1. **BERPINDAH HALAMAN TIDAK MENGUNDUH APA PUN.** Langganan store dipasang SEKALI saat aplikasi
 *    mount dan hidup sampai sesinya selesai; membuka sepuluh halaman berturut-turut membaca dari
 *    cache yang sama. Yang membayar ulang adalah MUAT APLIKASI — login, refresh, tab baru. Sebuah
 *    estimasi yang mengalikan kunjungan halaman akan melaporkan berkali lipat dari tagihan yang
 *    benar-benar datang, dan yang membacanya akan mengejar penghematan yang tidak ada.
 *
 * 2. **YANG DIUNDUH TERGANTUNG ROLE.** Superadmin melanggan cermin gating, status plugin, dan
 *    `otpSecrets` yang tidak pernah disentuh advertiser. Daftarnya TIDAK ditulis ulang di sini —
 *    ia diimpor dari `sessionNodes`, yaitu daftar yang sama yang benar-benar dipakai store.
 *
 * 3. **DUA NODE TERBERAT MENYUSUL BELAKANGAN, DAN CUMA UNTUK SEBAGIAN SESI.** `roiSnapshots` dan
 *    `userReports` dipasang menurut ROUTE (lib/heavyData.js), jadi sebuah sesi yang seumur hidupnya
 *    cuma membuka Domains tidak pernah membayarnya. Diikutkan ke tiap sesi, estimasinya naik
 *    hampir 5 MB per sesi untuk sesuatu yang justru sudah dihemat.
 *
 * YANG TIDAK DIJAWAB BERKAS INI, dan disebutkan alih-alih ditebak:
 *
 * - **Delta per jam pada tab yang dibiarkan terbuka.** Tiap sync menulis ulang node yang dilanggan,
 *   dan tiap tab yang terbuka menerima selisihnya — biaya nyata yang besarnya tergantung berapa
 *   banyak yang berubah tiap run, dan itu tidak ada di jejak aktivitas mana pun. Karena itu hasil
 *   di sini adalah LANTAI, bukan taksiran tengah, dan halamannya mengatakan begitu.
 * - **Sesi yang tidak meninggalkan satu jejak pun.** Tab yang dibuka lalu ditutup sebelum jejaknya
 *   sempat berangkat tidak terhitung di mana pun.
 */

/**
 * Jeda yang memisahkan dua sesi.
 *
 * Jejak aktivitas tidak membawa penanda sesi — barisnya lahir dari klik dan kunjungan halaman,
 * bukan dari boot aplikasi — jadi batas sesinya DITAKSIR dari jeda, cara yang sama yang dipakai
 * tiap alat analitik. 30 menit: cukup panjang supaya orang yang membaca satu laporan panjang lalu
 * mengklik lagi tidak dihitung sebagai dua unduhan, cukup pendek supaya pagi dan sore hari yang
 * sama tidak dilebur jadi satu.
 *
 * Yang TIDAK ditaksir adalah login: sebuah baris `auth` selalu membuka sesi baru, berapa pun
 * jaraknya dari baris sebelumnya — di situ aplikasinya memang baru saja mount.
 */
export const SESSION_GAP_MS = 30 * 60 * 1000;

// Harga unduhan RTDB, Blaze. Dolar dan bukan rupiah: yang ditagihkan Google memang USD, dan sebuah
// kurs yang dikarang di browser membuat angka ini berbeda dari invoice-nya tanpa satu pun tanda.
export const RTDB_PRICE_PER_GB = 1;

// Firebase menghitung GB sebagai 2^30, sama dengan yang tertulis di kuota Spark-nya.
const BYTES_PER_GB = 1024 ** 3;

/**
 * Ukuran satu node, dari nilai yang BENAR-BENAR ada di store.
 *
 * `JSON.stringify().length` dan bukan angka yang diketik: RTDB mengirim JSON, jadi panjang teksnya
 * adalah taksiran terdekat yang bisa diambil tanpa menghubungi siapa pun. Ia meleset ke dua arah
 * yang saling menutup — store menambahkan `id` ke tiap baris koleksi (yang di RTDB adalah kunci,
 * bukan field), sementara wire protocol membawa pembungkusnya sendiri.
 *
 * Yang penting bukan presisinya melainkan bahwa ia IKUT TUMBUH: sebuah daftar angka yang diketik
 * hari ini akan menyebut 3,12 MB untuk `users` selamanya, termasuk pada hari armadanya dua kali
 * lipat — dan estimasi biaya yang tidak pernah naik adalah estimasi yang berhenti dibaca.
 */
export function measureNode(value) {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value)?.length ?? null;
  } catch {
    // Nilai yang tidak bisa di-stringify (siklus) tidak pernah datang dari RTDB, tapi mengukur
    // biaya tidak boleh jadi alasan sebuah halaman jatuh.
    return null;
  }
}

/**
 * Baris jejak → sesi.
 *
 * Diurut menaik per orang lalu dipotong di tiap jeda. Baris yang jamnya tidak terbaca DIBUANG:
 * `at` datang dari jam PERANGKAT dan boleh salah, dan satu baris bertanggal sampah akan memotong
 * satu sesi jadi tiga.
 */
export function sessionize(rows, gapMs = SESSION_GAP_MS) {
  const byActor = new Map();
  for (const row of rows || []) {
    const at = Date.parse(row?.at || "");
    if (!Number.isFinite(at)) continue;
    // Baris tanpa email adalah percobaan login yang gagal — pemiliknya belum diketahui, dan
    // menyatukannya jadi satu "orang" akan melebur perangkat yang tidak saling berhubungan.
    const actor = row.actorEmail || "(belum login)";
    if (!byActor.has(actor)) byActor.set(actor, []);
    byActor.get(actor).push({ ...row, ts: at });
  }

  const sessions = [];
  for (const [actor, list] of byActor) {
    list.sort((a, b) => a.ts - b.ts);
    let current = null;
    for (const row of list) {
      // `auth` selalu membuka sesi baru: di situ aplikasinya memang baru saja mount, berapa pun
      // jaraknya dari baris sebelumnya.
      const fresh = !current || row.category === "auth" || row.ts - current.endedAt > gapMs;
      if (fresh) {
        current = {
          actor,
          role: row.actorRole || "",
          startedAt: row.ts,
          endedAt: row.ts,
          events: 0,
          pages: new Set(),
        };
        sessions.push(current);
      }
      current.endedAt = row.ts;
      current.events += 1;
      // Role diambil dari baris TERAKHIR sesi itu: yang rolenya baru diubah di tengah sesi
      // mengunduh menurut role barunya pada muat berikutnya, dan itu yang lebih dekat.
      if (row.actorRole) current.role = row.actorRole;
      if (row.page) current.pages.add(row.page);
    }
  }
  return sessions.sort((a, b) => a.startedAt - b.startedAt);
}

/**
 * Node berat yang benar-benar ikut terunduh dalam sebuah sesi.
 *
 * Dibaca lewat `resolveRoute` + `needsRoiSnapshots`/`needsUserReports`, bukan dengan mencocokkan
 * potongan alamat sendiri: aturan mana halaman yang membutuhkannya sudah tinggal di satu tempat,
 * dan pengurai kedua di sini akan berselisih dengannya pada hari sebuah tab ditambahkan.
 */
export function heavyNodesOf(pages) {
  const nodes = new Set();
  for (const page of pages || []) {
    const route = resolveRoute(page, resources);
    if (needsRoiSnapshots(route)) nodes.add("roiSnapshots");
    if (needsUserReports(route)) nodes.add("userReports");
  }
  return [...nodes];
}

function sumNodes(nodes, sizes) {
  let bytes = 0;
  const unknown = [];
  for (const node of nodes) {
    const size = sizes?.[node];
    if (!Number.isFinite(size)) {
      unknown.push(node);
      continue;
    }
    bytes += size;
  }
  return { bytes, unknown };
}

const RESOURCE_KEYS = Object.keys(resources);

/**
 * Jejak + ukuran node → estimasi unduhan dan biayanya.
 *
 * `sizes` adalah peta {nodeKey: bytes} hasil pengukuran runtime. Node yang BELUM terukur tidak
 * ditaksir dan tidak dianggap nol — ia dikembalikan sebagai `unknownNodes`, dan halamannya
 * menyebutkannya. Nol di sana adalah klaim bahwa sebuah node tidak berisi apa-apa, dan yang paling
 * mungkin belum terukur justru dua node terberat: keduanya baru dilanggan kalau sesi yang sedang
 * mengukur kebetulan membuka halaman yang membacanya.
 */
export function estimateFirebaseCost({
  rows = [],
  sizes = {},
  gapMs = SESSION_GAP_MS,
  pricePerGb = RTDB_PRICE_PER_GB,
  resourceKeys = RESOURCE_KEYS,
} = {}) {
  const sessions = sessionize(rows, gapMs);
  const perActor = new Map();
  const unknownNodes = new Set();
  const days = new Set();

  for (const session of sessions) {
    const base = sessionNodes(session.role, resourceKeys);
    const heavy = heavyNodesOf(session.pages);
    const { bytes, unknown } = sumNodes([...base, ...heavy], sizes);
    for (const node of unknown) unknownNodes.add(node);
    days.add(new Date(session.startedAt).toISOString().slice(0, 10));

    if (!perActor.has(session.actor)) {
      perActor.set(session.actor, {
        actor: session.actor,
        role: session.role,
        sessions: 0,
        events: 0,
        bytes: 0,
        heavySessions: 0,
      });
    }
    const row = perActor.get(session.actor);
    row.sessions += 1;
    row.events += session.events;
    row.bytes += bytes;
    if (heavy.length) row.heavySessions += 1;
    if (session.role) row.role = session.role;
  }

  const rowsOut = [...perActor.values()]
    .map((row) => ({
      ...row,
      // Unduhan rata-rata satu muat aplikasi orang itu. Ia BUKAN konstanta per role: sesi yang
      // membuka tab ROI membayar dua node berat, sesi yang cuma membuka Domains tidak.
      bytesPerSession: row.sessions ? row.bytes / row.sessions : 0,
      cost: (row.bytes / BYTES_PER_GB) * pricePerGb,
    }))
    .sort((a, b) => b.bytes - a.bytes);

  const bytes = rowsOut.reduce((total, row) => total + row.bytes, 0);
  // Hari yang BENAR-BENAR punya sesi, bukan panjang rentang yang dipilih — sepola `dayCount` di
  // Proyeksi Budget. Rentang yang separuhnya akhir pekan akan melaporkan rata-rata harian yang
  // separuh terlalu kecil kalau dibagi panjang rentangnya.
  const dayCount = days.size;

  return {
    rows: rowsOut,
    sessions: sessions.length,
    dayCount,
    bytes,
    bytesPerDay: dayCount ? bytes / dayCount : 0,
    cost: (bytes / BYTES_PER_GB) * pricePerGb,
    costPerDay: dayCount ? (bytes / BYTES_PER_GB / dayCount) * pricePerGb : 0,
    // Proyeksi sebulan dari rata-rata harian yang teramati. 30 hari, bukan panjang bulan berjalan:
    // yang dijawabnya "kira-kira berapa sebulan", bukan tagihan bulan tertentu.
    costPerMonth: dayCount ? (bytes / BYTES_PER_GB / dayCount) * pricePerGb * 30 : 0,
    unknownNodes: [...unknownNodes].sort(),
  };
}

/** Byte → satuan yang bisa dibaca. Dipakai kolom tabel dan kartu, jadi satu tempat. */
export function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const digits = size >= 100 || unit === 0 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(digits).replace(".", ",")} ${units[unit]}`;
}

/**
 * Dolar, bukan rupiah — satu-satunya angka uang di dashboard ini yang begitu, dan sengaja.
 *
 * Yang ditagihkan Google adalah USD; sebuah kurs yang dikarang di browser (tidak ada satu pun
 * sumber kurs di sisi UI — `convertRowsToIdr` tinggal di sisi sync) menghasilkan rupiah yang tidak
 * akan pernah cocok dengan invoice yang jadi pembandingnya. Empat desimal karena angkanya memang
 * kecil: satu hari armada ini diukur dalam sen, dan "$0" untuk unduhan 200 MB tidak mengatakan
 * apa-apa.
 */
export function formatUsd(value) {
  if (!Number.isFinite(value)) return "-";
  const digits = Math.abs(value) >= 100 ? 2 : 4;
  return `$${value.toFixed(digits).replace(".", ",")}`;
}
