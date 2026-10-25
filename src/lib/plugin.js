// Manajemen plugin RabbitROI — sisi UI-nya.
//
// Halaman /plugin TIDAK punya antrean RTDB seperti gating dan saklar campaign. Yang dibacanya dari
// RTDB cuma cermin status (`pluginSites`); pengaturan yang diedit tinggal di database WordPress tiap
// situs dan diambil lewat server kontrol tiap kali sebuah situs dibuka. Lihat catatan di
// src/lib/controlApi.js untuk kenapa tidak ada jalur cadangan.
//
// Modul ini murni: tidak memanggil jaringan, tidak menyentuh Firebase. Yang dijaganya adalah bentuk
// baris tabel, keadaan tombol, dan — yang paling penting — MANA SAJA field yang benar-benar diubah
// orang, karena POST plugin bersifat partial dan mengirim field yang tidak diubah berarti menimpa
// perubahan orang lain dengan nilai yang kita baca beberapa menit lalu.

export const PLUGIN_GROUPS = ["ads-settings", "header-footer", "behaviour", "cmp", "security"];

export function toMap(value) {
  return value && typeof value === "object" ? value : {};
}

/**
 * Daftar subdomain digabung dengan cermin status pluginnya.
 *
 * Yang memimpin adalah `subDomains`, bukan `pluginSites`: situs yang belum pernah di-enroll tidak
 * punya baris cermin sama sekali, dan itu justru daftar yang paling sering dibuka orang di halaman
 * ini — yang belum terhubung.
 */
export function toPluginRows(subDomains, pluginSites) {
  const mirror = toMap(pluginSites);

  return (subDomains || [])
    .filter((row) => row?.id && row?.name)
    .map((row) => {
      const site = mirror[row.id] || null;
      return {
        id: row.id,
        name: String(row.name),
        parentDomain: String(row.parentDomain || ""),
        pic: String(row.pic || ""),
        // Status baris subdomain di dashboard (Active/Inactive) — BUKAN status pluginnya. Keduanya
        // dipertahankan terpisah: subdomain yang sudah tidak dipakai tetap boleh punya plugin yang
        // hidup, dan meleburnya jadi satu kolom membuat keduanya tidak bisa dibaca.
        subdomainStatus: String(row.status || ""),
        enrolled: site?.enrolled === true,
        version: String(site?.version || ""),
        php: String(site?.php || ""),
        wp: String(site?.wp || ""),
        lastSeenAt: String(site?.lastSeenAt || ""),
        error: String(site?.error || ""),
        errorCode: String(site?.errorCode || ""),
        errorAt: String(site?.errorAt || ""),
        // `null` berarti belum pernah disentuh sama sekali dari halaman ini — dibedakan dari
        // "pernah dicoba dan gagal", yang punya baris cermin lengkap dengan sebabnya.
        mirrored: Boolean(site),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Keadaan satu baris: label, warna, dan aksi apa yang masuk akal ditawarkan.
 *
 * Tiga hal yang sengaja TIDAK dilebur, karena masing-masing menuntut tindakan yang berbeda:
 *
 *   belum       — belum pernah enroll. Tombolnya Enroll.
 *   terhubung   — enroll dan jawaban terakhirnya berhasil. Tombolnya Kelola.
 *   bermasalah  — enroll tapi jawaban terakhirnya gagal. Tombolnya tetap Kelola (situsnya bisa saja
 *                 sudah hidup lagi), dengan sebabnya tertulis.
 *
 * `invalid_key` dipisahkan dari "bermasalah" biasa karena ia JALAN BUNTU: kunci kita tidak dikenali
 * situs itu lagi, dan reset — satu-satunya jalan ke enroll ulang — justru membutuhkan kunci yang
 * sudah tidak berlaku itu. Digambar seperti kegagalan biasa, orang akan menekan tombol yang sama
 * berkali-kali untuk sesuatu yang tidak akan pernah berhasil dari sini.
 */
export function pluginSiteState(row, { canManage = false, serverReady = true } = {}) {
  const base = { canEnroll: false, canManage: false, canReset: false, canPing: false, reason: "" };

  if (!serverReady) {
    return {
      ...base,
      tone: row?.enrolled ? "neutral" : "warning",
      label: row?.enrolled ? "Terhubung" : "Belum",
      reason:
        "Server kontrol belum dikonfigurasi (VITE_CONTROL_API_URL) — halaman ini tidak punya jalur lain ke situs.",
    };
  }

  if (!canManage) {
    return {
      ...base,
      tone: row?.enrolled ? "success" : "neutral",
      label: row?.enrolled ? "Terhubung" : "Belum",
      reason: "Hanya superadmin yang boleh mengelola plugin situs.",
    };
  }

  if (!row?.enrolled) {
    // `already_enrolled` untuk situs yang di sisi kita belum enroll: pluginnya pernah di-enroll dari
    // tempat lain (atau kuncinya hilang dari RTDB). Enroll lagi akan ditolak dengan pesan yang sama
    // selamanya, jadi yang disebut di sini adalah satu-satunya jalan keluarnya.
    if (row?.errorCode === "already_enrolled") {
      return {
        ...base,
        tone: "danger",
        label: "Terkunci",
        reason:
          "Situs ini sudah enroll dengan kunci yang tidak kita punya. Reset harus dilakukan dari WordPress situsnya sendiri sebelum bisa di-enroll dari sini.",
      };
    }

    return {
      ...base,
      canEnroll: true,
      tone: "neutral",
      label: "Belum",
      reason: row?.error || "",
    };
  }

  if (row?.errorCode === "invalid_key") {
    return {
      ...base,
      canReset: true,
      canPing: true,
      tone: "danger",
      label: "Kunci ditolak",
      reason:
        "Kunci yang tersimpan tidak dikenali situs ini lagi — pluginnya dipasang ulang atau di-reset dari sana. Tidak ada tombol di sini yang bisa memperbaikinya.",
    };
  }

  if (row?.error) {
    return {
      ...base,
      canManage: true,
      canPing: true,
      canReset: true,
      tone: "warning",
      label: "Bermasalah",
      reason: row.error,
    };
  }

  return {
    ...base,
    canManage: true,
    canPing: true,
    canReset: true,
    tone: "success",
    label: "Terhubung",
    reason: "",
  };
}

/**
 * Bolehkah `?situs=` dilupakan karena situsnya sudah tidak ada?
 *
 * Jawabannya "belum tahu" selama daftarnya belum datang, dan itu seluruh isi fungsi ini. Saat
 * halaman dimuat ulang, langganan RTDB belum mengirim apa pun: `rows` kosong sementara `openId`
 * sudah terbaca dari alamat. Penjaga yang menyimpulkan dari keadaan itu akan menghapus `?situs=`
 * dan melempar orang kembali ke daftar armada — membatalkan seluruh gunanya menaruh situs yang
 * terbuka di alamat, dan meninggalkan `?tab=` menggantung sehingga seolah tab-nya yang rusak.
 *
 * `rows` yang kosong TIDAK bisa membedakan "belum datang" dari "memang tidak ada". Yang bisa cuma
 * keadaan muat langganannya sendiri, jadi ia wajib dioper ke sini.
 */
export function shouldForgetOpenSite(openId, rows, loading) {
  if (loading) return false;
  if (!openId) return false;
  return !(rows || []).some((row) => row.id === openId);
}

// Ringkasan kartu di atas tabel. "Bermasalah" dihitung terpisah dari "belum": selisih itu yang
// membedakan armada yang belum dipasang dari armada yang dipasang lalu berhenti menjawab.
export function pluginSummary(rows) {
  const list = rows || [];
  return {
    total: list.length,
    enrolled: list.filter((row) => row.enrolled).length,
    pending: list.filter((row) => !row.enrolled).length,
    failing: list.filter((row) => row.enrolled && row.error).length,
  };
}

// --- Form ---------------------------------------------------------------------------------------

/**
 * Nilai dari API → nilai untuk kotak isian.
 *
 * Semua jadi string kecuali yang berbentuk saklar. Alasannya bukan kerapian: situs menjawab dari
 * kolom database, jadi angka bisa datang sebagai `3` atau `"3"` untuk field yang sama tergantung
 * endpointnya — dan `changedValues` di bawah membandingkan form dengan form, bukan form dengan
 * jawaban API. Satu bentuk di kedua sisi perbandingan adalah yang membuat "belum diubah" berarti
 * benar-benar belum diubah.
 */
/**
 * Apa pun bentuk URL media yang tersimpan → daftar URL yang bersih.
 *
 * Cerminan `mediaList` di functions/plugin-core.js, dan harus tetap sama persis — yang di sana
 * dipakai saat MENGIRIM, yang di sini saat MENAMPILKAN. Beda sedikit, kotak isian menampilkan
 * daftar yang berbeda dari yang benar-benar tersimpan di situs.
 *
 * Lima bentuk yang benar-benar ditemukan di armada:
 *
 *   1. array sungguhan                    ["https://a", "https://b"]
 *   2. JSON yang sudah di-encode          '["https://a","https://b"]'
 *   3. teks satu-URL-per-baris            "https://a\nhttps://b"
 *   4. array berisi SATU blob berbaris    ["https://a\nhttps://b"]
 *   5. JSON yang KOMANYA HILANG           '["https://a"\n"https://b"]'
 *
 * Yang kelima yang sedang ada di produksi: 120 URL video dipisah baris baru alih-alih koma,
 * dengan tanda kutip ter-escape menempel di URL pertama dan terakhir. `JSON.parse` menolaknya,
 * dan pembaca yang cuma mencoba `JSON.parse` lalu menyerah meneruskan seluruh blok itu apa adanya
 * ke kotak isian — kurung siku dan segalanya.
 */
export function mediaList(value) {
  if (Array.isArray(value)) return value.flatMap((item) => mediaList(item));

  const text = String(value ?? "").trim();
  if (!text) return [];

  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      // Elemennya sendiri bisa berupa blob berbaris banyak (bentuk 4).
      if (Array.isArray(parsed)) return parsed.flatMap((item) => mediaList(item));
    } catch {
      // Bentuk 5 — diperlakukan sebagai teks biasa di bawah, bukan dianggap gagal.
    }
  }

  return text
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(/[\r\n,]+/)
    .map(cleanMediaToken)
    .filter(Boolean);
}

// Tanda kutip GANDA yang ikut terbawa — biasa maupun yang ter-escape — dibuang dari kedua UJUNG.
// Kutip TUNGGAL dan yang di tengah dibiarkan: keduanya sah di dalam URL.
function cleanMediaToken(token) {
  return String(token)
    .trim()
    .replace(/^[\\"\s]+/, "")
    .replace(/[\\"\s]+$/, "");
}

// Satu URL per BARIS di kotak isian, bukan dipisah koma: yang benar-benar ada di lapangan adalah
// 120 URL dalam satu field, dan koma menjadikannya satu baris sepanjang layar yang tidak bisa
// dibaca, apalagi disunting.
export function unwrapMedia(value) {
  return mediaList(value).join("\n");
}

export function toFormValue(field, value) {
  if (field.type === "bool01" || field.type === "boolean") {
    return value === true || value === 1 || value === "1";
  }
  /**
   * `list` lewat pembersih yang SAMA dengan `media`, bukan pemecah baris polos.
   *
   * Dua alasan, dan yang kedua yang membuatnya mendesak:
   *
   * 1. Bentuk rusak yang sama bisa menimpa daftar mana pun — sebuah kolom berisi
   *    `["Indonesia","Malaysia"]` menghasilkan kurung dan kutip di kotak isian persis seperti pada
   *    URL video. Pemecah polos memotong barisnya tapi meninggalkan seluruh tanda bacanya.
   *
   * 2. Tipe field datang dari `GET /plugin/schema`, yaitu dari SERVER. Selama server kontrol belum
   *    di-deploy ulang, `video_urls` masih dikirim sebagai `list` — jadi cabang `media` di atas
   *    tidak pernah tercapai dan blob mentah itu tetap muncul di layar. Menyamakan keduanya di sini
   *    membuat tampilannya benar tanpa menunggu deploy; yang masih butuh deploy hanya sisi
   *    KIRIM-nya (`normalizeField`), yang memang jalan di server.
   */
  if (field.type === "media" || field.type === "list") {
    return unwrapMedia(value);
  }
  return value === null || value === undefined ? "" : String(value);
}

export function toFormValues(fields, data) {
  const values = {};
  for (const field of fields || []) {
    values[field.name] = toFormValue(field, toMap(data)[field.name]);
  }
  return values;
}

/**
 * Field yang BENAR-BENAR diubah orang, dibanding keadaan saat form dibuka.
 *
 * Ini yang membuat POST tetap partial. Mengirim seluruh form berarti menulis ulang setiap field
 * dengan nilai yang kita baca beberapa menit lalu — dan pada halaman yang mengelola armada situs,
 * itu berarti perubahan yang dibuat orang lain di sela-sela hilang tanpa jejak, di situs yang sedang
 * menerima trafik berbayar.
 */
export function changedValues(fields, current, original) {
  const changed = {};
  for (const field of fields || []) {
    const now = current?.[field.name];
    const before = original?.[field.name];
    if (now === undefined) continue;
    if (now === before) continue;
    changed[field.name] = now;
  }
  return changed;
}

export function hasChanges(fields, current, original) {
  return Object.keys(changedValues(fields, current, original)).length > 0;
}

// Field dikelompokkan untuk digambar. Urutan grup mengikuti urutan kemunculan pertamanya di skema —
// bukan diurutkan alfabetis, karena skema sudah menyusunnya dari yang paling sering diubah.
export function groupFields(fields) {
  const groups = [];
  const index = new Map();
  for (const field of fields || []) {
    const name = field.group || "Lainnya";
    if (!index.has(name)) {
      index.set(name, { name, fields: [] });
      groups.push(index.get(name));
    }
    index.get(name).fields.push(field);
  }
  return groups;
}

/**
 * Pesan untuk field yang tersimpan tapi TIDAK berubah.
 *
 * Disebut dengan label yang dibaca orang di form, bukan nama kolomnya: seseorang yang baru saja
 * mengetik di kotak "Jumlah slot iklan" tidak punya cara tahu bahwa itu `jumlah_iklan`.
 */
export function unappliedMessage(unapplied, fields) {
  const names = unapplied || [];
  if (!names.length) return "";
  const labels = names.map((name) => {
    const field = (fields || []).find((item) => item.name === name);
    return field?.label || name;
  });
  return `Situs menerima permintaannya tapi ${labels.join(", ")} tidak berubah — nilainya ditolak diam-diam di sana.`;
}

// --- Terapkan massal --------------------------------------------------------------------------------

const BULK_TONES = {
  ok: "success",
  // Bukan merah: perubahannya sampai ke situs, hanya nilainya yang ditolak diam-diam. Diwarnai
  // seperti kegagalan, orang akan mengulanginya — dan pengulangan tidak akan mengubah apa pun.
  unapplied: "warning",
  failed: "danger",
};

const BULK_LABELS = {
  ok: "Berhasil",
  unapplied: "Tidak berubah",
  failed: "Gagal",
};

export function bulkTone(status) {
  return BULK_TONES[String(status || "")] || "neutral";
}

export function bulkLabel(status) {
  return BULK_LABELS[String(status || "")] || status || "-";
}

/**
 * Ringkasan massal → satu kalimat untuk toast.
 *
 * Ketiga angkanya disebut walau nol, kecuali yang nol memang tidak menarik. Yang tidak boleh hilang
 * adalah `unapplied`: ia satu-satunya yang terbaca sebagai berhasil di tabel per situs tapi berarti
 * tidak ada yang berubah di sana.
 */
export function bulkMessage(summary, groupTitle) {
  const { total = 0, ok = 0, unapplied = 0, failed = 0 } = summary || {};
  const parts = [`${ok} berhasil`];
  if (unapplied) parts.push(`${unapplied} tidak berubah`);
  if (failed) parts.push(`${failed} gagal`);

  return {
    tone: failed ? "error" : unapplied ? "warning" : "success",
    message: `${groupTitle} diterapkan ke ${total} situs: ${parts.join(", ")}.`,
  };
}
