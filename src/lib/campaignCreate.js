import { countryCodesOf, countryText } from "./adCountries.js";
import { campaignUrlPairs } from "./campaignUrl.js";
import { formatDate } from "./formatDate.js";

/**
 * Aturan tampilan dialog "Buat campaign" di /campaigns. Murni.
 *
 * Yang MEMUTUSKAN (nama boleh atau tidak, jumlah gambar, Halaman milik siapa) tinggal di server —
 * functions/campaign-create-core.js dan server/campaign-create.js. Di sini cuma yang menyusun
 * pilihan dan ringkasan di layar; batasnya sendiri dibaca dari jawaban `assets`, bukan disalin jadi
 * angka kedua yang suatu hari berbeda dari yang ditegakkan server.
 */

const byText = (a, b) => String(a).localeCompare(String(b), "id-ID", { numeric: true });
const nameOf = (value) => String((Array.isArray(value) ? value[0] : value) ?? "").trim();

/**
 * Baris store, berikut KUNCI RTDB-nya — dan itu satu-satunya hal yang dikirim dialog ini ke server.
 *
 * `store.adAccounts` dan `store.subDomains` adalah ARRAY (`snapshotToArray` menaruh kuncinya di
 * `id`), bukan peta berkunci id. Dibaca dengan `Object.entries`, "kunci" yang keluar adalah NOMOR
 * URUT barisnya — dan server, yang membaca `adAccounts/{id}` dari RTDB, menjawab 404 "Ad account itu
 * tidak ada di /ad-accounts" untuk tiap akun yang dipilih. Kegagalan yang terbaca seperti data yang
 * hilang, padahal barisnya ada dan yang salah alamatnya.
 *
 * Menerima kedua bentuk karena keduanya beredar di repo ini (lihat `toArray` di campaignRows.js);
 * yang menentukan tetap `id` baris itu sendiri, bukan posisinya.
 */
function rowsOf(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map((row) => ({ ...row, id: row.id }));
  if (value && typeof value === "object")
    return Object.entries(value).map(([id, row]) => ({ ...row, id }));
  return [];
}

/**
 * Ad account yang bisa dipakai: yang ada, belum dihapus, dan sync-nya tidak dimatikan.
 *
 * Yang sync-nya mati memang ditolak server berikut sebabnya — tapi menawarkannya di dropdown berarti
 * penolakan itu baru terbaca sesudah seluruh form diisi.
 */
export function createAccountOptions(adAccounts) {
  return rowsOf(adAccounts)
    .filter((row) => row.id && !row.deletedAt && row.actId && !row.syncDisabled)
    .map((row) => ({
      id: row.id,
      label: nameOf(row.name) || row.actId,
      actId: row.actId,
      // Pemilik akun (kolom User Pemilik di /ad-accounts) — yang menyaring daftar subdomain di
      // bawahnya. Dibawa di sini supaya dialog tidak menyisir store dua kali untuk satu baris.
      owner: nameOf(row.userOwner),
    }))
    .sort((a, b) => byText(a.label, b.label));
}

/**
 * Subdomain yang bisa dituju, berikut pasangan kode → link iklannya.
 *
 * Yang belum punya Campaign URL TIDAK ditawarkan: link iklan harus salah satu yang tersimpan di
 * barisnya (server menolak sisanya), jadi subdomain tanpa link sama sekali adalah pilihan yang pasti
 * gagal — dan yang memperbaikinya bukan dialog ini melainkan cermin gating.
 *
 * `owner` MENYARINGNYA ke PIC-nya (kolom PIC di /sub-domains, kosakata yang sama dengan User Pemilik
 * di /ad-accounts). Yang dijawabnya pertanyaan yang dibawa orang ke dialog ini: campaign ini lahir di
 * ad account SIAPA, dan subdomain yang dia pegang yang mana — daftar 73 baris seluruh armada untuk
 * memilih satu subdomain sendiri adalah cara kode subdomain orang lain terpasang di iklan yang
 * uangnya keluar dari akun orang ini.
 *
 * Akun tanpa pemilik TIDAK menyaring apa pun: "kosong" bukan nama seorang advertiser, dan daftar
 * yang menyusut jadi nol untuk akun yang kolomnya belum diisi adalah dialog yang tidak bisa dipakai
 * tanpa satu pun keterangan. Yang memperbaikinya kolom User Pemilik di /ad-accounts.
 *
 * Ini penyaring TAMPILAN, bukan aturan — server tidak menolak subdomain milik orang lain. PIC sebuah
 * subdomain berpindah, dan 16 dari 73 baris belum punya PIC sama sekali (12 Sep 2026): dijadikan
 * penolakan, keenam belas baris itu tidak bisa dituju dari akun mana pun yang pemiliknya terisi.
 */
export function createSubDomainOptions(subDomains, { owner = "" } = {}) {
  const wanted = owner.trim().toLowerCase();
  const targets = [];
  let hidden = 0;
  for (const row of rowsOf(subDomains)) {
    if (!row.id || row.deletedAt) continue;
    const name = nameOf(row.name);
    if (!name) continue;
    const codes = campaignUrlPairs(row.campaignUrl, row.campaignCodes);
    if (!codes.length) continue;
    const pic = nameOf(row.pic);
    if (wanted && pic.toLowerCase() !== wanted) {
      hidden++;
      continue;
    }
    targets.push({ id: row.id, name, pic, codes });
  }
  return { targets: targets.sort((a, b) => byText(a.name, b.name)), hidden };
}

/**
 * Alamat dan parameter sebuah Campaign URL, untuk DUA KOTAK di layar.
 *
 * Dipakai menggambar, bukan memutuskan: yang dikirim ke server tetap link penuh dari baris subdomain
 * (`form.link`) berikut parameter yang diketik, dan yang memisahkannya untuk Meta adalah `splitLink`
 * di functions/campaign-create-core.js. Jadi pemisahan di sini tidak bisa mengubah tujuan iklan —
 * kalau suatu hari ia berbeda dari yang di server, yang meleset cuma yang tergambar.
 */
export function splitCampaignLink(url) {
  const text = String(url || "");
  const at = text.indexOf("?");
  return at === -1
    ? { link: text, urlTags: "" }
    : { link: text.slice(0, at), urlTags: text.slice(at + 1) };
}

/**
 * Usulan awalan nama campaign: kode + nomor urut berikutnya.
 *
 * Armada menamai campaign `{Kode}-{nn} Pros {WILAYAH} Carrou {Halaman} {N} Adset`, dan nomor urutnya
 * per kode. Yang diusulkan HANYA kode + nomornya: wilayah dan nama pendek Halaman cuma diketahui
 * orangnya, dan usulan yang memuat tempelan seperti "{WILAYAH}" akan terkirim apa adanya ke Meta
 * pada hari seseorang lupa menggantinya.
 *
 * Nomornya dibaca dari nama campaign yang SUDAH ADA di armada — bukan dari hitungan job — karena
 * itulah yang dilihat orang di tabel, dan dua campaign ber-nomor sama di satu akun ditolak server.
 */
export function nextCampaignName(code, existingNames = []) {
  const prefix = String(code || "").trim();
  if (!prefix) return "";
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)`, "i");
  let highest = 0;
  for (const name of existingNames) {
    const found = pattern.exec(String(name || "").trim());
    if (found) highest = Math.max(highest, Number(found[1]) || 0);
  }
  return `${prefix}-${String(highest + 1).padStart(2, "0")} `;
}

export function emptyVariant() {
  return { title: "", body: "", images: [] };
}

/** Gambar satu iklan, ditambah atau dilepas. Urutan klik = urutan kartu carousel-nya. */
export function toggleVariantImage(variants, index, hash, max) {
  return (variants || []).map((variant, at) => {
    if (at !== index) return variant;
    const picked = variant.images || [];
    if (picked.includes(hash))
      return { ...variant, images: picked.filter((item) => item !== hash) };
    if (picked.length >= Math.max(1, Number(max) || 1)) return variant;
    return { ...variant, images: [...picked, hash] };
  });
}

/**
 * Jumlah ad set = jumlah baris variasi, dan kotak angkanya yang mengaturnya.
 *
 * Satu variasi = satu ad set + satu iklan, dan itu bentuk yang dibaca dari armada: campaign "5 Adset"
 * adalah uji lima TEKS berbeda dengan targeting yang sama persis (diperiksa 12 Sep 2026 — kelima
 * iklannya berjudul dan berbody berbeda). Jadi "berapa ad set" tidak pernah jadi angka tersendiri
 * yang harus sepakat dengan jumlah teks: ia panjang daftarnya, dan kotak ini menyetelnya langsung
 * alih-alih menuntut orang menekan "Tambah variasi" lima kali.
 *
 * Yang MENYUSUT membuang baris dari BELAKANG, termasuk yang sudah terisi — sama dengan tombol X di
 * tiap barisnya, dan barisnya memang hilang dari layar saat itu juga. Angka yang tidak terbaca
 * (kotak yang sedang dikosongkan orang untuk mengetik ulang) tidak mengubah apa pun: dijepit ke 1,
 * satu ketukan backspace menghapus empat variasi yang sudah diketik.
 */
export function resizeVariants(variants, count, max) {
  const rows = Array.isArray(variants) ? variants : [];
  const wanted = Number(count);
  if (!Number.isFinite(wanted) || wanted < 1) return rows;
  const size = Math.min(Math.round(wanted), Math.max(1, Number(max) || 1));
  if (size === rows.length) return rows;
  return size < rows.length
    ? rows.slice(0, size)
    : [...rows, ...Array.from({ length: size - rows.length }, emptyVariant)];
}

/**
 * Variasi yang LENGKAP: judul, body, dan gambarnya sendiri.
 *
 * Gambar ikut jadi syarat sejak ia milik tiap iklan — variasi berteks lengkap tanpa gambar ditolak
 * server berikut nomor iklannya, dan tombol Buat yang hidup untuk keadaan itu memindahkan
 * penolakannya ke sesudah seluruh form diisi.
 */
export function filledVariants(variants, minImages = 1) {
  const floor = Math.max(1, Number(minImages) || 1);
  return (variants || []).filter(
    (item) => item?.title?.trim() && item?.body?.trim() && (item.images?.length || 0) >= floor,
  );
}

/**
 * Ringkasan yang dibaca orang sebelum menekan Buat.
 *
 * Menyebut BERAPA objek yang akan lahir, bukan cuma "buat campaign": satu klik di sini melahirkan
 * sampai 21 objek di Meta, dan yang sudah lahir tidak bisa ditarik kembali dari dialog mana pun.
 */
export function createReviewLines(form, { accountLabel, pageName, minImages }) {
  const variants = filledVariants(form.variants, minImages);
  const lines = [
    `${variants.length} ad set + ${variants.length} iklan di bawah satu campaign baru`,
    `Ad account: ${accountLabel || "-"}`,
    `Nama: ${form.name.trim() || "-"}`,
    `Tujuan iklan: ${form.subDomainName || "-"} (kode ${form.code || "-"})`,
    `Link: ${splitCampaignLink(form.link).link || "-"}`,
    `Parameter URL: ${form.urlTags?.trim() || "(tanpa parameter)"}`,
    `Anggaran harian (CBO): ${formatIdrShort(form.dailyBudget)}`,
    `Negara: ${form.countries.trim() || "-"} · umur ${form.ageMin}–${form.ageMax}`,
    // Jadwal disebut apa adanya, dan yang kosong menyebut ARTINYA: baris kosong di ringkasan yang
    // dibaca orang sebelum menekan Buat tidak bisa dibedakan dari baris yang lupa digambar.
    `Mulai tayang: ${startTimeNote(form.startTime)}`,
    `Halaman: ${pageName || "-"} · tombol ${form.cta}`,
    // Per IKLAN, bukan satu angka: sejak gambarnya milik tiap iklan, satu jumlah tidak bisa
    // mengabarkan iklan mana yang carousel-nya cuma dua kartu.
    `Gambar per iklan: ${variants.map((item) => item.images.length).join(", ") || "-"}`,
  ];
  return lines;
}

/** Jadwal di ringkasan — "20 Sep 2026, 01:59" atau artinya kalau dikosongkan. */
function startTimeNote(value) {
  const text = String(value || "").trim();
  if (!text) return "begitu campaign dinyalakan (tanpa jadwal)";
  const [date, clock = "00:00"] = text.split("T");
  return `${formatDate(date)}, ${clock.slice(0, 5)} WIB`;
}

function formatIdrShort(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0
    ? `Rp ${Math.round(amount).toLocaleString("id-ID")}`
    : "-";
}

/**
 * Badan permintaan `POST /fleet/campaigns` — bentuknya sama dengan yang diperiksa server.
 *
 * Yang TIDAK ikut: `act_…`, nama subdomain, dan batas apa pun. Server membacanya sendiri dari RTDB;
 * yang dikirim dari sini cuma KUNCI-nya.
 */
export function createCampaignPayload(form, minImages) {
  return {
    accountId: form.accountId,
    subDomainId: form.subDomainId,
    // Link PENUH dari baris subdomain, apa adanya: yang diadu server adalah alamatnya (tanpa query),
    // dan parameternya diambil dari kotak di sebelahnya. Mengirim alamat yang sudah dipotong di
    // browser berarti pemotongnya ada dua, dan yang lebih longgar menang tanpa berbunyi.
    link: form.link,
    urlTags: form.urlTags?.trim() || "",
    name: form.name.trim(),
    dailyBudget: Number(form.dailyBudget),
    countries: form.countries
      .split(/[\s,]+/)
      .map((code) => code.trim().toUpperCase())
      .filter(Boolean),
    ageMin: Number(form.ageMin),
    ageMax: Number(form.ageMax),
    pageId: form.pageId,
    pixelId: form.pixelId,
    cta: form.cta,
    startTime: form.startTime || "",
    // Gambar ikut di dalam variasinya, dan TIDAK ada daftar tingkat campaign lagi: server masih
    // menerimanya untuk bundel lama, tapi mengirim keduanya berarti dua sumber untuk satu jawaban.
    variants: filledVariants(form.variants, minImages).map((item) => ({
      title: item.title.trim(),
      body: item.body.trim(),
      images: item.images,
    })),
  };
}

// --- Preset negara per advertiser --------------------------------------------------------------

/**
 * Daftar negara yang disimpan seorang advertiser, untuk dipakai ulang campaign berikutnya.
 *
 * PER ADVERTISER, bukan global: tiap orang memberi nama wilayahnya sendiri ("MEA", "LATAM", "EU
 * murah"), dan satu daftar bersama berarti sepuluh nama yang artinya cuma diketahui pembuatnya.
 * Advertiser-nya PEMILIK ad account yang dipilih — kosakata yang sama dengan penyaring subdomain di
 * dialog yang sama, jadi tidak ada pertanyaan kedua tentang "advertiser yang mana".
 */
export function countryPresetEntry({ advertiser, name, countries }) {
  const owner = String(advertiser || "").trim();
  const label = String(name || "").trim();
  const codes = countryCodesOf(countries);
  if (!owner) throw new Error("Preset negara butuh advertiser — pilih ad account-nya dulu.");
  if (!label) throw new Error("Beri nama presetnya dulu, misalnya MEA atau LATAM.");
  if (label.length > 60) throw new Error("Nama preset terlalu panjang (maks 60 karakter).");
  if (!codes.length) throw new Error("Pilih negaranya dulu sebelum menyimpan preset.");
  return { advertiser: owner, name: label, countries: countryText(codes) };
}

/**
 * Preset milik satu advertiser, urut nama — dan yang diarsipkan tidak ikut.
 *
 * `deletedAt` disaring DI SINI karena langganannya `subscribeValue` (satu node nilai), bukan
 * `subscribeResource` yang menyaringnya sendiri: node ini dilanggan bersama kedua node job halaman
 * Campaign, dan preset yang dihapus akan berdiri terus di dropdown tanpa penyaring ini.
 */
export function countryPresetsFor(presets, advertiser) {
  const wanted = String(advertiser || "")
    .trim()
    .toLowerCase();
  if (!wanted) return [];
  return rowsOf(presets)
    .filter(
      (row) =>
        row.id &&
        !row.deletedAt &&
        String(row.advertiser || "")
          .trim()
          .toLowerCase() === wanted,
    )
    .map((row) => ({ id: row.id, name: nameOf(row.name), countries: String(row.countries || "") }))
    .sort((a, b) => byText(a.name, b.name));
}
