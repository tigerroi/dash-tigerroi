/**
 * Kalimat yang dibaca orang begitu ia kembali dari layar consent Google.
 *
 * Alurnya keluar dari aplikasi ini (ke accounts.google.com) lalu masuk lagi lewat redirect, jadi
 * tidak ada satu pun promise yang bertahan untuk membawa hasilnya — yang tersisa cuma query di
 * alamat. Diterjemahkan di sini, terpisah dari komponennya, karena yang menentukan tindakan
 * berikutnya adalah PEMBEDAAN tiga hasilnya, dan itu layak diuji sendiri.
 *
 * Tiga hasil yang tidak boleh lebur — sepola `ok`/`unapplied`/`failed` di plugin:
 *
 *   ok      — token baru, scope lengkap. Selesai.
 *   partial — token baru TERSIMPAN, tapi scope-nya kurang. Halaman AdSense akan tetap kosong, dan
 *             yang harus dilakukan adalah Login lagi sambil mencentang semua izin.
 *   failed  — tidak ada yang berubah; kredensialnya masih memakai token yang lama.
 *
 * `partial` yang digabung ke `ok` mengembalikan persis bug yang membuat fitur ini ada. Digabung ke
 * `failed`, ia menyuruh orang mengulang consent yang token barunya sebenarnya sudah tersimpan.
 */
export function googleAuthReturn(search) {
  const params = new URLSearchParams(String(search || ""));
  const outcome = params.get("googleAuth");
  if (!outcome) return null;

  const name = params.get("name") || "kredensial ini";
  const detail = params.get("msg") || "";

  if (outcome === "ok") {
    return { kind: "success", message: `${name} terhubung — Ad Manager dan AdSense.` };
  }
  // Keterangan dari server ikut masuk ke KALIMATNYA, tidak cuma ke console: yang menentukan
  // langkah berikutnya justru ada di situ ("izin AdSense tidak diberikan", "invalid_grant"), dan
  // orang yang baru kembali dari layar Google tidak sedang membuka devtools.
  if (outcome === "partial") {
    return {
      kind: "warning",
      message: join(`${name}: token tersimpan, tapi izinnya belum lengkap.`, detail),
      detail,
    };
  }
  if (outcome === "denied") {
    return { kind: "warning", message: `Login ${name} dibatalkan. Tidak ada yang berubah.` };
  }
  return {
    kind: "error",
    message: join(
      `Login ${name} gagal. Tidak ada yang berubah — token lama masih yang dipakai.`,
      detail,
    ),
    detail,
  };
}

function join(sentence, detail) {
  return detail ? `${sentence} ${detail}` : sentence;
}
