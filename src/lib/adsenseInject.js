// Mode AdSense di tab "Generate Inject Kode" — sisi UI-nya.
//
// Yang MENGURAI dan MENOLAK kode tinggal di server kontrol (functions/adsense-inject-core.js):
// pengurai kedua di browser akan berselisih suatu hari, dan yang lebih longgar menang tanpa berbunyi.
// Modul ini cuma memegang bentuk draf form dan kunci pembandingnya.

// Cerminan ADSENSE_MAX_SLOTS (= GPT_MAX_SLOTS) — plugin punya lima kotak kode iklan. Dijaga tesnya.
export const ADSENSE_MAX_SLOTS = 5;

// Draf lima kotak dari baris tersimpan (`dashboard/adsenseSlots/{id}`), atau lima kotak kosong.
// RTDB mengembalikan `codes` sebagai array, tapi objek berkunci "0".."4" juga diterima.
export function adsenseDraftOf(saved) {
  const codes = saved?.codes;
  const list = Array.isArray(codes)
    ? codes
    : Array.from({ length: ADSENSE_MAX_SLOTS }, (_, index) => codes?.[index]);
  return Array.from({ length: ADSENSE_MAX_SLOTS }, (_, index) => String(list?.[index] ?? ""));
}

// Kotak yang dikirim: dirapikan, ekor kosong dibuang. Kotak kosong di TENGAH tetap dikirim supaya
// server yang menolaknya dengan nomor kotaknya.
export function filledCodes(draft) {
  const list = (draft || []).map((code) => String(code ?? "").trim());
  while (list.length && !list[list.length - 1]) list.pop();
  return list;
}

// Kunci pembanding hasil "Periksa kode": hasil untuk kode LAIN daripada yang tergambar tidak boleh
// dipakai untuk meng-inject.
export function adsenseCodesKey(draft) {
  return JSON.stringify(filledCodes(draft));
}

// ID slot sebuah kotak, hanya untuk LABEL di bawah kotaknya — bukan pemeriksaan.
export function slotIdOf(code) {
  return String(code ?? "").match(/data-ad-slot\s*=\s*["'](\d+)["']/i)?.[1] || "";
}
