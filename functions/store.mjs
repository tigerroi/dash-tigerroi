import { endBefore, get, orderByKey, query, ref, set, startAt, update } from "firebase/database";

// Satu antarmuka RTDB untuk dua SDK.
//
// `syncSubdomains` dulu ada dua kali: sekali di index.js dengan admin SDK (callable) dan sekali di
// sync-subdomains.mjs dengan client SDK (CLI, cron). Keduanya menghitung ROI yang
// sama dengan kode yang berbeda, jadi tiap perbaikan harus ditulis dua kali — dan yang satu selalu
// tertinggal. Yang benar-benar berbeda cuma panggilan di bawah ini, jadi itu yang dipisahkan.
//
// `readFrom`/`readBefore` menyusul belakangan, dan sebabnya biaya. `dashboard/roiReports` tumbuh
// terus dan memang HARUS begitu — Laba Rugi membaca bulan-bulan lampau, jadi ia tidak boleh
// dipangkas — sementara sync cuma perlu beberapa hari terakhir. Membacanya utuh tiap jam berarti
// unduhan yang membesar tiap hari untuk baris yang tidak pernah dilihat. Kuncinya `YYYY-MM-DD__id`,
// jadi urutan kunci ADALAH urutan tanggal: jendelanya bisa diminta ke server alih-alih disaring
// sesudah seluruhnya diunduh.

export function clientStore(db) {
  return {
    read: async (path) => (await get(ref(db, path))).val(),
    readFrom: async (path, startKey) =>
      (await get(query(ref(db, path), orderByKey(), startAt(startKey)))).val(),
    readBefore: async (path, endKey) =>
      (await get(query(ref(db, path), orderByKey(), endBefore(endKey)))).val(),
    update: (path, values) => update(ref(db, path), values),
    replace: (path, value) => set(ref(db, path), value),
  };
}

export function adminStore(db) {
  return {
    read: async (path) => (await db.ref(path).get()).val(),
    readFrom: async (path, startKey) =>
      (await db.ref(path).orderByKey().startAt(startKey).get()).val(),
    readBefore: async (path, endKey) =>
      (await db.ref(path).orderByKey().endBefore(endKey).get()).val(),
    update: (path, values) => db.ref(path).update(values),
    replace: (path, value) => db.ref(path).set(value),
  };
}

// Pemanggil lama mengoper objek database apa adanya. Dibungkus di sini supaya tanda tangan
// `syncSubdomains(db, …)` yang dipakai CLI dan cron tidak perlu ikut berubah.
export function asStore(dbOrStore) {
  return typeof dbOrStore?.read === "function" ? dbOrStore : clientStore(dbOrStore);
}
