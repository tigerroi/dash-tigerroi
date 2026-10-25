/**
 * Satu sumber kebenaran untuk alamat di bilah alamat — path DAN query-nya.
 *
 * Dulu `useRouter` menyimpan pathname di `useState`-nya sendiri, dan itu cukup selama tidak ada
 * yang tinggal di query. Sejak filter dan pencarian ikut ditulis ke sana (lihat `useUrlState`),
 * dua penyimpan keadaan yang tidak saling mengabari berarti kotak pencarian yang tidak berubah
 * saat orang menekan Back — alamatnya kembali ke `?q=masse`, tabelnya tidak.
 *
 * `pushState`/`replaceState` tidak membangkitkan `popstate` (itu hanya untuk navigasi yang
 * dilakukan orang), jadi yang mengabari pelanggan adalah fungsi ini sendiri.
 */
const listeners = new Set();

export function subscribeLocation(listener) {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

export function locationPath() {
  return window.location.pathname;
}

export function locationSearch() {
  return window.location.search;
}

/**
 * `replace` untuk perubahan yang bukan perpindahan halaman — mengetik di kotak pencarian menulis
 * satu entri riwayat per huruf kalau di-push, dan tombol Back berubah jadi tombol hapus-satu-huruf.
 * `push` untuk yang benar-benar membuka sesuatu, karena itulah yang membuat Back mengembalikan
 * orang ke daftar yang masih tersaring.
 */
export function navigateTo(url, { replace = false } = {}) {
  if (url === window.location.pathname + window.location.search) {
    return;
  }

  window.history[replace ? "replaceState" : "pushState"]({}, "", url);
  for (const listener of [...listeners]) {
    listener();
  }
}
