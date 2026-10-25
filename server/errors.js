/**
 * Satu jawaban error untuk seluruh server kontrol.
 *
 * Tinggal di modul sendiri karena `index.js` menyambung RTDB dan membuka port saat diimpor: apa pun
 * yang ingin menguji kalimat yang keluar untuk request yang salah harus bisa memanggilnya tanpa
 * menaikkan penguras antrean kedua di samping yang sudah jalan di produksi.
 *
 * Mengembalikan `{ status, body }` dan bukan menyentuh `set` sendiri, supaya pemanggilnya — hook
 * `onError` Elysia — tetap satu-satunya yang tahu bentuk konteks Elysia.
 */
export function controlErrorResponse(code, error) {
  if (code === "VALIDATION") {
    /**
     * Field yang gagal disebut NAMANYA, bukan ditebak dari route-nya.
     *
     * Kalimat tetap per bagian ("id campaign harus angka") benar selama server ini cuma memegang
     * satu route dengan satu bentuk params. Sejak ada `/plugin/sites/:id/config/:group`, kalimat
     * yang sama keluar untuk grup pengaturan yang salah — dan orang yang membaca "id campaign harus
     * angka" untuk request yang tidak menyebut campaign sama sekali akan mencari di tempat yang
     * salah lebih lama daripada kalau tidak ada pesan sama sekali.
     */
    const names = failedFields(error);
    const listed = names.length ? ` — periksa ${names.join(", ")}.` : ".";

    if (error?.type === "body") {
      return { status: 422, body: { error: `Body tidak valid${listed}` } };
    }
    // `campaignId` tetap dapat kalimatnya sendiri: "harus angka" menyebut ATURANNYA, dan itu satu-
    // satunya hal yang tidak bisa disimpulkan dari nama fieldnya.
    if (names.includes("campaignId")) {
      return { status: 422, body: { error: "Parameter tidak valid — id campaign harus angka." } };
    }
    return { status: 422, body: { error: `Parameter tidak valid${listed}` } };
  }
  if (code === "NOT_FOUND") {
    return { status: 404, body: { error: "Endpoint tidak ada." } };
  }
  return { status: 500, body: { error: "Ada kesalahan di sisi server kontrol." }, log: true };
}

/**
 * Nama field yang ditolak validator, tanpa duplikat.
 *
 * `path` berbentuk pointer JSON ("/values/slug"); yang diambil hanya segmen pertama — orang yang
 * membaca pesan ini butuh tahu bagian mana dari request yang salah, dan "values" sudah cukup untuk
 * itu sementara "/values/slug" mulai terbaca seperti jejak stack.
 */
function failedFields(error) {
  const all = Array.isArray(error?.all) ? error.all : [];
  const names = all
    .map(
      (item) =>
        String(item?.path || "")
          .replace(/^\//, "")
          .split("/")[0],
    )
    .filter(Boolean);
  return [...new Set(names)];
}
