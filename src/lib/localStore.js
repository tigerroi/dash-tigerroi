// `localStorage`, atau null kalau tidak bisa disentuh: sebagian browser MELEMPAR saat ia dibaca di
// mode privat atau saat data situs diblokir, dan tes node tidak punya sama sekali. Pemanggil tetap
// membungkus getItem/setItem-nya sendiri dengan try/catch.
export function localStore() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
